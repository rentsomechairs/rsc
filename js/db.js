const DB_KEY = "rsc_db_v1";
const SESSION_KEY = "rsc_sess";
// Per-user (session-scoped) keys
const CART_KEY = "rsc_cart_v1";
const CHECKOUT_KEY = "rsc_checkout_v1";
const PREF_KEY = "rsc_pref_v1";

export const ADMIN = { email: "r@g.com", password: "1" };

function nowIso(){ return new Date().toISOString(); }
function uid(prefix){ return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`; }

function seedDb(){
  return {
    users: [{ id:"admin_1", email: ADMIN.email, password: ADMIN.password, role:"admin", createdAt: nowIso() }],
categories: [
  { id:"cat_chairs", name:"Chairs", imageUrl:"", annualEligible:true, sortOrder:0, createdAt: nowIso(), updatedAt: nowIso() },
  { id:"cat_tables", name:"Tables", imageUrl:"", annualEligible:false, sortOrder:10, createdAt: nowIso(), updatedAt: nowIso() },
  { id:"cat_stages", name:"Stages", imageUrl:"", annualEligible:false, sortOrder:20, createdAt: nowIso(), updatedAt: nowIso() },
  { id:"cat_other", name:"Other", imageUrl:"", annualEligible:false, sortOrder:99, createdAt: nowIso(), updatedAt: nowIso() }
],
equipment: [
  {
    id: "eq_seed_white_folding_chair",
    name: "White Folding Chair (Seed)",
    categoryId: "cat_chairs",
    imageUrl: "",
    quantity: 200,
    maxPerOrder: 0,
    description: "Seeded demo item for quick testing (GitHub Pages).",
    pricingTiers: [
    { minQty: 10, priceEach: 1.90 },
    { minQty: 20, priceEach: 1.80 },
    { minQty: 30, priceEach: 1.70 },
    { minQty: 40, priceEach: 1.60 },
    { minQty: 50, priceEach: 1.50 },
    { minQty: 60, priceEach: 1.40 },
    { minQty: 70, priceEach: 1.30 },
    { minQty: 80, priceEach: 1.20 },
    { minQty: 90, priceEach: 1.10 },
    { minQty: 100, priceEach: 1.00 }
  ],
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: "eq_seed_black_resin_chair",
    name: "Black Resin Chair (Seed)",
    categoryId: "cat_chairs",
    imageUrl: "",
    quantity: 150,
    maxPerOrder: 0,
    description: "Seeded demo item for quick testing (GitHub Pages).",
    pricingTiers: [
    { minQty: 10, priceEach: 2.25 },
    { minQty: 20, priceEach: 2.10 },
    { minQty: 30, priceEach: 1.95 },
    { minQty: 40, priceEach: 1.80 },
    { minQty: 50, priceEach: 1.70 },
    { minQty: 60, priceEach: 1.60 },
    { minQty: 70, priceEach: 1.50 },
    { minQty: 80, priceEach: 1.40 },
    { minQty: 90, priceEach: 1.30 },
    { minQty: 100, priceEach: 1.20 }
  ],
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: "eq_seed_table_6ft_banquet",
    name: "6ft Banquet Table (Seed)",
    categoryId: "cat_tables",
    imageUrl: "",
    quantity: 30,
    maxPerOrder: 0,
    description: "Seeded demo item for quick testing (GitHub Pages).",
    pricingTiers: [
    { minQty: 1, priceEach: 12.00 },
    { minQty: 2, priceEach: 11.50 },
    { minQty: 3, priceEach: 11.00 },
    { minQty: 4, priceEach: 10.50 },
    { minQty: 5, priceEach: 10.00 },
    { minQty: 6, priceEach: 9.50 },
    { minQty: 7, priceEach: 9.00 },
    { minQty: 8, priceEach: 8.50 },
    { minQty: 9, priceEach: 8.00 },
    { minQty: 10, priceEach: 7.50 }
  ],
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: "eq_seed_table_60in_round",
    name: "60in Round Table (Seed)",
    categoryId: "cat_tables",
    imageUrl: "",
    quantity: 20,
    maxPerOrder: 0,
    description: "Seeded demo item for quick testing (GitHub Pages).",
    pricingTiers: [
    { minQty: 1, priceEach: 14.00 },
    { minQty: 2, priceEach: 13.50 },
    { minQty: 3, priceEach: 13.00 },
    { minQty: 4, priceEach: 12.50 },
    { minQty: 5, priceEach: 12.00 },
    { minQty: 6, priceEach: 11.50 },
    { minQty: 7, priceEach: 11.00 },
    { minQty: 8, priceEach: 10.50 },
    { minQty: 9, priceEach: 10.00 },
    { minQty: 10, priceEach: 9.50 }
  ],
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: "eq_seed_stage_4x8_platform",
    name: "Stage Platform 4x8 (Seed)",
    categoryId: "cat_stages",
    imageUrl: "",
    quantity: 10,
    maxPerOrder: 0,
    description: "Seeded demo item for quick testing (GitHub Pages).",
    pricingTiers: [
    { minQty: 1, priceEach: 75.00 },
    { minQty: 2, priceEach: 72.00 },
    { minQty: 3, priceEach: 69.00 },
    { minQty: 4, priceEach: 66.00 },
    { minQty: 5, priceEach: 63.00 },
    { minQty: 6, priceEach: 60.00 },
    { minQty: 7, priceEach: 57.00 },
    { minQty: 8, priceEach: 54.00 },
    { minQty: 9, priceEach: 51.00 },
    { minQty: 10, priceEach: 48.00 }
  ],
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: "eq_seed_stage_4x4_section",
    name: "Stage Section 4x4 (Seed)",
    categoryId: "cat_stages",
    imageUrl: "",
    quantity: 12,
    maxPerOrder: 0,
    description: "Seeded demo item for quick testing (GitHub Pages).",
    pricingTiers: [
    { minQty: 1, priceEach: 45.00 },
    { minQty: 2, priceEach: 43.00 },
    { minQty: 3, priceEach: 41.00 },
    { minQty: 4, priceEach: 39.00 },
    { minQty: 5, priceEach: 37.00 },
    { minQty: 6, priceEach: 35.00 },
    { minQty: 7, priceEach: 33.00 },
    { minQty: 8, priceEach: 31.00 },
    { minQty: 9, priceEach: 29.00 },
    { minQty: 10, priceEach: 27.00 }
  ],
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
],
    locations: [],
    coupons: [],
    bookings: [],
    checkout: {},
    settings: { sameDayFee: 0, defaultDeliverBy: '12:00', defaultPickupAt: '18:00' }
  };
}

export function readDb(){
  const raw = localStorage.getItem(DB_KEY);
  if (!raw){
    const db = seedDb();
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return db;
  }
  try{
    const db = JSON.parse(raw);
    if (!db?.users) throw new Error("bad db");
    if (!db.users.some(u => (u.email||"").toLowerCase() === ADMIN.email.toLowerCase())){
      db.users.unshift({ id:"admin_1", email: ADMIN.email, password: ADMIN.password, role:"admin", createdAt: nowIso() });
    }
    if (!db.equipment) db.equipment = [];
    if (!db.locations) db.locations = [];
    if (!db.coupons) db.coupons = [];
    if (!db.bookings) db.bookings = [];
    if (!db.checkout) db.checkout = {};
    if (!db.settings) db.settings = { sameDayFee: 0 };
    return db;
  } catch {
    const db = seedDb();
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return db;
  }
}

export function writeDb(db){
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function resetDb(){
  localStorage.removeItem(DB_KEY);
}

export function setSession(session){
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  // Do not persist in localStorage for this prototype.
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

export function getSession(){
  // Session should NOT persist after closing the browser (better for testing).
  try {
    const v = sessionStorage.getItem(SESSION_KEY);
    if (v) return JSON.parse(v);
  } catch {}

  // If an old persistent session exists from earlier versions, clear it.
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  return null;
}

export function clearSession(){
  const keys = [SESSION_KEY, "rsc_session_v1", "rsc_session", "rsc_sess_v1"];
  for (const k of keys) {
    try { localStorage.removeItem(k); } catch {}
  }
  try { sessionStorage.clear(); } catch {}
}

function sessionUserKey(session){
  if (session?.userId) return String(session.userId);
  if (session?.email) return String(session.email).toLowerCase();
  return 'anon';
}

export function getActiveUserKey(){
  return sessionUserKey(getSession());
}

function scopedKey(base, session){
  return `${base}:${sessionUserKey(session ?? getSession())}`;
}


export function verifyUser(email, password){
  const db = readDb();
  const u = db.users.find(x => (x.email||"").toLowerCase() === (email||"").toLowerCase());
  if (!u) return { ok:false, reason:"not_found" };
  if ((u.password||"") !== (password||"")) return { ok:false, reason:"bad_password" };
  return { ok:true, user:u };
}

export function upsertUser(email, password, role="user"){
  const db = readDb();
  let u = db.users.find(x => (x.email||"").toLowerCase() === (email||"").toLowerCase());
  if (!u){
    u = { id: uid("user"), email, password, role, createdAt: nowIso() };
    db.users.push(u);
    writeDb(db);
  }
  return u;
}

/* ---------- Users (profile helpers) ---------- */

export function getUserByEmail(email){
  const db = readDb();
  return db.users.find(u => (u.email||"").toLowerCase() === (email||"").toLowerCase()) || null;
}

export function updateUserByEmail(email, patch){
  const db = readDb();
  const idx = db.users.findIndex(u => (u.email||"").toLowerCase() === (email||"").toLowerCase());
  if (idx === -1) return null;
  const updated = { ...db.users[idx], ...patch, updatedAt: nowIso() };
  db.users[idx] = updated;
  writeDb(db);
  return updated;
}

export function setUserPassword(email, newPassword){
  return updateUserByEmail(email, { password: String(newPassword || "") });
}

export function listBookingsByEmail(email){
  const db = readDb();
  const e = (email||"").toLowerCase();
  return (db.bookings || []).filter(b => (b.customerEmail||"").toLowerCase() === e)
    .sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));
}

/* ---------- Equipment CRUD ---------- */
export function listEquipment(){
  const db = readDb();
  return [...db.equipment].sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));
}

export function saveEquipment(item){
  const db = readDb();
  const isEdit = !!item.id;
  if (!isEdit) {
    const created = { ...item, id: uid("eq"), createdAt: nowIso(), updatedAt: nowIso() };
    db.equipment.push(created);
    writeDb(db);
    return created;
  }
  const idx = db.equipment.findIndex(x => x.id === item.id);
  if (idx === -1) throw new Error("Equipment not found");
  const updated = { ...db.equipment[idx], ...item, updatedAt: nowIso() };
  db.equipment[idx] = updated;
  writeDb(db);
  return updated;
}

export function deleteEquipment(id){
  const db = readDb();
  db.equipment = db.equipment.filter(x => x.id !== id);
  writeDb(db);
}


export function listCategories(){
  const db = readDb();
  return [...(db.categories||[])].sort((a,b)=> (a.sortOrder??0)-(b.sortOrder??0) || String(a.name||"").localeCompare(String(b.name||"")));
}

export function saveCategory(cat){
  const db = readDb();
  db.categories = db.categories || [];
  const isEdit = !!cat.id;
  const cleaned = {
    ...cat,
    name: String(cat.name||"").trim(),
    imageUrl: String(cat.imageUrl||"").trim(),
    annualEligible: (Object.prototype.hasOwnProperty.call(cat,'annualEligible') ? !!cat.annualEligible : /\bchair(s)?\b/i.test(String(cat.name||""))),
    sortOrder: Number.isFinite(Number(cat.sortOrder)) ? Number(cat.sortOrder) : 0,
  };
  if (!cleaned.name) throw new Error("Category name is required");

  if (!isEdit){
    const created = { ...cleaned, id: uid("cat"), createdAt: nowIso(), updatedAt: nowIso() };
    db.categories.push(created);
    writeDb(db);
    return created;
  }
  const idx = db.categories.findIndex(x => x.id === cleaned.id);
  if (idx === -1) throw new Error("Category not found");
  db.categories[idx] = { ...db.categories[idx], ...cleaned, updatedAt: nowIso() };
  writeDb(db);
  return db.categories[idx];
}

export function deleteCategory(id){
  const db = readDb();
  db.categories = (db.categories||[]).filter(x => x.id !== id);
  // do not delete equipment; instead detach them
  db.equipment = (db.equipment||[]).map(eq => (eq.categoryId===id ? { ...eq, categoryId: "" } : eq));
  writeDb(db);
}


/* ---------- Locations CRUD ---------- */
export function listLocations(){
  const db = readDb();
  return [...db.locations].sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));
}

export function saveLocation(loc){
  const db = readDb();
  const isEdit = !!loc.id;
  if (!isEdit) {
    const created = { ...loc, id: uid("loc"), createdAt: nowIso(), updatedAt: nowIso() };
    db.locations.push(created);
    writeDb(db);
    return created;
  }
  const idx = db.locations.findIndex(x => x.id === loc.id);
  if (idx === -1) throw new Error("Location not found");
  const updated = { ...db.locations[idx], ...loc, updatedAt: nowIso() };
  db.locations[idx] = updated;
  writeDb(db);
  return updated;
}

export function deleteLocation(id){
  const db = readDb();
  db.locations = db.locations.filter(x => x.id !== id);
  writeDb(db);
}

/* ---------- Coupons CRUD ---------- */
export function listCoupons(){
  const db = readDb();
  return [...db.coupons].sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));
}

export function saveCoupon(cpn){
  const db = readDb();
  const isEdit = !!cpn.id;

  const normalized = {
    ...cpn,
    code: String(cpn.code || "").trim().toUpperCase(),
    type: cpn.type === "fixed" ? "fixed" : "percent",
    amount: Number(cpn.amount || 0),
    enabled: !!cpn.enabled
  };

  if (!isEdit) {
    const created = { ...normalized, id: uid("cpn"), createdAt: nowIso(), updatedAt: nowIso() };
    db.coupons.push(created);
    writeDb(db);
    return created;
  }

  const idx = db.coupons.findIndex(x => x.id === normalized.id);
  if (idx === -1) throw new Error("Coupon not found");
  const updated = { ...db.coupons[idx], ...normalized, updatedAt: nowIso() };
  db.coupons[idx] = updated;
  writeDb(db);
  return updated;
}

export function deleteCoupon(id){
  const db = readDb();
  db.coupons = db.coupons.filter(x => x.id !== id);
  writeDb(db);
}

export function toggleCouponEnabled(id){
  const db = readDb();
  const idx = db.coupons.findIndex(x => x.id === id);
  if (idx === -1) return;
  db.coupons[idx].enabled = !db.coupons[idx].enabled;
  db.coupons[idx].updatedAt = nowIso();
  writeDb(db);
}


/* ---------- Cart (prototype) ---------- */
export function getCart(session){
  try {
    const s = session || getSession();
    return JSON.parse(localStorage.getItem(scopedKey(CART_KEY, s)) || "[]");
  } catch { return []; }
}

export function setCart(items, session){
  const s = session || getSession();
  localStorage.setItem(scopedKey(CART_KEY, s), JSON.stringify(items || []));
}

export function clearCart(session){
  const s = session || getSession();
  localStorage.removeItem(scopedKey(CART_KEY, s));
}

/* ---------- Checkout (prototype) ---------- */
export function getCheckout(session){
  try {
    const s = session || getSession();
    return JSON.parse(localStorage.getItem(scopedKey(CHECKOUT_KEY, s)) || "{}");
  } catch { return {}; }
}

export function setCheckout(state, session){
  const s = session || getSession();
  localStorage.setItem(scopedKey(CHECKOUT_KEY, s), JSON.stringify(state || {}));
}

export function patchCheckout(patch, session){
  const cur = getCheckout(session);
  const next = { ...cur, ...(patch || {}) };
  setCheckout(next, session);
  return next;
}


/* ---------- User Preferences (scoped) ---------- */
export function getPrefs(session){
  try { return JSON.parse(localStorage.getItem(scopedKey(PREF_KEY, session)) || "{}"); }
  catch { return {}; }
}
export function setPrefs(prefs, session){
  localStorage.setItem(scopedKey(PREF_KEY, session), JSON.stringify(prefs || {}));
}
export function patchPrefs(patch, session){
  const cur = getPrefs(session);
  setPrefs({ ...(cur||{}), ...(patch||{}) }, session);
}

export function clearCheckout(session){
  localStorage.removeItem(scopedKey(CHECKOUT_KEY, session));
}
