import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useWalletClient } from "wagmi";
import { publicClient } from "./chain";
import { apiGet, apiPost } from "./api";
import {
  AUCTION_VIEW_ABI,
  BOND_VIEW_ABI,
  COMPLIANCE_ABI,
  CONTROL_LIST_ABI,
  COUPON_ABI,
  HOOK_ABI,
  KYC_ABI,
  ORACLE_ABI,
  ROUTER_ABI,
  computeHoldSecret,
  type CouponParams,
} from "./contracts";
import { decodeContractError, type AppError } from "./errors";
import type { BidStateCode } from "./bidState";
import {
  asBps,
  asRawBond,
  toQ96,
  fromQ96,
  type Bps,
  type Q96,
  type RawBond,
} from "./units";

/**
 * Real chain surface. Replaces mock-chain.tsx: reads from the indexer and the
 * deployed contracts, and exposes write actions that sign through wagmi/viem.
 */

export type Role = "ADMIN" | "ISSUER" | "SELLER" | "INVESTOR" | "OBSERVER";

export interface Investor {
  address: string;
  kyc: boolean;
  blocked: boolean;
  balance: RawBond;
  bps: Bps;
  since: number;
}

export interface Bid {
  id: number;
  beneficiary: string;
  maxPriceQ96: bigint;
  priceCents: bigint;
  amount: RawBond;
  filled: RawBond;
  state: BidStateCode;
  holdHash: string | undefined;
  holdExpiresAt: number | undefined;
}

export interface Refusal {
  id: number;
  beneficiary: string;
  priceCents: bigint;
  amount: RawBond;
  error: AppError;
  block: number;
  tx: string;
}

export type Phase = "PENDING" | "OPEN" | "ENDED" | "CLAIMABLE" | "SETTLED" | "NOT_GRADUATED";

interface Deployment {
  bond: string;
  compliance: string;
  auction: string;
  router: string;
  hook: string;
  oracle: string;
  verified: boolean;
  commit: string;
  rpc: string;
  headBlock: number;
  indexerLagBlocks: number;
}

interface AuctionResponse {
  address: string;
  bond: string;
  phase: Phase;
  currentBlock: string;
  startBlock: string;
  endBlock: string;
  claimBlock: string;
  secondsRemaining: number;
  endsInBlocks: number;
  clearingPriceQ96: string;
  floorPriceQ96: string;
  tickSpacing: string;
  navCents: string | null;
  navUpdatedAt: string | null;
  supplyReleased: string;
  totalSupply: string;
  currencyRaised: string;
  requiredCurrencyRaised: string;
  settlementReserve: string;
  graduated: boolean;
}

interface RegisterResponse {
  holderCount: number;
  maxInvestors: number;
  slotsRemaining: number;
  largestHolderBps: number;
  maxOwnershipBps: number;
  pendingBeneficiaries: unknown[];
  atBlock: string;
}

interface InvestorsResponse {
  investors: { address: string; kyc: boolean; blocked: boolean; balance: string; bps: number; since: number }[];
}

interface BidsResponse {
  bids: { id: number; beneficiary: string; maxPriceQ96: string; amount: string; filled: string; state: number; holdHash?: string }[];
}

interface RejectionsResponse {
  rejections: { beneficiary: string; maxPriceDisplay: string; amount: string; errorName: string; errorSelector: string; decodedArgs: Record<string, unknown>; humanReason: string; blockNumber: string; txHash?: string }[];
}

export interface PreflightResult {
  ok: boolean;
  error?: AppError;
  projected: {
    holders: number;
    holdersAfter: number;
    maxInvestors: number;
    beneficiaryBpsAfter: number;
    maxOwnershipBps: number;
    newHolder: boolean;
  };
}

