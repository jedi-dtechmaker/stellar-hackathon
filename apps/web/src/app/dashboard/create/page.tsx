"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, Link2, LockKeyhole, Send, ShieldCheck } from "lucide-react";
import type { DashboardData } from "@stellardrop/shared";
import { normalizeAmount, units } from "@stellardrop/shared";
import { ApiError, api, displayAmount, shortAddress } from "@/lib/api";
import { useWallet } from "@/components/wallet-provider";
import { ErrorNotice, Spinner } from "@/components/ui";

type PendingDrop = { intentId: string; amount: string; signedTransaction?: string };
export default function CreateDrop() {
  const wallet = useWallet();
  const router = useRouter();
  const [amount, setAmount] = useState("10");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "prepare" | "sign" | "submit" | "pending">("idle");
  const [pending, setPending] = useState<PendingDrop | null>(null);
  useEffect(() => {
    if (wallet.token) void api<DashboardData>("/api/dashboard", { token: wallet.token }).then(setData).catch(cause => setError(cause.message));
    const saved = sessionStorage.getItem(`stellardrop.pending:${wallet.publicKey}`);
    if (saved) { try { setPending(JSON.parse(saved)); setStage("pending"); } catch { /* invalid local draft */ } }
  }, [wallet.token, wallet.publicKey, wallet.activating]);
  useEffect(() => {
    if (!pending || !wallet.token) return;
    let cancelled = false;
    async function check() {
      try {
        const result = await api<{ status: string; claimCode: string | null }>(`/api/intents/${pending!.intentId}`, { token: wallet.token });
        if (cancelled) return;
        if (result.claimCode) {
          sessionStorage.removeItem(`stellardrop.pending:${wallet.publicKey}`);
          router.push(`/drop/${result.claimCode}`);
        } else if (result.status === "FAILED") {
          sessionStorage.removeItem(`stellardrop.pending:${wallet.publicKey}`);
          setPending(null); setStage("idle"); setError("The transaction failed or expired. Check your wallet balance and create the drop again.");
        }
      } catch { /* The pending envelope remains available for a safe retry. */ }
    }
    void check(); const timer = setInterval(() => void check(), 6000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pending, wallet.token, wallet.publicKey, router]);
  async function submit(saved: PendingDrop) {
    setStage("submit");
    const result = await api<{ claimCode: string }>("/api/drops", { token: wallet.token, body: { ...saved, senderPublicKey: wallet.publicKey } });
    sessionStorage.removeItem(`stellardrop.pending:${wallet.publicKey}`);
    router.push(`/drop/${result.claimCode}`);
  }
  async function create() {
    setError(null);
    try {
      if (pending) { await submit(pending); return; }
      let normalized: string;
      try { normalized = normalizeAmount(amount); } catch (cause) { throw new Error((cause as Error).message); }
      if (!data?.wallet.funded || !data.wallet.hasTrustline) throw new Error("Set up your Testnet wallet from the dashboard first.");
      if (units(normalized) > units(data.wallet.balance)) throw new Error("You need a little more Testnet USDC. Visit the faucet from your dashboard.");
      setStage("prepare");
      const prepared = await api<{ intentId: string; transaction: string }>("/api/drops/prepare", { token: wallet.token, body: { amount: normalized } });
      let signedTransaction: string | undefined;
      if (wallet.authMethod === "wallet") {
        setStage("sign");
        signedTransaction = await wallet.sign(prepared.transaction);
      }
      const saved: PendingDrop = { intentId: prepared.intentId, amount: normalized, ...(signedTransaction ? { signedTransaction } : {}) };
      sessionStorage.setItem(`stellardrop.pending:${wallet.publicKey}`, JSON.stringify(saved));
      setPending(saved);
      await submit(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something interrupted your drop. Please retry.");
      const saved = sessionStorage.getItem(`stellardrop.pending:${wallet.publicKey}`);
      if (cause instanceof ApiError && cause.code === "LEDGER_FAILED") {
        sessionStorage.removeItem(`stellardrop.pending:${wallet.publicKey}`); setPending(null); setStage("idle");
      } else setStage(saved ? "pending" : "idle");
    }
  }
  const busy = ["prepare", "sign", "submit"].includes(stage);
  const validNumber = /^\d+(\.\d{1,7})?$/.test(amount) && Number(amount) > 0;
  return <><Link className="breadcrumb" href="/dashboard"><ArrowLeft size={15} />Your drops</Link><div className="page-intro"><div><div className="eyebrow">A SMALL GESTURE. A REAL CONNECTION.</div><h1>Make someone’s day<span>.</span></h1><p>Pick an amount. We’ll turn it into a little possibility.</p></div></div><div className="create-grid"><section className="create-card"><div className="card-section-label"><span className="number-dot">1</span>LET’S CREATE YOUR DROP</div><label className="amount-label" htmlFor="amount">How much would you like to send?</label><div className="amount-input-wrap"><span>$</span><input id="amount" inputMode="decimal" autoComplete="off" value={pending?.amount ?? amount} onChange={e => setAmount(e.target.value)} disabled={busy || !!pending} aria-describedby="amount-help" maxLength={20} /><span className="asset-input-label"><span>$</span>USDC</span></div><div className="amount-help" id="amount-help"><span>Available: {data ? displayAmount(data.wallet.balance) : "—"} USDC</span><span>Stellar Testnet</span></div><div className="amount-presets">{[1, 5, 10, 25, 50].map(n => <button disabled={busy || !!pending} key={n} className={amount === String(n) ? "active" : ""} onClick={() => setAmount(String(n))}>${n}</button>)}</div><div className="transaction-summary"><div><span>Recipient gets</span><strong>{validNumber ? displayAmount(pending?.amount ?? amount) : "—"} USDC</strong></div><div><span>Network fee</span><span>A small fee in test XLM</span></div><div><span>Sending from</span><span className="mono">{wallet.publicKey ? shortAddress(wallet.publicKey) : "—"}</span></div></div>{error && <ErrorNotice>{error}</ErrorNotice>}{pending && <div className="info-notice">Your drop request is saved. We’re checking Testnet for confirmation. You can safely retry this same drop.</div>}<button className="button button-dark create-submit" onClick={() => void create()} disabled={busy || wallet.activating || (!pending && !validNumber)}>{busy ? <Spinner label={{ prepare: "Preparing your drop…", sign: "Check your Freighter wallet…", submit: "Confirming on Stellar…" }[stage as "prepare" | "sign" | "submit"]} /> : <>{pending ? "Check and retry drop" : "Create drop"}<ArrowUpRight size={19} /></>}</button><div className="secure-caption"><LockKeyhole size={13} />{wallet.authMethod === "email" ? "Creating this drop approves the transfer from your StellarDrop wallet." : "You’ll approve the transaction in Freighter."}</div></section><aside className="create-aside"><div className="drop-preview-card"><div className="eyebrow">A LITTLE PREVIEW</div><span className="drop-preview-symbol">✳</span><div className="drop-preview-value">${validNumber ? displayAmount(pending?.amount ?? amount) : "0"}</div><span className="preview-usdc">TESTNET USDC</span><p>A little something.<br />For someone who matters.</p><span className="preview-bottom-label"><span className="live-dot" /> Made to be passed on</span></div><div className="next-steps"><h3>What happens next?</h3><div><span><Check size={14} /></span><p>Your USDC is secured on Stellar.</p></div><div><span><Link2 size={14} /></span><p>You get a unique code and a share link.</p></div><div><span><Send size={14} /></span><p>They claim it in Telegram. That’s all.</p></div></div><div className="privacy-note"><ShieldCheck size={18} /><p>Testnet tokens only. Your recipient’s bank details stay with the SDF Test Anchor.</p></div></aside></div></>;
}
