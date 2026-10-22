import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { Provider, utils } from 'zksync-ethers';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const RPCS = [
  { url: process.env.ZKCANDY_RPC_URL, label: 'Configured RPC' },
  { url: 'https://rpc.zkcandy.io', label: 'Official ZKcandy' },
  { url: 'https://320.rpc.thirdweb.com', label: 'thirdweb' },
  { url: 'https://api.uniblock.dev/uni/v1/json-rpc?chainId=320', label: 'Uniblock' },
].filter(item => item.url);
const ETH_RPCS = [
  { url: process.env.ETHEREUM_RPC_URL, label: 'Configured RPC' },
  { url: 'https://eth.nodeconnect.org', label: 'NodeConnect' },
  { url: 'https://ethereum-rpc.publicnode.com', label: 'PublicNode' },
  { url: 'https://eth.llamarpc.com', label: 'LlamaRPC' },
].filter(item => item.url);
const BASE = '0x000000000000000000000000000000000000800a';
const ABI = new ethers.Interface(['function withdraw(address _l1Receiver)']);
const addr = s => ethers.isAddress(s || '');
const hash = s => /^0x[a-f0-9]{64}$/i.test(s || '');
const err = e => String(e?.shortMessage || e?.message || 'Unavailable').slice(0, 300);
const timeout = (p, ms = 7000) => Promise.race([
  p, new Promise((_, reject) => setTimeout(() => reject(Error('RPC timeout')), ms)),
]);

