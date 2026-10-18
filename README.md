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
