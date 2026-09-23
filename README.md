# Little Lash Lounge — Payments

A small, fast app (installable PWA) to track each employee's appointment payments month by month.
You sign in with Google, and the data lives in a normal **Google Sheet** in your Drive.

- Months run **26th → 25th** like the old income sheet (set in the sheet's *Settings* tab).
- See everyone or one employee: totals, Paid / Unpaid, Cash / Card / EFT.
- Tap to mark **Paid ⇄ Unpaid** or change the method; tick several and mark them in one go.
- A year view shows month-by-month and per-employee totals.
- Works on phone and laptop. Use **Add to Home Screen** to get it like an app.

No server is needed. It's a static website that talks to Google Sheets directly, so free hosting works.

---

## Setup (once, about 15 minutes)

### 1. Put the site on Netlify (free)

1. Go to **netlify.com** → sign up with GitHub.
2. **Add new site → Import an existing project → GitHub →** pick `Little-Lash-Accounting`.
3. Leave the build settings as they are (they come from `netlify.toml`) and click **Deploy**.
4. **Site configuration → Change site name**, e.g. `little-lash`. Your address is then
   `https://little-lash.netlify.app`.

(Cloudflare Pages works the same way: build command `npm run build`, output folder `dist`.)

### 2. Create the Google sign-in ("OAuth client ID")

1. Open **console.cloud.google.com** → create a project called `Little Lash`.
2. **APIs & Services → Library →** search **Google Sheets API** → **Enable**.
3. **Google Auth Platform → Branding**: app name `Little Lash Payments`, your email → save.
   **Audience**: choose *External*. Under **Test users**, add your Gmail and your wife's Gmail.
4. **Clients → Create client → Web application**, then add:
   - *Authorized JavaScript origins*: `https://little-lash.netlify.app` and `http://localhost:5173`
   - *Authorized redirect URIs*: `https://little-lash.netlify.app/` and `http://localhost:5173/`

   Then click **Create** and copy the **Client ID**.

### 3. Tell the site about it

In Netlify: **Site configuration → Environment variables**, add

| Key | Value |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | the Client ID from step 2 |
| `VITE_SPREADSHEET_ID` | `12aaCpHvrYlGrx6zByBj12QuHW25GaeZP2eqcJDpMCMw` (your "Little Lash Lounge Payments" sheet) |

Then **Deploys → Trigger deploy**.

### 4. Share the sheet and install on her phone

1. Open the Google Sheet → **Share** → add your wife's Gmail as **Editor**.
2. On her phone, open `https://little-lash.netlify.app` → **Sign in with Google**.
   Google says *"Google hasn't verified this app"*. That's expected for your own private app:
   tap **Continue**.
3. **Add to Home Screen** (iPhone: Share button; Android: ⋮ menu).

> Tip: while the Google project is in *Testing*, Google asks her to approve again about once a week. To stop
> that, open **Google Auth Platform → Audience → Publish app**. No review is needed for a private app like this.

---

## Running it on your own computer

```bash
npm install
cp .env.example .env.local     # put the Client ID (and sheet ID) in it
npm run dev                    # http://localhost:5173
```

To try it **without Google** (fake sheet with sample data):

```bash
npm run dev:fake
# open http://localhost:5173/?api=http://localhost:8787 and use sheet ID: demo
```

## The Google Sheet

| Tab | Columns |
| --- | --- |
| **Employees** | ID, Name, Phone, Active, Created At, Updated At |
| **Appointments** | ID, Date, Month, Employee ID, Employee, Client, Service, Amount, Method, Status, Paid On, Notes, Created At, Updated At |
| **Settings** | Month starts on day |

You can filter, sort, chart or download the sheet freely. Don't rename the tabs or headers, and don't edit the
ID columns. The app uses them to find rows. After editing the sheet by hand, tap **↻** in the app to reload.

## Code

```
src/backend.js          Google Sheet as the database (load, add, edit, delete)
src/google/auth.js      Google sign-in (OAuth redirect flow — works in an installed PWA)
src/google/sheets.js    tiny Google Sheets API client
src/store.js            app state and actions
src/views, components   Vue 3 screens
public/sw.js            service worker (offline app shell, installable)
dev/fake-sheets-api.cjs local stand-in for the Google Sheets API, for testing
```
