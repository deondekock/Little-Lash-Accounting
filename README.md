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
- **Team**: each team member's month, unpaid amount and a 12-month trend, plus her clients: new, 2nd/3rd visit,
  regulars, switched to her, moved away. Tap any number to see the names.
- **Client flow** (Home): new → returning → regular clients per team member, switches, and how many of last
  month's new clients came back.
- **Insights**: the year month by month vs. last year, who earned what, payment methods, and tables.
- **Client suggestions** while adding an appointment (fills in her usual service and price).
- **Services**: pick several services per appointment (chips, most-used first; the price is filled in for the chosen team member — each service can have a price per person).
  The **Services & prices** page (Team → Services & prices) lets her add services with prices, rename, hide,
  and merge duplicate names (e.g. "halfset lashes" / "Half set lashes") across all past appointments.
- **Payslips** (Team → Payslips): basic salary + commission + overtime commission, PAYE (SARS tables, with the
  age rebates from the ID number) and UIF (1%, excluding commission, capped at R177.12), extra earnings and
  deductions, every figure can be overtyped. Save them, and print or save as PDF (one or all), laid out like the
  old payslip template. Shows the month's PAYE + UIF for the EMP201.
  Add a new year's tax table in `src/lib/payroll.js` after each February budget.
- **Overtime**: mark an appointment as done in overtime (½ h, 1 h, … or all of it) and how long it took; that
  share of the takings earns her overtime commission % instead of the normal %.
- **Leave** (Team → Leave): book annual, sick, family, maternity or unpaid leave in hours.
  - Annual: set in hours per year per person (default and minimum 3 weeks); balance = starting balance +
    hours per year ÷ 12 each month − annual leave booked. Shown on the Team page and payslips.
  - Sick: 6 weeks of her working time per 3-year cycle from the date engaged (1 day per 26 worked in the
    first 6 months). Family responsibility: 3 days per 12-month cycle after 4 months (4+ days a week).
    Maternity: 4 consecutive months, unpaid (UIF). These follow the BCEA minimums and her days/hours a week.
  - **Owner** (Edit → Leave): no legal minimums or limits; her leave is only recorded.
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

## Moving to Cloudflare (D1 database)

The data can live in a Cloudflare D1 database instead of the Google Sheet. `worker/` holds the database tables
(`worker/migrations`) and a small Worker (`worker/src/index.js`) that checks the Google sign-in and only lets the
addresses in the `ALLOWED_EMAILS` secret in. It backs everything up to Cloudflare KV every night (kept 35 days).
GitHub Actions deploys it on every push once the repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and
`ALLOWED_EMAILS` are set.

1. With the app still on the Google Sheet: **Settings → Move data to Cloudflare** copies everything across and shows
   both side by side (it can be run again; it replaces what's in Cloudflare).
2. Switch the app over with `VITE_BACKEND=cloudflare` (the default in `src/config.js` since the move on 26 Sept 2026).
   The Google Sheet stays as it was, as an archive; `VITE_BACKEND=sheets` switches back.

**Settings → Download data** saves appointments, team, services, leave and payslips as CSV files (Excel / Sheets).

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
| **Employees** | ID, Name, Phone, Active, Created At, Updated At, then payslip details: Full Name, Employee Code, ID Number, Address, Date Engaged, Tax Number, Bank Name, Account Type, Account Number, Branch Code, Salary Label, Basic Salary, Commission %, Commission On (`all` / `aboveBasic` / `above`), Commission Above, Overtime Commission %, Annual Leave Hours / Year, Hours / Day, Leave Balance (days), Leave Balance On, Days / Week, Sick Hours Used Before, Owner |
| **Appointments** | ID, Date, Month, Employee ID, Employee, Client, Service, Amount, Method, Status, Paid On, Notes, Created At, Updated At, Overtime (minutes or `All`), Length (min) |
| **Leave** | ID, Employee ID, Employee, Type (Annual/Sick/Family/Maternity/Unpaid), From, To, Hours, Notes, Created At, Updated At |
| **Payslips** | ID, Employee ID, Employee, Month, Pay Date, Gross, PAYE, UIF, Deductions, Net, Details (the whole payslip as JSON), Created At, Updated At |
| **Services** | ID, Name, Price (for anyone), Active, Created At, Updated At, Team Prices (JSON: team member ID → price) |
| **Settings** | Month starts on day; Company Name, Company Type, Registration Number, Company Address, PAYE Reference, UIF Reference |
| **History** | ID, Time, Who, Action, Summary, Undone At, Data 1–10 (the rows before each change, as JSON) |

You can filter, sort, chart or download the sheet freely. Don't rename the tabs or headers, and don't edit the
ID columns. The app uses them to find rows. After editing the sheet by hand, tap **↻** in the app to reload.

## Code

```
src/backend.js          Google Sheet as the database (load, add, edit, delete)
src/google/auth.js      Google sign-in (OAuth redirect flow — works in an installed PWA)
src/google/sheets.js    tiny Google Sheets API client
src/lib/payroll.js      commission, overtime, PAYE, UIF and leave maths (tax tables live here)
src/store.js            app state and actions
src/views, components   Vue 3 screens
public/sw.js            service worker (offline app shell, installable)
dev/fake-sheets-api.cjs local stand-in for the Google Sheets API, for testing
src/backend-cf.js       the same data functions on Cloudflare (talks to the Worker)
src/lib/schema.js       database tables and fields, shared with the Worker
worker/                 Cloudflare Worker + D1 migrations (cd worker && npm i && npm run migrate:local && npm run dev)
```
