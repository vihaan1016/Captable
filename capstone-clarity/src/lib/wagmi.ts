import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { hederaTestnet } from "./chain";

const RPC = (import.meta.env["VITE_HEDERA_RPC"] as string | undefined) ?? "https://testnet.hashio.io/api";

export const wagmiConfig = createConfig({
  chains: [hederaTestnet],
  connectors: [injected()],
  transports: {
    [hederaTestnet.id]: http(RPC),
  },
});
