"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Copy, MessageCircle, Send, ShieldCheck } from "lucide-react";
import type { PublicDrop } from "@stellardrop/shared";
import { api, displayAmount, type PlatformConfig } from "@/lib/api";
import { Header } from "./header";
import { ErrorNotice, Footer, Spinner, StatusBadge } from "./ui";

export function ShareDrop({ code }: { code: string }) {
  const [drop, setDrop] = useState<PublicDrop | null>(null);
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    const controller = new AbortController();
    void Promise.all([api<PublicDrop>(`/api/drops/${encodeURIComponent(code)}`, { signal: controller.signal }), api<PlatformConfig>("/api/config", { signal: controller.signal })]).then(([d, c]) => { setDrop(d); setConfig(c); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    const timer = setInterval(() => { void api<PublicDrop>(`/api/drops/${encodeURIComponent(code)}`, { signal: controller.signal }).then(setDrop).catch(() => {}); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [code]);
  const claimUrl = config?.botUsername && drop ? `https://t.me/${config.botUsername}?start=${drop.claimCode}` : null;
  const shareUrl = `${origin}/drop/${drop?.claimCode ?? code}`;
  const message = drop ? `Hey! I sent you $${drop.amount} Testnet USDC. Claim it here: ${claimUrl ?? shareUrl}` : "";
  async function copy() {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError("Copy is unavailable in this browser. Select and copy the link below."); }
  }
  return <><Header app /><main className="share-main"><Link className="breadcrumb" href="/dashboard"><ArrowLeft size={15} />Back to your drops</Link>{error && <ErrorNotice>{error}</ErrorNotice>}{!drop && !error ? <div className="center-state"><Spinner label="Opening your drop…" /></div> : drop && <><div className="share-heading"><div className="eyebrow">GOOD THINGS ARE BETTER SHARED</div><h1>A little drop.<br />A lot of possibility<span>.</span></h1><p>{drop.status === "CREATED" ? "Your drop is ready. Send it to someone who matters." : "This drop has found its person. A little connection, made."}</p></div><div className="share-card"><div className="share-card-top"><StatusBadge status={drop.status} /><span>✦ STELLAR TESTNET</span></div><span className="share-spark">✳</span><div className="share-amount">${displayAmount(drop.amount)}</div><div className="share-asset">TESTNET USDC</div><p>For a friend. For family.<br />For a little brighter day.</p><div className="ticket-perforation"><span /><div /><span /></div><div className="claim-code"><span>YOUR UNIQUE DROP CODE</span><strong>{drop.claimCode}</strong><small>Created {new Date(drop.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</small></div></div>{drop.status === "CREATED" && <div className="share-actions">{claimUrl ? <a className="button button-dark" href={claimUrl} target="_blank" rel="noreferrer"><Send size={17} />Open in Telegram<ArrowUpRight size={17} /></a> : <div className="info-notice">Telegram claiming will be available when the bot is configured. Your drop is secured on Testnet.</div>}<div className="share-button-row"><a href={`https://wa.me/?text=${encodeURIComponent(message)}`} className="button button-outline" target="_blank" rel="noreferrer"><MessageCircle size={17} />WhatsApp</a><a href={`https://t.me/share/url?url=${encodeURIComponent(claimUrl ?? shareUrl)}&text=${encodeURIComponent(`Hey! I sent you $${drop.amount} Testnet USDC. Claim your drop!`)}`} className="button button-outline" target="_blank" rel="noreferrer"><Send size={17} />Telegram</a><button className="button button-outline" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Copied!" : "Copy"}</button></div><div className="share-link-box"><Link href={`/drop/${drop.claimCode}`}>{shareUrl}</Link></div><p className="claim-code-note">Anyone with this code can claim the drop. Share it privately with your recipient.</p></div>}<div className="share-security"><ShieldCheck size={16} /><span>Secured on Stellar. Testnet tokens only.</span></div><Link href="/dashboard/create" className="text-button another-drop">A little more to give? Create another drop <ArrowUpRight size={16} /></Link></>}</main><Footer /></>;
}
