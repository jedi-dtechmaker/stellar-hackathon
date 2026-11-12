import type { Metadata } from "next";
import { WalletProvider } from "@/components/wallet-provider";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "StellarDrop — Send a little possibility", template: "%s · StellarDrop" },
  description: "Send Testnet USDC with a simple link. Claim in Telegram and explore a simulated bank withdrawal, powered by Stellar.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><WalletProvider>{children}</WalletProvider></body></html>;
}
