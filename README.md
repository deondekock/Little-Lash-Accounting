# Little Lash Lounge — Payments

A small, fast app (installable PWA) to track each employee's appointment payments month by month.
You sign in with Google, and the data lives in a normal **Google Sheet** in your Drive.

- **Home**: this month's takings vs. the same point last month (with a running-total graph), appointments,
  average visit, money still owed, the team leaderboard, how clients paid, busiest days, and regulars who are
  **due for a refill**.
- **Payments**: month by month (26th → 25th, set in the sheet's *Settings* tab), everyone or one person.
  Tap to mark **Paid ⇄ Unpaid** or change **Cash / Card / EFT**; tick several and mark them in one go.
- **Clients**: search every client, see visits, spend, usual service and full history; filters for regulars,
  new clients and who's due back.
- **Team**: each team member's month, unpaid amount and a 12-month trend.
- **Insights**: the year month by month vs. last year, who earned what, payment methods, and tables.
- **Client suggestions** while adding an appointment (fills in her usual service and price).
- **Services**: pick several services per appointment (chips, most-used first; price filled in from her list).
  The **Services & prices** page (Team → Services & prices) lets her add services with prices, rename, hide,
  and merge duplicate names (e.g. "halfset lashes" / "Half set lashes") across all past appointments.
- **Merge / rename clients**, with a "Possible duplicates" finder (e.g. "Irene" / "Irené").
- **History & undo**: every change is logged in the sheet's *History* tab with the rows as they were before,
  so any change — or everything done today — can be rolled back (and the rollback undone too).
- Light and dark mode; works on phone and laptop; **Add to Home Screen** to use it like an app.

No server is needed. It's a static website that talks to Google Sheets directly, so free hosting works.

---

## Where it lives

**https://deondekock.github.io/Little-Lash-Accounting/**. It's published automatically by GitHub Pages
(`.github/workflows/deploy.yml`) every time a change is pushed.

One-time setup (already done or to do once):

1. **GitHub Pages:** repo **Settings → Pages → Source: GitHub Actions** (the repo must be public on a free
   GitHub plan). Her data is not in the repo; it stays in the Google Sheet.
2. **Google sign-in:** a Google Cloud project with the **Google Sheets API** enabled and an OAuth
   **Web application** client whose
   - *Authorized JavaScript origins* include `https://deondekock.github.io` (and `http://localhost:5173`)
   - *Authorized redirect URIs* include `https://deondekock.github.io/Little-Lash-Accounting/` (and `http://localhost:5173/`)

   The client ID is in `src/config.js`. It's public by design, so it's fine in the code.
3. **The sheet:** share it (Editor) only with the Google accounts that should use the app. Keep general access
   **Restricted**.

### Using it on a phone

Open the address → **Sign in with Google** → paste the sheet's link once → **Add to Home Screen**
(iPhone: Share button; Android: ⋮ menu). Google may say *"Google hasn't verified this app"*: tap **Continue**.
To stop Google asking again every week, publish the app in **Google Auth Platform → Audience → Publish app**.

### Hosting elsewhere (optional)

Any static host works (Netlify, Cloudflare Pages): build with `npm run build`, publish `dist`. Add the new address to
the Google client's origins and redirect URIs. Set `VITE_SPREADSHEET_ID` there to skip pasting the sheet link.

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
| **Services** | ID, Name, Price, Active, Created At, Updated At |
| **Settings** | Month starts on day |
| **History** | ID, Time, Who, Action, Summary, Undone At, Data 1–10 (the rows before each change, as JSON) |

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
