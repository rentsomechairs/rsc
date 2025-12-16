/**
 * RentSomeChairs Apps Script Backend (v1)
 * Deploy as a Web App (Execute as: Me, Access: Anyone).
 * Secure access is enforced via session tokens in requests.
 *
 * Required Script Properties:
 * - SHEET_ID (Google Sheet ID)
 * - OWNER_EMAIL (rentsomechairs@gmail.com)
 * - OWNER_PASSWORD (12poqw09-)
 * Optional:
 * - ADMIN_NOTIFY_EMAIL (email for admin notifications; defaults to OWNER_EMAIL)
 * - MAPS_API_KEY (for delivery.quote via Distance Matrix)
 */
function doPost(e){ return handle_(e); }
function doGet(e){ return handle_(e); }

function handle_(e){
  try{
    var req = parseRequest_(e);
    ensureSchema_();

    var action = String(req.body.action || '').trim();
    if (!action) return json_(400, { ok:false, error:'Missing action' });

    var auth = readAuth_(e);
    var out = route_(action, req.body, auth);

    return json_(200, Object.assign({ ok:true }, out || {}));
  }catch(err){
    return json_(500, { ok:false, error: String(err && err.message ? err.message : err) });
  }
}

function parseRequest_(e){
  var body = {};
  if (e && e.postData && e.postData.contents){
    try{ body = JSON.parse(e.postData.contents); } catch(_){}
  } else if (e && e.parameter && e.parameter.action){
    body = e.parameter;
  }
  return { body: body };
}

function props_(){ return PropertiesService.getScriptProperties(); }
function ss_(){
  var id = props_().getProperty('SHEET_ID');
  if (!id) throw new Error('Missing SHEET_ID Script Property');
  return SpreadsheetApp.openById(id);
}

function ensureSchema_(){
  var ss = ss_();
  ensureSheet_(ss, 'Users', ['email','passHash','passSalt','verified','role','name','phone','street','city','state','zip','notes','googleSub','createdAt','verifyCode','verifyExp','resetCode','resetExp']);
  ensureSheet_(ss, 'Sessions', ['token','email','role','createdAt','exp']);
  ensureSheet_(ss, 'Equipment', ['id','name','description','imageUrl','totalQty','increment','pricingTiersJson','isActive','updatedAt']);
  ensureSheet_(ss, 'Locations', ['id','name','address','notes','updatedAt']);
  ensureSheet_(ss, 'Coupons', ['code','type','amount','isActive','updatedAt']);
  ensureSheet_(ss, 'Bookings', ['id','email','date','status','itemsJson','addressJson','total','createdAt','updatedAt']);
  ensureSheet_(ss, 'Config', ['key','value']);
  ensureSheet_(ss, 'Audit', ['ts','email','action','detailJson']);
  seedOwnerIfMissing_();
}

