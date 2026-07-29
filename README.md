# QuickMail

Your own web mail client, running on your own domain, on Cloudflare's edge.
Send and receive real email from `you@yourdomain.com` — inbox, threads,
attachments, rich-text composer, multiple domains, multiple users.

Deploys to Cloudflare Workers. Costs pennies to run.

> **MIT licensed.** Use it, modify it, ship it — commercially or not. See
> [LICENSE.md](LICENSE.md).

## What's in it

- **Real inbound mail** — MX records point at Resend, which forwards to your
  Worker. Nothing is polled.
- **Threaded conversations** — replies group into conversations, quoted history
  collapses.
- **Attachments** — inbound files stream into R2; outbound files upload from the
  composer.
- **Safe HTML rendering** — received HTML renders in a sandboxed iframe, so a
  hostile email can't touch your session.
- **Multiple domains** — connect every domain your Resend key can reach and filter
  between them, or view them combined.
- **Multiple users** — each has their own addresses across domains and a default
  sending identity. Admins get a catch-all and an unrouted-mail view.
- **Delivery status** — sent mail shows delivered / bounced / complained, live from
  webhooks.
- **Light and dark themes.**

## Stack

| Layer | Choice |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes) |
| Styling | Tailwind CSS 4 |
| Runtime | Cloudflare Workers (`fetch` handler only) |
| Database | D1 |
| File storage | R2 |
| Email in/out | Resend |
| Auth | Session cookies, PBKDF2 password hashing, no third-party auth service |

No paid dependencies beyond Resend and Cloudflare, both of which have usable free
tiers.

## How it works

| Concern | How |
|---|---|
| Outbound | `POST https://api.resend.com/emails` with an `Idempotency-Key` |
| Inbound | Resend webhook → `POST /api/webhooks/resend` (`email.received`) |
| Delivery status | Same webhook (`email.delivered`, `email.bounced`, …) updates the Sent list |
| Webhook auth | Standard Webhooks / Svix HMAC-SHA256 over the raw body |
| Storage | D1 (users, addresses, domains, mail) + R2 (attachments) |

Webhook payloads carry **metadata only**, so on `email.received` the app fetches
`GET /emails/receiving/{id}` for the body and
`GET /emails/receiving/{id}/attachments` for the files, then streams each
`download_url` into R2.

---

# Setup

