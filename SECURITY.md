# Security and privacy review

Reviewed before moving the site from a Claude artifact to Netlify. No API keys, tokens or passwords were found hard-coded
in the page. The problems were in how data was shared; all are fixed in this version.

| # | Found in the artifact version | Risk | Fixed by |
|---|---|---|---|
| 1 | Staff and B2B password hashes were readable by every visitor | Offline password cracking | Hashes live only on the server; the browser never receives them |
| 2 | Logins, B2B login and "owner password" checks ran in the browser | Anyone could bypass them in dev tools | Server-side login, signed HttpOnly cookies, password re-check for product removal and log clearing, rate limits |
| 3 | Orders (names, phones, emails, addresses) readable by every signed-in visitor, and customers chose their own id | Customer data exposure, impersonation | Customers can only read their own orders (private cookie id); staff need a permission |
| 4 | Payment proofs and complaint photos readable by everyone | Bank details and photos exposed | Staff-only; auto-deleted after 120/180 days |
| 5 | Prices, tax, shipping and B2B/coupon discounts calculated in the browser | Anyone could pay less | The server recalculates every order from its own catalog; client totals are ignored |
| 6 | Whole coupon list readable; built-in codes WELCOME10 / RETRO5K | Free discounts | Coupons are checked one code at a time; only coupons you mark "show hint" are listed; built-in codes removed |
| 7 | Reviews exposed full names, order numbers and visitor ids | Privacy | Public reviews show first name only |
| 8 | Anyone first to open the owner screen on a fresh site could claim the owner account | Site takeover | Setup needs your private `OWNER_SETUP_KEY` and works once |
| 9 | Product names/descriptions printed into the page as raw HTML | Script injection by a mistaken or malicious staff entry | All stored text is escaped before display |
| 10 | Libraries loaded from public CDNs without integrity checks | Supply-chain risk | Installed with npm at build time and served from your own site |
| 11 | Sender address, label and log settings were public | Minor disclosure | Staff-only settings are no longer sent to visitors |
| 12 | Order numbers were guessable | Order lookup by strangers | 10-character random numbers; lookup also needs the WhatsApp number |

Also added: Content-Security-Policy and other security headers (`netlify.toml`), cross-site request blocking, HTTPS-only cookies,
file-type and size checks on uploads (no SVG), stock and variant checks on the server.

## How this was checked
70 automated checks (`npm test`) attack the server directly: forged prices, reading other customers' orders, staff permission limits,
wrong passwords, brute force, forged B2B tier, upload abuse, cross-site posts. A real-browser run covered ordering, payment proof, owner
setup, confirmation, product edit/removal, and confirmed the page shows no Content-Security-Policy violations and exposes no cookies to scripts.

**Not verified from here (no internet or accounts):** the live Netlify deploy, Netlify Blobs, the real Supabase service (the adapter was
tested against a local imitation of its REST API), the PDF label and QR libraries after `npm install`, and Google Fonts. Do a full test order,
a label print and a QR save on the real site after deploying.

## Still your responsibility
* Turn on two-factor sign-in for GitHub, Netlify and Supabase. Use a long unique owner password (10+ characters).
* If the Supabase secret key or `SESSION_SECRET` ever leaks, rotate it in Supabase/Netlify and redeploy.
* The public (publishable/anon) Supabase key is not used by this site. Do not add it to the page.
* Customer data (names, phones, addresses) is personal data. Tell customers how you use it (a short privacy note), keep only what you need,
  and delete a customer's records on request (Supabase Table Editor → `kv`, rows starting `db/orders/…`).
* Google Fonts are fetched from Google, which sees the visitor's IP address. Self-host the fonts if you need to avoid that.
* The page uses inline scripts, so the CSP allows `'unsafe-inline'`; it still blocks outside scripts and data being sent to other sites.
