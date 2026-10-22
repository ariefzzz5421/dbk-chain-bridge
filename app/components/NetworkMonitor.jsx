'use client';
import { useCallback,useEffect,useState } from 'react';
import { Activity, RefreshCcw, ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react';

function Status({network,name}){
 const state=!network?'Checking…':network.online?(network.fresh?'RPC online · fresh':'RPC online · block stale'):'RPC unavailable';
 return <div className="network-record">
  <div className="network-main"><div><strong>{name}</strong><small>Chain ID {network?.chainId||'—'}</small></div><b className={network?.online&&network?.fresh?'green':network?.online?'amber':'red'}>{state}</b></div>
  <div className="network-facts"><span>Provider: {network?.selectedRpc||'None verified'}</span><span>Block: {network?.latestBlock?.toLocaleString()||'—'}</span><span>Block age: {network?.blockAgeSeconds!=null?network.blockAgeSeconds+' sec':'—'}</span></div>
  {network?.checks?.length?<details className="network-endpoints"><summary>RPC test results ({network.checks.filter(x=>x.online).length}/{network.checks.length})</summary>
  {network.checks.map((p,i)=><div key={p.label+'-'+i}><span>{p.label}</span><span className={p.online?'green':'red'}>{p.online?'Responding'+(p.fresh?' · fresh':' · stale'):p.error||'Failed'}</span></div>)}</details>:null}
 </div>;
}
export default function NetworkMonitor(){
 const [report,setReport]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const update=useCallback(async()=>{
  setBusy(true);setError('');
  try{
   const r=await fetch('/api/networks',{cache:'no-store'});
   const j=await r.json();
   if(!r.ok||!j.ok)throw Error(j.error||'Health service unavailable');
   setReport(j);
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 },[]);
 useEffect(()=>{
  update();const id=setInterval(update,60000);return()=>clearInterval(id);
 },[update]);
 return <section className="health-overview" id="network-health">
   <div className="health-title"><div><div className="micro">LIVE / READ-ONLY DIAGNOSTICS</div><h2>Network & exit infrastructure</h2><p>Independent RPC probes, block recency, and Ethereum L1 contract checks. Updated on request and every 60 seconds.</p></div><button className="secondary health-refresh" onClick={update} disabled={busy}><RefreshCcw size={15}/>{busy?'Checking networks…':'Recheck networks'}</button></div>
   {error?<div className="warning"><AlertTriangle size={17}/><span>{error}. Previously observed data may be stale.</span></div>:null}
   <div className="network-grid">
     <Status name="ZK candy" network={report?.zkcandy}/>
     <Status name="DBK Chain" network={report?.dbk}/>
     <Status name="Ethereum L1" network={report?.ethereum}/>
   </div>
   <div className="exit-audit">
     <div><ShieldCheck size={17}/><strong>DBK Ethereum exit-contract audit</strong></div>
     <div className="exit-info"><span>OptimismPortal bytecode: <b className={report?.dbkExit?.portalCode?'green':'red'}>{report?.dbkExit?.portalCode?'Present':'Unverified'}</b></span><span>L2OutputOracle bytecode: <b className={report?.dbkExit?.outputOracleCode?'green':'red'}>{report?.dbkExit?.outputOracleCode?'Present':'Unverified'}</b></span><span>Latest oracle index: <b>{report?.dbkExit?.latestOutputIndex??'Unverified'}</b></span></div>
     <p>Presence of contracts or recent blocks is not proof that funds are withdrawable. DBK prove/finalize only appears after a matching L2 withdrawal and L1 simulation. ZK candy still requires valid ZK proofs.</p>
     <div className="links"><a href="https://docs.dbkchain.io/general-info/mainnet-contract-addresses/l1-l2-contracts" target="_blank" rel="noopener noreferrer">DBK official contracts <ExternalLink size={12}/></a><a href="https://docs.zksync.io/zksync-network/environment" target="_blank" rel="noopener noreferrer">ZKsync network docs <ExternalLink size={12}/></a></div>
   </div>
   <p className="diag-time">Last checked: {report?.checkedAt?new Date(report.checkedAt).toLocaleString():'Checking…'}. All observations are read-only; no wallet transaction is initiated by this monitor.</p>
 </section>;
}
