# QuickMail

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/DivinPrince/quickmail)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)

Self-hosted email for your own domain, running on Cloudflare Workers.
Get `you@yourdomain.com` with a full web client — no third-party mailbox,
no servers to maintain.

## Features

- **Real mail in and out** — the provider delivers straight into the Worker, nothing is polled
- **Threads** — replies group into conversations, quoted history collapses
- **Attachments** — inbound files land in R2, outbound files upload from the composer
- **Safe HTML** — received HTML renders in a sandboxed iframe
- **Multiple domains and users** — per-user addresses, admin catch-all, unrouted-mail view
- **Delivery status** — delivered / bounced / complained tracking
- **REST API, CLI, and MCP server** — send and read mail from scripts, the terminal, or AI agents
- Light and dark themes

## Quick start

Click **Deploy to Cloudflare** above, or run the setup wizard locally:

```bash
bun run setup
# if bun isn't installed yet:
bash scripts/setup.sh
```

The wizard creates the D1 database and R2 bucket, writes config, and onboards
your domain. Budget about 30 minutes — most of that is waiting on DNS.

You need:

1. A domain you control
2. A [Cloudflare](https://dash.cloudflare.com) account
3. Either a [Resend](https://resend.com) account, **or** the domain on Cloudflare DNS plus a Workers paid plan

## Choosing a mail provider

One provider is active per deploy, selected by `EMAIL_PROVIDER` (`resend` is
the default, `cloudflare` is the alternative). Do not point the same domain's
apex MX at both.

|                 | [Resend](https://resend.com)             | [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) |
| --------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| Outbound        | Resend API                               | Workers `env.EMAIL.send()`                                                    |
| Inbound         | Webhook → `/api/webhooks/resend`         | Worker `email()` handler                                                      |
| DNS             | Any DNS host                             | **Cloudflare DNS required**                                                   |
| Cost            | Resend free tier + Cloudflare            | Requires a **Workers paid** plan                                              |
| Delivery events | `delivered`, `bounced`, `complained`, …  | Accepted send is stored as `sent`                                             |

Pick Resend if your DNS lives elsewhere or you already use it. Pick Cloudflare
Email if the zone is already on Cloudflare and you want everything on one account.

## Manual setup

Only needed if you cannot run the wizard.

### 1. Install

```bash
bun install          # or: npm install
bunx wrangler login
```

Cloudflare Email Sending needs **Wrangler 4.123+** (older versions hit a
removed API path and 404).

### 2. Create D1 and R2

```bash
bunx wrangler d1 create quickmail
bunx wrangler r2 bucket create quickmail-attachments
```

Copy the printed `database_id` into `wrangler.jsonc` (replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`), then run migrations:

```bash
bun run db:migrate:remote
```

To serve from your own hostname, uncomment the `routes` block in
`wrangler.jsonc` — the zone must be on the same Cloudflare account.

Then follow **exactly one** provider track below.

### Track A — Resend

1. **Verify the domain** in Resend (**Domains → Add Domain**) and add every
   record they show, including the apex `MX` — without it, mail never arrives.
   Enable **sending and receiving** on the domain.

2. **Set the API key** (create it with full access — send + domains + receiving):

   ```bash
   bunx wrangler secret put RESEND_API_KEY
   ```

3. **Deploy, then create the webhook** (the URL must be public):

   ```bash
   bun run deploy
   ```

   In [Resend → Webhooks](https://resend.com/webhooks) add a webhook pointing to
   `https://<your-worker-url>/api/webhooks/resend` with the events
   `email.received`, `email.sent`, `email.delivered`, `email.bounced`,
   `email.complained`, `email.delivery_delayed`, `email.failed`.

4. **Save the signing secret** (shown once) and redeploy:

   ```bash
   bunx wrangler secret put RESEND_WEBHOOK_SECRET
   bun run deploy
   ```

While testing, a DMARC record on `_dmarc` is recommended:
`v=DMARC1; p=none; rua=mailto:you@yourdomain.com; pct=100; adkim=s; aspf=s`
(tighten to `p=quarantine` later).

### Track B — Cloudflare Email Service

The zone must use **Cloudflare DNS**.

1. **Onboard the domain** for both
   [Email Sending](https://dash.cloudflare.com/?to=/:account/email-service/sending)
   and [Email Routing](https://dash.cloudflare.com/?to=/:account/email-service/routing)
   in the dashboard, or with Wrangler 4.123+:

   ```bash
   bunx wrangler email sending enable yourdomain.com
   bunx wrangler email routing enable yourdomain.com
   ```

2. **Route inbound mail to the Worker.** In the Email Routing dashboard, enable
   **Catch-all** with the action **Send to a Worker** → this app. The catch-all
   is what lets users create arbitrary addresses in Settings. (This step is
   dashboard-only — the CLI can't set a Worker as the catch-all action.)

3. **Configure the Worker** in `wrangler.jsonc` and deploy:

   ```jsonc
   "vars": {
     "EMAIL_PROVIDER": "cloudflare",
     "CLOUDFLARE_MAIL_DOMAINS": "yourdomain.com" // comma-separate multiple domains
   }
   ```

   ```bash
   bun run deploy
   ```

Inbound mail only works on a **deployed** Worker (or `bun run preview`) —
`vite dev` never runs the `email()` handler.

## First run

1. Open the deployed URL.
2. Visit `/setup` — pick a domain and create the admin account (name,
   address, password). That address is both the inbox and the login.
3. Later users claim addresses through `/onboarding`.

Send yourself a message from another account — it should land within seconds.

### Desktop notifications (optional)

QuickMail can push-notify users about new mail even with no tab open:

```bash
bunx web-push generate-vapid-keys
bunx wrangler secret put VAPID_PUBLIC_KEY
bunx wrangler secret put VAPID_PRIVATE_KEY
bunx wrangler secret put VAPID_SUBJECT   # e.g. mailto:admin@example.com
bun run db:migrate:remote
bun run deploy
```

Users opt in under **Settings → Desktop notifications**. Don't rotate the key
pair after users subscribe, or they'll have to re-enable.

## Development

```bash
cp .dev.vars.example .dev.vars    # fill in the provider you're using
bun install
bun run db:migrate:local
bun run dev
```

| Command           | Purpose                                                  |
| ----------------- | -------------------------------------------------------- |
| `bun run dev`     | Vite dev server (D1/R2 via platformProxy)                |
| `bun run preview` | Production build + `wrangler dev` (Cloudflare inbound)   |
| `bun run check`   | svelte-check                                             |
| `bun run test`    | Unit tests                                               |
| `bun run deploy`  | Build, wrap the Worker with `email()`, deploy            |

**Testing inbound with Resend:** webhooks can't reach `localhost`, so tunnel it
(`cloudflared tunnel --url http://localhost:5173`) and point a **throwaway**
webhook at the tunnel — never repoint production.

**Testing inbound with Cloudflare Email:** use `bun run preview` or a deploy.

**Forgot the admin password:**

```bash
bun scripts/reset-admin-password.mjs you@example.com newpassword --local
```

## API access

Any user can mint a long-lived API key under **Settings → API keys** and use it
as a bearer token:

```sh
curl https://your-worker/api/mail \
  -H "Authorization: Bearer qm_live_..." \
  -H "Content-Type: application/json" \
  -d '{"to": "you@example.com", "subject": "hello", "text": "hi"}'
```

`GET /api/mail?view=inbox` lists conversations. Keys are scoped (`mail:read`,
`mail:send`, admin) and only the SHA-256 hash is stored — the raw value is
shown once. Revoking a key takes effect immediately.

## CLI and MCP

```bash
curl -fsSL https://raw.githubusercontent.com/DivinPrince/quickmail/main/scripts/install.sh | sh
quickmail login --url https://<your-instance> --token <key from Settings>
quickmail inbox
quickmail send --to someone@example.com --subject "Hi" --body "Hello"
```

If the instance is protected by Cloudflare Access, provide a service-token pair
in addition to the QuickMail API key:

```bash
quickmail login \
  --url https://mail.example.com \
  --token qm_live_xxx \
  --cf-access-client-id xxx.access \
  --cf-access-client-secret xxx
```

Both Access values are required together. For an environment-only CLI or MCP,
set `QUICKMAIL_URL` and `QUICKMAIL_TOKEN` together. That pair does not inherit
saved Access credentials; provide both Access environment variables when the
environment-selected instance is protected:

```text
QUICKMAIL_URL
QUICKMAIL_TOKEN
QUICKMAIL_CF_ACCESS_CLIENT_ID
QUICKMAIL_CF_ACCESS_CLIENT_SECRET
```

Saved configuration remains mode `0600`. Every API request sends the Access
service-token headers and QuickMail's independent bearer token. QuickMail does
not follow API redirects; an Access redirect or HTML login response reports a
Cloudflare Access diagnostic distinct from a QuickMail JSON `401` or `403`.
Neither credential is included in diagnostics.

The same credentials drive an MCP server for Claude, Cursor, and other agents:

```json
{
  "mcpServers": {
    "quickmail": {
      "command": "bunx",
      "args": ["quickmail", "mcp"],
      "env": {
        "QUICKMAIL_URL": "https://mail.example.com",
        "QUICKMAIL_TOKEN": "qm_live_…",
        "QUICKMAIL_CF_ACCESS_CLIENT_ID": "xxx.access",
        "QUICKMAIL_CF_ACCESS_CLIENT_SECRET": "xxx"
      }
    }
  }
}
```

Tools: `list_threads`, `get_thread`, `search_mail`, `send_message`, `reply`,
`list_attachments`.

### Cloudflare Access deployment

Access and QuickMail authorization are independent gates. Keep the normal
identity-provider **Allow** policy for browser users, then add a **Service Auth**
policy matching the CLI/MCP service token. Cloudflare documents the required
policy action and the `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers in
[Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
Do not enable a single `Authorization`-header service-token mode: QuickMail owns
that header for its scoped API key.

Do not bypass `/api`, `/api/auth`, or the UI. When Resend handles inbound mail,
create a separate Access application scoped exactly to
`/api/webhooks/resend` and give only that application a public **Bypass** policy;
the Worker must still validate every Resend signature. Cloudflare documents
path-scoped applications in
[Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
and narrowly scoped bypasses in
[Common Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/).

Cloudflare Email delivery invokes the Worker's `email()` handler instead of the
protected HTTP hostname, so it needs no HTTP bypass. See
[Email Workers](https://developers.cloudflare.com/email-routing/email-workers/).

Rotate and revoke the two credential systems independently:

1. Create a replacement Access service token, update CLI/MCP secrets, verify it,
   then revoke the old Access token.
2. Create a replacement QuickMail API key with the same least-privilege scopes,
   update CLI/MCP secrets, verify it, then revoke the old API key.

Compromise of one credential must not be treated as compromise of the other,
but rotate both if their storage environment may have been exposed.

## How inbound routing works

Both providers accept every address on a connected domain. The app then routes:

1. Exact match in `addresses` → that user
2. Else the domain's catch-all owner (admin) → that user
3. Else stored as unrouted and listed in the admin view

## Project structure

```
src/
  worker.ts          SvelteKit fetch + Cloudflare email() inbound
  routes/            inbox, compose, drafts, settings, admin, setup
  lib/
    components/      sidebar, mailbox, composer, thread view
    server/          providers, inbound, D1, auth
scripts/
  setup.sh / setup.mjs         first-run wizard
  wrap-cloudflare-worker.mjs   attach email() after the SvelteKit build
cli/                 quickmail CLI + MCP server
migrations/          D1 schema, applied in order
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `wrangler email sending enable` → 404 | Wrangler too old — upgrade to 4.123+ |
| Mail never arrives (Resend) | `dig MX yourdomain.com` must point at Resend; enable receiving on the domain |
| Mail never arrives (Cloudflare) | Apex MX must be Cloudflare Routing, catch-all must target this Worker, `EMAIL_PROVIDER=cloudflare`, Worker must be deployed |
| Webhook 401 | `RESEND_WEBHOOK_SECRET` mismatch — secrets are shown once; recreate the webhook |
| Webhook 500 | `bunx wrangler tail` |
| Attachments missing | R2 bucket must exist and match `bucket_name` in `wrangler.jsonc` |
| `database_id` errors on deploy | Paste the id from `wrangler d1 create` into `wrangler.jsonc` |
| Setup shows no Cloudflare domains | Set `CLOUDFLARE_MAIL_DOMAINS` and `EMAIL_PROVIDER=cloudflare`, restart the dev server |

## License

[MIT](LICENSE.md) — use it, modify it, ship it, commercially or not.
Copyright © 2026 Irasubiza Divin Prince.
