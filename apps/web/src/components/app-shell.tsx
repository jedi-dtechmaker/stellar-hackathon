"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowUpRight, LayoutDashboard, Plus, ShieldCheck } from "lucide-react";
import { Header } from "./header";
import { Footer, Spinner } from "./ui";
import { useWallet } from "./wallet-provider";
import { SignInForm } from "./sign-in-form";

export function AppShell({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const pathname = usePathname();
  return <><Header app /><div className="app-shell"><aside className="sidebar"><div className="sidebar-label">YOUR WORKSPACE</div><Link href="/dashboard" className={pathname === "/dashboard" ? "active" : ""}><LayoutDashboard size={18} />Overview</Link><Link href="/dashboard/create" className={pathname === "/dashboard/create" ? "active" : ""}><Plus size={18} />Create a drop</Link><div className="sidebar-note"><ShieldCheck size={22} /><strong>A safe space to try.</strong><p>Every drop uses Testnet USDC. Explore freely. No real money moves.</p><a href="https://testanchor.stellar.org/.well-known/stellar.toml" target="_blank" rel="noreferrer">Meet the test anchor <ArrowUpRight size={13} /></a></div><Link href="/" className="back-home"><ArrowLeft size={16} />Back to home</Link></aside><main className="app-main">{!wallet.ready ? <div className="center-state"><Spinner label="Checking your session…" /></div> : !wallet.token ? <SignInForm next={pathname} /> : children}</main></div><Footer /></>;
}
