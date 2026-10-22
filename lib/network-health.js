import { ethers } from 'ethers';

export const DBK_PORTAL='0x63CA00232F471bE2A3Bf3C4e95Bc1d2B3EA5DB92';
export const DBK_OUTPUT_ORACLE='0x0341bb689CB8a4c16c61307F4BdA254E1bFD525e';
export const NETWORKS={
  zkcandy:{chainId:320,name:'ZK candy',rpcs:[
    {label:'Official ZKcandy',url:process.env.ZKCANDY_RPC_URL||'https://rpc.zkcandy.io'},
    {label:'thirdweb',url:'https://320.rpc.thirdweb.com'}]},
  dbk:{chainId:20240603,name:'DBK Chain',rpcs:[
    {label:'Official DBK',url:process.env.DBK_RPC_URL||'https://rpc.mainnet.dbkchain.io/'},
    {label:'thirdweb',url:'https://20240603.rpc.thirdweb.com'},
    {label:'RouteMesh',url:'https://lb.routeme.sh/rpc/evm/20240603'}]},
  ethereum:{chainId:1,name:'Ethereum',rpcs:[
    {label:'Configured Ethereum',url:process.env.ETHEREUM_RPC_URL},
    {label:'PublicNode',url:'https://ethereum-rpc.publicnode.com'},
    {label:'NodeConnect',url:'https://eth.nodeconnect.org'},
    {label:'LlamaRPC',url:'https://eth.llamarpc.com'}]}
};
const safeError=e=>String(e?.message||'No response').slice(0,120).replace(/https?:\/\/\S+/g,'[RPC]');
export async function jsonRpc(url,method,params=[],timeoutMs=5500){
  const ctrl=new AbortController();
  const id=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const response=await fetch(url,{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:ctrl.signal});
    if(!response.ok)throw Error('HTTP '+response.status);
    const body=await response.json();
    if(body.error)throw Error(body.error.message||'RPC error');
    if(body.result===undefined||body.result===null)throw Error('Empty RPC result');
    return body.result;
  }finally{clearTimeout(id)}
}
function candidates(key){
 const seen=new Set();
 return NETWORKS[key].rpcs.filter(x=>{
  if(!x.url||!/^https:\/\//i.test(x.url)||seen.has(x.url))return false;
  seen.add(x.url);return true;
 });
}
export async function checkNetwork(key){
 const network=NETWORKS[key];
 if(!network)throw Error('Unsupported network');
 const checks=await Promise.all(candidates(key).map(async candidate=>{
  try{
    const chain=Number(BigInt(await jsonRpc(candidate.url,'eth_chainId')));
    if(chain!==network.chainId)throw Error('Wrong chain ID');
    const latest=await jsonRpc(candidate.url,'eth_getBlockByNumber',['latest',false]);
    if(!latest?.number||!latest?.timestamp)throw Error('Latest block unavailable');
    const block=Number(BigInt(latest.number)),timestamp=Number(BigInt(latest.timestamp));
    if(!Number.isSafeInteger(block)||!Number.isFinite(timestamp))throw Error('Invalid block');
    const age=Math.max(0,Math.floor(Date.now()/1000)-timestamp);
    const isFresh=age<=600;
    return {label:candidate.label,url:candidate.url,online:true,block,blockTimestamp:timestamp,blockAgeSeconds:age,fresh:isFresh};
  }catch(e){return {label:candidate.label,online:false,error:safeError(e)}}
 }));
 const selected=checks.find(x=>x.online&&x.fresh)||checks.find(x=>x.online);
 return {chainId:network.chainId,chainName:network.name,online:!!selected,fresh:!!selected?.fresh,
  selectedRpc:selected?.label||null,latestBlock:selected?.block??null,
  blockTimestamp:selected?.blockTimestamp??null,blockAgeSeconds:selected?.blockAgeSeconds??null,
  checks:checks.map(({label,online,error,block,blockAgeSeconds,fresh})=>({label,online,error,block,blockAgeSeconds,fresh})) ,
  _url:selected?.url||null};
}
export async function getNetworkRpc(key){
 const s=await checkNetwork(key);
 if(!s.online)throw Error(key.toUpperCase()+'_RPC_UNAVAILABLE');
 if(key==='dbk'&&!s.fresh)throw Error('DBK_CHAIN_STALE');
 return s._url;
}
export async function checkDbkExitContracts(ethereum){
 const data={portalCode:false,outputOracleCode:false,latestOutputIndex:null,readiness:'unverified'};
 if(!ethereum?._url)return data;
 try{
  const [portal,oracle]=await Promise.all([
    jsonRpc(ethereum._url,'eth_getCode',[DBK_PORTAL,'latest']),
    jsonRpc(ethereum._url,'eth_getCode',[DBK_OUTPUT_ORACLE,'latest'])
  ]);
  data.portalCode=typeof portal==='string'&&portal.length>2;
  data.outputOracleCode=typeof oracle==='string'&&oracle.length>2;
  if(data.portalCode&&data.outputOracleCode){
    const iface=new ethers.Interface(['function latestOutputIndex() view returns(uint256)']);
    try{
      const index=await jsonRpc(ethereum._url,'eth_call',[{to:DBK_OUTPUT_ORACLE,data:iface.encodeFunctionData('latestOutputIndex')},'latest']);
      data.latestOutputIndex=iface.decodeFunctionResult('latestOutputIndex',index)[0].toString();
    }catch(_){data.outputOracleWarning='Output index query unavailable';}
    data.readiness=data.latestOutputIndex===null?'contracts-present-oracle-unknown':'contracts-present-output-index-readable';
  }
 }catch(e){data.warning=safeError(e)}
 return data;
}
export async function getAllNetworks(){
 const [zkcandy,dbk,ethereum]=await Promise.all(['zkcandy','dbk','ethereum'].map(checkNetwork));
 const dbkExit=await checkDbkExitContracts(ethereum);
 const strip=({ _url,...rest})=>rest;
 return {ok:true,checkedAt:new Date().toISOString(),zkcandy:strip(zkcandy),dbk:strip(dbk),ethereum:strip(ethereum),dbkExit,
   bridgeReady:false,notice:'Network connectivity and contract presence do NOT establish a working bridge or claimable withdrawal.'};
}
