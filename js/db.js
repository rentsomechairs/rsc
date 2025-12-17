const DB_KEY = "rsc_db_v1";
const SESSION_KEY = "rsc_sess";

import { CONFIG } from './config.js';
import { callApi } from './api.js';

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


/* =========================
   Backend bridge (Apps Script)
   ========================= */

export async function syncInventoryFromServer(){
  if (CONFIG.MOCK_MODE) return { ok:true, mode:"mock" };
  const session = getSession();
  const r = await callApi('inventory.list', {}, session);
  const db = readDb();
  db.equipment = r.items || [];
  writeDb(db);
  return { ok:true, count: (r.items||[]).length };
}

export async function syncCouponsFromServer(){
  if (CONFIG.MOCK_MODE) return { ok:true, mode:"mock" };
  const session = getSession();
  const r = await callApi('coupon.list', {}, session);
  const db = readDb();
  db.coupons = r.items || [];
  writeDb(db);
  return { ok:true, count: (r.items||[]).length };
}

export async function syncBookingsFromServer(email){
  if (CONFIG.MOCK_MODE) return { ok:true, mode:"mock" };
  const session = getSession();
  const r = await callApi('booking.listByEmail', { email }, session);
  const db = readDb();
  db.bookings = r.items || [];
  writeDb(db);
  return { ok:true, count: (r.items||[]).length };
}

export async function backendEmailLogin(email, password){
  if (CONFIG.MOCK_MODE) {
    // keep prototype behavior
    const v = verifyUser(email, password);
    if (!v.ok) {
      if (v.reason === 'bad_password') return { ok:false, reason:'bad_password' };
      const created = upsertUser(email, password, 'user');
      setSession({ userId: created.id, email: created.email, role: 'user' });
      return { ok:true, session: getSession() };
    }
    setSession({ userId: v.user.id, email: v.user.email, role: v.user.role || 'user' });
    return { ok:true, session: getSession() };
  }

  const r = await callApi('auth.emailLogin', { email, password }, null);
  setSession(r.session);
  // pull down latest data for this user
  await syncInventoryFromServer().catch(()=>{});
  await syncCouponsFromServer().catch(()=>{});
  await syncBookingsFromServer(email).catch(()=>{});
  return { ok:true, session: r.session, needsVerification: !!r.needsVerification };
}

export async function backendVerifyEmail(email, code){
  if (CONFIG.MOCK_MODE) return { ok:true, mode:"mock" };
  const r = await callApi('auth.verifyEmail', { email, code }, null);
  setSession(r.session);
  return { ok:true, session: r.session };
}

export async function backendResendVerification(email){
  if (CONFIG.MOCK_MODE) return { ok:true, mode:"mock" };
  await callApi('auth.resendVerification', { email }, null);
  return { ok:true };
}

export async function backendCreateBooking(booking){
  if (CONFIG.MOCK_MODE) {
    const db = readDb();
    db.bookings = db.bookings || [];
    const created = { ...booking, id: uid('bk'), createdAt: nowIso() };
    db.bookings.unshift(created);
    writeDb(db);
    return { ok:true, booking: created };
  }
  const session = getSession();
  const r = await callApi('booking.create', { booking }, session);
  // refresh bookings cache
  if (session?.email) await syncBookingsFromServer(session.email).catch(()=>{});
  return { ok:true, booking: r.booking };
}