interface ChainApi {
  state: State;
  roles: { isAdmin: boolean; isIssuer: boolean; isSeller: boolean; isConnected: boolean; roles: Role[] };
  addresses: { admin: string; seller: string };
  connect: () => void;
  disconnect: () => void;
  preflight: (beneficiary: string, priceCents: bigint, amount: RawBond) => Promise<PreflightResult>;
  clearingQ96: Q96;
  actions: {
    placeBid: (maxPriceQ96: bigint, amountRaw: bigint) => Promise<string>;
    exitBid: (bidId: number) => Promise<string>;
    settle: (bidId: number) => Promise<string>;
    executeHold: (bidId: number, beneficiary: string, tokensFilled: bigint) => Promise<string>;
    fundReserve: (amountTinybar: bigint) => Promise<string>;
    grantKyc: (address: string) => Promise<string>;
    revokeKyc: (address: string) => Promise<string>;
    setBlocked: (address: string, blocked: boolean) => Promise<string>;
    setRules: (maxInvestors: number, maxOwnershipBps: number) => Promise<string>;
    setNav: (cents: bigint) => Promise<string>;
    setCoupon: (coupon: CouponParams) => Promise<string>;
    requestKyc: (address: string) => Promise<void>;
    recordRefusal: (args: {
      beneficiary: string;
      priceCents: bigint;
      amountRaw: bigint;
      error: AppError;
      block: number;
      tx?: string | null;
    }) => Promise<void>;
  };
}

interface State {
  deployed: boolean;
  deployment: Deployment;
  phase: Phase;
  endsInBlocks: number;
  clearingCents: bigint;
  raisedTinybar: bigint;
  requiredTinybar: bigint;
  reserveTinybar: bigint;
  navCents: bigint;
  navUpdatedSecondsAgo: number;
  maxStalenessSeconds: number;
  maxInvestors: number;
  maxOwnershipBps: Bps;
  tickCents: bigint;
  investors: Investor[];
  bids: Bid[];
  refusals: Refusal[];
  connected: string | null;
  actingAs: string;
  complianceAttached: boolean;
  ssiManagerGranted: boolean;
  issuerListed: boolean;
  kycProbeVerified: boolean;
  auctionCreated: boolean;
  couponScheduled: boolean;
  couponDistributed: boolean;
  lastBlock: number;
}

const Ctx = createContext<ChainApi | null>(null);

const emptyDeployment: Deployment = {
  bond: "",
  compliance: "",
  auction: "",
  router: "",
  hook: "",
  oracle: "",
  verified: false,
  commit: "",
  rpc: (import.meta.env["VITE_HEDERA_RPC"] as string | undefined) ?? "https://testnet.hashio.io/api",
  headBlock: 0,
  indexerLagBlocks: 0,
};

