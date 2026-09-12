# Quickinbox

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/DivinPrince/quickinbox)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)

Self-hosted email for your own domain, running on Cloudflare Workers.
Get `you@yourdomain.com` with a full web client — no third-party mailbox,
no servers to maintain.

## Features

- **Real mail in and out** — the provider delivers straight into the Worker, nothing is polled
- **Threads** — replies group into conversations, quoted history collapses; conversations never mix messages from different domains
- **Attachments** — inbound files land in R2, outbound files upload from the composer
- **Safe HTML** — received HTML renders in a sandboxed iframe
- **Multiple domains and users** — per-user addresses, admin catch-all, unrouted-mail view; the combined inbox tags each conversation with the address it arrived on and can filter by it
- **Delivery status** — delivered / bounced / complained tracking
- **REST API, CLI, and MCP server** — send and read mail from scripts, the terminal, or AI agents
- **Hosted MCP with OAuth** — paste `https://your-instance/mcp` into Claude, Cursor, or ChatGPT and approve access in the browser; disconnect apps from Settings
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

## Updating an existing install

If you already deployed from this repo, pulling updates only changes the product name in the UI and docs. It does **not** rename your Worker, D1 database, or R2 bucket — leave those as they are (often `quickmail` / `quickmail-attachments`). Existing `qm_live_` API keys keep working, and `quickmail` remains a CLI alias.

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

### Several accounts in one browser

If you have access to more than one mailbox on the same instance, use
**Add account** in the account menu to sign in to another one without signing
out. The menu then lists every signed-in account; pick one to switch (up to 5).
**Log out** leaves only the active account and drops you into the next one;
**Log out of all accounts** ends every session. Each account keeps its own
session, so revoking one from Settings → Devices does not affect the others.

### Desktop notifications (optional)

Quickinbox can push-notify users about new mail even with no tab open:

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

### Telegram notifications (optional)

Every inbound message can also ping a Telegram chat — useful for a mailbox you
watch from your phone without installing anything:

```bash
bunx wrangler secret put TELEGRAM_BOT_TOKEN   # from @BotFather
bunx wrangler secret put TELEGRAM_CHAT_ID     # from @userinfobot; negative for groups
bun run deploy
```

If the chat is a forum supergroup, add `TELEGRAM_THREAD_ID` for the topic to
post into — without it Telegram puts the message in General. Add `APP_URL` to
`vars` in `wrangler.jsonc` to link your install from each notification. Both secrets are required — leave either unset and notifications
stay off. This works on both provider tracks, and mail that matched no mailbox
is announced too, so a missing route is visible instead of silent.

Each message arrives as a single rich message — subject, sender, the body in
an expandable quote, every attachment inline with its size, and a link straight
to the conversation. That needs Bot API 10.1; against an older API the call
fails and the notification falls back to a text card followed by the files.

Delivery is fire-and-forget: a Telegram outage is logged and ignored rather
than failing the inbound handler, which the provider would then retry.

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
  -H "Authorization: Bearer qi_live_..." \
  -H "Content-Type: application/json" \
  -d '{"to": "you@example.com", "subject": "hello", "text": "hi"}'
```

`GET /api/mail?view=inbox` lists conversations. Keys are scoped (`mail:read`,
`mail:send`, admin) and only the SHA-256 hash is stored — the raw value is
shown once. Revoking a key takes effect immediately. New keys start with
`qi_live_`; existing `qm_live_` keys keep working after you pull this update.

## MCP (hosted, with OAuth)

Every instance is a remote MCP server. Add its URL to Claude, Cursor, ChatGPT,
or any client that speaks Streamable HTTP, and the client walks you through a
sign-in in the browser — no API key to paste:

```
https://mail.example.com/mcp
```

The consent screen shows which app is asking (with its real logo), exactly
what it will be allowed to do, and which of your signed-in accounts it will act
as. Approve, and the client receives an OAuth token scoped to that account.
Disconnect any app later from **Settings › Connections › AI assistants (MCP)**;
its tokens stop working immediately.

Tools: `whoami`, `list_threads`, `search_mail`, `get_thread`, `list_attachments`
(scope `mail:read`), `send_message`, `reply`, `update_thread` (scope `mail:send`).
A client that asks for only `mail:read` never sees the send tools.

Under the hood this is a standard OAuth 2.1 authorization server (RFC 8414 and
RFC 9728 discovery, RFC 7591 dynamic registration, PKCE S256, refresh-token
rotation with reuse detection, RFC 7009 revocation); public clients only. A
`qi_live_` API key also works as a bearer token on `/mcp`, so existing CLI
setups can point at it too.

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource/mcp` | Which server issues tokens for `/mcp` |
| `/.well-known/oauth-authorization-server` | Endpoint list, scopes, PKCE methods |
| `POST /oauth/register` | Dynamic client registration |
| `GET /oauth/authorize` | Consent screen |
| `POST /oauth/token` | Code exchange and refresh |
| `POST /oauth/revoke` | Revoke a token |

