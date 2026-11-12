"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ShieldCheck, Wallet } from "lucide-react";
import { useWallet } from "./wallet-provider";
import { ErrorNotice, Spinner } from "./ui";

export function SignInForm({ next = "/dashboard" }: { next?: string }) {
  const wallet = useWallet();
  const router = useRouter();
  const destination = next.startsWith("/dashboard") && !next.startsWith("//") ? next : "/dashboard";
  useEffect(() => { if (wallet.token) router.replace(destination); }, [wallet.token, destination, router]);
  if (!wallet.ready || wallet.token) return <div className="center-state"><Spinner label={wallet.token ? "Opening your dashboard…" : "Checking your session…"} /></div>;

  return <div className="email-auth-card wallet-auth-card">
    <span className="connect-icon"><Wallet size={31} /></span>
    <div className="eyebrow">YOUR WALLET. STELLAR TESTNET.</div>
    <h1>Connect your wallet.</h1>
    <p>Sign in with the Freighter extension to view your balance and send Testnet USDC.</p>
    <ol className="wallet-connect-steps">
      <li>Open Freighter and select <strong>Testnet</strong>.</li>
      <li>Connect your wallet and approve the sign-in request.</li>
    </ol>
    {wallet.error && <ErrorNotice>{wallet.error}</ErrorNotice>}
    <button type="button" className="button button-dark" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
      {wallet.connecting ? <Spinner label="Waiting for Freighter…" /> : <><Wallet size={17} />Connect Freighter</>}
    </button>
    <div className="auth-custody-note"><ShieldCheck size={16} /><span>The sign-in signature proves wallet ownership. Your secret key stays in Freighter.</span></div>
    <a className="text-button wallet-install-link" href="https://www.freighter.app/" target="_blank" rel="noreferrer">Get the Freighter extension <ArrowUpRight size={14} /></a>
  </div>;
}
