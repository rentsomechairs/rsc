import { APP_CONFIG } from './config.js';
import { uid } from './utils.js';
import { deleteDocById, getDocById, bootstrapOrGetUserProfile, firebaseLogin, firebaseLogout, firebaseSignup, getCurrentFirebaseUser, isFirebaseEnabled, listCollection, listCollectionWhere, upsertDoc, updateDocFields, uploadFile, waitForAuthReady , callAdminFunction } from './firebase-service.js?v=rental-ux-v47';

const STORAGE_KEYS = {
  session: 'rso_session_v2',
  inventory: 'rso_inventory_v2',
  orders: 'rso_orders_v2',
  settings: 'rso_settings_v2',
  audit: 'rso_order_audit_v2',
  snapshots: 'rso_order_snapshots_v2',
  tracking: 'rso_order_tracking_v1',
  reviews: 'rso_order_reviews_v1',
  costs: 'rso_order_costs_v1',
  schedules: 'rso_schedules_v1',
  payoutRequests: 'rso_payout_requests_v1'
};

const COLLECTIONS = {
  inventory: 'inventory',
  orders: 'orders',
  settings: 'settings',
  audit: 'orderAuditLog',
  snapshots: 'orderSnapshots',
  tracking: 'orderTracking',
  reviews: 'reviews',
  costs: 'costs',
  users: 'users',
  schedules: 'schedules',
  payoutRequests: 'payoutRequests'
};


const PAYMENT_METHOD_DEFS = [
  { key: 'cash', label: 'Cash' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'venmo', label: 'Venmo' },
  { key: 'paypal', label: 'PayPal' },
  { key: 'cashapp', label: 'Cash App' },
  { key: 'zelle', label: 'Zelle' },
  { key: 'googlepay', label: 'Google Pay' },
  { key: 'crypto', label: 'Crypto' }
];

function buildDefaultPaymentOptions() {
  return PAYMENT_METHOD_DEFS.reduce((acc, method) => {
    acc[method.key] = { key: method.key, label: method.label, active: false, value: '', url: '' };
    return acc;
  }, {});
}

function normalizePaymentOptions(value) {
  const merged = buildDefaultPaymentOptions();
  const source = value && typeof value === 'object' ? value : {};
  for (const def of PAYMENT_METHOD_DEFS) {
    merged[def.key] = {
      key: def.key,
      label: source?.[def.key]?.label || def.label,
      active: Boolean(source?.[def.key]?.active),
      value: source?.[def.key]?.value || '',
      url: source?.[def.key]?.url || ''
    };
  }
  return merged;
}

const defaultSettings = {
  businessName: 'Rent Some Chairs',
  pickupName: 'Rent Some Chairs Pickup',
  pickupAddress: '123 Example St, Garner, NC 27529',
  deliveryRatePerMile: 2,
  depositMinimumOrder: 100,
  notificationEmail: 'you@example.com',
  emailNotificationsEnabled: false,
  emailjsPublicKey: '',
  emailjsServiceId: '',
  emailjsTemplateId: '',
  googleMapsApiKey: '',
  notificationFromName: 'Rent Some Orders',
  homeHeroImageUrl: '',
  homeQuoteImageUrl: '',
  homeBrowseImageUrl: '',
  homeTrackImageUrl: '',
  homeHeroImageData: '',
  homeQuoteImageData: '',
  homeBrowseImageData: '',
  homeTrackImageData: '',
  inventoryImageBackground: { mode: 'linear', color1: '#f8fafc', color2: '#dbeafe', angle: 135, texture: 'none', textureOpacity: 0.18, imageScale: 1.08, imageX: 0, imageY: 0, shadowEnabled: true, shadowColor: '#0f172a', shadowOpacity: 0.28, shadowBlur: 14, shadowX: 0, shadowY: 7, edgeGlow: 0.12, brightness: 1, contrast: 1.04, saturation: 1 },
  pickupCoords: null,
  pickupGeocodedAddress: '',
  pickupGeocodeUpdatedAt: '',
  paymentOptions: buildDefaultPaymentOptions()
};

const placeholderSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#dbeafe" />
      <stop offset="1" stop-color="#e2e8f0" />
    </linearGradient>
  </defs>
  <rect width="600" height="400" fill="url(#g)" />
  <circle cx="100" cy="80" r="44" fill="#bfdbfe" />
  <rect x="120" y="130" width="350" height="110" rx="18" fill="#ffffff" opacity="0.9" />
  <rect x="150" y="160" width="190" height="20" rx="10" fill="#93c5fd" />
  <rect x="150" y="196" width="130" height="18" rx="9" fill="#cbd5e1" />
  <rect x="390" y="140" width="110" height="90" rx="14" fill="#dbeafe" />
</svg>
`)}`;

