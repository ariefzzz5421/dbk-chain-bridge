import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { checkNetwork, jsonRpc } from '../../../lib/network-health';
import { portfolio, relaySupport } from '../../../lib/recovery-intelligence';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(value,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const ABI=new ethers.Interface([
 'function balanceOf(address) view returns (uint256)',
 'function decimals() view returns (uint8)',
 'function symbol() view returns (string)'
]);
export async function GET(request){
 const url=new URL(request.url);
 const action=url.searchParams.get('mode')||'scan';
 if(action==='relay'){
  return json({ok:true,relay:await relaySupport()});
 }
 const address=url.searchParams.get('address');
 if(!ethers.isAddress(address||''))return json({ok:false,error:'INVALID_PUBLIC_ADDRESS'},400);
 if(action==='scan'){
  try{return json(await portfolio(address))}catch{return json({ok:false,error:'SCAN_FAILED_READ_ONLY'},503)}
 }
 if(action==='erc20'){
  const chain=url.searchParams.get('chain'),token=url.searchParams.get('token');
  if(!['dbk','zkcandy'].includes(chain)||!ethers.isAddress(token||''))return json({ok:false,error:'INVALID_CHAIN_OR_TOKEN'},400);
  try{
   const c=await checkNetwork(chain);
   if(!c.online)return json({ok:true,state:'unknown',chain,token,reason:'RPC_UNAVAILABLE'});
   const code=await jsonRpc(c._url,'eth_getCode',[token,'latest']);
   if(!code||code==='0x')return json({ok:false,error:'NO_CONTRACT_CODE'},400);
   const call=async(fn,args)=>jsonRpc(c._url,'eth_call',[{to:token,data:ABI.encodeFunctionData(fn,args)},'latest']);
   const [raw,decimals,rawSymbol]=await Promise.all([call('balanceOf',[address]),call('decimals',[]),call('symbol',[])]);
   const num=Number(ABI.decodeFunctionResult('decimals',decimals)[0]);
   if(!Number.isInteger(num)||num<0||num>36)throw Error('Bad decimals');
   const sym=String(ABI.decodeFunctionResult('symbol',rawSymbol)[0]||'').slice(0,18);
   const balance=ABI.decodeFunctionResult('balanceOf',raw)[0];
   return json({ok:true,state:'verified',asset:{type:'ERC20',symbol:sym,contract:ethers.getAddress(token),
    chain,decimals:num,balance:ethers.formatUnits(balance,num)},
    note:'Read-only ERC20 balance. Token identity and L1 redemption route are NOT verified.'});
  }catch{return json({ok:true,state:'unknown',chain,token,reason:'TOKEN_RPC_CALL_FAILED_OR_NONSTANDARD'})}
 }
 return json({ok:false,error:'INVALID_MODE'},400);
}
