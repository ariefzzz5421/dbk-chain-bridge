import { ethers } from 'ethers';
import { CrossChainMessenger, DEFAULT_L2_CONTRACT_ADDRESSES, MessageStatus } from '@eth-optimism/sdk';

// Addresses below are taken from https://docs.dbkchain.io/bridge/bridge-sdk
// Reconfirm contract configuration and on-chain implementation before signing.
export const L1_PORTAL = '0x63CA00232F471bE2A3Bf3C4e95Bc1d2B3EA5DB92';
export const L1_CONTRACTS = {
  AddressManager: '0x306402f889035e2Cbd7e396080bf365ADB38B7DC',
  L1CrossDomainMessenger: '0xDEfab7699Ed60a863dce4B1095576F6d9EC5d254',
  L1StandardBridge: '0x28f1b9F457CB51E0af56dff1d11CD6CEdFfD1977',
  OptimismPortal: L1_PORTAL,
  L2OutputOracle: '0x0341bb689CB8a4c16c61307F4BdA254E1bFD525e',
  StateCommitmentChain: ethers.constants.AddressZero,
  CanonicalTransactionChain: ethers.constants.AddressZero,
  BondManager: ethers.constants.AddressZero,
};

const L1_RPC = process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const L2_RPC = process.env.DBK_RPC_URL || 'https://rpc.mainnet.dbkchain.io/';
const TIMEOUT = 13000;

export const l1Provider = () => new ethers.providers.StaticJsonRpcProvider({url:L1_RPC,timeout:TIMEOUT}, {chainId:1,name:'homestead'});
export const l2Provider = () => new ethers.providers.StaticJsonRpcProvider({url:L2_RPC,timeout:TIMEOUT}, {chainId:20240603,name:'dbk'});

export function getMessenger() {
  return new CrossChainMessenger({
    l1ChainId: 1,
    l2ChainId: 20240603,
    l1SignerOrProvider: l1Provider(),
    l2SignerOrProvider: l2Provider(),
    contracts: { l1: L1_CONTRACTS, l2: DEFAULT_L2_CONTRACT_ADDRESSES },
  });
}
export const statusLabel = (status) => {
  const keys = Object.entries(MessageStatus);
  const entry = keys.find(([k,v]) => typeof v === 'number' && v === status);
  return entry?.[0] || 'UNKNOWN';
};

export async function getHealth() {
  const [l1Result,l2Result,explorerResult] = await Promise.allSettled([
    (async () => {
      const p=l1Provider();
      const [net,code]=await Promise.all([p.getNetwork(),p.getCode(L1_PORTAL)]);
      if(net.chainId!==1 || code==='0x') throw new Error('Ethereum portal not deployed or RPC mismatch');
      return {ok:true,chainId:net.chainId,portalCode:true};
    })(),
    (async () => {
      const p=l2Provider();
      const [net,block]=await Promise.all([p.getNetwork(),p.getBlock('latest')]);
      if(net.chainId!==20240603) throw new Error('DBK chain ID mismatch');
      if(!block) throw new Error('DBK block unavailable');
      const ageSeconds=Math.max(0,Math.floor(Date.now()/1000)-block.timestamp);
      return {ok:true,chainId:net.chainId,latestBlock:block.number,blockAgeSeconds:ageSeconds,live:ageSeconds<=7200};
    })(),
    (async () => {
      // Explorer index health is READ-ONLY; never interpreted as protocol liveness or claimability.
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),5500);
      try {
        const response=await fetch('https://scan.dbkchain.io/api?module=block&action=eth_block_number',{signal:controller.signal,cache:'no-store'});
        if(!response.ok)throw new Error('Explorer unavailable');
        const data=await response.json();
        if(!data?.result || typeof data.result!=='string')throw new Error('Explorer index not available');
        return {ok:true,readOnly:true,reportedBlock:data.result};
      }finally{clearTimeout(timer);}
    })()
  ]);
  return {
    ethereum: l1Result.status==='fulfilled'?l1Result.value:{ok:false,error:'Ethereum RPC verification failed. Check the ETHEREUM_RPC_URL provider, its network, access permissions, and Portal contract.'},
    dbk: l2Result.status==='fulfilled'?l2Result.value:{ok:false,error:'DBK RPC unavailable or invalid. Historical state may no longer be accessible from the official endpoint.'},
    explorer: explorerResult.status==='fulfilled'?explorerResult.value:{ok:false,readOnly:true},
  };
}
export function validHash(value) {return /^0x[0-9a-fA-F]{64}$/.test(value||'');}
export function validAddress(value) {return ethers.utils.isAddress(value||'');}

