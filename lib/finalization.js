import { createPublicClient, http, parseAbiItem } from 'viem';
import { mainnet } from 'viem/chains';
import { resolveEthRpc } from './rpc';
import { PORTAL } from './withdrawal';
const event=parseAbiItem('event WithdrawalFinalized(bytes32 indexed withdrawalHash, bool success)');
export async function readFinalizationEvidence(withdrawalHash){
 const l1Source=await resolveEthRpc();
 const client=createPublicClient({chain:mainnet,transport:http(l1Source.result._url,{timeout:12000,retryCount:0})});
 try {
  const logs=await client.getLogs({address:PORTAL,event,args:{withdrawalHash},fromBlock:0n,toBlock:'latest'});
  if(logs.length===1)return {success:logs[0].args.success===true,txHash:logs[0].transactionHash,blockNumber:logs[0].blockNumber?.toString()};
  return {success:null,reason:logs.length?'AMBIGUOUS_FINALIZATION_LOGS':'FINALIZATION_LOG_NOT_INDEXED'};
 }catch {return {success:null,reason:'FINALIZATION_LOG_SCAN_UNAVAILABLE'};}
}