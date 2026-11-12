"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getAddress, getNetworkDetails, isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";
import { TESTNET, type AuthMethod, type EmailCodeRequest, type SessionData, type SessionIdentity } from "@stellardrop/shared";
import { api } from "@/lib/api";

type Wallet = {
  publicKey: string | null; token: string | null; email: string | null; authMethod: AuthMethod | null;
  ready: boolean; connecting: boolean; activating: boolean; activationError: string | null; error: string | null;
  connect: () => Promise<void>; disconnect: () => void; sign: (xdr: string) => Promise<string>; clearError: () => void;
  requestEmail: (email: string) => Promise<EmailCodeRequest>;
  verifyEmail: (challengeId: string, code: string) => Promise<void>;
  activate: () => Promise<void>;
};
const WalletContext = createContext<Wallet | null>(null);
const sessionKey = "stellardrop.session";
async function requireTestnet(publicKey?: string) {
  const details = await getNetworkDetails();
  if (details.error || details.networkPassphrase !== TESTNET.passphrase) throw new Error("Switch Freighter to Stellar Testnet, then try again.");
  if (publicKey) {
    const address = await getAddress();
    if (address.error || address.address !== publicKey) throw new Error("Your active wallet changed. Disconnect and connect again.");
  }
}
export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const activeToken = useRef<string | null>(null);
  const saveSession = useCallback((value: SessionData) => {
    activeToken.current = value.token;
    sessionStorage.setItem(sessionKey, JSON.stringify(value));
    setSession(value);
  }, []);
  const disconnect = useCallback(() => {
    activeToken.current = null; setSession(null); setError(null); setActivating(false); setActivationError(null);
    sessionStorage.removeItem(sessionKey);
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const saved = sessionStorage.getItem(sessionKey);
        if (saved) {
          const value = JSON.parse(saved) as SessionData;
          const me = await api<SessionIdentity>("/api/me", { token: value.token });
          if (me.authMethod === "wallet") await requireTestnet(me.publicKey);
          if (!cancelled) saveSession({ ...me, token: value.token });
        }
      } catch { if (!cancelled) disconnect(); }
      finally { if (!cancelled) setReady(true); }
    }
    void restore();
    return () => { cancelled = true; };
  }, [saveSession, disconnect]);
  const activate = useCallback(async () => {
    const token = session?.authMethod === "email" ? session.token : null;
    if (!token) return;
    setActivating(true); setActivationError(null);
    try { await api("/api/wallet/activate", { token, body: {} }); }
    catch (cause) {
      if (activeToken.current === token) setActivationError(cause instanceof Error ? cause.message : "Your wallet is created. Retry activation in a moment.");
    } finally { if (activeToken.current === token) setActivating(false); }
  }, [session?.authMethod, session?.token]);
  useEffect(() => { if (session?.authMethod === "email") void activate(); }, [session?.authMethod, activate]);
  async function connect() {
    if (connecting) return;
    setConnecting(true); setError(null);
    try {
      const available = await isConnected();
      if (!available.isConnected) throw new Error("Freighter is needed for an external wallet. You can sign in with email instead.");
      const access = await requestAccess();
      if (access.error || !access.address) throw new Error(access.error?.message ?? "Wallet connection was declined.");
      await requireTestnet(access.address);
      const challenge = await api<{ challengeId: string; transaction: string }>("/api/auth/challenge", { body: { publicKey: access.address } });
      const signature = await signTransaction(challenge.transaction, { networkPassphrase: TESTNET.passphrase, address: access.address });
      if (signature.error || !signature.signedTxXdr) throw new Error(signature.error?.message ?? "Wallet signature was declined.");
      saveSession(await api<SessionData>("/api/auth/verify", { body: { challengeId: challenge.challengeId, signedTransaction: signature.signedTxXdr } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to connect your wallet."); }
    finally { setConnecting(false); }
  }
  async function requestEmail(email: string) {
    setError(null);
    return api<EmailCodeRequest>("/api/auth/email/request", { body: { email } });
  }
  async function verifyEmail(challengeId: string, code: string) {
    setConnecting(true); setError(null);
    try { saveSession(await api<SessionData>("/api/auth/email/verify", { body: { challengeId, code } })); }
    finally { setConnecting(false); }
  }
  async function sign(xdr: string) {
    if (!session) throw new Error("Sign in first.");
    if (session.authMethod === "email") throw new Error("Approve the drop directly from your email account.");
    await requireTestnet(session.publicKey);
    const signed = await signTransaction(xdr, { networkPassphrase: TESTNET.passphrase, address: session.publicKey });
    if (signed.error || !signed.signedTxXdr) throw new Error(signed.error?.message ?? "Wallet signature was declined.");
    return signed.signedTxXdr;
  }
  return <WalletContext.Provider value={{ publicKey: session?.publicKey ?? null, token: session?.token ?? null, email: session?.email ?? null, authMethod: session?.authMethod ?? null, ready, connecting, activating, activationError, error, connect, disconnect, sign, requestEmail, verifyEmail, activate, clearError: () => setError(null) }}>{children}</WalletContext.Provider>;
}
export function useWallet() { const value = useContext(WalletContext); if (!value) throw new Error("Wallet provider missing"); return value; }
