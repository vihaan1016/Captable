# Cap Table — audit by execution

**Date run:** 8 September 2026 (the brief was written for the 7th; the system clock says the 8th — the
schedule in `PLAN.md` should be built against **five** working days to the 13 September 12:00 EDT
deadline, not six).

**Method.** Every claim below is followed by the command that produced it and its real output.
Anything I could not execute is in §4 and labelled unverified, with the reason. Where this audit
contradicts `AUDIT-2026-09-07.md`, §5 says so explicitly.

**Toolchain used:** `forge 1.5.0-stable`, `node v25.2.1`, `pnpm 11.24.0`, `bun 1.3.14`,
`postgres:18` (Docker), `cast` against `https://testnet.hashio.io/api`.

---

## 1. Verified facts

### 1.1 The contracts build and the suite is green except for one fork-only test

```
$ forge build
[exited with code 0]
```

```
$ forge test -vv
Ran 1 test for contracts/test/DemoBeats.t.sol:DemoBeatsForkTest
Suite result: FAILED. 0 passed; 1 failed; 0 skipped
Ran 3 tests for contracts/test/RegisterProjection.t.sol:RegisterProjectionTest
Suite result: ok. 3 passed; 0 failed; 0 skipped
Ran 6 tests for contracts/test/CapTableValidationHook.t.sol:CapTableValidationHookTest
Suite result: ok. 6 passed; 0 failed; 0 skipped
Ran 5 tests for contracts/test/SettlementRouter.t.sol:SettlementRouterTest
Suite result: ok. 5 passed; 0 failed; 0 skipped
Ran 2 tests for contracts/test/GasMeasurement.t.sol:GasMeasurementTest
Suite result: ok. 2 passed; 0 failed; 0 skipped
Ran 6 tests for contracts/test/Isin.t.sol:IsinTest
Suite result: ok. 6 passed; 0 failed; 0 skipped
Ran 1 test for contracts/test/ValidationAgreement.t.sol:ValidationAgreementTest
Suite result: ok. 1 passed; 0 failed; 0 skipped

Ran 7 test suites: 23 tests passed, 1 failed, 0 skipped (24 total tests)
```

The single failure is `DemoBeats.t.sol`, which reverts in `setUp()` because it needs a fork. It is
not a real failure — see 1.2. **The suite is 24 tests, not the 20 the README claims.**

### 1.2 The end-to-end fork test passes against live Hedera testnet

This is the strongest asset in the repository.

```
$ forge test --match-path contracts/test/DemoBeats.t.sol --fork-url https://testnet.hashio.io/api -vv
Ran 1 test for contracts/test/DemoBeats.t.sol:DemoBeatsForkTest
[PASS] test_AllFiveBeats() (gas: 3016689)
Logs:
  beat 1: reject on identity OK
  beat 2: reject on register OK
  beat 3: accepted bid 0
  beat 4: settle + execute hold OK
  beat 5: refund-ineligible OK

Suite result: ok. 1 passed; 0 failed; 0 skipped; finished in 115.84s
```

All five demo beats — identity rejection, register rejection, acceptance, `holdByPartition`
settlement, and refund of an ineligible bidder — execute against the real deployed contracts.

### 1.3 All six contracts (plus the oracle) are deployed

```
$ cast code <addr> --rpc-url https://testnet.hashio.io/api
bond               0x40dbbb7587180f94388abfda89303e57af19b5aa  codeBytes=390
auction            0x8c72dab63faf9b9f68fd6f28093c3877735a025b  codeBytes=18061
hook               0xb9f86eac6d2a7fecfc641c1d1dca9339a557cfa4  codeBytes=9092
settlementRouter   0xda21f64ef264574d06f7e5107109e86af6ba204e  codeBytes=8285
complianceModule   0x28815d9ffdcb4e8c6c387c4eaadb02ac418bbb46  codeBytes=2423
ccaFactory         0xcf4d1a8cfeb27a25e6fb8c9cc0109ff34dddeb27  codeBytes=24214
```

The bond's 390 bytes is the ATS diamond proxy, as expected. A seventh address, the NAV oracle
`0x07741F1afedcC0371C0976F0aFFE7B501F1911Fa`, is live and appears in `deployments/hedera-testnet.json`
but is absent from the brief's address list.

