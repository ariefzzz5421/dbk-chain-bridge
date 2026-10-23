'use client';
import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { Provider, L1Signer } from 'zksync-ethers';
import { ArrowDown, ArrowRight, Check, ChevronDown, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck, Wallet, AlertCircle } from 'lucide-react';

const CFG={
 dbk:{label:'DBK Chain',id:20240603,rpc:'https://rpc.mainnet.dbkchain.io/',explorer:'https://scan.dbkchain.io/tx/'},
 zkcandy:{label:'ZKcandy',id:320,rpc:'https://rpc.zkcandy.io',explorer:'https://explorer.zkcandy.io/tx/'}
};
const PASSER='0x4200000000000000000000000000000000000016';
const BASE='0x000000000000000000000000000000000000800a';
const PORTAL='0x63CA00232F471bE2A3Bf3C4e95Bc1d2B3EA5DB92';
const DBK_ABI=new ethers.Interface(['function initiateWithdrawal(address,uint256,bytes) payable']);
const ZK_ABI=new ethers.Interface(['function withdraw(address) payable']);
const validHash=h=>/^0x[a-fA-F0-9]{64}$/.test(h||'');
const short=s=>s?s.slice(0,7)+'…'+s.slice(-5):'';
const fmt=x=>x==null?'Unavailable':Number(x).toLocaleString('en-US',{maximumFractionDigits:8});
async function endpoint(url,options={}){
 const response=await fetch(url,{cache:'no-store',...options});
 const data=await response.json();
 if(!response.ok||data.ok===false)throw Error(data.message||'Could not verify this operation. Please retry.');
 return data;
}
async function post(data){return endpoint('/api/simple-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})}
async function switchNetwork(wallet,id){
 const hex=ethers.toBeHex(id);
 try{await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:hex}]})}
 catch(e){
  if((e.code===4902||e?.data?.originalError?.code===4902)&&id!==1){
   const c=Object.values(CFG).find(c=>c.id===id);
   await wallet.request({method:'wallet_addEthereumChain',params:[{chainId:hex,chainName:c.label,
    nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[c.rpc],
    blockExplorerUrls:[c.explorer.replace(/\/tx\/$/,'')]}]});
  }else throw e;
 }
 if(Number(await wallet.request({method:'eth_chainId'}))!==id)throw Error('Select the requested network in your wallet.');
}
function checkQuote(t,chain,address,amount){
 if(!t||t.chainId!==CFG[chain].id||t.from?.toLowerCase()!==address.toLowerCase()||
 t.recipient?.toLowerCase()!==address.toLowerCase()||BigInt(t.value||0)!==ethers.parseEther(amount))throw Error('Withdrawal recipient or amount mismatch.');
 if(chain==='dbk'){
  if(t.to?.toLowerCase()!==PASSER.toLowerCase())throw Error('Unexpected DBK bridge contract.');
  const call=DBK_ABI.parseTransaction({data:t.data,value:t.value});
  if(call?.name!=='initiateWithdrawal'||call.args[0].toLowerCase()!==address.toLowerCase()||call.args[1]!==100000n||call.args[2]!=='0x')
   throw Error('Unexpected withdrawal transaction.');
 }else{
  if(t.to?.toLowerCase()!==BASE.toLowerCase())throw Error('Unexpected ZKcandy bridge contract.');
  const call=ZK_ABI.parseTransaction({data:t.data,value:t.value});
  if(call?.name!=='withdraw'||call.args[0].toLowerCase()!==address.toLowerCase())throw Error('Unexpected withdrawal transaction.');
 }
}
function ethIcon(){return <svg viewBox="0 0 256 417" width="23" height="34" aria-label="Ether"><path fill="#b5baff" d="M127.9 0 125.1 9.5v269.7l2.8 2.8 127.9-75.6z"/><path fill="#6f86df" d="M127.9 0 0 206.4 127.9 282V154.1z"/><path fill="#536aba" d="m127.9 306.2-2.8 3.4v105.1l2.8 2.2L255.9 230z"/><path fill="#9aabf4" d="M127.9 416.9V306.2L0 230z"/></svg>}
const walletProvider=()=>typeof window!=='undefined'?window.ethereum:null;
const keyOf=a=>'stuck-bridge:v2:'+a.toLowerCase();

