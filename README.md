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

## DBK Chain monitor and existing-withdrawal recovery
- DBK Chain: chain ID 20240603, official RPC `https://rpc.mainnet.dbkchain.io/`, fallback thirdweb and RouteMesh.
- Read-only `GET /api/networks` independently probes ZK candy (320), DBK (20240603) and Ethereum (1), validates latest block timestamp and on-chain bytecode of the documented DBK OptimismPortal and L2OutputOracle. It never mislabels a responding RPC as a functioning bridge.
- `GET /api/dbk?mode=balance&address=0x...` reads native ETH on DBK from a verified, fresh endpoint.
- `GET /api/dbk?mode=status&address=0x...&hash=0x...` checks canonical DBK L2 MessagePassed log, sender, Ethereum recipient, withdrawal hash, and OP Stack L1 status with viem.
- `POST /api/dbk` supports **prove/finalize only for an existing valid withdrawal**, and only if on-chain status allows it, L1 contracts match the official documentation, and an Ethereum simulation passes. Transaction data goes to the documented Ethereum OptimismPortal with zero ETH value, and is revalidated before the user signs in their own wallet.
- **New DBK withdrawal initiation remains disabled** until all stages are thoroughly validated. Chain block production alone is not exit readiness.
- No seed phrases, private keys, arbitrary user-provided RPCs/contracts, or custody.

DBK bridge documentation: https://docs.dbkchain.io/bridge/bridge-sdk

## New DBK native ETH withdrawal (conditional)

`POST /api/dbk` with `{"action":"prepareStart","address":"0x...","amount":"0.01"}` performs a strict preflight, without signing or broadcasting:
1. Chain 20240603 and Ethereum chain 1 must have recent blocks.
2. Ethereum must expose bytecode at the DBK-documented OptimismPortal and L2OutputOracle.
3. Output oracle latest index and output proposal must be readable. Last L1 output timestamp must be ≤24 hours ago and must have a nonzero root; the latest posted L2 block cannot trail head by >90,000 blocks.
4. Transaction calldata must be canonical L2ToL1MessagePasser `initiateWithdrawal(originalWallet,100000,"0x")`, with payable value exactly the user's requested ETH amount and no external recipient.
5. Read-only `eth_call` and `eth_estimateGas` on DBK must succeed; available ETH must cover amount plus estimated gas with reserve.
6. Client re-prepares the same transaction; validates target, calldata, amount, recipient, account, chainId; then calls `eth_estimateGas` in the user's wallet and asks for their explicit EIP-1193 transaction signature.

**Important:** A recent posted output proposal does not guarantee future finalization. User may be stuck in the optimistic withdrawal period. The app does not promise an ETA, bridge fee or settlement outcome; Ethereum prove/finalize is a separate step using the existing hash inspector. Only native ETH, no tokens. There is no automatic approval, escrow or Relay solver route.
