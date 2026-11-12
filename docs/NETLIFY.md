# Deploy StellarDrop to Netlify

The existing Next.js website and Express API deploy together on one Netlify site. `/api/*` is rewritten to the API function; email registration, verification, wallet activation, and drop creation retain their existing endpoints. PostgreSQL holds users, encrypted wallets, pending transactions, and the Telegram update queue.

The bot uses Telegram webhooks in production. Each authenticated webhook first persists the update, then invokes a protected background function. A scheduled function also invokes that worker every minute to recover interrupted jobs and poll withdrawals. A PostgreSQL advisory lock prevents overlapping worker batches. No persistent polling loop runs inside the API function.

## 1. Connect the repository

Import `jedi-dtechmaker/stellarDrop` into Netlify. Select the Next.js app in `apps/web` as the **package directory** and leave the **base directory** at the repository root. The committed `netlify.toml` specifies:

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
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | A Resend sending API key, restricted to your verified sending domain |
| `EMAIL_FROM` | An address on that exact verified domain, for example `StellarDrop <hello@your-domain.com>` |
| `WORKER_SECRET` | A separate secret generated with `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | Your BotFather credentials and username |
| `TELEGRAM_WEBHOOK_SECRET` | A separate URL-safe secret, 32–256 characters |
| `TELEGRAM_WEBHOOK_URL` | `https://your-site.netlify.app/api/webhooks/telegram` |

Set `NODE_ENV`, `TELEGRAM_MODE`, and `TRUST_PROXY_HOPS` in the Netlify environment alongside the secrets so the functions receive them at runtime. The committed configuration sets `NEXT_PUBLIC_API_URL` to an empty string at build time, so browsers call `/api` on the current site. Keep mail credentials and wallet secrets out of `NEXT_PUBLIC_*` variables. Redeploy after changing environment variables.

Use a PostgreSQL connection that preserves sessions for advisory locks. A transaction-pooling endpoint is unsuitable for the lock pool. Use the provider's direct connection endpoint with this version of the app.

Leave both master escrow keys empty to create and persist an encrypted escrow automatically. If you reuse an existing database, keep its encryption key and configured escrow consistent with the existing records.

Set `TELEGRAM_MODE=disabled` for deploy previews and branch deployments. Worker functions also check Netlify's request context and reject calls outside production; the build-only `CONTEXT` environment variable is not used to authorize workers. Give previews a separate database and secrets if you enable email/wallet testing there.

### Connect Resend

1. Create a Resend account and add a domain you own under **Domains**. Add the exact SPF, DKIM, and any supporting DNS records Resend provides to your DNS host, then wait for the domain's sending status to become **Verified**. You can use a sending subdomain such as `mail.your-domain.com`; the sender address must use that verified subdomain. A Netlify-provided `*.netlify.app` address is a website address, not a sending domain you own.
2. Under **API Keys**, create a key with **Sending access**, restricted to that domain. Store it in `RESEND_API_KEY` in your local `.env` and Netlify's Functions environment. Do not put it in browser code or a `NEXT_PUBLIC_*` variable.
3. Set `EMAIL_PROVIDER=resend` and `EMAIL_FROM="StellarDrop <hello@your-domain.com>"` in the same environments. Replace the example address with an address on your verified domain. The existing `SMTP_*` settings are unused when Resend is selected.
4. Restart local development or redeploy Netlify, open `/login`, and request a verification code to your own inbox. Check the email in Resend's **Emails** dashboard, enter the six-digit code, and confirm sign-in. Resend accepting an API request does not prove inbox delivery; check its delivery status and your spam folder if needed.

For an initial test before verifying a domain, Resend's `StellarDrop <onboarding@resend.dev>` sender is limited to the email address associated with your Resend account. Verify your own domain before opening signup to other users.

The app calls Resend's HTTPS email API directly. No SMTP username/password, hosted email template, receiving configuration, or Resend webhook is needed for verification codes. Existing one-use codes, expiry, attempt limits, and wallet creation remain handled by the app.

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

Check `/health`, then register with your email on `/login`. Verify the delivered code and confirm that a wallet appears in the dashboard. Sign out and sign in with the same email to confirm wallet reuse.

For Resend, request a code on `/login` and check its delivery status in the Resend dashboard. `npm run smtp:verify` is only for the optional SMTP/Mailpit transport and cannot validate a Resend API key.

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