function ensureSheet_(ss, name, headers){
  var sh = ss.getSheetByName(name);
  if (!sh){
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else {
    var existing = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    // If blank sheet, set headers
    if (existing.filter(String).length === 0){
      sh.getRange(1,1,1,headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function seedOwnerIfMissing_(){
  var ownerEmail = (props_().getProperty('OWNER_EMAIL') || '').toLowerCase();
  var ownerPass = props_().getProperty('OWNER_PASSWORD') || '';
  if (!ownerEmail || !ownerPass) return; // allow running without seeding if not set

  var users = ss_().getSheetByName('Users');
  var rows = users.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.email]||'').toLowerCase() === ownerEmail) return;
  }
  var salt = randomCode_(12);
  var hash = hashPass_(ownerPass, salt);
  users.appendRow([ownerEmail, hash, salt, true, 'owner', '', '', '', '', '', '', '', '', '', new Date().toISOString(), '', '', '', '']);
}

function headerIndex_(hdr){
  var m={};
  for (var i=0;i<hdr.length;i++) m[String(hdr[i])] = i;
  return m;
}

function route_(action, body, auth){
  switch(action){
    case 'equipment.list': return equipmentList_();
    case 'auth.guest': return authGuest_(body);
    case 'auth.email': return authEmail_(body);
    case 'auth.resendVerify': return authResendVerify_(body);
    case 'auth.verify': return authVerify_(body);
    case 'auth.google': return authGoogle_(body);
    case 'auth.logout': return authLogout_(auth);
    case 'me.get': return meGet_(auth);
    case 'booking.create': return bookingCreate_(body, auth);
    case 'booking.quote': return bookingQuote_(body, auth);
    case 'availability.check': return availabilityCheck_(body, auth);
    case 'booking.my': return bookingMy_(auth);
    case 'admin.snapshot': return adminSnapshot_(auth);
    case 'admin.saveEquipment': return adminSaveEquipment_(body, auth);
    case 'admin.saveLocations': return adminSaveLocations_(body, auth);
    case 'admin.saveCoupons': return adminSaveCoupons_(body, auth);
    case 'admin.getConfig': return adminGetConfig_(auth);
    case 'admin.setConfig': return adminSetConfig_(body, auth);
    case 'delivery.quote': return deliveryQuote_(body, auth);
    default: throw new Error('Unknown action: ' + action);
  }
}

// ---------- Auth helpers ----------
function readAuth_(e){
  var header = '';
  try{
    header = (e && e.headers && (e.headers.Authorization || e.headers.authorization)) || '';
  }catch(_){}
  header = String(header||'');
  if (header.indexOf('Bearer ') === 0){
    var token = header.slice(7).trim();
    return getSessionByToken_(token);
  }
  return null;
}

function newSession_(email, role){
  var token = Utilities.getUuid() + Utilities.getUuid();
  var now = new Date();
  var exp = new Date(now.getTime() + 1000*60*60*24*14); // 14 days
  var sh = ss_().getSheetByName('Sessions');
  sh.appendRow([token, email, role, now.toISOString(), exp.toISOString()]);
  return { token: token, email: email, role: role, exp: exp.toISOString() };
}

function getSessionByToken_(token){
  if (!token) return null;
  var sh = ss_().getSheetByName('Sessions');
  var rows = sh.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.token]||'') === token){
      var exp = new Date(String(rows[i][idx.exp]||''));
      if (exp.getTime() < Date.now()) return null;
      return { token: token, email: String(rows[i][idx.email]||''), role: String(rows[i][idx.role]||'user') };
    }
  }
  return null;
}

function requireAuth_(auth){
  if (!auth || !auth.email) throw new Error('Not signed in');
  return auth;
}
function requireAdmin_(auth){
  requireAuth_(auth);
  if (auth.role !== 'admin' && auth.role !== 'owner') throw new Error('Admin access required');
}

function randomCode_(len){
  var chars='0123456789';
  var out='';
  for (var i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

function hashPass_(pass, salt){
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '::' + pass, Utilities.Charset.UTF_8);
  return bytes.map(function(b){ var v=(b<0?b+256:b).toString(16); return (v.length===1?'0':'')+v; }).join('');
}

// ---------- Auth routes ----------
function authGuest_(body){
  var email = String(body.email || 'guest@rentsomechairs.local').toLowerCase();
  var session = newSession_(email, 'guest');
  return { session: session };
}

function authEmail_(body){
  var email = String(body.email||'').toLowerCase().trim();
  var password = String(body.password||'');
  if (!email || !password) throw new Error('Missing email or password');

  // owner shortcut
  var ownerEmail = (props_().getProperty('OWNER_EMAIL') || '').toLowerCase();
  var ownerPass = props_().getProperty('OWNER_PASSWORD') || '';
  if (ownerEmail && ownerPass && email === ownerEmail && password === ownerPass){
    var sess = newSession_(email, 'owner');
    return { session: sess };
  }

  var users = ss_().getSheetByName('Users');
  var rows = users.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);

  var rowIndex = -1;
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.email]||'').toLowerCase() === email){ rowIndex = i; break; }
  }

  if (rowIndex === -1){
    // create user -> require verify
    var salt = randomCode_(12);
    var hash = hashPass_(password, salt);
    var code = randomCode_(6);
    var exp = new Date(Date.now()+1000*60*15).toISOString(); // 15 min
    users.appendRow([email, hash, salt, false, 'user', '', '', '', '', '', '', '', '', '', new Date().toISOString(), code, exp, '', '']);
    sendVerify_(email, code);
    return { status:'verify_required' };
  }

  var salt2 = String(rows[rowIndex][idx.passSalt]||'');
  var hash2 = String(rows[rowIndex][idx.passHash]||'');
  if (hashPass_(password, salt2) !== hash2) throw new Error('Invalid email or password');

  var verified = String(rows[rowIndex][idx.verified]||'') === 'true' || rows[rowIndex][idx.verified] === true;
  if (!verified){
    var code2 = randomCode_(6);
    var exp2 = new Date(Date.now()+1000*60*15).toISOString();
    users.getRange(rowIndex+1, idx.verifyCode+1).setValue(code2);
    users.getRange(rowIndex+1, idx.verifyExp+1).setValue(exp2);
    sendVerify_(email, code2);
    return { status:'verify_required' };
  }

  var role = String(rows[rowIndex][idx.role]||'user') || 'user';
  var sess2 = newSession_(email, role);
  return { session: sess2 };
}

