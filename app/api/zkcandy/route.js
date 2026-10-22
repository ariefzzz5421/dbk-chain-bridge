import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { Provider, utils } from 'zksync-ethers';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const RPCS=['https://rpc.zkcandy.io','https://320.rpc.thirdweb.com'];
const ETH_RPCS=[process.env.ETHEREUM_RPC_URL,'https://ethereum-rpc.publicnode.com','https://eth.llamarpc.com'].filter(Boolean);
const BASE='0x000000000000000000000000000000000000800a';
const ABI=new ethers.Interface(['function withdraw(address _l1Receiver)']);
const addr=s=>ethers.isAddress(s||'');
const hash=s=>/^0x[a-f0-9]{64}$/i.test(s||'');
const err=e=>String(e?.shortMessage||e?.message||'Unavailable').slice(0,300);
const timeout=(p,ms=6500)=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('RPC timeout')),ms))]);

async function zk(){
 for(const url of RPCS){
  try{const p=new Provider(url);if(Number((await timeout(p.getNetwork())).chainId)!==320)continue;
    await timeout(p.getBlockNumber());return p;}catch(_){}
 }
 throw Error('ZKCANDY_RPC_UNAVAILABLE');
}
async function ethereum(){
 for(const url of ETH_RPCS){
  try{const p=new ethers.JsonRpcProvider(url,1,{staticNetwork:true});await timeout(p.getBlockNumber());return p;}catch(_){}
 }
 throw Error('ETHEREUM_RPC_UNAVAILABLE');
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
  const p=await zk();
  if(mode==='health'){
    const latestBlock=await p.getBlockNumber();
    let l1Online=false,s={recentSettlement:false,reason:'Ethereum RPC unreachable'};
    try{const l=await ethereum();l1Online=true;s=await settlement(p,l)}catch(_){}
    return NextResponse.json({ok:true,chainId:320,latestBlock,ethereumOnline:l1Online,withdrawalsEnabled:l1Online&&s.recentSettlement,...s});
  }
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