const seedInventory = [
  {
    id: uid('inv'),
    category: 'Chairs',
    name: 'White Folding Chair',
    description: 'Simple white folding chair for parties and events.',
    imageUrl: placeholderSvg,
    price: 2.5,
    stock: 120,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: uid('inv'),
    category: 'Tables',
    name: '6 Foot Banquet Table',
    description: 'Standard rectangular event table.',
    imageUrl: placeholderSvg,
    price: 10,
    stock: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: uid('inv'),
    category: 'Linens',
    name: 'Black Fitted Table Cover',
    description: 'Stretch fitted black cover for 6 foot table.',
    imageUrl: placeholderSvg,
    price: 7,
    stock: 8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const seedOrders = [
  {
    id: uid('ord'),
    firstName: 'Sample',
    lastName: 'Customer',
    status: 'Confirmed',
    paymentStatus: 'Un-Paid',
    fulfillmentType: 'Pickup',
    exchangeDate: futureDate(1),
    exchangeTime: '19:00',
    returnDate: futureDate(2),
    returnTime: '17:00',
    total: 55,
    subtotal: 55,
    deliveryFee: 0,
    deliveryMiles: 0,
    address: '',
    contactMethods: { text: '(555) 111-2222' },
    items: [
      { inventoryId: seedInventory[0].id, name: 'White Folding Chair', category: 'Chairs', imageUrl: seedInventory[0].imageUrl, unitPrice: 2.5, quantity: 10, subtotal: 25 },
      { inventoryId: seedInventory[1].id, name: '6 Foot Banquet Table', category: 'Tables', imageUrl: seedInventory[1].imageUrl, unitPrice: 10, quantity: 3, subtotal: 30 }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    newInquiry: false,
    source: 'admin'
  }
];

let cacheInventory = [];
let cacheOrders = [];
let cacheSettings = { ...defaultSettings };
let cacheAudit = [];
let cacheSnapshots = [];
let cacheTracking = [];
let cacheReviews = [];
let cacheCosts = [];
let cacheUsers = [];
let localSeeded = false;

function futureDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function appendLocal(key, value) {
  const current = read(key, []);
  current.unshift(value);
  write(key, current);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function docsAreDifferent(previous, next) {
  return JSON.stringify(previous || {}) !== JSON.stringify(next || {});
}

function hydrateCachesFromLocal() {
  ensureSeedData();
  cacheInventory = read(STORAGE_KEYS.inventory, []);
  cacheOrders = read(STORAGE_KEYS.orders, []);
  cacheSettings = read(STORAGE_KEYS.settings, defaultSettings);
  cacheAudit = read(STORAGE_KEYS.audit, []);
  cacheSnapshots = read(STORAGE_KEYS.snapshots, []);
  cacheTracking = read(STORAGE_KEYS.tracking, []);
  cacheReviews = read(STORAGE_KEYS.reviews, []);
  cacheCosts = read(STORAGE_KEYS.costs, []);
}

export function ensureSeedData() {
  if (localSeeded) return;
  if (!read(STORAGE_KEYS.inventory, null)) write(STORAGE_KEYS.inventory, seedInventory);
  if (!read(STORAGE_KEYS.orders, null)) write(STORAGE_KEYS.orders, seedOrders);
  if (!read(STORAGE_KEYS.settings, null)) write(STORAGE_KEYS.settings, defaultSettings);
  if (!read(STORAGE_KEYS.audit, null)) write(STORAGE_KEYS.audit, []);
  if (!read(STORAGE_KEYS.snapshots, null)) write(STORAGE_KEYS.snapshots, []);
  if (!read(STORAGE_KEYS.tracking, null)) write(STORAGE_KEYS.tracking, []);
  if (!read(STORAGE_KEYS.reviews, null)) write(STORAGE_KEYS.reviews, []);
  if (!read(STORAGE_KEYS.costs, null)) write(STORAGE_KEYS.costs, []);
  localSeeded = true;
}

export async function getInventory() {
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheInventory);
  }
  const items = await listCollection(COLLECTIONS.inventory);
  cacheInventory = items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return clone(cacheInventory);
}

export async function saveInventory(items) {
  cacheInventory = clone(items);
  if (!isFirebaseEnabled()) {
    write(STORAGE_KEYS.inventory, cacheInventory);
    return;
  }
  const current = await listCollection(COLLECTIONS.inventory);
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const nextIds = new Set(cacheInventory.map((item) => item.id));

  for (const item of cacheInventory) {
    if (docsAreDifferent(currentMap.get(item.id), item)) {
      await upsertDoc(COLLECTIONS.inventory, item.id, item);
    }
  }

  for (const [id] of currentMap.entries()) {
    if (!nextIds.has(id)) await deleteDocById(COLLECTIONS.inventory, id);
  }
}


// Routine inventory edits must never rewrite/synchronize the whole collection.
export async function saveSingleInventoryItem(item) {
  const cleanItem = clone(item);
  if (!cleanItem?.id) throw new Error('Inventory item ID is required.');
  cacheInventory = cacheInventory.some((entry) => entry.id === cleanItem.id)
    ? cacheInventory.map((entry) => entry.id === cleanItem.id ? cleanItem : entry)
    : [cleanItem, ...cacheInventory];
  if (!isFirebaseEnabled()) {
    write(STORAGE_KEYS.inventory, cacheInventory);
    return clone(cleanItem);
  }
  await upsertDoc(COLLECTIONS.inventory, cleanItem.id, cleanItem);

  // Do not report success based on local state alone. Read the exact inventory
  // document back from Firestore and verify the replacement image persisted.
  // This prevents the old behavior where a new image looked correct until refresh.
  const persisted = await getDocById(COLLECTIONS.inventory, cleanItem.id);
  if (!persisted) throw new Error('Inventory save could not be verified in Firebase.');
  const expectedImageData = String(cleanItem.imageData || '');
  const savedImageData = String(persisted.imageData || '');
  const expectedImageUrl = String(cleanItem.imageUrl || '');
  const savedImageUrl = String(persisted.imageUrl || '');
  if (savedImageData !== expectedImageData || savedImageUrl !== expectedImageUrl) {
    throw new Error('Firebase did not retain the replacement inventory image. The old image was not replaced.');
  }
  cacheInventory = cacheInventory.map((entry) => entry.id === cleanItem.id ? persisted : entry);
  return clone(persisted);
}

export async function deleteSingleInventoryItem(itemOrId) {
  const id = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
  if (!id) return;
  cacheInventory = cacheInventory.filter((entry) => entry.id !== id);
  if (!isFirebaseEnabled()) {
    write(STORAGE_KEYS.inventory, cacheInventory);
    return;
  }
  await deleteDocById(COLLECTIONS.inventory, id);
}


export async function getAssignedOrders(employeeUid) {
  if (!isFirebaseEnabled()) return clone(cacheOrders.filter((order) => order.assignedEmployeeId === employeeUid));
  cacheOrders = await listCollectionWhere(COLLECTIONS.orders, 'assignedEmployeeId', '==', employeeUid);
  return clone(cacheOrders);
}

export async function getOrders() {
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheOrders);
  }
  const items = await listCollection(COLLECTIONS.orders);
  cacheOrders = items;
  return clone(cacheOrders);
}

