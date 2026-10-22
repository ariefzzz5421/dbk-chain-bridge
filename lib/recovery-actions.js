import { createPublicClient, http, encodeFunctionData, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { getWithdrawals, getL2Output, buildProveWithdrawal, getPortalVersion } from 'viem/op-stack';
import { inspectWithdrawalViem, dbkChain, PORTAL, MESSAGE_PASSER } from './withdrawal';
import { resolveDbkRpc, resolveEthRpc } from './dbk-rpc';

// Explicit ABI ensures the wallet can only sign OptimismPortal protocol calls.
// No token approvals, transfers, user-provided contract addresses, or arbitrary calldata.
const withdrawalComponents=[
  {name:'nonce',type:'uint256'},{name:'sender',type:'address'},
  {name:'target',type:'address'},{name:'value',type:'uint256'},
  {name:'gasLimit',type:'uint256'},{name:'data',type:'bytes'}
];
const outputRootComponents=[
  {name:'version',type:'bytes32'},{name:'stateRoot',type:'bytes32'},
  {name:'messagePasserStorageRoot',type:'bytes32'},{name:'latestBlockhash',type:'bytes32'}
];
const portalActions=[
  {name:'proveWithdrawalTransaction',type:'function',stateMutability:'nonpayable',
    inputs:[
      {name:'_tx',type:'tuple',components:withdrawalComponents},
      {name:'_l2OutputIndex',type:'uint256'},
      {name:'_outputRootProof',type:'tuple',components:outputRootComponents},
      {name:'_withdrawalProof',type:'bytes[]'}
    ],outputs:[]},
  {name:'finalizeWithdrawalTransaction',type:'function',stateMutability:'nonpayable',
    inputs:[{name:'_tx',type:'tuple',components:withdrawalComponents}],outputs:[]}
];
function blocked(code) { const e=new Error(code);e.code=code;throw e; }
export async function prepareVerifiedRecovery({hash,address,action}) {
  if(action!=='prove'&&action!=='finalize')blocked('UNSUPPORTED_RECOVERY_ACTION');
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash||''))blocked('INVALID_DBK_WITHDRAWAL_HASH');
  let owner;
  try{owner=getAddress(address)}catch{blocked('INVALID_CONNECTED_WALLET');}

  // All validation is repeated on each prepare and again immediately before signing.
  // The status endpoint is not a source of authority for transaction calldata.
  const status=await inspectWithdrawalViem(hash,owner);
  if(!status.sourceVerified || status.recipientIsWallet!==true)blocked('WITHDRAWAL_RECIPIENT_MISMATCH');
  if(status.status==='RELAYED')blocked('ALREADY_FINALIZED_NO_ACTION_REQUIRED');
  if(action==='prove' && status.status!=='READY_TO_PROVE')blocked('NOT_READY_TO_PROVE');
  if(action==='finalize' && status.status!=='READY_FOR_RELAY')blocked('NOT_READY_TO_FINALIZE');
  if(!status.withdrawalHash || !status.amount)blocked('WITHDRAWAL_NOT_VERIFIED');
  if(!['direct','standard-bridge-eth'].includes(status.route))
    blocked('ETH_RECEIVER_ROUTE_UNSUPPORTED');

  let l1Info,l2Info;
  try{[l1Info,l2Info]=await Promise.all([resolveEthRpc(),resolveDbkRpc()]);}
  catch{blocked('VERIFIED_RPC_UNAVAILABLE');}
  const l1=createPublicClient({chain:mainnet,transport:http(l1Info.result._url,{timeout:15000,retryCount:0})});
  const l2=createPublicClient({chain:dbkChain,transport:http(l2Info.result._url,{timeout:15000,retryCount:0})});

  let receipt;
  try {receipt=await l2.getTransactionReceipt({hash});}
  catch{blocked('HISTORICAL_RECEIPT_UNAVAILABLE');}
  if(receipt?.status!=='success')blocked('DBK_TRANSACTION_NOT_SUCCESSFUL');

  const permitted=receipt.logs.filter(l=>l.address.toLowerCase()===MESSAGE_PASSER.toLowerCase());
  let withdrawals;
  try {withdrawals=getWithdrawals({logs:permitted});}
  catch{blocked('MESSAGE_PASSED_DECODE_FAILED');}
  if(withdrawals.length!==1)blocked('AMBIGUOUS_WITHDRAWAL');
  const withdrawal=withdrawals[0];
  if(withdrawal.withdrawalHash.toLowerCase()!==status.withdrawalHash.toLowerCase() ||
     withdrawal.target.toLowerCase()!==status.destinationContract?.toLowerCase() ||
     !status.recipientIsWallet || !['direct','standard-bridge-eth'].includes(status.route))
    blocked('WITHDRAWAL_CHANGED');

  let data, method;
  if(action==='finalize'){
    method='finalizeWithdrawalTransaction';
    data=encodeFunctionData({abi:portalActions,functionName:method,args:[withdrawal]});
  }else{
    // DBK is currently configured via the legacy L2 Output Oracle.
    // A future Portal v3+ upgrade must be audited separately, never silently
    // misinterpreted as the legacy proof format.
    let version;
    try{
      version=await getPortalVersion(l1,{targetChain:dbkChain,portalAddress:PORTAL});
    }catch{blocked('PORTAL_VERSION_UNVERIFIED');}
    if(version.major!==2)blocked('PORTAL_VERSION_NOT_SUPPORTED_FOR_PROVE');

    let output;
    try{
      output=await getL2Output(l1,{
        l2BlockNumber:receipt.blockNumber,
        targetChain:dbkChain,
        portalAddress:PORTAL,
        l2OutputOracleAddress:dbkChain.contracts.l2OutputOracle[1].address
      });
    }catch{blocked('OUTPUT_ROOT_NOT_AVAILABLE');}
    if(output.l2BlockNumber<receipt.blockNumber)blocked('OUTPUT_DOES_NOT_COVER_WITHDRAWAL');
    let args;
    try { args=await buildProveWithdrawal(l2,{account:owner,output,withdrawal});}
    catch{blocked('ARCHIVE_WITHDRAWAL_PROOF_UNAVAILABLE');}
    if(args.withdrawal.withdrawalHash.toLowerCase()!==status.withdrawalHash.toLowerCase())blocked('PROOF_WITHDRAWAL_MISMATCH');

    method='proveWithdrawalTransaction';
    data=encodeFunctionData({
      abi:portalActions,functionName:method,
      args:[args.withdrawal,args.l2OutputIndex,args.outputRootProof,args.withdrawalProof]
    });
  }

  // A reverting eth_call or estimateGas is a hard stop, not a warning.
  // Neither command broadcasts a transaction or spends user funds.
  try {
    await l1.call({account:owner,to:PORTAL,data,value:0n});
    await l1.estimateGas({account:owner,to:PORTAL,data,value:0n});
  }catch{blocked('ETHEREUM_SIMULATION_FAILED');}

  return {
    action,chainId:1,to:PORTAL,data,value:'0x0',
    sourceTxHash:hash,withdrawalHash:status.withdrawalHash,
    amount:status.amount,recipient:status.recipient,
    method,simulated:true
  };
}