## CLI and MCP (local)

```bash
curl -fsSL https://raw.githubusercontent.com/DivinPrince/quickinbox/main/scripts/install.sh | sh
quickinbox login --url https://<your-instance> --token <key from Settings>
quickinbox inbox
quickinbox send --to someone@example.com --subject "Hi" --body "Hello"
```

The same credentials drive a local stdio MCP server, useful when a client cannot
do OAuth or you want several instances behind one server (see below):

```json
{
  "mcpServers": {
    "quickinbox": {
      "command": "quickinbox",
      "args": ["mcp"],
      "env": {
        "QUICKINBOX_URL": "https://mail.example.com",
        "QUICKINBOX_TOKEN": "qi_live_…"
      }
    }
  }
}
```

`quickinbox` is the launcher from the install script (`~/.local/bin/quickinbox`).
`quickmail` is the same binary. Login once, or set `QUICKINBOX_URL` and
`QUICKINBOX_TOKEN` as above (`QUICKMAIL_URL` / `QUICKMAIL_TOKEN` still work).

Tools: `list_accounts`, `list_threads`, `get_thread`, `search_mail`,
`send_message`, `reply`, `list_attachments`.

### Multiple accounts

If you have inboxes on several Quickinbox instances, log in to each one. Every
login is saved as an account (named after the host unless you pass `--account`);
the first one becomes the default.

```bash
quickinbox login --url https://mail.alter.rw --token qi_live_… --account alter
quickinbox login --url https://mail.cursorrwanda.com --token qi_live_… --account rwanda
quickinbox accounts                 # * alter  https://mail.alter.rw
                                    #   rwanda https://mail.cursorrwanda.com
quickinbox inbox --all-accounts     # every inbox in one list, tagged [alter] / [rwanda]
quickinbox search invoice --all-accounts
quickinbox read <id> --account rwanda
quickinbox accounts use rwanda      # change the default
quickinbox logout --account alter   # or `logout --all`
```

Every command takes `--account <name>` (`-a`). `QUICKINBOX_ACCOUNT` selects the
default; `QUICKINBOX_URL` + `QUICKINBOX_TOKEN` add an account that always wins.

The MCP server exposes all saved accounts at once. Each tool accepts an optional
`account`; `list_threads` and `search_mail` query every account when it is
omitted and tag each thread with its `account`, while `get_thread`, `reply`, and
`list_attachments` find the account that owns the id automatically. Use
`list_accounts` to see what is configured. `send_message` uses the default
account unless told otherwise. Config lives in
`~/.config/quickinbox/config.json`; an existing single-account file keeps
working and is upgraded on the next login.

## Internationalization

The UI ships in English, French, Simplified Chinese, and Spanish. Language is stored
on the account (Settings → Appearance) and in a `qi_locale` cookie — URLs stay the
same. Email bodies are never translated.

Catalogs live in `messages/`. After editing `messages/en.json`, generate the other
locales with [General Translation](https://generaltranslation.com):

```bash
# GT_API_KEY and GT_PROJECT_ID from https://generaltranslation.com/dashboard
bun run translate
```

CI does the same on pushes to `main` (and on a manual **CI** workflow run). Set
repository secrets `GT_API_KEY` and `GT_PROJECT_ID` — never commit them. The
translate job opens a PR with updated catalogs.

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
cli/                 quickinbox CLI + MCP server
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