export async function getOpenOrders() {
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheOrders.filter((order) => String(order.status || '') !== 'Completed'));
  }
  const statuses = ['Pending', 'Confirmed', 'In-Progress'];
  const groups = await Promise.all(statuses.map((status) => listCollectionWhere(COLLECTIONS.orders, 'status', '==', status)));
  const items = groups.flat();
  const merged = new Map(cacheOrders.map((item) => [item.id, item]));
  items.forEach((item) => merged.set(item.id, item));
  cacheOrders = [...merged.values()];
  return clone(items);
}

export async function getCompletedOrders() {
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheOrders.filter((order) => String(order.status || '') === 'Completed'));
  }
  const items = await listCollectionWhere(COLLECTIONS.orders, 'status', '==', 'Completed');
  const merged = new Map(cacheOrders.map((item) => [item.id, item]));
  items.forEach((item) => merged.set(item.id, item));
  cacheOrders = [...merged.values()];
  return clone(items);
}

function summarizeOrderForLog(order = {}) {
  return {
    status: order.status || '',
    total: Number(order.total || 0),
    fulfillmentType: order.fulfillmentType || '',
    firstName: order.firstName || '',
    lastName: order.lastName || ''
  };
}

function getSnapshotEffectiveTotal(order = {}) {
  if (order.adjustedTotal !== '' && order.adjustedTotal != null && !Number.isNaN(Number(order.adjustedTotal))) return Number(order.adjustedTotal || 0);
  if (!Number.isNaN(Number(order.total))) return Number(order.total || 0);
  return Number(order.baseTotal || 0);
}
function getSnapshotDepositAmount(order = {}) {
  if (Number(order.depositAmount || 0) > 0) return Number(order.depositAmount || 0);
  return Boolean(order.requiresDeposit) ? Math.max(0, Math.round(getSnapshotEffectiveTotal(order) * 0.35)) : 0;
}
function getSnapshotAmountPaid(order = {}) {
  const status = String(order.paymentStatus || '');
  const total = getSnapshotEffectiveTotal(order);
  if (status === 'Paid' || status === 'Free') return total;
  if (status === 'Deposit Paid' || status === 'Deposit') {
    const candidates = [order.depositPaidAmount, order.amountPaid, order.depositAmount];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return Math.min(value, total);
    }
    return Math.min(getSnapshotDepositAmount(order), total);
  }
  return Number(order.amountPaid || 0);
}
function getSnapshotAmountRemaining(order = {}) {
  const status = String(order.paymentStatus || '');
  if (Number.isFinite(Number(order.amountRemaining)) && Number(order.amountRemaining) >= 0 && ['Paid', 'Free', 'Deposit Paid', 'Deposit'].includes(status)) return Number(order.amountRemaining || 0);
  return Math.max(0, getSnapshotEffectiveTotal(order) - getSnapshotAmountPaid(order));
}
function createTrackingSnapshot(order = {}, settings = cacheSettings) {
  return {
    id: order.id,
    trackingCode: order.trackingCode || '',
    trackingAccessCode: order.trackingAccessCode || '',
    firstName: order.firstName || '',
    lastName: order.lastName || '',
    status: order.status || '',
    paymentStatus: order.paymentStatus || '',
    fulfillmentType: order.fulfillmentType || '',
    eventName: order.eventName || '',
    exchangeDate: order.exchangeDate || '',
    exchangeTime: order.exchangeTime || '',
    returnDate: order.returnDate || '',
    returnTime: order.returnTime || '',
    address: order.address || '',
    contactMethods: order.contactMethods && typeof order.contactMethods === 'object' ? order.contactMethods : {},
    pickupAddress: order.assignedEmployeePickupAddress || settings?.pickupAddress || '',
    total: Number(order.total || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    setupFee: Number(order.setupFee || 0),
    amountPaid: getSnapshotAmountPaid(order),
    amountRemaining: getSnapshotAmountRemaining(order),
    depositAmount: getSnapshotDepositAmount(order),
    depositPaidAmount: order.depositPaidAmount ?? '',
    requiresDeposit: Boolean(order.requiresDeposit),
    depositWaived: Boolean(order.depositWaived),
    verbalConfirmation: Boolean(order.verbalConfirmation),
    equipmentStillDiscussing: Boolean(order.equipmentStillDiscussing),
    listedTotal: Number(order.listedTotal || 0),
    baseTotal: Number(order.baseTotal || 0),
    adjustedTotal: order.adjustedTotal ?? '',
    items: Array.isArray(order.items) ? order.items : [],
    updatedAt: order.updatedAt || '',
    createdAt: order.createdAt || ''
  };
}

async function syncTrackingCollection(orders) {
  cacheTracking = (orders || []).map((order) => createTrackingSnapshot(order));
  if (!isFirebaseEnabled()) {
    write(STORAGE_KEYS.tracking, cacheTracking);
    return;
  }
  const current = await listCollection(COLLECTIONS.tracking);
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const nextIds = new Set(cacheTracking.map((item) => item.id));

  for (const item of cacheTracking) {
    if (docsAreDifferent(currentMap.get(item.id), item)) {
      await upsertDoc(COLLECTIONS.tracking, item.id, item);
    }
  }

  for (const [id] of currentMap.entries()) {
    if (!nextIds.has(id)) await deleteDocById(COLLECTIONS.tracking, id);
  }
}


async function syncSingleTrackingRecord(order) {
  const item = createTrackingSnapshot(order);
  cacheTracking = cacheTracking.some((entry) => entry.id === item.id)
    ? cacheTracking.map((entry) => entry.id === item.id ? item : entry)
    : [item, ...cacheTracking];
  if (!isFirebaseEnabled()) {
    const current = read(STORAGE_KEYS.tracking, []);
    const next = current.some((entry) => entry.id === item.id)
      ? current.map((entry) => entry.id === item.id ? item : entry)
      : [item, ...current];
    write(STORAGE_KEYS.tracking, next);
    return;
  }
  await upsertDoc(COLLECTIONS.tracking, item.id, item);
}

async function appendAuditLog(entry) {
  const payload = {
    id: uid('audit'),
    timestamp: new Date().toISOString(),
    ...entry
  };
  cacheAudit.unshift(payload);
  if (!isFirebaseEnabled()) {
    appendLocal(STORAGE_KEYS.audit, payload);
    return;
  }
  await upsertDoc(COLLECTIONS.audit, payload.id, payload);
}


export async function createQuickPickerOrder(order) {
  const cleanOrder = clone(order);
  if (!isFirebaseEnabled()) {
    const previous = read(STORAGE_KEYS.orders, []);
    if (previous.some((item) => item.id === cleanOrder.id)) {
      const error = new Error('duplicate-order');
      error.code = 'duplicate-order';
      throw error;
    }
    write(STORAGE_KEYS.orders, [cleanOrder, ...previous]);
    cacheOrders = [cleanOrder, ...previous];
    await syncSingleTrackingRecord(cleanOrder);
    return clone(cleanOrder);
  }
  try {
    await upsertDoc(COLLECTIONS.orders, cleanOrder.id, cleanOrder);
    cacheOrders = [cleanOrder, ...cacheOrders.filter((item) => item.id !== cleanOrder.id)];
    await syncSingleTrackingRecord(cleanOrder);
    return clone(cleanOrder);
  } catch (error) {
    if (error?.code === 'permission-denied' || error?.code === 'already-exists') {
      const duplicate = new Error('duplicate-order');
      duplicate.code = 'duplicate-order';
      duplicate.cause = error;
      throw duplicate;
    }
    throw error;
  }
}

export async function saveOrders(orders, meta = { actor: 'app' }) {
  cacheOrders = clone(orders);
  if (!isFirebaseEnabled()) {
    const previous = read(STORAGE_KEYS.orders, []);
    write(STORAGE_KEYS.orders, cacheOrders);
    await syncTrackingCollection(cacheOrders);
    await auditDiff(previous, cacheOrders, meta);
    return;
  }

  const previous = await listCollection(COLLECTIONS.orders);
  const previousMap = new Map(previous.map((item) => [item.id, item]));
  const nextIds = new Set(cacheOrders.map((item) => item.id));

  for (const item of cacheOrders) {
    if (docsAreDifferent(previousMap.get(item.id), item)) {
      await upsertDoc(COLLECTIONS.orders, item.id, item);
    }
  }

  for (const [id] of previousMap.entries()) {
    if (!nextIds.has(id)) await deleteDocById(COLLECTIONS.orders, id);
  }

  await syncTrackingCollection(cacheOrders);
  await auditDiff(previous, cacheOrders, meta);
}


export async function saveSingleOrder(order, previousOrder = null, meta = { actor: 'app' }) {
  const cleanOrder = clone(order);
  cacheOrders = cacheOrders.some((item) => item.id === cleanOrder.id)
    ? cacheOrders.map((item) => item.id === cleanOrder.id ? cleanOrder : item)
    : [cleanOrder, ...cacheOrders];

  if (!isFirebaseEnabled()) {
    const previous = read(STORAGE_KEYS.orders, []);
    cacheOrders = previous.some((item) => item.id === cleanOrder.id)
      ? previous.map((item) => item.id === cleanOrder.id ? cleanOrder : item)
      : [cleanOrder, ...previous];
    write(STORAGE_KEYS.orders, cacheOrders);
    await syncSingleTrackingRecord(cleanOrder);
    const old = previousOrder || previous.find((item) => item.id === cleanOrder.id) || null;
    if (!old) {
      await appendAuditLog({ action: 'created', orderId: cleanOrder.id, actor: meta.actor, summary: summarizeOrderForLog(cleanOrder), orderSnapshot: cleanOrder });
    } else if (JSON.stringify(old) !== JSON.stringify(cleanOrder)) {
      await appendAuditLog({ action: 'updated', orderId: cleanOrder.id, actor: meta.actor, summary: summarizeOrderForLog(cleanOrder), orderSnapshot: cleanOrder, previousSnapshot: old });
    }
    return clone(cleanOrder);
  }

  await upsertDoc(COLLECTIONS.orders, cleanOrder.id, cleanOrder);
  await syncSingleTrackingRecord(cleanOrder);

  if (!previousOrder) {
    await appendAuditLog({ action: 'created', orderId: cleanOrder.id, actor: meta.actor, summary: summarizeOrderForLog(cleanOrder), orderSnapshot: cleanOrder });
  } else if (JSON.stringify(previousOrder) !== JSON.stringify(cleanOrder)) {
    await appendAuditLog({ action: 'updated', orderId: cleanOrder.id, actor: meta.actor, summary: summarizeOrderForLog(cleanOrder), orderSnapshot: cleanOrder, previousSnapshot: previousOrder });
  }

  return clone(cleanOrder);
}


export async function saveEmployeeOrderProgress(orderId, employeeUid, changes = {}) {
  const current = cacheOrders.find((item) => item.id === orderId);
  if (!current) throw new Error('Assigned order was not found.');
  if (String(current.assignedEmployeeId || '') !== String(employeeUid || '')) throw new Error('This order is not assigned to you.');

  const allowedStatus = new Set(['Confirmed', 'In-Progress', 'Completed']);
  const next = clone(current);
  if (changes.exchangeTime !== undefined) next.exchangeTime = String(changes.exchangeTime || '');
  if (changes.returnTime !== undefined) next.returnTime = String(changes.returnTime || '');
  if (changes.status !== undefined) {
    const status = String(changes.status || '');
    if (!allowedStatus.has(status)) throw new Error('That order status is not available to employees.');
    next.status = status;
    if (status === 'Completed') {
      next.completedAt = next.completedAt || new Date().toISOString();
      const isFree = Boolean(next.free) || String(next.paymentStatus || '').toLowerCase() === 'free' || getSnapshotEffectiveTotal(next) <= 0;
      if (!isFree) {
        const total = getSnapshotEffectiveTotal(next);
        next.paymentStatus = 'Paid';
        next.amountPaid = total;
        next.depositPaidAmount = total;
        next.amountRemaining = 0;
      }
    } else {
      next.completedAt = '';
    }
  }
  next.updatedAt = new Date().toISOString();

  cacheOrders = cacheOrders.map((item) => item.id === next.id ? next : item);
  if (!isFirebaseEnabled()) {
    const previous = read(STORAGE_KEYS.orders, []);
    write(STORAGE_KEYS.orders, previous.map((item) => item.id === next.id ? next : item));
    await syncSingleTrackingRecord(next);
    return clone(next);
  }

  // Use partial updates so employee writes contain only the explicitly allowed
  // progress fields. Firestore rules independently enforce the same field list.
  const orderPatch = { updatedAt: next.updatedAt };
  if (changes.exchangeTime !== undefined) orderPatch.exchangeTime = next.exchangeTime;
  if (changes.returnTime !== undefined) orderPatch.returnTime = next.returnTime;
  if (changes.status !== undefined) {
    orderPatch.status = next.status;
    orderPatch.completedAt = next.completedAt;
    orderPatch.paymentStatus = next.paymentStatus;
    orderPatch.amountPaid = next.amountPaid ?? 0;
    orderPatch.depositPaidAmount = next.depositPaidAmount ?? '';
    orderPatch.amountRemaining = next.amountRemaining ?? getSnapshotAmountRemaining(next);
  }
  await updateDocFields(COLLECTIONS.orders, next.id, orderPatch);

  const trackingPatch = { updatedAt: next.updatedAt };
  if (changes.exchangeTime !== undefined) trackingPatch.exchangeTime = next.exchangeTime;
  if (changes.returnTime !== undefined) trackingPatch.returnTime = next.returnTime;
  if (changes.status !== undefined) {
    trackingPatch.status = next.status;
    trackingPatch.paymentStatus = next.paymentStatus;
    trackingPatch.amountPaid = getSnapshotAmountPaid(next);
    trackingPatch.depositPaidAmount = next.depositPaidAmount ?? '';
    trackingPatch.amountRemaining = getSnapshotAmountRemaining(next);
  }
  await updateDocFields(COLLECTIONS.tracking, next.id, trackingPatch);
  return clone(next);
}

export async function deleteSingleOrder(orderOrId, meta = { actor: 'app' }) {
  const id = typeof orderOrId === 'string' ? orderOrId : orderOrId?.id;
  if (!id) return;
  const previousOrder = typeof orderOrId === 'object' ? clone(orderOrId) : cacheOrders.find((item) => item.id === id) || null;
  cacheOrders = cacheOrders.filter((item) => item.id !== id);
  cacheTracking = cacheTracking.filter((item) => item.id !== id);

  if (!isFirebaseEnabled()) {
    const previous = read(STORAGE_KEYS.orders, []);
    const old = previousOrder || previous.find((item) => item.id === id) || null;
    write(STORAGE_KEYS.orders, previous.filter((item) => item.id !== id));
    write(STORAGE_KEYS.tracking, read(STORAGE_KEYS.tracking, []).filter((item) => item.id !== id));
    if (old) await appendAuditLog({ action: 'deleted', orderId: id, actor: meta.actor, summary: summarizeOrderForLog(old), previousSnapshot: old });
    return;
  }

  await deleteDocById(COLLECTIONS.orders, id);
  await deleteDocById(COLLECTIONS.tracking, id);
  if (previousOrder) await appendAuditLog({ action: 'deleted', orderId: id, actor: meta.actor, summary: summarizeOrderForLog(previousOrder), previousSnapshot: previousOrder });
}

async function auditDiff(previous, next, meta) {
  const previousMap = new Map(previous.map((item) => [item.id, item]));
  const nextMap = new Map(next.map((item) => [item.id, item]));

  for (const [id, order] of nextMap.entries()) {
    const old = previousMap.get(id);
    if (!old) {
      await appendAuditLog({ action: 'created', orderId: id, actor: meta.actor, summary: summarizeOrderForLog(order), orderSnapshot: order });
      continue;
    }
    if (JSON.stringify(old) !== JSON.stringify(order)) {
      await appendAuditLog({ action: 'updated', orderId: id, actor: meta.actor, summary: summarizeOrderForLog(order), orderSnapshot: order, previousSnapshot: old });
    }
  }

  for (const [id, order] of previousMap.entries()) {
    if (!nextMap.has(id)) {
      await appendAuditLog({ action: 'deleted', orderId: id, actor: meta.actor, summary: summarizeOrderForLog(order), previousSnapshot: order });
    }
  }
}

export async function getPublicTrackingRecords() {
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheTracking);
  }
  const items = await listCollection(COLLECTIONS.tracking);
  cacheTracking = items;
  return clone(cacheTracking);
}

