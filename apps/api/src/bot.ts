import { Telegraf, type Context } from "telegraf";
import type { Update } from "telegraf/types";
import { Prisma } from "@prisma/client";
import { env } from "./config.js";
import { db, withLock } from "./db.js";
import { beginWithdrawal } from "./anchor.js";
import { claimDrop } from "./drops.js";
import { accountBalance } from "./stellar.js";
import { AppError, logger, safeMessage } from "./errors.js";
import { telegramCall } from "./telegram-transport.js";

export const bot = env.TELEGRAM_BOT_TOKEN ? new Telegraf(env.TELEGRAM_BOT_TOKEN, { handlerTimeout: 180000 }) : undefined;
export let botUsername = env.TELEGRAM_BOT_USERNAME.replace(/^@/, "");

// Only private command messages enter the durable queue. We discard Telegram
// profile names, contact cards, photos, and arbitrary messages at the boundary.
export function sanitizeUpdate(value: unknown): Update | null {
  const update = value as Update.MessageUpdate;
  if (!Number.isSafeInteger(update?.update_id) || !update.message || update.message.chat?.type !== "private" || !Number.isSafeInteger(update.message.from?.id) || !("text" in update.message) || typeof update.message.text !== "string") return null;
  const text = update.message.text;
  if (!/^\/(start|claim|withdraw|balance|status|help)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) return null;
  return {
    update_id: update.update_id,
    message: {
      message_id: update.message.message_id, date: update.message.date,
      chat: { id: update.message.chat.id, type: "private", first_name: "" },
      from: { id: update.message.from.id, is_bot: false, first_name: "" },
      text: text.slice(0, 128), entities: update.message.entities?.filter(e => e.type === "bot_command"),
    },
  } as Update;
}
export async function enqueueTelegramUpdate(value: unknown) {
  const update = sanitizeUpdate(value);
  if (!update) return;
  const message = (update as Update.MessageUpdate).message;
  await db.telegramUpdate.upsert({ where: { updateId: BigInt(update.update_id) }, create: { updateId: BigInt(update.update_id), telegramId: String(message.from!.id), payload: update as unknown as Prisma.InputJsonValue }, update: {} });
}
const help = "Welcome to StellarDrop ✦\n\nSomeone sent you a little possibility. Open their claim link or type /claim CODE.\n\n/balance — your Testnet USDC\n/withdraw [amount] — send to a simulated bank account\n/status — latest withdrawal\n\nThis bot uses Stellar Testnet only. Test tokens have no monetary value. Bank information is entered only on the SDF Test Anchor.";
async function claim(ctx: Context, code: string) {
  if (!ctx.from) return;
  await ctx.reply("Opening your drop on Stellar Testnet… This can take a moment while your wallet is funded.");
  const result = await claimDrop(code, String(ctx.from.id));
  await ctx.reply(`${result.alreadyClaimed ? "You already claimed this drop." : `🎉 You have successfully claimed ${result.drop.amount} Testnet USDC!`} Your balance is ${result.balance} USDC. Type /withdraw to send this to your test bank account.`);
}
if (bot) {
  bot.telegram.callApi = telegramCall;
  bot.use(async (ctx, next) => {
    ctx.telegram.callApi = telegramCall;
    const clean = sanitizeUpdate(ctx.update);
    if (!clean || !ctx.from || ctx.chat?.type !== "private") return;
    await enqueueTelegramUpdate(clean);
    await withLock(`telegram-update:${ctx.update.update_id}`, async () => {
      const record = await db.telegramUpdate.findUniqueOrThrow({ where: { updateId: BigInt(ctx.update.update_id) } });
      if (record.processedAt) return;
      // Rate limit persisted commands per Telegram user across API replicas.
      const recent = await db.telegramUpdate.count({ where: { createdAt: { gt: new Date(Date.now() - 60000) }, telegramId: String(ctx.from!.id) } });
      try {
        if (recent > 12) await ctx.reply("Please wait a minute before sending another command.");
        else await next();
        await db.telegramUpdate.update({ where: { updateId: record.updateId }, data: { processedAt: new Date(), payload: Prisma.JsonNull } });
      } catch (error) {
        logger.warn({ updateId: ctx.update.update_id, code: error instanceof AppError ? error.code : "BOT_RETRY" }, "Telegram command interrupted");
        // Leave the durable update pending if even the error response cannot send.
        await ctx.reply(safeMessage(error));
        await db.telegramUpdate.update({ where: { updateId: record.updateId }, data: { processedAt: new Date(), payload: Prisma.JsonNull } });
      }
    });
  });
  bot.start(async ctx => {
    const code = ctx.startPayload?.trim();
    if (code) await claim(ctx, code);
    else await ctx.reply(help);
  });
  bot.command("help", ctx => ctx.reply(help));
  bot.command("claim", async ctx => {
    const code = ctx.message.text.trim().split(/\s+/)[1];
    if (!code) { await ctx.reply("Type /claim CODE using the code your sender shared."); return; }
    await claim(ctx, code);
  });
  bot.command("balance", async ctx => {
    const user = await db.user.findUnique({ where: { telegramId: String(ctx.from.id) } });
    if (!user?.custodialPubKey) { await ctx.reply("Your wallet is ready to be created. Claim a drop to get started."); return; }
    const { balance } = await accountBalance(user.custodialPubKey);
    await ctx.reply(`Your balance is ${balance} Testnet USDC.\n\nStellar address: ${user.custodialPubKey}\n\nType /withdraw to start a test bank withdrawal.`);
  });
  bot.command("withdraw", async ctx => {
    const requested = ctx.message.text.trim().split(/\s+/)[1];
    const withdrawal = await beginWithdrawal(String(ctx.from.id), requested);
    await ctx.reply(`Please click this link to securely enter your test bank details:\n${withdrawal.interactiveUrl}\n\nAmount: ${withdrawal.amount} Testnet USDC. The SDF Test Anchor simulates the payout; no real money is sent.`, { link_preview_options: { is_disabled: true } });
  });
  bot.command("status", async ctx => {
    const user = await db.user.findUnique({ where: { telegramId: String(ctx.from.id) } });
    const withdrawal = user ? await db.withdrawal.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }) : null;
    await ctx.reply(withdrawal ? `Latest withdrawal: ${withdrawal.amount} Testnet USDC\nStatus: ${withdrawal.status}${withdrawal.paymentHash ? `\nTestnet transaction: https://stellar.expert/explorer/testnet/tx/${withdrawal.paymentHash}` : ""}` : "No withdrawals yet. Claim a drop, then type /withdraw.");
  });
  bot.catch(error => { logger.error({ code: error instanceof AppError ? error.code : "TELEGRAM_ERROR" }, "Telegram update will be retried from the database"); });
}
export async function processTelegramQueue() {
  if (!bot) return;
  const updates = await db.telegramUpdate.findMany({ where: { processedAt: null }, orderBy: { createdAt: "asc" }, take: 10 });
  for (const update of updates) await bot.handleUpdate(update.payload as unknown as Update);
}
export async function startBot() {
  if (!bot || env.TELEGRAM_MODE === "disabled") return;
  const info = await bot.telegram.getMe();
  bot.botInfo = info;
  botUsername = info.username;
  await bot.telegram.setMyCommands([
    { command: "start", description: "Open a drop or see how StellarDrop works" },
    { command: "claim", description: "Claim a drop with its code" },
    { command: "balance", description: "View your Testnet USDC balance" },
    { command: "withdraw", description: "Withdraw to a simulated bank account" },
    { command: "status", description: "Check your latest withdrawal" },
  ]);
  if (env.TELEGRAM_MODE === "webhook") {
    const url = new URL(env.TELEGRAM_WEBHOOK_URL);
    if (url.pathname !== "/api/webhooks/telegram") throw new Error("Webhook URL must end in /api/webhooks/telegram");
    await bot.telegram.setWebhook(url.toString(), { secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], drop_pending_updates: false });
  } else {
    // Telegraf's polling promise runs until shutdown, so do not await launch.
    void bot.launch({ dropPendingUpdates: false, allowedUpdates: ["message"] }).catch(() => logger.error("Telegram long polling stopped. Restart the API to reconnect."));
  }
  logger.info({ username: botUsername, mode: env.TELEGRAM_MODE }, "Telegram bot ready");
}
