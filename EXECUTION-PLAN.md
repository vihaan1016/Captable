# Cap Table — complete execution plan to a finished product

**Written 8 September 2026.** Deadline: **Sunday 13 September, 12:00 EDT**.
This file supersedes the schedule in `PLAN.md` and absorbs it. `AUDIT.md` remains the evidence base.

Everything here is derived from commands actually run against the deployed contracts. Where a step
depends on a fact, the fact is stated with the command that proved it, so you can re-verify rather
than trust this file.

**Read §1 and §2 before touching anything.** §2 contains a hard ordering constraint that will cost
you a day if you discover it late.

---

## 1. What changed since `AUDIT.md` — three new findings

### F-13 · The register projection reads the wrong balance · **fail-open on ownership** · NEW, CRITICAL

This came out of the ATS thread, and it is worse than the caveat we were given. We were warned about
over-counting holders. There is also an **under-count on ownership, which fails open.**

Proven against the deployed bond (`contracts/test/AtsRegisterSemantics.t.sol`, written today):

```
$ forge test --match-path contracts/test/AtsRegisterSemantics.t.sol \
    --fork-url https://testnet.hashio.io/api -vv

before: balanceOf   = 1000000
before: holderCount = 1
after : balanceOf   = 0          <- entire balance moved into an unexecuted hold
after : heldAmount  = 1000000
after : holderCount = 1
=> A: balanceOf EXCLUDES held tokens (available). Router WILL double-count.
=> B: a fully-held holder STILL occupies a register slot.
```

So on this deployment `balanceOf` returns **available**, while `getTotalSecurityHolders()` counts
anyone whose **total** (available + held + locked) is non-zero. We use `balanceOf` in four places
that assume it means total. Three are wrong:

| # | Site | Current code | Effect |
|---|---|---|---|
| a | `SettlementRouter.sol:94` | `balanceOf(msg.sender) == 0` → `pendingNewBeneficiaries++` | Mid-settlement bidder counted **twice** → over-count → over-strict |
| b | `CapTableValidationHook.sol:170`, `:198` | `isExistingHolder = balanceOf > 0 \|\| …` | Fully-held holder reads as new → **+1** → over-strict |
| c | `CapTableValidationHook.sol:176`, `:204` | `projectedBalance = balanceOf + pendingAmount + amount` | Held tokens **invisible** → ownership **under-counted** → **cap can be breached** |

(a) and (b) fail closed — annoying, not dangerous. **(c) fails open.** A bidder holding 14% in an
unexecuted hold, bidding for 14% more, projects as 14% and passes a 1500 bps cap at an actual 28%.
That is precisely the breach the hook exists to prevent, and it is reachable during any settlement
window — which, in a live auction, is most of the time.

Fix in **A2/A3**. This must ship: it is the correctness core of the whole submission, and
`FEEDBACK.md` already claims it as our contribution.

### F-14 · ATS documents a "lock hash" for holds that does not exist · feedback-only
Confirmed first-hand in our own tree: `contracts/src/ats/IHoldByPartition.sol` `Hold` struct is
`{amount, expirationTimestamp, escrow, to, data}` — **no hash field**. Our "secret reveal" is
implemented in `SettlementRouter`, not in ATS. ATS's `hold-operations.md` recommends the flow for
HTLCs. Goes in `FEEDBACK.md` (**D2**).

### F-15 · ERC-3643 creation accepts any address as Identity Registry with no interface check · feedback-only
Wrong address → every mint reverts `IdentityRegistryCallFailed` (`0xad87849e`) with no further
information. Same trap on compliance: `ComplianceCallFailed` (`0x67fba102`). Goes in `FEEDBACK.md`.

### Two questions from the thread, now settled
- **Exemption list — we were right.** ATS has no exemption/custodian concept; the only cap facets are
  supply caps. Max-investor/max-ownership are `ICompliance` concerns and belong in our module. Our
  `CapTableComplianceModule.setExempt` (`:45`) and the deploy script's
  `setExempt(predicted, true)` / `setExempt(router, true)` (`DeployCapTable.s.sol:381-382`) are the
  intended approach, **not a workaround**. Say so in the README — it is a design decision, not a hack.
- **`getTotalSecurityHolders()` decrements** — it is not a ratchet. But see F-13: the test is on
  *total* balance, so a slot is only released when held and locked both reach zero too.

> **Caution about the thread's source.** The answers were derived from ATS **v8.0.0**; our bond is
> **Config ID 2, Version 1** (`cast call <bond> "version()(string)"`). The v8 internals cited do not
> all exist here — `getTotalTokenHolders()` and `getAvailableBalanceFor()` are **not registered** on
> our diamond. We hit the same v4-vs-v8 trap today with the coupon role hash. Verify against the
> deployment, never against `main`.

---

## 2. The ordering constraint — read this first

Fixing F-13 changes `SettlementRouter` and `CapTableValidationHook`. Both are immutable, so both must
be redeployed. And the hook address is inside the auction's CREATE2 input:

```solidity
parameters.validationHook = hook;                  // DeployCapTable.s.sol:373
bytes memory configData = abi.encode(parameters);
address predicted = factory.getAddress(bond, totalSupplyRaw, configData, salt, seller);
```

**Therefore: new hook ⇒ new configData ⇒ new auction address ⇒ new auction.** You cannot fix F-13 and
keep the current auction. Fortunately we need a new auction anyway (F-1), so these compose — but it
means **the entire address set downstream changes**, and the indexer and frontend must be rebuilt
against it. Do not start B7 (Railway) or C7 (Cloudflare) until A9 has produced final addresses.