export async function getPublicTrackingRecord(trackingCode) {
  const code = String(trackingCode || '').trim().toUpperCase();
  if (!code) return null;
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheTracking.find((entry) => String(entry.trackingCode || '').trim().toUpperCase() === code) || null);
  }
  const items = await listCollectionWhere(COLLECTIONS.tracking, 'trackingCode', '==', code);
  const item = items[0] || null;
  if (item) {
    cacheTracking = cacheTracking.some((entry) => entry.id === item.id)
      ? cacheTracking.map((entry) => entry.id === item.id ? item : entry)
      : [item, ...cacheTracking];
  }
  return clone(item);
}

export async function getSettings() {
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheSettings);
  }
  const docs = await listCollection(COLLECTIONS.settings);
  const appDoc = docs.find((item) => item.id === 'app');
  cacheSettings = { ...defaultSettings, ...(appDoc || {}) };
  cacheSettings.paymentOptions = normalizePaymentOptions(cacheSettings.paymentOptions);
  return clone(cacheSettings);
}

export async function saveSettings(settings) {
  cacheSettings = { ...defaultSettings, ...clone(settings), id: 'app' };
  cacheSettings.paymentOptions = normalizePaymentOptions(cacheSettings.paymentOptions);
  if (!isFirebaseEnabled()) {
    write(STORAGE_KEYS.settings, cacheSettings);
    return;
  }
  await upsertDoc(COLLECTIONS.settings, 'app', cacheSettings);
}