function authResendVerify_(body){
  var email = String(body.email||'').toLowerCase().trim();
  if (!email) throw new Error('Missing email');
  var users = ss_().getSheetByName('Users');
  var rows = users.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.email]||'').toLowerCase() === email){
      var code = randomCode_(6);
      var exp = new Date(Date.now()+1000*60*15).toISOString();
      users.getRange(i+1, idx.verifyCode+1).setValue(code);
      users.getRange(i+1, idx.verifyExp+1).setValue(exp);
      sendVerify_(email, code);
      return {};
    }
  }
  throw new Error('Email not found');
}

function authVerify_(body){
  var email = String(body.email||'').toLowerCase().trim();
  var code = String(body.code||'').trim();
  if (!email || !code) throw new Error('Missing email or code');

  var users = ss_().getSheetByName('Users');
  var rows = users.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.email]||'').toLowerCase() === email){
      var stored = String(rows[i][idx.verifyCode]||'').trim();
      var exp = new Date(String(rows[i][idx.verifyExp]||''));
      if (stored !== code) throw new Error('Invalid code');
      if (exp.getTime() < Date.now()) throw new Error('Code expired');
      users.getRange(i+1, idx.verified+1).setValue(true);
      users.getRange(i+1, idx.verifyCode+1).setValue('');
      users.getRange(i+1, idx.verifyExp+1).setValue('');
      var role = String(rows[i][idx.role]||'user') || 'user';
      var sess = newSession_(email, role);
      return { session: sess };
    }
  }
  throw new Error('Email not found');
}

function authGoogle_(body){
  var idToken = String(body.idToken||'');
  if (!idToken) throw new Error('Missing idToken');

  // Verify using tokeninfo endpoint (simple; not perfect). Works if UrlFetch is permitted.
  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions:true });
  if (resp.getResponseCode() !== 200) throw new Error('Google token invalid');
  var info = JSON.parse(resp.getContentText() || '{}');
  var email = String(info.email||'').toLowerCase();
  var sub = String(info.sub||'');
  if (!email) throw new Error('Google account missing email');

  var users = ss_().getSheetByName('Users');
  var rows = users.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);

  var rowIndex = -1;
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.email]||'').toLowerCase() === email){ rowIndex = i; break; }
  }
  if (rowIndex === -1){
    users.appendRow([email, '', '', true, 'user', '', '', '', '', '', '', '', '', '', new Date().toISOString(), '', '', '', '']);
    rowIndex = users.getLastRow()-1;
  }
  users.getRange(rowIndex+1, idx.googleSub+1).setValue(sub);
  users.getRange(rowIndex+1, idx.verified+1).setValue(true);

  var role = String(rows[rowIndex] ? rows[rowIndex][idx.role] : 'user') || 'user';
  var sess = newSession_(email, role);
  return { session: sess };
}

function authLogout_(auth){
  if (!auth || !auth.token) return {};
  var sh = ss_().getSheetByName('Sessions');
  var rows = sh.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.token]||'') === auth.token){
      sh.deleteRow(i+1);
      break;
    }
  }
  return {};
}

