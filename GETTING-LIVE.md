# Getting the Training Matrix app live for your team (Render)

This walks through everything from "no accounts yet" to a real link your team can open.
No command line or coding knowledge needed — just clicking through two websites.

Total time: roughly 20-30 minutes the first time.

One cost note up front: Render's **free** tier doesn't support the persistent storage this
app needs (a free-tier app there would lose all your data every time it restarts). You'll
need Render's **Starter** plan, which is about **$7/month**, plus roughly $0.25/month for
the small amount of disk storage this app uses (for certificate/roster PDFs), plus the
separate Postgres database cost (Training-Matrix-db) shown on its own page in your Render
dashboard. If you'd rather avoid that and use a free trial period instead, Railway was the
other option we discussed — happy to switch this guide back if you change your mind.
Otherwise, here's Render:

---

## Part 1: Create a GitHub account (free)

GitHub is just a place to store your project's code so a hosting service can find it.

1. Go to **github.com** and click **Sign up**.
2. Enter your email (k.jones@evolutionsafetyresources.com works fine, or any email you check), create a password, and pick a username.
3. Verify your email when GitHub sends the confirmation link.
4. You can skip any "personalize" or "team" questions it asks afterward — just get to your account dashboard.

## Part 2: Create a repository and upload the code

A "repository" (repo) is just a project folder on GitHub.

1. Click the **+** icon top-right → **New repository**.
2. Name it something like `training-matrix-app`. Leave it **Private**. Don't check any of the "initialize with README" boxes.
3. Click **Create repository**.
4. On the next page, look for a link that says **"uploading an existing file"** (GitHub shows this on a brand-new empty repo).
5. Unzip the `training-matrix-app.zip` file I sent you on your computer first, so you have a regular folder.
6. Drag the **contents** of that unzipped folder (not the folder itself — select everything inside it) into the GitHub upload box. This may take a minute depending on your connection.
7. Scroll down, add a short commit message like "Initial upload," and click **Commit changes**.

Your code is now on GitHub. You won't need to touch GitHub again unless you want to make future code changes.

## Part 3: Create a Render account and start a new Web Service

1. Go to **render.com** and click **Get Started**, then sign up with your GitHub account (simplest — skips creating a separate password).
2. Approve the permission request so Render can see your repositories.
3. On your Render dashboard, click **New** → **Web Service**.
4. Connect and select the `training-matrix-app` repo you just created.
5. Fill in the service details:
   - **Name**: whatever you like — it becomes part of your web address (e.g. `training-matrix` → `training-matrix.onrender.com`)
   - **Region**: pick whichever is closest to you/your team
   - **Branch**: leave as the default
   - **Build Command**: `npm install && cd client && npm install && npm run build && cd ..`
   - **Start Command**: `npm start`
6. Under **Instance Type**, choose **Starter** (not Free — Free can't hold persistent data, see the note at the top).

Don't click Create Web Service yet — the next two parts add settings on this same page.

## Part 4: Add persistent storage and connect the database

The app's data (clients, employees, training records) lives in a Postgres database
("Training-Matrix-db"), not on this service's disk - but the disk is still needed for
certificate/roster PDF files, which are still written to disk and just referenced from the
database by file path.

1. Still on the service setup page, click **Advanced**.
2. Look for **Add Disk**. Set:
   - **Mount Path**: `/opt/render/project/src/data`
   - **Size**: 1 GB is far more than this app needs.
3. Also in Advanced, add an environment variable:
   - `DATA_DIR` = `/opt/render/project/src/data` (same path as the disk above)
   - `DATABASE_URL` = the **Internal Database URL** of the Training-Matrix-db Postgres instance
     (Render dashboard -> Training-Matrix-db -> Connections -> Internal Database URL - internal
     because this web service and the database both live on Render, which is faster and free of
     extra data-transfer cost compared to the External URL).

## Part 5: Set your first login

This keeps the app from being wide open to anyone who finds the link, since it holds employee compliance data.

In the same **Advanced** section, add two more environment variables:
- `APP_USERNAME` = pick something simple, e.g. `advanceconcrete`
- `APP_PASSWORD` = pick a real password

These only create your *first* account. Once the app is live, log in with them and go to
**Manage Users** in the app itself to add an account for each teammate (and you can change
or remove the initial one from there too).

One more environment variable, for Training Sign-In's QR codes: add `PUBLIC_APP_URL` set to
this service's real address (you won't know it until Part 6 gives you the URL - come back
and add it once you do, then trigger a manual redeploy so it takes effect).

## Part 6: Create and get your link

1. Click **Create Web Service**. Render will build and start the app — this takes a few minutes the first time.
2. Watch the build log on screen; when it says the service is live, your URL is shown at the top of the page, something like `https://training-matrix.onrender.com`.
3. Open that link. You'll see a branded sign-in screen — log in with the username/password from Part 5, then the app loads.

The Master Training Catalog (all 52 trainings) populates itself automatically the first time the app starts — no extra step needed.

## Ongoing cost

Roughly $7-8/month total (Starter plan + a sliver for disk storage), billed to whatever
payment method you add on Render. There's no long lock-in — you can pause or delete the
service any time from the Render dashboard if you stop needing it.

## Future updates

Render auto-deploys any time new code is pushed to the connected GitHub repo — same as
we discussed for Railway. When I make a future change, you'd upload the changed file(s) (or
the whole folder again) to the same GitHub repo the same way you did in Part 2, and Render
picks up the change and redeploys automatically. Your data lives on the disk you set up in
Part 4, completely separate from the code, so updates never touch or reset it.

## If something doesn't match what you see

Hosting platforms change their UI fairly often. If a button or tab isn't exactly where this
guide says, look for the closest equivalent — the concepts above (build command, start
command, a persistent disk, and environment variables) are what matter, not the exact
wording. Let me know what you're seeing and I can help troubleshoot the specific screen.
