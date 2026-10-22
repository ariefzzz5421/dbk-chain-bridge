'use client';
import { useEffect,useState } from 'react';
import { Activity,ArrowRight,ArrowUpRight,ExternalLink,AlertTriangle,ShieldCheck,RefreshCcw,CheckCircle2,Info } from 'lucide-react';
const PORTAL='0x63CA00232F471bE2A3Bf3C4e95Bc1d2B3EA5DB92';
const SHORT=x=>x?x.slice(0,8)+'…'+x.slice(-6):'—';
const HASH=x=>/^0x[0-9a-f]{64}$/i.test(x||'');
const api=async(q='',opts={})=>{
 const r=await fetch('/api/dbk'+q,{cache:'no-store',...opts});
 const j=await r.json();
 if(!r.ok||!j.ok)throw Error(j.error||'DBK read failed');
 return j;
};
async function toEthereum(wallet){
 const target='0x1';
 const current=await wallet.request({method:'eth_chainId'});
 if(current!==target)await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]});
 if(Number(await wallet.request({method:'eth_chainId'}))!==1)throw Error('Ethereum mainnet not selected');
}
export default function DbkRecovery({address,wallet}){
 const [balance,setBalance]=useState(null);
 const [balanceError,setBalanceError]=useState('');
 const [hash,setHash]=useState('');
 const [status,setStatus]=useState(null),[prepared,setPrepared]=useState(null);
 const [ack,setAck]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[submitted,setSubmitted]=useState(null);
 useEffect(()=>{
  if(!address){setBalance(null);setBalanceError('');return}
  let active=true;setBalanceError('');
  api('?mode=balance&address='+encodeURIComponent(address)).then(x=>{if(active)setBalance(x.amount)}).catch(e=>{if(active){setBalance(null);setBalanceError(e.message)}});
  return()=>{active=false}
 },[address,submitted]);
 useEffect(()=>{
  setStatus(null);setPrepared(null);setAck(false);setError('');setSubmitted(null);
 },[address]);
 useEffect(()=>{
  if(!wallet)return;
  const reset=()=>{setStatus(null);setPrepared(null);setAck(false);};
  wallet.on?.('chainChanged',reset);wallet.on?.('accountsChanged',reset);
  return()=>{wallet.removeListener?.('chainChanged',reset);wallet.removeListener?.('accountsChanged',reset)};
 },[wallet]);
 const inspect=async()=>{
  setStatus(null);setPrepared(null);setAck(false);setError('');setSubmitted(null);
  if(!address||!HASH(hash)){setError('Connect the original wallet and enter a DBK L2 withdrawal transaction hash.');return}
  setBusy('Reading DBK and Ethereum');
  try{setStatus(await api('?mode=status&address='+encodeURIComponent(address)+'&hash='+encodeURIComponent(hash)))}
  catch(e){setError(e.message)}finally{setBusy('')}
 };
 const prepare=async(action)=>{
  setError('');setPrepared(null);setAck(false);setBusy('Simulating Ethereum '+action);
  try{
    const j=await api('',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({action,hash,address})});
    if(j.transaction.to.toLowerCase()!==PORTAL.toLowerCase()||!j.transaction.simulated||
       j.transaction.recipient.toLowerCase()!==address.toLowerCase()||j.transaction.chainId!==1)
      throw Error('Safety verification failed');
    setPrepared(j.transaction);
  }catch(e){setError(e.message)}finally{setBusy('')}
 };
 const sign=async()=>{
  if(!prepared||!ack||!address||!wallet)return;
  setError('');setBusy('Revalidating proof');
  try{
    const j=await api('',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({action:prepared.action,hash,address})});
    const p=j.transaction;
    if(p.to.toLowerCase()!==PORTAL.toLowerCase()||p.to.toLowerCase()!==prepared.to.toLowerCase()||
       p.data!==prepared.data||p.value!==prepared.value||p.recipient.toLowerCase()!==address.toLowerCase()||
       p.withdrawalHash!==prepared.withdrawalHash||p.simulated!==true||p.chainId!==1)
      throw Error('Withdrawal proof changed or no longer verified; transaction blocked.');
    await toEthereum(wallet);
    const accounts=await wallet.request({method:'eth_accounts'});
    if(!accounts?.some(a=>a.toLowerCase()===address.toLowerCase()))throw Error('Wallet address has changed');
    const tx={from:address,to:PORTAL,data:p.data,value:'0x0'};
    setBusy('Estimating Ethereum gas');
    await wallet.request({method:'eth_estimateGas',params:[tx]});
    setBusy('Wallet signature required');
    const sent=await wallet.request({method:'eth_sendTransaction',params:[tx]});
    setSubmitted({hash:sent,action:p.action});setPrepared(null);setStatus(null);setAck(false);
  }catch(e){setError(e?.shortMessage||e?.message||'Transaction not sent')}finally{setBusy('')}
 };
 const canProve=status?.sourceVerified&&status?.recipientIsWallet&&status?.readyToProve;
 const canFinalize=status?.sourceVerified&&status?.recipientIsWallet&&status?.readyToFinalize;
 return <div className="workspace dbk-work" id="bridge">
 <div className="panel">
  <div className="panel-title"><div><div className="micro">DBK / OP STACK RECOVERY</div><h2>DBK Chain to Ethereum</h2></div><span className="tag">OP STACK</span></div>
  <div className="route"><div className="chain"><span className="dbk-symbol">D</span><div><small>FROM</small><strong>DBK Chain</strong><span>Chain ID 20240603</span></div></div><div className="arrow"><ArrowRight size={18}/></div><div className="chain"><span className="coin eth"><svg viewBox="0 0 256 417" width="19" height="32"><path fill="#a4b3fa" d="M127.9 0 125.1 9.5v269.7l2.8 2.8 127.9-75.6z"/><path fill="#6378d7" d="M127.9 0 0 206.4 127.9 282V154.1z"/><path fill="#5370bd" d="m127.9 306.2-2.8 3.4v105.1l2.8 2.2L255.9 230z"/></svg></span><div><small>TO</small><strong>Ethereum</strong><span>Chain ID 1</span></div></div></div>
  <div className="warning"><AlertTriangle size={18}/><div><b>New DBK withdrawals disabled for safety</b><p>Live blocks do not prove the L1 exit path is functional. This console only validates and attempts prove/finalize for withdrawals already initiated on DBK.</p></div></div>
  <div className="form">
    <label>DBK ETH BALANCE</label><div className="balance"><strong>{address?(balance!=null?Number(balance).toLocaleString(undefined,{maximumFractionDigits:8})+' ETH':'Not available'):'Connect wallet to inspect balance'}</strong><button title="Refresh balance" onClick={()=>{if(!address)return;api('?mode=balance&address='+encodeURIComponent(address)).then(x=>{setBalance(x.amount);setBalanceError('')}).catch(e=>setBalanceError(e.message))}}><RefreshCcw size={15}/></button></div>
    {balanceError?<p className="hint">Balance provider: {balanceError}. No wallet funds were moved.</p>:null}
    <label htmlFor="dbk-txhash">Existing DBK withdrawal transaction hash</label>
    <input id="dbk-txhash" className="hash" value={hash} onChange={e=>{setHash(e.target.value);setStatus(null);setPrepared(null);setAck(false)}} placeholder="0x... (DBK L2 transaction)" spellCheck={false}/>
    <p className="hint"><Info size={15}/> This must be a confirmed withdrawal originally initiated by the connected wallet. Normal transfers and deposits do not qualify.</p>
    <button className="primary muted" disabled={!address||!HASH(hash)||!!busy} onClick={inspect}>{busy||'Inspect withdrawal'} <Activity size={17}/></button>
    {status?<div className="review">
     <div className="review-title">Verified protocol inspection <span>{status.status||'UNVERIFIED'}</span></div>
     <div className="kv"><span>Amount</span><strong>{status.amount||'—'} ETH</strong></div>
     <div className="kv"><span>ETH returns to wallet</span><strong className={status.recipientIsWallet?'green':'red'}>{status.recipientIsWallet?'Verified':'Not verified'}</strong></div>
     <div className="kv"><span>Withdrawal hash</span><code>{SHORT(status.withdrawalHash)}</code></div>
     <div className="kv"><span>Route</span><span>{status.route||'Unverified'}</span></div>
     <p className="hint">{status.explanation}</p>
     <div className="dbk-actions">
      <button className="secondary" disabled={!canProve||!!busy} onClick={()=>prepare('prove')}>Prepare L1 proof</button>
      <button className="secondary" disabled={!canFinalize||!!busy} onClick={()=>prepare('finalize')}>Prepare L1 finalization</button>
     </div>
    </div>:null}
    {prepared?<div className="review">
     <div className="review-title">Ethereum transaction simulation <span>Passed</span></div>
     <div className="kv"><span>Action</span><b>{prepared.action}</b></div>
     <div className="kv"><span>Protocol target</span><code>{SHORT(prepared.to)}</code></div>
     <div className="kv"><span>Recipient</span><code>{SHORT(prepared.recipient)}</code></div>
     <div className="kv"><span>Withdrawal amount</span><b>{prepared.amount} ETH</b></div>
     <label className="accept"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I understand Ethereum gas is payable and protocol finalization may revert despite successful simulation. The destination is my original wallet.</label>
     <button className="primary" onClick={sign} disabled={!ack||!!busy}>{busy||'Sign Ethereum '+prepared.action} <ArrowUpRight size={17}/></button>
    </div>:null}
  </div>
  {error?<div className="error" role="alert"><AlertTriangle size={18}/><span>{error}. No recovery transaction was broadcast by the server.</span></div>:null}
  {submitted?<div className="success"><CheckCircle2 size={19}/><div><b>Ethereum {submitted.action} transaction submitted</b><p>Check on-chain confirmation. A broadcast is not a completed recovery.</p><a target="_blank" rel="noopener noreferrer" href={'https://etherscan.io/tx/'+submitted.hash}>View transaction <ExternalLink size={13}/></a></div></div>:null}
 </div>
 <aside>
  <div className="side-panel"><div className="micro">WITHDRAWAL PIPELINE</div><h3>Contract-based recovery</h3>
  <div className="stat"><span>L2 block production</span><b>See live network monitor</b></div>
  <div className="stat"><span>OptimismPortal</span><code>{SHORT(PORTAL)}</code></div>
  <div className="stat"><span>Message stage</span><b>{status?.status||'Not inspected'}</b></div>
  <p className="hint">An OP Stack withdrawal involves initiation on L2, proof on Ethereum, then finalization after the network challenge period. Only your wallet signs transactions.</p>
  <a href="https://docs.dbkchain.io/bridge/bridge-sdk" target="_blank" rel="noopener noreferrer" className="dbk-doc">DBK official bridge SDK <ExternalLink size={14}/></a>
  </div>
  <div className="side-panel safety"><div className="micro">SAFETY FIRST</div><h3>Never send funds to a recovery agent</h3><p><ShieldCheck size={16}/> No seed phrases or private keys</p><p><ShieldCheck size={16}/> No arbitrary token approvals</p><p><ShieldCheck size={16}/> No promise of withdrawal until L1 receipt succeeds</p></div>
 </aside>
 </div>;
}
