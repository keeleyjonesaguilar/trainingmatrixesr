# Safety Training Matrix Management App

A custom-built replacement for the Glide-based Training Matrix, covering the full spec: a
Master Training Catalog (52 trainings), multi-client/employee management, per-client
requirement overrides, a six-status compliance engine (Current / Expired / Missing /
Not Applicable / No Expiration / Pending Review), a full training matrix + dashboard +
detail pages, and a guided CSV import flow that maps messy client spreadsheets onto the
standardized catalog without guessing or discarding source data.

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
                    Client Settings, Import
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
- Set `APP_USERNAME` and `APP_PASSWORD` (see "Restricting access" below) so the public URL
  isn't wide open.
- No manual seed step needed - the app auto-populates the Master Training Catalog on first
  boot if it's empty.

If you'd rather run this on your own server or a Windows/Mac machine on your network
instead of a public host, the "Running it locally" steps above are all you need - just
make sure port 4000 (or whatever you set `PORT` to) is reachable by whoever needs it.

## Restricting access

There's no per-user login system (by design, for this first version), but since this holds
employee compliance data and will be on a public URL, the server supports a simple
shared-password gate: set both `APP_USERNAME` and `APP_PASSWORD` as environment variables and
every request (browser and API alike) will require them via a standard browser login prompt
(HTTP Basic Auth). Leave both unset - as they are for local development - and the app opens
with no prompt at all. Share one username/password with your team rather than posting it
publicly; this is a basic gate, not a substitute for real per-user accounts if that becomes
a requirement later.

## Key design decisions worth knowing about

- **Status is always computed, never hand-entered.** `server/lib/statusEngine.js` is the
  single place that decides Current/Expired/Missing/Not Applicable/No Expiration/Pending
  Review. The Matrix, Dashboard, Employee Detail, and Training Detail pages all call the
  same function, so they can't drift out of sync with each other.
- **Expiration resolves in this order**: an individual record's own explicit expiration
  date, then a client-specific override, then the Master Training Catalog's default, then
  "no expiration" if the catalog says None.
- **Nothing from a source import is discarded.** Original client wording, raw YES/NO/N/A
  values, and unmapped/ambiguous columns are all preserved and either mapped to the correct
  Training ID or queued for manual review - never silently guessed at or dropped.
- **The Master Training Catalog can grow.** `POST /api/master-trainings` adds a new training
  without any schema changes, so the catalog isn't locked to exactly 52 entries.

## One thing to double check with the catalog

TRN-012 (First Aid / CPR / AED) was missing from the categorized expiration table in the
build prompt - it jumped from TRN-011 straight to TRN-013. It's seeded here as
Medical/Emergency - Training - 2 Years, based on the earlier ChatGPT spec, which also uses
it as the explicit example for client-specific expiration overrides. Worth a quick glance
in Client Settings to confirm that's right for your clients.

## Known gaps / next steps

- No per-user authentication - just the optional shared-password gate described above. Fine
  for a small team on a private link; worth adding real individual logins if this grows.
- CSV import expects one row per employee with training columns across the top. If your
  client spreadsheets are shaped differently (e.g. one row per training completion), the
  import flow would need adjusting.
- PDF export wasn't built (CSV wasn't requested either, since this build prompt didn't ask
  for export at all) - only the on-screen Matrix, Dashboard, and detail pages exist.
- Training Sign-In integration is not part of this build, per your instruction to hold off.
