# Cap Table

A compliance-aware secondary market for Hedera Asset Tokenization Studio (ATS)
securities, running Uniswap's Continuous Clearing Auction (CCA) as price
discovery. Cap Table inserts a validation hook at `submitBid()` that projects
the resulting shareholder register against the issuer's own compliance rules —
not just "may this bidder hold the token", but "if this bid fills to its worst
case, does the register still satisfy the issuer's investor-count and
ownership limits?".

## Live deployment (Hedera testnet, chain id 296)

| Contract | Address | Sourcify |
|---|---|---|
| Bond (ATS diamond, CTDB) | [`0x40dbbB…F19b5aA`](https://hashscan.io/testnet/contract/0x40dbbB7587180F94388ABfDA89303e57aF19b5aA) | facets verified upstream by ATS |
| Auction (CCA) | [`0x7d6946…2c02C01`](https://hashscan.io/testnet/contract/0x7d69464Ec69F1413C421188485442f07F2c02C01) | ✓ |
| Validation hook | [`0x1E095a…e6D08`](https://hashscan.io/testnet/contract/0x1E095aF8825497f39694617c0703f4Ea39Fe6D08) | ✓ |
| Settlement router | [`0x63B514…FF319`](https://hashscan.io/testnet/contract/0x63B5149d0525222540A0a43d120209b7068FF319) | ✓ |
| Compliance module | [`0x28815D…Bbb46`](https://hashscan.io/testnet/contract/0x28815D9ffDCb4E8c6c387C4eAAdb02AC418Bbb46) | ✓ |
| NAV aggregator (mock) | [`0x07741F…911Fa`](https://hashscan.io/testnet/contract/0x07741F1afedcC0371C0976F0aFFE7B501F1911Fa) | ✓ |
| CCA factory | [`0xCF4D1A…deb27`](https://hashscan.io/testnet/contract/0xCF4D1A8cFeb27A25e6Fb8c9CC0109FF34dDdeb27) | ✓ |
| Deployer / issuer / seller | `0x479178aEE7ac68C31D64e19Fa08955b791757C6F` | — |

The deployed ATS reference contracts are the Hedera ATS v4.0.0 factory
(`0x5fA65CA30d1984701F10476664327f97c864A9D3`) and BLR resolver proxy
(`0xEFEF4CAe9642631Cfc6d997D6207Ee48fa78fe42`).

**What to click:** open the venue page, connect a testnet wallet, hit
*Get KYC* (self-serve), and place a bid. Watch it be **refused** for a legible
regulatory reason (identity, register cap, or NAV band) — then watch an
eligible bid move the clearing price and settle through an ATS
hold-by-partition.

### The exemption list is a design decision, not a workaround

ATS has no custodian/exemption concept; the only cap facets are supply caps.
Max-investor / max-ownership limits are `ICompliance` concerns, so Cap Table
implements them in `CapTableComplianceModule` and exempts the auction and
settlement router from *per-holder* caps so the custody legs
(seller → auction → router) can move the whole supply. This was confirmed as
the intended integration pattern with the ATS team.

## The mechanism in one sentence

> Instead of asking *"is this bidder permitted to hold this token?"*, the hook
> asks *"if this bid fills to its worst case, does the resulting shareholder
> register still satisfy the issuer's compliance rules?"*

## What's here

| Area | Path | Notes |
|---|---|---|
| Validation hook | `contracts/src/CapTableValidationHook.sol` | Core deliverable. Register projection + NAV band. |
| Settlement router | `contracts/src/SettlementRouter.sol` | Only permitted bid submitter; ATS hold-based DvP + refund. |
| Compliance module | `contracts/src/CapTableComplianceModule.sol` | Fallback investor-count / ownership caps. |
| Mock NAV feed | `contracts/src/MockV3Aggregator.sol` | Chainlink AggregatorV3-compatible. |
| ISIN generator | `packages/shared/src/isin.ts` + `contracts/src/Isin.sol` | Deterministic ISO 6166 with Luhn. |
| Deploy scripts | `contracts/script/DeployCapTable.s.sol` | Idempotent issuance/KYC/auction. |
| Indexer | `packages/indexer/` | TypeScript + Postgres + REST API. |
| Web app | `capstone-clarity/` | Vite + TanStack, auction venue + console. |
| Tests | `contracts/test/` | 29 passing Foundry tests. |
| Feedback | `FEEDBACK.md` | Required sponsor feedback findings. |

## Quick start

```bash
pnpm install

# Postgres (Docker) for the indexer
docker compose up -d

# Contracts
forge test          # 29 tests (2 fork-only, guarded to chain id 296)
forge build

# Indexer + API
pnpm --filter @cap-table/indexer dev

# Web app
cd capstone-clarity
cp .env.example .env   # fill in addresses / VITE_INDEXER_API
bun run dev            # or: pnpm dev
```

## Gas measurement

Measured with `forge test --match-path contracts/test/GasMeasurement.t.sol -vv`
against the real CCA and ATS adapters.

| Path | Gas |
|---|---|
| `submitBid` without hook | 353,438 |
| `submitBid` with validation hook | 621,000 |

The hook adds ~267,562 gas. This is above the 400k budget flagged in §6.5 of
the spec; the hook already caches `MAX_INVESTORS`, `MAX_OWNERSHIP_BPS` and
`totalSupply` in immutables, so the remaining cost is the ATS diamond
delegatecalls plus the register-projection reads, not re-reading config.

## The four adversarial cases (all tested)

1. **Concurrent holder-cap race** — 49 of 50 slots used, five new bidders in
   one block: exactly one succeeds, four revert `WouldExceedMaxInvestors`.
   (`contracts/test/RegisterProjection.t.sol`)
2. **Bidder frozen between bid and claim** — refunded at clearing from the
   settlement reserve, tokens returned to seller, state
   `REFUNDED_INELIGIBLE`. (`contracts/test/SettlementRouter.t.sol`)
3. **Reserve underfunded** — `settle` reverts `ReserveUnderfunded` and leaves
   state unchanged. (`contracts/test/SettlementRouter.t.sol`)
4. **`owner`/`sender` bypass** — direct `auction.submitBid` reverts
   `DirectBidsNotPermitted`. (`contracts/test/CapTableValidationHook.t.sol`)

The five demo beats are also proven end-to-end against the live Hedera testnet
deployment on a fork, including the DvP hold settlement and the
`REFUNDED_INELIGIBLE` refund path:

```bash
forge test --match-path contracts/test/DemoBeats.t.sol \
  --fork-url https://testnet.hashio.io/api -vv
```

## Feature → sponsor criteria mapping

**Hedera — Tokenization of Anything (anchor).** Cap Table provides the
*secondary market for ATS-issued assets, which the Studio does not have today*:

- Issuance uses the deployed ATS factory (`deployBond`),
  `contracts/script/DeployCapTable.s.sol:229`.
- KYC/SSI sequence follows the exact order required by ATS
  (`grantRole(ROLE_SSI_MANAGER) → addIssuer → grantKyc`),
  `contracts/script/DeployCapTable.s.sol:240`.
- Settlement uses ATS's own hold-by-partition facets (not a raw transfer),
  `contracts/src/SettlementRouter.sol:289` (`createHoldByPartition`) and
  `contracts/src/SettlementRouter.sol:197` (`executeHoldByPartition`).

**Uniswap Foundation — Best Uniswap Stack Contribution (native extension).**
CCA is deployed and used **unmodified**; the contribution is a validation hook
and a settlement router that compose with it:

- `CapTableValidationHook` implements `IValidationHook`
  (`contracts/src/CapTableValidationHook.sol:20`).
- `SettlementRouter` is the only permitted `submitBid` caller —
  enforced in the hook, not the router
  (`contracts/src/CapTableValidationHook.sol:157`, `DirectBidsNotPermitted`).
- The hook projects the register before accepting a bid, preventing the
  pro-rata fill from silently breaching investor caps
  (`contracts/src/CapTableValidationHook.sol:176`).

**Chainlink (flex).** `MockV3Aggregator` supplies a NAV feed
(`contracts/src/MockV3Aggregator.sol`); the hook enforces a configurable NAV
deviation band with a stale-oracle skip path
(`contracts/src/CapTableValidationHook.sol:220`).

## Design finding

CCA's `claimTokens` performs a raw transfer with no claim-time compliance
re-check. Cap Table inserts `SettlementRouter.settle` in front of it, which
re-checks eligibility and refunds bidders who became ineligible. See
`FEEDBACK.md` for the full list of upstream gaps this workaround exposes —
including the fail-open `balanceOf`-vs-total-balance projection bug that the
hook closes with `AtsBalance.totalOf`.

## Deployment

Contracts are deployed and Sourcify-verified (see table above). State and
addresses live in `deployments/hedera-testnet.json` (tracked; the file holds
only addresses and flags — no keys).

Indexer → Railway and frontend → Cloudflare Workers:

```bash
# backend (needs a Railway account)
cd packages/indexer
railway init && railway add --database postgres
railway variables set HEDERA_RPC=https://testnet.hashio.io/api \
  INDEXER_START_BLOCK=40268139 FAUCET_ENABLED=true
railway variables set ISSUER_PRIVATE_KEY=<key>     # secret, never committed
railway up

# frontend (needs a Cloudflare account)
cd capstone-clarity
VITE_INDEXER_API=https://<app>.up.railway.app bun run build
npx wrangler deploy
```

The production build refuses to run without `VITE_INDEXER_API` set
(`capstone-clarity/vite.config.ts`), so the `localhost:8080` fallback can
never ship silently again.

Issuance (`deployBond`, mint, role grants) is **script-driven** by design:
`contracts/script/DeployCapTable.s.sol` is idempotent and re-runnable. The
browser never holds an issuance-capable key.

## Caveats

- **Testnet only** (chain id 296). Mainnet is out of scope.
- Native **HBAR** auction currency (no Permit2 dependency).
- Single ATS partition (the default).
- The deployer account must be **funded** and **KYC-granted** before running
  the deploy script; the seller must hold the bond total supply.