### 1.4 The deployed auction ended two days ago and never graduated

```
$ cast call 0x8c72... "startBlock()(uint256)"   -> 40180514
$ cast call 0x8c72... "endBlock()(uint256)"     -> 40180814
$ cast call 0x8c72... "claimBlock()(uint256)"   -> 40180844
$ cast call 0x8c72... "isGraduated()(bool)"     -> false
$ cast block-number                             -> 40259568
```

```
current head      = 40,259,568
endBlock          = 40,180,814  -> ended 78,754 blocks ago = 46.9 hours ago
claimBlock        = 40,180,844  -> passed 78,724 blocks ago
auction window    = 300 blocks = 10.7 minutes
isGraduated       = false  -> ended WITHOUT graduating
```

### 1.5 Hedera's real cadence is 2.14 s/block, not 2.00

Measured over 10,000 blocks rather than assumed:

```
$ cast block <head> --field timestamp          -> 1788867285
$ cast block <head-10000> --field timestamp    -> 1788845852
elapsed = 21,433 s over 10,000 blocks
measured cadence = 2.1433 s/block
  1d =  40,311 blocks     5d = 201,558 blocks
  3d = 120,935 blocks     7d = 282,181 blocks
```

### 1.6 The auction schedule is hardcoded, and its steps are arithmetically constrained

`contracts/script/DeployCapTable.s.sol:308-310`:

```solidity
uint64 startBlock = uint64(block.number + 30);
uint64 endBlock   = startBlock + 300;
uint64 claimBlock = endBlock + 30;
```

`contracts/config/bond.testnet.json` contains `startBlockDelta`, `endBlockDelta` and
`claimBlockDelta`, but `grep` shows the script never reads them — **those three config keys are dead.**
The script reads twelve other keys from the same file (line 79-88), so the omission is easy to miss.

Lengthening the auction is not a one-line change, because the release schedule must satisfy an exact
CCA invariant (`DeployCapTable.s.sol:325-331`):

```
Σ(mps × blockDelta) == 10_000_000   exactly
current: 200 blocks @ 25_000 mps + 100 blocks @ 50_000 mps = 10,000,000  ✓
```

A schedule that survives judging week and preserves the invariant is the existing pattern scaled by
1000 — verified arithmetically:

```
200,000 blocks @ 25 mps = 5,000,000
100,000 blocks @ 50 mps = 5,000,000
total                   = 10,000,000  ✓
duration = 300,000 blocks × 2.1433 s = 7.44 days
```

### 1.7 No contract is verified on HashScan

HashScan uses Sourcify as its verification backend for Hedera. Chain 296 is supported by that
instance (it appears in `/server/chains` as `"name":"Hedera Testnet","chainId":296`), so a `null`
match is a real negative, not an unsupported-chain artifact.

```
$ curl -sL "https://sourcify.dev/server/v2/contract/296/<addr>"
bond         "match":null
auction      "match":null
hook         "match":null
router       "match":null
compliance   "match":null
ccaFactory   "match":null
oracle       "match":null
```

### 1.8 The workspace builds and its tests pass — but it covers two of three projects

```
$ pnpm -r build
packages/shared build: Done
packages/indexer build: Done
=== EXIT: 0 ===

$ pnpm -r test
packages/shared test:  ✓ src/index.test.ts (7 tests) 2ms
packages/shared test:  Tests  7 passed (7)
```

```
$ pnpm ls -r --depth -1
cap-table            /Users/pranavrai/captable-priv
@cap-table/indexer   /Users/pranavrai/captable-priv/packages/indexer
@cap-table/shared    /Users/pranavrai/captable-priv/packages/shared
```

`capstone-clarity` — the real frontend — is absent. Neither it nor the indexer defines a `test`
script, so `pnpm test` at the root exercises `packages/shared` only.

### 1.9 The frontend builds clean

```
$ env -u VITE_INDEXER_API -u VITE_HEDERA_RPC bun run build
✓ built in 357ms
EXIT=0
```

### 1.10 The indexer runs, and 2 of its 9 GET routes return real data

