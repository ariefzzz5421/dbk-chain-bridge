import { NextResponse } from 'next/server';
import { inspectWithdrawalViem } from '../../../lib/withdrawal';
import { prepareVerifiedRecovery } from '../../../lib/recovery-actions';
import { readFinalizationEvidence } from '../../../lib/finalization';
import { getHealth, resolveWithdrawal, prepareL1Action, prepareNewWithdrawal, validHash, validAddress } from '../../../lib/bridge';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const json=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// Never return raw RPC/SDK exception text: ethers errors can embed private RPC API keys in the URL.
const knownSafeErrors = [
  'Valid L2 transaction hash and wallet address required.',
  'DBK transaction not found.',
  'Connected wallet is not the transaction sender.',
  'Withdrawal L2 transaction was not successful or is unconfirmed.',
  'Expected exactly one withdrawal message',
  'Withdrawal is not READY_TO_PROVE.',
  'Withdrawal is not READY_FOR_RELAY.',
  'Generated transaction target is not the documented DBK OptimismPortal.',
  'Unexpected withdrawal contract.',
  'Could not construct DBK withdrawal.',
  'Insufficient DBK ETH',
  'DBK or Ethereum RPC health check failed.',
  'Invalid address or ETH amount.',
  'Amount must be greater than 0.',
  'Unexpected transaction value',
  'Unsupported action.',
  'No verified DBK RPC can provide the historical withdrawal data required for this action.',
  'No verified Ethereum RPC available.',
  'UNSUPPORTED_RECOVERY_ACTION',
  'INVALID_DBK_WITHDRAWAL_HASH',
  'INVALID_CONNECTED_WALLET',
  'WITHDRAWAL_RECIPIENT_MISMATCH',
  'ALREADY_FINALIZED_NO_ACTION_REQUIRED',
  'NOT_READY_TO_PROVE',
  'NOT_READY_TO_FINALIZE',
  'WITHDRAWAL_NOT_VERIFIED',
  'VERIFIED_RPC_UNAVAILABLE',
  'HISTORICAL_RECEIPT_UNAVAILABLE',
  'DBK_TRANSACTION_NOT_SUCCESSFUL',
  'MESSAGE_PASSED_DECODE_FAILED',
  'AMBIGUOUS_WITHDRAWAL',
  'WITHDRAWAL_CHANGED',
  'PORTAL_VERSION_UNVERIFIED',
  'PORTAL_VERSION_NOT_SUPPORTED_FOR_PROVE',
  'OUTPUT_ROOT_NOT_AVAILABLE',
  'OUTPUT_DOES_NOT_COVER_WITHDRAWAL',
  'ARCHIVE_WITHDRAWAL_PROOF_UNAVAILABLE',
  'PROOF_WITHDRAWAL_MISMATCH',
  'ETHEREUM_SIMULATION_FAILED',
  'RPC_VERIFICATION_UNAVAILABLE',
  'DBK_TRANSACTION_UNAVAILABLE',
  'WITHDRAWAL_TRANSACTION_NOT_SUCCESSFUL',
  'WALLET_MISMATCH',
  'WITHDRAWAL_EVENT_DECODE_FAILED',
  'EXPECTED_ONE_MESSAGE_PASSED_EVENT',
  'WITHDRAWAL_HASH_MISMATCH'
];
const fail=(e)=>{
  const message=String(e?.message||'');
  const safe=knownSafeErrors.some(prefix=>message.startsWith(prefix)) ? message.slice(0,250) :
    'RPC or bridge request failed. Check the RPC provider and transaction status. No transaction was broadcast by this endpoint.';
  return json({ok:false,error:safe},400);
};
export async function GET(request) {
  const url=new URL(request.url);
  const mode=url.searchParams.get('mode');
  try {
    if(mode==='health') return json({ok:true,health:await getHealth()});
    if(mode==='execution'){
      const hash=url.searchParams.get('hash')||'';
      const address=url.searchParams.get('address')||'';
      if(!validHash(hash)||!validAddress(address))return json({ok:false,error:'Invalid tx hash / address'},400);
      const withdrawal=await inspectWithdrawalViem(hash,address);
      if(withdrawal.status!=='RELAYED')return json({ok:true,finalizedOnL1:false,success:null,reason:'WITHDRAWAL_NOT_FINALIZED'});
      const evidence=await readFinalizationEvidence(withdrawal.withdrawalHash);
      return json({ok:true,finalizedOnL1:true,...evidence});
    }
    if(mode!=='status') return json({ok:false,error:'Invalid operation'},400);
    const hash=url.searchParams.get('hash')||'';
    const address=url.searchParams.get('address')||'';
    if(!validHash(hash)||!validAddress(address)) return json({ok:false,error:'Invalid tx hash / address'},400);
    const r=await inspectWithdrawalViem(hash,address);
    return json({ok:true,...r});
  }catch(e){return fail(e);}
}
export async function POST(request) {
  try{
    const body=await request.json();
    if(body?.action==='start')return json({ok:false,error:'New DBK withdrawals are disabled. Use an existing withdrawal transaction.'},409);
    if(!['prove','finalize'].includes(body?.action))return json({ok:false,error:'Unsupported operation'},400);
    if(!validHash(body?.hash)||!validAddress(body?.address))return json({ok:false,error:'Invalid tx hash / address'},400);
    const transaction=await prepareVerifiedRecovery({
      hash:body.hash,address:body.address,action:body.action
    });
    return json({ok:true,transaction});
  }catch(e){return fail(e);}
}