export function ChainProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { data: wallet } = useWalletClient();

  const deploymentQ = useQuery({
    queryKey: ["deployment"],
    queryFn: () => apiGet<Deployment>("/api/deployment"),
    refetchInterval: 30_000,
  });
  const healthQ = useQuery({
    queryKey: ["health"],
    queryFn: () => apiGet<{ headBlock: string; chainHead: string; lagBlocks: number }>("/api/health"),
    refetchInterval: 4000,
  });
  const deployment: Deployment = useMemo(
    () => ({
      ...(deploymentQ.data ?? emptyDeployment),
      headBlock: Number(healthQ.data?.headBlock ?? 0),
      indexerLagBlocks: healthQ.data?.lagBlocks ?? 0,
    }),
    [deploymentQ.data, healthQ.data],
  );

  const auctionQ = useQuery({
    queryKey: ["auction", deployment.auction],
    enabled: Boolean(deployment.auction),
    queryFn: () => apiGet<AuctionResponse>(`/api/auction/${deployment.auction}`),
    refetchInterval: 2000,
  });
  const auction = auctionQ.data;

  const registerQ = useQuery({
    queryKey: ["register", deployment.bond],
    enabled: Boolean(deployment.bond),
    queryFn: () => apiGet<RegisterResponse>(`/api/bond/${deployment.bond}/register`),
    refetchInterval: 4000,
  });

  const investorsQ = useQuery({
    queryKey: ["investors", deployment.bond],
    enabled: Boolean(deployment.bond),
    queryFn: () => apiGet<InvestorsResponse>(`/api/bond/${deployment.bond}/investors`),
    refetchInterval: 4000,
  });

  const bidsQ = useQuery({
    queryKey: ["bids", deployment.auction],
    enabled: Boolean(deployment.auction),
    queryFn: () => apiGet<BidsResponse>(`/api/auction/${deployment.auction}/bids`),
    refetchInterval: 2000,
  });

  const rejectionsQ = useQuery({
    queryKey: ["rejections", deployment.auction],
    enabled: Boolean(deployment.auction),
    queryFn: () => apiGet<RejectionsResponse>(`/api/auction/${deployment.auction}/rejections?limit=100`),
    refetchInterval: 4000,
  });

  const sellerQ = useQuery({
    queryKey: ["seller", deployment.auction],
    enabled: Boolean(deployment.auction),
    queryFn: () =>
      publicClient.readContract({
        address: deployment.auction as `0x${string}`,
        abi: AUCTION_VIEW_ABI,
        functionName: "tokensRecipient",
      }),
    refetchInterval: 60_000,
  });
  const seller = sellerQ.data as `0x${string}` | undefined;

  const couponCountQ = useQuery({
    queryKey: ["couponCount", deployment.bond],
    enabled: Boolean(deployment.bond),
    queryFn: () =>
      publicClient.readContract({
        address: deployment.bond as `0x${string}`,
        abi: COUPON_ABI,
        functionName: "getCouponCount",
      }),
    refetchInterval: 10_000,
  });

  const investors: Investor[] = useMemo(() => {
    const list = investorsQ.data?.investors ?? [];
    return list.map((i) => ({
      address: i.address,
      kyc: i.kyc,
      blocked: i.blocked,
      balance: asRawBond(BigInt(i.balance)),
      bps: asBps(i.bps),
      since: i.since,
    }));
  }, [investorsQ.data]);

  const bids: Bid[] = useMemo(() => {
    const list = bidsQ.data?.bids ?? [];
    return list.map((b) => {
      const maxPriceQ96 = BigInt(b.maxPriceQ96);
      return {
        id: b.id,
        beneficiary: b.beneficiary,
        maxPriceQ96,
        priceCents: fromQ96(maxPriceQ96 as Q96).cents,
        amount: asRawBond(BigInt(b.amount)),
        filled: asRawBond(BigInt(b.filled)),
        state: b.state as BidStateCode,
        holdHash: b.holdHash,
        holdExpiresAt: undefined,
      };
    });
  }, [bidsQ.data]);

  const refusals: Refusal[] = useMemo(() => {
    const list = rejectionsQ.data?.rejections ?? [];
    return list.map((r, i) => ({
      id: i + 1,
      beneficiary: r.beneficiary,
      priceCents: parsePriceDisplay(r.maxPriceDisplay),
      amount: asRawBond(BigInt(r.amount ?? "0")),
      error: {
        name: r.errorName,
        selector: r.errorSelector,
        args: r.decodedArgs as Record<string, string | number>,
        sentence: r.humanReason,
        severity: "register" as const,
      },
      block: Number(r.blockNumber ?? 0),
      tx: r.txHash ?? "",
    }));
  }, [rejectionsQ.data]);

  const roles = useMemo(() => {
    const addr = address?.toLowerCase();
    const isSeller = Boolean(addr && seller && addr === seller.toLowerCase());
    // In this single-account demo the seller is also the issuer/admin.
    const isIssuer = isSeller;
    const isAdmin = isSeller;
    const list: Role[] = [];
    if (isAdmin) list.push("ADMIN");
    if (isIssuer) list.push("ISSUER");
    if (isSeller) list.push("SELLER");
    if (isConnected) list.push("INVESTOR");
    if (!isConnected) list.push("OBSERVER");
    return { isAdmin, isIssuer, isSeller, isConnected, roles: list };
  }, [address, isConnected, seller]);

  const state = useMemo<State>(() => {
    const clearingCents = auction ? fromQ96(BigInt(auction.clearingPriceQ96) as Q96).cents : 0n;
    return {
      deployed: Boolean(deployment.auction),
      deployment,
      phase: auction?.phase ?? "PENDING",
      endsInBlocks: auction?.endsInBlocks ?? 0,
      clearingCents,
      raisedTinybar: BigInt(auction?.currencyRaised ?? "0"),
      requiredTinybar: BigInt(auction?.requiredCurrencyRaised ?? "0"),
      reserveTinybar: BigInt(auction?.settlementReserve ?? "0"),
      navCents: auction?.navCents != null ? BigInt(auction.navCents) : 0n,
      navUpdatedSecondsAgo: 0,
      maxStalenessSeconds: 3600,
      maxInvestors: registerQ.data?.maxInvestors ?? 0,
      maxOwnershipBps: asBps(registerQ.data?.maxOwnershipBps ?? 0),
      tickCents: auction ? fromQ96(BigInt(auction.tickSpacing) as Q96).cents : 25n,
      investors,
      bids,
      refusals,
      connected: address ?? null,
      actingAs: address ?? investors[0]?.address ?? "",
      complianceAttached: Boolean(deployment.compliance),
      ssiManagerGranted: Boolean(deployment.bond),
      issuerListed: Boolean(deployment.bond),
      kycProbeVerified: Boolean(deployment.bond),
      auctionCreated: Boolean(deployment.auction),
      couponScheduled: (couponCountQ.data ?? 0n) > 0n,
      couponDistributed: false,
      lastBlock: auction ? Number(auction.currentBlock) : 0,
    };
  }, [auction, registerQ.data, deployment, investors, bids, refusals, address, couponCountQ.data]);

  async function preflight(beneficiary: string, priceCents: bigint, amount: RawBond): Promise<PreflightResult> {
    const priceQ96 = toQ96(priceCents);
    const [ok, reason] = await publicClient.readContract({
      address: deployment.hook as `0x${string}`,
      abi: HOOK_ABI,
      functionName: "previewValidate",
      args: [priceQ96, amount as bigint, beneficiary as `0x${string}`],
    });

    const register = registerQ.data;
    const holders = register?.holderCount ?? 0;
    const maxInvestors = register?.maxInvestors ?? 0;
    const maxOwnershipBps = register?.maxOwnershipBps ?? 0;

    // Mirror the hook's projection so the UI cannot contradict the chain. The
    // beneficiary total is available + held + locked (F-13), matching AtsBalance.
    const bond = deployment.bond as `0x${string}`;
    const router = deployment.router as `0x${string}`;
    const [available, held, locked, totalSupply, pendingAmount, isPending, pendingNew] =
      await Promise.all([
        publicClient.readContract({ address: bond, abi: BOND_VIEW_ABI, functionName: "balanceOf", args: [beneficiary as `0x${string}`] }).catch(() => 0n),
        publicClient.readContract({ address: bond, abi: BOND_VIEW_ABI, functionName: "getHeldAmountFor", args: [beneficiary as `0x${string}`] }).catch(() => 0n),
        publicClient.readContract({ address: bond, abi: BOND_VIEW_ABI, functionName: "getLockedAmountFor", args: [beneficiary as `0x${string}`] }).catch(() => 0n),
        publicClient.readContract({ address: bond, abi: BOND_VIEW_ABI, functionName: "totalSupply" }).catch(() => 0n),
        publicClient.readContract({ address: router, abi: ROUTER_ABI, functionName: "pendingAmountFor", args: [beneficiary as `0x${string}`] }).catch(() => 0n),
        publicClient.readContract({ address: router, abi: ROUTER_ABI, functionName: "isPendingBeneficiary", args: [beneficiary as `0x${string}`] }).catch(() => false),
        publicClient.readContract({ address: router, abi: ROUTER_ABI, functionName: "pendingNewBeneficiaryCount" }).catch(() => 0n),
      ]);

    const totalBalance = available + held + locked;
    const newHolder = totalBalance === 0n && !isPending;
    const holdersAfter = holders + (newHolder ? 1 : 0) + Number(pendingNew);
    const projectedBalance = totalBalance + pendingAmount + amount;
    const beneficiaryBpsAfter = totalSupply > 0n ? Number((projectedBalance * 10_000n) / totalSupply) : 0;

    const projected = {
      holders,
      holdersAfter,
      maxInvestors,
      beneficiaryBpsAfter,
      maxOwnershipBps,
      newHolder,
    };

    if (ok) return { ok: true, projected };
    return { ok: false, error: decodeContractError(reason, {}), projected };
  }

  const actions = useMemo<ChainApi["actions"]>(() => {
    const ensureWallet = () => {
      if (!wallet) throw new Error("Wallet not connected");
      return wallet;
    };
    const write = async (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
    }): Promise<string> => {
      const w = ensureWallet();
      const hash = await w.writeContract(args as never);
      return hash;
    };

    return {
      async placeBid(maxPriceQ96, amountRaw) {
        return write({
          address: deployment.router as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: "placeBid",
          args: [maxPriceQ96, amountRaw, 0n],
          value: amountRaw,
        });
      },
      async exitBid(bidId) {
        return write({
          address: deployment.router as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: "exitBid",
          args: [BigInt(bidId)],
        });
      },
      async settle(bidId) {
        return write({
          address: deployment.router as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: "settle",
          args: [BigInt(bidId)],
        });
      },
      async executeHold(bidId, beneficiary, tokensFilled) {
        const secret = computeHoldSecret(beneficiary as `0x${string}`, tokensFilled, 296);
        return write({
          address: deployment.router as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: "executeHold",
          args: [BigInt(bidId), secret],
        });
      },
      async fundReserve(amountTinybar) {
        return write({
          address: deployment.router as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: "fundReserve",
          value: amountTinybar,
        });
      },
      async grantKyc(account) {
        return write({
          address: deployment.bond as `0x${string}`,
          abi: KYC_ABI,
          functionName: "grantKyc",
          args: [account as `0x${string}`, "demo", BigInt(Math.floor(Date.now() / 1000)), BigInt(Math.floor(Date.now() / 1000) + 31536000), address as `0x${string}`],
        });
      },
      async revokeKyc(account) {
        return write({
          address: deployment.bond as `0x${string}`,
          abi: KYC_ABI,
          functionName: "revokeKyc",
          args: [account as `0x${string}`],
        });
      },
      async setBlocked(account, blocked) {
        return write({
          address: deployment.bond as `0x${string}`,
          abi: CONTROL_LIST_ABI,
          functionName: blocked ? "addToControlList" : "removeFromControlList",
          args: [account as `0x${string}`],
        });
      },
      async setRules(maxInvestors, maxOwnershipBps) {
        return write({
          address: deployment.compliance as `0x${string}`,
          abi: COMPLIANCE_ABI,
          functionName: "setRules",
          args: [maxInvestors, maxOwnershipBps, true],
        });
      },
      async setNav(cents) {
        return write({
          address: deployment.oracle as `0x${string}`,
          abi: ORACLE_ABI,
          functionName: "setNav",
          args: [cents],
        });
      },
      async setCoupon(coupon) {
        return write({
          address: deployment.bond as `0x${string}`,
          abi: COUPON_ABI,
          functionName: "setCoupon",
          args: [coupon],
        });
      },
      async requestKyc(account) {
        await apiPost("/api/faucet/kyc", { address: account });
      },
      async recordRefusal(args) {
        await apiPost(`/api/auction/${deployment.auction}/rejections`, {
          attempted_by: address ?? args.beneficiary,
          beneficiary: args.beneficiary,
          error_name: args.error.name,
          error_selector: args.error.selector,
          decoded_args: args.error.args,
          block_number: args.block,
          tx_hash: args.tx ?? null,
          max_price_q96: toQ96(args.priceCents).toString(),
          amount: args.amountRaw.toString(),
        });
      },
    };
  }, [wallet, address, deployment]);

  const value = useMemo<ChainApi>(
    () => ({
      state,
      roles,
      addresses: { admin: deployment.bond, seller: deployment.bond },
      connect: () => undefined,
      disconnect: () => undefined,
      preflight,
      clearingQ96: toQ96(state.clearingCents),
      actions,
    }),
    [state, roles, deployment, preflight, actions],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChain(): ChainApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChain must be used inside ChainProvider");
  return ctx;
}

export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

function parsePriceDisplay(display: string): bigint {
  const m = /^\$?(\d+(?:\.\d{1,2})?)/.exec(display);
  if (!m) return 0n;
  const parts = (m[1] ?? "0").split(".");
  const whole = parts[0] ?? "0";
  const frac = (parts[1] ?? "00").padEnd(2, "0").slice(0, 2);
  return BigInt(whole) * 100n + BigInt(frac);
}
