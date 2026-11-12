# Deploy StellarDrop to Netlify

The existing Next.js website and Express API deploy together on one Netlify site. `/api/*` is rewritten to the API function; Freighter wallet authentication, balance reads, and drop creation retain their existing endpoints. The current website uses Freighter on Stellar Testnet; email setup is not required. PostgreSQL holds users, encrypted wallets, pending transactions, and the Telegram update queue.

The bot uses Telegram webhooks in production. Each authenticated webhook first persists the update, then invokes a protected background function. A scheduled function also invokes that worker every minute to recover interrupted jobs and poll withdrawals. A PostgreSQL advisory lock prevents overlapping worker batches. No persistent polling loop runs inside the API function.

## 1. Connect the repository

Import `jedi-dtechmaker/stellar-hackathon` into Netlify. Select the Next.js app in `apps/web` as the **package directory** and leave the **base directory** at the repository root. The committed `netlify.toml` specifies:

| Setting | Value |
| --- | --- |
| Build command | `npm run db:generate && npm run build` |
| Publish directory | `apps/web/.next` |
| Functions directory | `netlify/functions` |
| Node.js | 24 |

Netlify's current Next.js adapter supplies routing, rendering, and image support automatically. Keep automatic adapter updates enabled. Do not deploy this app as a static export. The build explicitly installs development dependencies because TypeScript and Prisma are needed to build the app.

## 2. Configure the production environment

Create a hosted PostgreSQL database and add these variables to the Netlify site's **production** environment through the Netlify UI, CLI, or API. Server variables must be available to **Functions**, and the build needs `DATABASE_URL` for Prisma generation. Variables declared in `netlify.toml` are build settings and are not available to function runtime code. Local `.env` files are ignored by Git and are not uploaded as deployment configuration.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Your hosted PostgreSQL connection string, with TLS as required by the provider |
| `ENCRYPTION_KEY` | 64 hexadecimal characters; preserve the existing key when reusing its database |
| `JWT_SECRET` | A separate random secret of at least 32 characters |
| `WEB_ORIGIN` | The exact public HTTPS site origin, for example `https://your-site.netlify.app` |
| `NODE_ENV` | `production` |
| `TELEGRAM_MODE` | `webhook` for production; `disabled` for deploy previews and branch deploys |
| `TRUST_PROXY_HOPS` | `1` |
| `EMAIL_PROVIDER` | `disabled` (also the default); Freighter sign-in requires no email credentials |
| `WORKER_SECRET` | A separate secret generated with `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | Your BotFather credentials and username |
| `TELEGRAM_WEBHOOK_SECRET` | A separate URL-safe secret, 32–256 characters |
| `TELEGRAM_WEBHOOK_URL` | `https://your-site.netlify.app/api/webhooks/telegram` |

Set `NODE_ENV`, `TELEGRAM_MODE`, and `TRUST_PROXY_HOPS` in the Netlify environment alongside the secrets so the functions receive them at runtime. The committed configuration sets `NEXT_PUBLIC_API_URL` to an empty string at build time, so browsers call `/api` on the current site. Keep mail credentials and wallet secrets out of `NEXT_PUBLIC_*` variables. Redeploy after changing environment variables.

Use a PostgreSQL connection that preserves sessions for advisory locks. A transaction-pooling endpoint is unsuitable for the lock pool. Use the provider's direct connection endpoint with this version of the app.

Leave both master escrow keys empty to create and persist an encrypted escrow automatically. If you reuse an existing database, keep its encryption key and configured escrow consistent with the existing records.

Set `TELEGRAM_MODE=disabled` for deploy previews and branch deployments. Worker functions also check Netlify's request context and reject calls outside production; the build-only `CONTEXT` environment variable is not used to authorize workers. Give previews a separate database and secrets if you enable email/wallet testing there.

### Optional email provider

Keep `EMAIL_PROVIDER=disabled` for this deployment. Users connect the Freighter extension on Stellar Testnet; the sign-in page does not ask for an email address. Neither a Resend account nor SMTP credentials are required.

The optional email API and Resend transport are retained for future use. To enable that API later, set `EMAIL_PROVIDER=resend`, a sending API key in `RESEND_API_KEY`, and `EMAIL_FROM` to an address on a domain verified in Resend. Add the DNS records Resend provides. Email sign-in would also need to be restored in the website interface before users could use that flow.

## 3. Apply migrations and publish

Against the hosted database, run:

```sh
npm run db:generate
npm run db:migrate
```

Then deploy the site through Netlify. Database migrations are a separate release step; the build does not migrate a production database from a preview build.

After the production URL is available, stop any local or hosted polling instance using the same bot token. With the production bot settings loaded in your shell, register its webhook once:

```sh
npm run telegram:webhook
```

This command contacts Telegram to register the production webhook and bot commands. It does not send a chat message. Repeat it if the public webhook URL or webhook secret changes. API invocations and scheduled jobs do not re-register the webhook.

## 4. Verify the production flow

Check `/health`, open `/login`, select **Testnet** in Freighter, and click **Connect Freighter**. Approve the sign-in challenge and confirm that the dashboard shows your connected address and live Testnet USDC balance. Click **Refresh** to update it. Use **Log out** and confirm that the sign-in screen returns and protected dashboard content is hidden.

Email provider checks are unnecessary for Freighter sign-in. `npm run smtp:verify` applies only if you explicitly select the optional SMTP/Mailpit transport.

Verify that Netlify lists `api`, `worker`, and `schedule-worker` under Functions, that `worker` is marked as a background function, and that `schedule-worker` is scheduled every minute. Use a private test drop and your own Telegram chat to verify webhook processing and a simulated anchor withdrawal.

Netlify's synchronous functions have a 60-second limit; background functions have a 15-minute limit. Friendbot or Horizon delays may require retrying wallet activation or checking a persisted funding intent. The durable worker resumes ledger jobs and polls the anchor on later invocations. Scheduled work runs on published production deployments, so settlement polling may take about a minute between checks. Monitor function usage and quotas for the chosen Netlify plan.

## References

- [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
- [Express on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/)
- [Monorepo settings](https://docs.netlify.com/build/configure-builds/monorepos/)
- [Background Functions](https://docs.netlify.com/build/functions/background-functions/)
- [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/)
- [Function environment variables](https://docs.netlify.com/build/functions/environment-variables/)
- [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend sending API keys](https://resend.com/docs/api-reference/api-keys/create-api-key)
- [Resend email API](https://resend.com/docs/api-reference/emails/send-email)
