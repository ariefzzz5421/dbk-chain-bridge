import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { checkNetwork, jsonRpc } from '../../../lib/network-health';
import { POST as dbkPost, GET as dbkGet } from '../dbk/route';
import { POST as zkPost, GET as zkGet } from '../zkcandy/route';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const chains={dbk:20240603,zkcandy:320};
const isHash=x=>/^0x[a-fA-F0-9]{64}$/.test(x||'');
const reply=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const errCode=x=>String(x||'UNAVAILABLE').replace(/[^A-Z0-9_]/gi,'_').slice(0,100);
const messages={
  ZKCANDY_RPC_UNAVAILABLE:'ZKcandy is not responding. Your funds cannot be verified right now.',
  NO_RECENT_VERIFIED_ETHEREUM_BATCH_EXECUTION:'ZKcandy has no recently verified Ethereum settlement. New withdrawals are paused.',
  DBK_L1_OUTPUT_STALE_OR_UNVERIFIED:'DBK settlement data is too old to safely start a new withdrawal.',
  DBK_RPC_OR_LATEST_BLOCK_UNAVAILABLE:'DBK network data is unavailable. Try again later.',
  ETHEREUM_RPC_UNAVAILABLE:'Ethereum verification is unavailable. No transaction was sent.',
  INSUFFICIENT_DBK_ETH_FOR_GAS:'Not enough ETH on DBK to cover the amount and gas.',
  INSUFFICIENT_DBK_ETH_INCLUDING_GAS:'Leave more ETH in your wallet to cover the network fee.',
  INSUFFICIENT_BALANCE_AND_GAS:'Not enough ETH to cover your withdrawal and network fee.',
  INSUFFICIENT_BALANCE_INCLUDING_GAS:'Leave more ETH for transaction fees.',
  DBK_WITHDRAWAL_SIMULATION_FAILED:'DBK could not simulate a safe withdrawal. Nothing was submitted.',
  ETHEREUM_SIMULATION_FAILED:'Ethereum rejected the finalization simulation. Nothing was sent.',
  WALLET_MISMATCH:'This withdrawal does not belong to your connected wallet.',
  INVALID_L2_WITHDRAWAL_HASH:'Enter a valid withdrawal transaction hash.',
  INVALID_TX_HASH:'Enter a valid withdrawal transaction hash.',
  WITHDRAWAL_NOT_FOUND_OR_FAILED:'Withdrawal has not been confirmed or cannot be found.',
  WITHDRAWAL_TRANSACTION_NOT_SUCCESSFUL:'This transaction is not a confirmed withdrawal.'
};
function pretty(code){return messages[code]||'The network could not verify this operation. No transaction was sent.'}
async function invoke(handler,method,url,body){
 const r=new Request(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const res=await handler(r);
 const data=await res.json();
 return {ok:res.ok&&data.ok!==false,status:res.status,data};
}
function mapStatus(chain,value){
 if(chain==='dbk'){
  const key=value.status;
  const state={
   RELAYED:['completed','Withdrawal finalized on Ethereum.'],
   READY_TO_PROVE:['prove','Your withdrawal is ready for Ethereum proof.'],
   IN_CHALLENGE_PERIOD:['waiting','Proof submitted. Waiting for the challenge period.'],
   READY_FOR_RELAY:['finalize','Your withdrawal is ready to be claimed on Ethereum.'],
   STATE_ROOT_NOT_PUBLISHED:['waiting','Waiting for DBK to publish its Ethereum state.']
  }[key]||['unverified','We could not verify the Ethereum withdrawal stage.'];
  return {stage:state[0],message:state[1],amount:value.amount||null,hash:value.hash,canAct:!!value.recipientIsWallet&&(state[0]==='prove'||state[0]==='finalize'),statusCode:key};
 }
 const ready=!!value.executed&&!!value.proofAvailable;
 return {stage:ready?'finalize':'waiting',message:ready?'Withdrawal proof is available. Finalize on Ethereum.':'Waiting for ZKcandy proof and Ethereum execution.',amount:value.amount||null,hash:value.hash,canAct:ready,statusCode:ready?'PROOF_AVAILABLE':'AWAITING_PROOF'};
}
export async function GET(req){
 const q=new URL(req.url).searchParams;
 const address=q.get('address'),mode=q.get('mode')||'balances';
 if(!ethers.isAddress(address||''))return reply({ok:false,error:'INVALID_PUBLIC_ADDRESS',message:'Connect a wallet to continue.'},400);
 if(mode==='balances'){
  const data=await Promise.all(Object.keys(chains).map(async chain=>{
   let n;
   try{n=await checkNetwork(chain)}catch{n={online:false}}
   if(!n.online||!n.fresh)return [chain,{state:'unknown',balance:null,message:'Network unavailable'}];
   try{
    const wei=await jsonRpc(n._url,'eth_getBalance',[address,'latest']);
    return [chain,{state:'verified',balance:ethers.formatEther(BigInt(wei)),message:'Balance verified'}];
   }catch{return [chain,{state:'unknown',balance:null,message:'Balance unavailable'}]}
  }));
  return reply({ok:true,address:ethers.getAddress(address),balances:Object.fromEntries(data),asset:'ETH'});
 }
 if(mode!=='status')return reply({ok:false,error:'INVALID_MODE'},400);
 const chain=q.get('chain'),hash=q.get('hash');
 if(!chains[chain]||!isHash(hash))return reply({ok:false,error:'INVALID_CHAIN_OR_HASH'},400);
 const endpoint='https://local.internal/api/'+chain+'?mode=status&address='+encodeURIComponent(address)+'&hash='+encodeURIComponent(hash);
 const r=await invoke(chain==='dbk'?dbkGet:zkGet,'GET',endpoint);
 if(!r.ok)return reply({ok:false,error:errCode(r.data.error),message:pretty(r.data.error)},r.status);
 return reply({ok:true,chain,...mapStatus(chain,r.data),source:r.data});
}
export async function POST(req){
 let body;
 try{body=await req.json()}catch{return reply({ok:false,message:'Invalid request.'},400)}
 const {action,chain,address,amount,hash}=body||{};
 if(!ethers.isAddress(address||'')||!chains[chain])return reply({ok:false,message:'Invalid wallet or source network.'},400);
 if(action==='quote'){
  if(typeof amount!=='string'||!/^\d+(\.\d{1,18})?$/.test(amount)||ethers.parseEther(amount)<=0n)
   return reply({ok:false,message:'Enter a valid ETH amount.'},400);
  const handler=chain==='dbk'?dbkPost:zkPost;
  const endpoint='https://local.internal/api/'+chain;
  const payload=chain==='dbk'?{action:'prepareStart',address,amount}:{action:'prepareETH',address,amount};
  const result=await invoke(handler,'POST',endpoint,payload);
  if(!result.ok)return reply({ok:false,error:errCode(result.data.error),message:pretty(result.data.error)},result.status);
  return reply({ok:true,chain,transaction:result.data.transaction,preflight:result.data.preflight||null,
   route:'Native '+(chain==='dbk'?'OP Stack':'ZK Stack'),
   message:'Native withdrawal to your Ethereum wallet. Final claim is a separate on-chain step; completion is not guaranteed.'});
 }
 if(action==='complete'&&chain==='dbk'){
  if(!isHash(hash)||!['prove','finalize'].includes(body.step))return reply({ok:false,message:'Invalid withdrawal or claim stage.'},400);
  const result=await invoke(dbkPost,'POST','https://local.internal/api/dbk',{action:body.step,address,hash});
  if(!result.ok)return reply({ok:false,error:errCode(result.data.error),message:pretty(result.data.error)},result.status);
  return reply({ok:true,transaction:result.data.transaction});
 }
 return reply({ok:false,message:'Unsupported operation.'},400);
}
