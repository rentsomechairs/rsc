/**
 * Rent Some Chairs — Apps Script Backend (Bridge for v3.6.1)
 * Stores data in Google Sheets + sends verification codes via MailApp.
 *
 * Script Properties required:
 *   SHEET_ID
 *   OWNER_EMAIL
 *   OWNER_PASSWORD   (temporary; stores hash in Users after first run)
 */
const PROP = PropertiesService.getScriptProperties();

function doPost(e){
  try{
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = body.action || "";
    const payload = body.payload || {};
    const session = body.session || null;

    const result = dispatch_(action, payload, session);
    return json_({ ok:true, ...result });
  }catch(err){
    return json_({ ok:false, error: String(err && err.message ? err.message : err) });
  }
}

function dispatch_(action, payload, session){
  switch(action){
    case "auth.emailLogin": return authEmailLogin_(payload);
    case "auth.verifyEmail": return authVerifyEmail_(payload);
    case "auth.resendVerification": return authResendVerification_(payload);

    case "inventory.list": return inventoryList_();

    case "booking.create": return bookingCreate_(payload, session);
    case "booking.listByEmail": return bookingListByEmail_(payload, session);

    case "coupon.list": return couponList_();

    default: throw new Error("Unknown action: " + action);
  }
}

/* ---------- Sheet helpers ---------- */

