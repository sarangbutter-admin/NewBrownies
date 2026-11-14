# Sarang Butter – online ordering site (Netlify + Supabase)

A full ordering site: shop, checkout, payment proof, order tracking, reviews, complaints, B2B login and an owner/staff back office.

```
Customer's phone ──► Netlify (website + server code in /netlify/functions) ──► Supabase (database + file storage)
                                   ▲
                      the ONLY place that holds passwords, keys and the rules
```
The browser never talks to the database directly and never sees a secret key. The server checks every action
(who you are, what you may read, and it recalculates every price itself).

Supabase can't host a website, so you still need Netlify (or similar) for the site. Supabase = database + files.

---------------------------------------------------------------------------------------------------

## What I can't do for you, and what you do (about 15 minutes)

An AI chat can't log in to your Supabase, Netlify or GitHub accounts. You do these steps once; after that every
`git push` redeploys the site automatically.

### 1. Supabase (the database)
1. supabase.com → **New project** (any region near your customers, set a strong database password and save it).
2. **SQL Editor → New query** → paste everything from `supabase/migrations/0001_init.sql` → **Run**.
   This creates the `kv` table and a private `media` bucket, and locks both so the public key can read nothing.
3. **Project Settings → API Keys**: copy the **Project URL** and the **secret** key
   (older projects call it the `service_role` key). Keep them private: never paste them in chat, git, or the website.

### 2. GitHub
Push this folder to your repository (`git push -u origin main`). `.gitignore` already keeps secrets out.

### 3. Netlify (the website + server)
1. **Add new site → Import an existing project → GitHub →** pick the repository. Build settings come from `netlify.toml`.
2. **Site configuration → Environment variables**, add these four:

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL from step 1.3 |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key from step 1.3 |
| `SESSION_SECRET` | 32+ random characters. Make one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OWNER_SETUP_KEY` | any long private phrase (12+ characters), used once to create your owner account |

   (If you skip the two Supabase variables the site automatically uses Netlify Blobs instead, with nothing to configure.)
3. **Deploys → Trigger deploy.** Wait for "Published".

### 4. First login
Open `https://YOUR-SITE.netlify.app/admin` (the staff address; the customer shop has no link, button or hidden tap that leads there, so keep this address to yourself and your team). Enter your `OWNER_SETUP_KEY`, choose your
owner username and a password of 10+ characters. Then: **Payment** (bank details + QR), **Shop settings**
(shipping, tax, time slots), **Products**, **Landing page**. Place a test order from your phone before announcing the site.
After the owner account exists, the setup key stops working.

---------------------------------------------------------------------------------------------------

## Good to know
* **Passwords** live only on the server (PBKDF2, salted). Staff and B2B logins are checked by the server and kept in
  HttpOnly cookies that page scripts cannot read. Wrong passwords are rate-limited.
* **Orders belong to the phone/browser that placed them** (a private cookie). Customers who switch devices use
  *My orders → Find my order* (order number + their WhatsApp number).
* **Notifications** (WhatsApp / email) open ready-to-send messages for you to tap. No messaging API key is needed.
  Fully automatic sending would need a provider (e.g. WhatsApp Business API, Resend) and its key set as another Netlify variable.
* **Payments are manual** (bank transfer / QR + proof upload, you confirm). There is no payment-gateway key anywhere.
* **Live updates** work by checking every 8–10 seconds while a tab is open (paused when hidden). Netlify's free plan
  includes 125,000 function calls a month; an owner dashboard left open all day uses ~9,000 a day, so use a paid plan if
  staff keep it open, or raise the interval in `public/shim.js`.
* **Uploads** are limited to 4.5 MB per file (a Netlify function limit): photos are fine; keep videos short or compress them.
* **Cleanup** runs automatically: unpaid orders cancel after the payment deadline; activity logs follow your retention
  setting; payment proofs are deleted after 120 days and complaint photos after 180 days.
* **Backups:** Supabase → Database → Backups (daily on paid plans). On the free plan, export the `kv` table
  (Table Editor → Export) now and then.
* **Scale:** the `kv` table is simple and fine for a small shop (thousands of orders). For heavy traffic or reporting,
  move orders to proper tables.

## Run it on your computer
```
npm install
npm test        # 70 automatic security and ordering checks (local files, no accounts needed)
npm run dev     # http://localhost:8888  (owner setup key: dev-setup-key-123456)
```
`npm test` also runs against a local imitation of the Supabase API via `node dev/run-supabase-mock-test.mjs`.

## Files
* `public/index.html` – the whole shop and back office (one file). `public/shim.js` – connects it to `/api`.
* `netlify/functions/core.mjs` – all server rules. `app.mjs` – picks Supabase or Netlify Blobs; `api.mjs` and `blob.mjs` – Netlify entries with per-visitor rate limits.
* `supabase/migrations/0001_init.sql` – database setup. `netlify.toml` – build + security headers.
* `.env.example` – the variables to set in Netlify (never commit real values).

