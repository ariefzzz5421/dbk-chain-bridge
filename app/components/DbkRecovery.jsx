'use client';
import { useEffect,useState } from 'react';
import { ethers } from 'ethers';
import { Activity,ArrowRight,ArrowUpRight,ExternalLink,AlertTriangle,ShieldCheck,RefreshCcw,CheckCircle2,Info } from 'lucide-react';
const PORTAL='0x63CA00232F471bE2A3Bf3C4e95Bc1d2B3EA5DB92';
const PASSER='0x4200000000000000000000000000000000000016';
const directAbi=new ethers.Interface(['function initiateWithdrawal(address,uint256,bytes) payable']);
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
 const [newAmount,setNewAmount]=useState(''),[startPreview,setStartPreview]=useState(null),[startAck,setStartAck]=useState(false);
 useEffect(()=>{
  if(!address){setBalance(null);setBalanceError('');return}
  let active=true;setBalanceError('');
  api('?mode=balance&address='+encodeURIComponent(address)).then(x=>{if(active)setBalance(x.amount)}).catch(e=>{if(active){setBalance(null);setBalanceError(e.message)}});
  return()=>{active=false}
 },[address,submitted]);
 useEffect(()=>{
  setStatus(null);setPrepared(null);setAck(false);setError('');setSubmitted(null);setStartPreview(null);setStartAck(false);
 },[address]);
 useEffect(()=>{
  if(!wallet)return;
  const reset=()=>{setStatus(null);setPrepared(null);setAck(false);setStartPreview(null);setStartAck(false);};
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

 const previewNew=async()=>{
  setError('');setStartPreview(null);setStartAck(false);setBusy('Verifying DBK L1 output');
  try{
   const response=await api('',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'prepareStart',address,amount:newAmount.trim()})});
   const t=response.transaction;
   if(t.chainId!==20240603||t.to.toLowerCase()!==PASSER.toLowerCase()||t.recipient.toLowerCase()!==address.toLowerCase())
    throw Error('Unexpected native withdrawal route');
   const decoded=directAbi.parseTransaction({data:t.data,value:t.value});
   if(decoded?.name!=='initiateWithdrawal'||decoded.args[0].toLowerCase()!==address.toLowerCase()
      ||decoded.args[2]!=='0x'||decoded.args[1]!==100000n)
    throw Error('Unsafe withdrawal calldata');
   setStartPreview(response);
  }catch(e){setError(e.message)}finally{setBusy('')}
 };
 const startNew=async()=>{
  if(!startPreview||!startAck||!wallet||!address)return;
  setBusy('Rechecking withdrawal');
  try{
   const r=await api('',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'prepareStart',address,amount:startPreview.transaction.amount})});
   const t=r.transaction,old=startPreview.transaction;
   if(t.to.toLowerCase()!==PASSER.toLowerCase()||t.recipient.toLowerCase()!==address.toLowerCase()
      ||t.data!==old.data||t.value!==old.value||t.from.toLowerCase()!==address.toLowerCase())
    throw Error('Withdrawal payload changed; signing blocked');
   const chainId='0x'+(20240603).toString(16);
   try{await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId}]})}
   catch(e){
    if(e.code===4902||e?.data?.originalError?.code===4902)
     await wallet.request({method:'wallet_addEthereumChain',params:[{
      chainId,chainName:'DBK Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
      rpcUrls:['https://rpc.mainnet.dbkchain.io/'],blockExplorerUrls:['https://scan.dbkchain.io']
     }]});
    else throw e;
   }
   if(Number(await wallet.request({method:'eth_chainId'}))!==20240603)throw Error('DBK wallet network mismatch');
   const accounts=await wallet.request({method:'eth_accounts'});
   if(!accounts?.some(x=>x.toLowerCase()===address.toLowerCase()))throw Error('Connected wallet changed');
   // A user wallet independently simulates before showing its signing confirmation.
   const tx={from:address,to:PASSER,data:t.data,value:t.value};
   setBusy('Wallet gas check');
   await wallet.request({method:'eth_estimateGas',params:[tx]});
   setBusy('Confirm DBK withdrawal');
   const txHash=await wallet.request({method:'eth_sendTransaction',params:[tx]});
   setSubmitted({hash:txHash,action:'initiate',chainId:20240603});
   setHash(txHash);setStartPreview(null);setStartAck(false);setStatus(null);
  }catch(e){setError(e?.shortMessage||e?.message||'No transaction sent')}finally{setBusy('')}
 };
 const canProve=status?.sourceVerified&&status?.recipientIsWallet&&status?.readyToProve;
 const canFinalize=status?.sourceVerified&&status?.recipientIsWallet&&status?.readyToFinalize;
 return <div className="workspace dbk-work" id="bridge">
 <div className="panel">
  <div className="panel-title"><div><div className="micro">DBK / OP STACK RECOVERY</div><h2>DBK Chain to Ethereum</h2></div><span className="tag">OP STACK</span></div>
  <div className="route"><div className="chain"><span className="dbk-symbol">D</span><div><small>FROM</small><strong>DBK Chain</strong><span>Chain ID 20240603</span></div></div><div className="arrow"><ArrowRight size={18}/></div><div className="chain"><span className="coin eth"><svg viewBox="0 0 256 417" width="19" height="32"><path fill="#a4b3fa" d="M127.9 0 125.1 9.5v269.7l2.8 2.8 127.9-75.6z"/><path fill="#6378d7" d="M127.9 0 0 206.4 127.9 282V154.1z"/><path fill="#5370bd" d="m127.9 306.2-2.8 3.4v105.1l2.8 2.2L255.9 230z"/></svg></span><div><small>TO</small><strong>Ethereum</strong><span>Chain ID 1</span></div></div></div>
  <div className="warning"><AlertTriangle size={18}/><div><b>Native withdrawal · subject to protocol checks</b><p>New withdrawals require verified fresh DBK blocks, Ethereum Portal + L2OutputOracle code, a recent posted output root, and successful L2 simulation. If any fail, signing is blocked. This is not a Relay instant fill and L1 finalization can take time or fail.</p></div></div>
  <div className="form dbk-new-form">
   <div className="micro">NEW / NATIVE ETH WITHDRAWAL</div>
   <label htmlFor="dbk-new-amount">ETH amount to send from DBK to your own Ethereum wallet</label>
   <div className="amount"><input id="dbk-new-amount" placeholder="0.00" inputMode="decimal" value={newAmount} onChange={e=>{setNewAmount(e.target.value);setStartPreview(null);setStartAck(false)}}/><span>ETH</span></div>
   <p className="hint"><Info size={15}/> Recipient will always be your connected address ({SHORT(address)}). Keep some DBK ETH for gas. A withdrawal initiated now may not become claimable if DBK's operator stops publishing new outputs or proofs.</p>
   {!startPreview?<button className="primary muted" disabled={!address||!newAmount||!!busy} onClick={previewNew}>{busy||'Verify native DBK exit'} <Activity size={16}/></button>:
   <div className="review"><div className="review-title">Native withdrawal preflight <span>Simulated · not finalized</span></div>
    <div className="kv"><span>Amount</span><b>{startPreview.transaction.amount} ETH</b></div>
    <div className="kv"><span>Destination</span><code>{SHORT(startPreview.transaction.recipient)}</code></div>
    <div className="kv"><span>L2 contract</span><code>{SHORT(startPreview.transaction.to)}</code></div>
    <div className="kv"><span>Recent L1 output age</span><b>{startPreview.preflight.outputAgeSeconds}s</b></div>
    <div className="kv"><span>Estimated L2 gas units</span><span>{startPreview.transaction.gasEstimate}</span></div>
    <label className="accept"><input type="checkbox" checked={startAck} onChange={e=>setStartAck(e.target.checked)}/> I understand my ETH will leave DBK and could remain stuck before L1 settlement. There is no guaranteed ETA, price, or automatic refund.</label>
    <button className="primary" disabled={!startAck||!!busy} onClick={startNew}>{busy||'Sign native DBK withdrawal'} <ArrowUpRight size={16}/></button>
   </div>}
  </div>
  <div className="form dbk-existing-form">
    <div className="micro">EXISTING / PROVE & FINALIZE</div>
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
  {submitted?<div className="success"><CheckCircle2 size={19}/><div><b>{submitted.action==='initiate'?'DBK L2 withdrawal':'Ethereum '+submitted.action} transaction submitted</b><p>Check on-chain confirmation. A broadcast is not a completed recovery.</p><a target="_blank" rel="noopener noreferrer" href={(submitted.chainId===20240603?'https://scan.dbkchain.io/tx/':'https://etherscan.io/tx/')+submitted.hash}>View transaction <ExternalLink size={13}/></a></div></div>:null}
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