async function rpcCall(url, method, params = []) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5500);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw Error('HTTP ' + response.status);
    const data = await response.json();
    if (data.error || typeof data.result !== 'string') throw Error(data.error?.message || 'Invalid JSON-RPC response');
    return data.result;
  } finally { clearTimeout(timer); }
}
async function selectRpc(list, chainId) {
  // Probe independently and in parallel. A dead primary endpoint cannot mask a working fallback.
  const checked = await Promise.all(list.map(async entry => {
    try {
      if (!/^https:\/\//.test(entry.url)) throw Error('HTTPS endpoint required');
      const actual = Number(BigInt(await rpcCall(entry.url, 'eth_chainId')));
      if (actual !== chainId) throw Error('Wrong chain ID');
      const block = Number(BigInt(await rpcCall(entry.url, 'eth_blockNumber')));
      if (!Number.isSafeInteger(block) || block < 0) throw Error('Invalid block number');
      return { ...entry, block, ok: true };
    } catch (error) {
      return { label: entry.label, ok: false, error: err(error) };
    }
  }));
  const chosen = checked.find(entry => entry.ok);
  return { chosen: chosen || null, checked };
}
const zkProvider = entry => new Provider(entry.url);
const ethProvider = entry => new ethers.JsonRpcProvider(entry.url, 1, { staticNetwork: true });
async function zk() {
  const result = await selectRpc(RPCS, 320);
  if (!result.chosen) throw Error('ZKCANDY_RPC_UNAVAILABLE');
  return zkProvider(result.chosen);
}
async function ethereum() {
  const result = await selectRpc(ETH_RPCS, 1);
  if (!result.chosen) throw Error('ETHEREUM_RPC_UNAVAILABLE');
  return ethProvider(result.chosen);
}
async function settlement(z,l){
 try{
  const count=Number(BigInt(await timeout(z.send('zks_L1BatchNumber',[]))));
  if(!Number.isInteger(count)||count<0)throw Error('Invalid L1 batch number');
  for(let n=count;n>=Math.max(0,count-15);n--){
    const d=await timeout(z.getL1BatchDetails(n));
    const h=d?.executeTxHash||d?.ethExecuteTxHash;
    if(!hash(h))continue;
    const receipt=await timeout(l.getTransactionReceipt(h));
    if(receipt?.status!==1)continue;
    const block=await timeout(l.getBlock(receipt.blockNumber));
    if(!block)continue;
    const timestamp=Number(block.timestamp);
    return {recentSettlement:Date.now()/1000-timestamp<=7*86400,lastExecutedBatch:n,lastExecutionAt:timestamp,lastExecutionTx:h};
  }
  return {recentSettlement:false,reason:'No L1 batch execution receipt found for last 16 batches'};
 }catch(e){return {recentSettlement:false,reason:err(e)}}
}
export async function GET(req){
 const q=new URL(req.url).searchParams,mode=q.get('mode')||'health';
 try{
  if (mode === 'health') {
    // Each chain is checked separately so a ZKcandy outage does not falsely label L1 as offline.
    const [zResult, eResult] = await Promise.all([selectRpc(RPCS, 320), selectRpc(ETH_RPCS, 1)]);
    const z = zResult.chosen, e = eResult.chosen;
    let proof = { recentSettlement: false, reason: z && e
      ? 'L1 batch execution not yet verified'
      : 'Both ZKcandy and Ethereum RPC access are needed to verify L1 execution' };
    if (z && e) proof = await settlement(zkProvider(z), ethProvider(e));
    return NextResponse.json({
      ok: true,
      zkcandyOnline: Boolean(z),
      ethereumOnline: Boolean(e),
      chainId: 320,
      zkcandyRpc: z?.label || null,
      ethereumRpc: e?.label || null,
      latestBlock: z?.block ?? null,
      ethereumBlock: e?.block ?? null,
      zkcandyChecks: zResult.checked.map(({label,ok,error}) => ({label,ok,error})),
      ethereumChecks: eResult.checked.map(({label,ok,error}) => ({label,ok,error})),
      withdrawalsEnabled: Boolean(z && e && proof.recentSettlement),
      ...proof,
    });
  }
  const p = await zk();
  const address=q.get('address');
  if(!addr(address))throw Error('INVALID_WALLET');
  if(mode==='balance')return NextResponse.json({ok:true,balance:ethers.formatEther(await p.getBalance(address))});
  if(mode!=='status')throw Error('INVALID_MODE');
  const txHash=q.get('hash');
  if(!hash(txHash))throw Error('INVALID_TX_HASH');
  const [tx,receipt]=await Promise.all([p.getTransaction(txHash),p.getTransactionReceipt(txHash)]);
  if(!tx||!receipt||receipt.status!==1)throw Error('WITHDRAWAL_NOT_FOUND_OR_FAILED');
  if(tx.from.toLowerCase()!==address.toLowerCase())throw Error('ORIGINAL_WALLET_MISMATCH');
  if((tx.to||'').toLowerCase()!==BASE.toLowerCase())throw Error('NOT_A_NATIVE_ETH_WITHDRAWAL');
  let decoded;
  try{decoded=ABI.parseTransaction({data:tx.data,value:tx.value})}catch(_){throw Error('INVALID_WITHDRAWAL_CALL')}
  if(decoded?.name!=='withdraw'||decoded.args[0].toLowerCase()!==address.toLowerCase()||tx.value<=0n)throw Error('RECIPIENT_OR_AMOUNT_MISMATCH');
  let executed=false,proofAvailable=false,proofIssue='';
  try{
    const details=await timeout(p.getTransactionDetails(txHash));
    executed=!!details?.ethExecuteTxHash;
    const proof=await timeout(p.getL2ToL1LogProof(txHash));
    proofAvailable=!!proof?.proof?.length;
  }catch(e){proofIssue=err(e)}
  return NextResponse.json({ok:true,hash:txHash,amount:ethers.formatEther(tx.value),recipient:address,
    executed,proofAvailable,proofIssue,
    note:'Proof availability does not guarantee Ethereum execution or a successful finalization.'});
 }catch(e){return NextResponse.json({ok:false,error:err(e)},{status:503})}
}
export async function POST(req){
 try{
  const {action,address,amount}=await req.json();
  if(action!=='prepareETH'||!addr(address)||typeof amount!=='string'||!/^\d+(\.\d{1,18})?$/.test(amount))throw Error('INVALID_PARAMETERS');
  const wei=ethers.parseEther(amount);
  if(wei<=0n)throw Error('INVALID_AMOUNT');
  const [z,l]=await Promise.all([zk(),ethereum()]);
  const s=await settlement(z,l);
  if(!s.recentSettlement)throw Error('NO_RECENT_VERIFIED_ETHEREUM_BATCH_EXECUTION');
  const balance=await z.getBalance(address);
  if(balance<=wei)throw Error('INSUFFICIENT_BALANCE_AND_GAS');
  const tx=await z.getWithdrawTx({amount:wei,token:utils.ETH_ADDRESS,from:address,to:address});
  if((tx.to||'').toLowerCase()!==BASE)throw Error('UNEXPECTED_SYSTEM_CONTRACT');
  const parsed=ABI.parseTransaction({data:tx.data,value:tx.value});
  if(parsed?.name!=='withdraw'||parsed.args[0].toLowerCase()!==address.toLowerCase()||BigInt(tx.value||0)!==wei)
    throw Error('UNEXPECTED_WITHDRAWAL_CALLDATA');
  const gas=await z.estimateGas({from:address,to:BASE,data:tx.data,value:wei});
  const fee=await z.getFeeData();
  if(fee.gasPrice&&balance<wei+gas*fee.gasPrice)throw Error('INSUFFICIENT_BALANCE_INCLUDING_GAS');
  return NextResponse.json({ok:true,transaction:{chainId:320,from:ethers.getAddress(address),to:BASE,
    data:tx.data,value:ethers.toBeHex(wei),amount,recipient:ethers.getAddress(address),
    gasEstimate:gas.toString(),gasPrice:fee.gasPrice?.toString()||null}});
 }catch(e){return NextResponse.json({ok:false,error:err(e)},{status:400})}
}