function sendVerify_(email, code){
  MailApp.sendEmail({
    to: email,
    subject: 'Your Rent Some Chairs verification code',
    htmlBody: 'Your verification code is <b>' + code + '</b>. It expires in 15 minutes.'
  });
}

// ---------- Public data ----------
function equipmentList_(){
  var sh = ss_().getSheetByName('Equipment');
  var rows = sh.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  var items = [];
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.isActive]||'true') === 'false') continue;
    items.push({
      id: String(rows[i][idx.id]||''),
      name: String(rows[i][idx.name]||''),
      description: String(rows[i][idx.description]||''),
      imageUrl: String(rows[i][idx.imageUrl]||''),
      totalQty: Number(rows[i][idx.totalQty]||0),
      increment: Number(rows[i][idx.increment]||0),
      pricingTiers: safeJson_(rows[i][idx.pricingTiersJson]) || []
    });
  }
  return { items: items };
}
function safeJson_(v){
  try{ return JSON.parse(String(v||'')); }catch(_){ return null; }
}

// ---------- Me / Profile ----------
function meGet_(auth){
  requireAuth_(auth);
  var email = auth.email;
  var users = ss_().getSheetByName('Users');
  var rows = users.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.email]||'').toLowerCase() === email){
      return { user: { email: email, role: String(rows[i][idx.role]||'user') } };
    }
  }
  return { user: { email: email, role: auth.role || 'user' } };
}

// ---------- Bookings ----------
function bookingCreate_(body, auth){
  requireAuth_(auth);
  var booking = body.booking || {};
  var date = String(booking.date||'').trim();
  var address = booking.address || {};
  var items = booking.items || [];
  if (!date) throw new Error('Missing date');
  if (!items.length) throw new Error('No items');
  if (!address || !address.street) throw new Error('Missing address');

  // server-side enforce availability vs equipment totals
  var equipmentMap = equipmentTotals_();
  var requested = {};
  items.forEach(function(it){
    var id = String(it.id||'');
    var qty = Number(it.qty||0);
    if (!id || qty<=0) return;
    requested[id] = (requested[id]||0) + qty;
  });

  // subtract existing bookings for date (pending/confirmed/delivered)
  var booked = bookedForDate_(date);
  for (var id2 in requested){
    var total = equipmentMap[id2] || 0;
    var used = booked[id2] || 0;
    if (requested[id2] > (total - used)) throw new Error('Not enough availability for ' + id2);
  }

  var id = 'B' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + Math.floor(Math.random()*1000000);
  var now = new Date().toISOString();

  var sh = ss_().getSheetByName('Bookings');
  sh.appendRow([id, auth.email, date, 'pending', JSON.stringify(items), JSON.stringify(address), '', now, now]);

  audit_(auth.email, 'booking.create', { id:id, date:date });
  notifyAdmin_('New booking: #' + id, 'New booking from ' + auth.email + ' for ' + date);

  return { booking: { id:id, date:date, status:'pending' } };
}


function bookingQuote_(body, auth){
  // Quote is safe for guests too (no requireAuth). It simply totals cart.
  var cart = (body.cart && body.cart.items) ? body.cart.items : (body.cart || []);
  if (!Array.isArray(cart)) cart = [];
  var subtotal = 0;
  for (var i=0;i<cart.length;i++){
    subtotal += (Number(cart[i].price)||0) * (Number(cart[i].qty)||0);
  }
  var checkout = body.checkout || {};
  var deliveryFee = Number(checkout.deliveryFee || 0);
  var discount = 0;
  // Optional coupon
  var couponCode = String(checkout.coupon||'').trim().toUpperCase();
  if (couponCode){
    var c = findActiveCoupon_(couponCode);
    if (c){
      if (String(c.type) === 'percent'){
        discount = subtotal * (Number(c.amount||0)/100);
      } else {
        discount = Number(c.amount||0);
      }
      if (discount > subtotal) discount = subtotal;
    }
  }
  var total = Math.max(0, subtotal + deliveryFee - discount);
  return { subtotal: subtotal, deliveryFee: deliveryFee, discount: discount, total: total };
}

