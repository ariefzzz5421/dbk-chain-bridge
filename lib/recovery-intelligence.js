import { ethers } from 'ethers';
import { NETWORKS, checkNetwork, jsonRpc } from './network-health';
const PASSER='0x4200000000000000000000000000000000000016';
const EVENT=ethers.id('MessagePassed(uint256,address,address,uint256,uint256,bytes,bytes32)');
const ZERO='0x0000000000000000000000000000000000000000';
const hex=n=>'0x'+n.toString(16);
const safe=o=>typeof o==='string'?o.slice(0,120):'Unavailable';

const relayCache={until:0,data:null};
export async function relaySupport(){
 if(relayCache.until>Date.now()&&relayCache.data)return relayCache.data;
 try{
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),7000);
  let res;try{res=await fetch('https://api.relay.link/chains',{cache:'no-store',signal:abort.signal,headers:{accept:'application/json'}})}finally{clearTimeout(timer)}
  if(!res.ok)throw Error('Relay HTTP '+res.status);
  const json=await res.json();
  if(!Array.isArray(json.chains))throw Error('Unexpected Relay chain list');
  const wanted={zkcandy:320,dbk:20240603};
  const chains={};
  for(const [key,id] of Object.entries(wanted)){
   const c=json.chains.find(x=>Number(x.id)===id);
   // Chain presence is only the first level. An actual executable quote still needs an eligible currency and supported route.
   chains[key]={listed:!!c,depositEnabled:!!c?.depositEnabled,disabled:c?.disabled!==false,ethSupportsBridging:c?.currency?.symbol==='ETH'&&c.currency?.supportsBridging===true,
    eligible:!!c&&c.disabled===false&&c.depositEnabled===true&&c.currency?.symbol==='ETH'&&c.currency.supportsBridging===true};
  }
  const value={available:true,queriedAt:new Date().toISOString(),chains,chainCount:json.chains.length,
    destinationEthereum:json.chains.some(c=>Number(c.id)===1&&c.disabled===false)};
  relayCache.data=value;relayCache.until=Date.now()+120000;return value;
 }catch(e){
  // Fail closed. Never infer "unsupported" from a failed provider request.
  return {available:false,queriedAt:new Date().toISOString(),chains:null,error:'RELAY_DIRECTORY_UNAVAILABLE'};
 }
}
async function tokenDiscovery(rpc,address,chain){
 // Do not claim broad ERC20 portfolio coverage without a trusted token registry or indexer.
 // Only probe optional curated candidates supplied by Relay itself for supported chains.
 return {assets:[],complete:false,reason:chain==='zkcandy'
   ?'Token indexer unavailable; only native ETH can be reliably queried from a working RPC.'
   :'Token balances require a verified token registry/indexer. Native ETH scan is independent.'};
}
async function recentDbkMessages(rpc,address,tip){
 const result={candidates:[],scannedBlocks:0,complete:false,reason:null};
 if(!rpc||!Number.isSafeInteger(tip))return {...result,reason:'DBK RPC unavailable'};
 // Recent logs: sender is indexed topic[2]. Limited time window, no claim of comprehensive account history.
 const from=Math.max(0,tip-3200),topic='0x'+address.toLowerCase().slice(2).padStart(64,'0');
 const logResults=[];
 try{
  for(let end=tip;end>=from;end-=400){
   const start=Math.max(from,end-399);
   const logs=await jsonRpc(rpc,'eth_getLogs',[{address:PASSER,fromBlock:hex(start),toBlock:hex(end),topics:[EVENT,null,topic]}],4000);
   if(!Array.isArray(logs))throw Error('Invalid event response');
   logResults.push(...logs.slice(0,40));
   result.scannedBlocks+=end-start+1;
   if(logResults.length>=20)break;
  }
  const iface=new ethers.Interface(['event MessagePassed(uint256 indexed nonce,address indexed sender,address indexed target,uint256 value,uint256 gasLimit,bytes data,bytes32 withdrawalHash)']);
  result.candidates=logResults.slice(0,20).flatMap(log=>{
   try{
    const data=iface.parseLog({topics:log.topics,data:log.data});
    const direct=data?.args?.target?.toLowerCase()===address.toLowerCase()&&data?.args?.data==='0x'&&data?.args?.value>0n;
    if(!direct)return [];
    return [{hash:log.transactionHash,amount:ethers.formatEther(data.args.value),blockNumber:Number(BigInt(log.blockNumber)),
     status:'UNVERIFIED_CANDIDATE',route:'direct',source:'Indexed DBK MessagePassed event'}];
   }catch{return []}
  });
  result.reason='Only recent blocks scanned; use a known historical transaction hash to inspect older withdrawals. Every candidate must be verified on L1 before claiming.';
 }catch(e){result.reason='Log index unavailable/rate-limited; discovery is partial. Known hashes can still be inspected.'}
 return result;
}
export async function portfolio(address){
 if(!ethers.isAddress(address))throw Error('INVALID_ADDRESS');
 const [zk,dbk,relay]=await Promise.all([checkNetwork('zkcandy'),checkNetwork('dbk'),relaySupport()]);
 const checks={zkcandy:zk,dbk};
 const detail={};
 await Promise.all(Object.entries(checks).map(async ([key,n])=>{
  const entry={name:NETWORKS[key].name,chainId:NETWORKS[key].chainId,networkOnline:n.online,networkFresh:n.fresh,block:n.latestBlock,
    eth:{state:n.online?'checking':'unknown',balance:null,symbol:'ETH'},tokens:{assets:[],complete:false},exit:{kind:key==='dbk'?'OP_STACK':'ZK_STACK',
      status:'NOT_VERIFIED',reason:'L1 settlement and proofs must be verified before exit.'}};
  if(n.online){
   try{
    const balance=await jsonRpc(n._url,'eth_getBalance',[address,'latest'],7000);
    entry.eth={state:'verified',balance:ethers.formatEther(BigInt(balance)),symbol:'ETH'};
   }catch{entry.eth={state:'unknown',balance:null,symbol:'ETH'}}
   entry.tokens=await tokenDiscovery(n._url,address,key);
  }
  if(key==='dbk'){
   entry.discovery=n.online&&n.fresh?await recentDbkMessages(n._url,address,n.latestBlock):
      {candidates:[],complete:false,reason:'Fresh DBK RPC unavailable',scannedBlocks:0};
  }
  entry.relay=relay.available?relay.chains?.[key]||null:null;
  detail[key]=entry;
 }));
 return {ok:true,address:ethers.getAddress(address),checkedAt:new Date().toISOString(),chains:detail,relay,
   notice:'ETH and recent DBK withdrawal detection are read-only. Unknown balances are not zero; missing events are not evidence of no funds. Provider listing is not an executable quote.'};
}