export function getCategories() {
  const set = new Set((cacheInventory || []).map((item) => item.category).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b));
}



export async function getCurrentUserProfile() {
  if (!isFirebaseEnabled()) {
    const session = read(STORAGE_KEYS.session, null);
    return session ? { id: 'local-admin', uid: 'local-admin', email: session.email || '', role: 'admin', status: 'approved' } : null;
  }
  const user = await waitForAuthReady().then(() => getCurrentFirebaseUser());
  return user ? bootstrapOrGetUserProfile(user) : null;
}

export async function getUsers() {
  if (!isFirebaseEnabled()) return clone(cacheUsers);
  cacheUsers = await listCollection(COLLECTIONS.users);
  return clone(cacheUsers);
}


export async function getSchedules() {
  if (!isFirebaseEnabled()) return clone(read(STORAGE_KEYS.schedules, []));
  return clone(await listCollection(COLLECTIONS.schedules));
}

export async function getSchedule(uidValue) {
  if (!uidValue) return null;
  if (!isFirebaseEnabled()) return clone((read(STORAGE_KEYS.schedules, []) || []).find((row) => String(row.uid || row.id) === String(uidValue)) || null);
  return clone(await getDocById(COLLECTIONS.schedules, uidValue));
}

export async function saveSchedule(schedule = {}) {
  const uidValue = String(schedule.uid || schedule.id || '').trim();
  if (!uidValue) throw new Error('Schedule UID is required.');
  const next = { ...clone(schedule), uid: uidValue, updatedAt: new Date().toISOString() };
  delete next.id;
  if (!isFirebaseEnabled()) {
    const rows = read(STORAGE_KEYS.schedules, []) || [];
    const saved = [{ id: uidValue, ...next }, ...rows.filter((row) => String(row.uid || row.id) !== uidValue)];
    write(STORAGE_KEYS.schedules, saved);
    return clone({ id: uidValue, ...next });
  }
  await upsertDoc(COLLECTIONS.schedules, uidValue, next);
  return clone({ id: uidValue, ...next });
}

