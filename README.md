# QuickMail

A web mail client for your own domain, on Cloudflare's edge. Inbox, threads,
attachments, a rich-text composer, multiple domains, and multiple users —
`you@yourdomain.com`, no third-party mailbox.

Deploys to Cloudflare Workers.

> **MIT licensed.** Use it, modify it, ship it — commercially or not. See
> [LICENSE.md](LICENSE.md).

## What you get

- **Real mail in and out** — nothing is polled. The provider delivers into the Worker.
- **Threads** — replies group into conversations; quoted history collapses.
- **Attachments** — inbound files land in R2; outbound files upload from the composer.
- **Safe HTML** — received HTML renders in a sandboxed iframe.
- **Multiple domains and users** — each user has addresses and a default sending identity. Admins get a catch-all and an unrouted-mail view.
- **Delivery status** — Resend reports delivered / bounced / complained over webhooks. Cloudflare marks a send `sent` once the binding accepts it.
- **Light and dark themes.**

---

# Choose a mail provider

One provider is active per deploy. Set `EMAIL_PROVIDER` to `resend` (default) or
`cloudflare`. Do not point the same domain's apex MX at both.

| | [Resend](https://resend.com) | [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) |
|---|---|---|
| Outbound | `POST https://api.resend.com/emails` | Workers `env.EMAIL.send()` |
| Inbound | Webhook → `/api/webhooks/resend` | Worker `email()` handler |
| DNS | Records Resend gives you (any DNS host) | **Cloudflare DNS required** |
| Cost | Resend free tier + Cloudflare | Email Sending needs a **Workers paid** plan. Routing is free. |
| Delivery events | Webhooks (`delivered`, `bounced`, …) | Accepted send is stored as `sent` |
| Best if | You already use Resend, or the domain is not on Cloudflare DNS | The zone is already on Cloudflare and you want mail on the same account |

Resend webhooks carry **metadata only**. On `email.received` the app fetches the
body and attachments from Resend. Cloudflare delivers the full MIME on
`message.raw` — no second HTTP fetch.

---

# Setup

The wizard installs tools, logs you into Cloudflare, creates D1/R2, writes
env and wrangler config, and onboards your domain:

```bash
bun run setup
# if bun isn't installed yet:
bash scripts/setup.sh
```

It asks for the mail domain, Resend vs Cloudflare Email, Worker / D1 / R2
names, and any API keys — then does the rest. Budget about 30 minutes; most
of that is DNS.

**You need**

1. A domain you control.
2. A [Cloudflare](https://dash.cloudflare.com) account.
3. Either a [Resend](https://resend.com) account, **or** the domain on Cloudflare DNS plus a Workers paid plan (Cloudflare Email Sending).

## Manual setup

Do this only if you cannot run the wizard.

### 1. Install

```bash
bun install          # or: npm install
bunx wrangler login
```

Use **Wrangler 4.123 or newer** for Cloudflare Email Sending. `4.96` calls an
old `/email/sending/enable` path and gets a 404. Check with
`bunx wrangler --version`. Upgrade with `bun add -d wrangler@latest`.

### 2. Create D1 and R2

```bash
bunx wrangler d1 create quickmail
bunx wrangler r2 bucket create quickmail-attachments
```

`d1 create` prints a `database_id`. Open `wrangler.jsonc` and replace
`REPLACE_WITH_YOUR_D1_DATABASE_ID` with it.

Set `"name"` to whatever you want the Worker called. To serve from your own
hostname, uncomment the `routes` block — that zone must be on the same account.

```bash
bun run db:migrate:remote
```

Then follow **exactly one** provider track.

---

## Track A — Resend

`EMAIL_PROVIDER` can be omitted or set to `resend`.

### A1. Verify the domain

In Resend: **Domains → Add Domain**. Add every record they show, including the
apex `MX`. Without that MX, mail never arrives.

| Record | Purpose |
|---|---|
| `TXT` on `resend._domainkey` | DKIM |
| `TXT` + `MX` on `send` | SPF and bounces |
| **`MX` on the apex** | **Receiving** |

Add DMARC on `_dmarc` while you test:

```txt
v=DMARC1; p=none; rua=mailto:you@yourdomain.com; pct=100; adkim=s; aspf=s
```

Start at `p=none`, then tighten to `p=quarantine`. Enable **sending and
receiving** on the domain. Create an API key with full access (send + domains +
receiving).

```bash
bunx wrangler secret put RESEND_API_KEY     # paste the re_... key
```

### A2. Deploy, then create the webhook

The webhook URL has to be public, so deploy first:

```bash
bun run deploy
```

Resend dashboard → [Webhooks](https://resend.com/webhooks) → **Add Webhook**:

- **URL** — `https://<your-worker-url>/api/webhooks/resend`
- **Events** — `email.received`, `email.sent`, `email.delivered`, `email.bounced`,
  `email.complained`, `email.delivery_delayed`, `email.failed`

Or:

```bash
curl -X POST https://api.resend.com/webhooks \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://<your-worker-url>/api/webhooks/resend",
       "events":["email.received","email.sent","email.delivered","email.bounced","email.complained","email.delivery_delayed","email.failed"]}'
```

The response contains `signing_secret` — **shown once**. Save it and redeploy:

```bash
bunx wrangler secret put RESEND_WEBHOOK_SECRET   # the whsec_... value
bun run deploy
```

Jump to [First run](#first-run).

---

## Track B — Cloudflare Email Service

Uses the [Email Service](https://developers.cloudflare.com/email-service/)
Workers binding (`env.EMAIL.send()`) plus Email Routing. The zone must use
**Cloudflare DNS**.

### B1. Enable sending and routing

Dashboard (reliable):

1. [Email Sending](https://dash.cloudflare.com/?to=/:account/email-service/sending) → **Onboard Domain** → your zone. Cloudflare adds `cf-bounce` MX/SPF/DKIM and `_dmarc`.
2. [Email Routing](https://dash.cloudflare.com/?to=/:account/email-service/routing) → **Onboard Domain** on the same zone. Apex MX must point at Cloudflare (`route1.mx.cloudflare.net`, …).

CLI (Wrangler **≥ 4.123**):

```bash
bunx wrangler email sending enable yourdomain.com
bunx wrangler email routing enable yourdomain.com
```

Confirm:

```bash
bunx wrangler email sending list
bunx wrangler email routing settings yourdomain.com
bunx wrangler email sending dns get yourdomain.com
bunx wrangler email routing dns get yourdomain.com
```

Sending should show `enabled: yes`. Routing should show `Enabled: true` and
`Status: ready`.

### B2. Send all inbound mail to this Worker

QuickMail lets users create arbitrary mailboxes (`you@`, `billing@`). Email
Routing only has 200 named rules and does not know about D1, so you need a
**catch-all → Worker**.

The Wrangler catch-all update only accepts `forward` or `drop`. Set the Worker
action in the dashboard:

1. Open [Email Routing](https://dash.cloudflare.com/?to=/:account/email-service/routing) for the domain.
2. Enable **Catch-all**.
3. Action: **Send to a Worker**.
4. Worker: this app (`quickmail`, or whatever `"name"` is in `wrangler.jsonc`).
5. Save.

The dashboard may require one verified personal destination before rules can be
saved. Verify it if asked — do **not** forward production mail there.

A named rule (local-part `you` → Worker) also works for a single address, but
catch-all is what makes “add an address in Settings” work.

### B3. Point the Worker at Cloudflare Email

In `wrangler.jsonc`:

```jsonc
"vars": {
  "EMAIL_PROVIDER": "cloudflare",
  "CLOUDFLARE_MAIL_DOMAINS": "yourdomain.com"
}
```

Comma-separate more domains if you onboard several:
`yourdomain.com,mail.example.com`.

Locally, put the same keys in `.dev.vars` (copy `.dev.vars.example`). `.dev.vars`
overrides `wrangler.jsonc` vars in `vite dev`.

```bash
bun run deploy
```

No Resend key or webhook is used on this track. `vite dev` never runs the
`email()` handler — inbound only works on a **deployed** Worker or
`bun run preview`.

---

## First run

1. Open the deployed URL (or `http://localhost:5173` after `bun run dev`).
2. `/setup` — pick a domain the provider can see, then create the admin (name,
   local-part, password). That address is both the inbox and the login.
3. Later users go through `/onboarding` to claim an address on a connected domain.

Send yourself a message from another account. It should land within a few
seconds (Resend webhook or Cloudflare Routing → Worker).

---

# Development

```bash
cp .dev.vars.example .dev.vars    # fill in the provider you are using
bun install
bun run db:migrate:local
bun run dev                       # D1 and R2 via platformProxy, secrets from .dev.vars
```

```bash
bun run preview   # production build + wrangler dev (needed for Cloudflare inbound)
bun run check     # svelte-check
bun run deploy    # build, wrap the Worker with email(), ship
```

`bun run build` runs SvelteKit, then
`scripts/wrap-cloudflare-worker.mjs`. The adapter writes a fetch-only Worker;
the wrap adds the `email()` handler from `src/worker.ts` without overwriting
that file.

### Testing inbound mail

**Resend.** Webhooks cannot reach `localhost`. Tunnel it:

```bash
cloudflared tunnel --url http://localhost:5173
```

Point a **second, throwaway** webhook at the tunnel. Do not repoint production
or mail stops when the tunnel dies.

**Cloudflare Email.** Use `bun run preview` or a deploy. The catch-all must
target this Worker.

Forgot the admin password:

```bash
bun scripts/reset-admin-password.mjs you@example.com newpassword --local
```

Drop `--local` to reset production.

## How QuickMail routes inbound mail

Both providers accept every local-part on a connected domain. The app then:

1. Exact match in `addresses` → that user.
2. Else the domain's **catch-all owner** (Admin) → that user.
3. Else the row is stored in `unrouted_emails` and listed in Admin.

That in-app catch-all is separate from Cloudflare Email Routing's catch-all.
Routing's catch-all gets the message **into** the Worker. QuickMail's catch-all
decides **which user** sees it.

## Layout

```
src/
  worker.ts          SvelteKit fetch + Cloudflare email() inbound
  routes/            inbox, compose, drafts, settings, admin, setup
  lib/
    components/      sidebar, mailbox, composer, thread view
    server/          providers, inbound, D1, auth
    utils/           HTML, quoting, dates, attachments
scripts/
  setup.sh / setup.mjs   first-run wizard (tools, login, domain, env)
  wrap-cloudflare-worker.mjs   attach email() after the SvelteKit build
migrations/          D1 schema, applied in order
```

## Troubleshooting

**`wrangler email sending enable` → 404.** Wrangler is too old. Use 4.123+ or
onboard under **Compute → Email Service → Email Sending** in the dashboard.

**Catch-all cannot be set to a Worker from the CLI.** Expected.
`wrangler email routing rules update … catch-all` only allows `forward` or
`drop`. Use the dashboard (step B2).

**Mail sends but never arrives (Resend).** `dig MX yourdomain.com` should point
at Resend. Receiving must be enabled on the domain.

**Mail sends but never arrives (Cloudflare).** Apex MX must be Cloudflare
Routing. Catch-all must send to this Worker. `EMAIL_PROVIDER` must be
`cloudflare`. The Worker must be deployed (`vite dev` will not receive).

**Webhook 401.** `RESEND_WEBHOOK_SECRET` does not match. Secrets are shown once
— delete the webhook and create a new one.

**Webhook 500.** `bunx wrangler tail`.

**Attachments missing.** Confirm the R2 bucket exists and `bucket_name` in
`wrangler.jsonc` matches.

**`database_id` errors on deploy.** Paste the id from `wrangler d1 create` into
`wrangler.jsonc`.

**Setup shows no Cloudflare domains.** Set `CLOUDFLARE_MAIL_DOMAINS` (and
`EMAIL_PROVIDER=cloudflare`) in `.dev.vars` or `wrangler.jsonc` vars, then
restart the dev server.

---

MIT licensed — see [LICENSE.md](LICENSE.md). Copyright © 2026 Irasubiza Divin Prince.
