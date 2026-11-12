"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, Copy, Droplets, Plus, RefreshCw, Send, TrendingUp } from "lucide-react";
import type { DashboardData } from "@stellardrop/shared";
import { TESTNET } from "@stellardrop/shared";
import { api, displayAmount, shortAddress } from "@/lib/api";
import { useWallet } from "@/components/wallet-provider";
import { ErrorNotice, Spinner, StatusBadge } from "@/components/ui";

export default function Dashboard() {
  const wallet = useWallet();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!wallet.token) return;
    setLoading(true);
    try { setData(await api<DashboardData>("/api/dashboard", { token: wallet.token })); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load your drops."); }
    finally { setLoading(false); }
  }, [wallet.token]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load, wallet.activating]);
  async function setup(type: "fund" | "trustline") {
    setAction(type); setError(null);
    try {
      if (wallet.authMethod === "email") await wallet.activate();
      else if (type === "fund") await api("/api/wallet/fund", { token: wallet.token, body: {} });
      else {
        const prepared = await api<{ transaction: string }>("/api/wallet/trustline/prepare", { token: wallet.token, body: {} });
        const xdr = await wallet.sign(prepared.transaction);
        const response = await fetch(`${TESTNET.horizon}/transactions`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ tx: xdr }) });
        if (!response.ok) throw new Error("The trustline transaction failed. Check your XLM reserve and retry.");
      }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet setup failed."); }
    finally { setAction(null); }
  }
  async function copy(code: string) {
    try { await navigator.clipboard.writeText(`${window.location.origin}/drop/${code}`); setCopied(code); setTimeout(() => setCopied(null), 2000); }
    catch { setError("Could not copy the link. Open the drop to share it."); }
  }
  const drops = data?.drops.filter(drop => filter === "ALL" || drop.status === filter) ?? [];
  return <><div className="page-intro"><div><div className="eyebrow">A LITTLE GENEROSITY GOES A LONG WAY</div><h1>Your drops, at a glance<span>.</span></h1><p>Send a little possibility. Follow it from here.</p></div><Link className="button button-dark" href="/dashboard/create"><Plus size={17} />Create a drop</Link></div>{error && <ErrorNotice>{error}</ErrorNotice>}{wallet.activating && <div className="info-notice" role="status"><Spinner label="Setting up your Testnet wallet…" /></div>}{wallet.activationError && <ErrorNotice><div className="wallet-activation-notice"><span>{wallet.activationError}</span><button className="text-button" disabled={wallet.activating} onClick={() => void wallet.activate()}>Retry wallet setup</button></div></ErrorNotice>}<div className="wallet-summary"><div className="wallet-summary-icon"><ArrowDownLeft size={21} /></div><div className="balance-amount"><span>Available Testnet balance</span><strong>{data ? displayAmount(data.wallet.balance) : "—"} <small>USDC</small></strong></div><div className="wallet-address"><span>{wallet.authMethod === "email" ? "YOUR STELLARDROP WALLET" : "CONNECTED WALLET"}</span><a href={`https://stellar.expert/explorer/testnet/account/${wallet.publicKey}`} target="_blank" rel="noreferrer">{wallet.publicKey ? shortAddress(wallet.publicKey) : ""}<ArrowUpRight size={13} /></a></div><button type="button" className="balance-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh balance"><RefreshCw size={14} />{loading ? "Updating…" : "Refresh"}</button></div><div className="stats-grid"><div className="stat-card"><div><span>Total USDC sent</span><Send size={19} /></div><strong>{data ? displayAmount(data.stats.totalSent) : "—"}<small>USDC</small></strong><p>Good things, on their way.</p></div><div className="stat-card"><div><span>Active drops</span><Droplets size={19} /></div><strong>{data?.stats.activeDrops ?? "—"}<small>drops</small></strong><p>Ready for someone to claim.</p></div><div className="stat-card stat-accent"><div><span>Claim rate</span><TrendingUp size={19} /></div><strong>{data?.stats.claimRate ?? "—"}<small>%</small></strong><p>Little drops that found their people.</p></div></div>{data && (!data.wallet.funded || !data.wallet.hasTrustline || Number(data.wallet.balance) === 0) && <div className="setup-banner"><div><strong>Give your Testnet wallet a little head start.</strong><p>{!data.wallet.funded ? "Get free test XLM to activate your account." : !data.wallet.hasTrustline ? "Add a trustline so your wallet can hold Testnet USDC." : "Get test USDC from Circle’s faucet. Select Stellar Testnet and use your connected address."}</p></div>{!data.wallet.funded ? <button className="button button-outline button-small" onClick={() => void setup("fund")} disabled={!!action || wallet.activating}>{wallet.activating || action ? "Activating…" : wallet.authMethod === "email" ? "Activate wallet" : "Get test XLM"}<ArrowUpRight size={14} /></button> : !data.wallet.hasTrustline ? <button className="button button-outline button-small" onClick={() => void setup("trustline")} disabled={!!action || wallet.activating}>{wallet.activating || action ? "Setting up…" : wallet.authMethod === "email" ? "Finish wallet setup" : "Add USDC trustline"}<Plus size={14} /></button> : <a className="button button-outline button-small" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Get test USDC<ArrowUpRight size={14} /></a>}</div>}<section className="drops-section"><div className="table-heading"><div><h2>Your drops</h2><span>{data?.stats.totalDrops ?? 0} small acts of possibility</span></div><button className="icon-button refresh-button" disabled={loading} onClick={() => void load()} aria-label="Refresh drops"><RefreshCw size={17} className={loading ? "rotating" : ""} /></button></div><div className="filter-tabs" role="group" aria-label="Filter drops">{[["ALL", "All drops"], ["CREATED", "Active"], ["CLAIMED", "Claimed"], ["WITHDRAWN", "Withdrawn"]].map(([value, label]) => <button aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value!)} key={value}>{label}</button>)}</div>{!data && loading ? <div className="table-empty"><Spinner label="Finding your drops…" /></div> : drops.length ? <div className="table-scroll"><table><thead><tr><th>DROP CODE</th><th>AMOUNT</th><th>STATUS</th><th>CREATED</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{drops.map(drop => <tr key={drop.id}><td><Link className="code-link" href={`/drop/${drop.claimCode}`}><span className="table-drop-icon"><Droplets size={16} /></span>{drop.claimCode}</Link></td><td className="amount-cell">{displayAmount(drop.amount)} <small>USDC</small></td><td><StatusBadge status={drop.status} /></td><td className="date-cell">{new Date(drop.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td><td><div className="row-actions"><button className="icon-button" aria-label={`Copy link for ${drop.claimCode}`} onClick={() => void copy(drop.claimCode)}>{copied === drop.claimCode ? <Check size={16} /> : <Copy size={16} />}</button><Link className="icon-button" href={`/drop/${drop.claimCode}`} aria-label={`Open drop ${drop.claimCode}`}><ArrowUpRight size={17} /></Link></div></td></tr>)}</tbody></table></div> : <div className="table-empty"><span className="empty-icon"><Droplets size={30} strokeWidth={1.4} /></span><h3>{filter === "ALL" ? "Every good thing starts with a drop." : "No drops here just yet."}</h3><p>{filter === "ALL" ? "Create your first one. Someone’s day could use it." : "Your drops will appear here as they find their people."}</p><Link href="/dashboard/create" className="text-button">Create a drop <ArrowRight size={16} /></Link></div>}<div className="table-footnote"><span className="live-dot" />Live on Stellar Testnet<span>Updates every 30 seconds · Showing latest 500 drops</span></div></section></>;
}