export async function saveUserProfile(profile) {
  const next = { ...clone(profile), uid: profile.uid || profile.id, updatedAt: new Date().toISOString() };
  await upsertDoc(COLLECTIONS.users, next.uid, next);
  cacheUsers = cacheUsers.filter((u) => (u.uid || u.id) !== next.uid).concat(next);
  return clone(next);
}


export async function saveOwnContractAcceptance(profile, acceptance = {}) {
  const uidValue = profile?.uid || profile?.id;
  if (!uidValue) throw new Error('Employee profile UID is required.');
  const next = { ...clone(profile), uid: uidValue, contractAcceptance: clone(acceptance), updatedAt: new Date().toISOString() };
  delete next.id;
  await upsertDoc(COLLECTIONS.users, uidValue, next);
  const cached = { id: uidValue, ...next };
  cacheUsers = cacheUsers.filter((u) => (u.uid || u.id) !== uidValue).concat(cached);
  return clone(cached);
}

export async function deleteUserProfile(uid) {
  if (!uid) return;
  if (isFirebaseEnabled()) await deleteDocById(COLLECTIONS.users, uid);
  cacheUsers = cacheUsers.filter((u) => (u.uid || u.id) !== uid);
}


export async function getUserProfile(uidValue) {
  if (!uidValue) return null;
  if (!isFirebaseEnabled()) return clone((cacheUsers || []).find((u) => String(u.uid || u.id) === String(uidValue)) || null);
  return clone(await getDocById(COLLECTIONS.users, uidValue));
}

export async function getSecondaryUsers(primaryUid) {
  if (!primaryUid) return [];
  if (!isFirebaseEnabled()) return clone((cacheUsers || []).filter((u) => u.role === 'secondary' && String(u.primaryEmployeeId || '') === String(primaryUid)));
  return clone(await listCollectionWhere(COLLECTIONS.users, 'primaryEmployeeId', '==', primaryUid));
}