function availabilityCheck_(body, auth){
  // MVP availability: true if requested qty <= equipment totals.
  // (Does not subtract existing bookings yet.)
  var cart = body.cart || [];
  if (!Array.isArray(cart)) cart = [];
  var totals = equipmentTotals_(); // {id: totalQty}
  for (var i=0;i<cart.length;i++){
    var id = String(cart[i].id||'');
    var qty = Number(cart[i].qty||0);
    var avail = Number(totals[id]||0);
    if (qty > avail) return { available:false, reason:'insufficient_inventory', id:id, availableQty:avail };
  }
  return { available:true };
}

function findActiveCoupon_(code){
  var sh = ss_().getSheetByName('Coupons');
  var rows = sh.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.code]||'').toUpperCase() === code){
      var isActive = String(rows[i][idx.isActive]||'true');
      if (isActive === 'true' || isActive === true){
        return {
          code: code,
          type: String(rows[i][idx.type]||'percent'),
          amount: Number(rows[i][idx.amount]||0)
        };
      }
    }
  }
  return null;
}

function bookingMy_(auth){
  requireAuth_(auth);
  var sh = ss_().getSheetByName('Bookings');
  var rows = sh.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  var items=[];
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.email]||'').toLowerCase() === auth.email.toLowerCase()){
      var itemsJson = safeJson_(rows[i][idx.itemsJson]) || [];
      items.push({
        id: String(rows[i][idx.id]||''),
        date: String(rows[i][idx.date]||''),
        status: String(rows[i][idx.status]||'pending'),
        items: itemsJson
      });
    }
  }
  return { items: items };
}

function equipmentTotals_(){
  var sh = ss_().getSheetByName('Equipment');
  var rows = sh.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  var m={};
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.isActive]||'true') === 'false') continue;
    m[String(rows[i][idx.id]||'')] = Number(rows[i][idx.totalQty]||0);
  }
  return m;
}

function bookedForDate_(date){
  var sh = ss_().getSheetByName('Bookings');
  var rows = sh.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  var used={};
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.date]||'') !== date) continue;
    var status = String(rows[i][idx.status]||'pending');
    if (['cancelled','returned'].indexOf(status) !== -1) continue;
    var items = safeJson_(rows[i][idx.itemsJson]) || [];
    items.forEach(function(it){
      var id = String(it.id||'');
      var qty = Number(it.qty||0);
      used[id] = (used[id]||0) + qty;
    });
  }
  return used;
}

// ---------- Admin ----------
function adminSnapshot_(auth){
  requireAdmin_(auth);
  var ss = ss_();
  var equip = equipmentList_().items;
  var loc = listSheetAsObjects_(ss.getSheetByName('Locations'));
  var coupons = listSheetAsObjects_(ss.getSheetByName('Coupons'));
  return { equipment: equip, locations: loc, coupons: coupons };
}

function listSheetAsObjects_(sh){
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  var idx = headerIndex_(rows[0]);
  var out=[];
  for (var i=1;i<rows.length;i++){
    var obj={};
    for (var k in idx){ obj[k] = rows[i][idx[k]]; }
    out.push(obj);
  }
  return out;
}

function adminSaveEquipment_(body, auth){
  requireAdmin_(auth);
  var items = body.items || [];
  var sh = ss_().getSheetByName('Equipment');
  // rewrite all (simple)
  sh.clearContents();
  sh.appendRow(['id','name','description','imageUrl','totalQty','increment','pricingTiersJson','isActive','updatedAt']);
  var now = new Date().toISOString();
  items.forEach(function(it){
    sh.appendRow([
      String(it.id||Utilities.getUuid()),
      String(it.name||''),
      String(it.description||''),
      String(it.imageUrl||''),
      Number(it.totalQty||0),
      Number(it.increment||0),
      JSON.stringify(it.pricingTiers||[]),
      (it.isActive===false?'false':'true'),
      now
    ]);
  });
  audit_(auth.email, 'admin.saveEquipment', { count: items.length });
  return {};
}