**The supply is stranded and must be recovered first.** The dead auction holds all 1,000,000 tokens
(`getSecurityHolders(0,10)` returns `[0x8c72Dab6…]`, the auction itself). A new auction requires the
seller to hold the supply before creation. Verified recovery path:

```
$ cast call <oldAuction> "sweepUnsoldTokens()" --from 0x479178aE… --rpc-url $HEDERA_RPC
0x                                    <- succeeds; returns supply to tokensRecipient
$ cast call <oldAuction> "tokensRecipient()(address)"
0x479178aEE7ac68C31D64e19Fa08955b791757C6F   <- our deployer/seller
```

**Critical path, strictly ordered. Nothing later can start before the step above it finishes:**

```
A1-A5  fix F-13 + tests            (no chain interaction — start immediately)
A6-A7  auction schedule + steps    (no chain interaction — parallel with A1-A5)
  ↓
A8     sweep supply back to seller     <- one transaction, unblocks everything
  ↓
A9     redeploy router+hook, create new auction   <- produces the FINAL address set
  ↓
A10-A13  NAV, coupon role, deployments file, verification
  ↓
B7     Railway (needs deployments/hedera-testnet.json + auction start block)
  ↓
C7     Cloudflare (needs the Railway URL)
  ↓
D5     rehearsal → video → submit
```

Everything in §5 (docs) and most of §3–§4 (code) can be written before A9; only the *deploys* are
gated.

---

## 3. Workstream A — contracts

Owner: **A** (chain). A1–A7 need no network and should start immediately.

### A1 · Add the missing ATS interfaces · must-ship

Three facets are registered on the diamond but absent from our interfaces. Verified:

```
getHeldAmountFor(address)              0x8493aabb  -> facet 0x83Eeb154..
getLockedAmountFor(address)            0x36e74467  -> facet 0xfc8B8596..
setCoupon((uint256,…,uint8,uint8))     0xb16fd0cc  -> facet 0x6F5D42bC..
```

Create `contracts/src/ats/IAtsBalances.sol`:

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

