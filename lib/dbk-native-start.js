import { ethers } from 'ethers';
import { checkNetwork, jsonRpc, DBK_PORTAL, DBK_OUTPUT_ORACLE } from './network-health';
const PASSER='0x4200000000000000000000000000000000000016';
const abi=new ethers.Interface([
 'function initiateWithdrawal(address _target,uint256 _gasLimit,bytes _data) payable',
 'function latestOutputIndex() view returns (uint256)',
 'function getL2Output(uint256) view returns (bytes32 outputRoot,uint128 timestamp,uint128 l2BlockNumber)'
]);
const GAS_LIMIT=100000n;
const err=code=>{throw Error(code)};
const clientError=e=>String(e?.message||'UNAVAILABLE').slice(0,120).replace(/https?:\/\/\S+/g,'[RPC]');
async function call(l1,fn,args=[]){
 const result=await jsonRpc(l1,'eth_call',[{to:DBK_OUTPUT_ORACLE,data:abi.encodeFunctionData(fn,args)},'latest'],8000);
 return abi.decodeFunctionResult(fn,result);
}
export async function dbkExitPreflight(){
 const [dbk,eth]=await Promise.all([checkNetwork('dbk'),checkNetwork('ethereum')]);
 if(!dbk.online||!dbk.fresh)err('DBK_RPC_OR_LATEST_BLOCK_UNAVAILABLE');
 if(!eth.online||!eth.fresh)err('ETHEREUM_RPC_UNAVAILABLE');
 const [portal,oracle]=await Promise.all([
  jsonRpc(eth._url,'eth_getCode',[DBK_PORTAL,'latest']),
  jsonRpc(eth._url,'eth_getCode',[DBK_OUTPUT_ORACLE,'latest'])
 ]);
 if(portal==='0x'||oracle==='0x')err('DOCUMENTED_L1_CONTRACTS_NOT_VERIFIED');
 let latest=0n;
 try{latest=(await call(eth._url,'latestOutputIndex'))[0]}catch{err('L1_OUTPUT_INDEX_UNAVAILABLE')}
 let output;
 try{output=await call(eth._url,'getL2Output',[latest])}catch{err('L1_OUTPUT_PROPOSAL_UNAVAILABLE')}
 const [root,timestamp,l2Block]=output;
 const lagSeconds=Math.max(0,Math.floor(Date.now()/1000)-Number(timestamp));
 const lagBlocks=Math.max(0,dbk.latestBlock-Number(l2Block));
 const nonzero=/^0x[0-9a-f]{64}$/i.test(root)&&!/^0x0{64}$/i.test(root);
 if(!nonzero||Number(l2Block)<=0||lagSeconds>86400||lagBlocks>90000)
  err('DBK_L1_OUTPUT_STALE_OR_UNVERIFIED');
 return {dbkUrl:dbk._url,ethUrl:eth._url,oracleOutputIndex:latest.toString(),
  outputBlockNumber:Number(l2Block),outputAgeSeconds:lagSeconds,l2Head:dbk.latestBlock,blockLag:lagBlocks};
}
export async function prepareNativeDbkETH({address,amount}){
 if(!ethers.isAddress(address||'')||typeof amount!=='string'||!/^\d+(\.\d{1,18})?$/.test(amount))err('INVALID_AMOUNT_OR_WALLET');
 const wei=ethers.parseEther(amount);
 if(wei<=0n)err('INVALID_AMOUNT');
 const ready=await dbkExitPreflight();
 const raw=await jsonRpc(ready.dbkUrl,'eth_getBalance',[address,'latest']);
 const balance=BigInt(raw);
 if(balance<=wei)err('INSUFFICIENT_DBK_ETH_FOR_GAS');
 const data=abi.encodeFunctionData('initiateWithdrawal',[address,GAS_LIMIT,'0x']);
 const transaction={from:ethers.getAddress(address),to:PASSER,value:ethers.toBeHex(wei),data};
 let estimate;
 try{
  // Only read-only simulation and estimate. A revert disables the transaction.
  await jsonRpc(ready.dbkUrl,'eth_call',[transaction,'latest']);
  estimate=BigInt(await jsonRpc(ready.dbkUrl,'eth_estimateGas',[transaction]));
 }catch{err('DBK_WITHDRAWAL_SIMULATION_FAILED')}
 const gasPrice=BigInt(await jsonRpc(ready.dbkUrl,'eth_gasPrice'));
 // Extra gas headroom for fluctuations.
 if(balance<wei+estimate*gasPrice*2n)err('INSUFFICIENT_DBK_ETH_INCLUDING_GAS');
 return {ok:true,transaction:{...transaction,chainId:20240603,amount,recipient:ethers.getAddress(address),
   action:'start',gasEstimate:estimate.toString(),gasPrice:gasPrice.toString(),
   functionName:'initiateWithdrawal',gasLimit:GAS_LIMIT.toString(),l1Status:'NOT_YET_FINALIZED'},
   preflight:{latestL1OutputIndex:ready.oracleOutputIndex,outputAgeSeconds:ready.outputAgeSeconds,blockLag:ready.blockLag},
   warning:'The withdrawal may become stuck if the operator stops producing proofs after you sign. Starting on L2 does not guarantee receipt of funds on Ethereum.'};
}
