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
 RELAYED:{step:4,text:'Withdrawal completed',tone:'success',desc:'Optimism SDK reports this withdrawal as successfully relayed.'},
};
async function api(path,options){
 const response=await fetch('/api/bridge'+path,{cache:'no-store',...options});
 const data=await response.json();
 if(!response.ok||!data.ok)throw new Error(data.error||'Request failed');
 return data;
}
function Chip({children,className=''}){return <span className={'chip '+className}>{children}</span>}
function ChainSymbol({type}) {return <div className={'chain-symbol '+type}>{type==='dbk'?<span>dbk</span>:<span className="eth-symbol">◆</span>}</div>}
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
 const statusView=status?.status ? statusInfo[status.status]||{step:0,text:status.status.replaceAll('_',' '),tone:'waiting',desc:'Review this message state before acting.'}:null;
 const dbkLive=!!health?.dbk?.ok&&!!health?.dbk?.live;
 const l1Live=!!health?.ethereum?.ok;
 const canStart=dbkLive&&l1Live;
 const explorer=receiptChain===1?'https://etherscan.io/tx/':'https://scan.dbkchain.io/tx/';
 useEffect(()=>{refreshHealth()},[]);
 useEffect(()=>{setStatus(null);setPending(null);setReceiptHash('');setError('');setAck(false);},[hash,mode,walletIndex]);
 const gasString=useMemo(()=>pending?.estimatedGasEth?Number(pending.estimatedGasEth).toFixed(7)+' ETH':'Unavailable', [pending]);
 async function refreshHealth(){
  try{const data=await api('?mode=health');setHealth(data.health)}catch(e){setHealth({dbk:{ok:false,error:e.message},ethereum:{ok:false,error:e.message}})}
 }
 async function inspect(){
  if(!address){setError('Connect your original withdrawal wallet first.');return;}
  if(!isHash(hash.trim())){setError('Please enter a valid 0x-prefixed 32-byte DBK transaction hash.');return;}
  setError('');setLoading('check');setPending(null);
  try{const data=await api('?mode=status&hash='+encodeURIComponent(hash.trim())+'&address='+encodeURIComponent(address));setStatus(data)}catch(e){setStatus(null);setError(e.message)}finally{setLoading('')}
 }
 async function prepare(action){
  if(!address){setError('Connect your original wallet first.');return;}
  if(action==='start'&&!ackNew){setError('Acknowledge the irreversible withdrawal warning.');return;}
  setLoading('prepare');setError('');setPending(null);setAck(false);
  try{
   const data=await api('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,address,hash:hash.trim(),amount:amount.trim()})});
   const tx=data.transaction;
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
   if(current.to.toLowerCase()!==pending.to.toLowerCase()||current.data!==pending.data||current.value!==pending.value)throw new Error('Withdrawal calldata changed. Review again.');
   const raw={from:address,to:pending.to,data:pending.data,value:pending.value};
   await provider.request({method:'eth_estimateGas',params:[raw]});
   const sent=await provider.request({method:'eth_sendTransaction',params:[raw]});
   setReceiptHash(sent);setReceiptChain(pending.chainId);setPending(null);setAck(false);setStatus(null);
   refreshHealth();
  }catch(e){setError(e?.message||'Wallet rejected or transaction failed.')}finally{setLoading('')}
 }
 function reset(){setStatus(null);setPending(null);setReceiptHash('');setError('');setAck(false)}
 async function copyAddress(){try{await navigator.clipboard.writeText(CONTRACT);setCopied(true);setTimeout(()=>setCopied(false),1700)}catch{}}
 return <div className="app-frame">
  <div className="ambient glow-one"/><div className="ambient glow-two"/>
  <header className="topbar">
   <div className="brand"><div className="brand-mark"><ArrowUpRight size={20} strokeWidth={2.8}/></div><div><b>DBK<span>PORTAL</span></b><small>RECOVERY INTERFACE</small></div></div>
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
     <div className="panel-top"><div><div className="section-label">01 / BRIDGE CONSOLE</div><h2>Withdraw to Ethereum</h2></div><Chip className="protocol-chip"><Link2 size={12}/> OP STACK</Chip></div>
     <div className="route"><div className="route-chain"><ChainSymbol type="dbk"/><div><span className="minor">FROM</span><strong>DBK Chain</strong><small>Chain ID 20240603</small></div></div><div className="route-arrow"><ArrowRight size={20}/></div><div className="route-chain"><ChainSymbol type="eth"/><div><span className="minor">TO</span><strong>Ethereum</strong><small>Mainnet · Chain ID 1</small></div></div></div>
     <div className="tabs"><button className={mode==='recover'?'selected':''} onClick={()=>setMode('recover')}><ArrowDownLeft size={15}/> Recover withdrawal</button><button className={mode==='new'?'selected':''} onClick={()=>setMode('new')}><Send size={15}/> New withdrawal</button></div>
     {mode==='recover'?<div className="tab-body">
      <label className="field-label" htmlFor="hash">DBK withdrawal transaction hash <span>Required</span></label>
      <div className="field-group"><Search size={18}/><input id="hash" spellCheck="false" autoComplete="off" value={hash} onChange={e=>setHash(e.target.value)} placeholder="0x... paste your L2 transaction hash"/></div>
      <div className="field-help"><Info size={15}/> Use the original withdrawal transaction on DBK, not the Ethereum transaction.</div>
      <button className="primary-action" disabled={loading!==''||!address||!isHash(hash.trim())} onClick={inspect}>{loading==='check'?<RefreshCw size={17} className="spin"/>:<Search size={17}/>} {loading==='check'?'Checking withdrawal…':'Check withdrawal status'} <ArrowRight size={17}/></button>
      {!address&&<p className="under-button-note">Connect the wallet that originally initiated the withdrawal.</p>}
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
      <p>{statusView?.desc}</p>
      <div className="timeline">{STEPS.map((s,i)=><div className={'step '+(i<statusView.step?'done':i===statusView.step?'active':'future')} key={s.name}><div className="step-circle">{i<statusView.step?<Check size={15}/>:String(i+1).padStart(2,'0')}</div><div><b>{s.name}</b><span>{s.desc}</span></div></div>)}</div>
      <div className="result-actions">{status.readyToProve&&<button className="primary-action" onClick={()=>prepare('prove')} disabled={!!loading}><ShieldCheck size={17}/> Prepare Prove <ArrowRight size={17}/></button>}{status.readyToFinalize&&<button className="primary-action" onClick={()=>prepare('finalize')} disabled={!!loading}><Zap size={17}/> Prepare Finalize <ArrowRight size={17}/></button>}<ButtonLink href={'https://scan.dbkchain.io/tx/'+hash}>Open on DBK Explorer</ButtonLink></div>
     </div>}
     {pending&&<div className="tx-review"><div className="review-title"><ShieldCheck size={19}/><div><b>Review unsigned transaction</b><span>Your wallet will ask you to confirm.</span></div></div>
      <div className="review-row"><span>Action</span><b>{pending.action.toUpperCase()}</b></div><div className="review-row"><span>Network</span><b>{pending.chainId===1?'Ethereum Mainnet':'DBK Chain'}</b></div><div className="review-row"><span>Contract</span><code>{short(pending.to,10)}</code></div><div className="review-row"><span>Transaction value</span><code>{BigInt(pending.value||'0x0').toString()} wei</code></div><div className="review-row"><span>Estimated network fee</span><b>{gasString}</b></div><details><summary>Inspect contract and calldata <ChevronDown size={14}/></summary><div className="data-field"><span>To</span><code>{pending.to}</code><span>Data (hex)</span><code>{pending.data}</code></div></details>
      <div className="checkline"><input id="confirm-transaction" type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/><label htmlFor="confirm-transaction">I verified the target contract and gas cost. I understand this action uses real funds.</label></div>
      <div className="review-buttons"><button className="ghost-btn" onClick={()=>{setPending(null);setAck(false)}}>Cancel</button><button disabled={!ack||loading==='sign'} className="primary-action" onClick={submit}>{loading==='sign'?<RefreshCw className="spin" size={16}/>:<Wallet size={17}/>} {loading==='sign'?'Waiting for wallet…':'Confirm in wallet'}</button></div>
     </div>}
     {receiptHash&&<div className="success-box"><CheckCircle2 size={23}/><div><b>Transaction submitted</b><p>Wallet broadcast your transaction. This is not yet confirmation of final recovery; wait for it to mine and refresh the status.</p><ButtonLink href={explorer+receiptHash}>View transaction {short(receiptHash,10)}</ButtonLink><button className="refresh-link" onClick={()=>{reset();refreshHealth()}}>Refresh status <RefreshCw size={13}/></button></div></div>}
     <div className="panel-bottom"><ShieldCheck size={17}/><span>Private keys never leave your wallet. Only documented contracts are permitted.</span></div>
    </div>
    <aside className="sidebar">
     <div className="side-card network-card"><div className="side-title"><span>NETWORK HEALTH</span><button onClick={refreshHealth} aria-label="Refresh network health"><RefreshCw size={15}/></button></div>
      <div className="health-item"><div className="health-icon"><ChainSymbol type="eth"/></div><div className="health-info"><b>Ethereum Mainnet</b><span>Settlement layer</span></div><Chip className={l1Live?'health-ok':'health-off'}>{!health?'CHECKING':l1Live?'ONLINE':'UNAVAILABLE'}</Chip></div>
      <div className="health-item"><div className="health-icon"><ChainSymbol type="dbk"/></div><div className="health-info"><b>DBK Chain</b><span>Source network</span></div><Chip className={!health?'health-wait':dbkLive?'health-ok':'health-off'}>{!health?'CHECKING':dbkLive?'LIVE':'NOT LIVE'}</Chip></div>
      <div className="block-age"><span>Latest DBK block</span><strong>{health?.dbk?.ok?'#'+health.dbk.latestBlock:'Not available'}</strong></div><div className="block-age"><span>Last block age</span><strong>{health?.dbk?.ok?fmtAge(health.dbk.blockAgeSeconds):'Unknown'}</strong></div>
      {!dbkLive&&health&&<div className="network-warning"><AlertTriangle size={16}/><p>DBK RPC is unreachable or its latest block is stale. Recovery may still be possible if historical RPC data and L1 proofs are available; no guarantees.</p></div>}
      <p className="health-footnote">Health checks use the official DBK RPC plus Ethereum contract-code verification. “Live” does not guarantee a functioning bridge.</p>
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
