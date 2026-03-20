# SAT-FLOW

SAT-FLOW is a programmable USDCx spend-governance primitive for AI agents on Stacks.

Version `1.0-USDCx` is `USDCX`-first and runs in `compatibility mode`:

- the payment itself is an upstream-compatible Stacks transfer
- the SAT-FLOW vault contract enforces policy through read-only preflight checks
- the SDK records authoritative post-settlement accounting with `record-spend`
- the audit anchor is a fixed 34-byte memo: `SF` + 32-byte SHA-256 reasoning hash
- the x402 settlement seam is implemented with the upstream `x402-stacks` package
- the live CLI/server path also uses upstream `x402-stacks` account and default-contract helpers
- the live CLI can derive the signer from either a private key or a local seed phrase
- BNS resolution is Stacks-native first via the BNS contract, with Hiro API fallback

The repo now also proves full live x402 merchant paths end to end:

- merchant issues a real HTTP `402`
- SAT-FLOW preflights vault policy
- SAT-FLOW signs and pays through the local facilitator
- merchant returns the paid resource
- SAT-FLOW records the spend on-chain

Proven assets:

- `STX`
- real bridged testnet `USDCx`

## Why this repo exists

SAT-FLOW makes USDCx programmable at the spend-governance layer.

Where other USDCx primitives focus on routing deposits, splits, or time locks, SAT-FLOW focuses on controlled outbound spend:

- stable-dollar agent budgets with `USDCX`
- daily spend caps and recipient allowlists
- post-settlement on-chain accounting with `record-spend`
- BNS-linked identity for agents and merchants
- cryptographic attribution between a payment and its justification
- MCP-native interfaces for LLM-driven execution

## Repository layout

- `docs/` product, architecture, and system docs
- `packages/shared/` frozen shared types and constants
- `packages/sdk/` SAT-FLOW orchestration and token adapters
- `packages/mcp/` embeddable MCP handlers
- `packages/cli/` operator CLI
- `packages/merchant/` local x402 merchant control-path server and smoke client
- `packages/contracts/` Clarity contract and Clarinet tests

## Runtime model

1. An upstream x402 flow yields a parsed challenge.
2. SAT-FLOW normalizes that challenge into `X402Challenge`.
3. The SDK resolves any BNS identity before payment.
4. The SDK checks allowance, pause state, and whitelist membership.
5. The SDK hashes the agent's justification and builds the SAT-FLOW memo.
6. The selected token adapter signs the transfer.
7. The payment settles through the facilitator path.
8. The SDK calls `record-spend(...)` on the vault contract.

A compliant payment is:

- a confirmed transfer with the SAT-FLOW memo anchor
- a matching `record-spend` contract event

## Product positioning

SAT-FLOW should be understood as:

- a programmable USDCx treasury-control primitive
- an agent spend-governance layer
- an audit and attribution layer for autonomous payments

SAT-FLOW is not primarily:

- a consumer dapp
- a generic crypto wallet
- a pure liquidity-routing primitive

The closest comparison is:

- FlowVault makes USDCx deposits programmable
- SAT-FLOW makes USDCx agent spending governable and auditable

## Current status

This repository now contains the frozen v1 docs plus the initial workspace scaffold for:

- the SAT-FLOW vault contract
- shared interfaces
- SDK logic
- MCP handlers
- a CLI entrypoint with memory and testnet-oriented live flows
- `.env` auto-loading for local operator commands

The working live proof path today is:

- local facilitator on `http://localhost:8089`
- local STX merchant on `http://127.0.0.1:4021/api/premium-data`
- local bridged-USDCx merchant on `http://127.0.0.1:4024/api/premium-data`
- SAT-FLOW CLI commands:
  - `node packages/cli/src/index.js pay-merchant-live http://127.0.0.1:4021/api/premium-data "Test SAT-FLOW merchant payment"`
  - `node packages/cli/src/index.js pay-merchant-live http://127.0.0.1:4024/api/premium-data "Real SAT-FLOW USDCx merchant payment"`

## CLI demo flows

- Local memory demo:
  - `node packages/cli/src/index.js check-allowance USDCX`
  - `node packages/cli/src/index.js pay-demo USDCX`
- Local upstream x402 control path:
  - `npm run merchant:serve`
  - `npm run merchant:smoke`
- Live identity resolution:
  - `node packages/cli/src/index.js resolve-identity merchant.btc --live`
- Live testnet allowance check:
  - `node packages/cli/src/index.js check-allowance-live USDCX merchant.btc`
