# HoodPro

A field service app for kitchen exhaust & hood cleaning businesses, modeled on ServiceTrade's workflow: recurring service scheduling, crew assignment, before/after photos, NFPA-96-style service checklists, auto-generated service reports, invoicing, and a customer-facing portal with online payment.

Built with zero external dependencies — just Node.js's built-in `http` server and `node:sqlite` database. Nothing to `npm install`, nothing to break.

## Requirements

- Node.js **22.5 or newer** (uses the built-in `node:sqlite` module). Check with `node -v`.

## Running it

```
cd hoodpro-app
node server.js
```

Open **http://localhost:3000**. First run creates the database automatically at `data/hoodpro.db` and seeds:

- 4 crews: Team 1–4 (matching your 8 employees in teams of 2)
- 1 admin login: **admin@example.com / changeme123**
- 1 demo customer ("Main Street Diner") with a location, a quarterly recurring agreement, and a scheduled job, so you can click around immediately.

**Change the admin password** by adding a new admin user in Settings and retiring the demo one (there's no in-app password-change screen yet — see "What's not built yet" below).

## How the workflow works

1. **Customers → New Customer** — add the restaurant/business, then add its kitchen location(s) and a recurring service agreement (frequency: monthly/quarterly/semi-annual/annual, plus price). Creating the agreement auto-schedules the first job.
2. **Jobs** — see everything scheduled, filter by crew or status. A tech opens a job and hits **Clock In** — this also flips the job to "in progress" — then works through the NFPA-96-style checklist, adds notes, and takes before/after photos right from their phone's camera (see below).
3. **Clock In / Clock Out** — each tech clocks in and out independently under their own login, so a 2-person crew logs two separate time entries per job. The job page shows a running log of who worked when and for how long. Marking the job complete auto-clocks-out anyone still clocked in, so nobody has to remember.
4. **Photos from the field** — the photo upload button uses `capture="environment"`, the standard way mobile browsers open the camera directly instead of the photo gallery. On a phone, tapping it takes a picture on the spot; on a desktop it falls back to a normal file picker.
5. **Complete Job** — marking a job done automatically advances the agreement's next-due date by its frequency and schedules the next job. This is the "recurring" engine — no manual rebooking.
6. **Generate Invoice** — from a completed job, one click creates an invoice from the agreement price.
7. **Customer Portal** — every customer gets a unique link (shown on their Customers page) with no login required: `/portal/<token>`. They can view service reports with photos, and pay invoices.
8. **Send Report / Send Invoice** — from a completed job or an invoice, staff can send the customer a text or email with a link straight to that report or invoice on their portal. See "Email and text messaging" below for what's real vs. demo.

## Payments — read this before going live

The portal has working **Pay by Card / PayPal / Venmo** buttons, but out of the box they run in **demo mode**: clicking Pay records the payment and marks the invoice paid instantly, with no real money moving. This is intentional — I don't have your merchant credentials, and wiring up fake ones would be worse than being upfront about it.

To accept real payments:

**Cards, via Stripe**
1. Create a [Stripe](https://stripe.com) account and grab your live Secret and Publishable keys.
2. Paste them into **Settings → Payment Integration Keys** in the app.
3. In `server.js`, the `pay/card` route (search for `payMatch`) currently just marks the invoice paid — replace that block with a real [Stripe Checkout Session](https://docs.stripe.com/checkout/quickstart) creation (a plain HTTPS POST to `api.stripe.com/v1/checkout/sessions` works fine, no SDK needed) and redirect the customer there. Mark the invoice paid from Stripe's webhook, not immediately, so you're not trusting the browser.

**PayPal and Venmo**
1. Create a PayPal Business account and a [REST app](https://developer.paypal.com) to get a Client ID and Secret.
2. Paste them into Settings. The PayPal JS SDK (loaded with `enable-funding=venmo`) is the standard way to offer both PayPal and Venmo as buttons to US customers from one integration — Venmo is not a separate product to wire up.
3. Replace the `pay/paypal` and `pay/venmo` route logic with a real PayPal Orders API create + capture call, and only mark the invoice paid after a successful capture response.

I did not fabricate a payment integration with placeholder keys because a "working" checkout that silently isn't charging anyone is more dangerous than an honest demo mode. The button UI, routes, and data model (a `payments` table logging method/amount/transaction ref) are all in place — the remaining work is strictly the two API calls above plus a webhook endpoint, which takes about an hour once you have real Stripe/PayPal accounts.

## Email and text messaging — read this before relying on it

Same honesty policy as payments: the **Email Report / Text Report** and **Email Invoice / Text Invoice** buttons work end to end, but run in **demo mode** until you add real credentials — the message gets logged (visible right on the job/invoice page: who it went to, when, and whether it was demo or real) but nothing is actually delivered to the customer.

To send for real:

**Email, via SendGrid**
1. Create a [SendGrid](https://sendgrid.com) account, verify a sender email, and generate an API key.
2. Paste the API key and verified from-address into **Settings → Email & Text Notifications**.
3. That's it — `lib/notify.js` already calls SendGrid's REST API directly over HTTPS (`POST api.sendgrid.com/v3/mail/send`), no SDK required. Emails will start sending the moment both fields are filled in.

**Text messages, via Twilio**
1. Create a [Twilio](https://twilio.com) account and buy a phone number capable of SMS.
2. Paste your Account SID, Auth Token, and the Twilio phone number into Settings.
3. Same story — `lib/notify.js` calls Twilio's REST API directly (`POST api.twilio.com/.../Messages.json`). No SDK, texts start working immediately once configured.

Also set **Settings → Business Info → Public Web Address** once you've deployed (see below) so the links inside these emails/texts point at your real domain instead of `localhost`.

## QuickBooks Online — import customers, export invoices and payments

This is a real, working integration against QuickBooks Online's API — not a placeholder. It imports your existing customer list, and pushes every invoice you generate (plus the payment once it's marked paid) straight into your books. Two things to know going in:

- It's **QuickBooks Online only**. QuickBooks Desktop doesn't have a live API — it works via importing/exporting files, which is a fundamentally different mechanism and isn't what's built here.
- Connecting it requires your own free Intuit Developer app (below). I can't create that for you — Intuit ties it to your QuickBooks company for security.

**Setup (about 10 minutes):**
1. Go to [developer.intuit.com](https://developer.intuit.com), sign in with your QuickBooks Online login, and create an app (choose "QuickBooks Online and Payments").
2. In the app's settings, find your **Client ID** and **Client Secret** (there's a separate pair for Sandbox and Production — start with Sandbox to test safely against fake data before touching your real company).
3. Under Redirect URIs, add exactly: `http://localhost:3000/integrations/quickbooks/callback` for local testing, or `https://your-domain.com/integrations/quickbooks/callback` once deployed. It must match character-for-character what you enter in the app.
4. In HoodPro, go to **Settings → QuickBooks Online**, paste in the Client ID, Client Secret, and matching Redirect URI, pick Sandbox or Production, and save.
5. Click **Connect to QuickBooks** — you'll be sent to Intuit to log in and authorize, then bounced back here connected.
6. Click **Import Customers Now** to pull your existing customer list in. Click **Sync to QuickBooks** on any invoice to push it (and its payment, once paid) over.

Under the hood (`lib/quickbooks.js` and the QuickBooks section of `server.js`): the OAuth2 authorization-code flow, token refresh, and every Accounting API call (customer, item, invoice, payment) are plain HTTPS requests — no SDK. I tested the full flow — connect, callback, customer import, invoice creation, and payment linking — against a mocked QuickBooks API standing in for Intuit's real servers, since this sandbox can't reach the internet freely. The request/response shapes follow Intuit's documented API exactly, but since I couldn't test against your actual company data, do a first run in Sandbox before flipping to Production.

## Deploying so customers can actually reach it

Right now this only runs on your machine. To get a real link you can text/email to customers, deploy it to a host with persistent disk, for example:
- **Railway** or **Render**: connect this folder as a repo, set the start command to `node server.js`, done.
- Any VPS (DigitalOcean, Linode, etc.): install Node 22+, run with a process manager like `pm2`, put it behind Caddy or nginx for HTTPS.

Photos and the SQLite database are stored on local disk (`uploads/` and `data/`) — make sure your host has a persistent volume, not ephemeral storage, or photos/data will vanish on redeploy.

## What's built

- Staff login (admin/tech roles), 4 crews seeded for your teams
- Customer, location, and recurring service-agreement management
- Auto-recurring job scheduling (completing a job schedules the next one)
- Job workflow: clock in → NFPA-96-style checklist → in-app camera photo capture (before/after/deficiency) → clock out → complete
- Per-tech time tracking (clock in/out log with duration per job — useful for payroll on 2-person crews)
- Auto-generated service reports (viewable by staff and customers)
- Invoice generation from completed jobs, with tax rate setting
- Customer portal via unique shareable link: overview, service reports with photos, invoices
- Payment buttons for card/PayPal/Venmo (demo mode until you add real API keys — see above)
- Email and text sending of reports/invoices to customers, with a sent-message log (demo mode until you add SendGrid/Twilio credentials — see above)
- QuickBooks Online integration: import customers, export invoices and payments (real OAuth2 + API integration — see above)
- Proposals: a dedicated tab for techs to capture site-survey details on a prospective or existing job — hood count, filter count, hood length, vertical/horizontal duct work length, access panel count, building stories, exhaust fan type (dropdown of common kitchen exhaust fan types) plus notes, water access, security access notes, alarm code, and lock box/key access — with draft/sent/won/lost status tracking
- Dashboard: upcoming/overdue jobs, outstanding invoices, weekly job count

## What's not built yet (known gaps)

- Real payment processing (see above — this needs your merchant accounts)
- Real email/SMS delivery (see above — this needs your SendGrid/Twilio accounts)
- QuickBooks Desktop support (Online only — see above)
- In-app password reset / change
- A calendar/drag-and-drop scheduling view (jobs are a filterable list today)
- Multi-location tax rates, discounts, or partial payments
- File size/type validation on photo uploads beyond the 25MB request cap
- Automated tests

## Project structure

```
server.js        - HTTP server, routing, all request handlers
db.js             - SQLite schema + demo data seeding
lib/
  auth.js         - password hashing (scrypt), token generation
  session.js      - cookie-based session store
  multipart.js    - hand-rolled multipart/form-data parser (for photo uploads)
  notify.js       - email (SendGrid) + SMS (Twilio) sending over plain HTTPS, no SDK
  quickbooks.js   - QuickBooks Online OAuth2 + Accounting API calls over plain HTTPS, no SDK
  layout.js       - shared HTML chrome + formatting helpers
views/            - HTML-generating functions, one file per section
  proposals.js    - Proposals tab: site-survey form, list, detail, edit
public/style.css  - all styling
uploads/          - uploaded job photos (created at runtime)
data/             - SQLite database file (created at runtime)
```

No build step, no framework, no bundler — every file is plain readable JavaScript, so you (or a developer you hire) can find and change anything without learning a stack first.
