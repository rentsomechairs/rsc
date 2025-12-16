# Rent Some Chairs — Full Package (Backend + Frontend)

This package runs the **frontend on GitHub Pages** and uses **Google Sheets as the database** via a deployed **Google Apps Script Web App**.

## What’s included
- Frontend (static): `index.html`, `styles.css`, `js/*`
- Backend (Apps Script): `apps_script/Code.gs`
- Key features:
  - Google login (GIS) + email/password login with verification code
  - Owner/super-admin supported (server-side only)
  - Inventory multi-select UI fix (selected items stay adjustable)
  - Bookings saved to Sheets
  - Admin snapshot + save equipment/locations/coupons
  - Delivery quote endpoint (Distance Matrix) (optional; needs MAPS_API_KEY)

---

## Step 1 — Create the Google Sheet
1. Create a new Google Sheet.
2. Copy the **Sheet ID** from the URL (the long string between `/d/` and `/edit`).
3. Leave it empty — the script will create the tabs + headers automatically on first request.

---

## Step 2 — Create the Apps Script Web App
1. Go to **script.google.com** → New project.
2. Create a single file named `Code.gs` and paste the contents of `apps_script/Code.gs`.
3. Open **Project Settings** → **Script Properties** and add:

Required:
- `SHEET_ID` = `<your sheet id>`
- `OWNER_EMAIL` = `rentsomechairs@gmail.com`
- `OWNER_PASSWORD` = `12poqw09-`

Optional (recommended):
- `ADMIN_NOTIFY_EMAIL` = `rentsomechairs@gmail.com`
- `MAPS_API_KEY` = `<your Google Maps API key>` (only needed for delivery quote)

4. Deploy:
- Deploy → New deployment → **Web app**
- Execute as: **Me**
- Who has access: **Anyone**
- Click Deploy and copy the Web App URL (ends with `/exec`)

---

## Step 3 — Configure the frontend
1. Open `js/config.js`
2. Paste your Apps Script Web App URL:
```js
APPS_SCRIPT_URL: "https://script.google.com/macros/s/....../exec",
```

3. Commit/push the site to GitHub Pages.

---

## Notes / Security
- The **owner account** is enforced server-side and never exposed in the frontend.
- All writes go through Apps Script; Sheets should not be edited directly by untrusted users.

---

## Admin Config (Delivery Fee)
If you set `MAPS_API_KEY`, you can add these keys via the Admin Config endpoint (or by editing the `Config` sheet):
- `base_address` (string, e.g. `123 Main St, Raleigh, NC 27601`)
- `delivery_base_fee` (number)
- `delivery_per_mile` (number)
- `delivery_max_miles` (number, optional)

---

## Troubleshooting
- If the frontend says “Missing CONFIG.APPS_SCRIPT_URL” you didn’t set the URL in `js/config.js`.
- If Apps Script says “Missing SHEET_ID” add it in Script Properties.
- Google login requires your Google OAuth Client ID already embedded in the page meta tag.
