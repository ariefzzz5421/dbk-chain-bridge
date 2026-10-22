# Stuck Bridge Fund — ZKcandy → Ethereum

Unofficial self-custodial native ETH recovery console for ZKcandy (chain 320, ZK Stack). The legacy DBK OP Stack code has been removed.

## Flow

1. Connect an injected EIP-1193 wallet (MetaMask/Rabby); the app **never** requests a seed phrase or private key.
2. New native ETH withdrawal: server obtains a canonical L2 BaseToken withdrawal from zksync-ethers Provider.getWithdrawTx; checks contract, calldata, original wallet recipient, value, gas, and verifies an Ethereum L1 batch execution within 7 days. If settlement evidence is missing, new withdrawals are blocked.
3. Sign with your own wallet. This is **not** a guarantee the L1 batch will be published/finalized.
4. Existing withdrawal: paste the L2 hash; the backend checks sender, canonical system contract/function, recipient, receipt, Ethereum batch execution reported by ZKcandy, and a ZKsync proof.
5. Finalize: after proof is returned, the app uses official zksync-ethers L1Signer to check finalization, read the proof, and request an Ethereum mainnet transaction in your wallet. An Ethereum confirmation must be checked separately.

## Important limitations

* ETH only; arbitrary CANDY/USDC assets are not safe to route without verifying bridge token representations and contracts.
* ZKcandy is marked archived by L2BEAT. A functional UI cannot restore a stopped sequencer, prover, or batch publisher.
* Ethereum RPC responding and existence of a proof do not imply finalization success. No promise of asset recovery.
* Official-looking design must not be interpreted as affiliation: this app is **not** operated by ZKcandy.
* No custom approval, arbitrary external wallet address, operator fee, or custody.

## Run locally

Run npm install and npm run dev. Optionally set ETHEREUM_RPC_URL to your trusted Ethereum mainnet RPC in deployment server environment.

## Technical references

- ZKcandy chain docs: https://zkcandy.io/litepaper/ZKcandy%20Lite%20Paper/Interacting%20with%20your%20Smart%20Contract.html
- Official ZKcandy sample using zksync-ethers: https://github.com/ZKcandy/bridging-erc20-demo
- Native ZK Stack bridging model: https://docs.zksync.io/zksync-protocol/rollup/bridging-assets
- SDK: https://github.com/zksync-sdk/zksync-ethers
- ZKcandy project risks: https://l2beat.com/layer2s/projects/zkcandy

Chain logo IPFS CID is taken from ethereum-lists/chains mainnet 320 chain icon entry.