function adminSaveLocations_(body, auth){
  requireAdmin_(auth);
  var items = body.items || [];
  var sh = ss_().getSheetByName('Locations');
  sh.clearContents();
  sh.appendRow(['id','name','address','notes','updatedAt']);
  var now = new Date().toISOString();
  items.forEach(function(it){
    sh.appendRow([String(it.id||Utilities.getUuid()), String(it.name||''), String(it.address||''), String(it.notes||''), now]);
  });
  audit_(auth.email, 'admin.saveLocations', { count: items.length });
  return {};
}

function adminSaveCoupons_(body, auth){
  requireAdmin_(auth);
  var items = body.items || [];
  var sh = ss_().getSheetByName('Coupons');
  sh.clearContents();
  sh.appendRow(['code','type','amount','isActive','updatedAt']);
  var now = new Date().toISOString();
  items.forEach(function(it){
    sh.appendRow([String(it.code||'').toUpperCase(), String(it.type||'amount'), Number(it.amount||0), (it.isActive===false?'false':'true'), now]);
  });
  audit_(auth.email, 'admin.saveCoupons', { count: items.length });
  return {};
}

function adminGetConfig_(auth){
  requireAdmin_(auth);
  var sh = ss_().getSheetByName('Config');
  var rows = sh.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  var cfg={};
  for (var i=1;i<rows.length;i++){
    cfg[String(rows[i][idx.key])] = String(rows[i][idx.value]||'');
  }
  return { config: cfg };
}

function adminSetConfig_(body, auth){
  requireAdmin_(auth);
  var cfg = body.config || {};
  var sh = ss_().getSheetByName('Config');
  sh.clearContents();
  sh.appendRow(['key','value']);
  for (var k in cfg){
    sh.appendRow([k, String(cfg[k])]);
  }
  audit_(auth.email, 'admin.setConfig', { keys: Object.keys(cfg).length });
  return {};
}

function audit_(email, action, detail){
  var sh = ss_().getSheetByName('Audit');
  sh.appendRow([new Date().toISOString(), email, action, JSON.stringify(detail||{})]);
}

function notifyAdmin_(subject, body){
  var to = props_().getProperty('ADMIN_NOTIFY_EMAIL') || props_().getProperty('OWNER_EMAIL') || '';
  if (!to) return;
  MailApp.sendEmail({ to: to, subject: subject, body: body });
}

// ---------- Delivery quote ----------
function deliveryQuote_(body, auth){
  requireAuth_(auth);
  var key = props_().getProperty('MAPS_API_KEY') || '';
  if (!key) throw new Error('Missing MAPS_API_KEY Script Property');
  var address = body.address || {};
  var dest = String(address.street||'') + ', ' + String(address.city||'') + ', ' + String(address.state||'') + ' ' + String(address.zip||'');
  var base = getConfigValue_('base_address') || '';
  if (!base) throw new Error('Missing base_address in Config');

  var url = 'https://maps.googleapis.com/maps/api/distancematrix/json?origins=' + encodeURIComponent(base) + '&destinations=' + encodeURIComponent(dest) + '&key=' + encodeURIComponent(key);
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions:true });
  if (resp.getResponseCode() !== 200) throw new Error('Distance Matrix error');
  var data = JSON.parse(resp.getContentText()||'{}');
  var meters = data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0] && data.rows[0].elements[0].distance && data.rows[0].elements[0].distance.value;
  if (!meters) throw new Error('Distance not available');
  var miles = meters / 1609.344;

  // Simple fee rule: base_fee + per_mile * miles (from Config)
  var baseFee = Number(getConfigValue_('delivery_base_fee') || 0);
  var perMile = Number(getConfigValue_('delivery_per_mile') || 0);
  var maxMiles = Number(getConfigValue_('delivery_max_miles') || 0);
  if (maxMiles > 0 && miles > maxMiles) throw new Error('Outside service area');

  var fee = Math.max(0, baseFee + perMile * miles);
  return { quote: { miles: miles, fee: fee } };
}

function getConfigValue_(key){
  var sh = ss_().getSheetByName('Config');
  var rows = sh.getDataRange().getValues();
  var idx = headerIndex_(rows[0]);
  for (var i=1;i<rows.length;i++){
    if (String(rows[i][idx.key]||'') === key) return String(rows[i][idx.value]||'');
  }
  return '';
}

// ---------- response ----------
function json_(status, obj){
  var out = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  return out;
}
