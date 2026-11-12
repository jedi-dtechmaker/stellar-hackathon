"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, Mail, ShieldCheck, Wallet } from "lucide-react";
import type { EmailCodeRequest } from "@stellardrop/shared";
import { useWallet } from "./wallet-provider";
import { ErrorNotice, Spinner } from "./ui";

export function SignInForm({ next = "/dashboard" }: { next?: string }) {
  const wallet = useWallet();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<EmailCodeRequest | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const destination = next.startsWith("/dashboard") && !next.startsWith("//") ? next : "/dashboard";
  useEffect(() => { if (wallet.token) router.replace(destination); }, [wallet.token, destination, router]);
  useEffect(() => { if (!challenge) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [challenge]);
  const seconds = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.resendAt) - now) / 1000)) : 0;
  async function send(event?: FormEvent) {
    event?.preventDefault(); setSending(true); setError(null); wallet.clearError();
    try { setChallenge(await wallet.requestEmail(challenge?.email ?? email)); setCode(""); setNow(Date.now()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn't send your code. Try again."); }
    finally { setSending(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); if (!challenge) return; setError(null);
    try { await wallet.verifyEmail(challenge.challengeId, code); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn't verify that code."); }
  }
  return <div className="email-auth-card">
    <span className="connect-icon">{challenge ? <Mail size={31} /> : <Wallet size={31} />}</span>
    <div className="eyebrow">YOUR NEXT GOOD THING STARTS HERE</div>
    <h1>{challenge ? "Check your inbox." : "Your email. Your wallet."}</h1>
    <p>{challenge ? <>We sent a six-digit code to <strong>{challenge.email}</strong>.<br />Enter it below to continue.</> : <>Verify your email and we’ll create your Stellar wallet.<br />No extension, password, or seed phrase to set up.</>}</p>
    {challenge ? <form className="email-auth-form" onSubmit={verify}>
      <label htmlFor="verification-code">Verification code</label>
      <input id="verification-code" className="verification-code-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" autoFocus required aria-describedby="code-expiry" />
      <span className="auth-field-help" id="code-expiry">Your code expires in 10 minutes and works once.</span>
      {(error || wallet.error) && <ErrorNotice>{error || wallet.error}</ErrorNotice>}
      <button type="submit" className="button button-dark" disabled={wallet.connecting || sending || code.length !== 6}>{wallet.connecting ? <Spinner label="Verifying your email…" /> : <>Verify and continue <Check size={17} /></>}</button>
      <button type="button" className="auth-resend" disabled={sending || seconds > 0 || wallet.connecting} onClick={() => void send()}>{sending ? "Sending…" : seconds ? `Send a new code in ${seconds}s` : "Send a new code"}</button>
      <button type="button" className="auth-change-email" disabled={sending || wallet.connecting} onClick={() => { setChallenge(null); setCode(""); setError(null); wallet.clearError(); }}><ArrowLeft size={13} />Use a different email</button>
    </form> : <form className="email-auth-form" onSubmit={send}>
      <label htmlFor="email-address">Email address</label>
      <input id="email-address" name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" maxLength={254} required disabled={sending || wallet.connecting} />
      {(error || wallet.error) && <ErrorNotice>{error || wallet.error}</ErrorNotice>}
      <button type="submit" className="button button-dark" disabled={sending || wallet.connecting}>{sending ? <Spinner label="Sending your code…" /> : <>Continue with email <ArrowUpRight size={17} /></>}</button>
      <div className="auth-custody-note"><ShieldCheck size={16} /><span>StellarDrop securely manages your Testnet wallet. Sign in with the same email to access it again.</span></div>
      <div className="auth-divider"><span />Already have a wallet?<span /></div>
      <button type="button" className="button button-outline" onClick={() => void wallet.connect()} disabled={sending || wallet.connecting}>{wallet.connecting ? <Spinner label="Waiting for Freighter…" /> : <><Wallet size={16} />Use Freighter</>}</button>
    </form>}
  </div>;
}