interface IAtsBalances {
    function getHeldAmountFor(address account) external view returns (uint256);
    function getLockedAmountFor(address account) external view returns (uint256);
}
```

Create `contracts/src/ats/ICoupon.sol` — struct field order is load-bearing, it determines the
selector. Taken from ATS `packages/ats/contracts/contracts/facets/coupon/ICouponTypes.sol`:

```solidity
interface ICoupon {
    struct Coupon {
        uint256 recordDate;
        uint256 executionDate;
        uint256 startDate;
        uint256 endDate;
        uint256 fixingDate;
        uint256 rate;
        uint8   rateDecimals;
        uint8   rateStatus;      // RateCalculationStatus enum
    }
    function setCoupon(Coupon calldata newCoupon) external returns (uint256 couponID_);
    function getCouponCount() external view returns (uint256);
}
```

**Done when:** `cast sig "setCoupon((uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8))"`
returns `0xb16fd0cc`, matching the registered selector. If it does not, the struct is wrong — stop
and re-derive, do not "fix" it by guessing.

### A2 · Add a total-balance helper · must-ship

`contracts/src/AtsBalance.sol`. Degrade gracefully if a facet is missing, mirroring the existing
defensive pattern in `_navBand` — a bond without hold facets must not brick bidding:

```solidity
library AtsBalance {
    /// @notice available + held + locked. ATS `balanceOf` returns AVAILABLE only;
    ///         `getTotalSecurityHolders()` counts on TOTAL. See AtsRegisterSemantics.t.sol.
    function totalOf(address bond, address account) internal view returns (uint256 total) {
        total = IERC20(bond).balanceOf(account);
        (bool okH, bytes memory h) =
            bond.staticcall(abi.encodeWithSelector(0x8493aabb, account));   // getHeldAmountFor
        if (okH && h.length >= 32) total += abi.decode(h, (uint256));
        (bool okL, bytes memory l) =
            bond.staticcall(abi.encodeWithSelector(0x36e74467, account));   // getLockedAmountFor
        if (okL && l.length >= 32) total += abi.decode(l, (uint256));
    }
}
```

Must be `view` — `previewValidate` is a view function and will not compile otherwise.

### A3 · Apply the fix at all four sites · must-ship

```solidity
// SettlementRouter.sol:94
- if (!isPendingBeneficiary[msg.sender] && IERC20(BOND).balanceOf(msg.sender) == 0) {
+ if (!isPendingBeneficiary[msg.sender] && AtsBalance.totalOf(BOND, msg.sender) == 0) {

// CapTableValidationHook.sol:170 and :198  (validate and previewValidate)
- bool isExistingHolder = IERC20(BOND).balanceOf(beneficialOwner) > 0
+ bool isExistingHolder = AtsBalance.totalOf(BOND, beneficialOwner) > 0

// CapTableValidationHook.sol:176 and :204  <- THE FAIL-OPEN ONE
- uint256 projectedBalance = IERC20(BOND).balanceOf(beneficialOwner) + router.pendingAmountFor(...) + amount;
+ uint256 projectedBalance = AtsBalance.totalOf(BOND, beneficialOwner) + router.pendingAmountFor(...) + amount;
```

Change `validate` and `previewValidate` **in the same commit**. Changing one alone manufactures the
preview/validate divergence that F-10 warns about.

Leave `SettlementRouter.sol:150/158` (`beforeBond`/`tokensFilled` deltas on `address(this)`) alone —
those measure a delta from `claimTokens`, which is a raw transfer into available balance. Correct
as-is. Add a comment saying so, so nobody "fixes" it later.

### A4 · Teach MockBond about holds · must-ship
`contracts/test/mocks/MockBond.sol` has no hold concept, so unit tests cannot reach F-13. Add
`heldOf`/`lockedOf` mappings, `getHeldAmountFor`/`getLockedAmountFor`, a test-only
`setHeld(address,uint256)`, and make `getTotalSecurityHolders()` count on total rather than
available — mirroring the real contract.

### A5 · Regression tests for F-13 · must-ship
`contracts/test/RegisterProjection.t.sol` — add three, one per failure mode:

```solidity
function test_HeldTokensCountTowardOwnership() public {
    // beneficiary holds 14% entirely in a hold; bids for 14% more.
    // MUST revert WouldExceedMaxOwnership. Fails before A3, passes after.
}
function test_FullyHeldHolderIsNotCountedAsNewInvestor() public { /* no +1 */ }
function test_RouterDoesNotDoubleCountMidSettlementBidder() public { /* pendingNewBeneficiaries stays 0 */ }
```

Write them **failing first** against the current code, then apply A3. A green test that was never red
proves nothing here.

Keep `contracts/test/AtsRegisterSemantics.t.sol` (added today) as the pin on ATS behaviour — if a
future ATS upgrade makes `balanceOf` total, that test tells you, and A2 can be simplified.

**Done when:** `forge test` is 27+/27 with the three new tests, and each was observed red before A3.

### A6 · Real auction schedule from config · must-ship
`DeployCapTable.s.sol:308-310` hardcodes 30/300/30, and `bond.testnet.json`'s `startBlockDelta` /
`endBlockDelta` / `claimBlockDelta` are **never read** — dead keys that invite a silent no-op edit.

```solidity
uint64 startDelta = uint64(vm.parseJsonUint(cfg, '.auction.startBlockDelta'));
uint64 endDelta   = uint64(vm.parseJsonUint(cfg, '.auction.endBlockDelta'));
uint64 claimDelta = uint64(vm.parseJsonUint(cfg, '.auction.claimBlockDelta'));
uint64 startBlock = uint64(block.number) + startDelta;
uint64 endBlock   = startBlock + endDelta;
uint64 claimBlock = endBlock + claimDelta;
```

Steps must derive from `endDelta`, not stay hardcoded. The CCA constructor enforces
**Σ(mps × blockDelta) == 10,000,000 exactly** or reverts:

| Profile | endBlockDelta | Steps | Σ | Duration @ 2.1433 s/block (measured) |
|---|---|---|---|---|
| `long` (public) | 300,000 | `200_000 @ 25` + `100_000 @ 50` | 10,000,000 ✓ | **7.44 days** |
| `short` (video) | 300 | `200 @ 25_000` + `100 @ 50_000` | 10,000,000 ✓ | **10.7 min** |

Same shape scaled by 1000. Select with `AUCTION_PROFILE=short|long`, default `long`.
Keep `short` — the video needs a real graduation on camera, which 7.44 days cannot give you.

**Also make the salt configurable.** It is currently `bytes32(0)`
(`DeployCapTable.s.sol:349`). New configData gives a new address this time, but a future identical
redeploy would collide on an occupied address with a confusing error. Read `AUCTION_SALT`, default 0.

### A7 · Step invariant test · must-ship
The single most likely cause of a failed redeploy under pressure.

```solidity
// contracts/test/AuctionSteps.t.sol
function test_StepsSumToOneE7() public pure {
    assertEq(uint256(200_000) * 25 + uint256(100_000) * 50, 10_000_000);   // long
    assertEq(uint256(200) * 25_000 + uint256(100) * 50_000, 10_000_000);   // short
}
```

### A8 · Recover the supply · must-ship · **one transaction, unblocks the whole plan**

```bash
source .env
cast send 0x8c72dab63faf9b9f68fd6f28093c3877735a025b "sweepUnsoldTokens()" \
  --rpc-url $HEDERA_RPC --private-key $DEPLOYER_PRIVATE_KEY
```

**Done when:**
```bash
cast call <bond> "balanceOf(address)(uint256)" 0x479178aE…   # must be 1000000
```
**If it fails:** fall back to deploying a fresh bond via the deploy script's issuance path (adds
~1 hour and changes the bond address everywhere). Simulated successfully today — returns `0x` — so
this should work, but check the balance before proceeding to A9 rather than assuming.

### A9 · Redeploy router + hook + auction · must-ship · **produces the final address set**

The script already performs the full cycle correctly, including the CREATE2 dance. Re-run it:

```bash
AUCTION_PROFILE=long forge script contracts/script/DeployCapTable.s.sol \
  --rpc-url $HEDERA_RPC --broadcast -vvv
```

What it does, in order (`DeployCapTable.s.sol:347-405`) — worth understanding before you run it,
because a mid-way failure leaves the supply in limbo:
1. deploy router + hook with `address(0)` auction placeholder
2. `parameters.validationHook = hook` → `configData` → `factory.getAddress(...)` → `predicted`
3. `router.setAuction(predicted)`, `hook.setAuction(predicted)`
4. `compliance.setExempt(predicted, true)`, `setExempt(router, true)` — the exemption list the ATS
   thread confirmed is the right approach
5. KYC-grant `predicted` **before it exists**, and the router
6. transfer full supply → `predicted`
7. `factory.create(...)` → auction
8. `onTokensReceived()` — the CCA balance check lives here, not in the constructor, and the factory
   does not call it. Miss this and the auction never activates.

Reused unchanged: **bond, compliance module, oracle, CCA factory.** New: **router, hook, auction.**

**Done when:**
```bash
cast call <newAuction> "validationHook()(address)"   # == new hook, not 0x0
cast call <newAuction> "endBlock()(uint256)"         # > current head + 250000
cast call <newAuction> "isGraduated()(bool)"         # false
cast call <bond> "balanceOf(address)(uint256)" <newAuction>   # 1000000
```

Housekeeping: `compliance.setExempt(<oldRouter>, false)` and `setExempt(<oldAuction>, false)` so the
exemption list reflects only live infrastructure. Cosmetic, but a judge may read it.

### A10 · Fix the NAV band · must-ship · **30 minutes, highest value-per-minute in the plan**

Currently inert. The feed is 62.7 h stale against a 3600 s threshold, and the hook treats stale as
*skip*, so a bid at 4.8× NAV is accepted — provable by a judge in one `cast call`.

`setMaxStaleness` is owner-gated and `owner() == 0x479178aE…` (our deployer), so no redeploy:

```bash
cast send <oracle>  "setNav(int256)" 10331 --rpc-url $HEDERA_RPC --private-key $DEPLOYER_PRIVATE_KEY
cast send <newHook> "setMaxStaleness(uint256)" 604800 --rpc-url $HEDERA_RPC --private-key $DEPLOYER_PRIVATE_KEY
```

7 days of staleness tolerance covers judging with no operator awake. Prefer this to a cron —
fewer things to fail silently at the weekend.

**Done when** (this is the assertion that F-2 is actually closed):
```bash
cast call <newHook> "previewValidate(uint256,uint128,address)(bool,bytes4)" \
  $(python3 -c 'print(50000<<96)') 100 <kycedAddr>
# must be false. It is TRUE today.
```

### A11 · Grant the coupon role · must-ship (gates C5)
```bash
cast send <bond> "grantRole(bytes32,address)" \
  0x8a139eeb747b9809192ae3de1b88acfd2568c15241a5c4f85db0443a536d77d6 \
  0x479178aEE7ac68C31D64e19Fa08955b791757C6F \
  --rpc-url $HEDERA_RPC --private-key $DEPLOYER_PRIVATE_KEY
```
That hash is `keccak256('security.token.standard.role.corporateAction')` — the **v4** preimage,
confirmed present in the setter facet's bytecode. The v8 constant from ATS `main`
(`asset.tokenization.standard.role.CorporateAction`) is **absent** and will silently not work.
Deployer holds `DEFAULT_ADMIN_ROLE` (verified `true`), so it can self-grant.

**Done when:** `cast call <bond> "hasRole(bytes32,address)(bool)" <role> <deployer>` → `true`.

### A12 · Commit the deployments file · must-ship
`/api/deployment` reads `deployments/hedera-testnet.json` (`api.ts:299`) and `.gitignore:16`
excludes it, so a container built from a clean clone 500s and the frontend never learns any address.

```bash
# .gitignore — replace the `deployments/` line with:
deployments/*
!deployments/hedera-testnet.json

git add -f deployments/hedera-testnet.json
git diff --cached          # eyeball it: addresses and booleans only, no keys
```
Verified safe today — the file holds only addresses and flags.

### A13 · Verify all contracts · must-ship (Hedera qualification)
All seven are unverified (`match: null` from Sourcify, on a chain Sourcify supports).

```bash
forge verify-contract <addr> <ContractName> --chain 296 \
  --verifier sourcify --verifier-url https://server-verify.hashscan.io
```
For: new router, new hook, new auction, compliance, oracle, CCA factory. The **auction and factory
are compiled `via_ir`** (see `compilation_restrictions` in `foundry.toml`) — verify with the matching
profile or the bytecode will not match and you will lose an hour to it. The bond is an ATS diamond
proxy (390 bytes); verify the proxy and note in the README that its facets are ATS-deployed and
verified upstream.

**Done when:** `curl -sL https://sourcify.dev/server/v2/contract/296/<addr>` returns non-null
`"match"` for each.

---

## 4. Workstream B — indexer

Owner: **B**. B1–B6 need no chain and start immediately.

### B1 · Stop the process dying on a rejection · must-ship
Recording a hook refusal — the flagship demo beat — currently kills the whole backend. Three layers,
all three needed:

1. `capstone-clarity/src/lib/chain-context.tsx:515` `recordRefusal` → add `attempted_by: address`.
2. `packages/indexer/src/api.ts:260` → 400 when `attempted_by` is missing, instead of inserting `null`
   into a `NOT NULL` column.
3. `packages/indexer/src/index.ts` → an error boundary, because **only 2 of 10 routes have any
   error handling** and Express 4 turns a rejected async handler into a process-level unhandled
   rejection, which Node 25 treats as fatal:

```ts
app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: String(err), retryable: true } });
});
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException',  (e) => console.error('[uncaughtException]', e));
```

**Done when:** POST with no `attempted_by` → 400; POST valid → 200; **and `/api/health` still
answers afterwards.** That last clause is the actual test.

### B2 · Make backfill possible · must-ship
`indexer.ts:33` `Math.max(START_BLOCK, head - 32)` makes `INDEXER_START_BLOCK` a **floor** — it can
only move the start *forward*. Verified: set to 40180500, it still resumed at 40234923. This is why
four routes 404.

```ts
const cp = await readCheckpoint(pool);
let last = cp ?? (START_BLOCK > 0 ? START_BLOCK : Number(await client.getBlockNumber()) - 32);
```

And chunk — `indexRange` currently issues one unchunked `getLogs` across the whole span, which public
Hedera RPCs refuse:

```ts
const CHUNK = 1000;
for (let from = last + 1; from <= head; from += CHUNK) {
  const to = Math.min(from + CHUNK - 1, head);
  await indexRange(pool, client, BigInt(from), BigInt(to));
  await writeCheckpoint(pool, to);        // inside the loop: a crash resumes, not restarts
}
```

**Done when:** against an empty DB with `INDEXER_START_BLOCK=<newAuctionBlock-100>`,
`/api/auction/<addr>` returns 200 with real data — it 404s today.

### B3 · CORS · must-ship · **ten minutes, total blocker**
Zero `access-control-*` headers on any response today. Every cross-origin call from the hosted
frontend will be blocked regardless of everything else.

New dependency: **`cors`** (~8 kB, no transitive deps) — justified because hand-rolling `OPTIONS`
preflight is a classic time-pressure bug.

```ts
app.use(cors({ origin: [/\.workers\.dev$/, /^http:\/\/localhost:\d+$/] }));
```
Allowlist, not `*`: the POST route writes to the DB, and an open origin invites drive-by writes into
the demo's rejection feed during judging.

### B4 · Self-serve KYC endpoint · must-ship
The venue refuses bids from non-KYC'd addresses. That is the product — and it means no stranger can
try the demo unless someone grants them KYC at 3am.

`POST /api/faucet/kyc { address }` holding the issuer key, surfaced as a button (C6).

**This puts an issuer key behind a public endpoint. The bounding is what makes it acceptable:**
- Testnet-only key, testnet HBAR, no value. Worst case: drained faucet, demo stops granting.
- It is an **ATS issuer on one demo bond** — it can grant KYC. It cannot mint, move the seller's
  tokens, or change compliance rules; those need roles held by the deployer, which stays offline.
- **One function, one argument.** It takes an address. It never accepts calldata, a target, or an
  amount. There is no path from this endpoint to an arbitrary transaction.

Controls, in order of how much they actually matter:
1. **One grant per address, ever** — checked on-chain before spending gas.
2. **Global cap ~20/hour** — this is the control that protects the account; per-IP limits are
   trivially evaded.
3. Per-IP ~5/hour — stops casual abuse only.
4. Origin allowlist, same list as B3.
5. `ISSUER_PRIVATE_KEY` in Railway secrets. `.env` is gitignored and has never been committed —
   keep it that way; use `railway variables set`, never `git add`.
6. `FAUCET_ENABLED=false` kill switch for abuse during judging.

No captcha (a judge should not solve one), no signature challenge (adds a wallet round-trip at
exactly the point people abandon).

**Fallback if cut:** a KYC'd demo address with its key printed on the venue page. Honest, works, and
strictly worse — concurrent judges fight over one nonce.

### B5 · Dockerfile · must-ship
None exists anywhere in the project.

```dockerfile
# packages/indexer/Dockerfile
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/indexer/package.json packages/indexer/
RUN pnpm install --frozen-lockfile
COPY packages/ ./packages/
COPY deployments/ ./deployments/
RUN pnpm --filter @cap-table/shared build && pnpm --filter @cap-table/indexer build
CMD ["pnpm","--filter","@cap-table/indexer","start"]
```

`COPY deployments/` is load-bearing and depends on **A12** — without it `/api/deployment` 500s and
nothing renders. This is the subtlest failure in the whole deployment path.

### B6 · Local end-to-end check before Railway · must-ship
```bash
docker run -d --name captable-pg -e POSTGRES_USER=cap_table -e POSTGRES_PASSWORD=cap_table \
  -e POSTGRES_DB=cap_table -p 5433:5432 \
  -v "$PWD/packages/indexer/sql/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro" postgres:18
```
Use **5433** — `docker-compose.yml` publishes 5432 and collides with a host Postgres
(`bind: address already in use` on at least one dev machine). Consider changing the compose file to
`5433:5432` permanently.

Hit all 10 routes and confirm 8 return real data (2 are health/deployment).

### B7 · Railway · must-ship · **gated on A9 + A12**
```bash
railway init
railway add --database postgres
railway variables set \
  HEDERA_RPC=https://testnet.hashio.io/api \
  INDEXER_START_BLOCK=<newAuctionCreationBlock - 100> \
  FAUCET_ENABLED=true
railway variables set ISSUER_PRIVATE_KEY=<key>     # secret, never committed
railway up
```
Railway injects `DATABASE_URL` and `PORT`; `index.ts:11` already honours `PORT`. `schema.sql` is
idempotent and `migrate()` runs at boot — no manual migration.

**Done when:** `curl https://<app>.up.railway.app/api/auction/<newAuction>` returns 200 with real
data **from outside your network**.

---

## 5. Workstream C — frontend

Owner: **C**. C1–C5 can be written before A9; only the deploy is gated.

### C1 · Fix the env wiring · must-ship
`src/lib/api.ts:1` falls back to `http://localhost:8080`, and that fallback is **baked into the
production bundle** — verified in `.output/public/assets/utils-*.js`. Every visitor's browser fetches
their own machine. The build does not warn.

Add a build-time guard so this can never ship silently again:
```ts
// vite.config.ts
if (mode === 'production' && !process.env.VITE_INDEXER_API) {
  throw new Error('VITE_INDEXER_API must be set for a production build');
}
```
Also delete `VITE_FEATURE_COUPON` from `.env.example` or implement it — it is referenced **nowhere**
in `src/`, despite a code comment claiming the coupon is feature-flagged.

### C2 · Point at the new addresses · must-ship
Addresses come from `/api/deployment`, so A12 + B7 handle most of it. Check
`src/lib/contracts.ts` for any hardcoded address and remove it.

### C3 · Make the register projection show real numbers · must-ship
`chain-context.tsx:401-410` renders the pre-flight explanation from indexer data, and two fields are
hardcoded placeholders:
```ts
holdersAfter: register?.holderCount ?? 0,   // never projected — identical to `holders`
beneficiaryBpsAfter: 0,                      // constant
```
With `/register` 404ing today, every number renders **0**. The verdict is correct (it is a real
`previewValidate` staticcall — that part of the design is right) but the explanation beside it is
zeros, which is the part a judge reads.

After B2 the data exists. Compute both projections client-side from the same inputs the hook uses,
including held balances (F-13) so the UI cannot contradict the chain.

### C4 · Auction creation wizard · must-ship
There is **no auction-creation path in the frontend at all** — no `createAuction`, no `ccaFactory`
ABI. (`create` in grep is prose in `routes/README.md:4`.) With a 7.44-day auction this is insurance,
but it is insurance against total demo failure, and it closes 3 of the 13 unwired write paths.

Wizard: `getAddress` → `grantKyc` → `transfer` → `create`. Mirror `DeployCapTable.s.sol:347-405`
exactly, including `onTokensReceived()` — omit that and the new auction silently never activates.

### C5 · Wire the coupon for real · must-ship, hard checkpoint
Currently `console.tsx:736-758` returns `"0x"` and shows `toast.success("Coupon scheduled")` for a
transaction that never happens — and `couponScheduled` is hardcoded `false`
(`chain-context.tsx:386`), so Distribute is permanently unreachable behind "Schedule the coupon
first". The pair cannot be driven to completion even as theatre.

The facet is live, so this is wiring, not contract work:
```
setter   0x6F5D42bC570CB5adcfe4E2df3560660a156b397e
selector 0xb16fd0cc
reads    0x1481BC45C7DF91B00865e34B73D8550FF2928A73
role     0x8a139eeb…  (granted in A11)
```
Add `COUPON_ABI` from A1's `ICoupon`, an `actions.setCoupon(...)`, and drive `couponScheduled` from
`getCouponCount()` rather than the hardcoded `false`. `cancelCoupon` is **not registered** on this
diamond — build no UI for it.

**Hard checkpoint — Thursday 18:00.** If `getCouponCount()` has not gone 0 → 1 on testnet by then,
stop and ship the honest-disabled label instead (~20 min). Do not carry this into Friday.

### C6 · Self-serve KYC button · must-ship
Appears only when the connected address lacks KYC. Calls B4. On success, refetch and let the venue
re-enable bidding without a reload.

### C7 · Cloudflare · must-ship · **gated on B7**
```bash
cd capstone-clarity
VITE_INDEXER_API=https://<app>.up.railway.app bun run build
npx wrangler deploy
```
**Done when:** `grep -r "localhost:8080" .output/` is empty and the deployed page loads auction data
with a clean network tab.

### C8 · Remaining write paths · cuttable
C4 closes 3 and C5 closes 1 of the 13 gaps. The rest — `deployBond`, `grantRole`, `addIssuer`,
`mint`, `setCompliance`, `setExempt`, `checkpoint`, `sweepUnsoldTokens`, `sweepCurrency` — are
issuance and post-auction ops the demo does not traverse. Ship if time allows; otherwise state
plainly in the README that issuance is script-driven rather than implying browser support.

> Note: `sweepUnsoldTokens` is worth promoting above the others if C4 ships — it is what makes
> auction recycling work from the browser (it is exactly what A8 does by hand).

---

## 6. Workstream D — docs and submission

Owner: **E**. **None of this is chain-gated. Start Tuesday.** This is the schedule's shock absorber.

### D1 · README rewrite · must-ship (Uniswap qualification)
Two of seven line citations are wrong, and they are the two carrying the Uniswap claim — the track
requires a README pointing at exact contracts and lines.

| Claims | Actually contains | Correct target |
|---|---|---|
| `SettlementRouter.sol:264` — ATS hold settlement | `}` | `:192` `executeHoldByPartition`, `:284` `createHoldByPartition` |
| `SettlementRouter.sol:77` — router is sole `submitBid` caller | **blank line** | `CapTableValidationHook.sol:156` `DirectBidsNotPermitted` |

The second is in a **different contract** — not an off-by-a-few slip. Verified accurate and needing
no change: `DeployCapTable.s.sol:211`, `:225`, `CapTableValidationHook.sol:126`, `:172`, `:224`.

**All line numbers shift after A3.** Re-derive every citation *after* the contracts are final, and
verify mechanically:
```bash
sed -n '<n>p' <file>      # for every path:line in the README
```

Also fix (all verified stale): drop the `apps/web` row (`README.md:28`) — that tree is deleted;
replace `pnpm --filter cap-table-web dev` (`:47`) with the real `capstone-clarity` commands; correct
"20 tests" (`:40`) to the final count; and fix the root `.env.example`, which advertises
`NEXT_PUBLIC_*` variables the Vite frontend never reads.

Add up front: live URL, addresses with HashScan links, one-line "what to click", and a short note
that the **exemption list is a deliberate design decision** — ATS has no custodian concept, confirmed
with the ATS team — not a workaround.

### D2 · FEEDBACK.md · must-ship (Uniswap qualification)
Nine solid items already. Add:
- **F-13 as first-hand evidence** — `balanceOf` is available-only while `getTotalSecurityHolders()`
  counts on total, so the obvious projection under-counts ownership and **fails open**. We have a
  reproducing fork test. This is the strongest item in the file; lead with it.
- **F-14** — documented "lock hash" for holds does not exist; no hash field on `Hold`.
- **F-15** — Identity Registry / compliance accept any address with no interface check;
  `IdentityRegistryCallFailed` (`0xad87849e`) and `ComplianceCallFailed` (`0x67fba102`) with no
  diagnostic.
- The **NAV stale-skip trade-off** from F-2: an oracle outage must not brick bidding, but a silent
  skip means the guard is absent exactly when it matters. A real design tension, worth reporting.
- The **v4-vs-v8 divergence** — published docs and `main` describe internals absent from deployed
  v4 diamonds. Cost us real time twice today (coupon role hash, holder-count internals).

> **Attribution — do not skip this.** F-14 and F-15 came from another team building on ATS holds,
> offered to us. Putting them in our submission unattributed would misrepresent our work to judges.
> Credit them by name/handle inline, or move both to a clearly-marked "reported by others in the
> ATS builder thread" section. Ask them how they want to be credited. The findings are strong enough
> that crediting them costs us nothing and misattributing them could cost us everything.

### D3 · Uniswap Developer Feedback Form · must-ship (qualification)
Complete it, linking to the public `FEEDBACK.md`. **Not code, and the single easiest requirement to
forget.** Do it Friday, not Sunday.

### D4 · ATS docs PR · cuttable, high goodwill
The KYC/SSI sequence (`grantRole(ROLE_SSI_MANAGER) → addIssuer → grantKyc`) and the CREATE2
counterfactual-KYC requirement are genuinely undocumented and cost this team real time. A docs PR to
`hashgraph/asset-tokenization-studio` is a strong signal for the Hedera track. Cut if Saturday is tight.

### D5 · Rehearsal · must-ship
From a machine that has never seen this project, clean browser profile:
connect wallet → self-serve KYC → rejected bid (identity) → rejected bid (register cap) → accepted
bid → settle → hold executed → coupon. Watch the network tab for CORS errors and `localhost:8080`.
**Have someone outside the team do it** — the premise is "a stranger can use it".

### D6 · Video ≤ 5 min · must-ship (Hedera qualification)
Record against a **`short` profile** auction so a real graduation happens on camera.

| Time | Beat |
|---|---|
| 0:00–0:30 | ATS issues securities; there is no compliant secondary market |
| 0:30–1:15 | CCA unmodified + validation hook + settlement router |
| 1:15–2:15 | **Rejected on identity**, then **rejected on register cap**, with decoded reasons |
| 2:15–3:00 | Accepted bid, clearing price moves |
| 3:00–4:00 | Settlement via `holdByPartition` + secret reveal — *not* a raw transfer |
| 4:00–4:45 | NAV band rejecting an out-of-band bid |
| 4:45–5:00 | Live URL, invitation to try it |

Lead with the refusals. An auction that accepts bids is unremarkable; one that refuses for a legible
regulatory reason is the entire thesis.

### D7 · Submit · Sunday 09:00 EDT (three hours early)
```bash
curl https://<frontend>.workers.dev                       # 200
curl https://<app>.up.railway.app/api/health              # small lagBlocks
cast call <auction> "endBlock()(uint256)"                 # still ahead of head
cast call <hook> "previewValidate(uint256,uint128,address)(bool,bytes4)" \
     $(python3 -c 'print(50000<<96)') 100 <kyced>         # false
cast call <bond> "getCouponCount()(uint256)"              # 1 if C5 shipped
git ls-files | xargs grep -lE '(0x)?[0-9a-f]{64}' | grep -v lock   # no key material
```
Checklist: public repo · video ≤ 5 min · contracts verified · deployments file tracked ·
`FEEDBACK.md` · **Uniswap form submitted** · README citations mechanically verified · live URL in the
submission.

---

## 7. Schedule — five days, five people

| | Role | Owns |
|---|---|---|
| **A** | Contracts | A1–A13 |
| **B** | Backend | B1–B7 |
| **C** | Frontend | C1–C8 |
| **D** | Infra/QA | B4, B5, D5 |
| **E** | Docs | D1–D4, D6 |

```
Tue 8   A: A1-A7 (F-13 fix + tests + schedule)     B: B1, B2
        D: B5 Dockerfile + B4 design               C: C1, C3 (write, can't deploy)
        E: D1 README + D2 FEEDBACK   <- not chain-gated, start now
   END OF DAY GATE: forge test green with 3 new red-then-green F-13 tests

Wed 9   A: A8 sweep -> A9 REDEPLOY -> A10 NAV, A11 role, A12 deployments
        B: B3 CORS, B6 local e2e     D: B4 faucet     C: C4 wizard, C5 coupon
   END OF DAY GATE: final address set exists; NAV assertion returns false

Thu 10  B/D: B7 Railway  ->  C: C7 Cloudflare (gated on B7)
        A: A13 verification          C: C6 KYC button
   18:00 CHECKPOINT: coupon 0->1 on testnet, or fall back to disabled label

Fri 11  D5 rehearsal (all hands)     E: D1/D2 final pass w/ post-A3 line numbers
        D3 Uniswap form              C: fix what rehearsal finds

Sat 12  D6 video (short profile)     D4 ATS docs PR if time     buffer
Sun 13  09:00 EDT submit
```

**Real dependencies, and nothing else:**
- **A9 gates B7 gates C7.** This is the only hard chain. Everyone else works around it.
- **A8 gates A9.** One transaction. Do it first thing Wednesday, verify the balance, then proceed.
- **A3 gates D1's line numbers.** E can write all README prose Tuesday and fix citations Friday.
- **A11 gates C5.**
- **D5 needs everything.** The only true all-hands item.

---

## 8. Cut order — decided now, while nobody is tired

Cut from the bottom. Do not renegotiate at 2am Saturday; that is the point of writing it Tuesday.

| # | Item | Cost of cutting |
|---|---|---|
| 1 | CI workflow | None. Nobody judges a green tick. |
| 2 | ATS docs PR (D4) | None to us; loses goodwill. |
| 3 | Remaining write paths (C8) | Low. Document issuance as script-driven. |
| 4 | Coupon (C5) | Low **if cut cleanly** — remove the buttons. Fatal if left faking success. |
| 5 | Auction wizard (C4) | Medium. Loses recovery; the 7.44-day window is the mitigation. |
| 6 | Register projection polish (C3) | Medium. Verdict still correct, explanation shows zeros. |
| 7 | Self-serve KYC (B4) | High. Falls back to a shared KYC'd account. |
| 8 | Contract verification (A13) | **Qualification risk (Hedera).** |
| 9 | README citations (D1) | **Qualification risk (Uniswap).** |
| 10 | Uniswap form (D3) | **Qualification failure.** Costs 15 minutes. Never cut. |
| 11 | NAV fix (A10) | High. Chainlink story demonstrably inert. 30 min. Never cut. |
| 12 | F-13 fix (A2/A3) | **Ships a known fail-open compliance hole** in the feature we claim as our contribution. |
| 13 | Hosting (B7/C7) | **Total.** No public demo. |
| 14 | Indexer fixes (B1/B2) | **Total.** Backend dies on the flagship beat. |
| 15 | Sweep + redeploy (A8/A9) | **Total.** Nothing to demo. |

Items 12–15 are not cuttable in any scenario. **Minimum viable submission:**
A8 + A9 + A2/A3 + A10 + B1 + B2 + B3 + B5 + B7 + C1 + C7 + D1 + D2 + D3 + D6.
That is a correct auction, live, honest docs, the form, and a video. Everything else is upside.

---

## 9. Appendix — verified constants

**Current (soon to be superseded — router/hook/auction change at A9):**
```
bond        0x40dbbb7587180f94388abfda89303e57af19b5aa   (ATS diamond, Config ID 2, Version 1)
auction     0x8c72dab63faf9b9f68fd6f28093c3877735a025b   DEAD: ended block 40180814
hook        0xb9f86eac6d2a7fecfc641c1d1dca9339a557cfa4
router      0xda21f64ef264574d06f7e5107109e86af6ba204e
compliance  0x28815d9ffdcb4e8c6c387c4eaadb02ac418bbb46   REUSED
oracle      0x07741F1afedcC0371C0976F0aFFE7B501F1911Fa   REUSED
ccaFactory  0xcf4d1a8cfeb27a25e6fb8c9cc0109ff34dddeb27   REUSED
deployer    0x479178aEE7ac68C31D64e19Fa08955b791757C6F   DEFAULT_ADMIN_ROLE = true
resolver    0xEFEF4CAe9642631Cfc6d997D6207Ee48fa78fe42
```

**Selectors and roles (all confirmed against the deployed diamond):**
```
setCoupon((uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8))  0xb16fd0cc @ 0x6F5D42bC…
getCouponCount()                                                         0x468bb240 @ 0x1481BC45…
getHeldAmountFor(address)                                                0x8493aabb @ 0x83Eeb154…
getLockedAmountFor(address)                                              0x36e74467 @ 0xfc8B8596…
sweepUnsoldTokens()                                                      0x5dd13ca7   (verified: succeeds)
ROLE_CORPORATE_ACTION  0x8a139eeb747b9809192ae3de1b88acfd2568c15241a5c4f85db0443a536d77d6
                       keccak256('security.token.standard.role.corporateAction')   [v4 — NOT the v8 hash]
NOT registered: getTotalTokenHolders(), getAvailableBalanceFor(), cancelCoupon()
```

**Measured facts:**
```
block cadence          2.1433 s/block  (over 10,000 blocks)
1 / 3 / 5 / 7 days     40,311 / 120,935 / 201,558 / 282,181 blocks
CCA step invariant     Σ(mps × blockDelta) == 10,000,000 exactly
  long   200,000@25 + 100,000@50 = 1e7  -> 300,000 blocks = 7.44 days
  short  200@25,000 + 100@50,000 = 1e7  -> 300 blocks = 10.7 min
NAV                    10331 cents, bandBps 1000 (±10%) -> band [9298, 11364]
hedera value           <1 tinybar (1e10 wei) truncates to 0; placeBid requires msg.value == amount
```

**Test inventory after this plan:** 24 existing + 3 F-13 regressions + 1 step invariant +
1 ATS semantics pin = **29**, of which 2 are fork-only (`DemoBeats`, `AtsRegisterSemantics`).
Note `forge test` without `--fork-url` will show fork tests failing in `setUp()`; consider adding the
same `block.chainid != 296` guard used in `AtsRegisterSemantics.t.sol` to `DemoBeats.t.sol` so a
plain `forge test` is clean.
