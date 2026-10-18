# DBK Recovery Bridge

Self-custodial, independent recovery dashboard for **DBK Chain → Ethereum** OP Stack withdrawals. Powered by the official DBK contract configuration and the Optimism SDK. Not affiliated with DBK, OP Labs, Superbridge, or Privy.

## What this app can and cannot do

- **Check:** DBK RPC health, last block age, Ethereum OptimismPortal code, and an L2 withdrawal transaction hash.
- **Recover:** When the OP SDK verifies status `READY_TO_PROVE` or `READY_FOR_RELAY`, generate an unsigned Ethereum transaction; the user signs through their own wallet.
- **Start new ETH withdrawals:** Only when both chain health checks pass and DBK has produced a recent block. **Do not initiate a new withdrawal when the chain is shut down.**
- **No custody:** Never collects private keys/seed phrases. No approvals, no custom arbitrary recipient address, no fees charged by the app.
- **Limitations:** Transaction hashes must be supplied by the user. SDK reads require a working archive-capable DBK RPC; a permanently stopped chain, missing state proposals, or incompatible contract upgrades cannot be solved by this UI. Does not scan balances automatically or support ERC-20 tokens.
- **Safety:** One L2 message per transaction, signer/source address match, fixed chain IDs and allowlisted protocol contract addresses. The website **does not guarantee recovery**. Verify contract addresses independently before signing.

## Setup

```bash
npm install
cp .env.example .env.local
# Add NEXT_PUBLIC_PRIVY_APP_ID from https://dashboard.privy.io
npm run dev
```

Privy Dashboard: create an app and enable **wallet** login, allow both localhost and deployed Vercel domain in the allowed origins. For users recovering from an existing wallet, connect the **original external wallet** rather than creating a fresh embedded wallet.

Optional Vercel environment variables:
- `NEXT_PUBLIC_PRIVY_APP_ID` (required to enable wallet connect)
- `ETHEREUM_RPC_URL` (recommended; server-side Ethereum Mainnet RPC)
- `DBK_RPC_URL` (official default: `https://rpc.mainnet.dbkchain.io/`)
- `NEXT_PUBLIC_DBK_RPC_URL` (frontend chain metadata only)

## Workflow

1. Connect original wallet using Privy.
2. For a previously initiated withdrawal, paste the **DBK L2 withdrawal transaction hash**, not an Ethereum transaction hash, and click **Check withdrawal**.
3. Only if SDK returns READY_TO_PROVE: review generated unsigned transaction, then sign **Prove** on Ethereum.
4. Wait the challenge period. Only if status READY_FOR_RELAY: review and sign **Finalize** on Ethereum.
5. For brand-new withdrawals, the chain must be live and hold sufficient ETH + gas; do not use this on a discontinued network.

## Reference

- DBK bridge SDK guide: https://docs.dbkchain.io/bridge/bridge-sdk
- Optimism withdrawal guide: https://docs.optimism.io/
- Privy React SDK: https://docs.privy.io/
- L1 Portal: `0x63CA00232F471bE2A3Bf3C4e95Bc1d2B3EA5DB92`
- DBK Chain ID: `20240603`, Ethereum Mainnet ID: `1`

## Disclaimer

Unaudited recovery tool. No transaction should be signed without independent verification of the on-chain contract and calldata. Incorrect routing can permanently lose funds. Gas may exceed the recovery value.

## Wallet-first discovery and status animation

- Connect your original EVM wallet through Privy: the site performs an unsigned, read-only Blockscout scan of up to 3 pages of recent outgoing DBK transactions.
- Bridge-contract interactions are shown as **unverified candidates**. The DBK explorer is an index, **not** proof that a withdrawal can be finalized. A missing candidate does not mean no funds can be recovered; manual transaction hash lookup remains available.
- DBK explorer legacy API is used as a fallback if its v2 address API is unavailable. The explorer supports only some ETH RPC methods and is NOT used by the Optimism SDK to fabricate proof data.
- A mined receipt changes the animation to confirmed, but broadcasting or proving is never displayed as final bridge settlement. The challenge period and finalization remain separate.
- Animated visual elements honor `prefers-reduced-motion`.
- Ethereum and DBK marks are rendered locally using lightweight SVG; DBK uses a custom stylized monogram.

