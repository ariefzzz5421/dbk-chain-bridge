'use client';
import {useEffect,useMemo,useState} from 'react';
import {PrivyProvider,usePrivy,useWallets} from '@privy-io/react-auth';
import {defineChain} from 'viem';
import {mainnet} from 'viem/chains';
import {ArrowUpRight,ArrowRight,ShieldCheck,CheckCircle2,AlertTriangle,Wallet,ExternalLink,RefreshCw,Activity,Zap,Link2,Info,LockKeyhole,Search,Copy,Clock3,Send,FileCode2,ChevronDown,ArrowDownLeft,Check} from 'lucide-react';

const APP_ID=process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const DBK_RPC=process.env.NEXT_PUBLIC_DBK_RPC_URL || 'https://rpc.mainnet.dbkchain.io/';
const DBK=defineChain({
 id:20240603,name:'DBK Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
 rpcUrls:{default:{http:[DBK_RPC]}},blockExplorers:{default:{name:'DBK Scan',url:'https://scan.dbkchain.io'}},
});
const CONTRACT='0x63CA00232F471bE2A3Bf3C4e95Bc1d2B3EA5DB92';
const short=(s,n=6)=>s? s.slice(0,n)+'…'+s.slice(-4):'—';
const isHash=(s)=>/^0x[0-9a-fA-F]{64}$/.test(s);
const fmtAge=(n)=>n===undefined?'Unknown':n>86400?Math.floor(n/86400)+'d ago':n>3600?Math.floor(n/3600)+'h ago':n>60?Math.floor(n/60)+'m ago':n+'s ago';
const STEPS=[
 {name:'Withdrawal initiated',desc:'DBK L2 transaction'},
 {name:'Prove on Ethereum',desc:'Submit validity proof'},
 {name:'Challenge period',desc:'Wait until finalizable'},
 {name:'Finalize withdrawal',desc:'Receive funds on L1'},
];
const statusInfo={
 STATE_ROOT_NOT_PUBLISHED:{step:0,text:'Waiting for published state root',tone:'waiting',desc:'The rollup must post the required state to Ethereum before a proof can be generated.'},
 READY_TO_PROVE:{step:1,text:'Ready to prove',tone:'action',desc:'You may prepare the Prove transaction on Ethereum.'},
 IN_CHALLENGE_PERIOD:{step:2,text:'Challenge period',tone:'waiting',desc:'The proof has been submitted. Wait until the challenge period is over.'},
 READY_FOR_RELAY:{step:3,text:'Ready to finalize',tone:'action',desc:'You may finalize the withdrawal to Ethereum.'},
 RELAYED:{step:4,text:'Finalized on Ethereum',tone:'success',desc:'OptimismPortal reports this withdrawal as finalized. Finalization success still needs separate verification.'},
 STATUS_UNVERIFIED:{step:0,text:'Withdrawal found — portal status unverified',tone:'waiting',desc:'The DBK event was verified, but the L1 bridge status could not be confirmed. Signing is disabled.'},
};
async function api(path,options){
 const response=await fetch('/api/bridge'+path,{cache:'no-store',...options});
 const data=await response.json();
 if(!response.ok||!data.ok)throw new Error(data.error||'Request failed');
 return data;
}
function Chip({children,className=''}){return <span className={'chip '+className}>{children}</span>}
function ChainSymbol({type}) {
 return <div className={'chain-symbol '+type} role="img" aria-label={type==='dbk'?'DBK Chain':'Ethereum'}>
 {type==='dbk'
 ? <img className="dbk-official-logo" src="/dbk-logo.webp" alt="" width="48" height="48" aria-hidden="true"/> : <svg className="ethereum-icon" viewBox="0 0 256 417" aria-hidden="true">
   <path fill="#9BA8EB" d="M127.9 0L125.1 9.5V279.2L127.9 282l127.9-75.6z"/>
   <path fill="#6376CD" d="M127.9 0L0 206.4L127.9 282V154.1z"/>
   <path fill="#5264B8" d="M127.9 306.2L126.3 308.2v106.9l1.6 1.8L255.9 230z"/>
   <path fill="#8696E4" d="M127.9 416.9V306.2L0 230z"/>
   <path fill="#7181DE" d="M127.9 282l127.9-75.6-127.9-52.3z"/>
   <path fill="#4E61AB" d="M0 206.4L127.9 282V154.1z"/>
   </svg>}
 </div>
}
function ButtonLink({href,children}) {return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-link">{children}<ExternalLink size={13}/></a>}
function AppInner(){
 const {ready,authenticated,login,logout}=usePrivy();
 const {wallets}=useWallets();
 const [walletIndex,setWalletIndex]=useState(0);
 const wallet=wallets[walletIndex]||wallets[0];
 const address=wallet?.address||'';
 const [mode,setMode]=useState('recover');
 const [hash,setHash]=useState('');
 const [amount,setAmount]=useState('');
 const [status,setStatus]=useState(null);
 const [health,setHealth]=useState(null);
 const [loading,setLoading]=useState('');
 const [error,setError]=useState('');
 const [pending,setPending]=useState(null);
 const [ack,setAck]=useState(false);
 const [ackNew,setAckNew]=useState(false);
 const [receiptHash,setReceiptHash]=useState('');
 const [receiptChain,setReceiptChain]=useState(1);
 const [copied,setCopied]=useState(false);
 const [discovery,setDiscovery]=useState(null);
 const [scanBusy,setScanBusy]=useState(false);
 const [receiptAction,setReceiptAction]=useState('');
 const [execution,setExecution]=useState(null);
 const [receiptState,setReceiptState]=useState('submitted');
 const statusView=status?.status ? statusInfo[status.status]||{step:0,text:status.status.replaceAll('_',' '),tone:'waiting',desc:'Review this message state before acting.'}:null;
 const dbkLive=!!health?.dbk?.ok&&!!health?.dbk?.live;
 const l1Live=!!health?.ethereum?.ok;
 const canStart=dbkLive&&l1Live;
 const explorer=receiptChain===1?'https://etherscan.io/tx/':'https://scan.dbkchain.io/tx/';
 useEffect(()=>{refreshHealth()},[]);
 useEffect(()=>{setStatus(null);setPending(null);setReceiptHash('');setError('');setAck(false);},[hash,mode,walletIndex]);
 // Read-only automatic discovery after the existing external wallet connects.
 // There are no approvals or wallet signatures during this scan.
 useEffect(()=>{
   if(!address){setDiscovery(null);setScanBusy(false);return;}
   const controller=new AbortController();
   setScanBusy(true);setDiscovery(null);
   fetch('/api/discover?address='+encodeURIComponent(address),{cache:'no-store',signal:controller.signal})
    .then(async response=>{const body=await response.json();if(!response.ok || !body.ok)throw Error(body.error||'Explorer scan unavailable');return body;})
    .then(async result=>{
      if(controller.signal.aborted)return;
      setDiscovery(result);
      // Auto-populate only. Candidates are NOT verified or claimable until the OP SDK checks them.
      if(result.candidates.length===1 && !hash){
        const found=result.candidates[0].hash;
        setHash(found);
        try{
          const checked=await api('?mode=status&hash='+encodeURIComponent(found)+'&address='+encodeURIComponent(address));
          if(!controller.signal.aborted)setStatus(checked);
        }catch { /* Explorer-only evidence is not proof; user can retry manually. */ }
      }
    })
    .catch(error=>{if(!controller.signal.aborted)setDiscovery({ok:false,error:error.message,candidates:[]});})
    .finally(()=>{if(!controller.signal.aborted)setScanBusy(false);});
   return ()=>controller.abort();
 },[address]);
 // Animation advances only after the user's transaction is actually mined.
 useEffect(()=>{
   if(!receiptHash||!wallet?.getEthereumProvider)return;
   let stopped=false;
   const checkReceipt=async()=>{
    try{
      const provider=await wallet.getEthereumProvider();
      const receipt=await provider.request({method:'eth_getTransactionReceipt',params:[receiptHash]});
      if(stopped||!receipt)return;
      setReceiptState(receipt.status==='0x1'||receipt.status===1?'confirmed':'failed');
    }catch { /* Wallet RPC transient error; keep polling, never invent confirmations. */ }
   };
   checkReceipt();
   const interval=setInterval(checkReceipt,12000);
   return ()=>{stopped=true;clearInterval(interval);};
 },[receiptHash,receiptChain,address]);

 useEffect(()=>{
  if(status?.status!=='RELAYED'||!address||!hash){setExecution(null);return;}
  let canceled=false;
  api('?mode=execution&hash='+encodeURIComponent(hash)+'&address='+encodeURIComponent(address))
   .then(result=>{if(!canceled)setExecution(result)})
   .catch(()=>{if(!canceled)setExecution({success:null,reason:'FINALIZATION_LOG_CHECK_FAILED'})});
  return ()=>{canceled=true};
 },[status?.status,address,hash]);
  const gasString=useMemo(()=>pending?.estimatedGasEth?Number(pending.estimatedGasEth).toFixed(7)+' ETH':'Unavailable', [pending]);
 async function refreshHealth(){
  try{const data=await api('?mode=health');setHealth(data.health)}catch(e){setHealth({dbk:{ok:false,error:e.message},ethereum:{ok:false,error:e.message}})}
 }
 async function inspect(candidateHash=hash){
  if(!address){setError('Connect your original withdrawal wallet first.');return;}
  if(!isHash(candidateHash.trim())){setError('Please enter a valid 0x-prefixed 32-byte DBK transaction hash.');return;}
  setError('');setLoading('check');setPending(null);
  try{const data=await api('?mode=status&hash='+encodeURIComponent(candidateHash.trim())+'&address='+encodeURIComponent(address));setStatus(data)}catch(e){setStatus(null);setError(e.message)}finally{setLoading('')}
 }
 function chooseCandidate(candidate){
  if(!candidate?.hash)return;
  setMode('recover');setHash(candidate.hash);
  inspect(candidate.hash);
 }
 async function rescan(){
  if(!address)return;
  setScanBusy(true);
  try{
   const response=await fetch('/api/discover?address='+encodeURIComponent(address),{cache:'no-store'});
   const result=await response.json();
   if(!response.ok || !result.ok)throw Error(result.error||'Explorer unavailable');
   setDiscovery(result);
  }catch(e){setDiscovery({ok:false,error:e.message,candidates:[]})}
  finally{setScanBusy(false);}
 }
 async function prepare(action){
  if(!address){setError('Connect your original wallet first.');return;}
  if(action==='start'&&!ackNew){setError('Acknowledge the irreversible withdrawal warning.');return;}
  setLoading('prepare');setError('');setPending(null);setAck(false);
  try{
   const data=await api('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,address,hash:hash.trim(),amount:amount.trim()})});
   const tx=data.transaction;
   if(!tx.simulated || tx.action!==action || tx.recipient?.toLowerCase()!==address.toLowerCase())throw new Error('Server verification or simulation is missing. Transaction blocked.');
   if(tx.chainId!==1&&tx.chainId!==20240603)throw new Error('Invalid network requested.');
   if((action!=='start'&&tx.to.toLowerCase()!==CONTRACT.toLowerCase())||
      (action==='start'&&!['0x4200000000000000000000000000000000000010','0x4200000000000000000000000000000000000007'].includes(tx.to.toLowerCase())))
    throw new Error('Contract address not on the allowlist.');
   if(!wallet.switchChain||!wallet.getEthereumProvider)throw new Error('Wallet does not support EVM network changes.');
   await wallet.switchChain(tx.chainId);
   const provider=await wallet.getEthereumProvider();
   const id=Number(await provider.request({method:'eth_chainId'}));
   if(id!==tx.chainId)throw new Error('Wallet is on a different network. Refusing to continue.');
   const unsigned={from:address,to:tx.to,data:tx.data,value:tx.value||'0x0'};
   const gas=await provider.request({method:'eth_estimateGas',params:[unsigned]});
   const gasPrice=await provider.request({method:'eth_gasPrice'});
   const estimate=BigInt(gas)*BigInt(gasPrice);
   const eth=(Number(estimate)/1e18).toString();
   setPending({...tx,gas,gasPrice,estimatedGasEth:eth,address,originHash:hash.trim()});
  }catch(e){setError(e.message||'Could not prepare transaction.')}finally{setLoading('')}
 }
 async function submit(){
  if(!ack||!pending||!wallet){return;}
  setError('');setLoading('sign');
  try{
   const provider=await wallet.getEthereumProvider();
   const id=Number(await provider.request({method:'eth_chainId'}));
   if(id!==pending.chainId||address.toLowerCase()!==pending.address.toLowerCase())throw new Error('Wallet address or network changed. Prepare again.');
   // Revalidate server-side status before signing; status may have changed since preparation.
   const checked=await api('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:pending.action,address,hash:pending.originHash,amount:pending.amount})});
   const current=checked.transaction;
   if(!current.simulated||current.action!==pending.action||current.withdrawalHash!==pending.withdrawalHash||current.to.toLowerCase()!==pending.to.toLowerCase()||current.data!==pending.data||current.value!==pending.value)throw new Error('Withdrawal calldata changed. Review again.');
   const raw={from:address,to:pending.to,data:pending.data,value:pending.value};
   await provider.request({method:'eth_estimateGas',params:[raw]});
   const sent=await provider.request({method:'eth_sendTransaction',params:[raw]});
   setReceiptHash(sent);setReceiptChain(pending.chainId);setReceiptAction(pending.action);setReceiptState('submitted');setPending(null);setAck(false);setStatus(null);
   refreshHealth();
  }catch(e){setError(e?.message||'Wallet rejected or transaction failed.')}finally{setLoading('')}
 }
 function reset(){setStatus(null);setPending(null);setReceiptHash('');setError('');setAck(false)}
 async function copyAddress(){try{await navigator.clipboard.writeText(CONTRACT);setCopied(true);setTimeout(()=>setCopied(false),1700)}catch{}}
 return <div className="app-frame">
  <div className="ambient glow-one"/><div className="ambient glow-two"/>
  <header className="topbar">
   <div className="brand"><div className="brand-mark"><img src="/dbk-logo.webp" alt="DBK" className="brand-dbk-logo" width="38" height="38"/></div><div><b>DBK<span>PORTAL</span></b><small>RECOVERY INTERFACE</small></div></div>
   <div className="nav-links"><a href="#console">Bridge</a><a href="#how-it-works">How it works</a><ButtonLink href="https://docs.dbkchain.io/bridge/bridge-sdk">Docs</ButtonLink></div>
   <div className="top-actions">
    <Chip className="mainnet-chip"><span className="live-dot"/> Ethereum Mainnet</Chip>
    {authenticated?<div className="connected-menu"><Wallet size={15}/><select aria-label="Select connected wallet" value={walletIndex} onChange={e=>setWalletIndex(Number(e.target.value))}>{wallets.map((w,i)=><option key={w.address+i} value={i}>{short(w.address)}</option>)}</select><button className="logout" onClick={logout} title="Disconnect wallet">×</button></div>:<button className="connect-btn" disabled={!ready} onClick={login}><Wallet size={15}/>Connect wallet</button>}
   </div>
  </header>
  <main>
   <div className="hero"><div className="eyebrow"><span className="eyebrow-line"/> SELF-CUSTODIAL RECOVERY TOOL <span className="eyebrow-line"/></div>
    <h1>Bring your assets <span>back home.</span></h1>
    <p>Recover ETH from DBK Chain to Ethereum — inspect existing withdrawals, prove messages, and finalize safely. No custody. No hidden fees.</p>
    <div className="hero-pills"><span><ShieldCheck size={15}/> Non-custodial</span><span><LockKeyhole size={15}/> No seed phrase</span><span><Activity size={15}/> On-chain verification</span></div>
   </div>
   <section className="workspace" id="console">
    <div className="main-panel">
     <div className="panel-top"><div><div className="section-label">01 / BRIDGE CONSOLE</div><h2>Recover to Ethereum</h2></div><Chip className="protocol-chip"><Link2 size={12}/> OP STACK</Chip></div>
     <div className="route"><div className="route-chain"><ChainSymbol type="dbk"/><div><span className="minor">FROM</span><strong>DBK Chain</strong><small>Chain ID 20240603</small></div></div><div className="route-arrow"><span className="bridge-orbit"/><ArrowRight size={20}/></div><div className="route-chain"><ChainSymbol type="eth"/><div><span className="minor">TO</span><strong>Ethereum</strong><small>Mainnet · Chain ID 1</small></div></div></div>
     <div className="tabs"><button className={mode==='recover'?'selected':''} onClick={()=>setMode('recover')}><ArrowDownLeft size={15}/> Recover withdrawal</button><button disabled title="New withdrawals remain disabled until a full signing audit is complete"><Send size={15}/> New withdrawal (disabled)</button></div>
     {mode==='recover'?<div className="tab-body">
      <section className="discovery-card" aria-live="polite">
       <div className="discovery-heading"><div><span className="discovery-icon"><Search size={16}/></span><b>Auto-detect wallet activity</b></div>{address&&<button onClick={rescan} disabled={scanBusy} className="scan-refresh"><RefreshCw size={14} className={scanBusy?'spin':''}/> Rescan</button>}</div>
       {!address?<div className="discovery-empty"><Wallet size={20}/><p>Connect the original wallet to scan recent DBK bridge activity automatically. No signature needed.</p><button className="mini-connect" onClick={login} disabled={!ready}>Connect wallet <ArrowRight size={14}/></button></div>
       :scanBusy?<div className="scan-progress"><div className="scan-radar"><Search size={21}/></div><div><b>Scanning DBK explorer…</b><span>Finding possible withdrawal transactions for {short(address,8)}</span><div className="scan-shimmer"/></div></div>
       :discovery?.ok?<div className="discovery-body">
        <div className="wallet-found"><CheckCircle2 size={15}/><span>Wallet {short(address,8)}</span><span className="readonly-chip">READ ONLY</span></div>
        {discovery.balance!==null&&<p className="balance-note">Indexed DBK wallet balance: <b>{Number(discovery.balance).toLocaleString(undefined,{maximumFractionDigits:8})} ETH</b>. This is not a verified pending withdrawal.</p>}
        {discovery.candidates?.length>0?<><p className="results-caption">{discovery.candidates.length} potential bridge {discovery.candidates.length===1?'transaction':'transactions'} found. Verify each before recovery.</p>
          <div className="candidate-list">{discovery.candidates.map(candidate=><button key={candidate.hash} onClick={()=>chooseCandidate(candidate)} className={'candidate '+(candidate.hash.toLowerCase()===hash.toLowerCase()?'candidate-selected':'')}>
            <span className="candidate-shape"><ArrowUpRight size={16}/></span><span className="candidate-details"><b>{candidate.amount?Number(candidate.amount).toLocaleString(undefined,{maximumFractionDigits:8})+' ETH':'Possible DBK withdrawal'}</b><small>{short(candidate.hash,10)} · {candidate.method}</small><em>Unverified candidate · status check required</em></span><ArrowRight size={17}/></button>)}</div>
          </>:<p className="results-caption">No bridge candidates in the indexed transactions scanned. This does <b>not</b> rule out older or contract-mediated withdrawals.</p>}
        <div className="discovery-footer"><span>{discovery.source} · {discovery.scanned} transactions scanned{discovery.partial?' · partial history':''}</span><ButtonLink href={'https://scan.dbkchain.io/address/'+address}>Explorer</ButtonLink></div>
       </div>
       :<div className="discovery-empty"><AlertTriangle size={17}/><p>{discovery?.error||'Explorer not yet available. You can still paste a known withdrawal hash below.'}</p></div>}
      </section>
      <details className="manual-entry" open={!discovery?.candidates?.length}><summary>Manual recovery with transaction hash <ChevronDown size={16}/></summary>
      <label className="field-label" htmlFor="hash">DBK withdrawal transaction hash <span>Required</span></label>
      <div className="field-group"><Search size={18}/><input id="hash" spellCheck="false" autoComplete="off" value={hash} onChange={e=>setHash(e.target.value)} placeholder="0x... paste your L2 transaction hash"/></div>
      <div className="field-help"><Info size={15}/> Use the original withdrawal transaction on DBK, not the Ethereum transaction.</div>
      <button className="primary-action" disabled={loading!==''||!address||!isHash(hash.trim())} onClick={()=>inspect()}>{loading==='check'?<RefreshCw size={17} className="spin"/>:<Search size={17}/>} {loading==='check'?'Checking withdrawal…':'Check withdrawal status'} <ArrowRight size={17}/></button>
      {!address&&<p className="under-button-note">Connect the wallet that originally initiated the withdrawal.</p>}
      </details>
      <p className="discovery-disclaimer"><Info size={15}/> Explorer candidates are not verified claimable funds. The OP Stack SDK must confirm the exact message status before signing.</p>
     </div>:<div className="tab-body">
      <div className="warning compact"><AlertTriangle size={17}/><div><b>New withdrawal — not recovery</b><p>This starts a new, irreversible DBK transaction. If DBK Chain is stopped, the action remains disabled. For existing pending funds, use “Recover withdrawal”.</p></div></div>
      <label className="field-label" htmlFor="amount">ETH amount to withdraw</label>
      <div className="amount-field"><input id="amount" value={amount} onChange={e=>{setAmount(e.target.value);setPending(null)}} placeholder="0.00" inputMode="decimal"/><span>ETH</span></div>
      <div className="checkline"><input id="ack-new" type="checkbox" checked={ackNew} onChange={e=>setAckNew(e.target.checked)}/><label htmlFor="ack-new">I understand this is a new transaction, not a pending withdrawal recovery.</label></div>
      <button className="primary-action" disabled={loading!==''||!address||!canStart||!ackNew||!/^\d+(\.\d{1,18})?$/.test(amount)||Number(amount)<=0} onClick={()=>prepare('start')}><Send size={16}/> Prepare new withdrawal <ArrowRight size={17}/></button>
      {!canStart&&<p className="under-button-note bad">DBK must be producing recent blocks and Ethereum RPC must be healthy to enable this action.</p>}
     </div>}
     {error&&<div className="error-box" role="alert"><AlertTriangle size={18}/><p>{error}</p><button onClick={()=>setError('')} aria-label="Dismiss">×</button></div>}
     {status&&mode==='recover'&&<div className="status-result">
      <div className="result-head"><div><div className="section-label">WITHDRAWAL STATUS</div><h3>{statusView?.text}</h3></div><Chip className={'status-'+(statusView?.tone||'waiting')}>{statusView?.tone==='action'?'ACTION REQUIRED':statusView?.tone==='success'?'COMPLETE':'PENDING'}</Chip></div>
      <p>{status?.explanation||statusView?.desc}</p>
      
      {status?.status==='RELAYED'&&<div className="finalized-evidence">
       <div className="section-label">ETHEREUM EXECUTION</div>
       {execution?.success===true?<p><CheckCircle2 size={16}/> ETH withdrawal successfully executed on Ethereum. No additional bridge transaction is required. <ButtonLink href={'https://etherscan.io/tx/'+execution.txHash}>View L1 transaction</ButtonLink></p>:
        execution?.success===false?<p className="under-button-note bad"><AlertTriangle size={16}/> The finalization event reports execution failure. Do not retry blindly.</p>:
        <p><Info size={16}/> Withdrawal marked finalized. Transfer-success event has not been verified; check your Ethereum transaction history before assuming the funds arrived.</p>}
      </div>}
      {status?.sourceVerified&&<div className="verified-withdrawal-details">
        <div className="detail-row"><span>Withdrawal</span><b>{Number(status.amount).toLocaleString(undefined,{maximumFractionDigits:12})} ETH</b></div>
        <div className="detail-row"><span>Recipient on Ethereum</span><b>{short(status.recipient,10)}</b></div>
        <div className="detail-row"><span>Withdrawal hash</span><b>{short(status.withdrawalHash,10)}</b></div>
        {status.statusReasonCode&&<p className="under-button-note bad">Diagnostic: {status.statusReasonCode}</p>}
        {!status.recipientIsWallet&&<p className="under-button-note bad">Withdrawal recipient does not match connected wallet. Transaction actions disabled.</p>}
      </div>}
      <div className="timeline animated-timeline">{STEPS.map((s,i)=><div className={'step '+(i<statusView.step?'done':i===statusView.step?'active':'future')} key={s.name}><div className="step-circle">{i<statusView.step?<Check size={15}/>:String(i+1).padStart(2,'0')}</div><div><b>{s.name}</b><span>{s.desc}</span></div></div>)}</div>
      <div className="result-actions">{status.readyToProve&&<button className="primary-action" onClick={()=>prepare('prove')} disabled={!!loading}><ShieldCheck size={17}/> {loading==='prepare'?'Simulating on Ethereum…':'Prepare Prove on Ethereum'} <ArrowRight size={17}/></button>}{status.readyToFinalize&&<button className="primary-action" onClick={()=>prepare('finalize')} disabled={!!loading}><Zap size={17}/> {loading==='prepare'?'Simulating on Ethereum…':'Recover funds · Finalize on Ethereum'} <ArrowRight size={17}/></button>}<ButtonLink href={'https://scan.dbkchain.io/tx/'+hash}>Open on DBK Explorer</ButtonLink></div>
     </div>}
     {pending&&<div className="tx-review"><div className="review-title"><ShieldCheck size={19}/><div><b>Review unsigned transaction</b><span>Your wallet will ask you to confirm.</span></div></div>
      <div className="review-row"><span>Action</span><b>{pending.action.toUpperCase()}</b></div><div className="review-row"><span>Network</span><b>{pending.chainId===1?'Ethereum Mainnet':'DBK Chain'}</b></div><div className="review-row"><span>Contract</span><code>{short(pending.to,10)}</code></div><div className="review-row"><span>Transaction value</span><code>{BigInt(pending.value||'0x0').toString()} wei</code></div><div className="review-row"><span>Estimated network fee</span><b>{gasString}</b></div>
      {pending.amount&&Number(pending.estimatedGasEth)>=Number(pending.amount)&&<div className="warning compact"><AlertTriangle size={17}/><div><b>Gas may exceed the recovery amount</b><p>Estimated network fee is at least the ETH being recovered. You can cancel without signing.</p></div></div>}
      <p className="under-button-note">Read-only Ethereum simulation passed before this transaction was prepared. You still need to approve the transaction yourself in your wallet.</p><details><summary>Inspect contract and calldata <ChevronDown size={14}/></summary><div className="data-field"><span>To</span><code>{pending.to}</code><span>Data (hex)</span><code>{pending.data}</code></div></details>
      <div className="checkline"><input id="confirm-transaction" type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/><label htmlFor="confirm-transaction">I verified the target contract and gas cost. I understand this action uses real funds.</label></div>
      <div className="review-buttons"><button className="ghost-btn" onClick={()=>{setPending(null);setAck(false)}}>Cancel</button><button disabled={!ack||loading==='sign'} className="primary-action" onClick={submit}>{loading==='sign'?<RefreshCw className="spin" size={16}/>:<Wallet size={17}/>} {loading==='sign'?'Waiting for wallet…':'Confirm in wallet'}</button></div>
     </div>}
     {receiptHash&&<div className={'success-box receipt-'+receiptState}><div className="receipt-animation">{receiptState==='confirmed'?<CheckCircle2 size={27}/>:receiptState==='failed'?<AlertTriangle size={27}/>:<RefreshCw size={27} className="spin"/>}</div><div className="receipt-details">
      <b>{receiptState==='confirmed'?(receiptAction==='finalize'?'Finalization transaction confirmed':'Transaction confirmed on-chain'):receiptState==='failed'?'Transaction failed on-chain':'Transaction submitted · awaiting confirmation'}</b>
      <p>{receiptState==='confirmed'?(receiptAction==='finalize'?'Ethereum transaction was confirmed. Check your wallet balance and the bridge status before treating recovery as complete.':'The transaction mined. Your withdrawal may still need the challenge period and another step.'):receiptState==='failed'?'The receipt reports failure. Do not assume funds were recovered.':'The network has not confirmed this transaction yet. This display tracks the transaction receipt; it does not simulate confirmations.'}</p>
      <div className="receipt-track"><span className="receipt-track-line" style={{width:receiptState==='submitted'?'55%':'100%'}}/></div>
      <div className="receipt-stages"><span className="complete">Broadcast</span><span className={receiptState==='submitted'?'awaiting':'complete'}>Mined</span><span className={receiptAction==='finalize'&&receiptState==='confirmed'?'complete':'awaiting'}>{receiptAction==='finalize'?'Verify receipt':'Next bridge stage'}</span></div>
      <ButtonLink href={explorer+receiptHash}>View on explorer {short(receiptHash,10)}</ButtonLink><button className="refresh-link" onClick={()=>{reset();refreshHealth()}}>Refresh withdrawal status <RefreshCw size={13}/></button></div></div>}
     <div className="panel-bottom"><ShieldCheck size={17}/><span>Private keys never leave your wallet. Only documented contracts are permitted.</span></div>
    </div>
    <aside className="sidebar">
     <div className="side-card network-card"><div className="side-title"><span>NETWORK HEALTH</span><button onClick={refreshHealth} aria-label="Refresh network health"><RefreshCw size={15}/></button></div>
      <div className="health-item"><div className="health-icon"><ChainSymbol type="eth"/></div><div className="health-info"><b>Ethereum Mainnet</b><span>Settlement layer</span></div><Chip className={l1Live?'health-ok':'health-off'}>{!health?'CHECKING':l1Live?'ONLINE':'UNAVAILABLE'}</Chip></div>
      <div className="health-item"><div className="health-icon"><ChainSymbol type="dbk"/></div><div className="health-info"><b>DBK Chain</b><span>Source network</span></div><Chip className={!health?'health-wait':dbkLive?'health-ok':'health-off'}>{!health?'CHECKING':dbkLive?'LIVE':'NOT LIVE'}</Chip></div>
      <div className="block-age"><span>Explorer index (read-only)</span><strong>{!health?'Checking…':health?.explorer?.ok?'Reachable':'Unreachable'}</strong></div>
      <div className="block-age"><span>Selected DBK node</span><strong>{health?.dbk?.provider||"None verified"}</strong></div>
<div className="block-age"><span>Historical receipt</span><strong>{health?.dbk?.receiptAvailable?"Indexed":"Unavailable"}</strong></div>
<div className="block-age"><span>Archive proof</span><strong>{health?.dbk?.proofAvailable?"Available":"Unverified"}</strong></div>
<div className="block-age"><span>Latest DBK block</span><strong>{health?.dbk?.ok?'#'+health.dbk.latestBlock:'Not available'}</strong></div><div className="block-age"><span>Last block age</span><strong>{health?.dbk?.ok?fmtAge(health.dbk.blockAgeSeconds):'Unknown'}</strong></div>
      {!dbkLive&&health&&<div className="network-warning"><AlertTriangle size={16}/><p>DBK RPC is unreachable or its latest block is stale. Recovery may still be possible if historical RPC data and L1 proofs are available; no guarantees.</p></div>}
      <p className="health-footnote">The official, Thirdweb, and RouteMesh DBK nodes are tested against the historical withdrawal receipt. Explorer access alone is not enough to finalize. Only sign if proof and on-chain status can be confirmed.</p>
     </div>
     <div className="side-card details-card"><div className="side-title"><span>BRIDGE DETAILS</span><FileCode2 size={16}/></div><div className="detail-row"><span>Protocol</span><b>OP Stack</b></div><div className="detail-row"><span>Source chain</span><b>DBK · 20240603</b></div><div className="detail-row"><span>Destination</span><b>Ethereum · 1</b></div><div className="detail-row"><span>Challenge period</span><b>On-chain determined</b></div><div className="detail-row"><span>Network gas</span><b>Paid to chains</b></div><div className="contract-title">L1 OPTIMISM PORTAL</div><button className="address-row" onClick={copyAddress} title="Copy documented portal address"><code>{short(CONTRACT,13)}</code>{copied?<Check size={15}/>:<Copy size={15}/>}</button><ButtonLink href={'https://etherscan.io/address/'+CONTRACT}>Verify on Etherscan</ButtonLink></div>
     <div className="side-card note-card"><div className="help-label"><Info size={16}/> KNOW BEFORE YOU SIGN</div><p>This is an independent recovery interface, <b>not</b> the official DBK bridge. A working website cannot restart a stopped sequencer or publish missing state roots.</p><ButtonLink href="https://docs.dbkchain.io/bridge/bridge-sdk">DBK official bridge docs</ButtonLink></div>
    </aside>
   </section>
   <section id="how-it-works" className="how"><div className="section-label">02 / THE PROCESS</div><div className="how-header"><h2>A bridge in four stages.</h2><p>For OP Stack withdrawals, funds are only released on Ethereum after the required L1 steps succeed.</p></div><div className="how-grid">{STEPS.map((s,i)=><div className="how-step" key={s.name}><div className="how-top"><span>0{i+1}</span>{i===0?<Send size={20}/>:i===1?<ShieldCheck size={20}/>:i===2?<Clock3 size={20}/>:<CheckCircle2 size={20}/>}</div><h3>{s.name}</h3><p>{['Submit withdrawal on DBK Chain. Skip this if you already initiated it.','Prove the published L2 message on Ethereum, if supported.','Wait for the protocol challenge period. It may reset on upgrades.','Finalize when the SDK confirms readiness and your wallet approves.'][i]}</p></div>)}</div></section>
  </main><footer><div><span className="footer-brand">dbk<span>portal</span></span> <span>Open-source, independent recovery interface. No guarantee of fund recovery.</span></div><div><a href="https://github.com/ariefzzz5421/dbk-chain-bridge-" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13}/></a><a href="https://docs.optimism.io/" target="_blank" rel="noreferrer">Optimism Docs <ArrowUpRight size={13}/></a></div></footer>
 </div>;
}
function MissingConfig(){
 return <div className="missing-screen"><div className="brand-mark"><ArrowUpRight/></div><h1>DBK Recovery Bridge</h1><p>The application is deployed, but Privy wallet connections are not enabled yet.</p><div className="missing-note"><b>One-time setup</b><span>Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in Vercel's project environment variables and redeploy. Create your application at <a href="https://dashboard.privy.io/" target="_blank" rel="noreferrer">dashboard.privy.io <ExternalLink size={13}/></a>.</span><span>Add your production domain to Privy's allowed origins.</span></div><p className="subtle">No seed phrase or private key is ever required.</p></div>;
}
export default function Page(){
 if(!APP_ID)return <MissingConfig/>;
 return <PrivyProvider appId={APP_ID} config={{loginMethods:['wallet'],appearance:{theme:'dark',accentColor:'#9778fa'},supportedChains:[mainnet,DBK],defaultChain:mainnet}}><AppInner/></PrivyProvider>;
}
