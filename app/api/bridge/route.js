import { NextResponse } from 'next/server';
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
  'No verified Ethereum RPC available.'
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
    if(mode!=='status') return json({ok:false,error:'Invalid operation'},400);
    const hash=url.searchParams.get('hash')||'';
    const address=url.searchParams.get('address')||'';
    if(!validHash(hash)||!validAddress(address)) return json({ok:false,error:'Invalid tx hash / address'},400);
    const r=await resolveWithdrawal(hash,address);
    return json({ok:true,status:r.statusName,sourceSender:r.txFrom,hash,readyToProve:r.statusName==='READY_TO_PROVE',readyToFinalize:r.statusName==='READY_FOR_RELAY'});
  }catch(e){return fail(e);}
}
export async function POST(request) {
  try {
    const body=await request.json();
    const action=body?.action;
    if(!['prove','finalize','start'].includes(action)) return json({ok:false,error:'Unsupported operation'},400);
    let tx;
    if(action==='start') tx=await prepareNewWithdrawal({amount:body.amount,address:body.address});
    else tx=await prepareL1Action({hash:body.hash,address:body.address,action});
    return json({ok:true,transaction:tx});
  }catch(e){return fail(e);}
}
