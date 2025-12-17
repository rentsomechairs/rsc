# Rent Some Chairs — Project Handoff (v3.6.1)

This zip contains the **current working state** of the Rent Some Chairs website.
It is intended to be used as a clean handoff so development can continue in a new chat
without historical context or lag.

---

## 1. What this project is

A fully front-end (HTML/CSS/JS) rental booking website for an equipment rental business
(chairs first, expandable later), with:

- Admin-managed inventory and pricing
- Customer booking flow (inventory → date → address → review)
- Optional 5-year annual booking discount logic
- User accounts, guest flow, and profile pages
- Local prototype database (localStorage)
- Designed to be later connected to a real backend (Google Sheets + Apps Script)

---

## 2. Current status (important)

✅ UI / UX is stable  
✅ Admin panel works  
✅ Inventory, calendar, annual logic works  
✅ Profile page + order history works  
❌ Still using localStorage (NOT production-ready backend)  
❌ Payments not yet implemented  
❌ Email + Google login not yet wired  

This is the **last prototype step before real backend integration**.

---

## 3. How to run locally

### Requirements
- Python 3 installed

### Start local server
From the project root:

```bash
python -m http.server 8000
```

Then open:
```
http://localhost:8000
```

⚠️ Do NOT open index.html directly from the file system.

---

## 4. Login credentials (prototype)

### Admin
- Email: r@g.com
- Password: 1

### Normal user
- Any email + password you create

### Guest
- Continue as Guest
- Can upgrade later via Profile page

---

## 5. Folder structure

```
/
├── index.html
├── styles.css
├── assets/
├── js/
│   ├── app.js
│   ├── db.js
│   ├── utils.js
│   ├── services/
│   │   └── api.js   (future backend)
│   ├── pages/
│   │   ├── landing.js
│   │   ├── inventory.js
│   │   ├── calendar.js
│   │   ├── address.js
│   │   ├── review.js
│   │   ├── admin.js
│   │   └── profile.js
│   └── ui/
│       └── flowbar.js
```

---

## 6. Booking flow

1. Landing / Login
2. Inventory selection
3. Date selection (single or 5-year annual)
4. Address
5. Review & confirm

---

## 7. Admin features

- Equipment management
- Storage locations
- Coupons
- Coming-soon items
- Tier pricing

---

## 8. Profile features

- Account info
- Default address
- Order history
- Order again
- Guest upgrade

---

## 9. Database plan

Current:
- localStorage via db.js

Next:
- Google Sheets + Apps Script API
- Swap db.js calls for services/api.js

---

## 10. What’s left before launch

1. Real backend (Sheets + Apps Script)
2. Auth hardening (hash passwords / Google login)
3. Server-side availability enforcement
4. Booking confirmation emails
5. Payments (Stripe)

---

## 11. How to continue

Upload this zip in a new chat and say:

“This is the Rent Some Chairs project. Please read the README and continue.”

---