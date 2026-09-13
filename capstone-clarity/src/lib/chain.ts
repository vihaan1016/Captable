import { createPublicClient, http, defineChain } from "viem";

const RPC = (import.meta.env["VITE_HEDERA_RPC"] as string | undefined) ?? "https://testnet.hashio.io/api";

export const hederaTestnet = defineChain({
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC] },
  },
  blockExplorers: {
    default: { name: "HashScan", url: "https://hashscan.io/testnet" },
  },
});

export const publicClient = createPublicClient({
  chain: hederaTestnet,
  transport: http(RPC),
});
