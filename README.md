# Safety Training Matrix Management App

A custom-built replacement for the Glide-based Training Matrix, covering the full spec: a
Master Training Catalog (52 trainings, expandable without a schema rebuild), multi-client/
employee management, per-client requirement overrides with effective dates, a six-status
compliance engine (Current / Expired / Missing / Not Applicable / No Expiration / Pending
Review), a full training matrix + dashboard + detail pages, a Reports screen (Client
Compliance, Employee Training, Training Compliance, Expiring Soon, Client Exceptions), and a
guided CSV import flow that maps messy client spreadsheets onto the standardized catalog
without guessing, discarding source data, or silently overwriting a duplicate record.

Training Sign-In is intentionally out of scope for this build - this app covers the
Matrix side only, per your instructions.

## What's inside

```
training-matrix/
  server/           Express API + SQLite database (better-sqlite3)
    migrations/     Schema (runs automatically on startup)
    seed/           Master Training Catalog (52 trainings) + terminology alias dictionary
    lib/            Status calculation engine + shared data access - single source of truth
    routes/         REST API endpoints
  client/           React (Vite) frontend
    src/pages/      Dashboard, Training Matrix, Employee Detail, Training Detail,
                    Client Settings, Master Trainings, Import, Reports, Manage Users
  data/             SQLite database file lives here (created on first run)
```

## Running it locally

Requires Node.js 18+ (tested on Node 22).

```bash
# 1. Install server dependencies (from the project root)
npm install

# 2. Seed the Master Training Catalog (52 trainings + alias dictionary) - run once.
#    (The server also auto-seeds itself on first boot if this step is skipped -
#    handy for cloud deploys where you can't easily run a one-off command.)
npm run seed

# 3. Build the frontend
cd client
npm install
npm run build
cd ..

# 4. Start the app (serves the API and the built frontend on one port)
npm start
```

Then open **http://localhost:4000** in a browser.

For frontend development with hot reload instead of a static build, run `npm run dev`
inside `client/` (it proxies API calls to the server on port 4000) while `npm start` runs
the server in another terminal.

## Deploying it so your team can use it

**Deploying to Render (render.com).** One thing to know going in: Render's *free* web
service tier does not support persistent disks - any local SQLite file would be wiped every
time the service restarts or redeploys, silently losing your data. You'll need Render's
**Starter** plan (about $7/month) plus a small persistent disk (~$0.25/month) to keep the
database intact across deploys. A full click-by-click walkthrough (including creating your
GitHub and Render accounts from scratch) is provided separately in `GETTING-LIVE.md`, since
you're starting without either. (Railway was the other option discussed, with a cheaper
trial-then-~$5/month path if you'd rather revisit that.)

Quick reference once you have accounts set up:
- Build command: `npm install && cd client && npm install && npm run build && cd ..`
- Start command: `npm start`
- Instance type: **Starter** or higher (not Free - Free can't hold persistent data).
- Add a persistent disk (e.g. mounted at `/opt/render/project/src/data`), and set the
  environment variable `DATA_DIR` to that same path, so the SQLite database survives
  restarts and redeploys.
- Set `APP_USERNAME` and `APP_PASSWORD` (see "Restricting access" below) so there's an
  initial account to log in with - after that, accounts are managed from the in-app
  "Manage Users" screen.
- No manual seed step needed - the app auto-populates the Master Training Catalog on first
  boot if it's empty.

If you'd rather run this on your own server or a Windows/Mac machine on your network
instead of a public host, the "Running it locally" steps above are all you need - just
make sure port 4000 (or whatever you set `PORT` to) is reachable by whoever needs it.

## Restricting access

The app has a real login screen backed by per-user accounts (stored in the same SQLite
database as everything else, passwords hashed - never stored in plain text). On first boot,
if no accounts exist yet, one is created automatically from the `APP_USERNAME`/`APP_PASSWORD`
environment variables (or `admin` + a random generated password, logged to the server console,
if those aren't set). From then on, log in and use the **Manage Users** screen in the app
to add teammates, reset passwords, or remove access - `APP_USERNAME`/`APP_PASSWORD` are only
ever read once, to create that first account.

Sessions are a signed cookie (7-day expiry), not stored server-side, so restarts don't log
everyone out. The app always keeps at least one account - the last remaining login can't be
deleted, so no one can accidentally lock everyone out.

## Key design decisions worth knowing about

- **Status is always computed, never hand-entered.** `server/lib/statusEngine.js` is the
  single place that decides Current/Expired/Missing/Not Applicable/No Expiration/Pending
  Review. The Matrix, Dashboard, Employee Detail, and Training Detail pages all call the
  same function, so they can't drift out of sync with each other.
- **Expiration resolves in this order**: an individual record's own explicit expiration
  date, then a client-specific override, then the Master Training Catalog's default, then
  "no expiration" if the catalog says None.
- **Changing a client's override never rewrites history.** Client Training Settings has an
  Effective Date; a record completed before that date keeps whatever expiration it was
  already given, even after the override changes. Only records completed on/after the
  effective date pick up the new rule. This is enforced in `statusEngine.resolveExpiration`
  itself (the single source of truth), not just at write time, since status is computed live
  on every read.
- **Nothing from a source import is discarded.** Original client wording, raw YES/NO/N/A
  values, and unmapped/ambiguous columns are all preserved and either mapped to the correct
  Training ID or queued for manual review - never silently guessed at or dropped.
- **Duplicate records are flagged, never deleted.** If an employee already has a record for a
  training and another one comes in (import or manual entry), both are kept and marked
  "flagged" for review; an authorized user picks which one is active from the Employee Detail
  page or the Client Exceptions report.
- **The Master Training Catalog can grow.** The Master Trainings admin page (and
  `POST /api/master-trainings` underneath it) adds a new training without any schema changes,
  so the catalog isn't locked to exactly 52 entries.

## One thing to double check with the catalog

TRN-012 (First Aid / CPR / AED) was missing from the categorized expiration table in the
build prompt - it jumped from TRN-011 straight to TRN-013. It's seeded here as
Medical/Emergency - Training - 2 Years, based on the earlier ChatGPT spec, which also uses
it as the explicit example for client-specific expiration overrides. Worth a quick glance
in Client Settings to confirm that's right for your clients.

## Known gaps / next steps

- Accounts are all equal - there's no separate "admin" role. Anyone who can log in can also
  add/remove other accounts from Manage Users. Fine for a small trusted team; worth adding
  role-based permissions if this grows.
- CSV import expects one row per employee with training columns across the top. If your
  client spreadsheets are shaped differently (e.g. one row per training completion), the
  import flow would need adjusting.
- PDF export wasn't built - Reports offers CSV export on the report tables that support it.
- Training Sign-In integration is not part of this build, per your instruction to hold off.
- A few fields from an earlier UI-mockup pass (client industry, employee work location/
  safety clearance/last audit date, training record certificate ID/verified by/accredited
  provider, and evidence file upload) were intentionally left out of this update to match
  your master prompt exactly. None of that data existed anywhere live, so nothing was lost -
  they're easy to re-add later if you still want them.