export default function Home(){
 const [address,setAddress]=useState('');
 const [chain,setChain]=useState('dbk');
 const [balances,setBalances]=useState(null);
 const [amount,setAmount]=useState('');
 const [quote,setQuote]=useState(null);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const [l2Hash,setL2Hash]=useState('');
 const [l1Hash,setL1Hash]=useState('');
 const [status,setStatus]=useState(null);
 const [statusError,setStatusError]=useState('');
 const [manualHash,setManualHash]=useState('');
 const [ack,setAck]=useState(false);
 const [scanning,setScanning]=useState(false);
 const [tracking,setTracking]=useState(false);
 const [busy,setBusy]=useState('');
 const wallet=walletProvider();
 const selected=CFG[chain],balance=balances?.[chain];
 const fee=quote?.transaction?.gasEstimate&&quote?.transaction?.gasPrice
  ?ethers.formatEther(BigInt(quote.transaction.gasEstimate)*BigInt(quote.transaction.gasPrice)):'Unavailable';
 const saveTrack=useCallback((owner,network,hash,l1='')=>{
   if(!owner)return;
   try{window.localStorage.setItem(keyOf(owner),JSON.stringify({chain:network,hash,l1}))}catch{}
 },[]);
 const refreshBalances=useCallback(async(owner)=>{
  if(!owner){setBalances(null);return}
  setScanning(true);
  try{const j=await endpoint('/api/simple-bridge?mode=balances&address='+encodeURIComponent(owner));setBalances(j.balances)}
  catch(e){setBalances(null);setError('Could not scan balances. Your funds have not moved.')}
  finally{setScanning(false)}
 },[]);
 useEffect(()=>{
  if(!wallet)return;
  let live=true;
  const init=async()=>{
   try{const accounts=await wallet.request({method:'eth_accounts'});if(live)setAddress(accounts?.[0]||'')}catch{}
  };
  const accountChanged=accounts=>{setAddress(accounts?.[0]||'');setQuote(null);setStatus(null);setL2Hash('');setL1Hash('');setError('')};
  const networkChanged=()=>{setQuote(null);setAck(false)};
  init();
  wallet.on?.('accountsChanged',accountChanged);wallet.on?.('chainChanged',networkChanged);
  return()=>{live=false;wallet.removeListener?.('accountsChanged',accountChanged);wallet.removeListener?.('chainChanged',networkChanged)};
 },[]);
 useEffect(()=>{
  if(!address){setBalances(null);setStatus(null);setL2Hash('');setL1Hash('');return}
  refreshBalances(address);
  try{
   const raw=window.localStorage.getItem(keyOf(address));
   if(raw){
    const previous=JSON.parse(raw);
    if(CFG[previous.chain]&&validHash(previous.hash)){
     setChain(previous.chain);setL2Hash(previous.hash);
     if(validHash(previous.l1))setL1Hash(previous.l1);
    }
   }
  }catch{}
 },[address,refreshBalances]);
 const checkStatus=useCallback(async(source=chain,hash=l2Hash,owner=address)=>{
  if(!owner||!validHash(hash))return;
  setTracking(true);setStatusError('');
  try{
   const params=new URLSearchParams({mode:'status',address:owner,chain:source,hash});
   const result=await endpoint('/api/simple-bridge?'+params);
   setStatus(result);
  }catch(e){setStatus(null);setStatusError(e.message)}
  finally{setTracking(false)}
 },[chain,l2Hash,address]);
 useEffect(()=>{
  if(!address||!validHash(l2Hash))return;
  checkStatus();
  const id=setInterval(()=>checkStatus(),30000);
  return()=>clearInterval(id);
 },[address,l2Hash,checkStatus]);
 const connect=async()=>{
  if(!wallet)return setError('Open this website in a wallet browser such as MetaMask or Rabby.');
  setPending(true);setError('');
  try{const accounts=await wallet.request({method:'eth_requestAccounts'});setAddress(accounts?.[0]||'')}
  catch(e){setError(e?.message||'Wallet connection cancelled.')}finally{setPending(false)}
 };
 const pickChain=next=>{setChain(next);setAmount('');setQuote(null);setAck(false);setError('');setStatus(null);setL2Hash('');setL1Hash('')};
 const prepare=async()=>{
  if(!address||!amount)return;
  setBusy('Checking route…');setError('');setQuote(null);setAck(false);
  try{
   const j=await post({action:'quote',chain,address,amount});
   checkQuote(j.transaction,chain,address,amount);
   setQuote(j);
  }catch(e){setError(e.message)}finally{setBusy('')}
 };
 const send=async()=>{
  if(!wallet||!quote||!ack)return;
  setBusy('Checking again…');setError('');
  try{
   const updated=await post({action:'quote',chain,address,amount});
   checkQuote(updated.transaction,chain,address,amount);
   const prev=quote.transaction,t=updated.transaction;
   if(t.to.toLowerCase()!==prev.to.toLowerCase()||t.data!==prev.data||t.value!==prev.value)
    throw Error('Bridge transaction changed. Review it again.');
   await switchNetwork(wallet,CFG[chain].id);
   const accounts=await wallet.request({method:'eth_accounts'});
   if(!accounts?.some(a=>a.toLowerCase()===address.toLowerCase()))throw Error('Wrong wallet connected.');
   const tx={from:address,to:t.to,data:t.data,value:t.value};
   setBusy('Waiting for wallet…');
   await wallet.request({method:'eth_estimateGas',params:[tx]});
   const hash=await wallet.request({method:'eth_sendTransaction',params:[tx]});
   if(!validHash(hash))throw Error('Wallet did not return a valid transaction hash.');
   setL2Hash(hash);setStatus(null);setStatusError('');setL1Hash('');
   setQuote(null);setAck(false);setAmount('');saveTrack(address,chain,hash);
  }catch(e){setError(e?.shortMessage||e?.message||'Unable to sign withdrawal.')}finally{setBusy('')}
 };
 const restore=()=>{
  if(!validHash(manualHash))return setStatusError('Enter a valid transaction hash.');
  setL2Hash(manualHash);setL1Hash('');setStatus(null);setStatusError('');
  saveTrack(address,chain,manualHash);
 };
 const claim=async()=>{
  if(!wallet||!status?.canAct)return;
  setBusy('Checking Ethereum claim…');setError('');
  try{
   if(chain==='dbk'){
    const step=status.stage;
    const j=await post({action:'complete',chain,address,hash:l2Hash,step});
    const t=j.transaction;
    if(t?.simulated!==true||t.chainId!==1||t.to?.toLowerCase()!==PORTAL.toLowerCase()
       ||t.recipient?.toLowerCase()!==address.toLowerCase()||t.value!=='0x0'||t.action!==step)
      throw Error('Ethereum bridge proof failed verification.');
    await switchNetwork(wallet,1);
    const accounts=await wallet.request({method:'eth_accounts'});
    if(!accounts.some(a=>a.toLowerCase()===address.toLowerCase()))throw Error('Wallet mismatch.');
    const again=await post({action:'complete',chain,address,hash:l2Hash,step});
    if(again.transaction?.data!==t.data||again.transaction?.withdrawalHash!==t.withdrawalHash)
      throw Error('Withdrawal proof changed. Try again.');
    const tx={from:address,to:PORTAL,data:t.data,value:'0x0'};
    await wallet.request({method:'eth_estimateGas',params:[tx]});
    setBusy('Confirm in wallet…');
    const ethHash=await wallet.request({method:'eth_sendTransaction',params:[tx]});
    if(!validHash(ethHash))throw Error('No valid Ethereum transaction hash returned.');
    setL1Hash(ethHash);saveTrack(address,chain,l2Hash,ethHash);
   }else{
    if(status.stage!=='finalize')throw Error('ZKcandy proof is not ready.');
    await switchNetwork(wallet,1);
    const signer=await new ethers.BrowserProvider(wallet).getSigner();
    if((await signer.getAddress()).toLowerCase()!==address.toLowerCase())throw Error('Wallet mismatch.');
    let zk=null;
    for(const rpc of ['https://rpc.zkcandy.io','https://320.rpc.thirdweb.com']){
     try{
      const p=new Provider(rpc);
      if(Number((await p.getNetwork()).chainId)===320){zk=p;break}
     }catch{}
    }
    if(!zk)throw Error('ZKcandy proof RPC is not accessible. No claim was submitted.');
    const bridge=L1Signer.from(signer,zk);
    if(await bridge.isWithdrawalFinalized(l2Hash)){setStatus(s=>({...s,stage:'completed',canAct:false,message:'Already finalized on Ethereum.'}));return}
    await bridge.finalizeWithdrawalParams(l2Hash);
    const params=new URLSearchParams({mode:'status',chain,address,hash:l2Hash});
    const fresh=await endpoint('/api/simple-bridge?'+params);
    if(!fresh.canAct)throw Error('Proof is not ready anymore.');
    setBusy('Confirm in wallet…');
    const t=await bridge.finalizeWithdrawal(l2Hash);
    if(!validHash(t.hash))throw Error('No transaction hash returned.');
    setL1Hash(t.hash);saveTrack(address,chain,l2Hash,t.hash);
   }
  }catch(e){setError(e?.shortMessage||e?.message||'Claim unavailable.')}finally{setBusy('')}
 };
 return <main className="simple-root">
  <header className="simple-header"><div className="simple-logo"><span className="mark">↗</span><span>stuck<span className="logo-accent">bridge</span></span></div>
   {address?<button className="wallet-pill" onClick={connect}><span className="wallet-dot"/>{short(address)}</button>:<button className="wallet-pill" onClick={connect}><Wallet size={15}/> Connect wallet</button>}
  </header>
  <section className="simple-heading"><div className="eyebrow">SELF-CUSTODIAL BRIDGE</div><h1>Bridge your ETH.</h1><p>Move funds from DBK Chain or ZKcandy to Ethereum. We handle the technical checks.</p></section>
  <div className="simple-card">
   <div className="simple-card-title"><strong>Bridge</strong><span>Native withdrawal · ETH only</span></div>
   <div className="chain-box">
    <label htmlFor="from-chain">From</label>
    <div className="chain-input"><span className="chain-avatar">↗</span><select id="from-chain" value={chain} onChange={e=>pickChain(e.target.value)}>
      <option value="dbk">DBK Chain</option><option value="zkcandy">ZKcandy</option>
     </select><ChevronDown size={16}/></div>
    <div className="token-balance"><span>ETH balance: {!address?'Connect wallet':scanning?'Checking…':balance?.state==='verified'?fmt(balance.balance)+' ETH':'Unavailable'}</span>
     {address&&<button onClick={()=>refreshBalances(address)} title="Refresh balance"><RefreshCw size={14}/></button>}</div>
   </div>
   <div className="down-indicator"><ArrowDown size={16}/></div>
   <div className="chain-box destination"><label>To</label><div className="chain-input"><span className="chain-avatar ethereum">{ethIcon()}</span><strong>Ethereum</strong><span className="network-token">ETH</span></div>
    <div className="token-balance"><span>Same wallet address · {address?short(address):'not connected'}</span></div>
   </div>
   <div className="amount-box"><div><label htmlFor="bridge-amount">Amount</label><span>ETH</span></div>
    <input id="bridge-amount" type="text" inputMode="decimal" value={amount} placeholder="0.00" onChange={e=>{setAmount(e.target.value.replace(',','.'));setQuote(null);setAck(false);setError('')}}/>
    <div className="amount-footer"><span>Leave a little ETH for gas</span>{balance?.state==='verified'&&Number(balance.balance)>0&&<button onClick={()=>{try{const half=ethers.formatEther(ethers.parseEther(balance.balance)/2n);setAmount(half);setQuote(null)}catch{}}}>50%</button>}</div>
   </div>
   {quote&&<div className="quote-panel"><div className="quote-line"><span>Bridge method</span><strong>{quote.route}</strong></div><div className="quote-line"><span>Estimated source gas</span><strong>{fee==='Unavailable'?'Calculated in wallet':fmt(fee)+' ETH'}</strong></div><div className="quote-line"><span>Receive on Ethereum</span><strong>{fmt(amount)} ETH*</strong></div>
    <p>*Before any Ethereum L1 claim gas. This is a native withdrawal, not an instant transfer; completion is not guaranteed.</p>
    <label className="checkline"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I understand finalization may require an additional Ethereum transaction and gas.</label>
   </div>}
   {error&&<div className="inline-error"><AlertCircle size={16}/><span>{error}</span></div>}
   {!address?<button className="main-action" onClick={connect} disabled={pending}>{pending?'Connecting…':'Connect wallet'} <ArrowRight size={18}/></button>:
     <button className="main-action" onClick={quote?send:prepare} disabled={!!busy||!amount||!(/^\d+(\.\d{1,18})?$/.test(amount))||(!!quote&&!ack)}>{busy|| (quote?'Confirm in wallet':'Review bridge')}<ArrowRight size={18}/></button>}
   <p className="safety-line"><ShieldCheck size={14}/> No custody. No seed phrase. Unavailable routes cannot be signed.</p>
  </div>
  <section className="track-panel">
   <div className="track-title"><div><h2>Track withdrawal</h2><p>We'll check Ethereum settlement for your transaction.</p></div>{l2Hash&&<button className="refresh-status" onClick={()=>checkStatus()} disabled={tracking}><RefreshCw size={15}/> Refresh</button>}</div>
   {l2Hash?<div className="track-result"><div className="track-state"><span className={'progress-dot '+(status?.stage==='completed'?'done':'')}/><div><strong>{status?.message|| (tracking?'Checking transaction…':'Waiting for confirmation or blockchain data')}</strong><small>{CFG[chain].label} withdrawal · <a href={CFG[chain].explorer+l2Hash} target="_blank" rel="noreferrer">{short(l2Hash)} <ExternalLink size={12}/></a></small></div></div>
    {statusError&&<p className="quiet-error">{statusError} We haven't confirmed completion.</p>}
    {status?.canAct&&!l1Hash&&<button className="claim-action" onClick={claim} disabled={!!busy}>{busy|| (status.stage==='prove'?'Prove on Ethereum':'Claim on Ethereum')} <ArrowRight size={16}/></button>}
    {l1Hash&&<div className="l1-transaction"><Check size={15}/> Ethereum transaction submitted. <a href={'https://etherscan.io/tx/'+l1Hash} target="_blank" rel="noreferrer">View status <ExternalLink size={12}/></a></div>}
   </div>:<p className="track-empty">Once you start a withdrawal, its status will appear here automatically.</p>}
   <details className="lookup-details"><summary>Already made a withdrawal? Check its transaction</summary><div className="lookup-form"><input value={manualHash} onChange={e=>setManualHash(e.target.value)} placeholder="Paste source-chain transaction hash (0x…)" /><button disabled={!address||!validHash(manualHash)} onClick={restore}>Track</button></div></details>
  </section>
  <footer className="simple-footer"><span>Unofficial tool · Not affiliated with Relay, ZKcandy, or DBK Chain</span><a href="https://github.com/ariefzzz5421/stuck-fund-bridge" target="_blank" rel="noreferrer">View source <ExternalLink size={12}/></a></footer>
 </main>
}