export async function resolveWithdrawal(hash,address) {
  if(!validHash(hash) || !validAddress(address)) throw new Error('Valid L2 transaction hash and wallet address required.');
  const provider=l2Provider();
  const tx=await provider.getTransaction(hash);
  if(!tx) throw new Error('DBK transaction not found. The old L2 RPC may be unavailable.');
  if(tx.from.toLowerCase() !== address.toLowerCase()) throw new Error('Connected wallet is not the transaction sender. For safety this version only supports withdrawals initiated by the same wallet.');
  const receipt=await provider.getTransactionReceipt(hash);
  if(!receipt || receipt.status!==1) throw new Error('Withdrawal L2 transaction was not successful or is unconfirmed.');
  const messenger=getMessenger();
  const messages=await messenger.getMessagesByTransaction(hash);
  if(messages.length!==1) throw new Error('Expected exactly one withdrawal message; multiple/zero messages require manual review.');
  const status=await messenger.getMessageStatus(messages[0]);
  return {messenger,message:messages[0], status, statusName:statusLabel(status), txFrom:tx.from};
}
export async function prepareL1Action({hash,address,action}) {
  const data=await resolveWithdrawal(hash,address);
  if(action==='prove' && data.status!==MessageStatus.READY_TO_PROVE) throw new Error('Withdrawal is not READY_TO_PROVE.');
  if(action==='finalize' && data.status!==MessageStatus.READY_FOR_RELAY) throw new Error('Withdrawal is not READY_FOR_RELAY.');
  let tx;
  if(action==='prove') tx=await data.messenger.populateTransaction.proveMessage(data.message);
  else if(action==='finalize') tx=await data.messenger.populateTransaction.finalizeMessage(data.message);
  else throw new Error('Unsupported action.');
  if(!tx?.to || tx.to.toLowerCase()!==L1_PORTAL.toLowerCase() || !tx.data) {
    throw new Error('Generated transaction target is not the documented DBK OptimismPortal. Blocked.');
  }
  return {chainId:1,to:tx.to,data:tx.data,value:tx.value?tx.value.toHexString():'0x0',action};
}
export async function prepareNewWithdrawal({amount,address}) {
  if(!validAddress(address) || typeof amount !== 'string' || !/^\d+(\.\d{1,18})?$/.test(amount)) throw new Error('Invalid address or ETH amount.');
  const wei=ethers.utils.parseEther(amount);
  if(wei.lte(0)) throw new Error('Amount must be greater than 0.');
  const health=await getHealth();
  if(!health.dbk.ok || !health.dbk.live || !health.ethereum.ok) throw new Error('DBK or Ethereum RPC health check failed. Starting new withdrawals is disabled.');
  const provider=l2Provider();
  const balance=await provider.getBalance(address);
  if(balance.lte(wei)) throw new Error('Insufficient DBK ETH after reserving gas.');
  const messenger=getMessenger();
  const tx=await messenger.populateTransaction.withdrawETH(wei);
  if(!tx?.to || !tx?.data) throw new Error('Could not construct DBK withdrawal.');
  // OP Stack withdrawETH is an L2 standard bridge call. Never send funds to an arbitrary address.
  const allowed=['0x4200000000000000000000000000000000000010','0x4200000000000000000000000000000000000007'];
  if(!allowed.includes(tx.to.toLowerCase())) throw new Error('Unexpected withdrawal contract. Transaction blocked.');
  const value=tx.value ? ethers.BigNumber.from(tx.value) : ethers.constants.Zero;
  if(value.gt(wei)) throw new Error('Unexpected transaction value; blocked.');
  return {chainId:20240603,to:tx.to,data:tx.data,value:value.toHexString(),action:'start',amount};
}
