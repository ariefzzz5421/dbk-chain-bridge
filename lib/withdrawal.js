import { createPublicClient, defineChain, http, formatEther, encodeAbiParameters, keccak256, isAddressEqual } from 'viem';
import { mainnet } from 'viem/chains';
import { chainConfig, getWithdrawals, getWithdrawalStatus } from 'viem/op-stack';
import { resolveDbkRpc, resolveEthRpc } from './rpc';

export const PORTAL='0x63CA00232F471bE2A3Bf3C4e95Bc1d2B3EA5DB92';
export const OUTPUT_ORACLE='0x0341bb689CB8a4c16c61307F4BdA254E1bFD525e';
export const MESSAGE_PASSER='0x4200000000000000000000000000000000000016';

// The contract addresses are from the official DBK L1/L2 contracts documentation.
// A custom OP Stack chain must provide L1 contracts or viem could query OP Mainnet by mistake.
export const dbkChain=defineChain({
  ...chainConfig,
  id:20240603,sourceId:1,name:'DBK Chain',
  nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
  rpcUrls:{default:{http:['https://rpc.mainnet.dbkchain.io/']}},
  blockExplorers:{default:{name:'DBK Scan',url:'https://scan.dbkchain.io'}},
  contracts:{
    ...chainConfig.contracts,
    portal:{1:{address:PORTAL}},
    l2OutputOracle:{1:{address:OUTPUT_ORACLE}},
    l1StandardBridge:{1:{address:'0x28f1b9F457CB51E0af56dff1d11CD6CEdFfD1977'}}
  }
});

const stageError=(code)=>Object.assign(new Error(code),{code});
const statusMap={
  'waiting-to-prove':'STATE_ROOT_NOT_PUBLISHED',
  'ready-to-prove':'READY_TO_PROVE',
  'waiting-to-finalize':'IN_CHALLENGE_PERIOD',
  'ready-to-finalize':'READY_FOR_RELAY',
  'finalized':'RELAYED'
};
const finalizedAbi=[{type:'function',name:'finalizedWithdrawals',stateMutability:'view',
  inputs:[{name:'hash',type:'bytes32'}],outputs:[{name:'finalized',type:'bool'}]}];

export async function inspectWithdrawalViem(hash,address){
  const wallet=address.toLowerCase();
  let l2Source,l1Source;
  try {
    [l2Source,l1Source]=await Promise.all([resolveDbkRpc(),resolveEthRpc()]);
  }catch{throw stageError('RPC_VERIFICATION_UNAVAILABLE');}
  const l2=createPublicClient({chain:dbkChain,transport:http(l2Source.result._url,{timeout:15000,retryCount:0})});
  const l1=createPublicClient({chain:mainnet,transport:http(l1Source.result._url,{timeout:15000,retryCount:0})});
  let tx,receipt;
  try{
    [tx,receipt]=await Promise.all([
      l2.getTransaction({hash}),l2.getTransactionReceipt({hash})
    ]);
  }catch{throw stageError('DBK_TRANSACTION_UNAVAILABLE');}
  if(!tx || !receipt || receipt.status!=='success')throw stageError('WITHDRAWAL_TRANSACTION_NOT_SUCCESSFUL');
  if(tx.from.toLowerCase()!==wallet)throw stageError('WALLET_MISMATCH');
  // Reject lookalike events from other contracts. Only the canonical L2 predeploy is allowed.
  const permittedLogs=receipt.logs.filter(log=>log.address.toLowerCase()===MESSAGE_PASSER.toLowerCase());
  let list;
  try{list=getWithdrawals({logs:permittedLogs});}
  catch{throw stageError('WITHDRAWAL_EVENT_DECODE_FAILED');}
  if(list.length!==1)throw stageError('EXPECTED_ONE_MESSAGE_PASSED_EVENT');
  const withdrawal=list[0];
  const encoded=encodeAbiParameters([
    {type:'uint256'},{type:'address'},{type:'address'},{type:'uint256'},{type:'uint256'},{type:'bytes'}
  ],[withdrawal.nonce,withdrawal.sender,withdrawal.target,withdrawal.value,withdrawal.gasLimit,withdrawal.data]);
  if(keccak256(encoded).toLowerCase()!==withdrawal.withdrawalHash.toLowerCase()){
    throw stageError('WITHDRAWAL_HASH_MISMATCH');
  }
  const recipientIsWallet=isAddressEqual(withdrawal.target,address);
  const base={
    hash,amount:formatEther(withdrawal.value),
    withdrawalHash:withdrawal.withdrawalHash,
    recipient:withdrawal.target,
    sender:withdrawal.sender,
    recipientIsWallet,
    source:'DBK MessagePassed',
    sourceVerified:true,
    blockNumber:receipt.blockNumber.toString(),
    status:'STATUS_UNVERIFIED',
    readyToProve:false,readyToFinalize:false,
    explanation:'MessagePassed was verified, but L1 claimability is not yet confirmed.'
  };
  // Direct confirmation on portal takes priority. No false "ready" status from explorer heuristics.
  try{
    const final=await l1.readContract({address:PORTAL,abi:finalizedAbi,functionName:'finalizedWithdrawals',
      args:[withdrawal.withdrawalHash]});
    if(final) return {...base,status:'RELAYED',explanation:'OptimismPortal marks this withdrawal as finalized.'};
  }catch{/* An incompatible portal ABI never triggers action. */}

  try{
    const status=await getWithdrawalStatus(l1,{receipt:{...receipt,logs:permittedLogs},targetChain:dbkChain});
    const normalized=statusMap[status];
    if(!normalized) return {...base,statusReasonCode:'UNRECOGNIZED_PORTAL_STATUS'};
    return {
      ...base,
      status:normalized,
      readyToProve:normalized==='READY_TO_PROVE' && recipientIsWallet,
      readyToFinalize:normalized==='READY_FOR_RELAY' && recipientIsWallet,
      explanation:recipientIsWallet?'OP Stack status verified on Ethereum. Review gas and contract before signing.':'The withdrawal recipient differs from the connected wallet. Signing actions disabled.'
    };
  }catch{
    return {...base,statusReasonCode:'PORTAL_STATUS_UNAVAILABLE',
      explanation:'Withdrawal event verified on DBK, but the portal status could not be established. No action is available.'};
  }
}
