import { ethers } from 'ethers';

// Every candidate is pinned: no arbitrary external URLs from user input.
// This list includes advertised endpoints, not a guarantee of service.
const DBK_TX='0x5d15ea4a8ba70b021f2e7231a76e9823f6d74646d4924570e99417321ba37f9e';
const PASSER='0x4200000000000000000000000000000000000016';
const PORTAL='0x63CA00232F471bE2A3Bf3C4e95Bc1d2B3EA5DB92';
const MAX_MS=4800;
const cache=new Map();
const rpcLists={
  dbk:[
    {id:'Custom full DBK RPC',url:process.env.DBK_ARCHIVE_RPC_URL},
    {id:'DBK official',url:process.env.DBK_RPC_URL||'https://rpc.mainnet.dbkchain.io/'},
    {id:'Thirdweb DBK',url:'https://20240603.rpc.thirdweb.com'},
    {id:'RouteMesh DBK',url:'https://lb.routeme.sh/rpc/evm/20240603'}
  ],
  ethereum:[
    {id:'Configured Ethereum RPC',url:process.env.ETHEREUM_RPC_URL},
    {id:'PublicNode Ethereum',url:'https://ethereum-rpc.publicnode.com'},
    {id:'Llama Ethereum',url:'https://eth.llamarpc.com'}
  ]
};
const clean=(candidates)=>{
  const unique=new Set();
  return candidates.filter(x=>{
    if(!x.url || !/^https:\/\//.test(x.url))return false;
    if(unique.has(x.url))return false;
    unique.add(x.url);
    return true;
  });
};
async function rpcCall(url,method,params=[]){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),MAX_MS);
  try{
    const res=await fetch(url,{
      method:'POST',headers:{'content-type':'application/json'},cache:'no-store',
      body:JSON.stringify({id:1,jsonrpc:'2.0',method,params}),signal:controller.signal
    });
    if(!res.ok)throw Error('RPC HTTP '+res.status);
    const body=await res.json();
    if(body?.error || body?.result===undefined || body?.result===null)throw Error('RPC method unsupported or failed');
    return body.result;
  }finally{clearTimeout(timer);}
}
async function checkDBK(candidate){
  const outcome={id:candidate.id,chainVerified:false,receiptAvailable:false,proofAvailable:false,live:false,blockAgeSeconds:null,blockNumber:null};
  try{
    const id=await rpcCall(candidate.url,'eth_chainId');
    if(parseInt(id,16)!==20240603)return outcome;
    outcome.chainVerified=true;
    const [blockResult,receiptResult]=await Promise.allSettled([
      rpcCall(candidate.url,'eth_getBlockByNumber',['latest',false]),
      rpcCall(candidate.url,'eth_getTransactionReceipt',[DBK_TX])
    ]);
    if(blockResult.status==='fulfilled'){
      const block=blockResult.value;
      const number=block?.number;
      const time=block?.timestamp;
      if(typeof number==='string' && typeof time==='string'){
        outcome.blockNumber=parseInt(number,16);
        const timestamp=parseInt(time,16);
        if(Number.isFinite(timestamp) && timestamp>0){
          outcome.blockAgeSeconds=Math.max(0,Math.floor(Date.now()/1000)-timestamp);
          outcome.live=outcome.blockAgeSeconds<=7200;
        }
      }
    }
    if(receiptResult.status==='fulfilled'){
      const receipt=receiptResult.value;
      if(receipt?.transactionHash?.toLowerCase()===DBK_TX && receipt?.blockNumber){
        outcome.receiptAvailable=true;
        try{
          const proof=await rpcCall(candidate.url,'eth_getProof',[PASSER,[],receipt.blockNumber]);
          outcome.proofAvailable=Array.isArray(proof?.accountProof) && proof.accountProof.length>0;
        }catch{ /* RPC might index receipts without archive proofs */ }
      }
    }
  }catch{ /* A listed endpoint may no longer operate */ }
  return outcome;
}
async function checkEthereum(candidate){
  const outcome={id:candidate.id,ok:false,contractVerified:false};
  try{
    const id=await rpcCall(candidate.url,'eth_chainId');
    if(parseInt(id,16)!==1)return outcome;
    const code=await rpcCall(candidate.url,'eth_getCode',[PORTAL,'latest']);
    outcome.ok=typeof code==='string' && code.length>2 && code.startsWith('0x');
    outcome.contractVerified=outcome.ok;
  }catch{ /* Keep API URLs/keys out of errors and responses */ }
  return outcome;
}
async function cached(key,factory,ttl=30000){
  const found=cache.get(key);
  if(found && found.until>Date.now())return found.value;
  const p=factory();
  cache.set(key,{until:Date.now()+ttl,value:p});
  return p;
}
export async function testDbkRpcs(){
  const candidates=clean(rpcLists.dbk);
  const details=await cached('dbk',()=>Promise.all(candidates.map(checkDBK)));
  return details.map((status,index)=>({...status,_url:candidates[index].url}));
}
export async function testEthereumRpcs(){
  const candidates=clean(rpcLists.ethereum);
  const details=await cached('ethereum',()=>Promise.all(candidates.map(checkEthereum)));
  return details.map((status,index)=>({...status,_url:candidates[index].url}));
}
export async function resolveDbkRpc({needsProof=false,needsLive=false}={}){
  const checked=await testDbkRpcs();
  const result=checked.find(c=>c.chainVerified && c.receiptAvailable && (!needsProof || c.proofAvailable) && (!needsLive || c.live));
  if(!result)throw Error('No verified DBK RPC can provide the historical withdrawal data required for this action.');
  return {
    provider:new ethers.providers.StaticJsonRpcProvider({url:result._url,timeout:12000},{chainId:20240603,name:'dbk'}),
    result
  };
}
export async function resolveEthRpc(){
  const checked=await testEthereumRpcs();
  const result=checked.find(c=>c.ok);
  if(!result)throw Error('No verified Ethereum RPC available.');
  return {
    provider:new ethers.providers.StaticJsonRpcProvider({url:result._url,timeout:12000},{chainId:1,name:'homestead'}),
    result
  };
}
export async function publicNetworkDiagnostics(){
  const [dbk,eth]=await Promise.all([testDbkRpcs(),testEthereumRpcs()]);
  const bestDbk=dbk.find(c=>c.chainVerified && c.receiptAvailable)||dbk.find(c=>c.chainVerified);
  const bestEth=eth.find(c=>c.ok);
  const strip=({ _url, ...v })=>v;
  return {
    ethereum:bestEth?{ok:true,chainId:1,provider:bestEth.id,portalCode:true}:{ok:false,error:'No configured or public Ethereum RPC could verify the documented portal contract.'},
    dbk:bestDbk?{ok:bestDbk.chainVerified && bestDbk.receiptAvailable,chainId:20240603,provider:bestDbk.id,live:bestDbk.live,latestBlock:bestDbk.blockNumber,blockAgeSeconds:bestDbk.blockAgeSeconds,receiptAvailable:bestDbk.receiptAvailable,proofAvailable:bestDbk.proofAvailable,error:!bestDbk.receiptAvailable?'Only partial DBK RPC functionality was found. Historical receipts/proofs unavailable.':undefined}:{ok:false,live:false,error:'No listed DBK RPC could confirm chain ID 20240603.'},
    nodes:dbk.map(strip),
    ethNodes:eth.map(strip)
  };
}