## RPC fallback verification and official logo

A fixed list of DBK RPC candidates is tested server-side: the official endpoint, Thirdweb, RouteMesh, and an optional `DBK_ARCHIVE_RPC_URL` provided by the operator. Their endpoints are *candidates*, not verified service guarantees. The server checks `eth_chainId`, the latest block timestamp, the old withdrawal transaction receipt and `eth_getProof` at the historical receipt block. A viable historical RPC can help inspect a stopped chain but cannot restart its sequencer or publish missing state commitments. `Prove` requires archival proof support and protocol status checks; `Finalize` also requires a verified message status. An explorer index alone is insufficient for either action.

Ethereum RPC candidates are also checked against chain ID 1 and the deployed DBK OptimismPortal proxy code. Public API replies never expose RPC credentials. DBK artwork is based on the user-provided image and stored as `public/dbk-logo.webp`.


## Verified recovery evidence and signing safety

The DBK status reader decodes canonical L2 MessagePassed logs with viem and verifies the Ethereum OptimismPortal mapping. A successful finalization event must be cross-checked against an Ethereum RPC receipt. DBK tx 0x5d15ea4a8ba70b021f2e7231a76e9823f6d74646d4924570e99417321ba37f9e has already been finalized with execution success on Ethereum tx 0x722361423bcd99f0e28eeedbcb8e3cd9fa7b32449ff45b4bc4b0de29183686f0. It needs no further on-chain bridge action.

IMPORTANT: New L2 withdrawals remain disabled. ETH-only Prove/Finalize transaction preparation is enabled only when the withdrawal message and Ethereum bridge state are verified, the connected wallet is the validated recipient, and both Ethereum call simulation and gas estimation succeed. No future pending withdrawal has yet been end-to-end signed and finalized through this UI; an RPC health indicator does not establish claimability.


## L1 recovery signing (Prove / Finalize)
After connecting the original wallet, select a verified DBK withdrawal.
- Already finalized: no action; confirm the L1 \`WithdrawalFinalized(success)\` receipt.
- Ready to prove: derive a proof from an appropriate historical DBK state root and L1 output oracle (legacy Portal v2), encode the documented L1 \`proveWithdrawalTransaction\` call.
- Challenge period: wait. Neither step can be skipped.
- Ready to finalize: encode \`finalizeWithdrawalTransaction\`, which releases the funds if its EVM execution succeeds.
- Before showing an unsigned transaction, the backend re-verifies the connected wallet as recipient, the original event and hash, target portal and status; it runs an Ethereum \`eth_call\` and \`eth_estimateGas\`. Failing either prevents signing. The frontend re-fetches the unsigned transaction and checks exact calldata before broadcasting through the user's own wallet. It never handles a seed phrase or server-side signer.
- New L2 withdrawals stay disabled. Portal v3+ proof generation is rejected until independently tested. Existing finalized transactions cannot be replayed.
- A successful build/status lookup alone is not an end-to-end proof of a future pending withdrawal. Always review fee estimates, wallet prompts and actual L1 receipts.


### Supported recipient routes
For safety the wallet-to-Ethereum recovery action only supports verified native ETH messages: (a) an ETH-only direct MessagePassed transfer to the original wallet, or (b) an ETH withdrawal whose decoded L1 CrossDomainMessenger message targets the documented L1StandardBridge with a matching sender, wallet recipient, and ETH amount. Nonstandard contract calls, ERC20 assets and transfers to a different wallet are view-only. Both the DBK transaction sender and decoded recipient must match the connected wallet. All L1 actions are simulated with eth_call and estimateGas before wallet signing. New withdrawals remain disabled.
