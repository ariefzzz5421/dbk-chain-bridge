import { NextResponse } from 'next/server';
import { createPublicClient, http, formatEther, isAddress } from 'viem';
import { getNetworkRpc } from '../../../lib/network-health';
import { dbkChain, inspectWithdrawalViem, PORTAL } from '../../../lib/withdrawal';
import { prepareVerifiedRecovery } from '../../../lib/recovery-actions';
import { prepareNativeDbkETH, dbkExitPreflight } from '../../../lib/dbk-native-start';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const validHash=h=>/^0x[0-9a-f]{64}$/i.test(h||'');
const whitelist=new Set([
 'RPC_VERIFICATION_UNAVAILABLE','DBK_TRANSACTION_UNAVAILABLE','WITHDRAWAL_TRANSACTION_NOT_SUCCESSFUL',
 'WALLET_MISMATCH','WITHDRAWAL_EVENT_DECODE_FAILED','EXPECTED_ONE_MESSAGE_PASSED_EVENT',
 'WITHDRAWAL_HASH_MISMATCH','UNRECOGNIZED_PORTAL_STATUS','PORTAL_STATUS_UNAVAILABLE',
 'UNSUPPORTED_RECOVERY_ACTION','INVALID_DBK_WITHDRAWAL_HASH','INVALID_CONNECTED_WALLET',
 'WITHDRAWAL_RECIPIENT_MISMATCH','ALREADY_FINALIZED_NO_ACTION_REQUIRED','NOT_READY_TO_PROVE',
 'NOT_READY_TO_FINALIZE','WITHDRAWAL_NOT_VERIFIED','VERIFIED_RPC_UNAVAILABLE',
 'HISTORICAL_RECEIPT_UNAVAILABLE','DBK_TRANSACTION_NOT_SUCCESSFUL','MESSAGE_PASSED_DECODE_FAILED',
 'AMBIGUOUS_WITHDRAWAL','WITHDRAWAL_CHANGED','PORTAL_VERSION_UNVERIFIED',
 'PORTAL_VERSION_NOT_SUPPORTED_FOR_PROVE','OUTPUT_ROOT_NOT_AVAILABLE',
 'OUTPUT_DOES_NOT_COVER_WITHDRAWAL','ARCHIVE_WITHDRAWAL_PROOF_UNAVAILABLE',
 'PROOF_WITHDRAWAL_MISMATCH','ETHEREUM_SIMULATION_FAILED','ETH_RECEIVER_ROUTE_UNSUPPORTED',
 'DBK_CHAIN_STALE','DBK_RPC_UNAVAILABLE','ETHEREUM_RPC_UNAVAILABLE',
 'DBK_RPC_OR_LATEST_BLOCK_UNAVAILABLE','DOCUMENTED_L1_CONTRACTS_NOT_VERIFIED','L1_OUTPUT_INDEX_UNAVAILABLE',
 'L1_OUTPUT_PROPOSAL_UNAVAILABLE','DBK_L1_OUTPUT_STALE_OR_UNVERIFIED','DBK_WITHDRAWAL_SIMULATION_FAILED',
 'INSUFFICIENT_DBK_ETH_FOR_GAS','INSUFFICIENT_DBK_ETH_INCLUDING_GAS','INVALID_AMOUNT_OR_WALLET','INVALID_AMOUNT'
]);
function failure(e){
 const message=String(e?.message||'');
 // Never return arbitrary RPC exception strings: providers may interpolate secret URLs.
 const code=whitelist.has(message)?message:'DBK_PROTOCOL_CHECK_FAILED';
 return json({ok:false,error:code,detail:'No transaction was broadcast. Check DBK RPC, Ethereum contracts, and withdrawal proof.'},503);
}
export async function GET(request){
 const q=new URL(request.url).searchParams;
 const mode=q.get('mode'),address=q.get('address');
 if(mode==='preflight'){
  try{
   const check=await dbkExitPreflight();
   return json({ok:true,canPrepareNewWithdrawal:true,outputAgeSeconds:check.outputAgeSeconds,
     lastL1OutputIndex:check.oracleOutputIndex,blockLag:check.blockLag,
     disclaimer:'A valid old output does not ensure future proof production, withdrawal finalization, or payout.'});
  }catch(e){
   const known=whitelist.has(String(e?.message||''))?String(e.message):'DBK_PREFLIGHT_UNAVAILABLE';
   return json({ok:true,canPrepareNewWithdrawal:false,reason:known});
  }
 }
 if(!isAddress(address||''))return json({ok:false,error:'INVALID_WALLET_ADDRESS'},400);
 try{
  if(mode==='balance'){
    const url=await getNetworkRpc('dbk');
    const client=createPublicClient({chain:dbkChain,transport:http(url,{timeout:9000,retryCount:0})});
    const value=await client.getBalance({address});
    return json({ok:true,amount:formatEther(value),network:'DBK Chain',chainId:20240603,source:'verified DBK RPC'});
  }
  if(mode==='status'){
    const hash=q.get('hash');
    if(!validHash(hash))return json({ok:false,error:'INVALID_L2_WITHDRAWAL_HASH'},400);
    return json({ok:true,...await inspectWithdrawalViem(hash,address)});
  }
  return json({ok:false,error:'INVALID_MODE'},400);
 }catch(e){return failure(e)}
}
export async function POST(request){
 try{
  const {action,hash,address,amount}=await request.json();
  if(action==='prepareStart'){
    if(!isAddress(address||''))return json({ok:false,error:'INVALID_WALLET'},400);
    return json(await prepareNativeDbkETH({address,amount}));
  }
  if(action!=='prove'&&action!=='finalize')return json({ok:false,error:'UNSUPPORTED_ACTION'},409);
  if(!validHash(hash)||!isAddress(address||''))return json({ok:false,error:'INVALID_TRANSACTION_OR_WALLET'},400);
  const transaction=await prepareVerifiedRecovery({action,hash,address});
  if(!transaction.simulated||transaction.chainId!==1||transaction.to.toLowerCase()!==PORTAL.toLowerCase()
     ||transaction.value!=='0x0'||transaction.recipient?.toLowerCase()!==address.toLowerCase())
    return json({ok:false,error:'TRANSACTION_SAFETY_CHECK_FAILED'},409);
  return json({ok:true,transaction});
 }catch(e){return failure(e)}
}
