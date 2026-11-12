"use client";
import Link from "next/link";
import { ArrowUpRight, LogOut, Wallet } from "lucide-react";
import { useWallet } from "./wallet-provider";
import { Logo, NetworkBadge } from "./ui";
import { shortAddress } from "@/lib/api";

export function Header({ app = false }: { app?: boolean }) {
  const wallet = useWallet();
  return <header className={`site-header ${app ? "app-header" : ""}`}><Logo />{!app && <nav aria-label="Main navigation"><a href="/#how-it-works">How it works</a><a href="/#why-stellardrop">Why StellarDrop</a><a href="https://developers.stellar.org" target="_blank" rel="noreferrer">Built on Stellar <ArrowUpRight size={13} /></a></nav>}<div className="header-actions"><NetworkBadge />{wallet.publicKey ? <><Link className="wallet-chip" href="/dashboard" title={wallet.email ?? wallet.publicKey}><Wallet size={15} />{shortAddress(wallet.publicKey)}</Link><button className="icon-button" onClick={wallet.disconnect} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></> : <Link className={app ? "button button-dark button-small" : "header-connect"} href="/login">Get started<ArrowUpRight size={16} /></Link>}</div></header>;
}