Postgres 18 in Docker on :5433 (the compose file's :5432 collided with a host Postgres), schema
loaded clean — 7 tables: `auctions, bids, checkpoints, holders, indexer_state, register_snapshots,
rejections`.

```
### /api/health                       HTTP 200  {"ok":true,"headBlock":"40234961","chainHead":"40234964","lagBlocks":3}
### /api/deployment                   HTTP 200  {"bond":"0x40dbbB...","compliance":"0x28815D...", ...}
### /api/auction/0x8c72…              HTTP 404  {"error":{"message":"No auction at that address in this index."}}
### /api/auction/0x8c72…/book         HTTP 404  {"error":{"message":"No auction at that address in this index."}}
### /api/auction/0x8c72…/bids         HTTP 200  {"bids":[]}
### /api/auction/0x8c72…/rejections   HTTP 200  {"rejections":[]}
### /api/bond/0x40db…/register        HTTP 404  {"error":{"message":"No bond at that address in this index."}}
### /api/bond/0x40db…/investors       HTTP 404  {"error":{"message":"No bond at that address in this index."}}
### /api/bid/0                        HTTP 404  {"error":{"message":"No bid with that id in this index."}}
```

Two routes serve real data. Four 404. Two return structurally-valid empty arrays. The cause is
F-4 below.

### 1.11 Eleven of twenty-four frontend write paths are wired; thirteen are absent

Every write in the app funnels through exactly one call site — `chain-context.tsx:428`,
`const hash = await w.writeContract(args as never)` — so "wired" is decidable by reading the
`actions` object (`chain-context.tsx:414-540`).

| Wired to a real transaction (11) | Target |
|---|---|
| `placeBid`, `exitBid`, `settle`, `executeHold`, `fundReserve` | `SettlementRouter` |
| `grantKyc`, `revokeKyc` | bond (ATS KYC facet) |
| `addToControlList`, `removeFromControlList` | bond (control-list facet) |
| `setRules` | compliance module |
| `setNav` | oracle |

| Absent (13) | Consequence |
|---|---|
| `deployBond`, `grantRole`, `addIssuer`, `mint` | issuance is script-only; the console cannot go from nothing to a bond |
| `setCompliance`, `setExempt` | compliance wiring is script-only |
| `getAddress`, `transfer`, `create` | **no auction can be created from the browser at all** |
| `checkpoint`, `sweepUnsoldTokens`, `sweepCurrency` | post-auction operations unavailable |
| `setCoupon` | see F-6 |

`transfer` and `create` do appear in `grep`, but only as English prose —
`errors.ts:50` ("The transfer would fail…"), `console.tsx:301` ("…every transfer is measured
against"), and `routes/README.md:4` ("Do **not** create `src/pages/`"). There is no `createAuction`,
no `ccaFactory` ABI, and no factory call anywhere in `capstone-clarity/src`.

### 1.12 The pre-flight reads the chain; its displayed projection does not

`chain-context.tsx:394` — the accept/reject verdict is a real `staticcall`:

```ts
const [ok, reason] = await publicClient.readContract({
  address: deployment.hook, abi: HOOK_ABI,
  functionName: "previewValidate", args: [priceQ96, amount, beneficiary],
});
```

That part is correct and is the right design. But the numbers rendered beside it
(`chain-context.tsx:401-410`) come from the indexer (`registerQ.data`, fed by
`/api/bond/:address/register`) and two of them are hardcoded placeholders:

```ts
holdersAfter: register?.holderCount ?? 0,   // never actually projected — same as `holders`
beneficiaryBpsAfter: 0,                      // constant
```

Because `/api/bond/:address/register` currently 404s (1.10), `registerQ.data` is `undefined` and
every projection number renders as **0**. The verdict is right; the explanation beside it is zeros.

### 1.13 The live register and reserve state

```
$ cast call <hook> "registerState()(uint256,uint256,uint256,uint256)"
holders          = 1
maxInvestors     = 50
largestBps       = 10000     <- the seller holds 100% pre-auction
maxOwnershipBps  = 1500
$ cast call <router> "settlementReserve()(uint256)"          -> 0
$ cast call <router> "pendingNewBeneficiaryCount()(uint256)"  -> 0
$ cast call <bond>   "totalSupply()(uint256)"                 -> 1000000
```

`settlementReserve == 0` matters for the demo: the Ops panel computes
`funded = reserveTinybar >= requiredTinybar`, so it currently renders "short" at 0% coverage.

### 1.14 No secrets are present in tracked files

```
$ git check-ignore -v .env
.gitignore:22:.env	.env
$ git ls-files --error-unmatch .env
error: pathspec '.env' did not match any file(s) known to git
$ git log --all --oneline -- .env
(empty — never committed)
```

A scan of every tracked file for 64-hex strings returns only role hashes (`AtsRoles.sol`), the
`SALT` constant (`SettlementRouter.sol:47`), a `BOND_CONFIG_ID`, and a `uint256` max in a spec
document. `.env.example` ships empty key fields. **Nothing leaks.** This is clean and should stay
clean.

### 1.15 The ATS coupon facet is live on the deployed bond — the coupon is wireable

Established while scoping F-6, because it changes the remediation from "new contract work" to
"wire an existing on-chain path". The bond diamond exposes 47 facets. Probing its selector map:

```
$ cast call <bond> "getCouponCount()(uint256)"          -> 0        (returns, does not revert)
$ cast call <bond> "getFacetAddress(bytes4)(address)" <sel>
  getCouponCount()        0x468bb240 -> 0x1481BC45C7DF91B00865e34B73D8550FF2928A73
  getCoupon(uint256)      0x936e3169 -> 0x1481BC45C7DF91B00865e34B73D8550FF2928A73
  getCouponFor(...)       0xbba7b56d -> 0x1481BC45C7DF91B00865e34B73D8550FF2928A73
  getCouponAmountFor(...) 0x439efc2e -> 0x1481BC45C7DF91B00865e34B73D8550FF2928A73
  getCouponHolders(...)   0xa92e8371 -> 0x1481BC45C7DF91B00865e34B73D8550FF2928A73
```

The setter resolves too, on a **different** facet. Signature taken from ATS
`packages/ats/contracts/contracts/facets/coupon/ICoupon.sol` and `ICouponTypes.sol`:

```solidity
struct Coupon { uint256 recordDate; uint256 executionDate; uint256 startDate; uint256 endDate;
                uint256 fixingDate; uint256 rate; uint8 rateDecimals; RateCalculationStatus rateStatus; }
function setCoupon(Coupon calldata _newCoupon) external returns (uint256 couponID_);
```

```
$ cast sig "setCoupon((uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8))"
0xb16fd0cc
$ cast call <bond> "getFacetAddress(bytes4)(address)" 0xb16fd0cc
0x6F5D42bC570CB5adcfe4E2df3560660a156b397e        <- REGISTERED
```

The required role is confirmed by grepping the setter facet's own bytecode, which settles the v4-vs-v8
naming question (`AtsRoles.sol` warns the deployment is v4.x and v8 hashes must not be used):

```
$ cast code 0x6F5D42bC... | grep <hash>
keccak256('asset.tokenization.standard.role.CorporateAction')  [v8 main branch]  -> absent
keccak256('security.token.standard.role.corporateAction')      [v4 deployment]   -> PRESENT
ROLE_CORPORATE_ACTION = 0x8a139eeb747b9809192ae3de1b88acfd2568c15241a5c4f85db0443a536d77d6

$ cast call <bond> "hasRole(bytes32,address)(bool)" <ROLE_CORPORATE_ACTION> <deployer>  -> false
$ cast call <bond> "hasRole(bytes32,address)(bool)" 0x00...00 <deployer>                -> true
```

So the deployer holds `DEFAULT_ADMIN_ROLE` and can self-grant `ROLE_CORPORATE_ACTION`. Wiring the
coupon requires **no new contract** — an interface file, a role grant, and a frontend action.
`cancelCoupon(uint256)` is *not* registered, so cancellation is out of scope.

---

## 2. Findings by severity

### F-1 · The demo auction is dead — nothing can be bid on today · blocks-live-demo

Proved in 1.4. `endBlock` passed 78,754 blocks (46.9 hours) ago and `isGraduated()` is `false`. A
visitor opening the venue today cannot place a bid, and there is no browser path to create a
replacement (1.11). Every other frontend finding is downstream of this one.

Fixing it needs both a new auction **and** the step-schedule arithmetic in 1.6.

### F-2 · The Chainlink NAV band is inert on the live deployment · blocks-qualification (Chainlink), costs-score

The strongest finding in this audit, and it is proved end-to-end rather than argued.

```
$ cast call <oracle> "latestRoundData()(uint80,int256,uint256,uint256,uint80)"
roundId=1  answer=10331  startedAt=1788641641  updatedAt=1788641641  answeredInRound=1

$ cast call <hook> "bandBps()(uint256)"      -> 1000      (±10%)
$ cast call <hook> "maxStaleness()(uint256)" -> 3600      (1 hour)
$ cast block latest --field timestamp        -> 1788867331
```

```
oracle age = 1788867331 - 1788641641 = 225,690 s = 62.7 hours
maxStaleness = 3,600 s
```

`CapTableValidationHook.sol:241-243` treats a stale feed as a **skip, not a rejection**:

```solidity
if (block.timestamp > updatedAt + maxStaleness) {
    emit NavFeedStale(updatedAt);
    return (true, 0, 0);          // <- band check bypassed, bid allowed
}
```

The NAV band is therefore disabled on the live hook. Confirmed against the deployed contract — NAV
is 10331 cents, so the ±10% band is [9298, 11364], and a bid at **4.8× NAV** is accepted:

```
$ cast call <hook> "previewValidate(uint256,uint128,address)(bool,bytes4)" <10331<<96> 100 <kyced>
true   0x00000000

$ cast call <hook> "previewValidate(uint256,uint128,address)(bool,bytes4)" <50000<<96> 100 <kyced>
true   0x00000000        <- 50,000 cents, far outside the band, still accepted
```

The skip-on-stale behaviour is a deliberate and defensible design choice (an oracle outage must not
brick bidding, and `FEEDBACK.md` reasons about exactly this class of problem). The finding is not the
design — it is that **the only Chainlink-facing feature in the project does nothing right now**, and a
judge running that exact `cast call` sees a price guard that does not guard. The oracle needs
`setNav` called, and it needs calling again at least hourly for as long as judging lasts, or
`maxStaleness` needs raising to cover the window.

### F-3 · Posting a hook rejection kills the indexer process · blocks-live-demo

Recording a refusal is the flagship demo beat — "the hook refused your bid, here is the receipt". It
takes the backend down.

Schema (`packages/indexer/sql/schema.sql:39`): `attempted_by TEXT NOT NULL`
Handler (`packages/indexer/src/api.ts:260`): inserts `attempted_by ?? null`
Frontend (`chain-context.tsx:515-527`): `recordRefusal` **never sends `attempted_by`**

Observed by POSTing the exact payload the frontend sends:

```
$ curl -X POST .../api/auction/<auc>/rejections -d '{"beneficiary":"0x…01","error_name":"MaxInvestorsReached",…}'
HTTP 000        <- connection refused: the server died mid-request
```

```
error: null value in column "attempted_by" of relation "rejections" violates not-null constraint
    at async .../packages/indexer/src/api.ts:255:5
Node.js v25.2.1
[ELIFECYCLE] Command failed with exit code 1.
```

Two independent defects compound here. The missing field is one. The other is that **only 2 of the
10 routes have any error handling** (`api.ts:24` and `api.ts:196`); there is no Express error
middleware and no `process.on('unhandledRejection')`, so under Express 4 any rejected async handler
becomes an unhandled rejection and Node 25 terminates the process. Any 500-class bug in any route
is a full outage, not a failed request.

### F-4 · The indexer cannot see the past, and `INDEXER_START_BLOCK` cannot make it · blocks-live-demo

This is why 1.10 shows four 404s. `indexer.ts:31-36`:

```solidity
last = Math.max(START_BLOCK, head - 32);
```

`Math.max` makes `INDEXER_START_BLOCK` a **floor, not a target** — it can only move the start
*forward*. Verified by setting it to a block before the auction and watching it be ignored:

```
$ INDEXER_START_BLOCK=40180500 pnpm start
[indexer] resuming from block 40234923      <- 54,423 blocks past the requested start
```

`Math.max(40180500, 40234964-32) = 40234932`. There is no backfill path in the codebase at all, and
the env var that appears to provide one cannot. A freshly deployed indexer will always start ~32
blocks back and will never index an auction created before it booted.

A second defect sits behind this one: `indexRange` (`indexer.ts:83+`) issues a **single unchunked
`getLogs`** from `last+1` to `head`. Even once the floor bug is fixed, a large backfill will be one
enormous range request, which public Hedera RPCs cap. Both need fixing together.

### F-5 · The production bundle points at the visitor's own machine · blocks-live-demo

`capstone-clarity/src/lib/api.ts:1`:

```ts
const API = (import.meta.env["VITE_INDEXER_API"] as string | undefined) ?? "http://localhost:8080";
```

Built with the variable unset and grepped the emitted client chunk:

```
$ grep -rho '.\{60\}localhost:8080.\{40\}' .output/public
TSS_SERVER_FN_BASE:`/_serverFn/`}.VITE_INDEXER_API??`http://localhost:8080`,om=class extends Error{
```

The fallback survives into `.output/public/assets/utils-EHLUMwx0.js`. Every visitor's browser will
fetch `http://localhost:8080` — their own machine — and every indexer-backed panel fails silently.
The build does **not** fail or warn when the variable is missing.

`VITE_HEDERA_RPC` is fine: its fallback is the correct public RPC and is baked in 6 places.

Two related items: **the indexer sends no CORS headers at all** —

```
$ curl -i .../api/health -H "Origin: https://example.com" | grep -i access-control
(no output)
```

— so even with the URL fixed, every cross-origin call from the hosted frontend is blocked by the
browser. And `/api/deployment`, the route that feeds the app its contract addresses, reads
`../../../deployments/hedera-testnet.json` (`api.ts:299`) — a **gitignored** file
(`.gitignore:16`). A container built from a git clone will not contain it, so that route returns
`DEPLOYMENT_UNREADABLE` 500 in production and the app never learns any addresses.

Three separate defects, each of which alone is fatal to a hosted demo.

### F-6 · The coupon controls report success for transactions that never happen · costs-score

`coupon` appears nowhere in `contracts/src`, `contracts/script`, or `packages/` — only as two dead
config keys in `bond.testnet.json`. `console.tsx:736-742`:

```ts
write={async () => {
  // Coupon scheduling is feature-flagged until the ATS coupon facet is wired.
  toast.success("Coupon scheduled");
  return "0x";
}}
```

`Distribute coupon` is identical. Neither sends a transaction; both show a green success toast.
Worse, `state.couponScheduled` is a hardcoded `false` (`chain-context.tsx:386`), so scheduling never
flips the flag and **Distribute is permanently disabled** behind "Schedule the coupon first" — the
button pair cannot be driven to completion even as theatre.

The comment claims a feature flag. There is none: `VITE_FEATURE_COUPON` is declared in
`capstone-clarity/.env.example` and **referenced nowhere in `src/`**.

A control that fakes a success toast is materially worse on camera than an absent one, and worse
than a disabled one. Cut it or wire it; do not ship it as-is.

**Remediation is cheaper than it looks** — see 1.15. The ATS coupon facet is already live on the
deployed bond, so this is a wiring job, not new contract work.

### F-7 · The two citations Uniswap judges are told to check are wrong · blocks-qualification (Uniswap)

The Uniswap track requires "a README that points at the exact contracts and lines so they can verify
the integration". Five of seven citations are accurate. The two that are not are the two that carry
the Uniswap claim.

| README claim | Points at | Actually contains | Correct location |
|---|---|---|---|
| `SettlementRouter.sol:264` — settlement via ATS hold | line 264 | `}` — a closing brace | `:192` `executeHoldByPartition`, `:284` `createHoldByPartition` |
| `SettlementRouter.sol:77` — router is the only `submitBid` caller | line 77 | **a blank line** | `CapTableValidationHook.sol:156` — `if (sender != SETTLEMENT_ROUTER) revert DirectBidsNotPermitted();` |

Note the second is not merely off by a few lines — the guarantee is enforced in a **different
contract**. Verified accurate: `DeployCapTable.s.sol:211`, `:225`,
`CapTableValidationHook.sol:126`, `:172`, `:224`.

### F-8 · The README describes a repo that no longer exists · costs-score

- `README.md:28` — "| Web app | `apps/web/` | Next.js 14, five routes. |". `apps/` is an empty
  directory; `git status` shows the whole tree deleted.
- `README.md:47-50` — quick start says `pnpm --filter cap-table-web dev`. No such package
  (`pnpm ls -r` lists three projects, none named that). A judge following the README cannot start
  the frontend.
- `README.md:40` — "`forge test # 20 tests`". Actual count is 24 (1.1).
- The root `.env.example` advertises `NEXT_PUBLIC_INDEXER_API` / `NEXT_PUBLIC_HEDERA_RPC`. The real
  frontend is Vite and reads `VITE_*` (1.9, F-5). The documented variables have no effect.

### F-9 · Contracts unverified on HashScan · blocks-qualification (Hedera)

Proved in 1.7 — all seven return `match: null` on a chain Sourcify supports. The Hedera track asks
for verification "where applicable"; six of these are first-party contracts, so it applies. There is
also no committed `deployments/hedera-testnet.json` (F-5), so a judge cannot map an address to a
source file even manually.

### F-10 · `previewValidate` and `validate` can disagree — latent, not currently triggering · costs-score

`ValidationAgreement.t.sol` passes, but it does not prove what its docstring claims. The test bounds
price into the NAV band on purpose:

```solidity
// Bound price into the NAV band so NAV is never the discriminating check;
priceCents = bound(priceCents, 10125, 10125 + 5000);
```

So NAV is excluded from the very comparison the test is named for. Reading the two paths, they are
not identical:

- `_navBand` (used by `validate`, `:228`) — `AGGREGATOR.staticcall{gas: 50_000}(...)`
- `_navBandView` (used by `previewValidate`, `:253`) — `AGGREGATOR.staticcall(...)`, **no gas cap**

An aggregator costing more than 50,000 gas makes `validate` see `success == false` and skip the band
while `previewValidate` applies it — the UI refuses a bid the chain would accept.

**This does not trigger today.** Measured against the live oracle:

```
$ cast estimate <oracle> "latestRoundData()"   -> 31560   (includes 21,000 intrinsic)
=> ~10,560 gas of execution, comfortably inside the 50,000 cap
```

Direction of failure is also the safe one (preview stricter than chain). Recorded because the §8.2
agreement claim is stronger than the evidence supports, and because a real Chainlink aggregator proxy
costs considerably more than this mock.

### F-11 · Workspace incoherence · costs-score

`capstone-clarity` sits outside `pnpm-workspace.yaml` with its own `bun.lock` (1.8). Neither it nor
the indexer has a `test` script. Consequences: `pnpm build` at the root does not build the thing
users actually see, `pnpm test` runs 7 assertions in `packages/shared` and nothing else, and the repo
needs both `pnpm` and `bun` to build fully. There is no `Dockerfile` and no `.github/workflows`, so
nothing is enforced.

### F-12 · Minor, verified

- `docker-compose.yml` binds host `:5432`, which collides with any local Postgres
  (`bind: address already in use` on this machine). Publishing `5433:5432` avoids it.
- `contracts/config/bond.testnet.json` keys `startBlockDelta`, `endBlockDelta`, `claimBlockDelta` are
  never read (1.6). They invite an edit that silently does nothing.
- `forge build` emits `unsafe-typecast` warnings, including
  `DeployCapTable.s.sol:343 requiredCurrencyRaised: uint128(...)`. Cosmetic at current supply, but it
  is an unchecked narrowing cast in the deploy path.
- On Hedera, value below 1 tinybar (10¹⁰ wei) truncates to zero. Since `placeBid` requires
  `msg.value == amount` (`SettlementRouter.sol:88`), any sub-tinybar bid reverts `IncorrectValue()`.
  Worth a UI minimum.
- `largestBps == 10000` against `maxOwnershipBps == 1500` (1.13) — the seller holds 100% pre-auction.
  Correct, but the console will show the register in apparent breach of its own cap before any bid
  lands.

---

## 3. What is genuinely strong

Stated plainly, because the finding list is long and the underlying work is not weak:

- The five-beat fork test passing against live testnet contracts (1.2) is more than most hackathon
  submissions can show, and it exercises the real ATS hold path rather than a mock.
- `FEEDBACK.md` is nine substantive, specific upstream findings about CCA — Permit2 fallback,
  counterfactual KYC, claim-time compliance, partition defaults. This is exactly what the Uniswap
  track is asking for and it is the most differentiated artifact in the repo.
- The register-projection design — refusing a bid whose *worst-case* fill breaches the cap, and
  splitting pending state to avoid double-counting — is the real intellectual contribution, and
  `RegisterProjection.t.sol` covers it.
- The pre-flight calls the chain, not the indexer (1.12). Many teams get this backwards.
- No secrets anywhere (1.14).

---

## 4. Unverified, and why

1. **Whether `placeBid` reverts specifically because the auction ended.** `eth_call` on Hedera does
   not carry `msg.value`, so every simulation returned `IncorrectValue()` (`0xd2ade556`) from the
   `msg.value != amount` guard before reaching the auction gate. The auction's expiry is settled
   independently and definitively by the block comparison in 1.4; only the specific revert selector
   is unproven. Confirming it needs a funded signed transaction.
2. **Whether HashScan's UI shows anything different from the Sourcify API.** I queried the
   verification backend, not the web UI. I consider this low-risk — chain 296 is supported and all
   seven returned `null` — but I did not load `hashscan.io` in a browser.
3. **End-to-end browser behaviour with a real wallet.** I did not run the dev server and connect
   MetaMask. F-1 makes a live bid impossible regardless, and F-5 was established from the built
   artifact rather than from a running page.
4. **Indexer behaviour on populated data.** Because of F-4 the database never held an auction, so
   the six data-bearing routes were only ever exercised in their empty state. Their happy paths are
   unproven — the 404s prove routing and error handling, not correctness of the projections.
5. **Whether F-10 can be triggered in practice.** Measured as not triggering with the current mock
   (31,560 gas estimate). I did not construct a >50k-gas aggregator to force the divergence.
6. **Chainlink track criteria.** Unpublished, as the brief notes. F-2 is scored against the
   project's own stated intent, not against a published rubric.
7. **`isGraduated() == false` cause.** I recorded that the auction ended without graduating; I did
   not determine whether `requiredCurrencyRaised` was unmet or no qualifying bids arrived.
   `settlementReserve == 0` and an empty index are consistent with "no bids", but that is inference,
   not measurement.

---

## 5. Corrections to `AUDIT-2026-09-07.md`

The prior audit was written without the ability to run Foundry or reach the RPC, and it holds up
better than that constraint suggests. F-1, F-2, F-4, F-5, F-7 and F-8 there are **confirmed** by
execution here. Three corrections:

- **Its F-3 count is inverted.** It says "eleven of twenty-four write paths are not wired" and lists
  13 as present. The true split is **11 wired, 13 absent** (1.11). It counted `transfer` and `create`
  as present; both are prose-only false positives — `errors.ts:50`, `console.tsx:301`,
  `routes/README.md:4`. This matters because `create` was its evidence that an auction-creation path
  partly exists. It does not exist at all.
- **Its F-9 ("test suite unverified") is now resolved** — 23/24 local, plus the fork test passing
  (1.1, 1.2).
- **Its F-6 ("fabricated commit history") is unsupported by anything I can see.** Four commits from
  two authors between 2026-08-29 and 2026-09-06, with author and committer timestamps matching on
  every one. Nothing in `git log` indicates backdating. I am not able to say what prompted that
  finding, and I would not repeat it without evidence.

Two things the prior audit could not have known, both material to planning: `INDEXER_START_BLOCK`
cannot backfill (F-4), and its proposed "roughly 200,000 blocks" auction would **fail to deploy** —
the CCA step invariant in 1.6 has to be recomputed alongside, or the constructor reverts.

---

## 6. Fix order implied by these findings

Severity order, for `PLAN.md` to schedule. Numbers in brackets are the findings closed.

1. New auction with a corrected multi-day step schedule [F-1] — everything else is unreachable
   until a live auction exists.
2. `setNav` before every session, plus a keep-alive or a raised `maxStaleness` [F-2] — cheapest
   high-value fix in the list; it is one transaction.
3. Indexer: `attempted_by`, an Express error handler, a process-level rejection guard [F-3].
4. Indexer: a real backfill with chunked `getLogs` [F-4].
5. Hosting: CORS, `VITE_INDEXER_API` at build time, ship `deployments/hedera-testnet.json` [F-5].
6. Contract verification and the committed deployments file [F-9].
7. README citation repair — `SettlementRouter.sol:192`/`:284` and
   `CapTableValidationHook.sol:156` [F-7, F-8].
8. Coupon: cut or wire, but do not leave it faking success [F-6].
9. Browser auction-creation path [F-1 durability, closes 3 of the 13 gaps in 1.11].
10. Workspace coherence and CI [F-11].
