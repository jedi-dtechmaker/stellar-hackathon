import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import { TESTNET } from "@stellardrop/shared";
import { db } from "./db.js";
import { env } from "./config.js";
import { AppError, logger } from "./errors.js";
import { completeAuth, createAuthChallenge, sessionOf } from "./auth.js";
import { activateEmailWallet, createDrop, dashboard, normalizedCode, prepareDrop } from "./drops.js";
import { accountBalance, escrowKey, friendbot, initializeEscrow } from "./stellar.js";
import { bot, botUsername, enqueueTelegramUpdate } from "./bot.js";
import { secretMatches } from "./crypto.js";
import { Operation } from "@stellar/stellar-sdk";
import { buildTransaction, usdc } from "./stellar.js";
import { verifyTelegramInitData } from "./telegram-auth.js";
import { requestEmailCode, verifyEmailCode } from "./email-auth.js";

const wallet = z.string().regex(/^G[A-Z2-7]{55}$/);
const signed = z.string().min(20).max(20000);
export function createApp(options: { onTelegramUpdate?: () => Promise<void> } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization"] }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", async (_req, res) => { await db.$queryRaw`SELECT 1`; res.json({ status: "ok", network: "TESTNET" }); });
  app.post("/api/webhooks/telegram", rateLimit({ windowMs: 60000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }), async (req, res) => {
    if (!bot || env.TELEGRAM_MODE !== "webhook" || !secretMatches(req.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET)) throw new AppError(403, "Invalid Telegram webhook secret.");
    await enqueueTelegramUpdate(req.body);
    try { await options.onTelegramUpdate?.(); }
    catch { logger.warn("Telegram update is queued; the scheduled worker will retry processing."); }
    res.sendStatus(200);
  });
  app.use("/api", rateLimit({ windowMs: 60000, limit: 100, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests. Please try again in a minute." } }));
  const writes = rateLimit({ windowMs: 60000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Please wait a minute before trying again." } });
  const emailRequests = rateLimit({ windowMs: 10 * 60000, limit: 6, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many email requests. Please try again later.", code: "EMAIL_RATE_LIMIT" } });
  app.post("/api/auth/email/request", emailRequests, async (req, res) => {
    const input = z.object({ email: z.string().min(3).max(254) }).strict().parse(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json(await requestEmailCode(input.email));
  });
  app.post("/api/auth/email/verify", writes, async (req, res) => {
    const input = z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict().parse(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.json(await verifyEmailCode(input.challengeId, input.code));
  });
  app.get("/api/config", async (_req, res) => {
    await initializeEscrow(false);
    res.json({ network: "TESTNET", horizon: TESTNET.horizon, assetIssuer: TESTNET.issuer, escrowPublicKey: escrowKey().publicKey(), botUsername: botUsername || null, anchorDomain: TESTNET.anchor });
  });
  app.post("/api/auth/challenge", writes, async (req, res) => {
    const input = z.object({ publicKey: wallet }).parse(req.body);
    await initializeEscrow(false);
    res.json(await createAuthChallenge(input.publicKey));
  });
  app.post("/api/auth/verify", writes, async (req, res) => {
    const input = z.object({ challengeId: z.uuid(), signedTransaction: signed }).parse(req.body);
    res.json(await completeAuth(input.challengeId, input.signedTransaction));
  });
  app.get("/api/me", async (req, res) => {
    const session = sessionOf(req);
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user || (session.authMethod === "email" ? !user.emailVerifiedAt || user.custodialPubKey !== session.publicKey : user.walletPublicKey !== session.publicKey)) throw new AppError(401, "Session no longer exists.");
    res.setHeader("Cache-Control", "no-store");
    res.json({ publicKey: session.publicKey, authMethod: session.authMethod, email: session.authMethod === "email" ? user.email : null });
  });
  app.get("/api/dashboard", async (req, res) => res.json(await dashboard(sessionOf(req))));
  app.post("/api/wallet/fund", writes, async (req, res) => {
    const session = sessionOf(req);
    await friendbot(session.publicKey);
    res.json(await accountBalance(session.publicKey));
  });
  app.post("/api/wallet/activate", writes, async (req, res) => res.json(await activateEmailWallet(sessionOf(req))));
  app.post("/api/wallet/trustline/prepare", writes, async (req, res) => {
    const session = sessionOf(req);
    if (session.authMethod === "email") throw new AppError(400, "Use wallet activation for an email account.");
    if (!(await accountBalance(session.publicKey)).funded) throw new AppError(400, "Get test XLM first to activate your account.");
    const tx = await buildTransaction(session.publicKey, [Operation.changeTrust({ asset: usdc })]);
    res.json({ transaction: tx.toXDR(), networkPassphrase: TESTNET.passphrase });
  });
  app.post("/api/drops/prepare", writes, async (req, res) => {
    const session = sessionOf(req);
    const input = z.object({ amount: z.string().max(24) }).parse(req.body);
    await initializeEscrow();
    res.json(await prepareDrop(session, input.amount));
  });
  app.post("/api/drops", writes, async (req, res) => {
    const session = sessionOf(req);
    const input = z.object({ amount: z.string().max(24), senderPublicKey: wallet, intentId: z.uuid(), signedTransaction: signed.optional() }).strict().parse(req.body);
    await initializeEscrow(false);
    const drop = await createDrop(session, input);
    res.status(201).json({ claimCode: drop.claimCode, amount: drop.amount, status: drop.status, shareUrl: `${env.WEB_ORIGIN}/drop/${drop.claimCode}` });
  });
  app.get("/api/intents/:id", async (req, res) => {
    const session = sessionOf(req);
    const id = z.uuid().parse(req.params.id);
    const intent = await db.fundingIntent.findUnique({ where: { id } });
    if (!intent || intent.senderId !== session.userId) throw new AppError(404, "Funding intent not found.");
    const [drop, job] = await Promise.all([db.drop.findUnique({ where: { id } }), db.ledgerJob.findUnique({ where: { kind_reference: { kind: "CREATE", reference: id } } })]);
    res.json({ status: drop ? "CONFIRMED" : job?.state ?? "AWAITING_SIGNATURE", claimCode: drop?.claimCode ?? null });
  });
  app.get("/api/drops/:code", async (req, res) => {
    const code = normalizedCode(String(req.params.code));
    const drop = await db.drop.findUnique({ where: { claimCode: code }, select: { claimCode: true, amount: true, assetCode: true, status: true, createdAt: true } });
    if (!drop) throw new AppError(404, "This drop could not be found. Check the link with your sender.");
    res.setHeader("Cache-Control", "no-store");
    res.json(drop);
  });
  app.get("/api/users/:telegramId/balance", async (req, res) => {
    // Telegram IDs are not credentials. A wallet session cannot read another
    // Telegram user's balance. The bot uses the service directly.
    const initData = req.headers.authorization?.match(/^tma (.+)$/)?.[1];
    const user = initData
      ? await db.user.findUnique({ where: { telegramId: verifyTelegramInitData(initData) } })
      : await db.user.findUnique({ where: { id: sessionOf(req).userId } });
    if (!user?.telegramId || user.telegramId !== req.params.telegramId || !user.custodialPubKey) throw new AppError(403, "This balance belongs to another user. Use /balance in Telegram.");
    res.json({ assetCode: "USDC", network: "TESTNET", ...(await accountBalance(user.custodialPubKey)) });
  });
  app.use((_req, _res, next) => next(new AppError(404, "Endpoint not found.")));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) { res.status(400).json({ error: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "), code: "VALIDATION_ERROR" }); return; }
    if (error instanceof AppError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    if (error instanceof SyntaxError && "body" in error) { res.status(400).json({ error: "Invalid JSON." }); return; }
    logger.error({ name: error instanceof Error ? error.name : "UnknownError" }, "API request failed");
    res.status(503).json({ error: "The service is temporarily unavailable. Please retry shortly.", code: "SERVICE_UNAVAILABLE" });
  });
  return app;
}
