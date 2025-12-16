const DB_KEY = "rsc_db_v1";
const SESSION_KEY = "rsc_sess";

export const ADMIN = { email: "r@g.com", password: "1" };

function nowIso(){ return new Date().toISOString(); }
function uid(prefix){ return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`; }

function seedDb(){
  return {
    users: [{ id:"admin_1", email: ADMIN.email, password: ADMIN.password, role:"admin", createdAt: nowIso() }],
    equipment: [],
    locations: [],
    coupons: [],
    bookings: [],
    checkout: {}
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
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getSession(){
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}

export function clearSession(){
  const keys = [SESSION_KEY, "rsc_session_v1", "rsc_session", "rsc_sess_v1"];
  for (const k of keys) {
    try { localStorage.removeItem(k); } catch {}
  }
  try { sessionStorage.clear(); } catch {}
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
const CART_KEY = "rsc_cart_v1";

export function getCart(){
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); }
  catch { return []; }
}

export function setCart(items){
  localStorage.setItem(CART_KEY, JSON.stringify(items || []));
}

export function clearCart(){
  localStorage.removeItem(CART_KEY);
}
