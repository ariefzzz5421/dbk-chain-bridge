import { createPublicClient, http, parseAbiItem, toBytes, keccak256, decodeEventLog } from 'viem';
import { mainnet } from 'viem/chains';
import { resolveEthRpc } from './rpc';
import { PORTAL } from './withdrawal';

const event=parseAbiItem('event WithdrawalFinalized(bytes32 indexed withdrawalHash, bool success)');
const signature=keccak256(toBytes('WithdrawalFinalized(bytes32,bool)'));
const api='https://eth.blockscout.com/api';
async function indexedEvent(withdrawalHash) {
  const params=new URLSearchParams({
    module:'logs',action:'getLogs',address:PORTAL,
    topic0:signature,topic1:withdrawalHash,topic0_1_opr:'and',
    fromBlock:'0',toBlock:'latest'
  });
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9500);
  try{
    const response=await fetch(api+'?'+params.toString(),{
      cache:'no-store',signal:controller.signal
    });
    if(!response.ok) return null;
    const result=await response.json();
    if(!Array.isArray(result?.result)||result.result.length!==1)return null;
    const item=result.result[0];
    if(item.address?.toLowerCase()!==PORTAL.toLowerCase())return null;
    if(item.topics?.[0]?.toLowerCase()!==signature.toLowerCase()||
       item.topics?.[1]?.toLowerCase()!==withdrawalHash.toLowerCase())return null;
    return item.transactionHash;
  }catch{return null}finally{clearTimeout(timeout);}
}
export async function readFinalizationEvidence(withdrawalHash){
  const l1Source=await resolveEthRpc();
  const client=createPublicClient({chain:mainnet,transport:http(l1Source.result._url,{timeout:12000,retryCount:0})});
  // Public explorer is used for locating a single indexed transaction. Trust only
  // Ethereum RPC transaction receipts when determining if execution succeeded.
  const foundHash=await indexedEvent(withdrawalHash);
  if(foundHash){
    try{
      const receipt=await client.getTransactionReceipt({hash:foundHash});
      if(receipt.status!=='success')return {success:false,txHash:foundHash,reason:'L1_TRANSACTION_FAILED'};
      const matches=receipt.logs.filter(log=>log.address.toLowerCase()===PORTAL.toLowerCase()
          && log.topics[0]?.toLowerCase()===signature.toLowerCase()
          && log.topics[1]?.toLowerCase()===withdrawalHash.toLowerCase());
      if(matches.length===1){
        const log=decodeEventLog({abi:[event],data:matches[0].data,topics:matches[0].topics});
        return {success:log.args.success===true,txHash:foundHash,blockNumber:receipt.blockNumber.toString()};
      }
    }catch{ /* no execution claims from explorer alone */ }
  }
  return {success:null,reason:'FINALIZATION_EVENT_NOT_INDEPENDENTLY_VERIFIED'};
}