You need: a domain you control, a [Cloudflare](https://dash.cloudflare.com) account,
and a [Resend](https://resend.com) account. Budget about 30 minutes, most of it
waiting for DNS.

## 1. Install

```bash
bun install          # or: npm install
bunx wrangler login
```

## 2. Verify your domain in Resend

In the Resend dashboard, **Domains → Add Domain**. Resend gives you a set of DNS
records — add them at your DNS provider and wait for verification.

You need all of these:

| Record | Purpose |
|---|---|
| `TXT` on `resend._domainkey` | DKIM signing |
| `TXT` + `MX` on `send` | SPF and bounce handling |
| **`MX` on the apex** | **Receiving — without this, no mail ever arrives** |

Add a DMARC policy too, on `_dmarc`:

```txt
v=DMARC1; p=none; rua=mailto:you@yourdomain.com; pct=100; adkim=s; aspf=s
```

Start at `p=none` while testing, then tighten to `p=quarantine`.

Enable **both sending and receiving** for the domain in Resend. Then create an API
key (**API Keys → Create**) with full access.

## 3. Create the Cloudflare resources

```bash
bunx wrangler d1 create quickmail
bunx wrangler r2 bucket create quickmail-attachments
```

The `d1 create` command prints a `database_id`. Open `wrangler.jsonc` and replace
`REPLACE_WITH_YOUR_D1_DATABASE_ID` with it.

While you're in `wrangler.jsonc`, set `"name"` to whatever you want your Worker
called. To serve from your own domain, uncomment the `routes` block and set the
pattern — the zone must be on the same Cloudflare account.

Then run the migrations and set the API key:

```bash
bun run db:migrate:remote
bunx wrangler secret put RESEND_API_KEY     # paste your re_... key
```

## 4. Deploy, then wire the webhook

The webhook endpoint has to be publicly reachable, so deploy first:

```bash
bun run deploy
```

Note the URL it prints. Now create the webhook — Resend dashboard →
[resend.com/webhooks](https://resend.com/webhooks) → **Add Webhook**:

- **URL** — `https://<your-worker-url>/api/webhooks/resend`
- **Events** — `email.received`, `email.sent`, `email.delivered`, `email.bounced`,
  `email.complained`, `email.delivery_delayed`, `email.failed`

Or from the terminal:

```bash
curl -X POST https://api.resend.com/webhooks \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://<your-worker-url>/api/webhooks/resend",
       "events":["email.received","email.sent","email.delivered","email.bounced","email.complained","email.delivery_delayed","email.failed"]}'
```

The response contains `signing_secret` — **shown once**. Save it:

```bash
bunx wrangler secret put RESEND_WEBHOOK_SECRET   # the whsec_... value
bun run deploy                                   # redeploy so it picks up both secrets
```

## 5. First run

1. Open your deployed URL. `/setup` asks you to create the admin account — name,
   login email, password.
2. `/onboarding` lists every domain your Resend key can reach, with verification
   status. Pick the ones you want.
3. Claim your address (`you@yourdomain.com`).

Send yourself an email from another account. It should land in the inbox within a
few seconds.

---

# Development

```bash
cp .dev.vars.example .dev.vars    # then fill in the two values
bun install
bun run db:migrate:local
bun run dev                       # D1 and R2 via platformProxy, secrets from .dev.vars
```

Other commands:

```bash
bun run preview   # production build, served by wrangler dev
bun run check     # svelte-check
bun run deploy    # build and ship
```

Webhooks can't reach `localhost`. To test inbound mail locally, tunnel it:

```bash
cloudflared tunnel --url http://localhost:5173
```

then point a **second, throwaway** Resend webhook at the tunnel URL. Don't repoint
your production webhook — you'll stop receiving mail when the tunnel dies.

Forgot the admin password:

```bash
bun scripts/reset-admin-password.mjs you@example.com newpassword --local
```

Drop `--local` to reset it in production.

## Layout

```
src/
  routes/            inbox, compose, drafts, settings, admin, setup
  lib/
    components/      Svelte UI — sidebar, mailbox, composer, thread view
    server/          Resend client, webhook verification, D1 queries, auth, crypto
    utils/           HTML sanitising, quoting, dates, attachments
migrations/          D1 schema, applied in order
```

## Inbound routing

Resend delivers mail for *every* address on a connected domain, so QuickMail routes
it in three steps:

1. Exact match in the `addresses` table → that user.
2. Otherwise, the domain's **catch-all** owner, set in Admin → that user.
3. Otherwise it's held in `unrouted_emails` and listed in Admin, so nothing is lost.

## Troubleshooting

**Mail sends but never arrives.** Check the apex `MX` record — it's the one people
miss. `dig MX yourdomain.com` should point at Resend. Confirm receiving is enabled
for the domain in the Resend dashboard.

**Webhook returns 401.** `RESEND_WEBHOOK_SECRET` doesn't match the webhook that's
calling you. Secrets are shown once at creation — if you lost it, delete the webhook
and make a new one.

**Webhook returns 500.** `bunx wrangler tail` shows live logs.

**Attachments don't appear.** Confirm the R2 bucket exists and the `bucket_name` in
`wrangler.jsonc` matches it.

**`database_id` errors on deploy.** You didn't replace the placeholder in
`wrangler.jsonc` with the id from `wrangler d1 create`.

---

MIT licensed — see [LICENSE.md](LICENSE.md). Copyright © 2026 Irasubiza Divin Prince.