function sheet_(){
  const id = PROP.getProperty("SHEET_ID");
  if (!id) throw new Error("Missing Script Property SHEET_ID");
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(name, headers){
  const ss = sheet_();
  let sh = ss.getSheetByName(name);
  if (!sh){
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

function rowsToObjects_(values){
  if (!values || values.length < 2) return [];
  const headers = values[0].map(h => String(h||"").trim());
  const out = [];
  for (let r=1;r<values.length;r++){
    const row = values[r];
    if (row.join("").trim() === "") continue;
    const obj = {};
    headers.forEach((h,i)=> obj[h] = row[i]);
    out.push(obj);
  }
  return out;
}

function objectToRow_(headers, obj){
  return headers.map(h => obj[h] === undefined ? "" : obj[h]);
}

function sha256_(s){
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s||""), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function nowIso_(){ return new Date().toISOString(); }

/* ---------- Auth (email + verification code) ---------- */

function usersSheet_(){
  return ensureSheet_("Users", ["id","email","passHash","role","verified","verifyCode","verifyExp","createdAt","updatedAt"]);
}

function sessionsSheet_(){
  return ensureSheet_("Sessions", ["token","email","role","createdAt","lastSeenAt"]);
}

function findUserByEmail_(email){
  const sh = usersSheet_();
  const values = sh.getDataRange().getValues();
  const rows = rowsToObjects_(values);
  const e = String(email||"").toLowerCase();
  return rows.find(u => String(u.email||"").toLowerCase() === e) || null;
}

function upsertUser_(email, patch){
  const sh = usersSheet_();
  const range = sh.getDataRange();
  const values = range.getValues();
  const headers = values[0].map(String);
  const e = String(email||"").toLowerCase();

  for (let r=1;r<values.length;r++){
    const row = values[r];
    const rowEmail = String(row[headers.indexOf("email")]||"").toLowerCase();
    if (rowEmail === e){
      const current = {};
      headers.forEach((h,i)=> current[h]=row[i]);
      const updated = { ...current, ...patch, updatedAt: nowIso_() };
      sh.getRange(r+1,1,1,headers.length).setValues([objectToRow_(headers, updated)]);
      return updated;
    }
  }

  // create
  const created = {
    id: "user_" + Utilities.getUuid().slice(0,8),
    email: email,
    passHash: patch.passHash || "",
    role: patch.role || "user",
    verified: patch.verified === true ? true : false,
    verifyCode: patch.verifyCode || "",
    verifyExp: patch.verifyExp || "",
    createdAt: nowIso_(),
    updatedAt: nowIso_(),
  };
  sh.appendRow(objectToRow_(headers, created));
  return created;
}

function createSession_(email, role){
  const token = Utilities.getUuid().replace(/-/g,"");
  const sh = sessionsSheet_();
  sh.appendRow([token, email, role, nowIso_(), nowIso_()]);
  return { token, email, role };
}

function authEmailLogin_(p){
  const ownerEmail = (PROP.getProperty("OWNER_EMAIL")||"").trim();
  const ownerPass = (PROP.getProperty("OWNER_PASSWORD")||"");

  const email = String(p.email||"").trim();
  const password = String(p.password||"");

  if (!email || !password) throw new Error("Missing email or password.");

  // Owner login -> admin role
  if (ownerEmail && email.toLowerCase() === ownerEmail.toLowerCase()){
    if (!ownerPass) throw new Error("Owner password not set in Script Properties.");
    if (password !== ownerPass) throw new Error("Wrong password.");
    const sess = createSession_(email, "admin");
    return { session: sess, needsVerification:false };
  }

  let user = findUserByEmail_(email);

  // new user: create + send verify code
  if (!user){
    const code = String(Math.floor(100000 + Math.random()*900000));
    const exp = new Date(Date.now() + 15*60*1000).toISOString();
    const passHash = sha256_(password);
    user = upsertUser_(email, { passHash, role:"user", verified:false, verifyCode: code, verifyExp: exp });
    MailApp.sendEmail(email, "Rent Some Chairs verification code", "Your verification code is: " + code + "\n\nIt expires in 15 minutes.");
    return { session: null, needsVerification:true };
  }

  // existing user: if not verified, re-send code
  if (String(user.verified) !== "true" && user.verified !== true){
    const code = String(Math.floor(100000 + Math.random()*900000));
    const exp = new Date(Date.now() + 15*60*1000).toISOString();
    upsertUser_(email, { verifyCode: code, verifyExp: exp });
    MailApp.sendEmail(email, "Rent Some Chairs verification code", "Your verification code is: " + code + "\n\nIt expires in 15 minutes.");
    return { session: null, needsVerification:true };
  }

  // verify password
  const passHash = sha256_(password);
  if (String(user.passHash||"") !== passHash) throw new Error("Wrong password.");

  const sess = createSession_(email, String(user.role||"user"));
  return { session: sess, needsVerification:false };
}

function authVerifyEmail_(p){
  const email = String(p.email||"").trim();
  const code = String(p.code||"").trim();

  if (!email || !code) throw new Error("Missing email or code.");

  const user = findUserByEmail_(email);
  if (!user) throw new Error("Account not found.");

  const exp = user.verifyExp ? new Date(String(user.verifyExp)) : null;
  if (!user.verifyCode || String(user.verifyCode) !== code) throw new Error("Wrong code.");
  if (exp && exp.getTime() < Date.now()) throw new Error("Code expired.");

  upsertUser_(email, { verified:true, verifyCode:"", verifyExp:"" });
  const sess = createSession_(email, String(user.role||"user"));
  return { session: sess };
}

function authResendVerification_(p){
  const email = String(p.email||"").trim();
  if (!email) throw new Error("Missing email.");
  const user = findUserByEmail_(email);
  if (!user) throw new Error("Account not found.");

  const code = String(Math.floor(100000 + Math.random()*900000));
  const exp = new Date(Date.now() + 15*60*1000).toISOString();
  upsertUser_(email, { verifyCode: code, verifyExp: exp });
  MailApp.sendEmail(email, "Rent Some Chairs verification code", "Your verification code is: " + code + "\n\nIt expires in 15 minutes.");
  return { sent:true };
}

/* ---------- Inventory ---------- */

function equipmentSheet_(){
  return ensureSheet_("Equipment", ["id","name","description","imageUrl","totalQty","pricingTiers","active","createdAt","updatedAt"]);
}

function inventoryList_(){
  const sh = equipmentSheet_();
  const rows = rowsToObjects_(sh.getDataRange().getValues());
  const items = rows
    .filter(r => String(r.active||"true") !== "false")
    .map(r => ({
      id: String(r.id||""),
      name: String(r.name||""),
      description: String(r.description||""),
      imageUrl: String(r.imageUrl||""),
      totalQty: Number(r.totalQty||0),
      pricingTiers: safeJson_(r.pricingTiers, []),
      active: String(r.active||"true") !== "false"
    }));
  return { items };
}

/* ---------- Coupons ---------- */

function couponsSheet_(){
  return ensureSheet_("Coupons", ["id","code","type","amount","enabled","createdAt","updatedAt"]);
}

function couponList_(){
  const sh = couponsSheet_();
  const rows = rowsToObjects_(sh.getDataRange().getValues());
  const items = rows.map(r => ({
    id: String(r.id||""),
    code: String(r.code||""),
    type: String(r.type||"percent"),
    amount: Number(r.amount||0),
    enabled: String(r.enabled||"true") !== "false"
  })).filter(c => c.enabled);
  return { items };
}

/* ---------- Bookings ---------- */

function bookingsSheet_(){
  return ensureSheet_("Bookings", ["id","email","date","address","cartJson","totalsJson","annual","createdAt"]);
}

function requireSession_(session){
  if (!session || !session.token) throw new Error("Not signed in.");
  // (simple trust model for now) – later we can validate token exists in Sessions sheet
  return session;
}

function bookingCreate_(p, session){
  const sess = requireSession_(session);
  const booking = p.booking || {};
  const id = String(booking.id || booking.bookingId || ("bk_" + Utilities.getUuid().slice(0,8)));
  const sh = bookingsSheet_();
  sh.appendRow([
    id,
    sess.email,
    String(booking.date||""),
    String(booking.address||""),
    JSON.stringify(booking.cart || []),
    JSON.stringify(booking.totals || {}),
    booking.annual ? true : false,
    nowIso_()
  ]);
  return { booking: { ...booking, id, email: sess.email } };
}

function bookingListByEmail_(p, session){
  const sess = requireSession_(session);
  const email = String((p && p.email) ? p.email : sess.email).trim();
  if (email.toLowerCase() !== String(sess.email||"").toLowerCase()) {
    // no cross-email reads for now
    throw new Error("Forbidden.");
  }
  const sh = bookingsSheet_();
  const rows = rowsToObjects_(sh.getDataRange().getValues());
  const items = rows
    .filter(r => String(r.email||"").toLowerCase() === email.toLowerCase())
    .map(r => ({
      id: String(r.id||""),
      email: String(r.email||""),
      date: String(r.date||""),
      address: String(r.address||""),
      cart: safeJson_(r.cartJson, []),
      totals: safeJson_(r.totalsJson, {}),
      annual: String(r.annual) === "true" || r.annual === true,
      createdAt: String(r.createdAt||"")
    }))
    .sort((a,b)=> String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  return { items };
}

/* ---------- Utils ---------- */

function safeJson_(v, fallback){
  try{
    if (v === null || v === undefined || v === "") return fallback;
    if (typeof v === "object") return v;
    return JSON.parse(String(v));
  }catch(e){
    return fallback;
  }
}

function json_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