export async function signupSecondaryEmployee(data) {
  if (!isFirebaseEnabled()) throw new Error('Secondary signup requires Firebase.');
  const primaryEmployeeId = String(data.primaryEmployeeId || '').trim();
  if (!primaryEmployeeId) throw new Error('This invite link is missing the primary employee.');
  const credential = await firebaseSignup(String(data.email || '').trim(), String(data.password || ''));
  const now = new Date().toISOString();
  const profile = {
    uid: credential.user.uid,
    email: credential.user.email || String(data.email || '').trim(),
    firstName: String(data.firstName || '').trim(),
    lastName: String(data.lastName || '').trim(),
    phone: String(data.phone || '').trim(),
    role: 'secondary',
    status: 'pending_primary',
    primaryEmployeeId,
    primaryEmployeeName: String(data.primaryEmployeeName || '').trim(),
    createdAt: now,
    updatedAt: now
  };
  await upsertDoc(COLLECTIONS.users, profile.uid, profile);
  return clone(profile);
}

export async function updateSecondaryApproval(secondaryUid, primaryUid, approved) {
  if (!secondaryUid || !primaryUid) throw new Error('Secondary login information is incomplete.');
  const patch = { status: approved ? 'approved' : 'pending_primary', approvedByPrimaryAt: approved ? new Date().toISOString() : '', updatedAt: new Date().toISOString() };
  await updateDocFields(COLLECTIONS.users, secondaryUid, patch);
  return clone({ uid: secondaryUid, primaryEmployeeId: primaryUid, ...patch });
}


export async function getPayoutRequests(employeeUid = '') {
  if (!isFirebaseEnabled()) {
    const rows = read(STORAGE_KEYS.payoutRequests, []) || [];
    return clone(employeeUid ? rows.filter((r) => String(r.employeeUid || '') === String(employeeUid)) : rows);
  }
  return clone(employeeUid
    ? await listCollectionWhere(COLLECTIONS.payoutRequests, 'employeeUid', '==', employeeUid)
    : await listCollection(COLLECTIONS.payoutRequests));
}

export async function createPayoutRequest(request = {}) {
  const id = request.id || uid('payout');
  const now = new Date().toISOString();
  const next = { ...clone(request), id, status: 'pending', createdAt: request.createdAt || now, updatedAt: now };
  if (!isFirebaseEnabled()) {
    const rows = read(STORAGE_KEYS.payoutRequests, []) || [];
    write(STORAGE_KEYS.payoutRequests, [next, ...rows.filter((r) => r.id !== id)]);
    return clone(next);
  }
  const payload = { ...next };
  delete payload.id;
  await upsertDoc(COLLECTIONS.payoutRequests, id, payload);
  return clone(next);
}

export async function updatePayoutRequestStatus(id, status) {
  const allowed = ['pending','paid','declined'];
  if (!id || !allowed.includes(status)) throw new Error('Invalid payout request update.');
  const patch = { status, updatedAt: new Date().toISOString() };
  if (status === 'paid') patch.processedAt = patch.updatedAt;
  if (!isFirebaseEnabled()) {
    const rows = read(STORAGE_KEYS.payoutRequests, []) || [];
    write(STORAGE_KEYS.payoutRequests, rows.map((r) => r.id === id ? { ...r, ...patch } : r));
    return clone({ id, ...patch });
  }
  await updateDocFields(COLLECTIONS.payoutRequests, id, patch);
  return clone({ id, ...patch });
}

export async function saveOwnPayoutAccounts(profile, payoutAccounts = []) {
  const uidValue = profile?.uid || profile?.id;
  if (!uidValue) throw new Error('Employee profile UID is required.');
  const next = { ...clone(profile), uid: uidValue, payoutAccounts: clone(payoutAccounts), updatedAt: new Date().toISOString() };
  delete next.id;
  await upsertDoc(COLLECTIONS.users, uidValue, next);
  const cached = { id: uidValue, ...next };
  cacheUsers = cacheUsers.filter((u) => (u.uid || u.id) !== uidValue).concat(cached);
  return clone(cached);
}

export async function signupEmployee(data) {
  if (!isFirebaseEnabled()) throw new Error('Employee signup requires Firebase.');
  const credential = await firebaseSignup(String(data.email || '').trim(), String(data.password || ''));
  const now = new Date().toISOString();
  const profile = {
    uid: credential.user.uid,
    email: credential.user.email || String(data.email || '').trim(),
    firstName: String(data.firstName || '').trim(),
    lastName: String(data.lastName || '').trim(),
    phone: String(data.phone || '').trim(),
    pickupAddress: String(data.pickupAddress || '').trim(),
    emergencyContactName: String(data.emergencyContactName || '').trim(),
    emergencyContactPhone: String(data.emergencyContactPhone || '').trim(),
    role: 'employee',
    status: 'pending',
    createdAt: now,
    updatedAt: now
  };
  await upsertDoc(COLLECTIONS.users, profile.uid, profile);
  return clone(profile);
}

export async function loginAdmin(email, password) {
  if (isFirebaseEnabled()) {
    await firebaseLogin(email.trim(), password);
    return true;
  }
  const match = email.trim().toLowerCase() === APP_CONFIG.demoAdmin.email.toLowerCase()
    && password === APP_CONFIG.demoAdmin.password;
  if (!match) throw new Error('Invalid login.');
  write(STORAGE_KEYS.session, { email: APP_CONFIG.demoAdmin.email, loggedInAt: new Date().toISOString() });
  return true;
}

export async function logoutAdmin() {
  if (isFirebaseEnabled()) {
    await firebaseLogout();
    return;
  }
  localStorage.removeItem(STORAGE_KEYS.session);
}

export async function getSession() {
  if (isFirebaseEnabled()) {
    const user = await waitForAuthReady().then(() => getCurrentFirebaseUser());
    return user ? { email: user.email || '', uid: user.uid, firebase: true } : null;
  }
  return read(STORAGE_KEYS.session, null);
}

export async function uploadInventoryImage(file, itemId) {
  if (!file) return '';
  if (!isFirebaseEnabled()) return '';
  const ext = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const path = `inventory/${itemId}-${Date.now()}.${ext || 'jpg'}`;
  return uploadFile(path, file);
}

