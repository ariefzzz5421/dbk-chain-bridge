import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Public Blockscout indexes are discovery-only: they are NOT trusted as proof
// of claimability. The OP SDK still verifies each withdrawal before any signing.
const EXPLORER = 'https://scan.dbkchain.io';
const BRIDGE_CONTRACTS = new Set([
  '0x4200000000000000000000000000000000000010', // L2 Standard Bridge
  '0x4200000000000000000000000000000000000016', // L2ToL1 Message Passer
]);
const json = (data, code = 200) => NextResponse.json(data, {
  status: code, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
async function readJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, {
      cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Explorer unavailable');
    return await response.json();
  } finally { clearTimeout(timer); }
}
function lower(value) {
  return (typeof value === 'string' ? value : value?.hash || '').toLowerCase();
}
function transactionCandidate(item, address, legacy = false) {
  const sender = lower(legacy ? item.from : item.from);
  const recipient = lower(legacy ? item.to : item.to);
  const hash = item.hash;
  const method = typeof item.method === 'string' ? item.method : '';
  const ok = legacy ? item.isError !== '1' : item.status !== 'error';
  if (!ok || !/^0x[0-9a-fA-F]{64}$/.test(hash || '') || sender !== address.toLowerCase()) return null;
  const isBridge = BRIDGE_CONTRACTS.has(recipient);
  const isWithdrawalCall = /^(withdraw|bridgeETH|initiateWithdrawal)/i.test(method);
  if (!isBridge && !isWithdrawalCall) return null;
  let eth = null;
  try {
    const raw = String(item.value || '0');
    if (/^\d+$/.test(raw)) eth = ethers.utils.formatEther(raw);
  } catch { /* Amount is not verified */ }
  return {
    hash, method: method || 'Bridge contract interaction',
    amount: eth && Number(eth) > 0 ? eth : null,
    timestamp: item.timestamp || (legacy && item.timeStamp ? new Date(Number(item.timeStamp)*1000).toISOString() : null),
    block: item.block_number ?? item.blockNumber ?? null,
    to: recipient,
    source: 'DBK Blockscout',
    verified: false, // no OP Stack status has been verified here
  };
}

async function exploreV2(address) {
  let url = new URL(EXPLORER + '/api/v2/addresses/' + address + '/transactions');
  url.searchParams.set('filter', 'from');
  const results = [];
  let scanned = 0;
  let exhausted = false;
  for (let page = 0; page < 3; page++) {
    const data = await readJson(url.toString());
    if (!Array.isArray(data?.items)) throw new Error('Explorer response format unexpected');
    scanned += data.items.length;
    for (const item of data.items) {
      const found = transactionCandidate(item, address);
      if (found) results.push(found);
    }
    if (!data.next_page_params) { exhausted = true; break; }
    const next = new URL(EXPLORER + '/api/v2/addresses/' + address + '/transactions');
    next.searchParams.set('filter', 'from');
    for (const [key, value] of Object.entries(data.next_page_params)) {
      if (value !== undefined && value !== null && ['block_number', 'index', 'items_count', 'inserted_at', 'hash', 'fee', 'value', 'type'].includes(key)) next.searchParams.set(key, String(value));
    }
    if (next.toString() === url.toString()) break;
    url = next;
  }
  return { positions: results, scanned, exhausted, index: 'Blockscout v2' };
}
async function exploreLegacy(address) {
  const url = new URL(EXPLORER + '/api');
  for (const [key,value] of Object.entries({ module:'account', action:'txlist', address, sort:'desc', page:'1', offset:'100' })) url.searchParams.set(key,value);
  const data = await readJson(url.toString());
  if (!Array.isArray(data?.result)) throw new Error('Legacy explorer unavailable');
  return {
    positions: data.result.map(tx => transactionCandidate(tx,address,true)).filter(Boolean),
    scanned: data.result.length,
    exhausted: data.result.length < 100,
    index: 'Blockscout legacy',
  };
}
async function explorerBalance(address) {
  try {
    const data = await readJson(EXPLORER + '/api/v2/addresses/' + address);
    const raw = data?.coin_balance;
    if (raw === null || raw === undefined || !/^\d+$/.test(String(raw))) return null;
    return ethers.utils.formatEther(String(raw));
  } catch { return null; }
}
export async function GET(request) {
  const address = new URL(request.url).searchParams.get('address') || '';
  if (!ethers.utils.isAddress(address)) return json({ ok:false, error:'Valid EVM address required.' },400);
  try {
    let scan;
    try { scan = await exploreV2(address); }
    catch { scan = await exploreLegacy(address); }
    const unique = Array.from(new Map(scan.positions.map(p => [p.hash.toLowerCase(),p])).values());
    const balance = await explorerBalance(address);
    return json({
      ok:true, address, candidates:unique, balance,
      source:scan.index, scanned:scan.scanned, partial:!scan.exhausted,
      warning:'Candidates are unverified DBK bridge interactions, NOT confirmed pending funds. An absent result does not mean the wallet has no recoverable funds. Historical explorer coverage may be incomplete.',
    });
  } catch {
    return json({
      ok:false, candidates:[], partial:true,
      error:'DBK explorer could not be reached. Automatic discovery is unavailable. You can still try a known DBK withdrawal transaction hash.',
    },503);
  }
}
