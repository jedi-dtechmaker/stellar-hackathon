"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, LogOut, Wallet } from "lucide-react";
import { useWallet } from "./wallet-provider";
import { Logo, NetworkBadge } from "./ui";
import { shortAddress } from "@/lib/api";

export function Header({ app = false }: { app?: boolean }) {
  const wallet = useWallet();
  const router = useRouter();
  function logout() {
    wallet.disconnect();
    router.replace("/login");
  }
  return <header className={`site-header ${app ? "app-header" : ""}`}>
    <Logo />
    {!app && <nav aria-label="Main navigation"><a href="/#how-it-works">How it works</a><a href="/#why-stellardrop">Why StellarDrop</a><a href="https://developers.stellar.org" target="_blank" rel="noreferrer">Built on Stellar <ArrowUpRight size={13} /></a></nav>}
    <div className="header-actions">
      <NetworkBadge />
      {wallet.publicKey ? <>
        <Link className="wallet-chip" href="/dashboard" title={wallet.email ?? wallet.publicKey}><Wallet size={15} />{shortAddress(wallet.publicKey)}</Link>
        <button type="button" className="button button-outline button-small logout-button" onClick={logout}><LogOut size={16} />Log out</button>
      </> : wallet.ready ? <Link className={app ? "button button-dark button-small" : "header-connect"} href="/login">Connect wallet<ArrowUpRight size={16} /></Link> : null}
    </div>
  </header>;
}