export async function exportOrdersBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    appName: APP_CONFIG.appName,
    mode: isFirebaseEnabled() ? 'firebase' : 'local',
    settings: await getSettings(),
    inventory: await getInventory(),
    orders: await getOrders(),
    auditLog: isFirebaseEnabled() ? await listCollection(COLLECTIONS.audit) : read(STORAGE_KEYS.audit, []),
    snapshots: isFirebaseEnabled() ? await listCollection(COLLECTIONS.snapshots) : read(STORAGE_KEYS.snapshots, []),
    costs: await getCostRecords()
  };
  return payload;
}

export async function createOrderSnapshot(label = 'Manual snapshot') {
  const payload = {
    id: uid('snapshot'),
    label,
    createdAt: new Date().toISOString(),
    orders: await getOrders()
  };
  cacheSnapshots.unshift(payload);
  if (!isFirebaseEnabled()) {
    appendLocal(STORAGE_KEYS.snapshots, payload);
  } else {
    await upsertDoc(COLLECTIONS.snapshots, payload.id, payload);
  }
  return payload;
}

export async function importOrdersBackup(payload) {
  if (!payload || !Array.isArray(payload.orders) || !Array.isArray(payload.inventory)) {
    throw new Error('Invalid backup file.');
  }
  await saveInventory(payload.inventory);
  await saveOrders(payload.orders, { actor: 'import' });
  if (payload.settings) await saveSettings(payload.settings);
  if (Array.isArray(payload.costs)) await saveCostRecords(payload.costs);
  await appendAuditLog({ action: 'imported-backup', actor: 'import', summary: { orders: payload.orders.length, inventory: payload.inventory.length } });
}



export async function getCostRecords() {
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheCosts).sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.name || '').localeCompare(String(b.name || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }
  const items = await listCollection(COLLECTIONS.costs);
  cacheCosts = items;
  return clone(cacheCosts).sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.name || '').localeCompare(String(b.name || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export async function saveCostRecords(records = []) {
  const incoming = clone(records).map((record) => ({
    ...record,
    id: record.id || uid('cost'),
    category: String(record.category || '').trim(),
    name: String(record.name || '').trim(),
    quantity: record.quantity === '' || record.quantity == null ? '' : Number(record.quantity || 0),
    price: record.price === '' || record.price == null ? '' : Number(record.price || 0),
    createdAt: record.createdAt || new Date().toISOString()
  })).filter((record) => record.category || record.name || record.quantity !== '' || record.price !== '');

  if (!isFirebaseEnabled()) {
    const previousMap = new Map(cacheCosts.map((item) => [item.id, item]));
    cacheCosts = incoming.map((item) => {
      const old = previousMap.get(item.id);
      const candidate = { ...item, updatedAt: old?.updatedAt || item.updatedAt || new Date().toISOString() };
      if (!old) return candidate;
      const oldComparable = { ...old }; delete oldComparable.updatedAt;
      const newComparable = { ...candidate }; delete newComparable.updatedAt;
      return docsAreDifferent(oldComparable, newComparable) ? { ...candidate, updatedAt: new Date().toISOString() } : old;
    });
    write(STORAGE_KEYS.costs, cacheCosts);
    return clone(cacheCosts);
  }

  const current = await listCollection(COLLECTIONS.costs);
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const nextIds = new Set(incoming.map((item) => item.id));
  const nextCache = [];

  for (const item of incoming) {
    const old = currentMap.get(item.id);
    const candidate = { ...item, updatedAt: old?.updatedAt || item.updatedAt || new Date().toISOString() };
    const oldComparable = old ? { ...old } : null;
    const newComparable = { ...candidate };
    if (oldComparable) delete oldComparable.updatedAt;
    delete newComparable.updatedAt;
    if (!old || docsAreDifferent(oldComparable, newComparable)) {
      candidate.updatedAt = new Date().toISOString();
      await upsertDoc(COLLECTIONS.costs, candidate.id, candidate);
      nextCache.push(candidate);
    } else {
      nextCache.push(old);
    }
  }

  for (const [id] of currentMap.entries()) {
    if (!nextIds.has(id)) await deleteDocById(COLLECTIONS.costs, id);
  }
  cacheCosts = nextCache;
  return clone(cacheCosts);
}

export async function getPublicReview(trackingCode) {
  const code = String(trackingCode || '').trim();
  if (!code) return null;
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheReviews.find((entry) => entry.id === code) || null);
  }
  const { getDocById } = await import('./firebase-service.js?v=rental-ux-v47');
  return getDocById(COLLECTIONS.reviews, code);
}


export async function getPublicReviews() {
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    return clone(cacheReviews).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }
  const items = await listCollection(COLLECTIONS.reviews);
  cacheReviews = items;
  return clone(cacheReviews).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function deletePublicReview(trackingCode) {
  const code = String(trackingCode || '').trim();
  if (!code) return;
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    cacheReviews = cacheReviews.filter((entry) => entry.id !== code && entry.trackingCode !== code);
    write(STORAGE_KEYS.reviews, cacheReviews);
    return;
  }
  await deleteDocById(COLLECTIONS.reviews, code);
}

export async function savePublicReview(trackingCode, review) {
  const code = String(trackingCode || '').trim();
  if (!code) throw new Error('Missing tracking code.');
  const payload = { id: code, trackingCode: code, ...clone(review), updatedAt: new Date().toISOString() };
  if (!isFirebaseEnabled()) {
    hydrateCachesFromLocal();
    cacheReviews = cacheReviews.filter((entry) => entry.id !== code);
    cacheReviews.unshift(payload);
    write(STORAGE_KEYS.reviews, cacheReviews);
    return payload;
  }
  await upsertDoc(COLLECTIONS.reviews, code, payload);
  return payload;
}
