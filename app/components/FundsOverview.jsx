'use client';
import {useCallback,useEffect,useState} from 'react';
import {ArrowRight,ArrowUpRight,Activity,Wallet,RefreshCcw,AlertTriangle,CheckCircle2,Search,ExternalLink,ShieldCheck,Info} from 'lucide-react';

const fmt=x=>x==null?'Unknown':Number(x)===0?'0 ETH':Number(x).toLocaleString('en-US',{maximumFractionDigits:9})+' ETH';
const short=x=>x?x.slice(0,9)+'…'+x.slice(-7):'—';
const SOURCES=[{key:'zkcandy',name:'ZK candy',chain:'320',layer:'ZK Stack',explorer:'https://explorer.zkcandy.io'},
  {key:'dbk',name:'DBK Chain',chain:'20240603',layer:'OP Stack',explorer:'https://scan.dbkchain.io'}];
function AssetBadge(){return <span className="asset-eth"><svg width="14" height="22" viewBox="0 0 256 417"><path fill="#a4b3fa" d="M127.9 0 125.1 9.5v269.7l2.8 2.8 127.9-75.6z"/><path fill="#6378d7" d="M127.9 0 0 206.4 127.9 282V154.1z"/><path fill="#5370bd" d="m127.9 306.2-2.8 3.4v105.1l2.8 2.2L255.9 230z"/><path fill="#9daffc" d="M127.9 416.9V306.2L0 230z"/></svg></span>}
export default function FundsOverview({address,onSelectChain,onPickDbkTx}){
 const [scan,setScan]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [tokenChain,setTokenChain]=useState('dbk'),[tokenAddr,setTokenAddr]=useState(''),[tokenState,setTokenState]=useState(null),[tokenBusy,setTokenBusy]=useState(false);
 const [routeChain,setRouteChain]=useState('dbk');
 const run=useCallback(async()=>{
  if(!address){setScan(null);setError('');return}
  setBusy(true);setError('');setTokenState(null);
  try{
   const r=await fetch('/api/portfolio?mode=scan&address='+encodeURIComponent(address),{cache:'no-store'});
   const data=await r.json();
   if(!r.ok||!data.ok)throw Error(data.error||'Network scan unavailable');
   setScan(data);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 },[address]);
 useEffect(()=>{run()},[run]);
 const tokenScan=async()=>{
  if(!/^0x[a-fA-F0-9]{40}$/.test(tokenAddr))return setTokenState({state:'invalid',reason:'Enter a valid ERC20 contract address'});
  setTokenBusy(true);setTokenState(null);
  try{
   const q=new URLSearchParams({mode:'erc20',chain:tokenChain,address,token:tokenAddr});
   const r=await fetch('/api/portfolio?'+q.toString(),{cache:'no-store'});
   const j=await r.json();setTokenState(j);
  }catch(e){setTokenState({state:'unknown',reason:'RPC verification failed'})}finally{setTokenBusy(false)}
 };
 const route=scan?.chains?.[routeChain],relay=scan?.relay;
 const listed=relay?.chains?.[routeChain];
 return <section className="relay-console" id="fund-finder">
 <div className="relay-top">
  <div><div className="micro">01 / INTELLIGENT ASSET DISCOVERY</div><h2>Find your stranded funds.</h2><p>One wallet, two chains. Read-only balances, live provider checks, and verified withdrawal candidates.</p></div>
  <button className="secondary relay-scan-btn" onClick={run} disabled={!address||busy}><RefreshCcw size={16}/>{busy?'Scanning on-chain…':'Scan wallet'}</button>
 </div>
 {!address?<div className="relay-notice"><Wallet size={19}/><div><b>Connect your wallet to begin</b><p>Your public address is used to read balances on ZK candy and DBK Chain. No transaction or wallet signature is required to scan.</p></div></div>:null}
 {error?<div className="warning"><AlertTriangle size={18}/><div><b>Scanner unavailable</b><p>{error}. No balance has been interpreted as zero.</p></div></div>:null}
 <div className="fund-grid">
  {SOURCES.map(s=>{
    const c=scan?.chains?.[s.key];
    const unknown=!c||c.eth?.state!=='verified';
    return <div key={s.key} className="fund-card">
      <div className="fund-card-head"><span className="fund-network-icon">{s.key==='dbk'?'D':'Z'}</span><div><b>{s.name}</b><small>{s.layer} · #{s.chain}</small></div><span className={'mini-status '+(c?.networkFresh?'up':c?.networkOnline?'stale':'down')}>{!scan?'Not scanned':c?.networkFresh?'RPC online':c?.networkOnline?'Stale RPC':'RPC unavailable'}</span></div>
      <div className="fund-amount"><small>NATIVE ASSET</small><div><AssetBadge/><strong>{!address?'Connect wallet':busy&&!scan?'Scanning…':unknown?'Unknown':fmt(c.eth.balance)}</strong></div></div>
      <p className="fund-status">{unknown?'Balance unavailable ≠ zero. The RPC cannot verify the address right now.':'Read from a verified RPC. Balances are observations, not bridged funds.'}</p>
      <div className="fund-linkline"><span>{s.key==='dbk'?'Bridge standard: OP Stack':'Bridge standard: ZK Stack'}</span><span>{c?.discovery?.candidates?.length?c.discovery.candidates.length+' recent exit(s)':'Existing exits unconfirmed'}</span></div>
      <button className="fund-review" onClick={()=>{onSelectChain(s.key);document.getElementById('bridge')?.scrollIntoView({behavior:'smooth',block:'start'})}}>Open {s.name} recovery <ArrowRight size={15}/></button>
      {s.key==='dbk'&&c?.discovery?.candidates?.length>0?<div className="found-exits"><b>Recently detected exit candidates</b>{c.discovery.candidates.slice(0,4).map((x,i)=><button key={x.hash+i} onClick={()=>{onPickDbkTx(x.hash);onSelectChain('dbk');document.getElementById('bridge')?.scrollIntoView({behavior:'smooth'})}}><span>{short(x.hash)} · {x.amount} ETH</span><ArrowUpRight size={14}/></button>)}<small>Unverified candidates: must be checked against Ethereum before signing.</small></div>:null}
    </div>
   })}
 </div>
 <div className="routing-grid">
 <div className="route-lookup">
  <div className="micro">02 / ROUTE DISCOVERY</div><h3>Choose exit network</h3>
  <div className="route-toggle">{SOURCES.map(s=><button key={s.key} className={routeChain===s.key?'active':''} onClick={()=>setRouteChain(s.key)}>{s.name}</button>)}</div>
  <div className="route-preview"><div><small>SOURCE</small><b>{SOURCES.find(s=>s.key===routeChain)?.name}</b></div><ArrowRight size={18}/><div><small>DESTINATION</small><b>Ethereum</b></div></div>
  <div className="route-method"><span>Relay solver route</span><b className={listed?.eligible?'green':'amber'}>{!relay?'Checking directory':!relay.available?'Provider unavailable':listed?.eligible?'Listed · quote still required':'Not supported'}</b></div>
  <div className="route-method"><span>Native exit</span><b>{routeChain==='dbk'?'OP Stack prove/finalize':'ZK proof + L1 finalization'}</b></div>
  <div className="route-method"><span>Native ETH observed</span><b>{route?.eth?.state==='verified'?fmt(route.eth.balance):'Unknown / no wallet'}</b></div>
  <div className="relay-notice compact"><Info size={16}/><span>{routeChain==='dbk'?'Current app supports verification and prove/finalize for existing withdrawals. A new DBK withdrawal cannot be sent from this panel.':'New ZK candy withdrawals require fresh Ethereum batch settlement evidence. A public RPC outage blocks automated route preparation.'}</span></div>
  <button className="primary" disabled={!address} onClick={()=>{onSelectChain(routeChain);document.getElementById('bridge')?.scrollIntoView({behavior:'smooth'})}}>Review native exit <ArrowRight size={16}/></button>
 </div>
 <div className="token-check">
  <div className="micro">03 / TOKEN LOOKUP</div><h3>Have ERC20 tokens too?</h3>
  <p>Native ETH is scanned automatically. To inspect a specific ERC20, enter its contract address; this is read-only and does not approve or move tokens.</p>
  <div className="route-toggle">{SOURCES.map(s=><button key={s.key} className={tokenChain===s.key?'active':''} onClick={()=>{setTokenChain(s.key);setTokenState(null)}}>{s.name}</button>)}</div>
  <label htmlFor="contract-search">Token contract address</label>
  <input id="contract-search" className="hash" value={tokenAddr} onChange={e=>{setTokenAddr(e.target.value);setTokenState(null)}} placeholder="0x... (verified contract)" autoComplete="off"/>
  <button className="secondary token-check-btn" disabled={!address||tokenBusy||!/^0x[a-fA-F0-9]{40}$/.test(tokenAddr)} onClick={tokenScan}><Search size={15}/>{tokenBusy?'Checking token…':'Check ERC20 balance'}</button>
  {tokenState?.state==='verified'?<div className="token-result"><CheckCircle2 size={17}/><div><b>{tokenState.asset.symbol}: {tokenState.asset.balance}</b><p>Balance read on {tokenState.asset.chain}; bridge route not verified. ERC20 transfer/approval is not enabled.</p></div></div>:tokenState?<div className="warning"><AlertTriangle size={16}/><span>{tokenState.reason||tokenState.error||'Token balance unavailable'}. This does not mean the balance is zero.</span></div>:null}
 </div>
 </div>
 <div className="fund-foot"><ShieldCheck size={16}/><span>Scanner never asks for seed phrases or sends transactions. Relay coverage is fetched live; unsupported routes cannot be executed. No invented quote, payout, or recovery claim.</span></div>
 {scan?.checkedAt?<p className="diag-time">Last read-only scan: {new Date(scan.checkedAt).toLocaleString()}. DBK event discovery is limited to recent blocks and may miss older withdrawals.</p>:null}
 </section>;
}
