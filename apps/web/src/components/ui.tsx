import Link from "next/link";
import { ArrowUpRight, Droplets } from "lucide-react";
import type { ReactNode } from "react";

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={`logo ${inverse ? "inverse" : ""}`} aria-label="StellarDrop home"><span className="logo-icon"><Droplets size={23} strokeWidth={2.2} /></span>stellar<span className="logo-light">drop</span><span className="logo-period">.</span></Link>;
}
export function NetworkBadge() { return <span className="network-badge"><span />Stellar Testnet</span>; }
export function StatusBadge({ status }: { status: string }) { return <span className={`status-badge status-${status.toLowerCase()}`}><i />{({ CREATED: "Ready to claim", CLAIMED: "Claimed", WITHDRAWN: "Withdrawn", EXPIRED: "Expired" } as Record<string, string>)[status] ?? status}</span>; }
export function ErrorNotice({ children }: { children: ReactNode }) { return <div className="error-notice" role="alert">{children}</div>; }
export function Spinner({ label = "Loading" }: { label?: string }) { return <span className="loading-inline" role="status"><span className="spinner" />{label}</span>; }
export function Footer() {
  return <footer className="site-footer"><Logo /><span>A little drop. A world of possibility.</span><a href="https://stellar.org" target="_blank" rel="noreferrer">Built on Stellar <ArrowUpRight size={14} /></a><small>Testnet only · No real funds</small></footer>;
}