- Live testnet vault configuration:
  - `node packages/cli/src/index.js set-authorized-agent-live agent.btc`
  - `node packages/cli/src/index.js set-daily-cap-live USDCX 50000000`
  - `node packages/cli/src/index.js set-recipient-whitelist-live merchant.btc true`
- Live testnet payment flow:
  - `node packages/cli/src/index.js pay-live USDCX 1050000 merchant.btc "Need the premium dataset" https://merchant.test/invoice`
- Live merchant-issued 402 payment flow:
  - `node packages/cli/src/index.js pay-merchant-live http://127.0.0.1:4021/api/premium-data "Test SAT-FLOW merchant payment"`
  - `node packages/cli/src/index.js pay-merchant-live http://127.0.0.1:4024/api/premium-data "Real SAT-FLOW USDCx merchant payment"`

Required env for live flows:

- `SAT_FLOW_NETWORK`
- `SAT_FLOW_VAULT_CONTRACT`
- `SAT_FLOW_FACILITATOR_URL`

Required signer input for live flows:

- `SAT_FLOW_AGENT_KEY`
- or `SAT_FLOW_SEED_PHRASE`

Optional env for live flows:

- `SAT_FLOW_USDCX_CONTRACT`
- `SAT_FLOW_HIRO_API_BASE_URL`
- `SAT_FLOW_HIRO_API_KEY`
- `SAT_FLOW_ACCOUNT_INDEX`
- `SAT_FLOW_WALLET_PASSWORD`
- `SAT_FLOW_AGENT_PRINCIPAL`
- `SAT_FLOW_DAILY_CAP`
- `SAT_FLOW_RECIPIENT`
- `SAT_FLOW_AMOUNT`
- `SAT_FLOW_JUSTIFICATION`
- `SAT_FLOW_RESOURCE_URL`
- merchant control-path env:
  - `MERCHANT_BIND`
  - `MERCHANT_PORT`
  - `MERCHANT_PAY_TO`
  - `MERCHANT_TOKEN_TYPE`
  - `MERCHANT_TOKEN_CONTRACT`
  - `MERCHANT_PRICE_MICROSTX`
  - `MERCHANT_RESOURCE_PATH`
  - `MERCHANT_RESOURCE_URL`
  - `MERCHANT_DESCRIPTION`

## Deployment and testnet prep

Deploy the vault contract first, then configure it through the live CLI before attempting a payment.

Suggested order:

1. Deploy [`sat-flow-vault.clar`](/Users/mac/Desktop/Axon-402/packages/contracts/contracts/sat-flow-vault.clar) to Stacks testnet.
   - first run `npm run prepare:testnet` to write Clarinet's testnet settings from your local `SAT_FLOW_SEED_PHRASE`
   - then run:
     - `clarinet deployments generate --testnet -m packages/contracts/Clarinet.toml`
     - `clarinet deployments apply --testnet -m packages/contracts/Clarinet.toml --use-computed-deployment-plan`
2. Export the live env:
   - `SAT_FLOW_NETWORK`
   - `SAT_FLOW_VAULT_CONTRACT`
   - `SAT_FLOW_FACILITATOR_URL`
   - signer input:
     - `SAT_FLOW_AGENT_KEY`
     - or `SAT_FLOW_SEED_PHRASE`
3. Set the authorized agent:
   - `node packages/cli/src/index.js set-authorized-agent-live agent.btc`
4. Set the token cap:
   - `node packages/cli/src/index.js set-daily-cap-live USDCX 50000000`
5. Whitelist the merchant:
   - `node packages/cli/src/index.js set-recipient-whitelist-live merchant.btc true`
6. Confirm allowance:
   - `node packages/cli/src/index.js check-allowance-live USDCX merchant.btc`
7. Run the payment:
   - `node packages/cli/src/index.js pay-live USDCX 1050000 merchant.btc "Need the premium dataset" https://merchant.test/invoice`

In v1 compatibility mode, the vault is the policy and accounting authority. It does not execute the payment transfer itself.

Signer note:

- If both `SAT_FLOW_AGENT_KEY` and `SAT_FLOW_SEED_PHRASE` are set, the CLI uses `SAT_FLOW_AGENT_KEY`.
- `SAT_FLOW_ACCOUNT_INDEX` defaults to `0` for mnemonic-derived accounts.
- `SAT_FLOW_WALLET_PASSWORD` is local-only wallet derivation state and defaults to `SAT-FLOW`.
- The CLI auto-loads the root `.env` file if present.
- `npm run prepare:testnet` also auto-loads the root `.env` file and writes `packages/contracts/settings/Testnet.toml` from `SAT_FLOW_SEED_PHRASE`.
- Keep seed phrases and private keys in a local `.env` that is never committed.

