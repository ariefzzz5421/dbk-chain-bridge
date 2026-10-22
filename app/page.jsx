'use client';
import {useEffect,useState} from 'react';
import {ethers} from 'ethers';
import {Provider,L1Signer} from 'zksync-ethers';
import {Wallet,ArrowRight,ArrowUpRight,ShieldCheck,LockKeyhole,Activity,RefreshCcw,ExternalLink,AlertTriangle,CheckCircle2,Info} from 'lucide-react';

const BASE='0x000000000000000000000000000000000000800a';
const LOGO='https://ipfs.io/ipfs/bafkreib5jsvl6kxn2qvv4giag3l3e54d2wolo2lqbgkhivxu4cpjzi77eq';
const RPC='https://rpc.zkcandy.io';
const short=s=>s?s.slice(0,7)+'…'+s.slice(-5):'—';
const validHash=s=>/^0x[a-fA-F0-9]{64}$/.test(s||'');
async function api(query='',opts={}){
 const res=await fetch('/api/zkcandy'+query,{cache:'no-store',...opts});
 const json=await res.json();if(!res.ok||!json.ok)throw Error(json.error||'Request failed');return json;
}
async function switchNetwork(wallet,chain){
 const id='0x'+chain.toString(16);
 try{await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:id}]})}
 catch(e){if(chain===320&&(e.code===4902||e?.data?.originalError?.code===4902))
   await wallet.request({method:'wallet_addEthereumChain',params:[{chainId:id,chainName:'ZKcandy Mainnet',
    nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[RPC],blockExplorerUrls:['https://explorer.zkcandy.io']}]});
 else throw e;}
 if(Number(await wallet.request({method:'eth_chainId'}))!==chain)throw Error('Wallet network mismatch');
}
function ChainIcon({z=false}){const [fallback,setFallback]=useState(false);
 return z?<span className="coin candy">{!fallback?<img src={LOGO} width="44" height="44" alt="ZKcandy official network icon" onError={()=>setFallback(true)}/>:<b>ZK</b>}</span>:
 <span className="coin eth"><svg viewBox="0 0 256 417" width="21" height="34" aria-label="Ethereum"><path fill="#a4b3fa" d="M127.9 0 125.1 9.5v269.7l2.8 2.8 127.9-75.6z"/><path fill="#6378d7" d="M127.9 0 0 206.4 127.9 282V154.1z"/><path fill="#5370bd" d="m127.9 306.2-2.8 3.4v105.1l2.8 2.2L255.9 230z"/><path fill="#9daffc" d="M127.9 416.9V306.2L0 230z"/></svg></span>;
}
function Ext({href,children}){return <a href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={13}/></a>}
export default function Home(){
 const [address,setAddress]=useState(''),[health,setHealth]=useState(null),[balance,setBalance]=useState('');
 const [tab,setTab]=useState('new'),[amount,setAmount]=useState(''),[hash,setHash]=useState('');
 const [status,setStatus]=useState(null),[preview,setPreview]=useState(null);
 const [ack,setAck]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[tx,setTx]=useState(null);
 const wallet=typeof window!=='undefined'?window.ethereum:null;
 useEffect(()=>{
   refresh();if(!wallet)return;
   wallet.request({method:'eth_accounts'}).then(a=>setAddress(a?.[0]||'')).catch(()=>{});
   const change=()=>{setPreview(null);setStatus(null);setAck(false);setTx(null);setError('Wallet or network changed. Recheck details before signing.')};
   const accounts=a=>{setAddress(a?.[0]||'');change()};
   wallet.on?.('accountsChanged',accounts);wallet.on?.('chainChanged',change);
   return()=>{wallet.removeListener?.('accountsChanged',accounts);wallet.removeListener?.('chainChanged',change)};
 },[]);
 useEffect(()=>{if(!address){setBalance('');return}api('?mode=balance&address='+encodeURIComponent(address)).then(x=>setBalance(x.balance)).catch(()=>setBalance(''))},[address,tx]);
 async function refresh(){try{setHealth(await api('?mode=health'))}catch(e){setHealth({ok:false,withdrawalsEnabled:false,reason:e.message})}}
 function clear(){setError('');setTx(null);setPreview(null);setStatus(null);setAck(false)}
 async function connect(){if(!wallet)return setError('Please open this page in MetaMask or Rabby. No injected wallet was found.');
  try{setBusy('Connecting');setAddress((await wallet.request({method:'eth_requestAccounts'}))?.[0]||'')}catch(e){setError(e.message)}finally{setBusy('')}}
 async function prepare(){clear();if(!address)return setError('Connect the original wallet first.');
   setBusy('Preparing');try{const j=await api('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepareETH',address,amount:amount.trim()})});setPreview(j.transaction)}
   catch(e){setError(e.message)}finally{setBusy('')}}
 async function start(){
   if(!ack||!preview||!wallet)return;
   setError('');setBusy('Revalidating');
   try{const j=await api('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepareETH',address,amount:preview.amount})});
     const p=j.transaction;
     if(p.to.toLowerCase()!==BASE||p.data!==preview.data||p.value!==preview.value||p.recipient.toLowerCase()!==address.toLowerCase())throw Error('Withdrawal payload changed. Blocked.');
     await switchNetwork(wallet,320);setBusy('Wallet confirmation');
     const unsigned={from:address,to:p.to,data:p.data,value:p.value};
     await wallet.request({method:'eth_estimateGas',params:[unsigned]});
     const sent=await wallet.request({method:'eth_sendTransaction',params:[unsigned]});
     setTx({hash:sent,chain:320,label:'L2 withdrawal broadcast'});setHash(sent);setTab('finalize');setPreview(null);setAck(false);
   }catch(e){setError(e?.shortMessage||e.message)}finally{setBusy('')}}
 async function inspect(){
   setError('');setStatus(null);setAck(false);
   if(!address||!validHash(hash))return setError('Connect your original wallet and enter its 0x withdrawal transaction hash.');
   setBusy('Inspecting');try{setStatus(await api('?mode=status&hash='+encodeURIComponent(hash)+'&address='+encodeURIComponent(address)))}
   catch(e){setError(e.message)}finally{setBusy('')}}
 async function finalize(){
   if(!ack||!status?.executed||!status?.proofAvailable||!wallet||!address)return;
   setBusy('Validating');setError('');
   try{
     await switchNetwork(wallet,1);
     const signer=await new ethers.BrowserProvider(wallet).getSigner();
     if((await signer.getAddress()).toLowerCase()!==address.toLowerCase())throw Error('Wrong connected wallet');
     const zkProvider=new Provider(RPC);
     if(Number((await zkProvider.getNetwork()).chainId)!==320)throw Error('Invalid L2 network');
     const l1=L1Signer.from(signer,zkProvider);
     if(await l1.isWithdrawalFinalized(hash)){setStatus(s=>({...s,finalized:true}));setTx({hash,chain:320,label:'Withdrawal already finalized'});return}
     await l1.finalizeWithdrawalParams(hash);
     const check=await api('?mode=status&hash='+encodeURIComponent(hash)+'&address='+encodeURIComponent(address));
     if(!check.executed||!check.proofAvailable)throw Error('Proof no longer available. Signature blocked.');
     setBusy('Wallet confirmation');
     const sent=await l1.finalizeWithdrawal(hash);
     setTx({hash:sent.hash,chain:1,label:'L1 finalization broadcast'});setStatus(null);setAck(false);
   }catch(e){setError(e?.shortMessage||e?.message||'Could not finalize')}finally{setBusy('')}
 }
 const ready=!!health?.withdrawalsEnabled;
 return <div className="app">
 <div className="ambient ambient1"/><div className="ambient ambient2"/>
 <header className="header shell"><div className="brand"><ChainIcon z/><div><strong>STUCK <em>BRIDGE</em> FUND</strong><small>ZKcandy Recovery Console</small></div></div>
 <nav><a href="#bridge">Bridge</a><a href="#how">How it works</a><Ext href="https://docs.zksync.io/zksync-protocol/rollup/bridging-assets">Official docs</Ext></nav>
 <button onClick={connect} className="connect"><Wallet size={16}/>{address?short(address):'Connect Wallet'}</button></header>
 <main className="shell">
  <section className="hero"><div className="eyebrow"><i/> ZK STACK · SELF-CUSTODIAL RECOVERY</div>
    <h1>Move funds <span>back to Ethereum.</span></h1>
    <p>Use the native ZKsync withdrawal flow from ZKcandy to Ethereum. Inspect your funds, check L1 settlement, and sign only transactions you approve.</p>
    <div className="pills"><span><ShieldCheck size={15}/> Self-custodial</span><span><LockKeyhole size={15}/> No seed phrases</span><span><Activity size={15}/> On-chain checks</span></div></section>
  <div className="workspace" id="bridge">
   <div className="panel">
    <div className="panel-title"><div><div className="micro">01 / BRIDGE CONSOLE</div><h2>ZKcandy to Ethereum</h2></div><span className="tag">ZK STACK</span></div>
    <div className="route"><div className="chain"><ChainIcon z/><div><small>FROM</small><strong>ZKcandy</strong><span>Chain ID 320</span></div></div><div className="arrow"><ArrowRight size={19}/></div><div className="chain"><ChainIcon/><div><small>TO</small><strong>Ethereum</strong><span>Chain ID 1</span></div></div></div>
    <div className="tabs"><button className={tab==='new'?'active':''} onClick={()=>{setTab('new');clear()}}>New ETH withdrawal</button><button className={tab==='finalize'?'active':''} onClick={()=>{setTab('finalize');clear()}}>Finalize existing</button></div>
    {!health?.ok?<div className="warning"><AlertTriangle size={18}/><div><b>Cannot reach ZKcandy</b><p>{health?.reason||'Checking endpoints.'} Signing disabled.</p></div></div>:!ready?<div className="warning"><AlertTriangle size={18}/><div><b>New withdrawals are blocked</b><p>No recent Ethereum batch execution was independently verified. Submitting a new L2 withdrawal may put more funds at risk. Existing claims may still be checked.</p></div></div>:<div className="good"><CheckCircle2 size={17}/> Recent Ethereum settlement verified. Future withdrawals are not guaranteed.</div>}
    {tab==='new'?<div className="form">
     <label>ZKCANDY ETH BALANCE</label><div className="balance"><strong>{balance?Number(balance).toLocaleString(undefined,{maximumFractionDigits:8})+' ETH':'Connect wallet to view balance'}</strong><button title="Refresh balance" onClick={()=>address&&api('?mode=balance&address='+encodeURIComponent(address)).then(x=>setBalance(x.balance)).catch(e=>setError(e.message))}><RefreshCcw size={14}/></button></div>
     <label htmlFor="amount">Amount to withdraw</label><div className="amount"><input id="amount" type="text" inputMode="decimal" placeholder="0.00" value={amount} onChange={e=>{setAmount(e.target.value);clear()}}/><span>ETH</span></div>
     <div className="recipient"><span>Ethereum destination: same wallet</span><code>{short(address)}</code></div>
     <p className="hint"><Info size={15}/> Native ETH only. Funds are not guaranteed to be recoverable if ZKcandy settlement stops.</p>
     {preview?<div className="review"><div className="review-title">Withdrawal preview <span>Verified by SDK</span></div><div className="kv"><span>Amount</span><b>{preview.amount} ETH</b></div><div className="kv"><span>System contract</span><code>{short(preview.to)}</code></div><div className="kv"><span>Recipient</span><code>{short(preview.recipient)}</code></div><div className="kv"><span>Gas units</span><span>{preview.gasEstimate}</span></div>
        <label className="accept"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I understand the withdrawal is irreversible and Ethereum recovery is not guaranteed.</label>
        <button className="primary" onClick={start} disabled={!ack||!!busy}>{busy||'Sign withdrawal'} <ArrowUpRight size={17}/></button></div>:
        <button className="primary" disabled={!address||!ready||!amount||!!busy} onClick={prepare}>{busy||'Verify & preview'} <ArrowRight size={17}/></button>}
    </div>:<div className="form">
     <label htmlFor="txhash">L2 withdrawal transaction hash</label><input className="hash" id="txhash" placeholder="0x..." value={hash} onChange={e=>{setHash(e.target.value);setStatus(null);setAck(false)}}/>
     <p className="hint"><Info size={15}/> This must be the native ETH withdrawal transaction initiated by the connected wallet, not a normal transfer.</p>
     <button className="primary muted" onClick={inspect} disabled={!address||!validHash(hash)||!!busy}>{busy||'Inspect on-chain status'} <Activity size={17}/></button>
     {status?<div className="review"><div className="review-title">Withdrawal record <span>{status.proofAvailable&&status.executed?'Proof found':'Waiting'}</span></div>
        <div className="kv"><span>ETH withdrawn</span><b>{status.amount} ETH</b></div>
        <div className="kv"><span>Executed batch</span><b>{status.executed?'Reported':'Not yet confirmed'}</b></div>
        <div className="kv"><span>Inclusion proof</span><b>{status.proofAvailable?'Available':'Unavailable'}</b></div>
        <p className="hint">{status.note}</p>
        {status.finalized?<div className="good">Already finalized; no new signature required.</div>:status.proofAvailable&&status.executed?<><label className="accept"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I understand L1 gas fees may be charged even if the finalization reverts.</label>
        <button className="primary" onClick={finalize} disabled={!ack||!!busy}>{busy||'Finalize via ZKsync SDK'} <ArrowUpRight size={17}/></button></>:null}
      </div>:null}
    </div>}
    {error?<div role="alert" className="error"><AlertTriangle size={17}/><span>{error}</span></div>:null}
    {tx?<div className="success"><CheckCircle2 size={18}/><div><b>{tx.label}</b><p>Broadcast is not the same as completed recovery. Check transaction receipt.</p><Ext href={(tx.chain===1?'https://etherscan.io/tx/':'https://explorer.zkcandy.io/tx/')+tx.hash}>View transaction</Ext></div></div>:null}
   </div>
   <aside><div className="side-panel"><div className="micro">02 / NETWORK MONITOR</div><h3>Exit readiness</h3>
    <div className="stat"><span>ZKcandy RPC</span><strong className={health?.ok?'green':'red'}>{health?.ok?'Responding':'Unavailable'}</strong></div>
    <div className="stat"><span>Ethereum RPC</span><strong className={health?.ethereumOnline?'green':'red'}>{health?.ethereumOnline?'Responding':'Unavailable'}</strong></div>
    <div className="stat"><span>Current L2 block</span><strong>{health?.latestBlock?.toLocaleString()||'—'}</strong></div>
    <div className="stat"><span>Recent L1 execution</span><strong className={ready?'green':'red'}>{ready?'Verified':'Unverified'}</strong></div>
    <button className="secondary" onClick={refresh}><RefreshCcw size={15}/> Refresh network</button>
    <p className="hint">An online RPC does not imply a working withdrawal. The operator and settlement proof pipeline must also function.</p>
   </div><div className="side-panel safety"><div className="micro">SAFETY RULES</div><h3>Never share</h3><p><ShieldCheck size={16}/> Seed phrase or private keys</p><p><LockKeyhole size={16}/> Recovery fees to a third party</p><p><CheckCircle2 size={16}/> Arbitrary token approvals</p></div></aside>
  </div>
  <section className="how" id="how"><div className="micro">RECOVERY PROCESS</div><h2>One bridge. Two stages.</h2><div className="steps">{[
   ['01','Initiate on ZKcandy','Native ETH calls the verified L2 BaseToken contract. New withdrawals are blocked if recent L1 execution is missing.'],
   ['02','Wait for L1 proof','The ZKcandy operator must execute the batch and expose a withdrawal proof. An RPC response alone is insufficient.'],
   ['03','Finalize on Ethereum','The official ZKsync SDK verifies proof state and attempts finalization with your wallet approval.']
  ].map(([num,title,description])=><div className="step" key={num}><span>{num}</span><h3>{title}</h3><p>{description}</p></div>)}</div></section>
  <footer><span>Unofficial recovery interface, not operated by ZKcandy</span><div><Ext href="https://github.com/ariefzzz5421/stuck-fund-bridge">Source</Ext><Ext href="https://explorer.zkcandy.io">Explorer</Ext><Ext href="https://docs.zksync.io/zksync-protocol/rollup/bridging-assets">Docs</Ext></div></footer>
 </main></div>;
}
