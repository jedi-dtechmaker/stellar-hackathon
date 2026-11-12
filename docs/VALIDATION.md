# Validation — November 12, 2026

The production build and all **41 automated tests** pass: 37 unit/API boundary tests and 4 tests against a real PostgreSQL 18 database. The production dependency audit reports **zero vulnerabilities**. Desktop/mobile browser checks exercise the landing page, protected route, actual signed wallet login, dashboard data, create route, and share route. The browser test substitutes the Freighter extension transport only; the server verifies real Ed25519 signatures and reads real data.

A complete **2 USDC live Testnet** flow was executed:

| Step | Evidence |
| --- | --- |
| Obtain USDC with Friendbot-funded XLM through a real DEX path | [Funding transaction](https://stellar.expert/explorer/testnet/tx/3d4193ab0143ef5121a8f393abb7e5caac0346a086d7488c85a31c1bb7ae39aa) |
| Atomic sender payment + escrow claimable balance | [Create transaction](https://stellar.expert/explorer/testnet/tx/06de9af4a0ef60f3278ffa00f3ab390cadb38ced8be5a098cd91eb542564b3c0) |
| Two receivers race; exactly one claims, retries preserve balance | [Claim + receiver payment](https://stellar.expert/explorer/testnet/tx/70073c0959aca8e2a37cfc72d7dbbaa94eb335a95eae7310baa8f0ad971e18e4) |
| Direct SEP-10 authentication | SDK-verified live challenge from `testanchor.stellar.org/auth`, signed by the receiver, exchanged for an anchor token |
| Direct SEP-24 initialization | Live transaction `2488f079-156d-4d30-b82b-612cbf6722fb`, created with multipart form data |
| SDF-hosted bank interaction | Synthetic data entered only on `anchor-ref-ui-testanchor.stellar.org`; no real personal or bank details |
| Automatic withdrawal payment with anchor memo | [Withdrawal transaction](https://stellar.expert/explorer/testnet/tx/ad1167c7d2bafa021e7b14ba4a18fb77d3ab9ce76fbb6ec027782f50bb9f2525) |
| Anchor settlement | `completed`; drop changed to `WITHDRAWN`, `withdrawnAmount=2`, both withdrawal logs committed |

The anchor returned simulated **USD**, not NGN. The bot’s completion message therefore correctly names test USD. Current live USDC withdrawal limits were **1–10 USDC per request**. Protocol API calls use the exact `testanchor.stellar.org` origin; its official hosted form uses the explicitly allowed UI origin above.

The configured **@ST_dropBot** successfully authenticated, registered its commands, and started polling. Actual delivery to a human Telegram account was not fabricated; it requires a person to open the bot and claim a privately shared drop. The live ledger/anchor smoke tests use non-Telegram test identifiers, so no completion notification is sent to an unrelated chat.

Node’s outgoing connections intermittently timed out in this execution environment. For live verification and the local preview, an ephemeral curl-based HTTPS adapter carried requests to the real services. No ledger or anchor responses were mocked. The application’s committed transport uses bounded native fetch requests with read retries and durable transaction reconciliation.

Detailed local evidence is in `.data/live-testnet-report.json` and `.data/screenshots/` (ignored by version control). No secret keys, JWTs, anchor interactive URLs, or bank data are included in this document.