STX caveat:

- The live STX path is wired through the real adapter stack, but it still requires an explicit memo encoding strategy.
- The current `@stacks/transactions` token-transfer builder only accepts UTF-8 string memos, which is not a safe default encoding for SAT-FLOW's raw 34-byte audit anchor.
- `pay-merchant-live` now provides that explicit strategy for the real STX merchant path.
- USDCx remains the recommended product headline for v1 positioning.

## Local x402 merchant control path

The repo now includes a minimal upstream-style x402 merchant path for proving facilitator behavior independently of SAT-FLOW's treasury layer.

Use it when you need to verify that:

- `paymentMiddleware(...)` is issuing a real 402 challenge
- `wrapAxiosWithPayment(...)` can settle against your configured facilitator
- any remaining failure is in SAT-FLOW orchestration, not the base x402 stack

Commands:

- start the local merchant:
  - `npm run merchant:serve`
- run the upstream-style smoke client:
  - `npm run merchant:smoke`

Defaults:

- bind: `127.0.0.1`
- port: `4021`
- resource: `/api/premium-data`
- payment asset: `STX`
- price: `1000000` microSTX

USDCx merchant example:

- port: `4024`
- token type: `USDCx`
- token contract: `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx`
- resource: `http://127.0.0.1:4024/api/premium-data`

This control path is intentionally separate from the SAT-FLOW CLI. SAT-FLOW still owns treasury policy, memo anchoring, and post-settlement accounting. The merchant package exists to prove the standard `x402-stacks` server/client path in the same repo.

Facilitator note:

- the local facilitator repo may not bind to `8080` if that port is already occupied
- in the proven demo environment it was exposed on `http://localhost:8089`
- SAT-FLOW and the merchant server should both point to the actual published facilitator port

## Proven live demo

Working prerequisites:

- local facilitator running and healthy
- merchant server running with:
  - `MERCHANT_PAY_TO=ST3535KR5FDP54HB46XAR359YS8STTS0K2SAKN3X4`
- vault configured with:
  - authorized agent
  - `USDCX` cap
  - `STX` cap
  - merchant recipient whitelisted

Confirmed SAT-FLOW live merchant payments:

- `0x71a65fa4f1e97c8553e5b5f2291978be642186f6309ec616917c64c81c0283c0`
- `0x791c2f5cbdd78805708c62bc48796f2efe7f79a3a21118747a6c6b9e23a0465e`
- `0xe11d1feb63fd0daa88e0bfd12c7362843f2012316bf732cce5e7a505f83c1d44` (real bridged `usdcx`)

Confirmed upstream merchant smoke payment:

- `0x914d81882a057971c4a19ee026270e44a8d5140f2ec6b40e4f1961c3a33ffa92`
- `0x6a734d84bc0e0af5d506e0e20d11ee11aa8a4be3dfd9cd81c0f03a6a6e2b166d` (real bridged `usdcx`)

USDCx proof note:

- the real bridged testnet `usdcx` merchant path is now proven end to end
- the earlier `mock-usdcx` path remains useful as a local SIP-010 regression path, but it is no longer the strongest proof state

Identity caveat:

- SAT-FLOW now resolves BNS names on-chain first through the Stacks BNS contract.
- Hiro remains a fallback path for resilience when the on-chain resolution call fails.

## Why this fits a USDCx programmable category

SAT-FLOW programs USDCx at the policy layer:

- who an agent can pay
- how much an agent can spend per day
- whether the treasury is paused
- how a spend is linked to its reasoning and accounting record

That is a different primitive from deposit routing or liquidity automation, but it is still real USDCx programmability on Stacks.

## Verification

- Clarity verification is handled with `clarinet`
- JavaScript verification is currently dependency-free and limited to runtime-safe modules in this repo

See [docs/SPEC.md](/Users/mac/Desktop/Axon-402/docs/SPEC.md), [docs/ARCHITECTURE.md](/Users/mac/Desktop/Axon-402/docs/ARCHITECTURE.md), and [docs/SYSTEM_MAP.md](/Users/mac/Desktop/Axon-402/docs/SYSTEM_MAP.md).
