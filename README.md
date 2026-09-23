# Little Lash Lounge — Payments

A simple, free app to track each employee's appointment payments month by month.

- **Employees**: add, edit, or mark inactive.
- **Appointments**: date, employee, client, service, amount (R), paid with **Cash / Card / EFT**, **Paid / Unpaid**.
- **Month view**: totals for the month (Total, Paid, Unpaid, Cash, Card, EFT), a per-employee breakdown,
  and the list of appointments. Tap a pill to switch **Paid ⇄ Unpaid**, and use the dropdown to change the method.
- **One employee or everyone**: tap an employee's name to see only her appointments, or "All employees" for everything.
- **Bulk actions**: tick several appointments (or "Select all") → *Mark paid*, *Mark unpaid*, or *Set method*.
- **Year view**: January–December totals per month and per employee. Tap a month to open it.
- **Stored in Google Sheets**: everything is saved in a Google Sheet called
  *Little Lash Lounge Payments* in the signed-in Google account's Drive. The app creates it the first time it opens.
  Use the "Open Google Sheet ↗" link at the top to see it.

It runs on **Google Apps Script**, so Google hosts it for free. You don't need a server or domain, and there's no monthly cost.

---

## One-time setup (about 10 minutes, no programming needed)

Do this **while signed in to the Google account that should own the data** (e.g. your wife's Gmail).

1. Go to **https://script.google.com** and click **New project**.
2. Click *Untitled project* at the top and rename it to **Little Lash Lounge Payments**.
3. **Code.gs**: delete everything in the editor, then paste in the contents of [`src/Code.gs`](src/Code.gs).
4. **Index**: click **+** next to *Files* → **HTML**, name it exactly `Index` (no `.html`, Google adds it),
   delete what's there, then paste in the contents of [`src/Index.html`](src/Index.html).
5. Click the 💾 **Save** icon.
6. Click **Deploy → New deployment**. Click the ⚙️ gear next to *Select type* and choose **Web app**:
   - *Description*: `v1`
   - *Execute as*: **Me**
   - *Who has access*: **Only myself**
   - Click **Deploy**.
7. Google asks for permission. Click **Authorize access**, choose the account, then
   **Advanced → Go to Little Lash Lounge Payments (unsafe) → Allow**.
   (Google shows "unsafe" for any personal script that it hasn't reviewed. This one is your own code, and it only
   accesses the spreadsheets it creates.)
8. Copy the **Web app URL** (it ends in `/exec`). That's the app!

### Put it on her phone like an app

Open the Web app URL on the phone while signed in to the same Google account, then:

- **iPhone (Safari)**: Share button → **Add to Home Screen**.
- **Android (Chrome)**: ⋮ menu → **Add to Home screen**.

### First use

1. Open the app, then go to **Employees → + Add employee** and add each lady.
2. Go back to **Payments** and tap **+ Add appointment**. Tick *Add another after saving* to enter a busy day quickly.

---

## Updating the app later

If the code changes: paste the new `Code.gs` / `Index.html` into the same project, save, then
**Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The URL stays the same.

## Letting someone else use it too (optional)

With the settings above, only the owner's Google account can open the app. To let someone else use the same data:

1. Open the Google Sheet (link at the top of the app) and **Share** it with their Gmail as *Editor*.
2. In Apps Script, open **Project Settings → Script properties**, and add `SPREADSHEET_ID` = the long ID from the
   sheet's URL (the part between `/d/` and `/edit`).
3. **Deploy → Manage deployments → Edit**: set *Execute as* to **User accessing the web app** and
   *Who has access* to **Anyone with Google account**, then deploy a new version. Only people the sheet is shared
   with will be able to read or write the data.

## How the data is stored

The spreadsheet has two tabs:

| Tab | Columns |
| --- | --- |
| **Employees** | ID, Name, Phone, Active, Created At, Updated At |
| **Appointments** | ID, Date, Month, Employee ID, Employee, Client, Service, Amount, Method, Status, Paid On, Notes, Created At, Updated At |

You can freely filter, sort, chart or download the sheet. Please don't rename the tabs or the header row, and
don't edit the ID columns, because the app uses them to find rows.

---

## For developers

```
src/Code.gs          server-side Apps Script (Sheets storage + API)
src/Index.html       the whole front-end (vanilla HTML/CSS/JS)
src/appsscript.json  Apps Script manifest
dev/preview-server.js local preview with an in-memory fake of Google Sheets
```

**Local preview** (Node 18+) runs the real `Code.gs` against a fake spreadsheet:

```bash
node dev/preview-server.js --demo   # http://localhost:8080, with sample data
node dev/preview-server.js          # empty
```

**Deploying with [clasp](https://github.com/google/clasp)** (optional, instead of copy/paste):

```bash
npm i -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # put your scriptId in it (Project Settings → Script ID)
clasp push
clasp deploy
```
