import { createOrderSnapshot, deletePublicReview, deleteSingleOrder, deleteSingleInventoryItem, exportOrdersBackup, getCategories, getCostRecords, getInventory, getOpenOrders, getCompletedOrders as loadCompletedOrders, getAssignedOrders, getPublicReviews, getSession, getSettings, getCurrentUserProfile, getUsers, importOrdersBackup, loginAdmin, logoutAdmin, saveCostRecords, saveSettings, saveSingleInventoryItem, saveSingleOrder, saveUserProfile, deleteUserProfile, saveEmployeeOrderProgress, saveOwnContractAcceptance, getSchedules, getSchedule, saveSchedule, getUserProfile, getSecondaryUsers, updateSecondaryApproval, getPayoutRequests, createPayoutRequest, updatePayoutRequestStatus, saveOwnPayoutAccounts } from './store.js?v=rental-ux-v60';
import { CONTACT_METHODS, ORDER_STATUSES, PAYMENT_STATUSES, addDays, buildContactMap, compareCompletedDesc, compareExchangeAsc, contactSummary, currency, formatDateTime, getOrderColumn, normalizeCategory, overlaps, parseDateTime, safeText, uid } from './utils.js?v=rental-ux-v60';
import { debounce, geocodeAddress, searchAddresses } from './geo.js?v=rental-ux-v60';
import { syncCompletedOrderIncome } from './finance-service.js?v=rental-ux-v60';
const state = {
  inventory: [],
  orders: [],
  users: [],
  currentUser: null,
  settings: {},
  reviews: [],
  costs: [],
  numbersTab: 'costs',
  earningsView: 'monthly',
  expandedEarningsPeriod: '',
  highlightedOrderDates: {},
  collapsedCostCategories: {},
  expandedCostRows: {},
  recurringEditorCostId: null,
  averages: [],
  routeDate: new Date().toISOString().slice(0, 10),
  activeTab: 'orders',
  editingOrderId: null,
  editingInventoryId: null,
  expandedOrderId: null,
  expandedInventoryIds: {},
  imageLibrary: [],
  pickupSuggestions: [],
  pickupLookupToken: 0,
  orderActionDelegatesBound: false,
  activeOrderColumn: 'confirmed',
  collapsedColumns: { pending: true, confirmed: false, completed: true },
  completedOrdersLoaded: false,
  completedOrdersLoading: false,
  busyCount: 0,
  activeTemplateField: null,
  reminderComposer: null,
  quickPeekLocationId: 'main',
  viewAsEmployee: null,
  editingContractEmployeeId: null,
  ordersView: 'list',
  ordersCalendarDate: new Date().toISOString().slice(0, 10),
  schedules: [],
  schedulePersonId: '',
  scheduleCalendarDate: new Date().toISOString().slice(0, 10),
  scheduleEditingDate: '',
  scheduleChangeSelectionMode: 'individual',
  scheduleChangeSelectedDates: [],
  quickPeekEventChosen: false,
  orderLocationFilter: 'company',
  primaryEmployee: null,
  secondaryUsers: [],
  payoutRequests: [],
  payoutAmountMode: 'all',
  selectedPayoutAccountId: '',
  payoutWatcherTimer: null,
  knownPendingPayoutIds: new Set(),
  notificationPopoverOpen: false,
  employeeNotificationWatcherTimer: null
};
const els = {};
const DEFAULT_DEPOSIT_THRESHOLD = 100;
const DEPOSIT_RATE = 0.35;
const TRACKING_PAGE_PATH = '../tracking/index.html';
const ADMIN_VERSION = 'rental-ux-v60';
console.log('ADMIN VERSION:', ADMIN_VERSION);

const PAYMENT_METHOD_DEFS = [
  { key: 'cash', label: 'Cash', hint: 'Optional note only' },
  { key: 'invoice', label: 'Invoice', hint: 'Invoice link' },
  { key: 'venmo', label: 'Venmo', hint: '@handle or full URL' },
  { key: 'paypal', label: 'PayPal', hint: 'paypal.me name or full URL' },
  { key: 'cashapp', label: 'Cash App', hint: '$cashtag or full URL' },
  { key: 'zelle', label: 'Zelle', hint: 'Email or phone' },
  { key: 'googlepay', label: 'Google Pay', hint: 'Google Pay link' },
  { key: 'crypto', label: 'Crypto', hint: 'Wallet or payment link' }
];

function normalizeAdminPaymentOptions(value = {}) {
  return PAYMENT_METHOD_DEFS.reduce((acc, method) => {
    acc[method.key] = {
      key: method.key,
      label: value?.[method.key]?.label || method.label,
      active: Boolean(value?.[method.key]?.active),
      value: value?.[method.key]?.value || '',
      url: value?.[method.key]?.url || ''
    };
    return acc;
  }, {});
}

function renderPaymentOptionsSettings() {
  if (!els.paymentOptionsBox) return;
  const options = normalizeAdminPaymentOptions(state.settings?.paymentOptions || {});
  els.paymentOptionsBox.innerHTML = PAYMENT_METHOD_DEFS.map((method) => {
    const entry = options[method.key] || {};
    return `<div class="payment-settings-row">
      <div class="method-name">${safeText(method.label)}</div>
      <label class="check-pill"><input type="checkbox" data-pay-active="${method.key}" ${entry.active ? 'checked' : ''}/> Active</label>
      <div class="form-row" style="margin:0;"><label>${safeText(method.hint)}</label><input data-pay-value="${method.key}" value="${safeText(entry.value || '')}" placeholder="${safeText(method.hint)}" /></div>
      <div class="form-row" style="margin:0;"><label>Direct Link (optional)</label><input data-pay-url="${method.key}" value="${safeText(entry.url || '')}" placeholder="https://..." /></div>
    </div>`;
  }).join('');
}

function collectPaymentOptionsFromSettingsForm() {
  const out = {};
  PAYMENT_METHOD_DEFS.forEach((method) => {
    out[method.key] = {
      key: method.key,
      label: method.label,
      active: Boolean(els.paymentOptionsBox?.querySelector(`[data-pay-active="${method.key}"]`)?.checked),
      value: (els.paymentOptionsBox?.querySelector(`[data-pay-value="${method.key}"]`)?.value || '').trim(),
      url: (els.paymentOptionsBox?.querySelector(`[data-pay-url="${method.key}"]`)?.value || '').trim()
    };
  });
  return out;
}

const TEMPLATE_DEFAULTS = {
  reminder: `Hello {{first_name}}! Just a reminder for your rental on {{exchange_date}} at {{exchange_time}}.
Equipment: {{equipment}}
{{location}}
Total: {{total}}
{{deposit_line}}{{remaining_balance_line}}Payment status: {{payment_status}}
{{pending_line}}`,
  update: `Hello! There has been an update to your order.
{{updates}}`
};
function formatDistanceTag(match) {
  return Number.isFinite(match?.distanceFromOriginMiles)
    ? `${match.distanceFromOriginMiles.toFixed(1)} mi from saved pickup`
    : '';
}
function hidePickupSuggestions() {
  if (!els.pickupAddressSuggestions) return;
  els.pickupAddressSuggestions.classList.add('hidden');
}
function renderPickupSuggestions(matches = []) {
  if (!els.pickupAddressSuggestions) return;
  state.pickupSuggestions = Array.isArray(matches) ? matches : [];
  if (!state.pickupSuggestions.length) {
    els.pickupAddressSuggestions.innerHTML = '';
    hidePickupSuggestions();
    return;
  }
  els.pickupAddressSuggestions.innerHTML = state.pickupSuggestions.map((match, index) => `
    <button type="button" class="address-suggestion${index === 0 ? ' active' : ''}" data-pickup-suggestion="${index}">
      <div class="address-suggestion-primary">${safeText(match.primaryLine || match.label)}</div>
      <div class="address-suggestion-secondary">${safeText(match.secondaryLine || match.label)}</div>
      ${formatDistanceTag(match) ? `<div class="address-suggestion-distance">${safeText(formatDistanceTag(match))}</div>` : ''}
    </button>
  `).join('');
  els.pickupAddressSuggestions.classList.remove('hidden');
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
  if (els.settingsForm?.elements?.emailNotificationsEnabled) {
    els.settingsForm.elements.emailNotificationsEnabled.checked = Boolean(settings.emailNotificationsEnabled);
  }
  if (els.pickupLookupStatus) {
    const coords = settings.pickupCoords;
    els.pickupLookupStatus.textContent = coords?.lat != null && coords?.lon != null
      ? `Saved pickup coordinates: ${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)}`
      : 'Save a valid pickup address to store coordinates for delivery quotes.';
  }
}
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('No image source provided'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}
async function compressImageFile(file, maxSize = 900, quality = 0.82) {
  if (!file) return '';
  const dataUrl = await fileToDataUrl(file);
  const img = await loadImageElement(dataUrl);
  let { width, height } = img;
  const longest = Math.max(width, height);
  if (longest > maxSize) {
    const scale = maxSize / longest;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}
function inventoryBackgroundConfig(settings = state.settings) {
  const raw = settings?.inventoryImageBackground || {};
  const mode = ['solid','linear','radial'].includes(raw.mode) ? raw.mode : 'linear';
  const texture = ['none','noise','dots','grid','linen','diagonal'].includes(raw.texture) ? raw.texture : 'none';
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
  return {
    mode,
    color1: color(raw.color1, '#f8fafc'),
    color2: color(raw.color2, '#dbeafe'),
    angle: Math.max(0, Math.min(360, Number(raw.angle ?? 135) || 0)),
    texture,
    textureOpacity: Math.max(0, Math.min(.45, Number(raw.textureOpacity ?? .18) || 0)),
    imageScale: Math.max(.55, Math.min(1.8, Number(raw.imageScale ?? 1.08) || 1.08)),
    imageX: Math.max(-25, Math.min(25, Number(raw.imageX ?? 0) || 0)),
    imageY: Math.max(-25, Math.min(25, Number(raw.imageY ?? 0) || 0)),
    shadowEnabled: raw.shadowEnabled !== false,
    shadowColor: color(raw.shadowColor, '#0f172a'),
    shadowOpacity: Math.max(0, Math.min(.8, Number(raw.shadowOpacity ?? .28) || 0)),
    shadowBlur: Math.max(0, Math.min(40, Number(raw.shadowBlur ?? 14) || 0)),
    shadowX: Math.max(-20, Math.min(20, Number(raw.shadowX ?? 0) || 0)),
    shadowY: Math.max(-20, Math.min(20, Number(raw.shadowY ?? 7) || 0)),
    edgeGlow: Math.max(0, Math.min(.6, Number(raw.edgeGlow ?? .12) || 0)),
    brightness: Math.max(.7, Math.min(1.35, Number(raw.brightness ?? 1) || 1)),
    contrast: Math.max(.7, Math.min(1.5, Number(raw.contrast ?? 1.04) || 1.04)),
    saturation: Math.max(0, Math.min(1.8, Number(raw.saturation ?? 1) || 1))
  };
}
function inventoryBackgroundCss(settings = state.settings) {
  const cfg = inventoryBackgroundConfig(settings);
  const base = cfg.mode === 'solid'
    ? `linear-gradient(${cfg.color1},${cfg.color1})`
    : cfg.mode === 'radial'
      ? `radial-gradient(circle at 50% 50%,${cfg.color1} 0%,${cfg.color2} 100%)`
      : `linear-gradient(${cfg.angle}deg,${cfg.color1} 0%,${cfg.color2} 100%)`;
  const a = cfg.textureOpacity;
  let texture = '';
  let size = 'auto';
  if (cfg.texture === 'dots') { texture = `radial-gradient(circle,rgba(15,23,42,${a}) 1px,transparent 1.5px)`; size = '12px 12px, auto'; }
  else if (cfg.texture === 'grid') { texture = `linear-gradient(rgba(15,23,42,${a}) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,${a}) 1px,transparent 1px)`; size = '18px 18px,18px 18px,auto'; }
  else if (cfg.texture === 'diagonal') { texture = `repeating-linear-gradient(135deg,rgba(255,255,255,${a}) 0 2px,transparent 2px 9px)`; size = 'auto'; }
  else if (cfg.texture === 'linen') { texture = `repeating-linear-gradient(0deg,rgba(255,255,255,${a}) 0 1px,transparent 1px 4px),repeating-linear-gradient(90deg,rgba(15,23,42,${a * .45}) 0 1px,transparent 1px 5px)`; size = 'auto'; }
  else if (cfg.texture === 'noise') { texture = `repeating-radial-gradient(circle at 20% 30%,rgba(15,23,42,${a * .55}) 0 0.7px,transparent .8px 3px)`; size = '7px 7px,auto'; }
  return `background-color:${cfg.color1};background-image:${texture ? `${texture},${base}` : base};background-size:${size};background-position:center;`;
}
function hexToRgba(hex, alpha = 1) {
  const value = String(hex || '#0f172a').replace('#','');
  const safe = /^[0-9a-f]{6}$/i.test(value) ? value : '0f172a';
  const r = parseInt(safe.slice(0,2),16), g = parseInt(safe.slice(2,4),16), b = parseInt(safe.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function inventoryImageCss(settings = state.settings) {
  const cfg = inventoryBackgroundConfig(settings);
  const filters = [];
  if (cfg.shadowEnabled && cfg.shadowOpacity > 0) filters.push(`drop-shadow(${cfg.shadowX}px ${cfg.shadowY}px ${cfg.shadowBlur}px ${hexToRgba(cfg.shadowColor,cfg.shadowOpacity)})`);
  if (cfg.edgeGlow > 0) filters.push(`drop-shadow(0 0 1.5px rgba(255,255,255,${cfg.edgeGlow}))`, `drop-shadow(0 0 1px rgba(15,23,42,${cfg.edgeGlow * .55}))`);
  filters.push(`brightness(${cfg.brightness})`, `contrast(${cfg.contrast})`, `saturate(${cfg.saturation})`);
  return `transform:translate(${cfg.imageX}%,${cfg.imageY}%) scale(${cfg.imageScale});transform-origin:center;filter:${filters.join(' ')};`;
}
async function compressTransparentInventoryImage(file, maxSize = 900) {
  if (!file) return '';
  const dataUrl = await fileToDataUrl(file);
  const img = await loadImageElement(dataUrl);
  const originalWidth = Math.max(1, Number(img.width || 1));
  const originalHeight = Math.max(1, Number(img.height || 1));
  const TARGET_LENGTH = 700000; // comfortably below Firestore's 1 MiB document limit

  // WebP preserves alpha transparency but is dramatically smaller than a base64 PNG.
  // Re-render smaller until the encoded image is safely persistable in Firestore.
  let longest = Math.min(maxSize, Math.max(originalWidth, originalHeight));
  let quality = 0.9;
  let result = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const scale = Math.min(1, longest / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    result = canvas.toDataURL('image/webp', quality);
    // Some browsers can theoretically reject WebP; PNG fallback still preserves alpha.
    if (!result.startsWith('data:image/webp')) result = canvas.toDataURL('image/png');
    if (result.length <= TARGET_LENGTH) return result;
    if (quality > 0.68) quality -= 0.08;
    else longest = Math.max(360, Math.round(longest * 0.82));
  }
  if (result.length > TARGET_LENGTH) {
    throw new Error('The transparent image is still too large to save safely. Please use a smaller source image.');
  }
  return result;
}
function getInventoryImageSrc(item) {
  return item?.imageData || item?.imageUrl || '';
}
function normalizeAccessories(accessories = []) {
  return Array.isArray(accessories) ? accessories.map((entry) => ({
    id: entry?.id || uid('acc'),
    name: (entry?.name || '').trim(),
    price: Number(entry?.price || 0),
    costQuantity: entry?.costQuantity === '' || entry?.costQuantity == null ? '' : Number(entry.costQuantity || 0),
    costEach: entry?.costEach === '' || entry?.costEach == null ? '' : Number(entry.costEach || 0),
    costTotal: entry?.costTotal === '' || entry?.costTotal == null ? '' : Number(entry.costTotal || 0),
    imageData: entry?.imageData || ''
  })).filter((entry) => entry.name) : [];
}
function getAccessoryCostTotal(accessory = {}) {
  if (accessory.costTotal !== '' && accessory.costTotal != null && Number(accessory.costTotal || 0) > 0) return Number(accessory.costTotal || 0);
  return Number(accessory.costQuantity || 0) * Number(accessory.costEach || 0);
}
function getAccessoryImageSrc(accessory) {
  return accessory?.imageData || '';
}
function getSelectedAccessoryIds(inventoryId) {
  return Array.isArray(state.selectedAccessories?.[inventoryId]) ? state.selectedAccessories[inventoryId] : [];
}
function getSelectedAccessoriesForItem(item) {
  const selectedIds = getSelectedAccessoryIds(item.id);
  return normalizeAccessories(item.accessories).filter((accessory) => selectedIds.includes(accessory.id));
}
function getDisplayImageForPickerItem(item) {
  const selected = getSelectedAccessoriesForItem(item);
  const accessoryWithImage = [...selected].reverse().find((entry) => getAccessoryImageSrc(entry));
  return getAccessoryImageSrc(accessoryWithImage) || getInventoryImageSrc(item);
}
function createAccessoryRow(accessory = {}) {
  const row = document.createElement('div');
  row.className = 'accessory-admin-row';
  row.innerHTML = `
    <div class="accessory-admin-grid">
      <div class="form-row">
        <label>Accessory Name</label>
        <input type="text" data-acc-name placeholder="Black Fitted Cover" value="${safeText(accessory.name || '')}" />
      </div>
      <div class="form-row">
        <label>Customer Price Each</label>
        <input type="number" min="0" step="0.01" data-acc-price value="${Number(accessory.price || 0)}" />
      </div>
      <div class="form-row">
        <label>Purchase Qty</label>
        <input type="number" min="0" step="1" data-acc-cost-quantity value="${accessory.costQuantity === '' ? '' : Number(accessory.costQuantity || 0)}" />
      </div>
      <div class="form-row">
        <label>Cost Each</label>
        <input type="number" min="0" step="0.01" data-acc-cost-each value="${accessory.costEach === '' ? '' : Number(accessory.costEach || 0)}" />
      </div>
      <div class="form-row">
        <label>Accessory Image</label>
        <input type="file" data-acc-upload accept="image/*" />
        <input type="hidden" data-acc-image value="${safeText(accessory.imageData || '')}" />
        <div class="small muted" style="margin-top:6px;">Optional. If chosen by the customer, the item image swaps to this image.</div>
      </div>
      <div class="form-row">
        <label>Preview</label>
        <img class="inventory-image accessory-preview" data-acc-preview alt="Accessory preview" ${accessory.imageData ? `src="${safeText(accessory.imageData)}"` : ''} ${accessory.imageData ? '' : 'hidden'} />
      </div>
    </div>
    <div class="accessory-admin-actions">
      <button type="button" class="btn btn-ghost btn-small" data-remove-accessory>Remove Accessory</button>
    </div>
  `;
  row.dataset.accessoryId = accessory.id || uid('acc');
  return row;
}
function renderAccessoryRows(accessories = []) {
  if (!els.accessoriesBox) return;
  els.accessoriesBox.innerHTML = '';
  const normalized = normalizeAccessories(accessories);
  if (!normalized.length) {
    els.accessoriesBox.innerHTML = '<div class="empty-state">No accessories yet.</div>';
    return;
  }
  normalized.forEach((accessory) => {
    els.accessoriesBox.appendChild(createAccessoryRow(accessory));
  });
}
function collectAccessoriesFromForm() {
  if (!els.accessoriesBox) return [];
  return [...els.accessoriesBox.querySelectorAll('.accessory-admin-row')].map((row) => ({
    id: row.dataset.accessoryId || uid('acc'),
    name: (row.querySelector('[data-acc-name]')?.value || '').trim(),
    price: Number(row.querySelector('[data-acc-price]')?.value || 0),
    costQuantity: row.querySelector('[data-acc-cost-quantity]')?.value === '' ? '' : Number(row.querySelector('[data-acc-cost-quantity]')?.value || 0),
    costEach: row.querySelector('[data-acc-cost-each]')?.value === '' ? '' : Number(row.querySelector('[data-acc-cost-each]')?.value || 0),
    costTotal: '',
    imageData: row.querySelector('[data-acc-image]')?.value || ''
  })).filter((accessory) => accessory.name);
}
document.addEventListener('DOMContentLoaded', () => { init().catch(handleFatalError); });
async function init() {
  cacheEls();
  const session = await getSession();
  if (!session) {
    els.loginView.classList.remove('hidden');
    els.appView.classList.add('hidden');
    bindLogin();
    return;
  }
  state.currentUser = await getCurrentUserProfile();
  if (!state.currentUser) throw new Error('Unable to load your account profile.');
  els.loginView.classList.add('hidden');
  els.appView.classList.remove('hidden');
  applyRoleAccess();
  bindApp();
  renderLoadingPlaceholders('Loading from Firebase…');
  await withBusy(async () => {
    await loadImageLibrary();
    await loadData();
    applyRoleAccess();
    renderAll();
    startPayoutRequestWatcher();
    startEmployeeNotificationWatcher();
  }, 'Loading from Firebase…');
}
function cacheEls() {
  Object.assign(els, {
    loginView: document.getElementById('loginView'),
    appView: document.getElementById('appView'),
    loginForm: document.getElementById('loginForm'),
    loginError: document.getElementById('loginError'),
    tabButtons: [...document.querySelectorAll('[data-tab-btn]')],
    panels: [...document.querySelectorAll('[data-tab-panel]')],
    logoutBtn: document.getElementById('logoutBtn'),
    copyPickupAddressBtn: document.getElementById('copyPickupAddressBtn'),
    copyPasteModalWrap: document.getElementById('copyPasteModalWrap'),
    copyPasteOptions: document.getElementById('copyPasteOptions'),
    addCopyPasteTemplateBtn: document.getElementById('addCopyPasteTemplateBtn'),
    pendingList: document.getElementById('pendingList'),
    confirmedList: document.getElementById('confirmedList'),
    completedList: document.getElementById('completedList'),
    pendingTotal: document.getElementById('pendingTotal'),
    confirmedTotal: document.getElementById('confirmedTotal'),
    completedTotal: document.getElementById('completedTotal'),
    pendingColumn: document.getElementById('pendingColumn'),
    confirmedColumn: document.getElementById('confirmedColumn'),
    completedColumn: document.getElementById('completedColumn'),
    backToActiveOrdersBtn: document.getElementById('backToActiveOrdersBtn'),
    newInquiryBell: document.getElementById('newInquiryBell'),
    newInquiryBadge: document.getElementById('newInquiryBadge'),
    notificationCenter: document.getElementById('notificationCenter'),
    notificationPopover: document.getElementById('notificationPopover'),
    notificationOrderModalWrap: document.getElementById('notificationOrderModalWrap'),
    notificationOrderModalTitle: document.getElementById('notificationOrderModalTitle'),
    notificationOrderModalBody: document.getElementById('notificationOrderModalBody'),
    employeeEarnedBalance: document.getElementById('employeeEarnedBalance'),
    payoutRequestModalWrap: document.getElementById('payoutRequestModalWrap'),
    payoutAccountsList: document.getElementById('payoutAccountsList'),
    payoutAccountSelect: document.getElementById('payoutAccountSelect'),
    payoutAccountForm: document.getElementById('payoutAccountForm'),
    addPayoutAccountBtn: document.getElementById('addPayoutAccountBtn'),
    cancelPayoutAccountBtn: document.getElementById('cancelPayoutAccountBtn'),
    accountPayoutAccountsList: document.getElementById('accountPayoutAccountsList'),
    accountPayoutAccountForm: document.getElementById('accountPayoutAccountForm'),
    accountAddPayoutAccountBtn: document.getElementById('accountAddPayoutAccountBtn'),
    accountCancelPayoutAccountBtn: document.getElementById('accountCancelPayoutAccountBtn'),
    payoutAvailableBalance: document.getElementById('payoutAvailableBalance'),
    payoutHeldBalance: document.getElementById('payoutHeldBalance'),
    payoutCustomAmountRow: document.getElementById('payoutCustomAmountRow'),
    payoutCustomAmount: document.getElementById('payoutCustomAmount'),
    payoutRequestAmountPreview: document.getElementById('payoutRequestAmountPreview'),
    payoutRequestError: document.getElementById('payoutRequestError'),
    submitPayoutRequestBtn: document.getElementById('submitPayoutRequestBtn'),
    payoutConfirmationModalWrap: document.getElementById('payoutConfirmationModalWrap'),
    adminPayoutRequests: document.getElementById('adminPayoutRequests'),
    collapsedColumnsRail: document.getElementById('collapsedColumnsRail'),
    addOrderBtn: document.getElementById('addOrderBtn'),
    ordersViewToggle: document.getElementById('ordersViewToggle'),
    ordersLocationFilter: document.getElementById('ordersLocationFilter'),
    ordersListView: document.getElementById('ordersListView'),
    ordersCalendarView: document.getElementById('ordersCalendarView'),
    ordersCalendarPrevBtn: document.getElementById('ordersCalendarPrevBtn'),
    ordersCalendarTodayBtn: document.getElementById('ordersCalendarTodayBtn'),
    ordersCalendarNextBtn: document.getElementById('ordersCalendarNextBtn'),
    ordersCalendarMonthLabel: document.getElementById('ordersCalendarMonthLabel'),
    ordersMonthCalendar: document.getElementById('ordersMonthCalendar'),
    routeDateInput: document.getElementById('routeDateInput'),
    routePrevBtn: document.getElementById('routePrevBtn'),
    routeTodayBtn: document.getElementById('routeTodayBtn'),
    routeNextBtn: document.getElementById('routeNextBtn'),
    planRouteBtn: document.getElementById('planRouteBtn'),
    routeDateLabel: document.getElementById('routeDateLabel'),
    routeStopsList: document.getElementById('routeStopsList'),
    addInventoryBtn: document.getElementById('addInventoryBtn'),
    inventoryBackgroundBtn: document.getElementById('inventoryBackgroundBtn'),
    inventoryBackgroundModalWrap: document.getElementById('inventoryBackgroundModalWrap'),
    inventoryBackgroundForm: document.getElementById('inventoryBackgroundForm'),
    inventoryBackgroundPreview: document.getElementById('inventoryBackgroundPreview'),
    inventoryBackgroundAngleLabel: document.getElementById('inventoryBackgroundAngleLabel'),
    inventoryTextureStrengthLabel: document.getElementById('inventoryTextureStrengthLabel'),
    resetInventoryBackgroundBtn: document.getElementById('resetInventoryBackgroundBtn'),
    inventoryPreviewSurface: document.getElementById('inventoryPreviewSurface'),
    inventoryList: document.getElementById('inventoryList'),
    settingsForm: document.getElementById('settingsForm'),
    settingsSaved: document.getElementById('settingsSaved'),
    paymentOptionsBox: document.getElementById('paymentOptionsBox'),
    reviewsList: document.getElementById('reviewsList'),
    numbersTabButtons: [...document.querySelectorAll('[data-numbers-tab]')],
    numbersPanels: [...document.querySelectorAll('[data-numbers-panel]')],
    numbersSaved: document.getElementById('numbersSaved'),
    costsSummary: document.getElementById('costsSummary'),
    costsList: document.getElementById('costsList'),
    addCostRowBtn: document.getElementById('addCostRowBtn'),
    saveCostsBtn: document.getElementById('saveCostsBtn'),
    earningsSummary: document.getElementById('earningsSummary'),
    earningsBreakdown: document.getElementById('earningsBreakdown'),
    earningsViewSelect: document.getElementById('earningsViewSelect'),
    averagesSummary: document.getElementById('averagesSummary'),
    averagesList: document.getElementById('averagesList'),
    addAverageTaskBtn: document.getElementById('addAverageTaskBtn'),
    saveAveragesBtn: document.getElementById('saveAveragesBtn'),
    orderModalWrap: document.getElementById('orderModalWrap'),
    orderModalTitle: document.getElementById('orderModalTitle'),
    orderForm: document.getElementById('orderForm'),
    orderItemsBox: document.getElementById('orderItemsBox'),
    inventoryModalWrap: document.getElementById('inventoryModalWrap'),
    inventoryModalTitle: document.getElementById('inventoryModalTitle'),
    inventoryForm: document.getElementById('inventoryForm'),
    categorySuggestions: document.getElementById('categorySuggestions'),
    imageUpload: document.getElementById('imageUpload'),
    imageData: document.getElementById('imageData'),
    homeHeroImageUpload: document.getElementById('homeHeroImageUpload'),
    homeHeroImageData: document.getElementById('homeHeroImageData'),
    homeHeroImagePreview: document.getElementById('homeHeroImagePreview'),
    homeQuoteImageUpload: document.getElementById('homeQuoteImageUpload'),
    homeQuoteImageData: document.getElementById('homeQuoteImageData'),
    homeQuoteImagePreview: document.getElementById('homeQuoteImagePreview'),
    homeBrowseImageUpload: document.getElementById('homeBrowseImageUpload'),
    homeBrowseImageData: document.getElementById('homeBrowseImageData'),
    homeBrowseImagePreview: document.getElementById('homeBrowseImagePreview'),
    homeTrackImageUpload: document.getElementById('homeTrackImageUpload'),
    homeTrackImageData: document.getElementById('homeTrackImageData'),
    homeTrackImagePreview: document.getElementById('homeTrackImagePreview'),
    addAccessoryBtn: document.getElementById('addAccessoryBtn'),
    accessoriesBox: document.getElementById('accessoriesBox'),
    inventoryStats: document.getElementById('inventoryStats'),
    calendarDateInput: document.getElementById('calendarDateInput'),
    quickPeekExchangeDateInput: document.getElementById('quickPeekExchangeDateInput'),
    quickPeekReturnDateInput: document.getElementById('quickPeekReturnDateInput'),
    quickPeekExchangeField: document.getElementById('quickPeekExchangeField'),
    quickPeekReturnField: document.getElementById('quickPeekReturnField'),
    quickPeekLocationField: document.getElementById('quickPeekLocationField'),
    calendarPrevBtn: document.getElementById('calendarPrevBtn'),
    calendarTodayBtn: document.getElementById('calendarTodayBtn'),
    calendarNextBtn: document.getElementById('calendarNextBtn'),
    calendarDateLabel: document.getElementById('calendarDateLabel'),
    calendarAvailabilityBoard: document.getElementById('calendarAvailabilityBoard'),
    reminderSettingsForm: document.getElementById('reminderSettingsForm'),
    reminderTemplateInput: document.getElementById('reminderTemplateInput'),
    updateTemplateInput: document.getElementById('updateTemplateInput'),
    reminderSettingsSaved: document.getElementById('reminderSettingsSaved'),
    templateTokenRow: document.getElementById('templateTokenRow'),
    reminderModalWrap: document.getElementById('reminderModalWrap'),
    reminderModalTitle: document.getElementById('reminderModalTitle'),
    reminderPreviewOutput: document.getElementById('reminderPreviewOutput'),
    reminderCopiedStatus: document.getElementById('reminderCopiedStatus'),
    reminderVerbalCheckbox: document.getElementById('reminderVerbalCheckbox'),
    reminderDepositWaivedCheckbox: document.getElementById('reminderDepositWaivedCheckbox'),
    reminderEquipmentDiscussionCheckbox: document.getElementById('reminderEquipmentDiscussionCheckbox'),
    reminderFriendlyIntroCheckbox: document.getElementById('reminderFriendlyIntroCheckbox'),
    reminderIncludeTrackingCheckbox: document.getElementById('reminderIncludeTrackingCheckbox'),
    reminderIncludeEquipmentCheckbox: document.getElementById('reminderIncludeEquipmentCheckbox'),
    reminderIncludeAddressCheckbox: document.getElementById('reminderIncludeAddressCheckbox'),
    reviewOlderCustomerCheckbox: document.getElementById('reviewOlderCustomerCheckbox'),
    reminderUpdatesList: document.getElementById('reminderUpdatesList'),
    reminderTabButtons: [...document.querySelectorAll('[data-reminder-tab]')],
    reminderPanels: [...document.querySelectorAll('[data-reminder-panel]')],
    copyReminderPreviewBtn: document.getElementById('copyReminderPreviewBtn'),
    backupExportBtn: document.getElementById('backupExportBtn'),
    backupSnapshotBtn: document.getElementById('backupSnapshotBtn'),
    backupImportBtn: document.getElementById('backupImportBtn'),
    backupImportFile: document.getElementById('backupImportFile'),
    backupStatus: document.getElementById('backupStatus'),
    pickupAddressInput: document.getElementById('pickupAddressInput'),
    pickupAddressSuggestions: document.getElementById('pickupAddressSuggestions'),
    pickupLookupStatus: document.getElementById('pickupLookupStatus'),
    pendingColumn: document.getElementById('pendingColumn'),
    confirmedColumn: document.getElementById('confirmedColumn'),
    completedColumn: document.getElementById('completedColumn'),
    newInquiryBell: document.getElementById('newInquiryBell'),
    newInquiryBadge: document.getElementById('newInquiryBadge'),
    collapsedColumnsRail: document.getElementById('collapsedColumnsRail'),
    orderDiscountPreview: document.getElementById('orderDiscountPreview'),
    appBusyOverlay: document.getElementById('appBusyOverlay'),
    appBusyMessage: document.getElementById('appBusyMessage'),
    employeesList: document.getElementById('employeesList'),
    copyEmployeeSignupLinkBtn: document.getElementById('copyEmployeeSignupLinkBtn'),
    employeeSignupLinkStatus: document.getElementById('employeeSignupLinkStatus'),
    employeePaymentsPanel: document.getElementById('employeePaymentsPanel'),
    employeePayoutsPanel: document.getElementById('employeePayoutsPanel'),
    employeeDocumentsPanel: document.getElementById('employeeDocumentsPanel'),
    schedulePersonSelect: document.getElementById('schedulePersonSelect'),
    typicalScheduleGrid: document.getElementById('typicalScheduleGrid'),
    weeklyScheduleEditor: document.getElementById('weeklyScheduleEditor'),
    editWeeklyScheduleBtn: document.getElementById('editWeeklyScheduleBtn'),
    saveTypicalScheduleBtn: document.getElementById('saveTypicalScheduleBtn'),
    scheduleSaveStatus: document.getElementById('scheduleSaveStatus'),
    schedulePrevMonthBtn: document.getElementById('schedulePrevMonthBtn'),
    scheduleTodayBtn: document.getElementById('scheduleTodayBtn'),
    scheduleNextMonthBtn: document.getElementById('scheduleNextMonthBtn'),
    scheduleMonthLabel: document.getElementById('scheduleMonthLabel'),
    scheduleMonthCalendar: document.getElementById('scheduleMonthCalendar'),
    scheduleChangeEditor: document.getElementById('scheduleChangeEditor'),
    scheduleChangeModalWrap: document.getElementById('scheduleChangeModalWrap'),
    scheduleAddChangeBtn: document.getElementById('scheduleAddChangeBtn'),
    quickPeekLocationSelect: document.getElementById('quickPeekLocationSelect'),
    viewAsBanner: document.getElementById('viewAsBanner'),
    viewAsName: document.getElementById('viewAsName'),
    exitViewAsBtn: document.getElementById('exitViewAsBtn'),
    dashboardTitle: document.getElementById('dashboardTitle'),
    dashboardSubtitle: document.getElementById('dashboardSubtitle'),
    mobileMenuBtn: document.getElementById('mobileMenuBtn'),
    sidebarCloseBtn: document.getElementById('sidebarCloseBtn'),
    sidebarOverlay: document.getElementById('sidebarOverlay'),
    appSidebar: document.getElementById('appSidebar'),
    contractModalWrap: document.getElementById('contractModalWrap'),
    contractModalTitle: document.getElementById('contractModalTitle'),
    contractForm: document.getElementById('contractForm'),
    contractBodyInput: document.getElementById('contractBodyInput'),
    loadBlankContractBtn: document.getElementById('loadBlankContractBtn'),
    contractSaveStatus: document.getElementById('contractSaveStatus'),
    employeeContractSetupModal: document.getElementById('employeeContractSetupModal'),
    employeeContractSetupForm: document.getElementById('employeeContractSetupForm'),
    signupEmployeeName: document.getElementById('signupEmployeeName'),
    secondaryAccessCard: document.getElementById('secondaryAccessCard'),
    copySecondaryLoginLinkBtn: document.getElementById('copySecondaryLoginLinkBtn'),
    secondaryAccessStatus: document.getElementById('secondaryAccessStatus'),
    secondaryAccessList: document.getElementById('secondaryAccessList'),
    employeeContractSetupError: document.getElementById('employeeContractSetupError')
  });
}
function isRealAdminUser() { return state.currentUser?.role === 'admin' && state.currentUser?.status === 'approved'; }
function isSecondaryLogin() { return state.currentUser?.role === 'secondary'; }
function getExperienceUser() { return state.viewAsEmployee || (isSecondaryLogin() ? state.primaryEmployee : state.currentUser); }
function isAdminUser() { return isRealAdminUser() && !state.viewAsEmployee; }
function isEmployeeUser() { return getExperienceUser()?.role === 'employee' || isSecondaryLogin(); }
function applyRoleAccess() {
  const admin = isAdminUser();
  const employee = isEmployeeUser();
  const experienceUser = getExperienceUser();
  document.body.classList.toggle('employee-view', employee);
  document.body.classList.toggle('view-as-employee', Boolean(state.viewAsEmployee));
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !admin));
  document.querySelectorAll('.employee-only').forEach((el) => el.classList.toggle('hidden', !employee));

  // Reset tab visibility first so exiting View As restores the full admin menu.
  document.querySelectorAll('[data-tab-btn]').forEach((btn) => btn.classList.remove('hidden'));
  if (employee) {
    state.activeTab = ['orders','schedule','account','payments','mypayouts','documents'].includes(state.activeTab) ? state.activeTab : 'orders';
    const allowed = new Set(isSecondaryLogin() ? ['orders','schedule'] : ['orders', 'schedule', 'account', 'payments', 'mypayouts', 'documents']);
    document.querySelectorAll('[data-tab-btn]').forEach((btn) => btn.classList.toggle('hidden', !allowed.has(btn.dataset.tabBtn)));
  } else {
    document.querySelectorAll('.employee-only[data-tab-btn]').forEach((btn) => btn.classList.add('hidden'));
  }

  if (els.viewAsBanner) els.viewAsBanner.classList.toggle('hidden', !state.viewAsEmployee);
  if (els.viewAsName && state.viewAsEmployee) els.viewAsName.textContent = `Viewing as ${employeeDisplayName(state.viewAsEmployee)}`;

  document.querySelectorAll('[data-pending-account-notice]').forEach((el) => el.remove());
  if (employee && (experienceUser?.status !== 'approved' || (isSecondaryLogin() && state.currentUser?.status !== 'approved'))) {
    document.querySelector('[data-tab-panel="orders"]')?.insertAdjacentHTML('afterbegin', '<div class="card" data-pending-account-notice style="padding:18px;margin-bottom:16px;"><strong>Account pending approval</strong><div class="small muted">Your signup was received. Access becomes available after the required approval.</div></div>');
  }
  renderTabs();
  renderEmployeeEarnedBalance();
}
function approvedEmployees() { return (state.users || []).filter((u) => u.role === 'employee' && u.status === 'approved'); }
function employeeDisplayName(user = {}) { return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Employee'; }
function employeeAssignments(user = {}) {
  return Array.isArray(user.equipmentAssignments) ? user.equipmentAssignments.map((entry, index) => ({
    lotId: String(entry.lotId || `${entry.inventoryId || 'item'}_${index}`),
    inventoryId: String(entry.inventoryId || ''),
    quantity: Math.max(0, Number(entry.quantity || 0)),
    unitCost: Math.max(0, Number(entry.unitCost || 0)),
    accessories: Array.isArray(entry.accessories) ? entry.accessories.map((a) => ({
      id: String(a?.id || ''),
      quantity: Math.max(0, Math.floor(Number(a?.quantity || 0)))
    })).filter((a) => a.id && a.quantity > 0) : []
  })).filter((entry) => entry.inventoryId && entry.quantity > 0) : [];
}
function inventoryById(id = '') { return (state.inventory || []).find((item) => String(item.id) === String(id)); }
function allocationsForUser(user = {}, inventoryId = '') { return employeeAssignments(user).filter((entry) => entry.inventoryId === String(inventoryId)); }
function allocationForUser(user = {}, inventoryId = '') {
  const rows = allocationsForUser(user, inventoryId);
  return rows.length ? { inventoryId: String(inventoryId), quantity: rows.reduce((sum,row) => sum + Number(row.quantity || 0), 0), lots: rows } : null;
}
function allocatedQuantityAcrossEmployees(inventoryId = '', excludeUid = '') {
  return (state.users || []).filter((u) => u.role === 'employee' && (u.uid || u.id) !== excludeUid).reduce((sum, u) => sum + allocationsForUser(u, inventoryId).reduce((n,a) => n + Number(a.quantity || 0), 0), 0);
}
function employeeAccessoryAssignments(user = {}, inventoryId = '') {
  const totals = new Map();
  allocationsForUser(user, inventoryId).forEach((lot) => (lot.accessories || []).forEach((a) => totals.set(a.id, (totals.get(a.id) || 0) + Number(a.quantity || 0))));
  return [...totals.entries()].map(([id, quantity]) => ({ id, quantity }));
}
function locationIdForEmployee(uid = '') { return uid ? `employee:${uid}` : 'main'; }
function orderLocationId(order = {}) {
  if (order.assignedEmployeeId) return locationIdForEmployee(order.assignedEmployeeId);
  if (String(order.requestedPickupLocationId || '').startsWith('employee:')) return String(order.requestedPickupLocationId);
  return 'main';
}
function getLocationStock(inventoryId = '', locationId = 'company') {
  const item = inventoryById(inventoryId);
  const companyStock = Math.max(0, Number(item?.stock || 0));
  if (locationId === 'company') return companyStock;
  if (locationId === 'main') return Math.max(0, companyStock - allocatedQuantityAcrossEmployees(inventoryId));
  if (String(locationId).startsWith('employee:')) {
    const uid = String(locationId).slice('employee:'.length);
    const user = (state.users || []).find((u) => (u.uid || u.id) === uid);
    return Math.max(0, Number(allocationForUser(user, inventoryId)?.quantity || 0));
  }
  return companyStock;
}
function quickPeekLocationOptions() {
  return [
    { id: 'company', label: 'Company Total' },
    { id: 'main', label: state.settings?.pickupName || 'Main Pickup Location' },
    ...(state.users || []).filter((u) => u.role === 'employee' && u.status === 'approved' && employeeAssignments(u).length).map((u) => ({ id: locationIdForEmployee(u.uid || u.id), label: `${employeeDisplayName(u)} — ${u.pickupAddress || 'Employee location'}` }))
  ];
}
function orderLocationOptions() {
  return [
    { id: 'company', label: 'All Locations' },
    { id: 'main', label: state.settings?.pickupName || 'Main Location' },
    ...(state.users || []).filter((u) => u.role === 'employee' && u.status === 'approved').map((u) => ({ id: locationIdForEmployee(u.uid || u.id), label: employeeDisplayName(u) }))
  ];
}
function populateOrdersLocationFilter() {
  if (!els.ordersLocationFilter) return;
  const options = orderLocationOptions();
  if (!options.some((o) => o.id === state.orderLocationFilter)) state.orderLocationFilter = 'company';
  els.ordersLocationFilter.innerHTML = options.map((o) => `<option value="${safeText(o.id)}"${o.id === state.orderLocationFilter ? ' selected' : ''}>${safeText(o.label)}</option>`).join('');
}
function filterOrdersByLocation(orders = []) {
  if (!isAdminUser() || state.orderLocationFilter === 'company') return orders;
  return orders.filter((order) => orderLocationId(order) === state.orderLocationFilter);
}
function locationLabelForOrder(order = {}) {
  const id = orderLocationId(order);
  return orderLocationOptions().find((o) => o.id === id)?.label || (id === 'main' ? 'Main Location' : 'Location');
}

function populateQuickPeekLocationSelect() {
  if (!els.quickPeekLocationSelect) return;
  const options = quickPeekLocationOptions();
  if (!options.some((opt) => opt.id === state.quickPeekLocationId)) state.quickPeekLocationId = 'company';
  els.quickPeekLocationSelect.innerHTML = options.map((opt) => `<option value="${safeText(opt.id)}" ${opt.id === state.quickPeekLocationId ? 'selected' : ''}>${safeText(opt.label)}</option>`).join('');
}
function buildPublicPickupLocations() {
  return (state.users || []).filter((u) => u.role === 'employee' && u.status === 'approved' && String(u.pickupAddress || '').trim() && employeeAssignments(u).length).map((u) => ({
    id: locationIdForEmployee(u.uid || u.id),
    employeeUid: u.uid || u.id,
    employeeName: employeeDisplayName(u),
    name: `${employeeDisplayName(u)} Pickup`,
    address: String(u.pickupAddress || '').trim(),
    pickupCoords: u.pickupCoords || null,
    allocations: [...new Set(employeeAssignments(u).map((entry) => entry.inventoryId))].map((inventoryId) => ({ inventoryId, quantity: allocationsForUser(u, inventoryId).reduce((sum, entry) => sum + Number(entry.quantity || 0), 0), accessories: employeeAccessoryAssignments(u, inventoryId) }))
  }));
}
async function syncPublicPickupLocations() {
  state.settings = { ...state.settings, employeePickupLocations: buildPublicPickupLocations() };
  await saveSettings(state.settings);
}
function equipmentValueForUser(user = {}) { return employeeAssignments(user).reduce((sum, entry) => sum + entry.quantity * entry.unitCost, 0); }
function employeePaymentSettings(user = {}) {
  const raw = user.paymentSplit || {};
  const unpaidEmployee = Math.max(0, Number(raw.unpaidEmployee ?? 65));
  const equipmentPayoff = Math.max(0, Number(raw.equipmentPayoff ?? 30));
  const unpaidCompany = Math.max(0, Number(raw.unpaidCompany ?? 5));
  const paidEmployee = Math.max(0, Number(raw.paidEmployee ?? 95));
  const paidCompany = Math.max(0, Number(raw.paidCompany ?? 5));
  return { unpaidEmployee, equipmentPayoff, unpaidCompany, paidEmployee, paidCompany };
}
function validEmployeePaymentSettings(settings = {}) {
  const unpaidTotal = Number(settings.unpaidEmployee || 0) + Number(settings.equipmentPayoff || 0) + Number(settings.unpaidCompany || 0);
  const paidTotal = Number(settings.paidEmployee || 0) + Number(settings.paidCompany || 0);
  return Math.abs(unpaidTotal - 100) < 0.001 && Math.abs(paidTotal - 100) < 0.001;
}
function eligiblePaidFraction(order = {}) {
  const total = Math.max(0, Number(getEffectiveOrderTotal(order) || 0));
  if (!total) return 0;
  return Math.max(0, Math.min(1, Number(getOrderAmountPaid(order) || 0) / total));
}

function employeeEquipmentRentalValue(order = {}) {
  return (order.items || []).reduce((sum, item) => {
    const qty = Math.max(0, Number(item.quantity || 0));
    const unit = Math.max(0, Number(
      item.chargedUnitPrice === '' || item.chargedUnitPrice == null
        ? item.unitPrice
        : item.chargedUnitPrice || 0
    ));
    return sum + (qty * unit);
  }, 0);
}

function employeeQualificationProcessingDate(order = {}) {
  return String(order.exchangeDate || order.eventDate || order.returnDate || '').slice(0,10);
}

function compareEmployeeQualificationPriority(a = {}, b = {}) {
  const ad = employeeQualificationProcessingDate(a);
  const bd = employeeQualificationProcessingDate(b);
  if (ad !== bd) return ad.localeCompare(bd);

  // Same rental day: intentionally process the larger equipment-rental order
  // first so Qualified Units unlocked by it can benefit later same-day orders.
  const av = employeeEquipmentRentalValue(a);
  const bv = employeeEquipmentRentalValue(b);
  if (Math.abs(av - bv) > 0.000001) return bv - av;

  // Stable fallback when order values match.
  const at = String(a.exchangeTime || a.eventTime || '');
  const bt = String(b.exchangeTime || b.eventTime || '');
  if (at !== bt) return at.localeCompare(bt);
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function qualifiedUnitEmoji(item = {}) {
  const name = String(item.name || '').toLowerCase();
  if (name.includes('chair')) return '🪑';
  if (name.includes('table')) return '⭐';
  if (name.includes('tent')) return '⛺';
  return '✨';
}

function qualifiedUsageLabel(entry = {}) {
  const item = inventoryById(entry.inventoryId) || {};
  const qty = Math.max(0, Number(entry.quantity || 0));
  return `+${qty} ${qualifiedUnitEmoji(item)} ${item.name || 'Qualified Unit'}`;
}
function calculateEmployeePaymentLedger(user = {}, orders = state.orders) {
  const assignments = employeeAssignments(user);
  const split = employeePaymentSettings(user);

  // Equipment can now be assigned in multiple cost lots. For each equipment type,
  // cheaper lots are always paid off first. Replaying completed-order history against
  // the current lots also means existing payoff progress automatically shifts to a
  // newly-added cheaper lot of the same item.
  const groups = new Map();
  for (const assignment of assignments) {
    if (!groups.has(assignment.inventoryId)) groups.set(assignment.inventoryId, { inventoryId: assignment.inventoryId, lots: [] });
    groups.get(assignment.inventoryId).lots.push({
      ...assignment,
      totalCost: assignment.quantity * assignment.unitCost,
      payoff: 0,
      employeeEarnings: 0,
      companyShare: 0,
      rentalRevenue: 0
    });
  }
  groups.forEach((group) => group.lots.sort((a,b) => Number(a.unitCost || 0) - Number(b.unitCost || 0) || String(a.lotId).localeCompare(String(b.lotId))));

  const paidUnitsForGroup = (group) => group.lots.reduce((sum, lot) => {
    const paid = lot.unitCost > 0 ? Math.min(lot.quantity, Math.floor((lot.payoff + 1e-9) / lot.unitCost)) : lot.quantity;
    return sum + paid;
  }, 0);
  const applyPayoffToGroup = (group, amount) => {
    let remaining = Math.max(0, Number(amount || 0));
    let applied = 0;
    for (const lot of group.lots) {
      if (remaining <= 0) break;
      const needed = Math.max(0, lot.totalCost - lot.payoff);
      const use = Math.min(remaining, needed);
      lot.payoff += use;
      applied += use;
      remaining -= use;
    }
    return { applied, overflow: remaining };
  };

  let employeeEarnings = 0, companyShare = 0, payoffTotal = 0, recognizedRevenue = 0;
  const lines = [];
  const sorted = (orders || [])
    .filter((o) => o.assignedEmployeeId === (user.uid || user.id) && o.status === 'Completed' && eligiblePaidFraction(o) > 0 && !o.free)
    .slice()
    .sort(compareEmployeeQualificationPriority);

  for (const order of sorted) {
    const paidFraction = eligiblePaidFraction(order);
    let orderEmployee = 0, orderCompany = 0, orderPayoff = 0, orderRecognized = 0;
    const qualifiedUsage = [];
    const newlyQualified = [];

    for (const item of order.items || []) {
      const group = groups.get(String(item.inventoryId || ''));
      if (!group) continue;
      const qty = Math.max(0, Number(item.quantity || 0));
      const unitRental = Math.max(0, Number(item.chargedUnitPrice === '' || item.chargedUnitPrice == null ? item.unitPrice : item.chargedUnitPrice || 0));
      const lineRevenue = qty * unitRental * paidFraction;
      if (!lineRevenue || !qty) continue;

      const totalAssignedQty = group.lots.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
      const paidUnitsBefore = Math.min(totalAssignedQty, paidUnitsForGroup(group));
      const paidQty = Math.min(qty, paidUnitsBefore);
      const unpaidQty = Math.max(0, qty - paidQty);
      const paidRevenue = lineRevenue * (paidQty / qty);
      const unpaidRevenue = lineRevenue * (unpaidQty / qty);

      if (paidQty > 0) qualifiedUsage.push({ inventoryId: group.inventoryId, quantity: paidQty });

      const rawPayoff = unpaidRevenue * (split.equipmentPayoff / 100);
      const payoffResult = applyPayoffToGroup(group, rawPayoff);
      const paidUnitsAfter = Math.min(totalAssignedQty, paidUnitsForGroup(group));
      const unlockedNow = Math.max(0, paidUnitsAfter - paidUnitsBefore);
      if (unlockedNow > 0) newlyQualified.push({ inventoryId: group.inventoryId, quantity: unlockedNow });

      const employeePart =
        paidRevenue * (split.paidEmployee / 100) +
        unpaidRevenue * (split.unpaidEmployee / 100) +
        payoffResult.overflow;
      const companyPart =
        paidRevenue * (split.paidCompany / 100) +
        unpaidRevenue * (split.unpaidCompany / 100);

      // Attribute revenue to the cost lots for display. Payoff itself has already
      // been applied cheapest-first above.
      const lotQtyTotal = Math.max(1, totalAssignedQty);
      group.lots.forEach((lot) => {
        const share = Number(lot.quantity || 0) / lotQtyTotal;
        lot.employeeEarnings += employeePart * share;
        lot.companyShare += companyPart * share;
        lot.rentalRevenue += lineRevenue * share;
      });

      orderEmployee += employeePart;
      orderCompany += companyPart;
      orderPayoff += payoffResult.applied;
      orderRecognized += lineRevenue;
    }

    const directEmployeeRevenue = (
      Number(order.deliveryFee || 0) +
      Number(order.setupFee || 0) +
      Number(order.tipAmount || 0)
    ) * paidFraction;
    if (directEmployeeRevenue > 0) {
      orderEmployee += directEmployeeRevenue;
      orderRecognized += directEmployeeRevenue;
    }

    if (orderRecognized > 0) {
      employeeEarnings += orderEmployee;
      companyShare += orderCompany;
      payoffTotal += orderPayoff;
      recognizedRevenue += orderRecognized;
      lines.push({ order, employee: orderEmployee, company: orderCompany, payoff: orderPayoff, revenue: orderRecognized, qualifiedUsage, newlyQualified });
    }
  }

  const buckets = [...groups.values()].flatMap((group) => group.lots.map((lot, index) => ({
    ...lot,
    lotIndex: index,
    lotCount: group.lots.length
  })));
  return { buckets, employeeEarnings, companyShare, payoffTotal, recognizedRevenue, lines, split };
}
function employeeContractAgreement(user = {}) {
  const value = user.contractAgreement && typeof user.contractAgreement === 'object' ? user.contractAgreement : {};
  const acceptance = user.contractAcceptance && typeof user.contractAcceptance === 'object' ? user.contractAcceptance : {};
  return {
    status: value.status || 'Draft',
    effectiveDate: value.effectiveDate || '',
    companyLegalName: 'Rent Some LLC',
    contractorLegalName: acceptance.legalName || '',
    payoutMethod: acceptance.payoutMethod || '',
    body: value.body || '',
    updatedAt: value.updatedAt || '',
    signedAt: value.signedAt || '',
    paymentSplit: value.paymentSplit || user.paymentSplit || {},
    legalNameConfirmed: Boolean(acceptance.legalNameConfirmed),
    acceptanceUpdatedAt: acceptance.updatedAt || ''
  };
}
function employeeContractNeedsConfirmation(user = {}) {
  const contract = employeeContractAgreement(user);
  return Boolean(contract.body) && (!contract.legalNameConfirmed || !contract.contractorLegalName || !contract.payoutMethod);
}
function buildContractEquipmentSchedule(user = {}) {
  const assignments = employeeAssignments(user);
  if (!assignments.length) return '[NO EQUIPMENT CURRENTLY LISTED — COMPLETE EQUIPMENT ASSIGNMENT SCHEDULE]';
  return assignments.map((entry) => {
    const item = inventoryById(entry.inventoryId) || {};
    return `${entry.quantity} × ${item.name || 'Equipment'} — assigned unit value ${currency(entry.unitCost)} each`;
  }).join('\n');
}
function buildBlankEmployeeContractTemplate(user = {}) {
  const split = employeePaymentSettings(user);
  return `INDEPENDENT CONTRACTOR RENTAL FULFILLMENT AGREEMENT

This Independent Contractor Rental Fulfillment Agreement ("Agreement") is effective [EFFECTIVE DATE] and is entered into between Rent Some LLC ("Company") and [CONTRACTOR LEGAL NAME] ("Contractor").

1. INDEPENDENT CONTRACTOR RELATIONSHIP
Contractor will provide rental-order fulfillment services as an independent contractor. Nothing in this Agreement creates an employment, partnership, joint venture, ownership, or agency relationship beyond the limited authority necessary to deliver, release, receive, load, unload, and otherwise handle Company rental equipment for accepted orders. Contractor is responsible for Contractor's own taxes and tax reporting. No work volume or minimum number of orders is guaranteed. Contractor is free to operate or participate in other businesses, including a rental business of Contractor's own.

2. ORDER OFFERS AND ACCEPTANCE
Company may offer Contractor orders when the customer is closer to Contractor's assigned pickup area than the Company's main location and Contractor has sufficient assigned equipment to fulfill the order. Contractor may accept or decline any offered order and may decline an order for any reason, including transportation, safety, scheduling, or comfort concerns.

After Contractor accepts an order, Contractor is expected to fulfill it. Occasional cancellations are understood. Repeated accepted-order cancellations that materially interfere with Company operations may result in a warning. Continued excessive cancellations after warning may be grounds for Company to end this Agreement.

Company controls customer pricing, discounts, refunds, order terms, customer promises, and other business decisions. Contractor is acting as a fulfiller and transporter of Company goods and may not independently change Company pricing or order terms.

3. CUSTOMER PAYMENTS
All customer payments are collected by Company. Customers must pay no later than pickup or delivery before the rental is released. Contractor is not responsible for extending credit to customers or collecting unpaid balances outside Company procedures.

4. COMPENSATION
Compensation on equipment rental revenue is calculated using the following employee-specific percentages:

While a rental unit has not become a Qualified Unit:
- Contractor: [UNPAID EMPLOYEE %]%
- Qualified Unit allocation: [QUALIFIED UNIT ALLOCATION %]%
- Company: [UNPAID COMPANY %]%

After an individual unit becomes a Qualified Unit:
- Contractor: [QUALIFIED EMPLOYEE %]%
- Company: [QUALIFIED COMPANY %]%

Delivery fees, setup fees, and tips associated with Contractor-fulfilled orders are paid 100% to Contractor unless the parties agree otherwise in writing. Other charges, fees, reimbursements, damage collections, or special circumstances may be handled under separate written terms.

Contractor's payout schedule preference is [PAYOUT METHOD]. Contractor may request a payout-method change at any time, but any change is subject to Company approval and applies only after approval.

Contractor earns payment through completed and paid customer orders. No payment is earned merely because equipment has been assigned, stored, or has accumulated Qualified Unit progress.

5. QUALIFIED UNITS
"Qualified Unit" is a compensation-calculation term only. It does not mean that Contractor purchases, owns, earns equity in, acquires a lien on, or otherwise obtains an ownership interest in Company equipment.

For each equipment type, the Qualified Unit allocation described above accumulates against the assigned unit value shown in the Equipment Assignment Schedule. Each time accumulated allocation reaches the assigned value of one physical unit, one additional unit of that equipment type becomes a Qualified Unit for future compensation calculations.

Example: if chairs have an assigned unit value of $14 and $15 of Qualified Unit allocation has accumulated, one chair becomes a Qualified Unit and $1 carries forward toward the next chair. On future applicable orders, one rented chair is calculated at the Qualified Unit percentage and the remaining rented chairs are calculated at the standard percentage until additional units qualify.

Qualified Unit progress has no cash value, is not a savings account, is not refundable, and is not separately payable when this Agreement ends.

6. COMPANY OWNERSHIP AND EQUIPMENT ASSIGNMENT
All equipment remains the sole property of Company at all times unless the parties later execute a separate written sale agreement.

Current Equipment Assignment Schedule:
[EQUIPMENT SCHEDULE]

Company's total inventory remains Company property regardless of where equipment is stored. Contractor must keep assigned equipment reasonably secure, protected from avoidable weather exposure, and unavailable to unauthorized third parties. Contractor may not rent, lend, sell, pledge, or otherwise provide Company equipment to another person for compensation or independent business use.

Contractor may personally use assigned equipment at Contractor's approved storage location when doing so does not interfere with an accepted Company order. Contractor may request permission to use equipment at another personal location where Contractor will be present, such as a family member's home. Off-site personal use requires advance Company approval.

During the relationship, Company may request that equipment be returned or reallocated. If Contractor is unable to make requested equipment available, Company may acquire additional inventory rather than treating the request as a forced purchase, debt, or transfer of ownership.

7. CLEANING, ORDINARY WEAR, REPAIRS, AND CUSTOMER DAMAGE
Contractor is responsible for routine cleaning of assigned equipment and for keeping it reasonably rental-ready.

Company is responsible for ordinary repairs, repainting, refurbishment, replacement caused by ordinary wear and tear, and swapping worn equipment for serviceable equipment when appropriate.

Contractor is responsible for loss or damage caused by Contractor's gross negligence, intentional misconduct, or clearly unauthorized use.

When a customer damages or loses Company equipment, Company is responsible for replacing or repairing the equipment as Company determines appropriate and for handling collection of customer damage charges. Contractor must promptly report known customer damage or loss and provide reasonably available information about the incident.

8. VEHICLES, DELIVERY, AND PROPERTY DAMAGE
Contractor is responsible for Contractor's own vehicle, vehicle operation, driver's licensing, insurance, fuel, transportation choices, and safe loading and transportation. Contractor may decline any order Contractor does not feel comfortable transporting or fulfilling.

Contractor is responsible for damage to customer property, third-party property, vehicles, or other property caused by Contractor's acts, negligence, or unsafe handling while fulfilling an order.

9. CONFIDENTIALITY AND CUSTOMER INFORMATION
Customer names, addresses, phone numbers, email addresses, order details, pricing information, internal Company information, access credentials, and other non-public information may be used only as reasonably necessary to fulfill Company orders or administer this relationship. Contractor may not sell, disclose, misuse, retain for unrelated solicitation, or otherwise exploit confidential Company or customer information.

Nothing in this Agreement prevents Contractor from starting or operating a separate competing business. Contractor may not represent a separate transaction as a Company transaction or misuse confidential Company/customer information in doing so.

10. TERM AND TERMINATION
Either party may end this Agreement at any time.

When the relationship ends, Contractor must return all Company-owned equipment and property in Contractor's possession or control within a reasonable time, reasonably clean and in condition consistent with ordinary rental use, ordinary wear and tear excepted.

Termination does not create any payment for uncompleted orders, Qualified Unit progress, assigned equipment value, or equipment that has become a Qualified Unit. Contractor remains entitled only to compensation actually earned under completed and paid orders according to this Agreement.

11. DISPUTE RESOLUTION AND GOVERNING LAW
The parties intend to first attempt in good faith to resolve disputes directly. If a dispute cannot be resolved directly, the parties agree to attempt non-binding mediation before filing a lawsuit when reasonably practical. This Agreement is governed by the laws of the State of North Carolina, and any court proceeding will be brought in a court of competent jurisdiction in North Carolina unless applicable law requires otherwise.

12. ENTIRE AGREEMENT AND CHANGES
This Agreement, together with the Equipment Assignment Schedule and any written amendments, contains the parties' agreement regarding the matters addressed here. Changes to compensation percentages, payout arrangements, or other material terms must be agreed to in writing. Equipment assignments may be updated in Company records without changing ownership of the equipment.

SIGNATURES

Company: Rent Some LLC

By: ____________________________________
Name/Title: _____________________________
Date: __________________________________

Contractor: [CONTRACTOR LEGAL NAME]

Signature: ______________________________
Date: __________________________________
`;
}
function resolveEmployeeContractBody(user = {}) {
  const contract = employeeContractAgreement(user);
  const split = employeePaymentSettings(user);
  const raw = contract.body || '';
  return raw
    .replaceAll('[LEGAL COMPANY NAME]', 'Rent Some LLC')
    .replaceAll('[CONTRACTOR LEGAL NAME]', contract.contractorLegalName || '[CONTRACTOR LEGAL NAME]')
    .replaceAll('[EFFECTIVE DATE]', contract.effectiveDate || '[EFFECTIVE DATE]')
    .replaceAll('[PAYOUT METHOD]', contract.payoutMethod || '[PAYOUT METHOD]')
    .replaceAll('[UNPAID EMPLOYEE %]', String(split.unpaidEmployee))
    .replaceAll('[QUALIFIED UNIT ALLOCATION %]', String(split.equipmentPayoff))
    .replaceAll('[UNPAID COMPANY %]', String(split.unpaidCompany))
    .replaceAll('[QUALIFIED EMPLOYEE %]', String(split.paidEmployee))
    .replaceAll('[QUALIFIED COMPANY %]', String(split.paidCompany))
    .replaceAll('[EQUIPMENT SCHEDULE]', buildContractEquipmentSchedule(user));
}
function renderEmployeeDocuments() {
  if (!els.employeeDocumentsPanel || !isEmployeeUser()) return;
  const employee = getExperienceUser();
  const contract = employeeContractAgreement(employee);
  if (!contract.body) {
    els.employeeDocumentsPanel.innerHTML = `<div class="card document-empty-card"><strong>Contract Agreement</strong><div class="small muted">A contract agreement has not been provided yet.</div></div>`;
    return;
  }
  if (employeeContractNeedsConfirmation(employee)) {
    els.employeeDocumentsPanel.innerHTML = `<div class="card contract-view-card"><div class="section-header"><div><h3 style="margin:0;">Contract Agreement</h3><div class="small muted">Before opening your contract, confirm your legal name and payout preference.</div></div><span class="badge badge-yellow">Action needed</span></div><div style="margin-top:14px;"><button class="btn btn-primary" type="button" data-open-contract-confirmation>Review Contract Agreement</button></div></div>`;
    els.employeeDocumentsPanel.querySelector('[data-open-contract-confirmation]')?.addEventListener('click', openEmployeeContractConfirmation);
    return;
  }
  const statusClass = contract.status === 'Signed' ? 'badge-green' : contract.status === 'Ready for Signature' ? 'badge-blue' : 'badge-yellow';
  els.employeeDocumentsPanel.innerHTML = `<div class="card contract-view-card"><div class="section-header"><div><h3 style="margin:0;">Contract Agreement</h3><div class="small muted">Your current agreement provided by the company.</div></div><span class="badge ${statusClass}">${safeText(contract.status)}</span></div><div class="contract-view-meta">${contract.effectiveDate ? `<span><strong>Effective:</strong> ${safeText(contract.effectiveDate)}</span>` : ''}<span><strong>Legal name:</strong> ${safeText(contract.contractorLegalName)}</span><span><strong>Payout:</strong> ${safeText(contract.payoutMethod)}</span>${contract.updatedAt ? `<span><strong>Last updated:</strong> ${safeText(new Date(contract.updatedAt).toLocaleString())}</span>` : ''}</div><pre class="contract-document-text">${safeText(resolveEmployeeContractBody(employee))}</pre><div style="margin-top:12px;"><button class="btn btn-ghost btn-small" type="button" data-request-contract-update>Update legal name / payout preference</button></div></div>`;
  els.employeeDocumentsPanel.querySelector('[data-request-contract-update]')?.addEventListener('click', openEmployeeContractConfirmation);
}
function openEmployeeContractConfirmation() {
  const employee = getExperienceUser();
  if (!employee || !els.employeeContractSetupModal) return;
  const contract = employeeContractAgreement(employee);
  const signupName = employeeDisplayName(employee);
  if (els.signupEmployeeName) els.signupEmployeeName.textContent = signupName;
  const form = els.employeeContractSetupForm;
  form.elements.legalName.value = contract.contractorLegalName || signupName;
  form.elements.payoutMethod.value = contract.payoutMethod || '';
  form.elements.legalNameConfirmed.checked = Boolean(contract.legalNameConfirmed);
  if (els.employeeContractSetupError) els.employeeContractSetupError.textContent = '';
  els.employeeContractSetupModal.classList.add('open');
}
function closeEmployeeContractConfirmation() {
  els.employeeContractSetupModal?.classList.remove('open');
  if (els.employeeContractSetupError) els.employeeContractSetupError.textContent = '';
}
async function saveEmployeeContractConfirmation(event) {
  event.preventDefault();
  const employee = getExperienceUser();
  if (!employee || employee.role !== 'employee' || (isSecondaryLogin() && state.currentUser?.status !== 'approved')) return;
  const form = new FormData(event.currentTarget);
  const legalName = String(form.get('legalName') || '').trim();
  const payoutMethod = String(form.get('payoutMethod') || '').trim();
  if (!legalName || !payoutMethod || !form.get('legalNameConfirmed')) {
    if (els.employeeContractSetupError) els.employeeContractSetupError.textContent = 'Confirm your legal name and choose a payout preference.';
    return;
  }
  employee.contractAcceptance = {
    legalName,
    payoutMethod,
    legalNameConfirmed: true,
    updatedAt: new Date().toISOString()
  };
  try {
    const savedProfile = await saveOwnContractAcceptance(employee, employee.contractAcceptance);
    if (state.viewAsEmployee) {
      state.viewAsEmployee = { ...state.viewAsEmployee, ...savedProfile };
      state.users = state.users.map((u) => (u.uid || u.id) === (savedProfile.uid || savedProfile.id) ? { ...u, ...savedProfile } : u);
    } else {
      state.currentUser = { ...savedProfile };
      state.users = [state.currentUser];
    }
    closeEmployeeContractConfirmation();
    renderEmployeeDocuments();
  } catch (error) {
    if (els.employeeContractSetupError) els.employeeContractSetupError.textContent = error?.message || 'Unable to save contract information.';
  }
}
function openEmployeeContractEditor(user = {}) {
  if (!els.contractModalWrap || !els.contractForm) return;
  const id = user.uid || user.id;
  state.editingContractEmployeeId = id;
  const contract = employeeContractAgreement(user);
  els.contractModalTitle.textContent = `Contract Agreement — ${employeeDisplayName(user)}`;
  const f = els.contractForm.elements;
  f.status.value = contract.status || 'Draft';
  f.effectiveDate.value = contract.effectiveDate || '';
  const split = employeePaymentSettings(user);
  f.unpaidEmployee.value = split.unpaidEmployee;
  f.equipmentPayoff.value = split.equipmentPayoff;
  f.unpaidCompany.value = split.unpaidCompany;
  f.paidEmployee.value = split.paidEmployee;
  f.paidCompany.value = split.paidCompany;
  f.body.value = contract.body || buildBlankEmployeeContractTemplate(user);
  if (els.contractSaveStatus) els.contractSaveStatus.textContent = contract.updatedAt ? `Last saved ${new Date(contract.updatedAt).toLocaleString()}` : 'Not saved yet.';
  els.contractModalWrap.classList.add('open');
}
function closeEmployeeContractEditor() {
  state.editingContractEmployeeId = null;
  els.contractModalWrap?.classList.remove('open');
  if (els.contractSaveStatus) els.contractSaveStatus.textContent = '';
}
async function saveEmployeeContract(event) {
  event.preventDefault();
  const id = state.editingContractEmployeeId;
  const user = state.users.find((u) => (u.uid || u.id) === id);
  if (!user || !isRealAdminUser()) return;
  const form = new FormData(els.contractForm);
  const nextSplit = {
    unpaidEmployee: Math.max(0, Number(form.get('unpaidEmployee') || 0)),
    equipmentPayoff: Math.max(0, Number(form.get('equipmentPayoff') || 0)),
    unpaidCompany: Math.max(0, Number(form.get('unpaidCompany') || 0)),
    paidEmployee: Math.max(0, Number(form.get('paidEmployee') || 0)),
    paidCompany: Math.max(0, Number(form.get('paidCompany') || 0))
  };
  if (!validEmployeePaymentSettings(nextSplit)) {
    alert('Contract percentages are not valid. Unqualified-unit percentages must total 100%, and Qualified Unit percentages must total 100%.');
    return;
  }
  const now = new Date().toISOString();
  user.paymentSplit = nextSplit;
  user.contractAgreement = {
    status: String(form.get('status') || 'Draft'),
    effectiveDate: String(form.get('effectiveDate') || ''),
    companyLegalName: 'Rent Some LLC',
    body: String(form.get('body') || ''),
    paymentSplit: nextSplit,
    updatedAt: now,
    signedAt: String(form.get('status') || '') === 'Signed'
      ? (employeeContractAgreement(user).signedAt || now)
      : ''
  };
  await withBusy(async () => {
    await saveUserProfile(user);
    state.users = state.users.map((entry) => (entry.uid || entry.id) === id ? { ...user } : entry);
  }, 'Saving contract…');
  if (els.contractSaveStatus) els.contractSaveStatus.textContent = `Saved ${new Date(now).toLocaleString()}`;
  renderEmployees();
}
function loadBlankContractIntoEditor() {
  const id = state.editingContractEmployeeId;
  const user = state.users.find((u) => (u.uid || u.id) === id);
  if (!user || !els.contractForm) return;
  if (els.contractForm.elements.body.value.trim() && !window.confirm('Replace the current contract body with a fresh blank template?')) return;
  els.contractForm.elements.body.value = buildBlankEmployeeContractTemplate(user);
}
function enterViewAsEmployee(user = {}) {
  if (!isRealAdminUser()) return;
  state.viewAsEmployee = user;
  state.schedulePersonId = user.uid || user.id || '';
  state.activeTab = 'orders';
  state.expandedOrderId = null;
  applyRoleAccess();
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function exitViewAsEmployee() {
  if (!state.viewAsEmployee) return;
  state.viewAsEmployee = null;
  state.activeTab = 'employees';
  state.expandedOrderId = null;
  applyRoleAccess();
  renderAll();
  refreshPayoutRequests().catch((err) => console.error('Could not restore admin payout list', err));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


function buildEmployeeProjectionPlan(user = {}, activeOrders = []) {
  const userId = user.uid || user.id;
  const actualCompleted = (state.orders || []).filter((order) =>
    order.assignedEmployeeId === userId &&
    order.status === 'Completed' &&
    eligiblePaidFraction(order) > 0 &&
    !order.free
  );

  const active = (activeOrders || [])
    .filter((order) =>
      order.assignedEmployeeId === userId &&
      ['Confirmed','In-Progress'].includes(order.status) &&
      String(order.paymentStatus || '').toLowerCase() !== 'free'
    )
    .slice()
    .sort(compareEmployeeQualificationPriority);

  const projectedCompleted = active.map((order, index) => ({
    ...order,
    status: 'Completed',
    paymentStatus: 'Paid',
    amountPaid: getEffectiveOrderTotal(order),
    depositPaidAmount: getEffectiveOrderTotal(order),
    amountRemaining: 0,
    // completedAt is only synthetic projection metadata. The ledger priority
    // itself is controlled by exchange-day / largest-order-first ordering.
    completedAt: order.completedAt || `${employeeQualificationProcessingDate(order) || new Date().toISOString().slice(0,10)}T12:${String(index).padStart(2,'0')}:00`
  }));

  const ledger = calculateEmployeePaymentLedger(user, [...actualCompleted, ...projectedCompleted]);
  const lineById = new Map(ledger.lines.map((line) => [line.order.id, line]));

  return active.map((order, index) => {
    const line = lineById.get(order.id) || {
      employee: 0, company: 0, payoff: 0, revenue: 0,
      qualifiedUsage: [], newlyQualified: []
    };
    const previous = active[index - 1] || null;
    const sameDayRank = active
      .filter((candidate) => employeeQualificationProcessingDate(candidate) === employeeQualificationProcessingDate(order))
      .findIndex((candidate) => candidate.id === order.id) + 1;
    const sameDayCount = active
      .filter((candidate) => employeeQualificationProcessingDate(candidate) === employeeQualificationProcessingDate(order))
      .length;

    return {
      order,
      ...line,
      priorityIndex: index + 1,
      sameDayRank,
      sameDayCount,
      followsOrderId: previous?.id || ''
    };
  });
}

function projectEmployeeOrderCompletion(user = {}, order = {}) {
  const plan = buildEmployeeProjectionPlan(user, (state.orders || []).filter((candidate) =>
    candidate.assignedEmployeeId === (user.uid || user.id) &&
    ['Confirmed','In-Progress'].includes(candidate.status) &&
    String(candidate.paymentStatus || '').toLowerCase() !== 'free'
  ));
  return plan.find((entry) => entry.order.id === order.id) || {
    employee:0, company:0, payoff:0, revenue:0,
    qualifiedUsage:[], newlyQualified:[]
  };
}

function estimateEmployeeOrderLabor(employee = {}, order = {}, employeeEarnings = 0) {
  let cleaning = 0;
  let loading = 0;
  let unloading = 0;
  for (const orderItem of (order.items || [])) {
    const inventoryItem = inventoryById(orderItem.inventoryId) || {};
    const qty = Math.max(0, Number(orderItem.quantity || 0));
    cleaning += qty * (inventoryTimeSeconds(inventoryItem, 'Cleaning') / 60);
    loading += qty * (inventoryTimeSeconds(inventoryItem, 'Loading') / 60);
    unloading += qty * (inventoryTimeSeconds(inventoryItem, 'Unloading') / 60);
  }

  const handlingMinutes = cleaning + loading + unloading;
  let exchangeMinutes = 0;
  let travelMinutes = 0;
  if (order.fulfillmentType === 'Delivery') {
    // Delivery fee is based on $0.4175 per minute of total round-trip driving.
    // Example: $33.40 / .4175 = 80 total driving minutes.
    travelMinutes = Math.max(0, Number(order.deliveryFee || 0)) / 0.4175;
  } else {
    exchangeMinutes = Math.max(0, Number(employee.averageExchangeMinutes || 0)) * 2;
  }

  const totalMinutes = handlingMinutes + exchangeMinutes + travelMinutes;
  const hourlyRate = totalMinutes > 0 ? (Math.max(0, Number(employeeEarnings || 0)) / totalMinutes) * 60 : null;
  return { cleaning, loading, unloading, handlingMinutes, exchangeMinutes, travelMinutes, totalMinutes, hourlyRate };
}
function employeeHourlyEstimateHtml(employee, order, earnings, plain = false) {
  const estimate = estimateEmployeeOrderLabor(employee, order, earnings);
  if (estimate.totalMinutes <= 0) return plain ? '—' : `<span class="badge badge-light" title="Add handling/exchange time to calculate an hourly estimate.">Hourly rate —</span>`;
  const pieces = [
    estimate.cleaning ? `${estimate.cleaning.toFixed(1)}m clean` : '',
    estimate.loading ? `${estimate.loading.toFixed(1)}m load` : '',
    estimate.unloading ? `${estimate.unloading.toFixed(1)}m unload` : '',
    estimate.exchangeMinutes ? `${estimate.exchangeMinutes.toFixed(1)}m exchanges` : '',
    estimate.travelMinutes ? `${estimate.travelMinutes.toFixed(1)}m driving` : ''
  ].filter(Boolean).join(' + ');
  const label = `${currency(estimate.hourlyRate)}/hr · ${estimate.totalMinutes.toFixed(0)} min`;
  return plain ? safeText(label) : `<span class="badge employee-hourly-badge" title="${safeText(`${pieces} = ${estimate.totalMinutes.toFixed(1)} estimated minutes`)}">${label}</span>`;
}
const BUILTIN_CASH_PAYOUT_ID = '__cash__';
function payoutAccountsForEmployee(employee = {}) {
  const saved = Array.isArray(employee.payoutAccounts) ? employee.payoutAccounts.filter((a) => a && a.id) : [];
  const nonCash = saved.filter((a) => String(a.method || '').trim().toLowerCase() !== 'cash' && a.id !== BUILTIN_CASH_PAYOUT_ID);
  return [{ id: BUILTIN_CASH_PAYOUT_ID, nickname: 'Cash', method: 'Cash', detail: 'Cash payout (in person)', builtIn: true }, ...nonCash];
}
function persistedPayoutAccounts(accounts = []) {
  return (accounts || []).filter((a) => a && a.id && a.id !== BUILTIN_CASH_PAYOUT_ID && !a.builtIn);
}
function employeePayoutRequestTotals(employeeUid = '') {
  return (state.payoutRequests || []).filter((r) => String(r.employeeUid || '') === String(employeeUid)).reduce((acc, r) => {
    const amount = Math.max(0, Number(r.amount || 0));
    if (r.status === 'pending') acc.pending += amount;
    if (r.status === 'paid') acc.paid += amount;
    return acc;
  }, { pending: 0, paid: 0 });
}
function employeeAvailablePayout(employee = getExperienceUser()) {
  if (!employee) return 0;
  const ledger = calculateEmployeePaymentLedger(employee, state.orders);
  const employeeUid = employee.uid || employee.id || '';
  const totals = employeePayoutRequestTotals(employeeUid);
  return Math.max(0, ledger.employeeEarnings - totals.pending - totals.paid);
}
function payoutAmountForMode() {
  const available = employeeAvailablePayout();
  if (state.payoutAmountMode === 'custom') return Math.max(0, Number(els.payoutCustomAmount?.value || 0));
  if (state.payoutAmountMode === 'dollar') return Math.floor(available + 1e-9);
  if (state.payoutAmountMode === 'ten') return Math.floor((available + 1e-9) / 10) * 10;
  return available;
}
function renderPayoutModal() {
  const employee = getExperienceUser();
  if (!els.payoutRequestModalWrap || isSecondaryLogin() || !employee || employee.role !== 'employee') return;
  const accounts = payoutAccountsForEmployee(employee);
  if (!state.selectedPayoutAccountId || !accounts.some((a) => a.id === state.selectedPayoutAccountId)) state.selectedPayoutAccountId = accounts[0]?.id || '';
  const available = employeeAvailablePayout(employee);
  const totals = employeePayoutRequestTotals(employee.uid || employee.id);
  if (els.payoutAvailableBalance) els.payoutAvailableBalance.textContent = currency(available);
  if (els.payoutHeldBalance) els.payoutHeldBalance.textContent = totals.pending > 0 ? `${currency(totals.pending)} currently pending` : 'No pending payout requests';
  if (els.payoutAccountsList) els.payoutAccountsList.innerHTML = accounts.map((a) => `<div class="payout-account-card ${a.id === state.selectedPayoutAccountId ? 'selected' : ''}"><button type="button" data-select-payout-account="${safeText(a.id)}"><strong>${safeText(a.nickname || a.method)}${a.builtIn ? ' <span class="badge badge-green">Always available</span>' : ''}</strong><span>${safeText(a.method)} · ${safeText(a.detail)}</span></button>${a.builtIn ? '' : `<button class="btn btn-ghost btn-small" type="button" data-delete-payout-account="${safeText(a.id)}">Remove</button>`}</div>`).join('');
  if (els.payoutAccountSelect) els.payoutAccountSelect.innerHTML = accounts.length ? accounts.map((a) => `<option value="${safeText(a.id)}" ${a.id === state.selectedPayoutAccountId ? 'selected' : ''}>${safeText(a.nickname || a.method)} — ${safeText(a.method)}</option>`).join('') : '<option value="">Add a payout account first</option>';
  const customValue = Math.max(0, Number(els.payoutCustomAmount?.value || 0));
  const payoutModeAmounts = {
    all: available,
    dollar: Math.floor(available + 1e-9),
    ten: Math.floor((available + 1e-9) / 10) * 10,
    custom: customValue
  };
  document.querySelectorAll('[data-payout-amount-mode]').forEach((btn) => {
    const mode = btn.dataset.payoutAmountMode || 'all';
    btn.classList.toggle('active', mode === state.payoutAmountMode);
    btn.textContent = mode === 'custom' ? 'Custom' : currency(payoutModeAmounts[mode] || 0);
    btn.title = mode === 'all' ? 'All available' : mode === 'dollar' ? 'Rounded down to the nearest dollar' : mode === 'ten' ? 'Rounded down to the nearest $10' : 'Custom amount';
  });
  els.payoutCustomAmountRow?.classList.toggle('hidden', state.payoutAmountMode !== 'custom');
  const amount = payoutAmountForMode();
  if (els.payoutRequestAmountPreview) els.payoutRequestAmountPreview.textContent = currency(amount);
  if (els.submitPayoutRequestBtn) els.submitPayoutRequestBtn.disabled = !accounts.length || available <= 0 || amount <= 0 || amount > available + 0.001;
}

function renderAccountManagement() {
  const employee = getExperienceUser();
  if (!employee || employee.role !== 'employee' || isSecondaryLogin()) return;
  const accounts = payoutAccountsForEmployee(employee);
  if (els.accountPayoutAccountsList) {
    els.accountPayoutAccountsList.innerHTML = accounts.map((a) => `<div class="payout-account-card"><div><strong>${safeText(a.nickname || a.method)}${a.builtIn ? ' <span class="badge badge-green">Always available</span>' : ''}</strong><span>${safeText(a.method)} · ${safeText(a.detail)}</span></div>${a.builtIn ? '' : `<button class="btn btn-ghost btn-small" type="button" data-account-delete-payout-account="${safeText(a.id)}">Remove</button>`}</div>`).join('');
  }
}
async function handleAccountPayoutSubmit(event) {
  event.preventDefault();
  const employee = getExperienceUser();
  if (!employee || employee.role !== 'employee' || isSecondaryLogin()) return;
  const data = new FormData(event.currentTarget);
  const nickname = String(data.get('nickname') || '').trim();
  const method = String(data.get('method') || '').trim();
  const detail = String(data.get('detail') || '').trim();
  if (!nickname || !method || !detail) return;
  const accounts = payoutAccountsForEmployee(employee);
  await withBusy(() => savePayoutAccounts([...accounts, { id: uid('payacct'), nickname, method, detail, createdAt: new Date().toISOString() }]), 'Saving payout account…');
  event.currentTarget.reset();
  event.currentTarget.classList.add('hidden');
  renderAccountManagement();
}
async function handleAccountPayoutClick(event) {
  const remove = event.target.closest('[data-account-delete-payout-account]');
  if (!remove) return;
  if (!confirm('Remove this payout account?')) return;
  const id = remove.dataset.accountDeletePayoutAccount;
  await withBusy(() => savePayoutAccounts(payoutAccountsForEmployee(getExperienceUser()).filter((a) => a.id !== id)), 'Removing payout account…');
  renderAccountManagement();
}

function openPayoutRequestModal() {
  const employee = getExperienceUser();
  if (isSecondaryLogin() || !employee || employee.role !== 'employee') return;
  state.payoutAmountMode = 'all';
  if (els.payoutRequestError) els.payoutRequestError.textContent = '';
  els.payoutAccountForm?.classList.add('hidden');
  renderPayoutModal();
  els.payoutRequestModalWrap?.classList.add('open');
}
function closePayoutRequestModal() { els.payoutRequestModalWrap?.classList.remove('open'); }
async function savePayoutAccounts(accounts) {
  const employee = getExperienceUser();
  if (!employee || employee.role !== 'employee') return;
  const saved = await saveOwnPayoutAccounts(employee, persistedPayoutAccounts(accounts));
  if (state.viewAsEmployee) state.viewAsEmployee = { ...state.viewAsEmployee, ...saved };
  else state.currentUser = { ...state.currentUser, ...saved };
  state.users = state.users.map((u) => (u.uid || u.id) === (saved.uid || saved.id) ? { ...u, ...saved } : u);
  renderPayoutModal();
  renderAccountManagement();
  renderEmployeeEarnedBalance();
}
async function handlePayoutAccountSubmit(event) {
  event.preventDefault();
  const employee = getExperienceUser();
  if (isSecondaryLogin() || !employee || employee.role !== 'employee') return;
  const data = new FormData(event.currentTarget);
  const nickname = String(data.get('nickname') || '').trim();
  const method = String(data.get('method') || '').trim();
  const detail = String(data.get('detail') || '').trim();
  if (!nickname || !method || !detail) return;
  const accounts = payoutAccountsForEmployee(employee);
  const account = { id: uid('payacct'), nickname, method, detail, createdAt: new Date().toISOString() };
  await withBusy(() => savePayoutAccounts([...accounts, account]), 'Saving payout account…');
  state.selectedPayoutAccountId = account.id;
  event.currentTarget.reset();
  event.currentTarget.classList.add('hidden');
  renderPayoutModal();
}
async function handlePayoutAccountsClick(event) {
  const select = event.target.closest('[data-select-payout-account]');
  const remove = event.target.closest('[data-delete-payout-account]');
  if (select) { state.selectedPayoutAccountId = select.dataset.selectPayoutAccount; renderPayoutModal(); return; }
  if (remove) {
    const id = remove.dataset.deletePayoutAccount;
    if (!confirm('Remove this payout account?')) return;
    await withBusy(() => savePayoutAccounts(payoutAccountsForEmployee(getExperienceUser()).filter((a) => a.id !== id)), 'Removing payout account…');
  }
}
async function submitPayoutRequest() {
  const employee = getExperienceUser();
  if (isSecondaryLogin() || !employee || employee.role !== 'employee') return;
  if (els.payoutRequestError) els.payoutRequestError.textContent = '';
  const available = employeeAvailablePayout(employee);
  const amount = payoutAmountForMode();
  const account = payoutAccountsForEmployee(employee).find((a) => a.id === (els.payoutAccountSelect?.value || state.selectedPayoutAccountId));
  if (!account) { if (els.payoutRequestError) els.payoutRequestError.textContent = 'Choose or add a payout account.'; return; }
  if (!(amount > 0) || amount > available + 0.001) { if (els.payoutRequestError) els.payoutRequestError.textContent = 'Choose an amount that is within your available balance.'; return; }

  // A real employee must always request against their own authenticated profile.
  // View-as is the one exception: the owner remains authenticated and may create
  // the request on behalf of the employee being viewed.
  const employeeUid = state.viewAsEmployee
    ? (employee.uid || employee.id)
    : (state.currentUser?.uid || state.currentUser?.id || employee.uid || employee.id);

  try {
    const request = await withBusy(() => createPayoutRequest({
      employeeUid,
      employeeName: employeeDisplayName(employee),
      amount: Math.round(amount * 100) / 100,
      amountMode: state.payoutAmountMode,
      payoutAccountId: account.id,
      payoutAccountNickname: account.nickname,
      payoutMethod: account.method,
      payoutDetail: account.detail
    }), 'Submitting payout request…');

    // Only show success after Firebase has written AND read the request back.
    state.payoutRequests = [request, ...state.payoutRequests.filter((r) => r.id !== request.id)];
    closePayoutRequestModal();
    renderEmployeeEarnedBalance();
    renderEmployeePayments();
    els.payoutConfirmationModalWrap?.classList.add('open');
  } catch (err) {
    console.error('Payout request failed:', err);
    const raw = String(err?.message || err || 'Unknown Firebase error');
    const permissionDenied = /permission|insufficient|denied/i.test(raw);
    if (els.payoutRequestError) {
      els.payoutRequestError.textContent = permissionDenied
        ? 'Request was NOT submitted. Firebase denied permission. Make sure the V57 Firestore rules are published, then try again.'
        : `Request was NOT submitted. ${raw}`;
    }
  }
}

function showPayoutRequestToast(request = {}) {
  if (!isAdminUser()) return;
  let toast = document.getElementById('payoutRequestToast');
  if (!toast) {
    toast = document.createElement('button');
    toast.type = 'button';
    toast.id = 'payoutRequestToast';
    toast.className = 'payout-request-toast';
    document.body.appendChild(toast);
    toast.addEventListener('click', () => {
      toast.classList.remove('show');
      state.activeTab = 'adminpayments';
      document.querySelector('[data-tab-btn="adminpayments"]')?.click();
      setTimeout(() => els.adminPayoutRequests?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    });
  }
  toast.innerHTML = `<span>💵</span><div><strong>New payout request</strong><small>${safeText(request.employeeName || 'Employee')} requested ${currency(Number(request.amount || 0))}${request.payoutMethod ? ` · ${safeText(request.payoutMethod)}` : ''}</small></div>`;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 7000);
}
async function refreshPayoutRequests({ notify = false } = {}) {
  const employeeUid = isSecondaryLogin()
    ? (state.primaryEmployee?.uid || state.currentUser?.primaryEmployeeId || '')
    : (state.currentUser?.uid || state.currentUser?.id || '');
  let rows = [];
  if (state.viewAsEmployee && isRealAdminUser()) {
    const viewedUid = state.viewAsEmployee.uid || state.viewAsEmployee.id || '';
    rows = await getPayoutRequests(viewedUid).catch((err) => { console.error('Could not load viewed employee payout requests', err); return state.payoutRequests || []; });
  } else if (isAdminUser()) {
    // Admin rules permit the whole collection. Prefer that so requests are visible
    // even if an employee profile was renamed, removed, or has legacy UID data.
    rows = await getPayoutRequests().catch(async (err) => {
      console.error('Could not load all payout requests; falling back to employee-scoped queries.', err);
      const employeeIds = (state.users || []).filter((u) => u && u.role === 'employee').map((u) => u.uid || u.id).filter(Boolean);
      const groups = await Promise.all(employeeIds.map((uid) => getPayoutRequests(uid).catch(() => [])));
      return groups.flat();
    });
  } else if (!isSecondaryLogin() && state.currentUser?.role === 'employee') {
    rows = await getPayoutRequests(employeeUid).catch((err) => {
      console.error('Could not load employee payout requests', err);
      return state.payoutRequests || [];
    });
  }
  const nextPending = new Set((rows || []).filter((r) => r.status === 'pending').map((r) => r.id).filter(Boolean));
  if (notify && isAdminUser()) {
    for (const request of (rows || []).filter((r) => r.status === 'pending')) {
      if (request.id && !state.knownPendingPayoutIds.has(request.id)) showPayoutRequestToast(request);
    }
  }
  state.payoutRequests = rows || [];
  state.knownPendingPayoutIds = nextPending;
  renderAdminPayoutRequests();
  renderEmployeePayments();
  renderEmployeePayouts();
  renderEmployeeEarnedBalance();
  renderEmployees();
  updateNewInquiryBadge();
}
function startPayoutRequestWatcher() {
  if (state.payoutWatcherTimer) clearInterval(state.payoutWatcherTimer);
  state.knownPendingPayoutIds = new Set((state.payoutRequests || []).filter((r) => r.status === 'pending').map((r) => r.id).filter(Boolean));
  // Keep payout requests fresh while the dashboard is open so the bell and
  // request history update without needing a manual page refresh.
  state.payoutWatcherTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshPayoutRequests({ notify: true }).catch((err) => console.error('Payout refresh failed', err));
  }, 30000);
}

async function refreshEmployeeOperationalData() {
  if (!isEmployeeUser() || state.viewAsEmployee) return;
  const employeeUid = isSecondaryLogin()
    ? (state.primaryEmployee?.uid || state.currentUser?.primaryEmployeeId || '')
    : (state.currentUser?.uid || state.currentUser?.id || '');
  if (!employeeUid) return;
  try {
    const [profile, rawOrders, schedule] = await Promise.all([
      getUserProfile(employeeUid).catch(() => null),
      getAssignedOrders(employeeUid).catch(() => null),
      getSchedule(employeeUid).catch(() => null)
    ]);
    if (profile) {
      if (isSecondaryLogin()) state.primaryEmployee = profile;
      else state.currentUser = { ...state.currentUser, ...profile };
      state.users = state.users.map((u) => String(u.uid || u.id) === String(employeeUid) ? { ...u, ...profile } : u);
    }
    if (Array.isArray(rawOrders)) {
      state.orders = rawOrders.map((order) => ({ assignedEmployeeId:'', assignedEmployeeName:'', ...order, paymentStatus: order.paymentStatus === 'Deposit' ? 'Deposit Paid' : order.paymentStatus }))
        .filter((order) => String(order.assignedEmployeeId || '') === String(employeeUid));
      syncAllOrdersToDepositRule({ touchUpdatedAt:false });
      renderOrders();
      renderOrdersCalendar();
      renderEmployeePayments();
      renderEmployeePayouts();
      renderEmployeeEarnedBalance();
    }
    if (schedule) state.schedules = [schedule];
    if (!isSecondaryLogin()) state.secondaryUsers = await getSecondaryUsers(employeeUid).catch(() => state.secondaryUsers || []);
    updateNewInquiryBadge();
  } catch (err) {
    console.error('Employee notification refresh failed', err);
  }
}
function startEmployeeNotificationWatcher() {
  if (state.employeeNotificationWatcherTimer) clearInterval(state.employeeNotificationWatcherTimer);
  if (!isEmployeeUser() || state.viewAsEmployee) return;
  state.employeeNotificationWatcherTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshEmployeeOperationalData();
  }, 30000);
}
function renderAdminPayoutRequests() {
  if (!els.adminPayoutRequests || !isAdminUser()) return;
  const rows = (state.payoutRequests || []).slice().sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const pending = rows.filter((r) => r.status === 'pending');
  const recent = rows.filter((r) => r.status !== 'pending');
  const renderRow = (r) => `<div class="admin-payout-request-card payout-status-${safeText(r.status || 'pending')}" data-payout-request-id="${safeText(r.id)}"><div><strong>${safeText(r.employeeName || 'Employee')} · ${currency(Number(r.amount || 0))}</strong><div class="admin-payout-request-meta"><span>${safeText(r.payoutAccountNickname || '')}</span><span>${safeText(r.payoutMethod || '')}</span><span>${safeText(r.payoutDetail || '')}</span><span>${safeText(r.createdAt ? new Date(r.createdAt).toLocaleString() : '')}</span><span>${safeText((r.status || 'pending').toUpperCase())}</span></div></div><div class="admin-payout-request-actions">${r.status === 'pending' ? `<button type="button" class="btn btn-primary btn-small" data-payout-mark-paid="${safeText(r.id)}">Mark Paid</button><button type="button" class="btn btn-ghost btn-small" data-payout-decline="${safeText(r.id)}">Decline</button>` : ''}</div></div>`;
  els.adminPayoutRequests.innerHTML = `<div class="admin-payout-requests-wrap"><div class="admin-payout-requests-head"><div><strong>Payout Requests</strong><div class="small muted">${pending.length} pending · Use Mark Paid after you have actually sent or handed over the money.</div></div></div>${pending.length ? pending.map(renderRow).join('') : '<div class="small muted">No pending payout requests.</div>'}${recent.length ? `<details style="margin-top:10px;"><summary style="cursor:pointer;font-weight:700;">Completed / processed requests (${recent.length})</summary><div class="stack-sm" style="margin-top:8px;">${recent.map(renderRow).join('')}</div></details>` : ''}</div>`;
}
async function handleAdminPayoutRequestClick(event) {
  const paid = event.target.closest('[data-payout-mark-paid]');
  const declined = event.target.closest('[data-payout-decline]');
  const id = paid?.dataset.payoutMarkPaid || declined?.dataset.payoutDecline;
  if (!id) return;
  const status = paid ? 'paid' : 'declined';
  await withBusy(() => updatePayoutRequestStatus(id, status), status === 'paid' ? 'Marking payout paid…' : 'Declining payout request…');
  state.payoutRequests = state.payoutRequests.map((r) => r.id === id ? { ...r, status, updatedAt: new Date().toISOString() } : r);
  renderAdminPayoutRequests();
  renderEmployees();
  renderEmployeePayments();
  renderEmployeePayouts();
  renderEmployeeEarnedBalance();
  updateNewInquiryBadge();
}

function renderEmployeeEarnedBalance() {
  if (!els.employeeEarnedBalance) return;
  if (!isEmployeeUser()) {
    els.employeeEarnedBalance.classList.add('hidden');
    return;
  }
  const employee = getExperienceUser();
  els.employeeEarnedBalance.classList.remove('hidden');
  const strong = els.employeeEarnedBalance.querySelector('strong');
  if (strong) strong.textContent = currency(employeeAvailablePayout(employee));
  const canRequest = !isSecondaryLogin() && employee?.role === 'employee';
  els.employeeEarnedBalance.classList.toggle('no-payout-access', !canRequest);
  els.employeeEarnedBalance.title = canRequest ? 'Click to request a payout' : 'Available employee balance';
}
function formatEmployeeActionTime(value = '') {
  const raw = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(new Date(`2000-01-01T${raw}:00`))
    .toLowerCase();
}
function renderEmployeePayments() {
  if (!els.employeePaymentsPanel || !isEmployeeUser()) return;
  const employee = getExperienceUser();
  const ledger = calculateEmployeePaymentLedger(employee, state.orders);
  const split = ledger.split || employeePaymentSettings(employee);
  const equipmentValue = equipmentValueForUser(employee);
  const remaining = Math.max(0, equipmentValue - ledger.payoffTotal);
  const totalProgressPercent = equipmentValue > 0 ? Math.min(100, (ledger.payoffTotal / equipmentValue) * 100) : 0;

  const equipmentRows = ledger.buckets.length ? ledger.buckets.map((b) => {
    const item = inventoryById(b.inventoryId) || {};
    const paidUnits = b.unitCost > 0 ? Math.min(b.quantity, Math.floor((b.payoff + 1e-9) / b.unitCost)) : b.quantity;
    const progressIntoNext = b.unitCost > 0 && paidUnits < b.quantity ? Math.max(0, b.payoff - (paidUnits * b.unitCost)) : 0;
    const nextPercent = b.unitCost > 0 && paidUnits < b.quantity ? Math.min(100, (progressIntoNext / b.unitCost) * 100) : 100;
    const overallPercent = b.totalCost > 0 ? Math.min(100, (b.payoff / b.totalCost) * 100) : 100;
    const nextLabel = paidUnits >= b.quantity
      ? 'All units qualified'
      : `${currency(progressIntoNext)} of ${currency(b.unitCost)} toward unit ${paidUnits + 1}`;

    return `<div class="employee-progress-card">
      <div class="employee-progress-card-head">
        <div>
          <strong>${safeText(item.name || 'Equipment')}</strong>
          <div class="small muted">${b.quantity} assigned · ${currency(b.unitCost)} each</div>
        </div>
        <div class="qualified-unit-count"><strong>${paidUnits}</strong><span>of ${b.quantity}<br>qualified</span></div>
      </div>
      <div class="employee-progress-track large" aria-label="${overallPercent.toFixed(0)} percent qualified">
        <span style="width:${overallPercent}%"></span>
      </div>
      <div class="employee-progress-card-summary">
        <span>${currency(b.payoff)} applied</span>
        <span>${currency(Math.max(0,b.totalCost-b.payoff))} remaining</span>
      </div>
      <div class="employee-next-unit">
        <div class="employee-next-unit-label"><span>${safeText(nextLabel)}</span><strong>${nextPercent.toFixed(0)}%</strong></div>
        <div class="employee-progress-track small"><span style="width:${nextPercent}%"></span></div>
      </div>
    </div>`;
  }).join('') : '<div class="empty-state">No equipment has been assigned to you yet.</div>';

  const paidRows = ledger.lines.length ? ledger.lines.slice().reverse().map((line) => {
    const order = line.order;
    return `<div class="employee-payment-order-card completed-payment">
      <div class="employee-payment-order-head">
        <div>
          <span class="employee-payment-order-state">Completed</span>
          <strong>${safeText(`${order.firstName || ''} ${order.lastName || ''}`.trim() || 'Customer')}</strong>
          <div class="small muted">${safeText(order.completedAt ? new Date(order.completedAt).toLocaleDateString() : (order.eventDate || order.exchangeDate || ''))} · ${safeText(summarizeOrderItems(order.items || []))}</div>
        </div>
        <div class="employee-order-earned"><span>You earned</span><strong>${currency(line.employee)}</strong></div>
      </div>
      ${(line.qualifiedUsage || []).length ? `<div class="qualified-boost-row completed">${line.qualifiedUsage.map((entry) => `<span class="qualified-boost-chip">${safeText(qualifiedUsageLabel(entry))} at qualified rate</span>`).join('')}</div>` : ''}
      <div class="employee-payment-split-row">
        <div><span>Qualified Unit progress</span><strong>${currency(line.payoff)}</strong></div>
        <div><span>Company</span><strong>${currency(line.company)}</strong></div>
        <div><span>Estimated rate</span><strong>${employeeHourlyEstimateHtml(employee, order, line.employee, true)}</strong></div>
      </div>
    </div>`;
  }).join('') : '<div class="empty-state">Complete an assigned order to see its final payment breakdown here.</div>';

  const employeeId = employee.uid || employee.id;
  const projectedOrders = (state.orders || [])
    .filter((order) =>
      order.assignedEmployeeId === employeeId &&
      ['Confirmed','In-Progress'].includes(order.status) &&
      String(order.paymentStatus || '').toLowerCase() !== 'free'
    );
  const projectionPlan = buildEmployeeProjectionPlan(employee, projectedOrders);

  const projectedRows = projectionPlan.length ? projectionPlan.map((projection) => {
    const order = projection.order;
    const actionLabel = order.status === 'In-Progress' ? 'Return' : 'Exchange';
    const actionDate = getOrderNextActionDate(order);
    const actionTime = formatEmployeeActionTime(getOrderNextActionTime(order) || '');
    const qualifiedBoosts = (projection.qualifiedUsage || []).map(qualifiedUsageLabel);
    const unlocked = (projection.newlyQualified || []).map((entry) => {
      const item = inventoryById(entry.inventoryId) || {};
      return `Unlocked +${entry.quantity} ${qualifiedUnitEmoji(item)} ${item.name || 'Qualified Unit'}`;
    });
    return `<div class="employee-payment-order-card projected-payment">
      <div class="projection-priority-strip">
        <span>Same-day priority ${projection.sameDayRank}${projection.sameDayCount > 1 ? ` of ${projection.sameDayCount}` : ''}</span>
        ${projection.sameDayCount > 1 ? '<strong>Largest equipment order first</strong>' : ''}
      </div>
      <div class="employee-payment-order-head">
        <div>
          <span class="employee-payment-order-state projection">${safeText(order.status === 'In-Progress' ? 'In progress' : 'Confirmed')}</span>
          <strong>${safeText(`${order.firstName || ''} ${order.lastName || ''}`.trim() || 'Customer')}</strong>
          <div class="small muted">${safeText(summarizeOrderItems(order.items || []))}</div>
        </div>
        <div class="employee-order-earned projected"><span>Projected earnings</span><strong>${currency(projection.employee)}</strong></div>
      </div>
      <div class="employee-projection-next-action"><strong>${safeText(actionLabel)}</strong><span>${safeText(formatFriendlyShortDate(actionDate))}${actionTime ? ` · ${safeText(actionTime)}` : ''}</span></div>
      ${qualifiedBoosts.length ? `<div class="qualified-boost-row">${qualifiedBoosts.map((label) => `<span class="qualified-boost-chip">${safeText(label)} at qualified rate</span>`).join('')}</div>` : ''}
      ${unlocked.length ? `<div class="qualified-unlock-row">${unlocked.map((label) => `<span>${safeText(label)} for later orders</span>`).join('')}</div>` : ''}
      <div class="employee-payment-split-row">
        <div><span>Qualified Unit progress</span><strong>${currency(projection.payoff)}</strong></div>
        <div><span>Company</span><strong>${currency(projection.company)}</strong></div>
        <div><span>Estimated rate</span><strong>${employeeHourlyEstimateHtml(employee, order, projection.employee, true)}</strong></div>
      </div>
    </div>`;
  }).join('') : '<div class="empty-state">No confirmed or in-progress assigned orders are waiting for completion.</div>';

  const employeePayoutRows = (state.payoutRequests || [])
    .filter((r) => String(r.employeeUid || '') === String(employeeId))
    .sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const pendingPayoutRows = employeePayoutRows.filter((r) => r.status === 'pending');
  const completedPayoutRows = employeePayoutRows.filter((r) => r.status === 'paid');
  const declinedPayoutRows = employeePayoutRows.filter((r) => r.status === 'declined');
  const payoutRowHtml = (r, statusLabel) => `<div class="employee-payout-history-row"><div><strong>${currency(Number(r.amount || 0))}</strong><span>${safeText(r.payoutAccountNickname || r.payoutMethod || 'Payout')} · ${safeText(r.createdAt ? new Date(r.createdAt).toLocaleString() : '')}</span></div><span class="badge ${r.status === 'paid' ? 'badge-green' : r.status === 'pending' ? 'badge-yellow' : 'badge-light'}">${safeText(statusLabel)}</span></div>`;
  const employeePayoutHistoryHtml = `<section class="employee-payments-section employee-payout-history-section">
    <div class="employee-payments-section-head"><div><span class="employee-section-kicker">Payouts</span><h3>Your payout requests</h3><p>Track requests you have submitted and payments management has completed.</p></div></div>
    <div class="employee-payout-history-grid">
      <div class="employee-payout-history-card"><div class="employee-payout-history-title"><strong>Pending</strong><span>${pendingPayoutRows.length}</span></div>${pendingPayoutRows.length ? pendingPayoutRows.map((r) => payoutRowHtml(r, 'Pending')).join('') : '<div class="small muted">No payout requests are pending.</div>'}</div>
      <div class="employee-payout-history-card"><div class="employee-payout-history-title"><strong>Completed</strong><span>${completedPayoutRows.length}</span></div>${completedPayoutRows.length ? completedPayoutRows.map((r) => payoutRowHtml(r, 'Paid')).join('') : '<div class="small muted">No completed payouts yet.</div>'}${declinedPayoutRows.length ? `<details class="employee-declined-payouts"><summary>${declinedPayoutRows.length} declined</summary>${declinedPayoutRows.map((r) => payoutRowHtml(r, 'Declined')).join('')}</details>` : ''}</div>
    </div>
  </section>`;

  const unpaidRateWidth = Math.max(0, Math.min(100, split.unpaidEmployee));
  const paidRateWidth = Math.max(0, Math.min(100, split.paidEmployee));

  els.employeePaymentsPanel.innerHTML = `
    <section class="employee-payment-hero">
      <div class="employee-payment-hero-main">
        <span class="employee-payment-eyebrow">Completed-order earnings</span>
        <strong>${currency(ledger.employeeEarnings)}</strong>
        <span>earned from completed assigned orders</span>
      </div>
      <div class="employee-payment-hero-progress">
        <div class="employee-payment-progress-heading"><span>Overall Qualified Unit progress</span><strong>${totalProgressPercent.toFixed(0)}%</strong></div>
        <div class="employee-progress-track hero"><span style="width:${totalProgressPercent}%"></span></div>
        <div class="employee-payment-progress-foot"><span>${currency(ledger.payoffTotal)} applied</span><span>${currency(remaining)} remaining</span></div>
      </div>
    </section>

    <section class="employee-payment-summary-grid">
      <div class="employee-payment-summary-card"><span>Equipment value</span><strong>${currency(equipmentValue)}</strong><small>assigned to your location</small></div>
      <div class="employee-payment-summary-card"><span>Qualified Unit progress</span><strong>${currency(ledger.payoffTotal)}</strong><small>from completed orders</small></div>
      <div class="employee-payment-summary-card"><span>Company share</span><strong>${currency(ledger.companyShare)}</strong><small>from completed orders</small></div>
    </section>

    <section class="employee-payments-section">
      <div class="employee-payments-section-head">
        <div><span class="employee-section-kicker">Your rates</span><h3>How each equipment rental is split</h3></div>
      </div>
      <div class="employee-rate-cards">
        <div class="employee-rate-card">
          <div><span>Before a unit qualifies</span><strong>${split.unpaidEmployee}% to you</strong></div>
          <div class="employee-rate-bar">
            <span class="employee-rate-you" style="width:${unpaidRateWidth}%"></span>
            <span class="employee-rate-progress" style="width:${Math.max(0,Math.min(100,split.equipmentPayoff))}%"></span>
            <span class="employee-rate-company" style="width:${Math.max(0,Math.min(100,split.unpaidCompany))}%"></span>
          </div>
          <div class="employee-rate-legend"><span>● You ${split.unpaidEmployee}%</span><span>● Qualified progress ${split.equipmentPayoff}%</span><span>● Company ${split.unpaidCompany}%</span></div>
        </div>
        <div class="employee-rate-card">
          <div><span>After a unit qualifies</span><strong>${split.paidEmployee}% to you</strong></div>
          <div class="employee-rate-bar">
            <span class="employee-rate-you qualified" style="width:${paidRateWidth}%"></span>
            <span class="employee-rate-company" style="width:${Math.max(0,Math.min(100,split.paidCompany))}%"></span>
          </div>
          <div class="employee-rate-legend"><span>● You ${split.paidEmployee}%</span><span>● Company ${split.paidCompany}%</span></div>
        </div>
      </div>
      <div class="small muted employee-direct-fees-note">Delivery fees, setup fees, and tips are 100% yours.</div>
    </section>

    <section class="employee-payments-section">
      <div class="employee-payments-section-head">
        <div><span class="employee-section-kicker">Progress</span><h3>Qualified Units</h3><p>Watch each equipment type move toward the higher payout rate.</p></div>
      </div>
      <div class="employee-progress-grid">${equipmentRows}</div>
    </section>

    <section class="employee-payments-section">
      <div class="employee-payments-section-head">
        <div><span class="employee-section-kicker">Next up</span><h3>Upcoming order projections</h3><p>Same-day orders are projected largest equipment-rental value first so newly Qualified Units can benefit later orders that day.</p></div>
      </div>
      <div class="employee-payment-order-list">${projectedRows}</div>
    </section>

    <section class="employee-payments-section">
      <div class="employee-payments-section-head">
        <div><span class="employee-section-kicker">History</span><h3>Completed order breakdown</h3><p>Only completed orders appear here, even if an active order has already been marked paid.</p></div>
      </div>
      <div class="employee-payment-order-list">${paidRows}</div>
    </section>`;
}
function renderEmployeePayouts() {
  if (!els.employeePayoutsPanel || !isEmployeeUser()) return;
  const employee = getExperienceUser();
  const employeeId = employee?.uid || employee?.id || '';
  const rows = (state.payoutRequests || [])
    .filter((r) => String(r.employeeUid || '') === String(employeeId))
    .sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const pending = rows.filter((r) => r.status === 'pending');
  const paid = rows.filter((r) => r.status === 'paid');
  const declined = rows.filter((r) => r.status === 'declined');
  const rowHtml = (r, label) => `<div class="employee-payout-history-row"><div><strong>${currency(Number(r.amount || 0))}</strong><span>${safeText(r.payoutAccountNickname || r.payoutMethod || 'Payout')} · ${safeText(r.createdAt ? new Date(r.createdAt).toLocaleString() : '')}${r.updatedAt && r.status === 'paid' ? ` · paid ${safeText(new Date(r.updatedAt).toLocaleString())}` : ''}</span></div><span class="badge ${r.status === 'paid' ? 'badge-green' : r.status === 'pending' ? 'badge-yellow' : 'badge-light'}">${safeText(label)}</span></div>`;
  els.employeePayoutsPanel.innerHTML = `<section class="employee-payments-section employee-payout-history-section">
    <div class="employee-payment-summary-grid">
      <div class="employee-payment-summary-card"><span>Available now</span><strong>${currency(employeeAvailablePayout(employee))}</strong><small>after pending and completed payouts</small></div>
      <div class="employee-payment-summary-card"><span>Pending</span><strong>${currency(pending.reduce((sum,r) => sum + Number(r.amount || 0), 0))}</strong><small>${pending.length} request${pending.length === 1 ? '' : 's'}</small></div>
      <div class="employee-payment-summary-card"><span>Paid out</span><strong>${currency(paid.reduce((sum,r) => sum + Number(r.amount || 0), 0))}</strong><small>${paid.length} completed payout${paid.length === 1 ? '' : 's'}</small></div>
    </div>
    <div class="employee-payout-history-grid" style="margin-top:14px;">
      <div class="employee-payout-history-card"><div class="employee-payout-history-title"><strong>Pending requests</strong><span>${pending.length}</span></div>${pending.length ? pending.map((r) => rowHtml(r, 'Pending')).join('') : '<div class="small muted">No payout requests are pending.</div>'}</div>
      <div class="employee-payout-history-card"><div class="employee-payout-history-title"><strong>Completed payouts</strong><span>${paid.length}</span></div>${paid.length ? paid.map((r) => rowHtml(r, 'Paid')).join('') : '<div class="small muted">No completed payouts yet.</div>'}${declined.length ? `<details class="employee-declined-payouts"><summary>${declined.length} declined request${declined.length === 1 ? '' : 's'}</summary>${declined.map((r) => rowHtml(r, 'Declined')).join('')}</details>` : ''}</div>
    </div>
  </section>`;
}

function renderEmployeeOrderDetails(order = {}) {
  const contact = order.contactMethods || {};
  const pickupAddress = order.fulfillmentType === 'Delivery' ? (order.address || 'No delivery address') : (order.assignedEmployeePickupAddress || getExperienceUser()?.pickupAddress || state.settings?.pickupAddress || 'Pickup address not set');
  const items = (order.items || []).map((item) => `<div class="calendar-stock-row"><div><strong>${safeText(item.name || 'Equipment')}</strong></div><div><strong>${Number(item.quantity || 0)}</strong></div></div>`).join('') || '<div class="empty-state">No equipment on this order.</div>';
  const previewDisabled = '';
  const canStart = ['Confirmed','Pending'].includes(order.status);
  const canComplete = ['Confirmed','In-Progress'].includes(order.status);
  const controls = `<div class="employee-order-controls">
    <div class="section-header"><div><strong>Order progress</strong><div class="small muted">You can adjust exchange/return times and advance the order status.</div></div></div>
    <div class="employee-order-control-grid">
      <label class="form-row"><span>Exchange time</span><input type="time" data-employee-exchange-time="${safeText(order.id)}" value="${safeText(normalizeInlineTimeValue(order.exchangeTime || ''))}" ${previewDisabled}></label>
      <label class="form-row"><span>Return time</span><input type="time" data-employee-return-time="${safeText(order.id)}" value="${safeText(normalizeInlineTimeValue(order.returnTime || ''))}" ${previewDisabled}></label>
    </div>
    <div class="employee-order-control-actions">
      <button type="button" class="btn btn-secondary btn-small" data-save-employee-times="${safeText(order.id)}" ${previewDisabled}>Save Times</button>
      ${canStart ? `<button type="button" class="btn btn-primary btn-small" data-employee-order-status="${safeText(order.id)}" data-next-status="In-Progress" ${previewDisabled}>Set In-Progress</button>` : ''}
      ${canComplete ? `<button type="button" class="btn btn-primary btn-small" data-employee-order-status="${safeText(order.id)}" data-next-status="Completed" ${previewDisabled}>Mark Completed</button>` : ''}
    </div>
  </div>`;
  return `<div class="employee-order-details"><div class="employee-order-kv"><div><span>Customer</span><strong>${safeText(`${order.firstName || ''} ${order.lastName || ''}`.trim() || 'Unnamed')}</strong></div><div><span>Event</span><strong>${safeText(order.eventName || 'Rental')}</strong></div><div><span>Event date</span><strong>${safeText(formatDateTime(order.eventDate, order.eventTime || 'To Be Determined'))}</strong></div><div><span>Exchange</span><strong>${safeText(formatDateTime(order.exchangeDate, order.exchangeTime || 'To Be Determined'))}</strong></div><div><span>Return</span><strong>${safeText(formatDateTime(order.returnDate, order.returnTime || 'To Be Determined'))}</strong></div><div><span>${order.fulfillmentType === 'Delivery' ? 'Delivery address' : 'Pickup address'}</span><strong>${safeText(pickupAddress)}</strong></div>${contact.text ? `<div><span>Phone</span><strong>${safeText(contact.text)}</strong></div>` : ''}${contact.email ? `<div><span>Email</span><strong>${safeText(contact.email)}</strong></div>` : ''}<div><span>Order total</span><strong>${currency(getEffectiveOrderTotal(order))}</strong></div><div><span>Payment</span><strong>${safeText(order.paymentStatus || 'Un-Paid')}</strong></div></div><div><strong>Equipment</strong><div class="calendar-stock-list" style="margin-top:6px;">${items}</div></div>${order.notes ? `<div class="note-block small"><strong>Notes:</strong> ${safeText(order.notes)}</div>` : ''}${controls}</div>`;
}
async function handleEmployeeOrderProgress(orderId, changes = {}) {
  const employee = getExperienceUser();
  if (!employee || employee.role !== 'employee' || (isSecondaryLogin() && state.currentUser?.status !== 'approved')) return;
  const current = state.orders.find((o) => o.id === orderId);
  if (!current) return;
  if (changes.status === 'Completed' && !window.confirm('Mark this order Completed? This will also mark a non-free order as paid.')) return;
  try {
    const saved = await withBusy(
      () => saveEmployeeOrderProgress(orderId, employee.uid, changes),
      changes.status ? `Updating order to ${changes.status}…` : 'Saving order times…'
    );
    state.orders = state.orders.map((o) => o.id === orderId ? saved : o);
    renderOrders();
    renderEmployeePayments();
    renderEmployeePayouts();
    renderEmployeeEarnedBalance();
  } catch (error) {
    alert(error?.message || 'Unable to update this order.');
  }
}
function populateEmployeeAssignmentSelect(selectedId = '') {
  const select = els.orderForm?.elements?.assignedEmployeeId;
  if (!select) return;
  select.innerHTML = '<option value="">Unassigned</option>' + approvedEmployees().map((u) => `<option value="${safeText(u.uid || u.id)}">${safeText(employeeDisplayName(u))}</option>`).join('');
  select.value = selectedId || '';
}

function renderEmployeeEquipmentPicker(employee = {}) {
  const uid = employee.uid || employee.id;
  const assignedIds = new Set(employeeAssignments(employee).map((a) => a.inventoryId));
  const categories = getInventoryCategoriesForOrderPicker();
  return `<div class="employee-equipment-picker-inner">
    <div class="small muted">Choose a category, then choose equipment to allocate.</div>
    <div class="quick-category-row">${categories.map((category) => `<button type="button" class="btn btn-ghost btn-small" data-employee-equipment-category="${safeText(category)}" data-employee-id="${safeText(uid)}">${safeText(category)}</button>`).join('')}</div>
    <div class="employee-equipment-category-results" data-employee-equipment-category-results></div>
  </div>`;
}
function renderEmployeeEquipmentCategoryResults(employee, category) {
  const uid = employee.uid || employee.id;
  const assignedIds = new Set(employeeAssignments(employee).map((a) => a.inventoryId));
  const ranked = sortedInventoryForCategory(category).filter(({item}) => !assignedIds.has(item.id));
  return ranked.length ? ranked.map(({item,usage}) => {
    const otherAllocated = allocatedQuantityAcrossEmployees(item.id, uid);
    const max = Math.max(0, Number(item.stock || 0) - otherAllocated);
    const image = getInventoryImageSrc(item);
    return `<button type="button" class="employee-equipment-choice" data-add-employee-equipment-choice="${safeText(item.id)}" data-employee-id="${safeText(uid)}">
      <div class="quick-ranked-thumb">${image ? `<img src="${image}" alt="" />` : '<span>◇</span>'}</div>
      <div><strong>${safeText(item.name)}</strong><div class="small muted">${max} available to allocate${usage.units ? ` · ${Math.round(usage.units)} historical units rented` : ''}</div></div>
      <span class="badge badge-light">${safeText(item.category || 'Other')}</span>
    </button>`;
  }).join('') : '<div class="empty-state">No unassigned equipment in this category.</div>';
}
function renderEmployees() {
  if (!els.employeesList || !isAdminUser()) return;
  const employees = (state.users || []).filter((u) => u.role === 'employee').sort((a,b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));
  els.employeesList.innerHTML = employees.length ? employees.map((u) => {
    const uid = u.uid || u.id;
    const assignments = employeeAssignments(u);
    const totalValue = equipmentValueForUser(u);
    const rows = assignments.map((a, index) => {
      const item = inventoryById(a.inventoryId) || {};
      const otherAllocated = allocatedQuantityAcrossEmployees(a.inventoryId, uid);
      const max = Math.max(0, Number(item.stock || 0) - otherAllocated);
      const accessories = normalizeAccessories(item.accessories || []);
      const accessoryMap = new Map((a.accessories || []).map((entry) => [String(entry.id), Number(entry.quantity || 0)]));
      const accessoryControls = accessories.length ? `<div class="employee-allocation-accessories"><div class="small muted"><strong>Accessories at this location</strong> · set quantity to 0 to remove</div><div class="employee-accessory-allocation-grid">${accessories.map((acc) => `<label class="employee-accessory-allocation"><span>${safeText(acc.name)}</span><input type="number" min="0" max="${Math.max(Number(a.quantity || 0), Number(accessoryMap.get(acc.id) || 0))}" step="1" data-employee-accessory-id="${safeText(acc.id)}" value="${Number(accessoryMap.get(acc.id) || 0)}" /></label>`).join('')}</div></div>` : '<div class="small muted employee-allocation-accessories">No accessories are configured for this inventory item.</div>';
      return `<div class="employee-allocation-row" data-employee-allocation-row="${safeText(a.lotId)}" data-inventory-id="${safeText(a.inventoryId)}"><div class="employee-allocation-item"><strong>${safeText(item.name || 'Equipment')}</strong><div class="small muted">${safeText(item.category || 'Other')} · Cost group ${index + 1} · Company total ${Number(item.stock || 0)}</div></div><div class="form-row"><label>Qty</label><input type="number" min="0" max="${max}" step="1" data-employee-equipment-qty value="${Number(a.quantity || 0)}" /></div><div class="form-row"><label>Cost each</label><input type="number" min="0" step="0.01" data-employee-equipment-cost value="${a.unitCost || ''}" placeholder="0.00" /></div><div><span class="small muted">Assigned value</span><strong data-allocation-line-total>${currency(Number(a.quantity || 0) * Number(a.unitCost || 0))}</strong></div><div class="employee-allocation-actions"><button type="button" class="btn btn-secondary btn-small" data-add-employee-price-lot="${safeText(a.inventoryId)}">+ Different Price</button><button type="button" class="btn btn-ghost btn-small" data-remove-employee-equipment-lot="${safeText(a.lotId)}">Remove</button></div>${accessoryControls}</div>`;
    }).join('') || '<div class="empty-state">No equipment assigned yet. Use Add Equipment to allocate inventory.</div>';
    const ledger = calculateEmployeePaymentLedger(u, state.orders);
    return `<div class="card" style="padding:16px;" data-employee-card="${safeText(uid)}"><div class="section-header"><div><strong>${safeText(employeeDisplayName(u))}</strong><div class="small muted">${safeText(u.email || '')} · ${safeText(u.phone || 'No phone')}</div></div><span class="badge ${u.status === 'approved' ? 'badge-green' : 'badge-yellow'}">${safeText(u.status || 'pending')}</span></div><div class="employee-location-row"><div class="small"><strong>Pickup location:</strong> ${safeText(u.pickupAddress || 'Not provided')}</div><label class="employee-exchange-time-field"><span>Average exchange time</span><div><input type="number" min="0" step="0.5" data-employee-average-exchange value="${Number(u.averageExchangeMinutes || 0)}" /><span>min each × 2</span></div></label><button class="btn btn-secondary btn-small" type="button" data-save-employee-exchange-time="${safeText(uid)}">Save</button></div>${u.emergencyContactName ? `<div class="small muted">Emergency contact: ${safeText(u.emergencyContactName)} · ${safeText(u.emergencyContactPhone || '')}</div>` : ''}<div class="employee-allocation-summary"><span class="badge badge-blue">Equipment value: ${currency(totalValue)}</span><span class="badge badge-yellow">Payoff applied: ${currency(ledger.payoffTotal)}</span><span class="badge badge-green">Remaining: ${currency(Math.max(0,totalValue-ledger.payoffTotal))}</span><span class="badge badge-blue">Payout available: ${currency(employeeAvailablePayout(u))}</span></div><details style="margin-top:12px;"><summary style="cursor:pointer;font-weight:700;">Equipment Allocation</summary><div class="employee-equipment-toolbar"><button class="btn btn-primary btn-small" data-open-employee-equipment-picker="${safeText(uid)}" type="button">+ Add Equipment</button><span class="small muted">${new Set(assignments.map((a) => a.inventoryId)).size} equipment type${new Set(assignments.map((a) => a.inventoryId)).size === 1 ? '' : 's'} · ${assignments.length} cost group${assignments.length === 1 ? '' : 's'}</span></div><div class="employee-equipment-picker hidden" data-employee-equipment-picker="${safeText(uid)}"></div><div class="employee-allocation-grid">${rows}</div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;"><button class="btn btn-primary btn-small" data-save-employee-equipment="${safeText(uid)}" type="button">Save Equipment Allocation</button></div></details><details style="margin-top:12px;"><summary style="cursor:pointer;font-weight:700;">Payment Settings</summary><div class="employee-payment-settings" style="margin-top:10px;"><div class="small muted" style="grid-column:1/-1;"><strong>While equipment is unpaid</strong> — these three percentages must total 100%.</div><label class="form-row"><span>Employee %</span><input type="number" min="0" max="100" step="0.01" data-payment-split="unpaidEmployee" value="${employeePaymentSettings(u).unpaidEmployee}" /></label><label class="form-row"><span>Equipment payoff %</span><input type="number" min="0" max="100" step="0.01" data-payment-split="equipmentPayoff" value="${employeePaymentSettings(u).equipmentPayoff}" /></label><label class="form-row"><span>Company %</span><input type="number" min="0" max="100" step="0.01" data-payment-split="unpaidCompany" value="${employeePaymentSettings(u).unpaidCompany}" /></label><div class="small muted" style="grid-column:1/-1;margin-top:4px;"><strong>After an individual unit is paid off</strong> — these two percentages must total 100%.</div><label class="form-row"><span>Employee %</span><input type="number" min="0" max="100" step="0.01" data-payment-split="paidEmployee" value="${employeePaymentSettings(u).paidEmployee}" /></label><label class="form-row"><span>Company %</span><input type="number" min="0" max="100" step="0.01" data-payment-split="paidCompany" value="${employeePaymentSettings(u).paidCompany}" /></label></div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;"><button class="btn btn-primary btn-small" data-save-employee-payment="${safeText(uid)}" type="button">Save Payment Settings</button></div></details><details class="employee-visual-settings" style="margin-top:12px;"><summary style="cursor:pointer;font-weight:700;">Order Colors</summary><div class="employee-color-editor" data-employee-color-editor>
  <div class="employee-color-inputs">
    <label class="employee-color-field"><span>Accent / edge</span><input type="color" data-employee-color="accent" value="${safeText(employeeOrderColors(u).accent)}" /></label>
    <label class="employee-color-field"><span>Card background</span><input type="color" data-employee-color="background" value="${safeText(employeeOrderColors(u).background)}" /></label>
    <label class="employee-color-field"><span>Name badge</span><input type="color" data-employee-color="badge" value="${safeText(employeeOrderColors(u).badge)}" /></label>
  </div>
  <div class="employee-color-preview-label small muted">Live preview</div>
  <div class="employee-order-color-preview" data-employee-color-preview style="--preview-accent:${safeText(employeeOrderColors(u).accent)};--preview-background:${safeText(employeeOrderColors(u).background)};--preview-badge:${safeText(employeeOrderColors(u).badge)};--preview-badge-text:${safeText(readableTextColor(employeeOrderColors(u).badge))}">
    <div class="preview-order-main"><strong>7:00 pm</strong><span>📋</span><strong>Sample Customer</strong><strong>$66.00</strong></div>
    <div class="preview-order-sub">36 White Folding Chair, 6 Six Foot White Folding Table</div>
    <div class="preview-order-meta"><span>Exchange Fri, Aug 28</span><span class="preview-employee-badge">Assigned to ${safeText(employeeDisplayName(u))}</span></div>
  </div>
  <div class="employee-color-actions"><button class="btn btn-secondary btn-small" data-save-employee-color="${safeText(uid)}" type="button">Save Order Colors</button></div>
</div></details><div class="employee-contract-summary"><div><strong>Contract Agreement</strong><div class="small muted">${employeeContractAgreement(u).body ? `Saved · ${safeText(employeeContractAgreement(u).status)}` : 'No contract saved yet'}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-secondary btn-small" data-edit-employee-contract="${safeText(uid)}" type="button">${employeeContractAgreement(u).body ? 'Edit Contract' : 'Create Contract'}</button><button class="btn btn-ghost btn-small" data-view-as-employee="${safeText(uid)}" type="button">View as Employee</button></div></div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">${u.status !== 'approved' ? `<button class="btn btn-primary btn-small" data-approve-employee="${safeText(uid)}">Approve</button>` : `<button class="btn btn-ghost btn-small" data-pend-employee="${safeText(uid)}">Set Pending</button>`}<button class="btn btn-danger btn-small" data-delete-employee="${safeText(uid)}">Delete Employee</button></div></div>`;
  }).join('') : '<div class="empty-state">No employee signups yet.</div>';
}
function updateEmployeeColorPreview(editor) {
  if (!editor) return;
  const preview = editor.querySelector('[data-employee-color-preview]');
  if (!preview) return;
  const accent = normalizeEmployeeColor(editor.querySelector('[data-employee-color="accent"]')?.value, '#7c3aed');
  const background = normalizeEmployeeColor(editor.querySelector('[data-employee-color="background"]')?.value, '#f7f5ff');
  const badge = normalizeEmployeeColor(editor.querySelector('[data-employee-color="badge"]')?.value, accent);
  preview.style.setProperty('--preview-accent', accent);
  preview.style.setProperty('--preview-background', background);
  preview.style.setProperty('--preview-badge', badge);
  preview.style.setProperty('--preview-badge-text', readableTextColor(badge));
}
async function handleEmployeeListClick(event) {
  const approve = event.target.closest('[data-approve-employee]');
  const pend = event.target.closest('[data-pend-employee]');
  const remove = event.target.closest('[data-delete-employee]');
  const saveEquipment = event.target.closest('[data-save-employee-equipment]');
  const openEquipmentPicker = event.target.closest('[data-open-employee-equipment-picker]');
  const equipmentCategory = event.target.closest('[data-employee-equipment-category]');
  const addEquipmentChoice = event.target.closest('[data-add-employee-equipment-choice]');
  const removeEquipment = event.target.closest('[data-remove-employee-equipment-lot]');
  const addPriceLot = event.target.closest('[data-add-employee-price-lot]');
  const saveExchangeTime = event.target.closest('[data-save-employee-exchange-time]');
  const savePayment = event.target.closest('[data-save-employee-payment]');
  const saveColor = event.target.closest('[data-save-employee-color]');
  const editContract = event.target.closest('[data-edit-employee-contract]');
  const viewAs = event.target.closest('[data-view-as-employee]');
  const id = approve?.dataset.approveEmployee || pend?.dataset.pendEmployee || remove?.dataset.deleteEmployee || saveEquipment?.dataset.saveEmployeeEquipment || openEquipmentPicker?.dataset.openEmployeeEquipmentPicker || equipmentCategory?.dataset.employeeId || addEquipmentChoice?.dataset.employeeId || removeEquipment?.closest('[data-employee-card]')?.dataset.employeeCard || addPriceLot?.closest('[data-employee-card]')?.dataset.employeeCard || saveExchangeTime?.dataset.saveEmployeeExchangeTime || savePayment?.dataset.saveEmployeePayment || saveColor?.dataset.saveEmployeeColor || editContract?.dataset.editEmployeeContract || viewAs?.dataset.viewAsEmployee;
  if (!id) return;
  const user = state.users.find((u) => (u.uid || u.id) === id);
  if (!user) return;

  if (openEquipmentPicker) {
    const picker = openEquipmentPicker.closest('[data-employee-card]')?.querySelector('[data-employee-equipment-picker]');
    if (!picker) return;
    picker.innerHTML = renderEmployeeEquipmentPicker(user);
    picker.classList.toggle('hidden');
    return;
  }
  if (equipmentCategory) {
    const card = equipmentCategory.closest('[data-employee-card]');
    const results = card?.querySelector('[data-employee-equipment-category-results]');
    if (!results) return;
    card.querySelectorAll('[data-employee-equipment-category]').forEach((btn) => btn.classList.toggle('active', btn === equipmentCategory));
    results.innerHTML = renderEmployeeEquipmentCategoryResults(user, equipmentCategory.dataset.employeeEquipmentCategory || '');
    return;
  }
  if (addEquipmentChoice) {
    const inventoryId = addEquipmentChoice.dataset.addEmployeeEquipmentChoice;
    if (!user.equipmentAssignments) user.equipmentAssignments = [];
    if (!user.equipmentAssignments.some((a) => String(a.inventoryId) === String(inventoryId))) {
      user.equipmentAssignments.push({ lotId: uid('lot'), inventoryId, quantity: 1, unitCost: 0, accessories: [] });
    }
    state.users = state.users.map((entry) => (entry.uid || entry.id) === id ? { ...user } : entry);
    renderEmployees();
    return;
  }
  if (addPriceLot) {
    const inventoryId = addPriceLot.dataset.addEmployeePriceLot;
    if (!user.equipmentAssignments) user.equipmentAssignments = [];
    user.equipmentAssignments.push({ lotId: uid('lot'), inventoryId, quantity: 1, unitCost: 0, accessories: [] });
    state.users = state.users.map((entry) => (entry.uid || entry.id) === id ? { ...user } : entry);
    renderEmployees();
    return;
  }
  if (removeEquipment) {
    const lotId = removeEquipment.dataset.removeEmployeeEquipmentLot;
    user.equipmentAssignments = employeeAssignments(user).filter((a) => String(a.lotId) !== String(lotId));
    state.users = state.users.map((entry) => (entry.uid || entry.id) === id ? { ...user } : entry);
    renderEmployees();
    return;
  }
  if (saveExchangeTime) {
    const card = saveExchangeTime.closest('[data-employee-card]');
    user.averageExchangeMinutes = Math.max(0, Number(card?.querySelector('[data-employee-average-exchange]')?.value || 0));
    await withBusy(async () => { await saveUserProfile(user); }, 'Saving average exchange time…');
    state.users = state.users.map((entry) => (entry.uid || entry.id) === id ? { ...user } : entry);
    renderEmployees();
    return;
  }

  if (viewAs) {
    enterViewAsEmployee(user);
    return;
  }
  if (editContract) {
    openEmployeeContractEditor(user);
    return;
  }

  if (saveColor) {
    const card = saveColor.closest('[data-employee-card]');
    const editor = card?.querySelector('[data-employee-color-editor]');
    const accent = editor?.querySelector('[data-employee-color="accent"]')?.value;
    const background = editor?.querySelector('[data-employee-color="background"]')?.value;
    const badge = editor?.querySelector('[data-employee-color="badge"]')?.value;
    user.orderAccentColor = normalizeEmployeeColor(accent, employeeOrderColors(user).accent);
    user.orderBackgroundColor = normalizeEmployeeColor(background, employeeOrderColors(user).background);
    user.orderBadgeColor = normalizeEmployeeColor(badge, employeeOrderColors(user).badge);
    user.highlightColor = user.orderAccentColor; // legacy compatibility
    await withBusy(async () => { await saveUserProfile(user); }, 'Saving employee order colors…');
    state.users = state.users.map((entry) => (entry.uid || entry.id) === id ? { ...user } : entry);
    renderEmployees();
    renderOrders();
    return;
  }

  if (savePayment) {
    const card = savePayment.closest('[data-employee-card]');
    const read = (key, fallback) => {
      const value = Number(card?.querySelector(`[data-payment-split="${key}"]`)?.value ?? fallback);
      return Math.max(0, Math.min(100, Number.isFinite(value) ? value : fallback));
    };
    const current = employeePaymentSettings(user);
    const nextSplit = {
      unpaidEmployee: read('unpaidEmployee', current.unpaidEmployee),
      equipmentPayoff: read('equipmentPayoff', current.equipmentPayoff),
      unpaidCompany: read('unpaidCompany', current.unpaidCompany),
      paidEmployee: read('paidEmployee', current.paidEmployee),
      paidCompany: read('paidCompany', current.paidCompany)
    };
    if (!validEmployeePaymentSettings(nextSplit)) {
      alert('Payment percentages are not valid. Unpaid equipment percentages must total 100%, and paid-off equipment percentages must total 100%.');
      return;
    }
    user.paymentSplit = nextSplit;
    await withBusy(async () => { await saveUserProfile(user); }, 'Saving payment settings…');
    state.users = state.users.map((entry) => (entry.uid || entry.id) === id ? { ...user } : entry);
    renderEmployees();
    return;
  }

  if (saveEquipment) {
    const card = saveEquipment.closest('[data-employee-card]');
    const nextAssignments = [];
    const totalsByInventory = new Map();
    for (const row of card?.querySelectorAll('[data-employee-allocation-row]') || []) {
      const inventoryId = row.dataset.inventoryId || '';
      const lotId = row.dataset.employeeAllocationRow || uid('lot');
      const item = inventoryById(inventoryId);
      if (!item) continue;
      const qty = Math.max(0, Math.floor(Number(row.querySelector('[data-employee-equipment-qty]')?.value || 0)));
      const unitCost = Math.max(0, Number(row.querySelector('[data-employee-equipment-cost]')?.value || 0));
      if (qty <= 0) continue;
      const accessories = [...row.querySelectorAll('[data-employee-accessory-id]')].map((input) => ({
        id: input.dataset.employeeAccessoryId,
        quantity: Math.max(0, Math.floor(Number(input.value || 0)))
      })).filter((a) => a.id && a.quantity > 0);
      nextAssignments.push({ lotId, inventoryId: item.id, quantity: qty, unitCost, accessories });
      totalsByInventory.set(item.id, (totalsByInventory.get(item.id) || 0) + qty);
    }
    for (const [inventoryId, qty] of totalsByInventory.entries()) {
      const item = inventoryById(inventoryId);
      const otherAllocated = allocatedQuantityAcrossEmployees(inventoryId, id);
      if (qty + otherAllocated > Number(item?.stock || 0)) {
        alert(`${item?.name || 'Equipment'}: only ${Math.max(0, Number(item?.stock || 0) - otherAllocated)} can be allocated to this employee across all price groups.`);
        return;
      }
    }
    user.equipmentAssignments = nextAssignments;
    if (user.pickupAddress && !user.pickupCoords) {
      try { user.pickupCoords = await geocodeAddress(user.pickupAddress, { context: state.settings || null }); } catch (_) {}
    }
    await withBusy(async () => { await saveUserProfile(user); await syncPublicPickupLocations(); }, 'Saving equipment allocation…');
    state.users = state.users.map((entry) => (entry.uid || entry.id) === id ? { ...user } : entry);
    renderEmployees(); populateQuickPeekLocationSelect(); renderCalendarView();
    return;
  }

  if (remove) {
    const assignedOrders = state.orders.filter((order) => order.assignedEmployeeId === id);
    const warning = assignedOrders.length
      ? `This employee is assigned to ${assignedOrders.length} order${assignedOrders.length === 1 ? '' : 's'}. Deleting them will return those orders to Unassigned. Continue?`
      : `Delete ${employeeDisplayName(user)}?`;
    if (!window.confirm(warning)) return;
    await withBusy(async () => {
      for (const order of assignedOrders) {
        const before = JSON.parse(JSON.stringify(order));
        order.assignedEmployeeId = '';
        order.assignedEmployeeName = '';
        order.assignedEmployeePickupAddress = '';
        order.updatedAt = new Date().toISOString();
        await saveSingleOrder(order, before, { actor: 'admin-delete-employee' });
      }
      await deleteUserProfile(id);
      state.users = state.users.filter((entry) => (entry.uid || entry.id) !== id);
      await syncPublicPickupLocations();
    }, 'Deleting employee…');
    populateEmployeeAssignmentSelect('');
    renderEmployees();
    renderOrders();
    return;
  }

  user.status = approve ? 'approved' : 'pending';
  await withBusy(async () => { await saveUserProfile(user); await syncPublicPickupLocations(); }, 'Updating employee…');
  renderEmployees();
  renderAdminPayoutRequests();
  populateQuickPeekLocationSelect();
}
async function copyEmployeeSignupLink() {
  const url = new URL('../employee-signup/index.html', window.location.href).href;
  await navigator.clipboard.writeText(url);
  if (els.employeeSignupLinkStatus) els.employeeSignupLinkStatus.textContent = 'Private employee signup link copied.';
}

async function copySecondaryLoginLink() {
  if (isSecondaryLogin()) return;
  const employee = getExperienceUser();
  if (!employee || employee.role !== 'employee') return;
  const url = new URL('../employee-signup/index.html', window.location.href);
  url.searchParams.set('secondaryFor', employee.uid || employee.id || '');
  url.searchParams.set('secondaryName', employeeDisplayName(employee));
  await navigator.clipboard.writeText(url.href);
  if (els.secondaryAccessStatus) els.secondaryAccessStatus.textContent = 'Private secondary-login link copied.';
}
function renderSecondaryAccess() {
  if (!els.secondaryAccessCard) return;
  const employee = getExperienceUser();
  const show = employee?.role === 'employee' && !isSecondaryLogin();
  els.secondaryAccessCard.classList.toggle('hidden', !show);
  if (!show || !els.secondaryAccessList) return;
  const employeeUid = employee.uid || employee.id || '';
  const rows = state.viewAsEmployee
    ? (state.users || []).filter((u) => u.role === 'secondary' && String(u.primaryEmployeeId || '') === String(employeeUid))
    : (state.secondaryUsers || []);
  els.secondaryAccessList.innerHTML = rows.length ? rows.map((u) => {
    const pending = u.status !== 'approved';
    return `<div class="secondary-access-row"><div><strong>${safeText(employeeDisplayName(u))}</strong><div class="small muted">${safeText(u.email || '')}${u.phone ? ` · ${safeText(u.phone)}` : ''}</div></div><span class="badge ${pending ? 'badge-yellow' : 'badge-green'}">${pending ? 'Needs your approval' : 'Approved'}</span><div class="button-row">${pending ? `<button type="button" class="btn btn-primary btn-small" data-approve-secondary="${safeText(u.uid || u.id)}">Approve</button>` : `<button type="button" class="btn btn-ghost btn-small" data-pend-secondary="${safeText(u.uid || u.id)}">Revoke Access</button>`}</div></div>`;
  }).join('') : '<div class="empty-state">No secondary logins have signed up from your link yet.</div>';
}
async function handleSecondaryAccessClick(event) {
  const approve = event.target.closest('[data-approve-secondary]');
  const pend = event.target.closest('[data-pend-secondary]');
  const secondaryUid = approve?.dataset.approveSecondary || pend?.dataset.pendSecondary;
  const employee = getExperienceUser();
  const primaryUid = employee?.uid || employee?.id || '';
  if (!secondaryUid || !employee || employee.role !== 'employee' || !primaryUid || isSecondaryLogin()) return;
  await withBusy(async () => {
    await updateSecondaryApproval(secondaryUid, primaryUid, Boolean(approve));
    state.users = state.users.map((u) => (u.uid || u.id) === secondaryUid ? { ...u, status: approve ? 'approved' : 'pending_primary', approvedByPrimaryAt: approve ? new Date().toISOString() : '', updatedAt: new Date().toISOString() } : u);
    if (!state.viewAsEmployee) state.secondaryUsers = await getSecondaryUsers(primaryUid).catch(() => state.secondaryUsers || []);
    renderSecondaryAccess();
  }, approve ? 'Approving secondary login…' : 'Revoking secondary login…');
}

function bindLogin() {
  els.loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    els.loginError.textContent = '';
    const form = new FormData(els.loginForm);
    try {
      await loginAdmin(form.get('email'), form.get('password'));
      window.location.reload();
    } catch (error) {
      els.loginError.textContent = error.message;
    }
  });
}
  const debouncedPickupLookup = debounce(async (query) => {
    if (!els.pickupAddressSuggestions) return;
    const text = (query || '').trim();
    const token = ++state.pickupLookupToken;
    if (text.length < 3) {
      renderPickupSuggestions([]);
      if (els.pickupLookupStatus) els.pickupLookupStatus.textContent = text ? 'Keep typing for address suggestions.' : '';
      return;
    }
    try {
      if (els.pickupLookupStatus) els.pickupLookupStatus.textContent = 'Looking up address…';
      const matches = await searchAddresses(text, { limit: 6, origin: state.settings?.pickupCoords || null, context: state.settings || null });
      if (token !== state.pickupLookupToken) return;
      renderPickupSuggestions(matches);
      if (els.pickupLookupStatus) els.pickupLookupStatus.textContent = matches.length ? (state.settings?.googleMapsApiKey ? 'Choose a Google suggestion below.' : 'Choose a suggestion below. Nearby matches are pushed to the top.') : 'No suggestions found yet. You can still save the typed address.';
    } catch (error) {
      if (token !== state.pickupLookupToken) return;
      renderPickupSuggestions([]);
      if (els.pickupLookupStatus) els.pickupLookupStatus.textContent = 'Autocomplete is unavailable right now. You can still save the typed address.';
    }
  }, 280);
function bindApp() {
  els.tabButtons.forEach((btn) => btn.addEventListener('click', async () => {
    if (['numbers','employees'].includes(btn.dataset.tabBtn) && !state.completedOrdersLoaded && isAdminUser()) await ensureCompletedOrdersLoaded();
    setTab(btn.dataset.tabBtn);
    closeMobileSidebar();
  }));
  els.logoutBtn.addEventListener('click', async () => {
    await logoutAdmin();
    window.location.reload();
  });
  els.copyPickupAddressBtn?.addEventListener('click', openCopyPasteMenu);
  els.copyEmployeeSignupLinkBtn?.addEventListener('click', copyEmployeeSignupLink);
  els.mobileMenuBtn?.addEventListener('click', toggleMobileSidebar);
  els.sidebarCloseBtn?.addEventListener('click', closeMobileSidebar);
  els.sidebarOverlay?.addEventListener('click', closeMobileSidebar);
  els.appSidebar?.addEventListener('click', (event) => {
    if (event.target.closest('a.nav-btn')) closeMobileSidebar();
  });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMobileSidebar(); });
  els.employeesList?.addEventListener('click', handleEmployeeListClick);
  els.adminPayoutRequests?.addEventListener('click', handleAdminPayoutRequestClick);
  els.employeeEarnedBalance?.addEventListener('click', openPayoutRequestModal);
  els.payoutRequestModalWrap?.addEventListener('click', (event) => { if (event.target === els.payoutRequestModalWrap || event.target.closest('[data-close-payout-modal]')) closePayoutRequestModal(); });
  els.payoutAccountsList?.addEventListener('click', handlePayoutAccountsClick);
  els.addPayoutAccountBtn?.addEventListener('click', () => els.payoutAccountForm?.classList.remove('hidden'));
  els.cancelPayoutAccountBtn?.addEventListener('click', () => { els.payoutAccountForm?.reset(); els.payoutAccountForm?.classList.add('hidden'); });
  els.payoutAccountForm?.addEventListener('submit', handlePayoutAccountSubmit);
  els.accountAddPayoutAccountBtn?.addEventListener('click', () => els.accountPayoutAccountForm?.classList.remove('hidden'));
  els.accountCancelPayoutAccountBtn?.addEventListener('click', () => { els.accountPayoutAccountForm?.reset(); els.accountPayoutAccountForm?.classList.add('hidden'); });
  els.accountPayoutAccountForm?.addEventListener('submit', handleAccountPayoutSubmit);
  els.accountPayoutAccountsList?.addEventListener('click', handleAccountPayoutClick);
  els.payoutAccountSelect?.addEventListener('change', () => { state.selectedPayoutAccountId = els.payoutAccountSelect.value; renderPayoutModal(); });
  document.querySelectorAll('[data-payout-amount-mode]').forEach((btn) => btn.addEventListener('click', () => { state.payoutAmountMode = btn.dataset.payoutAmountMode || 'all'; renderPayoutModal(); }));
  els.payoutCustomAmount?.addEventListener('input', renderPayoutModal);
  els.submitPayoutRequestBtn?.addEventListener('click', submitPayoutRequest);
  els.payoutConfirmationModalWrap?.addEventListener('click', (event) => { if (event.target === els.payoutConfirmationModalWrap || event.target.closest('[data-close-payout-confirmation]')) els.payoutConfirmationModalWrap.classList.remove('open'); });
  els.employeesList?.addEventListener('input', (event) => {
    const colorInput = event.target.closest('[data-employee-color]');
    if (!colorInput) return;
    updateEmployeeColorPreview(colorInput.closest('[data-employee-color-editor]'));
  });
  els.exitViewAsBtn?.addEventListener('click', exitViewAsEmployee);
  els.contractForm?.addEventListener('submit', saveEmployeeContract);
  els.employeeContractSetupForm?.addEventListener('submit', saveEmployeeContractConfirmation);
  els.loadBlankContractBtn?.addEventListener('click', loadBlankContractIntoEditor);
  document.querySelectorAll('[data-close-contract-modal]').forEach((btn) => btn.addEventListener('click', closeEmployeeContractEditor));
  els.contractModalWrap?.addEventListener('click', (event) => { if (event.target === els.contractModalWrap) closeEmployeeContractEditor(); });
  els.quickPeekLocationSelect?.addEventListener('change', () => { state.quickPeekLocationId = els.quickPeekLocationSelect.value || 'company'; renderCalendarView(); });
  els.ordersLocationFilter?.addEventListener('change', () => { state.orderLocationFilter = els.ordersLocationFilter.value || 'company'; renderOrders(); renderOrdersCalendar(); });
  els.copySecondaryLoginLinkBtn?.addEventListener('click', copySecondaryLoginLink);
  els.secondaryAccessList?.addEventListener('click', handleSecondaryAccessClick);
  els.copyPasteModalWrap?.addEventListener('click', (event) => { if (event.target === els.copyPasteModalWrap) closeCopyPasteMenu(); });
  document.querySelectorAll('[data-close-copy-paste-modal]').forEach((btn) => btn.addEventListener('click', closeCopyPasteMenu));
  els.copyPasteOptions?.addEventListener('click', handleCopyPasteOptionClick);
  els.addCopyPasteTemplateBtn?.addEventListener('click', addCustomCopyPasteTemplate);
  els.addOrderBtn.addEventListener('click', () => openOrderModal());
  els.ordersViewToggle?.addEventListener('click', (event) => { const btn = event.target.closest('[data-orders-view]'); if (!btn) return; state.ordersView = btn.dataset.ordersView === 'calendar' ? 'calendar' : 'list'; renderOrdersViewMode(); if (state.ordersView === 'calendar') renderOrdersCalendar(); });
  els.ordersCalendarPrevBtn?.addEventListener('click', () => shiftOrdersCalendarMonth(-1));
  els.ordersCalendarNextBtn?.addEventListener('click', () => shiftOrdersCalendarMonth(1));
  els.ordersCalendarTodayBtn?.addEventListener('click', () => { state.ordersCalendarDate = isoLocalDate(new Date()); renderOrdersCalendar(); });
  els.ordersMonthCalendar?.addEventListener('click', handleOrdersCalendarClick);
  els.schedulePersonSelect?.addEventListener('change', () => { state.schedulePersonId = els.schedulePersonSelect.value; state.scheduleEditingDate = ''; setWeeklyScheduleEditorOpen(false); renderSchedule(); });
  els.editWeeklyScheduleBtn?.addEventListener('click', () => setWeeklyScheduleEditorOpen(els.weeklyScheduleEditor?.classList.contains('hidden')));
  els.saveTypicalScheduleBtn?.addEventListener('click', saveTypicalScheduleFromForm);
  els.schedulePrevMonthBtn?.addEventListener('click', () => shiftScheduleMonth(-1));
  els.scheduleNextMonthBtn?.addEventListener('click', () => shiftScheduleMonth(1));
  els.scheduleTodayBtn?.addEventListener('click', () => { state.scheduleCalendarDate = new Date().toISOString().slice(0,10); renderScheduleCalendar(); });
  els.scheduleMonthCalendar?.addEventListener('click', handleScheduleCalendarClick);
  els.scheduleAddChangeBtn?.addEventListener('click', () => openScheduleChangeModal());
  els.scheduleChangeEditor?.addEventListener('click', handleScheduleChangeEditorClick);
  els.scheduleChangeEditor?.addEventListener('change', handleScheduleChangeEditorChange);
  els.scheduleChangeModalWrap?.addEventListener('click', (event) => { if (event.target === els.scheduleChangeModalWrap || event.target.closest('[data-close-schedule-change]')) closeScheduleChangeModal(); });
  els.routeStopsList?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-plan-route-date]');
    if (!btn) return;
    planDeliveryRoute(btn.dataset.planRouteDate);
  });
  els.addInventoryBtn.addEventListener('click', () => openInventoryModal());
  els.inventoryBackgroundBtn?.addEventListener('click', openInventoryBackgroundModal);
  els.inventoryBackgroundModalWrap?.addEventListener('click', (event) => { if (event.target === els.inventoryBackgroundModalWrap || event.target.closest('[data-close-inventory-background]')) closeInventoryBackgroundModal(); });
  els.inventoryBackgroundForm?.addEventListener('input', updateInventoryBackgroundPreview);
  els.inventoryBackgroundForm?.addEventListener('change', updateInventoryBackgroundPreview);
  els.inventoryBackgroundForm?.addEventListener('submit', handleInventoryBackgroundSave);
  els.resetInventoryBackgroundBtn?.addEventListener('click', () => { fillInventoryBackgroundForm({ mode: 'linear', color1: '#f8fafc', color2: '#dbeafe', angle: 135, texture: 'none', textureOpacity: .18, imageScale: 1.08, imageX: 0, imageY: 0, shadowEnabled: true, shadowColor: '#0f172a', shadowOpacity: .28, shadowBlur: 14, shadowX: 0, shadowY: 7, edgeGlow: .12, brightness: 1, contrast: 1.04, saturation: 1 }); updateInventoryBackgroundPreview(); });
  document.querySelectorAll('[data-close-modal]').forEach((btn) => btn.addEventListener('click', closeModals));
  document.querySelectorAll('[data-close-reminder-modal]').forEach((btn) => btn.addEventListener('click', closeReminderComposer));
  els.reminderModalWrap?.addEventListener('click', (e) => { if (e.target === els.reminderModalWrap) closeReminderComposer(); });
  els.reminderTabButtons?.forEach((btn) => btn.addEventListener('click', () => setReminderComposerTab(btn.dataset.reminderTab || 'details')));
  [els.reminderVerbalCheckbox, els.reminderDepositWaivedCheckbox, els.reminderEquipmentDiscussionCheckbox, els.reminderFriendlyIntroCheckbox, els.reminderIncludeTrackingCheckbox, els.reminderIncludeEquipmentCheckbox, els.reminderIncludeAddressCheckbox, els.reviewOlderCustomerCheckbox].forEach((input) => input?.addEventListener('change', handleReminderComposerFieldChange));
  els.reminderUpdatesList?.addEventListener('change', () => copyReminderComposerPreview(false));
  els.reminderUpdatesList?.addEventListener('click', handleReminderUpdatesListClick);
  els.copyReminderPreviewBtn?.addEventListener('click', () => copyReminderComposerPreview(true));
  els.numbersTabButtons?.forEach((btn) => btn.addEventListener('click', () => setNumbersTab(btn.dataset.numbersTab || 'costs')));
  els.saveCostsBtn?.addEventListener('click', handleSaveCosts);
  els.addAverageTaskBtn?.addEventListener('click', () => addAverageTask());
  els.saveAveragesBtn?.addEventListener('click', handleSaveAverages);
  els.averagesList?.addEventListener('click', handleAveragesListClick);
  els.averagesList?.addEventListener('change', handleAveragesListChange);
  els.costsList?.addEventListener('click', handleCostsListClick);
  els.costsList?.addEventListener('change', handleCostsListChange);
  els.earningsViewSelect?.addEventListener('change', () => { state.earningsView = els.earningsViewSelect.value || 'monthly'; state.expandedEarningsPeriod = ''; renderEarnings(); });
  els.inventoryModalWrap.addEventListener('click', (e) => { if (e.target === els.inventoryModalWrap) closeModals(); });
  els.orderForm.addEventListener('submit', handleOrderSave);
  els.orderForm.querySelectorAll('[data-full-editor-tab]').forEach((btn) => btn.addEventListener('click', () => {
    const target = btn.dataset.fullEditorTab;
    els.orderForm.querySelectorAll('[data-full-editor-tab]').forEach((entry) => entry.classList.toggle('active', entry === btn));
    els.orderForm.querySelectorAll('[data-full-editor-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.fullEditorPanel === target));
  }));
  initOrderTimeControls();
  els.orderForm.elements.exchangeDate?.addEventListener('change', () => setReturnDateFromExchange(false));
  els.orderForm.elements.returnDate?.addEventListener('change', () => { els.orderForm.elements.returnDate.dataset.userEdited = 'true'; });
  ['deliveryFee', 'setupFee', 'tipAmount'].forEach((name) => {
    els.orderForm.elements[name]?.addEventListener('input', syncOrderTotalsPreview);
  });
  els.orderForm.elements.total?.addEventListener('input', () => { els.orderForm.elements.total.dataset.userAdjusted = 'true'; syncDepositPreview(); });
  els.orderForm.elements.eventDate?.addEventListener('input', () => setExchangeAndReturnFromEventDate(false));
  ['exchangeDate', 'returnDate'].forEach((name) => {
    els.orderForm.elements[name]?.addEventListener('input', () => { els.orderForm.elements[name].dataset.userEdited = 'true'; });
  });
  document.querySelectorAll('[data-toggle-column]').forEach((btn) => btn.addEventListener('click', async () => {
    if (btn.dataset.toggleColumn === 'completed' && !state.completedOrdersLoaded) await ensureCompletedOrdersLoaded();
    state.activeOrderColumn = btn.dataset.toggleColumn || 'confirmed';
    applyOrderColumnCollapseState();
  }));
  els.backToActiveOrdersBtn?.addEventListener('click', () => {
    unloadCompletedOrders();
    applyOrderColumnCollapseState();
    els.confirmedColumn?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  els.newInquiryBell?.addEventListener('click', (event) => {
    event.stopPropagation();
    state.notificationPopoverOpen = !state.notificationPopoverOpen;
    renderNotificationPopover();
  });
  els.notificationPopover?.addEventListener('click', (event) => { event.stopPropagation(); handleNotificationClick(event); });
  document.addEventListener('click', (event) => {
    if (els.notificationCenter?.contains(event.target)) return;
    if (state.notificationPopoverOpen) closeNotificationPopover();
  });
  els.notificationOrderModalWrap?.addEventListener('click', (event) => {
    if (event.target === els.notificationOrderModalWrap || event.target.closest('[data-close-notification-order]')) closeNotificationOrderModal();
    const open = event.target.closest('[data-notification-open-order]');
    if (open) {
      const orderId = open.dataset.notificationOpenOrder;
      closeNotificationOrderModal();
      if (isEmployeeUser()) {
        state.activeTab = 'orders';
        state.expandedOrderId = orderId;
        renderTabs(); renderOrders();
        setTimeout(() => document.querySelector(`[data-expand-order="${CSS.escape(orderId)}"]`)?.scrollIntoView({ behavior:'smooth', block:'center' }), 30);
      } else {
        const order = state.orders.find((o) => o.id === orderId);
        if (order) openOrderModal(order.id);
      }
    }
  });
  els.inventoryForm.addEventListener('submit', handleInventorySave);
  els.settingsForm.addEventListener('submit', handleSettingsSave);
  els.calendarDateInput?.addEventListener('change', () => { state.quickPeekEventChosen = Boolean(els.calendarDateInput.value); handleQuickPeekEventDateChange(); });
  els.quickPeekExchangeDateInput?.addEventListener('change', renderCalendarView);
  els.quickPeekReturnDateInput?.addEventListener('change', renderCalendarView);
  els.calendarPrevBtn?.addEventListener('click', () => shiftCalendarDate(-1));
  els.calendarNextBtn?.addEventListener('click', () => shiftCalendarDate(1));
  els.calendarTodayBtn?.addEventListener('click', () => { if (els.calendarDateInput) { state.quickPeekEventChosen = true; els.calendarDateInput.value = new Date().toISOString().slice(0, 10); syncQuickPeekDatesFromEvent(true); renderCalendarView(); } });
  els.pickupAddressInput?.addEventListener('input', (event) => debouncedPickupLookup(event.target.value));
  els.pickupAddressInput?.addEventListener('focus', () => {
    if (state.pickupSuggestions.length) renderPickupSuggestions(state.pickupSuggestions);
  });
  els.pickupAddressInput?.addEventListener('blur', () => {
    window.setTimeout(() => hidePickupSuggestions(), 160);
  });
  els.pickupAddressSuggestions?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pickup-suggestion]');
    if (!button) return;
    const match = state.pickupSuggestions[Number(button.dataset.pickupSuggestion)];
    if (!match) return;
    els.pickupAddressInput.value = match.label;
    hidePickupSuggestions();
    if (els.pickupLookupStatus) els.pickupLookupStatus.textContent = 'Selected address suggestion.';
  });
  document.addEventListener('click', (event) => {
    if (event.target === els.pickupAddressInput || els.pickupAddressSuggestions?.contains(event.target)) return;
    hidePickupSuggestions();
  });
  els.backupExportBtn?.addEventListener('click', handleBackupExport);
  els.backupSnapshotBtn?.addEventListener('click', handleCreateSnapshot);
  els.backupImportBtn?.addEventListener('click', () => els.backupImportFile?.click());
  els.backupImportFile?.addEventListener('change', handleBackupImport);
  els.addAccessoryBtn?.addEventListener('click', () => {
    const emptyState = els.accessoriesBox?.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    els.accessoriesBox?.appendChild(createAccessoryRow());
  });
  els.accessoriesBox?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-remove-accessory]');
    if (!btn) return;
    btn.closest('.accessory-admin-row')?.remove();
    if (!els.accessoriesBox?.querySelector('.accessory-admin-row')) {
      renderAccessoryRows([]);
    }
  });
  els.accessoriesBox?.addEventListener('change', async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('[data-acc-upload]')) return;
    const row = input.closest('.accessory-admin-row');
    if (!row) return;
    const hidden = row.querySelector('[data-acc-image]');
    const preview = row.querySelector('[data-acc-preview]');
    try {
      const file = input.files?.[0];
      if (!file) {
        if (hidden) hidden.value = '';
        if (preview) {
          preview.src = '';
          preview.hidden = true;
        }
        return;
      }
      const compressed = await compressTransparentInventoryImage(file);
      if (hidden) hidden.value = compressed;
      if (preview) {
        preview.src = compressed;
        preview.hidden = false;
      }
    } catch (error) {
      console.error(error);
      alert('Could not process that accessory image.');
    }
  });
  els.imageUpload?.addEventListener('change', async () => {
    try {
      const file = els.imageUpload.files?.[0];
      if (!file) {
        if (els.imageData) els.imageData.value = '';
        handleInventoryImagePreview();
        return;
      }
      const compressed = await compressTransparentInventoryImage(file);
      if (els.imageData) els.imageData.value = compressed;
      handleInventoryImagePreview();
    } catch (error) {
      console.error(error);
      alert('Could not process that image.');
    }
  });
  ["Hero", "Quote", "Browse", "Track"].forEach((kind) => {
    const parts = getHomeImageElements(kind);
    parts.upload?.addEventListener("change", async () => {
      try {
        const file = parts.upload.files?.[0];
        if (!file) {
          setHomeImageData(kind, "");
          return;
        }
        const compressed = await compressImageFile(file, 1200, 0.84);
        setHomeImageData(kind, compressed);
      } catch (error) {
        console.error(error);
        alert("Could not process that homepage image.");
      }
    });
  });
  els.settingsForm?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-clear-home-image]");
    if (!button) return;
    setHomeImageData(button.dataset.clearHomeImage, "");
  });
}
async function loadImageLibrary() {
  state.imageLibrary = [];
}
function normalizeLibraryImageUrl(url) {
  return url || '';
}
function renderImageLibraryOptions(selected = '') {
  return;
}

function normalizeAdminTimeInput(value = '') {
  const raw = String(value || '').trim();
  if (!raw || /tbd|determined/i.test(raw)) return { tbd: true, hour: '10', minute: '00', ampm: 'AM', value: 'TBD' };
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return { tbd: false, hour: '10', minute: '00', ampm: 'AM', value: raw };
  let hour = Number(match[1]);
  const minute = ['00','15','30','45'].includes(match[2]) ? match[2] : '00';
  let ampm = (match[3] || '').toUpperCase();
  if (!ampm) {
    ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
  }
  hour = Math.min(12, Math.max(1, hour));
  return { tbd: false, hour: String(hour), minute, ampm, value: `${String(ampm === 'PM' && hour !== 12 ? hour + 12 : ampm === 'AM' && hour === 12 ? 0 : hour).padStart(2, '0')}:${minute}` };
}
function initOrderTimeControls() {
  document.querySelectorAll('[data-time-control]').forEach((wrap) => {
    const name = wrap.dataset.timeControl;
    const hours = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    const minutes = ['00','15','30','45'].map((m) => `<option value="${m}">${m}</option>`).join('');
    wrap.innerHTML = `<select data-time-hour="${name}">${hours}</select><select data-time-minute="${name}">${minutes}</select><select data-time-ampm="${name}"><option>AM</option><option>PM</option></select><label class="time-tbd-label"><input type="checkbox" data-time-tbd="${name}" /> TBD</label>`;
    wrap.querySelectorAll('select,input').forEach((input) => input.addEventListener('change', () => syncTimeControl(name)));
  });
}
function syncTimeControl(name) {
  const form = els.orderForm;
  const wrap = document.querySelector(`[data-time-control="${name}"]`);
  if (!form || !wrap) return;
  const hidden = form.elements[name];
  const tbd = wrap.querySelector(`[data-time-tbd="${name}"]`)?.checked;
  wrap.classList.toggle('is-tbd', Boolean(tbd));
  if (hidden) {
    const hour12 = Number(wrap.querySelector(`[data-time-hour="${name}"]`)?.value || 10);
    const minute = wrap.querySelector(`[data-time-minute="${name}"]`)?.value || '00';
    const ampm = wrap.querySelector(`[data-time-ampm="${name}"]`)?.value || 'AM';
    const hour24 = ampm === 'PM' && hour12 !== 12 ? hour12 + 12 : ampm === 'AM' && hour12 === 12 ? 0 : hour12;
    hidden.value = tbd ? 'TBD' : `${String(hour24).padStart(2, '0')}:${minute}`;
  }
}
function setTimeControlValue(name, value) {
  const form = els.orderForm;
  const wrap = document.querySelector(`[data-time-control="${name}"]`);
  if (!form || !wrap) return;
  const parsed = normalizeAdminTimeInput(value);
  const hour = wrap.querySelector(`[data-time-hour="${name}"]`);
  const minute = wrap.querySelector(`[data-time-minute="${name}"]`);
  const ampm = wrap.querySelector(`[data-time-ampm="${name}"]`);
  const tbd = wrap.querySelector(`[data-time-tbd="${name}"]`);
  if (hour) hour.value = parsed.hour;
  if (minute) minute.value = parsed.minute;
  if (ampm) ampm.value = parsed.ampm;
  if (tbd) tbd.checked = parsed.tbd;
  syncTimeControl(name);
}

function getHomeImageElements(kind) {
  return {
    upload: els[`home${kind}ImageUpload`],
    data: els[`home${kind}ImageData`],
    preview: els[`home${kind}ImagePreview`]
  };
}
function updateHomeImagePreview(kind) {
  const parts = getHomeImageElements(kind);
  const src = parts.data?.value || '';
  if (!parts.preview) return;
  parts.preview.src = src;
  parts.preview.hidden = !src;
}
function setHomeImageData(kind, src = '') {
  const parts = getHomeImageElements(kind);
  if (parts.data) parts.data.value = src || '';
  if (parts.upload) parts.upload.value = '';
  updateHomeImagePreview(kind);
}
function handleInventoryImagePreview() {
  const preview = document.getElementById('inventoryPreview');
  if (!preview) return;
  const src = els.imageData?.value || '';
  preview.src = src;
  preview.hidden = !src;
  if (els.inventoryPreviewSurface) { els.inventoryPreviewSurface.style.cssText = inventoryBackgroundCss(); const previewImg = els.inventoryPreviewSurface.querySelector('img'); if (previewImg) previewImg.style.cssText = inventoryImageCss(); }
}
async function loadData() {
  state.inventory = await getInventory();
  state.primaryEmployee = (isSecondaryLogin() && state.currentUser?.status === 'approved') ? await getUserProfile(state.currentUser.primaryEmployeeId).catch(() => null) : null;
  const employeeUid = isSecondaryLogin() ? (state.primaryEmployee?.uid || state.currentUser.primaryEmployeeId) : (state.currentUser?.uid || state.currentUser?.id || '');
  if (state.currentUser?.role === 'admin') state.users = await getUsers().catch(() => []);
  else if (isSecondaryLogin()) state.users = [state.primaryEmployee, state.currentUser].filter(Boolean);
  else state.users = [state.currentUser];
  state.secondaryUsers = (!isSecondaryLogin() && state.currentUser?.role === 'employee') ? await getSecondaryUsers(employeeUid).catch(() => []) : [];
  if (isAdminUser()) {
    state.payoutRequests = await getPayoutRequests().catch(async (err) => {
      console.error('Could not load all payout requests; trying employee-scoped queries.', err);
      const employeeIds = (state.users || []).filter((u) => u && u.role === 'employee').map((u) => u.uid || u.id).filter(Boolean);
      const payoutGroups = await Promise.all(employeeIds.map((uid) => getPayoutRequests(uid).catch(() => [])));
      return payoutGroups.flat();
    });
  } else {
    state.payoutRequests = (!isSecondaryLogin() && state.currentUser?.role === 'employee')
      ? await getPayoutRequests(employeeUid).catch((err) => { console.error('Could not load employee payout requests', err); return []; })
      : [];
  }
  state.settings = await getSettings();
  const secondaryApproved = !isSecondaryLogin() || state.currentUser?.status === 'approved';
  if (state.currentUser?.role === 'admin') state.schedules = await getSchedules().catch(() => []);
  else { const ownSchedule = secondaryApproved ? await getSchedule(employeeUid).catch(() => null) : null; state.schedules = ownSchedule ? [ownSchedule] : []; }
  state.schedulePersonId = employeeUid;
  const rawOrders = (state.currentUser?.role === 'employee' || isSecondaryLogin()) ? (secondaryApproved ? await getAssignedOrders(employeeUid) : []) : await getOpenOrders();
  const normalizedOrders = rawOrders.map((order) => ({
    assignedEmployeeId: '',
    assignedEmployeeName: '',
    ...order,
    paymentStatus: order.paymentStatus === 'Deposit' ? 'Deposit Paid' : order.paymentStatus
  }));
  const tracked = ensureOrdersHaveTrackingCodes(normalizedOrders);
  state.orders = tracked.orders;
  if (state.currentUser?.role === 'employee' || isSecondaryLogin()) state.orders = state.orders.filter((order) => order.assignedEmployeeId === employeeUid);

  // IMPORTANT: load-time normalization is runtime-only. Loading the admin must be read-only.
  // Deposit/payment derived values, legacy status labels, missing optional assignment fields,
  // and temporary tracking codes are allowed to normalize in memory, but are persisted only
  // when that specific order is later edited/saved by a real user action.
  syncAllOrdersToDepositRule({ touchUpdatedAt: false });
  state.reviews = await getPublicReviews().catch(() => []);
  state.costs = await getCostRecords().catch(() => []);
  state.averages = Array.isArray(state.settings?.averageTasks) ? state.settings.averageTasks : [];
}
function setBusyState(isBusy, message = 'Saving…') {
  if (!els.appBusyOverlay) return;
  if (isBusy) {
    state.busyCount = (state.busyCount || 0) + 1;
    if (els.appBusyMessage) els.appBusyMessage.textContent = message;
    els.appBusyOverlay.classList.add('open');
    document.body.classList.add('app-is-busy');
    return;
  }
  state.busyCount = Math.max(0, (state.busyCount || 0) - 1);
  if (state.busyCount > 0) return;
  els.appBusyOverlay.classList.remove('open');
  document.body.classList.remove('app-is-busy');
  if (els.appBusyMessage) els.appBusyMessage.textContent = 'Saving…';
}
async function withBusy(task, message = 'Saving…') {
  setBusyState(true, message);
  try {
    return await task();
  } finally {
    setBusyState(false);
  }
}

function loadingCard(message = 'Loading from Firebase…') {
  return `<div class="section-loading-card"><span class="section-loading-spinner" aria-hidden="true"></span><span>${safeText(message)}</span></div>`;
}
function renderLoadingPlaceholders(message = 'Loading from Firebase…') {
  const targets = [
    els.pendingList, els.confirmedList, els.completedList, els.routeStopsList, els.inventoryList,
    els.calendarAvailabilityBoard, els.reviewsList, els.costsSummary, els.costsList,
    els.earningsSummary, els.earningsBreakdown, els.averagesSummary, els.averagesList
  ];
  targets.forEach((target) => { if (target) target.innerHTML = loadingCard(message); });
  if (els.inventoryStats) els.inventoryStats.innerHTML = `<span class="badge badge-blue">Loading…</span>`;
}
async function saveOrderOnly(order, before = null, actor = 'admin-order') {
  await withBusy(async () => {
    await saveSingleOrder(order, before, { actor });
    renderOrders();
    renderOrdersCalendar();
    renderCalendarView();
    renderDeliveryRoute();
    renderAdminReviews();
    renderNumbers();
  renderEmployees();
  renderEmployeePayments();
  renderEmployeePayouts();
  }, 'Saving order…');
}
const WORKSPACE_TITLES = {
  orders: ['Orders', 'Manage active rentals and quickly review what needs attention.'],
  route: ['Delivery Route', 'Plan upcoming deliveries and customer pickups by date.'],
  inventory: ['Inventory', 'Manage company equipment, quantities, accessories, and availability.'],
  calendar: ['Quick Peek', 'Check equipment and team availability for a specific rental window.'],
  schedule: ['Schedule', 'Set typical availability and date-specific changes.'],
  account: ['Account Management', 'Manage secondary access and payout accounts.'],
  reviews: ['Reviews', 'Review customer feedback and follow up where needed.'],
  numbers: ['The Numbers', 'See costs, earnings, and operational performance in one place.'],
  employees: ['Employees', 'Manage employee access, equipment, contracts, and compensation.'],
  payments: ['Payments', 'Track your earnings and Qualified Unit progress.'],
  mypayouts: ['My Payouts', 'Track your pending requests and completed payouts.'],
  adminpayments: ['Payments', 'Review employee payout requests and processed payouts.'],
  documents: ['Documents', 'Review your current company documents and contract agreement.'],
  settings: ['Settings', 'Manage company defaults, notifications, pickup details, and backups.']
};
function updateWorkspaceHeader() {
  const experienceUser = getExperienceUser();
  const [title, subtitle] = WORKSPACE_TITLES[state.activeTab] || ['Rent Some Orders', ''];
  if (els.dashboardTitle) {
    els.dashboardTitle.textContent = state.viewAsEmployee
      ? `${title} — ${employeeDisplayName(experienceUser)}`
      : title;
  }
  if (els.dashboardSubtitle) els.dashboardSubtitle.textContent = subtitle;
}
function renderAll() {
  renderTabs();
  renderOrders();
  renderOrdersCalendar();
  renderSchedule();
  renderDeliveryRoute();
  renderInventory();
  renderCalendarView();
  renderReminderEditor();
  renderSettings();
  renderAdminReviews();
  renderNumbers();
  renderEmployees();
  renderAdminPayoutRequests();
  populateQuickPeekLocationSelect();
  populateOrdersLocationFilter();
  renderSecondaryAccess();
  renderAccountManagement();
  renderEmployeePayments();
  renderEmployeePayouts();
  renderEmployeeEarnedBalance();
  renderEmployeeDocuments();
}
function setTab(tab) {
  state.activeTab = tab;
  renderTabs();
}
function openMobileSidebar() {
  document.body.classList.add('sidebar-open');
  if (els.appSidebar) {
    els.appSidebar.classList.add('mobile-open');
    // Inline transform is deliberate: iOS Safari can occasionally retain an
    // earlier media-query transform even after the class changes.
    els.appSidebar.style.transform = 'translate3d(0,0,0)';
    els.appSidebar.style.webkitTransform = 'translate3d(0,0,0)';
  }
  els.sidebarOverlay?.classList.add('open');
  els.sidebarOverlay?.setAttribute('aria-hidden','false');
  els.mobileMenuBtn?.setAttribute('aria-expanded','true');
}
function closeMobileSidebar() {
  document.body.classList.remove('sidebar-open');
  if (els.appSidebar) {
    els.appSidebar.classList.remove('mobile-open');
    els.appSidebar.style.transform = '';
    els.appSidebar.style.webkitTransform = '';
  }
  els.sidebarOverlay?.classList.remove('open');
  els.sidebarOverlay?.setAttribute('aria-hidden','true');
  els.mobileMenuBtn?.setAttribute('aria-expanded','false');
}
function toggleMobileSidebar() {
  if (document.body.classList.contains('sidebar-open')) closeMobileSidebar();
  else openMobileSidebar();
}
function renderTabs() {
  els.tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tabBtn === state.activeTab));
  els.panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.tabPanel === state.activeTab));
  updateWorkspaceHeader();
}

function setNumbersTab(tab = 'costs') {
  state.numbersTab = ['earnings', 'averages'].includes(tab) ? tab : 'costs';
  renderNumbersTabs();
}
function renderNumbersTabs() {
  els.numbersTabButtons?.forEach((btn) => {
    const active = btn.dataset.numbersTab === state.numbersTab;
    btn.classList.toggle('btn-primary', active);
    btn.classList.toggle('btn-ghost', !active);
  });
  els.numbersPanels?.forEach((panel) => panel.classList.toggle('active', panel.dataset.numbersPanel === state.numbersTab));
}
function normalizeCostRecord(record = {}) {
  const type = record.type === 'Recurring' ? 'Recurring' : 'One-Time';
  const recurringEntries = Array.isArray(record.recurringEntries)
    ? record.recurringEntries.map((entry) => ({
        date: String(entry?.date || '').trim(),
        amount: entry?.amount === '' || entry?.amount == null ? '' : Number(entry.amount || 0)
      })).filter((entry) => entry.date || entry.amount !== '')
    : [];
  return {
    id: record.id || uid('cost'),
    category: record.category || 'Inventory',
    type,
    inventoryId: record.inventoryId || '',
    accessoryId: record.accessoryId || '',
    costAccessoryLinks: Array.isArray(record.costAccessoryLinks)
      ? record.costAccessoryLinks.map((entry) => ({
          id: entry?.id || uid('costacc'),
          inventoryId: entry?.inventoryId || '',
          accessoryId: entry?.accessoryId || '',
          quantity: entry?.quantity === '' || entry?.quantity == null ? '' : Number(entry.quantity || 0),
          costEach: entry?.costEach === '' || entry?.costEach == null ? '' : Number(entry.costEach || 0),
          note: String(entry?.note || '').trim()
        })).filter((entry) => entry.inventoryId || entry.accessoryId || entry.note)
      : [],
    name: String(record.name || '').trim(),
    quantity: record.quantity === '' || record.quantity == null ? '' : Number(record.quantity || 0),
    price: record.price === '' || record.price == null ? '' : Number(record.price || 0),
    recurringEntries,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString()
  };
}
function getInventoryCostOptions() {
  const out = [];
  (state.inventory || []).forEach((item) => {
    out.push({ value: `inv:${item.id}`, inventoryId: item.id, accessoryId: '', label: `${item.name} (${item.category || 'Inventory'})` });
    normalizeAccessories(item.accessories || []).forEach((acc) => {
      out.push({ value: `acc:${item.id}:${acc.id}`, inventoryId: item.id, accessoryId: acc.id, label: `${item.name} — ${acc.name}` });
    });
  });
  return out;
}

function getInventoryOnlyCostOptions() {
  return (state.inventory || []).map((item) => ({ value: item.id, label: `${item.name} (${item.category || 'Inventory'})` }));
}
function getAccessoryOptionsForInventory(inventoryId = '') {
  const item = (state.inventory || []).find((entry) => entry.id === inventoryId);
  return normalizeAccessories(item?.accessories || []).map((acc) => ({ value: acc.id, label: acc.name }));
}
function getCostAccessoryLinks(row = {}) {
  return Array.isArray(row.costAccessoryLinks) ? row.costAccessoryLinks : [];
}
function getCostAccessoryLinkLabel(link = {}) {
  const item = (state.inventory || []).find((entry) => entry.id === link.inventoryId);
  const acc = normalizeAccessories(item?.accessories || []).find((entry) => entry.id === link.accessoryId);
  return [item?.name || 'Inventory item', acc?.name || 'Accessory'].join(' — ');
}
function getCostAccessoryLinkTotal(link = {}) {
  return Number(link.quantity || 0) * Number(link.costEach || 0);
}
function getCostAccessoryLinksTotal(row = {}) {
  return getCostAccessoryLinks(row).reduce((sum, link) => sum + getCostAccessoryLinkTotal(link), 0);
}
function renderCostAccessoryModalRow(link = {}) {
  const inventoryOptions = getInventoryOnlyCostOptions();
  const invId = link.inventoryId || inventoryOptions[0]?.value || '';
  const accessoryOptions = getAccessoryOptionsForInventory(invId);
  const accId = link.accessoryId || accessoryOptions[0]?.value || '';
  return `<div class="cost-accessory-row" data-cost-accessory-row data-cost-accessory-id="${safeText(link.id || uid('costacc'))}">
    <label><span>Inventory item</span><select data-cost-accessory-inventory><option value="">Choose item</option>${inventoryOptions.map((opt) => `<option value="${safeText(opt.value)}" ${invId === opt.value ? 'selected' : ''}>${safeText(opt.label)}</option>`).join('')}</select></label>
    <label><span>Accessory</span><select data-cost-accessory-select><option value="">Choose accessory</option>${accessoryOptions.map((opt) => `<option value="${safeText(opt.value)}" ${accId === opt.value ? 'selected' : ''}>${safeText(opt.label)}</option>`).join('')}</select></label>
    <label><span>Qty bought</span><input type="number" min="0" step="1" data-cost-accessory-qty value="${link.quantity === '' ? '' : safeText(link.quantity ?? 1)}" /></label>
    <label><span>Cost each</span><input type="number" min="0" step="0.01" data-cost-accessory-each value="${link.costEach === '' ? '' : safeText(link.costEach ?? '')}" /></label>
    <button type="button" class="icon-btn cost-icon-btn danger" data-remove-cost-accessory title="Remove accessory">×</button>
  </div>`;
}
function refreshCostAccessorySelect(row) {
  const invId = row.querySelector('[data-cost-accessory-inventory]')?.value || '';
  const select = row.querySelector('[data-cost-accessory-select]');
  if (!select) return;
  const current = select.value;
  const options = getAccessoryOptionsForInventory(invId);
  select.innerHTML = `<option value="">Choose accessory</option>${options.map((opt) => `<option value="${safeText(opt.value)}" ${current === opt.value ? 'selected' : ''}>${safeText(opt.label)}</option>`).join('')}`;
}
function collectCostAccessoryLinksFromModal(modal) {
  return [...modal.querySelectorAll('[data-cost-accessory-row]')].map((row) => ({
    id: row.dataset.costAccessoryId || uid('costacc'),
    inventoryId: row.querySelector('[data-cost-accessory-inventory]')?.value || '',
    accessoryId: row.querySelector('[data-cost-accessory-select]')?.value || '',
    quantity: row.querySelector('[data-cost-accessory-qty]')?.value === '' ? '' : Number(row.querySelector('[data-cost-accessory-qty]')?.value || 0),
    costEach: row.querySelector('[data-cost-accessory-each]')?.value === '' ? '' : Number(row.querySelector('[data-cost-accessory-each]')?.value || 0)
  })).filter((entry) => entry.inventoryId || entry.accessoryId);
}
function getCostRowsForDisplay() {
  const categoryOrder = ['Inventory', 'Monthly Expenses', 'Recurring Expenses', 'Tools / Supplies', 'Repairs / Maintenance', 'Marketing', 'Fuel / Delivery', 'Labor / Payroll', 'Insurance / Legal', 'Other'];
  return (state.costs || []).map(normalizeCostRecord).sort((a, b) => {
    const ai = categoryOrder.indexOf(a.category || 'Other');
    const bi = categoryOrder.indexOf(b.category || 'Other');
    const ac = ai === -1 ? 999 : ai;
    const bc = bi === -1 ? 999 : bi;
    return ac - bc || String(a.name || '').localeCompare(String(b.name || ''));
  });
}
function getCostTotal(record = {}) {
  if (record.type === 'Recurring') {
    return (record.recurringEntries || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  }
  const quantity = Number(record.quantity || 0);
  const price = Number(record.price || 0);
  return (quantity * price) + getCostAccessoryLinksTotal(record);
}
function collectCostsFromTable() {
  return (state.costs || []).map(normalizeCostRecord).filter((record) => record.category || record.name || record.quantity !== '' || record.price !== '' || (record.recurringEntries || []).length || (record.costAccessoryLinks || []).length);
}
function findCostOptionValue(row = {}) {
  if (row.accessoryId) return `acc:${row.inventoryId}:${row.accessoryId}`;
  if (row.inventoryId) return `inv:${row.inventoryId}`;
  const match = getInventoryCostOptions().find((opt) => opt.label === row.name || opt.label.startsWith(`${row.name} (`));
  return match?.value || '';
}
function getCostCategories() {
  return ['Inventory', 'Monthly Expenses', 'Recurring Expenses', 'Tools / Supplies', 'Repairs / Maintenance', 'Marketing', 'Fuel / Delivery', 'Labor / Payroll', 'Insurance / Legal', 'Other'];
}
function renderCosts() {
  if (!els.costsList) return;
  const rows = getCostRowsForDisplay();
  const totalSpent = rows.reduce((sum, row) => sum + getCostTotal(row), 0);
  const oneTimeTotal = rows.filter((row) => row.type !== 'Recurring').reduce((sum, row) => sum + getCostTotal(row), 0);
  const recurringTotal = rows.filter((row) => row.type === 'Recurring').reduce((sum, row) => sum + getCostTotal(row), 0);
  const recurringRows = rows.filter((row) => row.type === 'Recurring').length;
  if (els.costsSummary) {
    els.costsSummary.innerHTML = `
      <div class="numbers-metric"><div class="metric-label">Total saved costs</div><div class="metric-value">${currency(totalSpent)}</div></div>
      <div class="numbers-metric"><div class="metric-label">One-time purchases</div><div class="metric-value">${currency(oneTimeTotal)}</div></div>
      <div class="numbers-metric"><div class="metric-label">Recurring charges logged</div><div class="metric-value">${currency(recurringTotal)}</div></div>
      <div class="numbers-metric"><div class="metric-label">Cost lines</div><div class="metric-value">${rows.length}</div><div class="small muted">${recurringRows} recurring</div></div>
    `;
  }
  const costCategories = getCostCategories();
  const grouped = new Map();
  costCategories.forEach((cat) => grouped.set(cat, []));
  rows.forEach((row) => {
    const key = costCategories.includes(row.category) ? row.category : 'Other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  els.costsList.innerHTML = `<div class="cost-category-grid">${[...grouped.entries()].map(([category, groupRows]) => {
    const collapsed = Boolean(state.collapsedCostCategories[category]);
    const groupTotal = groupRows.reduce((sum, row) => sum + getCostTotal(row), 0);
    return `<div class="numbers-source-card cost-category-card" data-cost-category-card="${safeText(category)}">
      <div class="cost-category-headline">
        <button type="button" class="cost-category-head" data-toggle-cost-category="${safeText(category)}" title="Show or hide costs">
          <span><strong>${safeText(category)}</strong><span class="small muted"> ${groupRows.length} line${groupRows.length === 1 ? '' : 's'}</span></span>
          <span class="badge badge-green">${currency(groupTotal)}</span>
        </button>
        <button type="button" class="btn btn-primary btn-small cost-add-btn" data-add-cost-category="${safeText(category)}">+</button>
      </div>
      <div class="cost-category-body ${collapsed ? 'hidden' : ''}">
        ${groupRows.length ? groupRows.map((row) => renderCostSummaryCard(row)).join('') : `<div class="empty-state compact">No costs yet. Tap + to add one.</div>`}
      </div>
    </div>`;
  }).join('')}</div>`;
}
function renderCostSummaryCard(row = {}) {
  const linked = row.inventoryId ? getInventoryCostOptions().find((opt) => opt.value === findCostOptionValue(row))?.label : '';
  const sub = [row.type === 'Recurring' ? `${(row.recurringEntries || []).length} charges` : '', linked].filter(Boolean).join(' · ');
  const expanded = Boolean(state.expandedCostRows?.[row.id]);
  const total = getCostTotal(row);
  return `<div class="cost-summary-card ${expanded ? 'expanded' : ''}" data-cost-row data-cost-id="${safeText(row.id)}">
    <div class="cost-summary-main cost-summary-line" data-toggle-cost-row="${safeText(row.id)}" role="button" tabindex="0" title="Show or hide cost details">
      <span class="cost-summary-name"><strong>${safeText(row.name || 'Unnamed cost')}</strong>${sub ? `<small>${safeText(sub)}</small>` : ''}</span>
      <strong class="cost-summary-total">${currency(total)}</strong>
      <div class="cost-summary-actions">
        ${row.type === 'Recurring' ? `<button type="button" class="icon-btn cost-icon-btn" data-edit-recurring-cost="${safeText(row.id)}" title="Dates">📅</button>` : ''}
        <button type="button" class="icon-btn cost-icon-btn" data-copy-cost-row="${safeText(row.id)}" title="Copy">⧉</button>
        <button type="button" class="icon-btn cost-icon-btn danger" data-delete-cost-row="${safeText(row.id)}" title="Delete">×</button>
      </div>
    </div>
    ${expanded ? `<div class="cost-summary-details">
      <div><span>Category</span><strong>${safeText(row.category || 'Inventory')}</strong></div>
      <div><span>Type</span><strong>${safeText(row.type || 'One-Time')}</strong></div>
      <div><span>Quantity</span><strong>${row.type === 'Recurring' ? '—' : safeText(row.quantity === '' ? '0' : row.quantity)}</strong></div>
      <div><span>Cost each</span><strong>${row.type === 'Recurring' ? '—' : currency(Number(row.price || 0))}</strong></div>
      ${linked ? `<div class="cost-detail-wide"><span>Tied to</span><strong>${safeText(linked)}</strong></div>` : ''}
      ${(row.costAccessoryLinks || []).length ? `<div class="cost-detail-wide"><span>Accessories</span><strong>${safeText((row.costAccessoryLinks || []).map(getCostAccessoryLinkLabel).join(', '))}</strong></div>` : ''}
      <button type="button" class="btn btn-secondary btn-small cost-detail-edit" data-edit-cost-row="${safeText(row.id)}">Edit</button>
    </div>` : ''}
  </div>`;
}
function renderCostEditorCard(row = {}, costCategories = []) {
  return renderCostSummaryCard(row);
}
function addCostRow(copyFrom = null) {
  openCostModal(null, copyFrom?.category || 'Inventory', copyFrom || null);
}
function handleCostsListChange(event) {}
function handleCostsListClick(event) {
  const addBtn = event.target.closest('[data-add-cost-category]');
  if (addBtn) {
    openCostModal(null, addBtn.dataset.addCostCategory || 'Inventory');
    return;
  }
  const toggle = event.target.closest('[data-toggle-cost-category]');
  if (toggle) {
    const key = toggle.dataset.toggleCostCategory || 'Inventory';
    state.collapsedCostCategories[key] = !state.collapsedCostCategories[key];
    renderCosts();
    return;
  }
  const recurringBtn = event.target.closest('[data-edit-recurring-cost]');
  if (recurringBtn) {
    event.stopPropagation();
    openRecurringCostEditor(recurringBtn.dataset.editRecurringCost);
    return;
  }
  const copyBtn = event.target.closest('[data-copy-cost-row]');
  if (copyBtn) {
    event.stopPropagation();
    const existing = (state.costs || []).find((row) => row.id === copyBtn.dataset.copyCostRow) || {};
    const copy = normalizeCostRecord({ ...existing, id: uid('cost'), name: `${existing.name || 'Cost'} copy`, recurringEntries: [] });
    state.costs = [copy, ...(state.costs || [])];
    state.expandedCostRows[copy.id] = true;
    renderCosts();
    openCostModal(copy.id);
    return;
  }
  const deleteBtn = event.target.closest('[data-delete-cost-row]');
  if (deleteBtn) {
    event.stopPropagation();
    state.costs = (state.costs || []).filter((row) => row.id !== deleteBtn.dataset.deleteCostRow);
    delete state.expandedCostRows[deleteBtn.dataset.deleteCostRow];
    renderCosts();
    return;
  }
  const editBtn = event.target.closest('[data-edit-cost-row]');
  if (editBtn) {
    event.stopPropagation();
    openCostModal(editBtn.dataset.editCostRow);
    return;
  }
  const rowToggle = event.target.closest('[data-toggle-cost-row]');
  if (rowToggle) {
    const id = rowToggle.dataset.toggleCostRow;
    state.expandedCostRows[id] = !state.expandedCostRows[id];
    renderCosts();
  }
}
function openCostModal(costId = null, category = 'Inventory', starter = null) {
  const existing = costId ? (state.costs || []).find((row) => row.id === costId) : null;
  const row = normalizeCostRecord(existing || starter || { id: uid('cost'), category, type: 'One-Time', name: '', quantity: 1, price: '', costAccessoryLinks: [] });
  let modal = document.getElementById('costModalWrap');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'costModalWrap';
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }
  const costCategories = getCostCategories();
  const inventoryOptions = getInventoryCostOptions();
  const selectedLink = findCostOptionValue(row);
  const isRecurring = row.type === 'Recurring';
  const accessoryLinks = getCostAccessoryLinks(row);
  modal.innerHTML = `<div class="modal cost-modal"><div class="modal-header"><h3>${existing ? 'Edit Cost' : 'Add Cost'}</h3><button type="button" class="icon-btn" data-close-cost-modal>×</button></div>
    <div class="cost-modal-grid">
      <label><span>Category</span><select id="costModalCategory">${costCategories.map((cat) => `<option value="${safeText(cat)}" ${row.category === cat ? 'selected' : ''}>${safeText(cat)}</option>`).join('')}</select></label>
      <label><span>Tied to inventory/accessory</span><select id="costModalLinked"><option value="">Not tied to inventory</option>${inventoryOptions.map((opt) => `<option value="${safeText(opt.value)}" ${selectedLink === opt.value ? 'selected' : ''}>${safeText(opt.label)}</option>`).join('')}</select></label>
      <label class="cost-modal-wide"><span>Cost name</span><input id="costModalName" value="${safeText(row.name || '')}" placeholder="White folding chairs, chair bags, gas, storage..." /></label>
      <label><span>Type</span><select id="costModalType"><option value="One-Time" ${!isRecurring ? 'selected' : ''}>One-Time</option><option value="Recurring" ${isRecurring ? 'selected' : ''}>Recurring</option></select></label>
      <label><span>Quantity</span><input id="costModalQuantity" type="number" min="0" step="1" value="${row.quantity === '' ? '' : safeText(row.quantity)}" ${isRecurring ? 'disabled' : ''}/></label>
      <label><span>${isRecurring ? 'Use Dates for recurring' : 'Cost each'}</span><input id="costModalPrice" type="number" min="0" step="0.01" value="${row.price === '' ? '' : safeText(row.price)}" ${isRecurring ? 'disabled' : ''}/></label>
      <div class="cost-modal-total"><span>Total spent</span><strong>${currency(getCostTotal(row))}</strong>${isRecurring ? `<small>Use Dates after saving to add recurring charges.</small>` : ''}</div>
      <div class="cost-modal-accessories cost-modal-wide">
        <div class="cost-accessory-head"><div><strong>Accessories included in this cost</strong><div class="small muted">Choose accessories already saved under inventory items. Add as many rows as needed.</div></div><button type="button" class="btn btn-secondary btn-small" data-add-cost-accessory>+ Add accessory</button></div>
        <div id="costAccessoryRows" class="cost-accessory-rows">${accessoryLinks.length ? accessoryLinks.map(renderCostAccessoryModalRow).join('') : '<div class="empty-state compact" data-no-cost-accessories>No accessories added to this cost yet.</div>'}</div>
      </div>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close-cost-modal>Cancel</button><button type="button" class="btn btn-primary" data-save-cost-modal>${existing ? 'Save Cost' : 'Add Cost'}</button></div></div>`;
  modal.classList.add('open');
  const recalc = () => {
    const type = modal.querySelector('#costModalType')?.value || 'One-Time';
    const recurring = type === 'Recurring';
    const qtyInput = modal.querySelector('#costModalQuantity');
    const priceInput = modal.querySelector('#costModalPrice');
    if (qtyInput) qtyInput.disabled = recurring;
    if (priceInput) priceInput.disabled = recurring;
    const temp = normalizeCostRecord({
      ...row,
      type,
      quantity: qtyInput?.value === '' ? '' : Number(qtyInput?.value || 0),
      price: priceInput?.value === '' ? '' : Number(priceInput?.value || 0),
      costAccessoryLinks: collectCostAccessoryLinksFromModal(modal)
    });
    const total = modal.querySelector('.cost-modal-total strong');
    if (total) total.textContent = currency(getCostTotal(temp));
  };
  const bindAccessoryRows = () => {
    modal.querySelectorAll('[data-cost-accessory-inventory]').forEach((select) => {
      select.onchange = () => { refreshCostAccessorySelect(select.closest('[data-cost-accessory-row]')); recalc(); };
    });
    modal.querySelectorAll('[data-cost-accessory-select], [data-cost-accessory-qty], [data-cost-accessory-each]').forEach((input) => {
      input.oninput = recalc;
      input.onchange = recalc;
    });
    modal.querySelectorAll('[data-remove-cost-accessory]').forEach((btn) => {
      btn.onclick = () => {
        btn.closest('[data-cost-accessory-row]')?.remove();
        const box = modal.querySelector('#costAccessoryRows');
        if (box && !box.querySelector('[data-cost-accessory-row]')) box.innerHTML = '<div class="empty-state compact" data-no-cost-accessories>No accessories added to this cost yet.</div>';
        recalc();
      };
    });
  };
  modal.querySelectorAll('[data-close-cost-modal]').forEach((btn) => btn.onclick = () => modal.classList.remove('open'));
  modal.querySelector('#costModalLinked')?.addEventListener('change', (event) => {
    const opt = inventoryOptions.find((item) => item.value === event.target.value);
    const nameInput = modal.querySelector('#costModalName');
    if (opt && nameInput && !nameInput.value.trim()) nameInput.value = opt.label;
  });
  modal.querySelector('[data-add-cost-accessory]')?.addEventListener('click', () => {
    const box = modal.querySelector('#costAccessoryRows');
    if (!box) return;
    box.querySelector('[data-no-cost-accessories]')?.remove();
    box.insertAdjacentHTML('beforeend', renderCostAccessoryModalRow({ quantity: 1, costEach: '' }));
    bindAccessoryRows();
    recalc();
  });
  ['#costModalType', '#costModalQuantity', '#costModalPrice'].forEach((sel) => modal.querySelector(sel)?.addEventListener('input', recalc));
  bindAccessoryRows();
  modal.querySelector('[data-save-cost-modal]').onclick = () => {
    const linkedValue = modal.querySelector('#costModalLinked')?.value || '';
    const linked = inventoryOptions.find((opt) => opt.value === linkedValue);
    const quantityValue = modal.querySelector('#costModalQuantity')?.value ?? '';
    const priceValue = modal.querySelector('#costModalPrice')?.value ?? '';
    const saved = normalizeCostRecord({
      ...row,
      category: modal.querySelector('#costModalCategory')?.value || 'Inventory',
      type: modal.querySelector('#costModalType')?.value || 'One-Time',
      inventoryId: linked?.inventoryId || '',
      accessoryId: linked?.accessoryId || '',
      name: modal.querySelector('#costModalName')?.value || linked?.label || '',
      quantity: quantityValue === '' ? '' : Number(quantityValue || 0),
      price: priceValue === '' ? '' : Number(priceValue || 0),
      costAccessoryLinks: collectCostAccessoryLinksFromModal(modal),
      updatedAt: new Date().toISOString()
    });
    const exists = (state.costs || []).some((item) => item.id === saved.id);
    state.costs = exists ? (state.costs || []).map((item) => item.id === saved.id ? saved : item) : [saved, ...(state.costs || [])];
    modal.classList.remove('open');
    renderCosts();
    if (saved.type === 'Recurring' && !(saved.recurringEntries || []).length) openRecurringCostEditor(saved.id);
  };
  recalc();
}

function openRecurringCostEditor(costId) {
  const cost = (state.costs || []).find((row) => row.id === costId);
  if (!cost) return;
  state.recurringEditorCostId = costId;
  let modal = document.getElementById('recurringCostModalWrap');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'recurringCostModalWrap';
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }
  const entries = Array.isArray(cost.recurringEntries) ? cost.recurringEntries : [];
  modal.innerHTML = `<div class="modal recurring-cost-modal"><div class="modal-header"><h3>Recurring Cost Dates</h3><button type="button" class="icon-btn" data-close-recurring-cost>×</button></div>
    <div class="recurring-cost-grid">
      <div><div class="small muted" style="margin-bottom:8px;">Charge dates</div><div id="recurringCostEntries">${entries.map((entry, index) => renderRecurringEntryRow(entry, index)).join('')}</div><button type="button" class="btn btn-secondary btn-small" data-add-recurring-entry>Add Date</button></div>
      <div class="card" style="padding:12px;"><label class="small muted">Pick a date</label><input type="date" id="recurringCalendarPick" style="width:100%; margin-top:6px;"/><label class="small muted" style="display:block; margin-top:10px;">Amount</label><input type="number" step="0.01" min="0" id="recurringCalendarAmount" placeholder="0.00" style="width:100%; margin-top:6px;"/><button type="button" class="btn btn-primary btn-small" data-add-calendar-recurring style="margin-top:10px;">Add selected date</button></div>
    </div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-close-recurring-cost>Cancel</button><button type="button" class="btn btn-primary" data-save-recurring-cost>Save Dates</button></div></div>`;
  modal.classList.add('open');
  bindRecurringCostEditor(modal);
}
function renderRecurringEntryRow(entry = {}, index = 0) {
  return `<div class="recurring-entry-row" data-recurring-entry><input type="date" data-recurring-date value="${safeText(entry.date || '')}"/><input type="number" step="0.01" min="0" data-recurring-amount value="${entry.amount === '' ? '' : safeText(entry.amount || '')}" placeholder="0.00"/><button type="button" class="btn btn-ghost btn-small" data-remove-recurring-entry>Delete</button></div>`;
}
function bindRecurringCostEditor(modal) {
  modal.querySelectorAll('[data-close-recurring-cost]').forEach((btn) => btn.onclick = () => modal.classList.remove('open'));
  modal.querySelector('[data-add-recurring-entry]').onclick = () => {
    modal.querySelector('#recurringCostEntries').insertAdjacentHTML('beforeend', renderRecurringEntryRow());
    bindRecurringCostEditor(modal);
  };
  modal.querySelector('[data-add-calendar-recurring]').onclick = () => {
    const date = modal.querySelector('#recurringCalendarPick')?.value || '';
    const amount = modal.querySelector('#recurringCalendarAmount')?.value || '';
    if (!date) return;
    modal.querySelector('#recurringCostEntries').insertAdjacentHTML('beforeend', renderRecurringEntryRow({ date, amount }));
    bindRecurringCostEditor(modal);
  };
  modal.querySelectorAll('[data-remove-recurring-entry]').forEach((btn) => btn.onclick = () => btn.closest('[data-recurring-entry]')?.remove());
  modal.querySelector('[data-save-recurring-cost]').onclick = () => {
    const entries = [...modal.querySelectorAll('[data-recurring-entry]')].map((row) => ({ date: row.querySelector('[data-recurring-date]')?.value || '', amount: row.querySelector('[data-recurring-amount]')?.value === '' ? '' : Number(row.querySelector('[data-recurring-amount]')?.value || 0) })).filter((entry) => entry.date || entry.amount !== '');
    state.costs = (state.costs || []).map((row) => row.id === state.recurringEditorCostId ? normalizeCostRecord({ ...row, type: 'Recurring', recurringEntries: entries }) : row);
    modal.classList.remove('open');
    renderCosts();
  };
}
async function handleSaveCosts() {
  await withBusy(async () => {
    state.costs = await saveCostRecords(collectCostsFromTable());
    renderCosts();
    setNumbersSaved('Costs saved.');
  }, 'Saving costs…');
}
function setNumbersSaved(message) {
  if (!els.numbersSaved) return;
  els.numbersSaved.textContent = message || '';
  if (message) setTimeout(() => { if (els.numbersSaved) els.numbersSaved.textContent = ''; }, 2200);
}
function getOrderReportDate(order = {}) {
  return order.completedAt ? String(order.completedAt).slice(0, 10) : (order.returnDate || order.eventDate || order.exchangeDate || order.date || '');
}
function getPeriodKey(dateStr = '', view = state.earningsView) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'No date';
  const y = d.getFullYear();
  if (view === 'weekly') {
    const start = new Date(d); start.setDate(d.getDate() - d.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  if (view === 'quarterly') return `${y} · Q${Math.floor(d.getMonth() / 3) + 1}`;
  if (view === 'yearly') return `${y}`;
  return `${d.toLocaleString('en-US', { month: 'long' })} ${y}`;
}

function normalizeInlineTimeValue(value = '') {
  const raw = String(value || '').trim();
  if (!raw || /^(tbd|tbd\s*|to be determined|time tbd)$/i.test(raw)) return '';
  const exact = raw.match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/);
  if (exact) {
    const h = Number(exact[1]);
    const m = Number(exact[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return '';
  }
  const loose = raw.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?$/i);
  if (!loose) return '';
  let hour = Number(loose[1]);
  const minute = Number(loose[2] || 0);
  const ampm = (loose[3] || '').toUpperCase();
  if (minute < 0 || minute > 59) return '';
  if (ampm) {
    if (hour < 1 || hour > 12) return '';
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return '';
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
function sumOrderAdjustment(order = {}) {
  const chargedItems = getChargedItemsSubtotal(order);
  const expectedTotal = chargedItems + Number(order.deliveryFee || 0) + Number(order.setupFee || 0) + Number(order.tipAmount || 0);
  const effectiveTotal = getEffectiveOrderTotal(order);
  return roundMoney(effectiveTotal - expectedTotal);
}

function buildEarningsReport() {
  const completed = (state.orders || []).filter((order) => getOrderColumn(order.status) === 'completed' && isRevenueOrder(order));
  const periodMap = new Map();
  const itemMap = new Map();
  const totals = { orders: completed.length, gross: 0, itemRentals: 0, deliveryFees: 0, setupFees: 0, tips: 0, adjustments: 0 };
  completed.forEach((order) => {
    const period = getPeriodKey(getOrderReportDate(order));
    if (!periodMap.has(period)) periodMap.set(period, { period, sortDate: getPeriodSortDate(getOrderReportDate(order)), orders: 0, gross: 0, itemRentals: 0, deliveryFees: 0, setupFees: 0, tips: 0, adjustments: 0, items: new Map(), orderLines: [] });
    const bucket = periodMap.get(period);
    const itemTotal = getChargedItemsSubtotal(order);
    const delivery = Number(order.deliveryFee || 0);
    const setup = Number(order.setupFee || 0);
    const tips = Number(order.tipAmount || 0);
    const adjustment = sumOrderAdjustment(order);
    const gross = getEffectiveOrderTotal(order);
    bucket.orderLines.push({ customer: order.customerName || order.name || 'Customer', date: getOrderReportDate(order), gross, items: itemTotal, delivery, setup, tips, adjustment });
    bucket.orders += 1; bucket.gross += gross; bucket.itemRentals += itemTotal; bucket.deliveryFees += delivery; bucket.setupFees += setup; bucket.tips += tips; bucket.adjustments += adjustment;
    totals.gross += gross; totals.itemRentals += itemTotal; totals.deliveryFees += delivery; totals.setupFees += setup; totals.tips += tips; totals.adjustments += adjustment;
    (order.items || []).forEach((item) => {
      const key = `${item.category || 'Uncategorized'}::${item.name || 'Item'}`;
      const amount = Number(item.subtotal || 0);
      const qty = Number(item.quantity || 0);
      if (!itemMap.has(key)) itemMap.set(key, { category: item.category || 'Uncategorized', name: item.name || 'Item', quantity: 0, amount: 0 });
      if (!bucket.items.has(key)) bucket.items.set(key, { category: item.category || 'Uncategorized', name: item.name || 'Item', quantity: 0, amount: 0 });
      itemMap.get(key).quantity += qty; itemMap.get(key).amount += amount;
      bucket.items.get(key).quantity += qty; bucket.items.get(key).amount += amount;
    });
  });
  return { completed, totals, periods: [...periodMap.values()], items: [...itemMap.values()].sort((a, b) => b.amount - a.amount) };
}
function getPeriodSortDate(dateStr = '') {
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
function renderEarnings() {
  if (!els.earningsSummary || !els.earningsBreakdown) return;
  if (els.earningsViewSelect) els.earningsViewSelect.value = state.earningsView;
  const report = buildEarningsReport();
  const t = report.totals;
  els.earningsSummary.innerHTML = `
    <div class="numbers-metric"><div class="metric-label">Completed orders</div><div class="metric-value">${t.orders}</div></div>
    <div class="numbers-metric"><div class="metric-label">Total earnings</div><div class="metric-value">${currency(t.gross)}</div></div>
    <div class="numbers-metric"><div class="metric-label">Item rentals</div><div class="metric-value">${currency(t.itemRentals)}</div></div>
    <div class="numbers-metric"><div class="metric-label">Delivery fees</div><div class="metric-value">${currency(t.deliveryFees)}</div></div>
    <div class="numbers-metric"><div class="metric-label">Setup fees</div><div class="metric-value">${currency(t.setupFees)}</div></div>
    <div class="numbers-metric"><div class="metric-label">Tips</div><div class="metric-value">${currency(t.tips)}</div></div>
    <div class="numbers-metric"><div class="metric-label">Adjustments</div><div class="metric-value">${currency(t.adjustments)}</div></div>
  `;
  if (!report.completed.length) {
    els.earningsBreakdown.innerHTML = '<div class="empty-state">No completed orders yet.</div>';
    return;
  }
  const showOverview = state.earningsView === 'yearly';
  els.earningsSummary.classList.toggle('hidden', !showOverview);
  const periodsHtml = report.periods.sort((a, b) => a.sortDate - b.sortDate).map((period) => {
    const open = state.expandedEarningsPeriod === period.period;
    const details = open ? `<div class="numbers-summary-grid compact"><div class="numbers-metric"><div class="metric-label">Items</div><div class="metric-value">${currency(period.itemRentals)}</div></div><div class="numbers-metric"><div class="metric-label">Delivery</div><div class="metric-value">${currency(period.deliveryFees)}</div></div><div class="numbers-metric"><div class="metric-label">Setup</div><div class="metric-value">${currency(period.setupFees)}</div></div><div class="numbers-metric"><div class="metric-label">Tips</div><div class="metric-value">${currency(period.tips)}</div></div><div class="numbers-metric"><div class="metric-label">Adjustments</div><div class="metric-value">${currency(period.adjustments)}</div></div></div>${period.orderLines?.length ? `<table class="numbers-subtable"><thead><tr><th>Order</th><th>Date</th><th>Total</th></tr></thead><tbody>${period.orderLines.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((line) => `<tr><td>${safeText(line.customer)}</td><td>${safeText(formatShortDate(line.date))}</td><td>${currency(line.gross)}</td></tr>`).join('')}</tbody></table>` : ''}${period.items.size ? `<table class="numbers-subtable"><thead><tr><th>Item</th><th>Qty</th><th>Earnings</th></tr></thead><tbody>${[...period.items.values()].sort((a, b) => b.amount - a.amount).map((item) => `<tr><td>${safeText(item.name)}</td><td>${Number(item.quantity || 0).toLocaleString()}</td><td>${currency(item.amount)}</td></tr>`).join('')}</tbody></table>` : ''}` : '';
    return `<button type="button" class="numbers-period-card ${open ? 'open' : ''}" data-toggle-earnings-period="${safeText(period.period)}"><span><strong>${safeText(period.period)}</strong><span class="small muted">${period.orders} order${period.orders === 1 ? '' : 's'} · Items ${currency(period.itemRentals)}</span></span><span class="badge badge-green">${currency(period.gross)}</span></button>${open ? `<div class="numbers-source-card earnings-period-details">${details}</div>` : ''}`;
  }).join('');
  els.earningsBreakdown.innerHTML = periodsHtml;
}
function formatSourceName(source = '') {
  const value = String(source || 'admin').trim();
  const names = { admin: 'Admin-created orders', quick: 'Quick picker', quickPicker: 'Quick picker', gallery: 'Gallery', tracking: 'Tracking page', public: 'Public form' };
  return names[value] || value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeAverageRef(ref = {}) {
  return {
    id: ref.id || uid('avgref'),
    inventoryId: ref.inventoryId || '',
    seconds: Number(ref.seconds || 0),
    perQty: Math.max(1, Number(ref.perQty || 1))
  };
}
function normalizeAverageTask(task = {}) {
  const legacyRef = (task.inventoryId || task.seconds || task.perQty) ? [{ inventoryId: task.inventoryId || '', seconds: task.seconds || 0, perQty: task.perQty || 1 }] : [];
  const refs = Array.isArray(task.refs) && task.refs.length ? task.refs : legacyRef;
  return {
    id: task.id || uid('avg'),
    name: String(task.name || '').trim() || 'New task',
    refs: (refs.length ? refs : [{ inventoryId: state.inventory[0]?.id || '', seconds: 60, perQty: 1 }]).map(normalizeAverageRef)
  };
}
function getCompletedOrders() { return (state.orders || []).filter((order) => getOrderColumn(order.status) === 'completed'); }
function getCompletedItemQuantityForInventory(inventoryId = '') {
  return getCompletedOrders().reduce((sum, order) => sum + (order.items || []).reduce((itemSum, item) => (!inventoryId || item.inventoryId === inventoryId) ? itemSum + Number(item.quantity || 0) : itemSum, 0), 0);
}
function getCompletedItemRevenueForInventory(inventoryId = '') {
  return getCompletedOrders()
    .filter(isRevenueOrder)
    .reduce((sum, order) => sum + (order.items || []).reduce((itemSum, item) => (!inventoryId || item.inventoryId === inventoryId) ? itemSum + Number(item.subtotal || 0) : itemSum, 0), 0);
}
function formatDuration(seconds = 0) {
  const total = Math.round(Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
function getAverageGroupKeyForRef(ref = {}) {
  const normalized = normalizeAverageRef(ref);
  return normalized.inventoryId ? `inventory:${normalized.inventoryId}` : 'orders:all';
}
function getAverageGroupLabel(key = '') {
  if (key === 'orders:all') return 'Whole completed order';
  const inventoryId = String(key).replace(/^inventory:/, '');
  return (state.inventory || []).find((item) => item.id === inventoryId)?.name || 'Inventory item';
}
function calculateAverageRefStats(ref = {}) {
  const normalized = normalizeAverageRef(ref);
  const qty = normalized.inventoryId ? getCompletedItemQuantityForInventory(normalized.inventoryId) : getCompletedOrders().length;
  const runs = Math.ceil(qty / Math.max(1, normalized.perQty));
  const seconds = runs * normalized.seconds;
  const revenue = normalized.inventoryId ? getCompletedItemRevenueForInventory(normalized.inventoryId) : buildEarningsReport().totals.gross;
  return { qty, runs, seconds, revenue };
}
function calculateAverageTaskStats(task = {}) {
  const normalized = normalizeAverageTask(task);
  return normalized.refs.reduce((acc, ref) => {
    const stats = calculateAverageRefStats(ref);
    acc.seconds += stats.seconds;
    acc.refs.push({ ref, stats });
    return acc;
  }, { seconds: 0, refs: [] });
}
function calculateAverageGroups(tasks = []) {
  const groups = new Map();
  tasks.map(normalizeAverageTask).forEach((task) => {
    task.refs.forEach((ref) => {
      const key = getAverageGroupKeyForRef(ref);
      const stats = calculateAverageRefStats(ref);
      if (!groups.has(key)) groups.set(key, { key, label: getAverageGroupLabel(key), qty: stats.qty, revenue: stats.revenue, seconds: 0, lineCount: 0, taskNames: new Set() });
      const group = groups.get(key);
      group.seconds += stats.seconds;
      group.lineCount += 1;
      group.taskNames.add(task.name);
    });
  });
  return [...groups.values()].map((group) => ({ ...group, taskCount: group.taskNames.size, hourly: group.seconds > 0 ? group.revenue / (group.seconds / 3600) : 0 }));
}
function renderAverages() {
  if (!els.averagesList || !els.averagesSummary) return;
  const tasks = (state.averages || []).map(normalizeAverageTask);
  const groups = calculateAverageGroups(tasks);
  const totals = groups.reduce((acc, group) => { acc.seconds += group.seconds; acc.revenue += group.revenue; return acc; }, { seconds: 0, revenue: 0 });
  const hours = totals.seconds / 3600;
  els.averagesSummary.innerHTML = `<div class="numbers-metric"><div class="metric-label">Estimated labor</div><div class="metric-value">${formatDuration(totals.seconds)}</div></div><div class="numbers-metric"><div class="metric-label">Tracked revenue</div><div class="metric-value">${currency(totals.revenue)}</div><div class="small muted">Sales are counted once per inventory item, even when several tasks use it.</div></div><div class="numbers-metric"><div class="metric-label">Estimated hourly</div><div class="metric-value">${hours > 0 ? currency(totals.revenue / hours) : '$0.00'}/hr</div></div>`;
  const groupCards = groups.length ? `<div class="average-groups-summary">${groups.map((group) => `<div class="average-group-pill"><strong>${safeText(group.label)}</strong><span>${Number(group.qty).toLocaleString()} units/orders · ${formatDuration(group.seconds)} · ${currency(group.revenue)} sales · ${currency(group.hourly)}/hr</span></div>`).join('')}</div>` : '';
  const invOptions = (selected = '') => `<option value=""${!selected ? ' selected' : ''}>Whole completed order</option>${(state.inventory || []).map((item) => `<option value="${safeText(item.id)}"${item.id === selected ? ' selected' : ''}>${safeText(item.name)}</option>`).join('')}`;
  els.averagesList.innerHTML = groupCards + (tasks.length ? tasks.map((task) => {
    const taskStats = calculateAverageTaskStats(task);
    const refRows = task.refs.map((ref) => {
      const stats = calculateAverageRefStats(ref);
      const group = groups.find((item) => item.key === getAverageGroupKeyForRef(ref));
      return `<div class="average-ref-row" data-average-ref="${safeText(ref.id)}"><label class="form-row"><span>Inventory reference</span><select data-average-ref-field="inventoryId">${invOptions(ref.inventoryId)}</select></label><label class="form-row"><span>Seconds</span><input type="number" min="0" step="1" data-average-ref-field="seconds" value="${safeText(ref.seconds)}" /></label><label class="form-row"><span>Per quantity</span><input type="number" min="1" step="1" data-average-ref-field="perQty" value="${safeText(ref.perQty)}" /></label><button type="button" class="btn btn-ghost btn-small" data-delete-average-ref="${safeText(ref.id)}">Remove line</button><div class="small muted average-ref-note">${Number(stats.qty).toLocaleString()} units/orders × ${ref.seconds}s per ${ref.perQty} = ${formatDuration(stats.seconds)} · ${currency(group?.hourly || 0)}/hr for ${safeText(group?.label || 'this group')}</div></div>`;
    }).join('');
    return `<div class="numbers-source-card average-task-card" data-average-task="${safeText(task.id)}"><label class="form-row"><span>Task group</span><input data-average-field="name" value="${safeText(task.name)}" /></label><div class="average-ref-list">${refRows}</div><div class="section-header" style="margin-top:8px;"><div class="small muted">Total task-group time: ${formatDuration(taskStats.seconds)}</div><div class="button-row"><button type="button" class="btn btn-secondary btn-small" data-add-average-ref="${safeText(task.id)}">Add equipment line</button><button type="button" class="btn btn-ghost btn-small" data-delete-average-task="${safeText(task.id)}">Delete group</button></div></div></div>`;
  }).join('') : '<div class="empty-state">No average tasks yet. Add cleaning, loading, unloading, delivery prep, or any repeatable task.</div>');
}
function collectAverageTasksFromForm() {
  return [...(els.averagesList?.querySelectorAll('[data-average-task]') || [])].map((row) => normalizeAverageTask({
    id: row.dataset.averageTask,
    name: row.querySelector('[data-average-field="name"]')?.value || '',
    refs: [...row.querySelectorAll('[data-average-ref]')].map((refRow) => ({
      id: refRow.dataset.averageRef,
      inventoryId: refRow.querySelector('[data-average-ref-field="inventoryId"]')?.value || '',
      seconds: refRow.querySelector('[data-average-ref-field="seconds"]')?.value || 0,
      perQty: refRow.querySelector('[data-average-ref-field="perQty"]')?.value || 1
    }))
  }));
}
function addAverageTask() {
  state.averages = [normalizeAverageTask({ name: 'New task group', refs: [{ seconds: 60, perQty: 1, inventoryId: state.inventory[0]?.id || '' }] }), ...(state.averages || [])];
  renderAverages();
}
function handleAveragesListChange() { state.averages = collectAverageTasksFromForm(); renderAverages(); }
function handleAveragesListClick(event) {
  const deleteTaskBtn = event.target.closest('[data-delete-average-task]');
  if (deleteTaskBtn) {
    state.averages = collectAverageTasksFromForm().filter((task) => task.id !== deleteTaskBtn.dataset.deleteAverageTask);
    renderAverages();
    return;
  }
  const addRefBtn = event.target.closest('[data-add-average-ref]');
  if (addRefBtn) {
    state.averages = collectAverageTasksFromForm().map((task) => task.id === addRefBtn.dataset.addAverageRef ? { ...task, refs: [...task.refs, normalizeAverageRef({ inventoryId: state.inventory[0]?.id || '', seconds: 60, perQty: 1 })] } : task);
    renderAverages();
    return;
  }
  const deleteRefBtn = event.target.closest('[data-delete-average-ref]');
  if (deleteRefBtn) {
    state.averages = collectAverageTasksFromForm().map((task) => ({ ...task, refs: task.refs.filter((ref) => ref.id !== deleteRefBtn.dataset.deleteAverageRef) })).filter((task) => task.refs.length);
    renderAverages();
  }
}
async function handleSaveAverages() {
  state.averages = collectAverageTasksFromForm();
  state.settings = { ...state.settings, averageTasks: state.averages };
  await withBusy(async () => { await saveSettings(state.settings); setNumbersSaved('Averages saved.'); }, 'Saving averages…');
}

function renderNumbers() {
  renderNumbersTabs();
  renderCosts();
  renderEarnings();
  renderAverages();
}

function calculateOrderItemsSubtotal(items = []) {
  return (items || []).reduce((sum, item) => sum + Number(item?.subtotal || 0), 0);
}
function getListedItemsSubtotal(order = {}) {
  return (order.items || []).reduce((sum, item) => {
    const quantity = Number(item.quantity || 0);
    const baseUnitPrice = Number(item.unitPrice || 0);
    const accessoryBase = (item.accessories || []).reduce((accSum, accessory) => accSum + (Number(accessory.price || 0) * quantity), 0);
    return sum + (quantity * baseUnitPrice) + accessoryBase;
  }, 0);
}
function getChargedItemsSubtotal(order = {}) {
  return (order.items || []).reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
}
function getBaseOrderTotal(order = {}) {
  if (Number.isFinite(Number(order.baseTotal))) return Number(order.baseTotal || 0);
  return getChargedItemsSubtotal(order) + Number(order.deliveryFee || 0);
}
function getListedOrderTotal(order = {}) {
  if (Number.isFinite(Number(order.listedTotal))) return Number(order.listedTotal || 0);
  return getListedItemsSubtotal(order) + Number(order.deliveryFee || 0);
}
function getEffectiveOrderTotal(order = {}) {
  if (order.adjustedTotal !== '' && order.adjustedTotal != null && !Number.isNaN(Number(order.adjustedTotal))) {
    return Number(order.adjustedTotal);
  }
  if (!Number.isNaN(Number(order.total))) return Number(order.total || 0);
  return getBaseOrderTotal(order);
}
function getDepositMinimumOrder() {
  const value = Number(state.settings?.depositMinimumOrder);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DEPOSIT_THRESHOLD;
}
function getLockedDepositPaidAmount(order = {}) {
  const total = getEffectiveOrderTotal(order);
  const candidates = [order.depositPaidAmount, order.amountPaid, order.depositAmount];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return Math.min(value, total);
  }
  return Math.min(getOrderDepositAmount(order), total);
}
function getOrderAmountPaid(order = {}) {
  const status = String(order.paymentStatus || '');
  const total = getEffectiveOrderTotal(order);
  if (status === 'Paid' || status === 'Free') return total;
  if (status === 'Deposit Paid' || status === 'Deposit') return getLockedDepositPaidAmount(order);
  return 0;
}
function getOrderAmountRemaining(order = {}) {
  return Math.max(0, getEffectiveOrderTotal(order) - getOrderAmountPaid(order));
}
function syncOrderPaymentAmounts(order = {}) {
  const status = String(order.paymentStatus || '');
  if (status === 'Deposit Paid' || status === 'Deposit') {
    const lockedPaid = roundMoney(getLockedDepositPaidAmount(order));
    order.depositPaidAmount = lockedPaid;
    order.amountPaid = lockedPaid;
    order.amountRemaining = roundMoney(Math.max(0, getEffectiveOrderTotal(order) - lockedPaid));
    return order;
  }
  if (status === 'Paid' || status === 'Free') {
    order.amountPaid = roundMoney(getEffectiveOrderTotal(order));
    order.amountRemaining = 0;
    return order;
  }
  order.amountPaid = 0;
  order.amountRemaining = roundMoney(getEffectiveOrderTotal(order));
  return order;
}
function syncOrderDepositRule(order = {}) {
  const total = getEffectiveOrderTotal(order);
  const requiresDeposit = total > getDepositMinimumOrder();
  order.requiresDeposit = requiresDeposit;
  order.depositAmount = requiresDeposit ? roundDepositAmount(total * DEPOSIT_RATE) : 0;
  return syncOrderPaymentAmounts(order);
}
function syncAllOrdersToDepositRule({ touchUpdatedAt = true } = {}) {
  let changed = false;
  state.orders.forEach((order) => {
    const before = JSON.stringify({
      requiresDeposit: order.requiresDeposit,
      depositAmount: order.depositAmount,
      depositPaidAmount: order.depositPaidAmount,
      amountPaid: order.amountPaid,
      amountRemaining: order.amountRemaining
    });
    syncOrderDepositRule(order);
    const after = JSON.stringify({
      requiresDeposit: order.requiresDeposit,
      depositAmount: order.depositAmount,
      depositPaidAmount: order.depositPaidAmount,
      amountPaid: order.amountPaid,
      amountRemaining: order.amountRemaining
    });
    if (before !== after) {
      if (touchUpdatedAt) order.updatedAt = new Date().toISOString();
      changed = true;
    }
  });
  return changed;
}
function getOrderDiscountAmount(order = {}) {
  const diff = getListedOrderTotal(order) - getEffectiveOrderTotal(order);
  return diff > 0.004 ? diff : 0;
}
function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
function roundDepositAmount(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}
function generateTrackingCode(existingCodes = new Set()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 8 }, (_, index) => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    code = `${code.slice(0, 4)}-${code.slice(4)}`;
  } while (existingCodes.has(code));
  existingCodes.add(code);
  return code;
}
function generateTrackingAccessCode(existingCodes = new Set()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (existingCodes.has(code));
  existingCodes.add(code);
  return code;
}
function ensureOrdersHaveTrackingCodes(orders = []) {
  const existingCodes = new Set((orders || []).map((order) => String(order?.trackingCode || '').trim()).filter(Boolean));
  let changed = false;
  const nextOrders = (orders || []).map((order) => {
    if (order?.trackingCode) return order;
    changed = true;
    return { ...order, trackingCode: generateTrackingCode(existingCodes) };
  });
  return { orders: nextOrders, changed };
}
function getTrackingLinkForOrder(order = {}, { admin = false } = {}) {
  const code = encodeURIComponent(order?.trackingCode || '');
  const trackingUrl = new URL('../tracking/', window.location.href);
  trackingUrl.searchParams.set('c', code);
  if (admin) trackingUrl.searchParams.set('admin', '1');
  return trackingUrl.toString();
}
function getReminderTemplates() { return TEMPLATE_DEFAULTS; }
function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function applyTemplate(template, values = {}) {
  return Object.entries(values).reduce((result, [key, value]) => {
    const normalized = value == null ? '' : String(value);
    return result.replace(new RegExp(escapeRegExp(`{{${key}}}`), 'g'), normalized);
  }, String(template || ''))
    .replace(/{{\s*[^}]+\s*}}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
function getCalendarSelectedDate() {
  return els.calendarDateInput?.value || '';
}
function updateQuickPeekProgressiveFields() {
  const show = Boolean(state.quickPeekEventChosen && els.calendarDateInput?.value);
  [els.quickPeekExchangeField, els.quickPeekReturnField, els.quickPeekLocationField].forEach((field) => field?.classList.toggle('hidden', !show));
}
function syncQuickPeekDatesFromEvent(force = false) {
  const eventDate = getCalendarSelectedDate();
  if (!eventDate) return;
  if (els.quickPeekExchangeDateInput && (force || !els.quickPeekExchangeDateInput.value)) {
    els.quickPeekExchangeDateInput.value = addDays(eventDate, -1);
  }
  if (els.quickPeekReturnDateInput && (force || !els.quickPeekReturnDateInput.value)) {
    els.quickPeekReturnDateInput.value = addDays(eventDate, 1);
  }
}
function handleQuickPeekEventDateChange() {
  syncQuickPeekDatesFromEvent(true);
  renderCalendarView();
}
function getQuickPeekRange() {
  const eventDate = getCalendarSelectedDate();
  const exchangeDate = els.quickPeekExchangeDateInput?.value || addDays(eventDate, -1);
  const returnDate = els.quickPeekReturnDateInput?.value || addDays(eventDate, 1);
  return { eventDate, exchangeDate, returnDate };
}
function shiftCalendarDate(days) {
  if (!els.calendarDateInput) return;
  state.quickPeekEventChosen = true;
  const base = getCalendarSelectedDate() || new Date().toISOString().slice(0, 10);
  els.calendarDateInput.value = addDays(base, days);
  syncQuickPeekDatesFromEvent(true);
  renderCalendarView();
}
function ordinalSuffix(day) {
  const value = Number(day || 0);
  if (value % 100 >= 11 && value % 100 <= 13) return 'th';
  if (value % 10 === 1) return 'st';
  if (value % 10 === 2) return 'nd';
  if (value % 10 === 3) return 'rd';
  return 'th';
}
function formatFriendlyDate(date) {
  if (!date) return 'Not set';
  const stamp = parseDateTime(date, '12:00');
  if (!stamp || Number.isNaN(stamp.getTime())) return date;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(stamp);
  const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(stamp);
  const day = stamp.getDate();
  return `${weekday}, ${month} ${day}${ordinalSuffix(day)}, ${stamp.getFullYear()}`;
}
function formatFriendlyShortDate(date) {
  if (!date) return 'Not set';
  const stamp = parseDateTime(date, '12:00');
  if (!stamp || Number.isNaN(stamp.getTime())) return date;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(stamp);
}
function orderRequiresDeposit(order = {}) {
  return getEffectiveOrderTotal(order) > getDepositMinimumOrder();
}
function getOrderDepositAmount(order = {}) {
  return orderRequiresDeposit(order) ? roundDepositAmount(getEffectiveOrderTotal(order) * DEPOSIT_RATE) : 0;
}
function formatClockTime(value = '') {
  const raw = String(value || '').trim();
  if (!raw || /^(tbd|to be determined|time tbd)$/i.test(raw)) return 'To Be Determined';
  const normalized = normalizeInlineTimeValue(raw);
  if (!normalized) return raw;
  const d = new Date(`2000-01-01T${normalized}:00`);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d);
}
function formatOrderValueForUpdate(key, value) {
  if (key === 'exchangeDate' || key === 'returnDate' || key === 'eventDate') return formatFriendlyDate(value);
  if (key === 'exchangeTime' || key === 'returnTime' || key === 'eventTime') return formatClockTime(value);
  if (key === 'deliveryFee' || key === 'total' || key === 'adjustedTotal') return currency(value || 0);
  if (key === 'items') return summarizeUpdateItems(value || []);
  if (key === 'verbalConfirmation') return value ? 'Yes' : 'No';
  return value || 'Not set';
}
function normalizeTbdLabel(value = '') {
  const raw = String(value || '').trim();
  if (!raw || /^(tbd|to be determined|time tbd)$/i.test(raw)) return 'To Be Determined';
  return raw;
}
function summarizeUpdateItems(items = []) {
  return (items || []).map((item) => {
    const qty = Number(item.quantity || 0);
    const accessoryNames = (item.accessories || []).map((acc) => acc.name).filter(Boolean);
    return `${qty} ${item.name}${accessoryNames.length ? ` with ${accessoryNames.join(', ')}` : ''}`;
  }).join(', ') || 'No equipment selected';
}
function collectOrderChanges(previous = {}, next = {}) {
  const changes = [];
  const pairs = [
    ['exchangeDate', 'Exchange date'],
    ['exchangeTime', 'Exchange time'],
    ['returnDate', 'Return date'],
    ['returnTime', 'Return time'],
    ['eventDate', 'Event date'],
    ['eventTime', 'Event time'],
    ['eventName', 'Event'],
    ['status', 'Status'],
    ['address', 'Address'],
    ['setupFee', 'Setup fee'],
    ['tipAmount', 'Tip'],
    ['notes', 'Note']
  ];
  pairs.forEach(([key, label]) => {
    const beforeFormatted = formatOrderValueForUpdate(key, previous?.[key]);
    const afterFormatted = formatOrderValueForUpdate(key, next?.[key]);
    if (beforeFormatted === afterFormatted) return;
    changes.push(`${label} changed to ${afterFormatted}.`);
  });
  if (Boolean(previous?.verbalConfirmation) !== Boolean(next?.verbalConfirmation)) {
    changes.push(next?.verbalConfirmation ? 'Received verbal confirmation of the order.' : 'Verbal confirmation was removed.');
  }
  if (String(previous?.paymentStatus || '') !== String(next?.paymentStatus || '')) {
    changes.push(`Payment status changed to ${next?.paymentStatus || 'Not set'}.`);
  }
  if (String(previous?.fulfillmentType || '') !== String(next?.fulfillmentType || '')) {
    changes.push(`Method changed to ${next?.fulfillmentType || 'Not set'}.`);
  }
  const prevItems = JSON.stringify(previous?.items || []);
  const nextItems = JSON.stringify(next?.items || []);
  if (prevItems !== nextItems) {
    const beforeSummary = summarizeUpdateItems(previous?.items || []);
    const afterSummary = summarizeUpdateItems(next?.items || []);
    if (beforeSummary !== afterSummary) {
      changes.push(`Equipment changed to ${afterSummary}.`);
    }
  }
  const beforeTotal = getEffectiveOrderTotal(previous);
  const afterTotal = getEffectiveOrderTotal(next);
  if (Math.abs(beforeTotal - afterTotal) > 0.004) {
    changes.push(`Order total changed to ${currency(afterTotal)}.`);
  }
  return changes;
}
function appendOrderUpdate(order, changes = []) {
  if (!Array.isArray(changes) || !changes.length) return order;
  const history = Array.isArray(order.updateHistory) ? order.updateHistory.slice() : [];
  history.unshift({
    timestamp: new Date().toISOString(),
    changes
  });
  order.updateHistory = history;
  return order;
}
async function copyLatestOrderUpdate(order, changes = []) {
  if (!Array.isArray(changes) || !changes.length) return;
  await copyTextWithFallback(buildOrderUpdateMessage(order, [{ updateIndex: 0 }]), 'Copy the order update below:');
}
function buildOrderUpdateMessage(order, selectedIndexes = null) {
  const updates = Array.isArray(order?.updateHistory) ? order.updateHistory : [];
  let selectedChanges = [];

  if (Array.isArray(selectedIndexes)) {
    selectedIndexes.forEach((selection) => {
      const updateIndex = typeof selection === 'object' ? Number(selection.updateIndex) : Number(selection);
      const changeIndex = typeof selection === 'object' ? Number(selection.changeIndex) : NaN;
      const entry = updates[updateIndex];
      if (!entry) return;
      const changes = Array.isArray(entry.changes) && entry.changes.length ? entry.changes : ['Please check your latest order details.'];
      if (Number.isInteger(changeIndex) && changeIndex >= 0 && changeIndex < changes.length) {
        selectedChanges.push(changes[changeIndex]);
      } else {
        selectedChanges.push(...changes);
      }
    });
  } else {
    selectedChanges = updates.flatMap((entry) => Array.isArray(entry.changes) && entry.changes.length ? entry.changes : ['Please check your latest order details.']);
  }

  const body = selectedChanges.length
    ? selectedChanges.map((change) => `• ${change}`).join('\n')
    : '• Please check your latest order details.';
  return `Hello ${order?.firstName || ''}! There has been an update to your order:

${body}`.trim();
}
function getPendingReminderChecklist(order) {
  const missing = [];
  if (!order.verbalConfirmation) missing.push('Verbally confirm your order with us!');
  if (order.depositWaived) {
    // deposit intentionally hidden
  } else if (orderRequiresDeposit(order) && !['Deposit Paid', 'Deposit', 'Paid', 'Free'].includes(order.paymentStatus)) {
    missing.push(`Pay deposit of ${currency(getOrderDepositAmount(order))}.`);
  }
  if (order.equipmentStillDiscussing) missing.push('Finalize the exact equipment list.');
  return missing;
}
function getItemEffectiveUnitPrice(item) {
  if (item?.chargedUnitPrice !== '' && item?.chargedUnitPrice != null && !Number.isNaN(Number(item.chargedUnitPrice))) return Number(item.chargedUnitPrice);
  return Number(item?.unitPrice || 0);
}
function calculateAdjustedItemsSubtotal(items = []) {
  return (items || []).reduce((sum, item) => sum + (Number(item.quantity || 0) * getItemEffectiveUnitPrice(item)), 0);
}
function getOrderPricingAdjustmentLabel(order) {
  return (order.items || []).some((item) => Number(getItemEffectiveUnitPrice(item)) !== Number(item.unitPrice || 0))
    ? 'Marked Down'
    : 'Small Discount Just To Say Thanks';
}
function getOrderMarkedDownItems(order = {}) {
  return (order.items || []).filter((item) => Number(getItemEffectiveUnitPrice(item)) < Number(item.unitPrice || 0));
}
function buildReminderDiscountDetails(order = {}) {
  const markedDownItems = getOrderMarkedDownItems(order);
  if (!markedDownItems.length) return '';
  return markedDownItems.map((item) => {
    const original = Number(item.unitPrice || 0);
    const reduced = Number(getItemEffectiveUnitPrice(item));
    const quantity = Number(item.quantity || 0);
    const name = item.name || 'Item';
    const qtyText = quantity > 1 ? ` (x${quantity})` : '';
    return `• ${name}${qtyText}: marked down from ${currency(original)} each to ${currency(reduced)} each`;
  }).join('\n');
}
function syncOrderTotalsPreview() {
  if (!els.orderForm) return;
  const rows = [...els.orderItemsBox.querySelectorAll('.order-item-card, .card')];
  const listedItemsSubtotal = rows.reduce((sum, row) => {
    const inventoryId = row.querySelector('[name="item_inventoryId"]')?.value;
    const quantity = Number(row.querySelector('[name="item_quantity"]')?.value || 0);
    const inv = state.inventory.find((entry) => entry.id === inventoryId);
    if (!inv) return sum;
    const accessoryIds = [...row.querySelectorAll('[data-item-accessory]:checked')].map((input) => input.value);
    const accessorySubtotal = normalizeAccessories(inv.accessories || []).filter((acc) => accessoryIds.includes(acc.id)).reduce((accSum, acc) => accSum + (Number(acc.price || 0) * quantity), 0);
    return sum + (Number(inv.price || 0) * quantity) + accessorySubtotal;
  }, 0);
  const chargedItemsSubtotal = rows.reduce((sum, row) => {
    const inventoryId = row.querySelector('[name="item_inventoryId"]')?.value;
    const quantity = Number(row.querySelector('[name="item_quantity"]')?.value || 0);
    const customRaw = row.querySelector('[name="item_customUnitPrice"]')?.value;
    const inv = state.inventory.find((entry) => entry.id === inventoryId);
    if (!inv) return sum;
    const unitPrice = customRaw !== '' && customRaw != null ? Number(customRaw || 0) : Number(inv.price || 0);
    const accessoryIds = [...row.querySelectorAll('[data-item-accessory]:checked')].map((input) => input.value);
    const accessorySubtotal = normalizeAccessories(inv.accessories || []).filter((acc) => accessoryIds.includes(acc.id)).reduce((accSum, acc) => accSum + (Number(acc.price || 0) * quantity), 0);
    return sum + (quantity * unitPrice) + accessorySubtotal;
  }, 0);
  const deliveryFee = Number(els.orderForm.elements.deliveryFee?.value || 0);
  const setupFee = Number(els.orderForm.elements.setupFee?.value || 0);
  const tipAmount = Number(els.orderForm.elements.tipAmount?.value || 0);
  const baseTotal = chargedItemsSubtotal + deliveryFee + setupFee + tipAmount;
  const listedTotal = listedItemsSubtotal + deliveryFee + setupFee + tipAmount;
  const totalField = els.orderForm.elements.total;
  if (totalField && totalField.dataset.userAdjusted !== 'true') totalField.value = baseTotal.toFixed(2);
  const finalTotal = Number(totalField?.value || baseTotal || 0);
  const adjusted = Math.abs(finalTotal - baseTotal) > 0.004;
  const discount = Math.max(0, listedTotal - finalTotal);
  const badge = document.getElementById('orderAdjustedBadge');
  if (badge) badge.textContent = adjusted ? '(adjusted)' : '';
  syncDepositPreview();
  if (els.orderDiscountPreview) {
    const markdownActive = rows.some((row) => row.querySelector('[name="item_customUnitPrice"]')?.value !== '');
    const label = markdownActive ? 'Marked Down' : 'Small Discount Just To Say Thanks';
    els.orderDiscountPreview.textContent = discount > 0 ? `${label}: -${currency(discount)}` : '';
  }
}
function syncDepositPreview() {
  const total = Number(els.orderForm?.elements?.total?.value || 0);
  const deposit = total > getDepositMinimumOrder() ? roundDepositAmount(total * DEPOSIT_RATE) : 0;
  if (els.orderForm?.elements?.depositPreview) els.orderForm.elements.depositPreview.value = deposit.toFixed(2);
}
function setExchangeAndReturnFromEventDate(force = false) {
  const eventDate = els.orderForm?.elements?.eventDate?.value;
  const exchangeDateField = els.orderForm?.elements?.exchangeDate;
  const returnDateField = els.orderForm?.elements?.returnDate;
  if (!eventDate || !exchangeDateField || !returnDateField) return;
  if (force || exchangeDateField.dataset.userEdited !== 'true') exchangeDateField.value = addDays(eventDate, -1);
  if (force || returnDateField.dataset.userEdited !== 'true') returnDateField.value = addDays(eventDate, 1);
}
function setReturnDateFromExchange(force = false) {
  const exchangeDate = els.orderForm?.elements?.exchangeDate?.value;
  const returnDateField = els.orderForm?.elements?.returnDate;
  if (!exchangeDate || !returnDateField) return;
  if (!force && returnDateField.dataset.userEdited === 'true') return;
  returnDateField.value = addDays(exchangeDate, 1);
}
function applyOrderColumnCollapseState() {
  const ordersColumns = document.getElementById('ordersColumns');
  const rail = els.collapsedColumnsRail;
  if (!ordersColumns || !rail) return;
  const columns = { pending: els.pendingColumn, confirmed: els.confirmedColumn, completed: els.completedColumn };
  const active = state.activeOrderColumn || 'confirmed';
  rail.innerHTML = '';
  Object.entries(columns).forEach(([key, column]) => {
    if (!column) return;
    const collapsed = key !== active;
    state.collapsedColumns[key] = collapsed;
    column.classList.toggle('collapsed', collapsed);
    const toggle = column.querySelector('[data-toggle-column]');
    toggle?.setAttribute('aria-expanded', String(!collapsed));
    if (collapsed) rail.appendChild(column); else ordersColumns.appendChild(column);
  });
  rail.classList.toggle('has-collapsed-columns', rail.children.length > 0);
  ordersColumns.classList.add('single-open-column');
}

function notificationContextKey() {
  if (state.viewAsEmployee) return `employee:${state.viewAsEmployee.uid || state.viewAsEmployee.id || 'preview'}`;
  if (isEmployeeUser()) return `employee:${getExperienceUser()?.uid || getExperienceUser()?.id || 'employee'}`;
  return 'admin';
}
function notificationReadKey() { return `rso-notification-read-v58:${notificationContextKey()}`; }
function getReadNotificationIds() {
  try { return new Set(JSON.parse(localStorage.getItem(notificationReadKey()) || '[]')); } catch (_) { return new Set(); }
}
function markNotificationRead(id = '') {
  if (!id) return;
  const read = getReadNotificationIds();
  read.add(id);
  try { localStorage.setItem(notificationReadKey(), JSON.stringify([...read].slice(-250))); } catch (_) {}
}
function employeeEquipmentSignature(employee = getExperienceUser()) {
  return JSON.stringify(employeeAssignments(employee).map((a) => ({ inventoryId:a.inventoryId, quantity:a.quantity, unitCost:a.unitCost, accessories:a.accessories })).sort((a,b) => `${a.inventoryId}:${a.unitCost}`.localeCompare(`${b.inventoryId}:${b.unitCost}`)));
}
function notificationHash(value = '') { let h = 0; for (let i=0;i<String(value).length;i++) h = ((h << 5) - h + String(value).charCodeAt(i)) | 0; return Math.abs(h).toString(36); }
function persistentChangeNotification(kind, signature, item) {
  if (!signature) return null;
  const key = `rso-notification-snapshot-v58:${notificationContextKey()}:${kind}`;
  let previous = null;
  try { previous = localStorage.getItem(key); } catch (_) {}
  if (previous === signature) return null;
  return { ...item, id:`${item.id}:${notificationHash(signature)}`, snapshotKey:key, snapshotValue:signature };
}
function buildNotificationItems() {
  const items = [];
  if (isAdminUser()) {
    (state.orders || []).filter((order) => order.newInquiry).forEach((order) => items.push({
      id:`inquiry:${order.id}`, icon:'📋', type:'order', orderId:order.id,
      title:'New order request', detail:`${`${order.firstName || ''} ${order.lastName || ''}`.trim() || 'Customer'} · ${summarizeOrderItems(order.items || [])}`
    }));
    (state.payoutRequests || []).filter((r) => r.status === 'pending').forEach((r) => items.push({
      id:`payout:${r.id}`, icon:'💵', type:'admin-payout', payoutId:r.id,
      title:'Payout request', detail:`${r.employeeName || 'Employee'} requested ${currency(Number(r.amount || 0))}${r.payoutMethod ? ` · ${r.payoutMethod}` : ''}`
    }));
    (state.users || []).filter((u) => u.role === 'employee' && u.status !== 'approved').forEach((u) => items.push({
      id:`employee-approval:${u.uid || u.id}`, icon:'👤', type:'tab', tab:'employees', title:'Employee approval needed', detail:employeeDisplayName(u)
    }));
  } else if (isEmployeeUser()) {
    const employee = getExperienceUser();
    const employeeId = employee?.uid || employee?.id || '';
    (state.orders || []).filter((order) => order.assignedEmployeeId === employeeId && order.status !== 'Completed').forEach((order) => {
      const missing = [];
      if (!String(order.exchangeTime || '').trim()) missing.push('exchange time');
      if (!String(order.returnTime || '').trim()) missing.push('return time');
      if (order.fulfillmentType === 'Delivery' && !(Number(order.deliveryFee || 0) > 0)) missing.push('delivery fee');
      items.push({
        id:`employee-order:${order.id}:${order.updatedAt || order.createdAt || order.status || ''}`, icon:missing.length ? '❗' : '📦', type:'order', orderId:order.id,
        title:missing.length ? 'Order needs attention' : 'Assigned order updated',
        detail:`${`${order.firstName || ''} ${order.lastName || ''}`.trim() || 'Customer'}${missing.length ? ` · needs ${missing.join(', ')}` : ` · ${formatFriendlyShortDate(order.exchangeDate || order.eventDate)}`}`
      });
    });
    (state.payoutRequests || []).filter((r) => String(r.employeeUid || '') === String(employeeId) && r.status === 'paid').forEach((r) => items.push({
      id:`employee-payout-paid:${r.id}:${r.updatedAt || ''}`, icon:'✅', type:'tab', tab:'mypayouts', title:'Payout completed', detail:`${currency(Number(r.amount || 0))} · ${r.payoutMethod || r.payoutAccountNickname || 'Payout'}`
    }));
    (state.payoutRequests || []).filter((r) => String(r.employeeUid || '') === String(employeeId) && r.status === 'declined').forEach((r) => items.push({
      id:`employee-payout-declined:${r.id}:${r.updatedAt || ''}`, icon:'⚠️', type:'tab', tab:'mypayouts', title:'Payout request declined', detail:`${currency(Number(r.amount || 0))} · Open My Payouts for details.`
    }));
    const equipmentChange = persistentChangeNotification('equipment', employeeEquipmentSignature(employee), {
      id:`equipment-change:${employeeId}`, icon:'◇', type:'snapshot-tab', tab:'payments', title:'Equipment allocation changed', detail:'Your assigned equipment, accessories, or payoff cost groups were updated.'
    });
    if (equipmentChange) items.push(equipmentChange);
    const schedule = (state.schedules || []).find((row) => String(row.uid || row.employeeUid || row.id || '') === String(employeeId)) || state.schedules?.[0];
    if (schedule) {
      const sig = JSON.stringify(schedule);
      const scheduleChange = persistentChangeNotification('schedule', sig, { id:`schedule-change:${employeeId}`, icon:'◷', type:'snapshot-tab', tab:'schedule', title:'Schedule updated', detail:'Your availability or date-specific schedule changed.' });
      if (scheduleChange) items.push(scheduleChange);
    }
    const contract = employeeContractAgreement(employee);
    const contractSig = JSON.stringify(employee.contractAgreement || employee.contractAcceptance || {});
    if (contract.body) {
      const contractChange = persistentChangeNotification('contract', contractSig, { id:`contract-change:${employeeId}`, icon:'≡', type:'snapshot-tab', tab:'documents', title:'Contract updated', detail:'Your contract or payout preference was updated.' });
      if (contractChange) items.push(contractChange);
    }
    if (!isSecondaryLogin()) {
      (state.secondaryUsers || []).filter((u) => u.status !== 'approved').forEach((u) => items.push({ id:`secondary:${u.uid || u.id}`, icon:'👥', type:'tab', tab:'account', title:'Secondary login needs approval', detail:employeeDisplayName(u) }));
    }
  }
  const read = getReadNotificationIds();
  return items.map((item) => ({ ...item, unread: !read.has(item.id) }));
}
function renderNotificationPopover() {
  if (!els.notificationPopover) return;
  const items = buildNotificationItems();
  const unreadCount = items.filter((item) => item.unread).length;
  els.notificationPopover.innerHTML = `<div class="notification-popover-head"><div><strong>Notifications</strong><span>${unreadCount ? `${unreadCount} new` : 'Up to date'}</span></div>${items.length ? '<button type="button" class="btn btn-ghost btn-small" data-notification-mark-all>Mark all read</button>' : ''}</div><div class="notification-list">${items.length ? items.map((item) => `<button type="button" class="notification-item ${item.unread ? 'unread' : ''}" data-notification-id="${safeText(item.id)}"><span class="notification-item-icon">${item.icon}</span><span class="notification-item-copy"><strong>${safeText(item.title)}</strong><small>${safeText(item.detail || '')}</small></span>${item.unread ? '<span class="notification-unread-dot"></span>' : ''}</button>`).join('') : '<div class="notification-empty">No notifications right now.</div>'}</div>`;
  els.notificationPopover.classList.toggle('hidden', !state.notificationPopoverOpen);
  els.newInquiryBell?.setAttribute('aria-expanded', String(state.notificationPopoverOpen));
}
function updateNewInquiryBadge() {
  const items = buildNotificationItems();
  const count = items.filter((item) => item.unread).length;
  if (!els.newInquiryBadge) return;
  els.newInquiryBadge.textContent = String(count);
  els.newInquiryBadge.classList.toggle('hidden', count === 0);
  els.newInquiryBell?.classList.toggle('has-new', count > 0);
  const label = count ? `${count} unread notification${count === 1 ? '' : 's'}` : 'No new notifications';
  els.newInquiryBell?.setAttribute('aria-label', label);
  if (els.newInquiryBell) els.newInquiryBell.title = label;
  renderNotificationPopover();
}
function closeNotificationPopover() {
  state.notificationPopoverOpen = false;
  renderNotificationPopover();
}
function openNotificationOrderModal(order = {}) {
  if (!order || !els.notificationOrderModalWrap || !els.notificationOrderModalBody) return;
  const name = `${order.firstName || ''} ${order.lastName || ''}`.trim() || 'Customer';
  const exchangeMissing = !String(order.exchangeTime || '').trim();
  const returnMissing = !String(order.returnTime || '').trim();
  const deliveryFeeMissing = order.fulfillmentType === 'Delivery' && !(Number(order.deliveryFee || 0) > 0);
  const attention = (missing) => missing ? '<span class="notification-attention-icon" title="Needs attention">!</span>' : '';
  const itemRows = (order.items || []).map((item) => `<div class="notification-order-item"><span>${safeText(item.name || 'Equipment')}</span><strong>${Number(item.quantity || 0)}</strong></div>`).join('') || '<div class="small muted">No equipment listed.</div>';
  if (els.notificationOrderModalTitle) els.notificationOrderModalTitle.textContent = `${name} — ${order.eventName || 'Rental'}`;
  els.notificationOrderModalBody.innerHTML = `<div class="notification-order-attention-summary ${(exchangeMissing || returnMissing || deliveryFeeMissing) ? 'needs-attention' : ''}">${(exchangeMissing || returnMissing || deliveryFeeMissing) ? '<strong>Some details still need attention.</strong><span>Items marked with ! should be confirmed before the exchange.</span>' : '<strong>This order has the key exchange details filled in.</strong>'}</div><div class="notification-order-grid">
    <div><span>Customer</span><strong>${safeText(name)}</strong></div>
    <div><span>Event</span><strong>${safeText(order.eventName || 'Rental')}</strong></div>
    <div><span>Event date</span><strong>${safeText(formatDateTime(order.eventDate, order.eventTime || 'To Be Determined'))}</strong></div>
    <div><span>Exchange ${attention(exchangeMissing)}</span><strong>${safeText(formatDateTime(order.exchangeDate, order.exchangeTime || 'To Be Determined'))}</strong></div>
    <div><span>Return ${attention(returnMissing)}</span><strong>${safeText(formatDateTime(order.returnDate, order.returnTime || 'To Be Determined'))}</strong></div>
    <div><span>Fulfillment</span><strong>${safeText(order.fulfillmentType || 'Pickup')}</strong></div>
    ${order.fulfillmentType === 'Delivery' ? `<div><span>Delivery fee ${attention(deliveryFeeMissing)}</span><strong>${deliveryFeeMissing ? 'Not set' : currency(Number(order.deliveryFee || 0))}</strong></div><div><span>Delivery address</span><strong>${safeText(order.address || 'Not set')}</strong></div>` : ''}
    <div><span>Order total</span><strong>${currency(getEffectiveOrderTotal(order))}</strong></div>
    <div><span>Payment</span><strong>${safeText(order.paymentStatus || 'Un-Paid')}</strong></div>
  </div><div class="notification-order-equipment"><strong>Equipment</strong>${itemRows}</div>${order.notes ? `<div class="note-block small"><strong>Notes:</strong> ${safeText(order.notes)}</div>` : ''}<div class="button-row notification-order-actions"><button type="button" class="btn btn-primary" data-notification-open-order="${safeText(order.id)}">${isEmployeeUser() ? 'Open Order Controls' : 'Edit Order'}</button><button type="button" class="btn btn-ghost" data-close-notification-order>Close</button></div>`;
  els.notificationOrderModalWrap.classList.add('open');
}
function closeNotificationOrderModal() { els.notificationOrderModalWrap?.classList.remove('open'); }
function handleNotificationClick(event) {
  if (event.target.closest('[data-notification-mark-all]')) {
    buildNotificationItems().forEach((item) => {
      markNotificationRead(item.id);
      if (item.snapshotKey) { try { localStorage.setItem(item.snapshotKey, item.snapshotValue); } catch (_) {} }
    });
    updateNewInquiryBadge();
    return;
  }
  const button = event.target.closest('[data-notification-id]');
  if (!button) return;
  const item = buildNotificationItems().find((entry) => entry.id === button.dataset.notificationId);
  if (!item) return;
  markNotificationRead(item.id);
  if (item.snapshotKey) { try { localStorage.setItem(item.snapshotKey, item.snapshotValue); } catch (_) {} }
  closeNotificationPopover();
  if (item.type === 'order') {
    const order = state.orders.find((o) => o.id === item.orderId);
    if (order) openNotificationOrderModal(order);
  } else {
    state.activeTab = item.tab || (item.type === 'admin-payout' ? 'adminpayments' : 'orders');
    renderTabs();
  }
  updateNewInquiryBadge();
}

function getBusinessWeekOfYear(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const first = new Date(d.getFullYear(), 0, 1, 12, 0, 0);
  while (first.getDay() !== 5) first.setDate(first.getDate() + 1);
  const diffDays = Math.floor((d - first) / 86400000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}
function formatDateWithDayCount(dateStr) {
  if (!dateStr) return 'No date';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const todayRaw = new Date();
  const today = new Date(todayRaw.getFullYear(), todayRaw.getMonth(), todayRaw.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target - today) / 86400000);
  const label = diff === 0 ? 'Today' : diff === 1 ? '1 Day' : diff === -1 ? '1 Day Ago' : diff > 1 ? `${diff} Days` : `${Math.abs(diff)} Days Ago`;
  const dateText = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
  return `${dateText} (${label}, Week ${getBusinessWeekOfYear(dateStr)})`;
}

function getRouteStopsForDate(dateStr = state.routeDate) {
  const stops = [];
  state.orders.forEach((order) => {
    if (order.fulfillmentType !== 'Delivery' || !String(order.address || '').trim()) return;
    const name = `${order.firstName || ''} ${order.lastName || ''}`.trim() || 'Customer';
    const items = summarizeOrderItems(order.items || []);
    if (order.exchangeDate === dateStr) {
      stops.push({ id: `${order.id}_delivery`, orderId: order.id, type: 'Delivery', time: order.exchangeTime || '', address: order.address, name, items, coords: order.deliveryCoords || null, status: order.status || '' });
    }
    if (order.returnDate === dateStr) {
      stops.push({ id: `${order.id}_pickup`, orderId: order.id, type: 'Pickup', time: order.returnTime || '', address: order.address, name, items, coords: order.deliveryCoords || null, status: order.status || '' });
    }
  });
  return stops.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')) || a.name.localeCompare(b.name));
}

function isDateTodayOrFuture(dateStr) {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const todayRaw = new Date();
  const today = new Date(todayRaw.getFullYear(), todayRaw.getMonth(), todayRaw.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return target >= today;
}

function getRouteDateGroups() {
  const dates = new Map();
  state.orders.forEach((order) => {
    if (order.fulfillmentType !== 'Delivery' || !String(order.address || '').trim()) return;
    if (order.exchangeDate && isDateTodayOrFuture(order.exchangeDate)) dates.set(order.exchangeDate, true);
    if (order.returnDate && isDateTodayOrFuture(order.returnDate)) dates.set(order.returnDate, true);
  });
  return [...dates.keys()]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((date) => ({ date, stops: getRouteStopsForDate(date) }))
    .filter((group) => group.stops.length);
}

function formatRouteCountLabel(stops = []) {
  const deliveryCount = stops.filter((stop) => stop.type === 'Delivery').length;
  const pickupCount = stops.filter((stop) => stop.type === 'Pickup').length;
  const parts = [];
  if (deliveryCount) parts.push(`${deliveryCount} ${deliveryCount === 1 ? 'delivery' : 'deliveries'}`);
  if (pickupCount) parts.push(`${pickupCount} ${pickupCount === 1 ? 'pickup' : 'pickups'}`);
  return parts.join(', ') || '0 stops';
}

function renderDeliveryRoute() {
  if (!els.routeStopsList) return;
  const groups = getRouteDateGroups();
  els.routeStopsList.innerHTML = groups.length ? groups.map((group) => `
    <div class="order-date-group route-date-group">
      <div class="route-date-heading-row">
        <div>
          <div class="order-date-heading">${safeText(formatDateWithDayCount(group.date))}</div>
          <div class="small muted">${safeText(formatRouteCountLabel(group.stops))}</div>
        </div>
        <button type="button" class="btn btn-primary btn-small" data-plan-route-date="${safeText(group.date)}">Plan Route in Google Maps</button>
      </div>
      ${group.stops.map((stop, index) => `
        <div class="calendar-stock-row route-stop-row">
          <div>
            <strong>${index + 1}. ${safeText(stop.type)} · ${safeText(formatClockTime(stop.time || ''))}</strong>
            <div class="small muted">${safeText(stop.name)} · ${safeText(stop.items)}</div>
            <div class="small">${safeText(stop.address)}</div>
          </div>
          <div class="calendar-stock-metrics">
            <span class="badge ${stop.type === 'Delivery' ? 'badge-blue' : 'badge-yellow'}">${safeText(stop.type)}</span>
            <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address)}">Map</a>
          </div>
        </div>`).join('')}
    </div>`).join('') : '<div class="empty-state">No delivery or pickup stops are scheduled yet.</div>';
}

function distanceMiles(a, b) {
  if (!a || !b || Number.isNaN(Number(a.lat ?? a.latitude)) || Number.isNaN(Number(b.lat ?? b.latitude))) return Number.POSITIVE_INFINITY;
  const alat = Number(a.lat ?? a.latitude);
  const alon = Number(a.lon ?? a.lng ?? a.longitude);
  const blat = Number(b.lat ?? b.latitude);
  const blon = Number(b.lon ?? b.lng ?? b.longitude);
  const R = 3958.8;
  const dLat = (blat - alat) * Math.PI / 180;
  const dLon = (blon - alon) * Math.PI / 180;
  const lat1 = alat * Math.PI / 180;
  const lat2 = blat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function geocodeRouteStop(stop) {
  if (stop.coords?.lat && (stop.coords?.lon || stop.coords?.lng)) return { ...stop, coords: stop.coords };
  try {
    const match = await geocodeAddress(stop.address, { origin: state.settings?.pickupCoords || null, context: state.settings || null });
    if (match) return { ...stop, coords: { lat: match.lat, lon: match.lon } };
  } catch (error) {
    console.warn('Route geocode failed', stop.address, error);
  }
  return stop;
}

function nearestNeighborStops(stops, originCoords) {
  if (!originCoords || stops.some((stop) => !stop.coords)) return stops;
  const remaining = stops.slice();
  const ordered = [];
  let current = originCoords;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((stop, index) => {
      const dist = distanceMiles(current, stop.coords);
      if (dist < bestDistance) { bestDistance = dist; bestIndex = index; }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = next.coords;
  }
  return ordered;
}

async function planDeliveryRoute(dateStr = state.routeDate) {
  state.routeDate = dateStr || state.routeDate;
  const stops = getRouteStopsForDate(state.routeDate);
  if (!stops.length) {
    alert('No delivery or pickup stops are scheduled for this day.');
    return;
  }
  const pickupAddress = String(state.settings?.pickupAddress || '').trim();
  if (!pickupAddress) {
    alert('Add your pickup address in Settings first so the route has a starting point.');
    return;
  }
  await withBusy(async () => {
    let originCoords = state.settings?.pickupCoords || null;
    if (!originCoords) {
      try {
        const match = await geocodeAddress(pickupAddress, { context: state.settings || null });
        if (match) originCoords = { lat: match.lat, lon: match.lon };
      } catch {}
    }
    const geocodedStops = [];
    for (const stop of stops) geocodedStops.push(await geocodeRouteStop(stop));
    const ordered = nearestNeighborStops(geocodedStops, originCoords);
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('origin', pickupAddress);
    url.searchParams.set('destination', pickupAddress);
    url.searchParams.set('travelmode', 'driving');
    url.searchParams.set('waypoints', ordered.map((stop) => stop.address).join('|'));
    window.open(url.toString(), '_blank', 'noopener');
  }, 'Planning route…');
}


function normalizeEmployeeColor(value = '', fallback = '#7c3aed') {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}
function employeeOrderColors(user = {}) {
  const legacy = normalizeEmployeeColor(user.highlightColor, '#7c3aed');
  return {
    accent: normalizeEmployeeColor(user.orderAccentColor || user.highlightColor, legacy),
    background: normalizeEmployeeColor(user.orderBackgroundColor, '#f7f5ff'),
    badge: normalizeEmployeeColor(user.orderBadgeColor || user.highlightColor, legacy)
  };
}
function readableTextColor(hex = '#7c3aed') {
  const value = normalizeEmployeeColor(hex, '#7c3aed').slice(1);
  const r = parseInt(value.slice(0,2),16);
  const g = parseInt(value.slice(2,4),16);
  const b = parseInt(value.slice(4,6),16);
  const luminance = (0.299*r + 0.587*g + 0.114*b);
  return luminance > 165 ? '#172033' : '#ffffff';
}
function assignedEmployeeForOrder(order = {}) {
  return (state.users || []).find((user) => (user.uid || user.id) === order.assignedEmployeeId) || null;
}
function getOrderNextActionDate(order = {}) {
  if (order.status === 'In-Progress') return order.returnDate || order.exchangeDate || order.eventDate || '';
  return order.exchangeDate || order.eventDate || order.returnDate || '';
}
function getOrderNextActionTime(order = {}) {
  if (order.status === 'In-Progress') return order.returnTime || order.exchangeTime || '';
  return order.exchangeTime || order.eventTime || order.returnTime || '';
}
function compareNextActionAsc(a = {}, b = {}) {
  const ak = `${getOrderNextActionDate(a)} ${getOrderNextActionTime(a) || '23:59'}`;
  const bk = `${getOrderNextActionDate(b)} ${getOrderNextActionTime(b) || '23:59'}`;
  return ak.localeCompare(bk);
}
function unloadCompletedOrders() {
  state.orders = (state.orders || []).filter((order) => getOrderColumn(order.status) !== 'completed');
  state.completedOrdersLoaded = false;
  state.completedOrdersLoading = false;
  state.activeOrderColumn = 'confirmed';
  if (els.completedList) els.completedList.innerHTML = '<div class="empty-state">Completed orders load only when you open this archive.</div>';
  if (els.completedTotal) els.completedTotal.textContent = 'Not loaded';
  renderOrders();
}

async function ensureCompletedOrdersLoaded() {
  if (state.completedOrdersLoaded || state.completedOrdersLoading || isEmployeeUser()) return;
  state.completedOrdersLoading = true;
  if (els.completedList) els.completedList.innerHTML = '<div class="section-loading-card"><span class="section-loading-spinner" aria-hidden="true"></span><span>Loading completed orders…</span></div>';
  try {
    const completed = await loadCompletedOrders();
    const merged = new Map((state.orders || []).map((order) => [order.id, order]));
    completed.forEach((order) => merged.set(order.id, { assignedEmployeeId: '', assignedEmployeeName: '', ...order, paymentStatus: order.paymentStatus === 'Deposit' ? 'Deposit Paid' : order.paymentStatus }));
    state.orders = [...merged.values()];
    state.completedOrdersLoaded = true;
    syncAllOrdersToDepositRule({ touchUpdatedAt: false });
    renderOrders();
    renderNumbers();
    renderEmployees();
    renderEmployeePayments();
    renderEmployeePayouts();
    renderEmployeeEarnedBalance();
  } finally {
    state.completedOrdersLoading = false;
  }
}


function renderOrdersViewMode() {
  const calendar = state.ordersView === 'calendar';
  els.ordersListView?.classList.toggle('hidden', calendar);
  els.ordersCalendarView?.classList.toggle('hidden', !calendar);
  els.ordersViewToggle?.querySelectorAll('[data-orders-view]').forEach((btn) => btn.classList.toggle('active', btn.dataset.ordersView === state.ordersView));
}
function monthStart(dateStr = '') {
  const d = new Date(`${dateStr || new Date().toISOString().slice(0,10)}T12:00:00`);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function isoLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function shiftOrdersCalendarMonth(diff) {
  const d = monthStart(state.ordersCalendarDate);
  d.setMonth(d.getMonth() + diff);
  const current = monthStart(isoLocalDate(new Date()));
  if (d < current) d.setTime(current.getTime());
  state.ordersCalendarDate = isoLocalDate(d);
  renderOrdersCalendar();
}
function orderCalendarStartDate(order = {}) { return order.exchangeDate || order.eventDate || order.date || ''; }
function orderCalendarEndDate(order = {}) { return order.returnDate || order.exchangeDate || order.eventDate || order.date || ''; }
function localDateFromIso(value = '') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}
function calendarDaySerial(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}
function clampOrderCalendarRange(order = {}) {
  const start = localDateFromIso(orderCalendarStartDate(order));
  const end = localDateFromIso(orderCalendarEndDate(order));
  if (!start && !end) return null;
  const rangeStart = start || end;
  const rangeEnd = end || start;
  if (rangeEnd < rangeStart) return { start: rangeStart, end: rangeStart };
  return { start: rangeStart, end: rangeEnd };
}
function orderCalendarLabel(order = {}) {
  return `${order.firstName || ''} ${order.lastName || ''}`.trim() || order.eventName || 'Order';
}
function assignCalendarLanes(segments = []) {
  const laneEnds = [];
  return segments.map((segment) => {
    let lane = laneEnds.findIndex((endCol) => endCol < segment.startCol);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(segment.endCol); }
    else laneEnds[lane] = segment.endCol;
    return { ...segment, lane };
  });
}
function renderOrdersCalendar() {
  if (!els.ordersMonthCalendar) return;
  renderOrdersViewMode();
  const base = monthStart(state.ordersCalendarDate);
  if (els.ordersCalendarMonthLabel) els.ordersCalendarMonthLabel.textContent = new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric'}).format(base);
  const gridStart = new Date(base); gridStart.setDate(1 - base.getDay());
  const todayDate = localDateFromIso(isoLocalDate(new Date()));
  const today = isoLocalDate(todayDate);
  const currentWeekStart = new Date(todayDate); currentWeekStart.setDate(todayDate.getDate() - todayDate.getDay());
  const experienceUser = getExperienceUser();
  const calendarSourceOrders = isEmployeeUser() ? (state.orders || []).filter((o) => o.assignedEmployeeId === (experienceUser?.uid || experienceUser?.id)) : (state.orders || []);
  const visibleOrders = filterOrdersByLocation(calendarSourceOrders).map((order) => ({ order, range: clampOrderCalendarRange(order) })).filter((row) => row.range);
  const weeks = [];
  for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
    const weekStart = new Date(gridStart); weekStart.setDate(gridStart.getDate() + weekIndex * 7);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    if (weekEnd < currentWeekStart) continue;
    const dayCells = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const d = new Date(weekStart); d.setDate(weekStart.getDate() + dayIndex);
      const iso = isoLocalDate(d);
      const outside = d.getMonth() !== base.getMonth();
      dayCells.push(`<div class="orders-calendar-day${outside?' outside':''}${iso===today?' today':''}" data-orders-calendar-date="${iso}"><div class="orders-calendar-day-number">${d.getDate()}</div></div>`);
    }
    const segments = visibleOrders.flatMap(({order, range}) => {
      if (range.end < weekStart || range.start > weekEnd) return [];
      const segStart = range.start < weekStart ? weekStart : range.start;
      const segEnd = range.end > weekEnd ? weekEnd : range.end;
      const startCol = calendarDaySerial(segStart) - calendarDaySerial(weekStart) + 1;
      const endCol = calendarDaySerial(segEnd) - calendarDaySerial(weekStart) + 1;
      return [{
        order,
        startCol,
        endCol,
        continuesBefore: range.start < weekStart,
        continuesAfter: range.end > weekEnd
      }];
    }).sort((a,b) => a.startCol - b.startCol || b.endCol - a.endCol || compareExchangeAsc(a.order,b.order));
    const laidOut = assignCalendarLanes(segments);
    const maxLane = laidOut.reduce((max, seg) => Math.max(max, seg.lane), -1);
    const bars = laidOut.map((segment) => {
      const order = segment.order;
      const name = orderCalendarLabel(order);
      const cls = String(order.status || 'Pending').toLowerCase().replace(/[^a-z]+/g,'-');
      const left = ((segment.startCol - 1) / 7) * 100;
      const width = ((segment.endCol - segment.startCol + 1) / 7) * 100;
      const edgeClass = `${segment.continuesBefore ? ' continues-before' : ''}${segment.continuesAfter ? ' continues-after' : ''}`;
      const employee = assignedEmployeeForOrder(order);
      const employeeColors = employeeOrderColors(employee || {});
      const useEmployeeColor = Boolean(order.assignedEmployeeId && employee && order.status !== 'Pending' && order.status !== 'Completed');
      const colorClass = useEmployeeColor ? ' employee-colored' : '';
      const colorVars = useEmployeeColor ? `;--calendar-order-bg:${safeText(employeeColors.background)};--calendar-order-accent:${safeText(employeeColors.accent)};--calendar-order-text:${safeText(readableTextColor(employeeColors.background))}` : '';
      const inquiryClass = order.newInquiry ? ' new-inquiry' : '';
      const compactCalendarTime = (value) => { const formatted = formatClockTime(value || ''); return formatted === 'To Be Determined' ? 'TBD' : formatted; };
      const startTimeLabel = !segment.continuesBefore ? compactCalendarTime(order.exchangeTime) : '';
      const endTimeLabel = !segment.continuesAfter ? compactCalendarTime(order.returnTime) : '';
      return `<button type="button" class="orders-calendar-span status-${cls}${colorClass}${inquiryClass}${edgeClass}" data-calendar-order-id="${safeText(order.id)}" style="--calendar-left:${left}%;--calendar-width:${width}%;--calendar-lane:${segment.lane}${colorVars}" title="${safeText(name)} · ${safeText(formatDateTime(order.exchangeDate, order.exchangeTime || 'To Be Determined'))} → ${safeText(formatDateTime(order.returnDate, order.returnTime || 'To Be Determined'))}">${startTimeLabel ? `<span class="calendar-edge-time start">${safeText(startTimeLabel)}</span>` : ''}<strong>${safeText(name)}</strong>${endTimeLabel ? `<span class="calendar-edge-time end">${safeText(endTimeLabel)}</span>` : ''}<span class="calendar-status-label">${safeText(order.status || '')}</span></button>`;
    }).join('');
    weeks.push(`<div class="orders-calendar-week" style="--calendar-lanes:${Math.max(maxLane + 1, 1)}"><div class="orders-calendar-week-days">${dayCells.join('')}</div><div class="orders-calendar-bars">${bars}</div></div>`);
  }
  els.ordersMonthCalendar.innerHTML = `<div class="orders-calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d)=>`<div>${d}</div>`).join('')}</div><div class="orders-calendar-weeks">${weeks.join('')}</div>`;
}
function calendarOrderPopupMarkup(order = {}) {
  const contact = order.contactMethods || {};
  const customer = `${order.firstName || ''} ${order.lastName || ''}`.trim() || 'Unnamed customer';
  const address = order.fulfillmentType === 'Delivery' ? (order.address || 'No delivery address') : (order.assignedEmployeePickupAddress || state.settings?.pickupAddress || 'Pickup address not set');
  const items = (order.items || []).map((item) => `<div class="calendar-popup-item"><span>${safeText(item.name || 'Equipment')}</span><strong>${Number(item.quantity || 0)}</strong></div>`).join('') || '<div class="empty-state">No equipment on this order.</div>';
  return `<div class="calendar-order-popup-card" role="dialog" aria-modal="true" aria-label="Order details">
    <div class="calendar-order-popup-head"><div><div class="small muted">${safeText(order.status || 'Pending')}</div><h2>${safeText(customer)}</h2></div><button type="button" class="icon-btn" data-close-calendar-order>×</button></div>
    <div class="calendar-order-popup-grid">
      <div><span>Event</span><strong>${safeText(order.eventName || 'Rental')}</strong></div>
      <div><span>Event date</span><strong>${safeText(formatDateTime(order.eventDate, order.eventTime || 'To Be Determined'))}</strong></div>
      <div><span>Exchange</span><strong>${safeText(formatDateTime(order.exchangeDate, order.exchangeTime || 'To Be Determined'))}</strong></div>
      <div><span>Return</span><strong>${safeText(formatDateTime(order.returnDate, order.returnTime || 'To Be Determined'))}</strong></div>
      <div><span>Fulfillment</span><strong>${safeText(order.fulfillmentType || 'Pickup')}</strong></div>
      <div><span>Address</span><strong>${safeText(address)}</strong></div>
      <div><span>Total</span><strong>${currency(getEffectiveOrderTotal(order))}</strong></div>
      <div><span>Payment</span><strong>${safeText(order.paymentStatus || 'Un-Paid')}</strong></div>
      ${order.assignedEmployeeName ? `<div><span>Assigned to</span><strong>${safeText(order.assignedEmployeeName)}</strong></div>` : ''}
      ${contact.text ? `<div><span>Phone</span><strong>${safeText(contact.text)}</strong></div>` : ''}
      ${contact.email ? `<div><span>Email</span><strong>${safeText(contact.email)}</strong></div>` : ''}
    </div>
    <div class="calendar-popup-section"><strong>Equipment</strong><div class="calendar-popup-items">${items}</div></div>
    ${order.notes ? `<div class="calendar-popup-section"><strong>Notes</strong><div class="note-block small">${safeText(order.notes)}</div></div>` : ''}
    <div class="calendar-order-popup-actions"><button type="button" class="btn btn-ghost" data-close-calendar-order>Close</button>${isAdminUser() ? `<button type="button" class="btn btn-primary" data-edit-calendar-order="${safeText(order.id)}">Edit Order</button>` : ''}</div>
  </div>`;
}
function closeCalendarOrderPopup() { document.getElementById('calendarOrderPopupWrap')?.remove(); }
function openCalendarOrderPopup(orderId = '') {
  const order = (state.orders || []).find((item) => String(item.id) === String(orderId));
  if (!order) return;
  closeCalendarOrderPopup();
  const wrap = document.createElement('div');
  wrap.id = 'calendarOrderPopupWrap';
  wrap.className = 'calendar-order-popup-backdrop';
  wrap.innerHTML = calendarOrderPopupMarkup(order);
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (event) => {
    if (event.target === wrap || event.target.closest('[data-close-calendar-order]')) { closeCalendarOrderPopup(); return; }
    const edit = event.target.closest('[data-edit-calendar-order]');
    if (edit) { closeCalendarOrderPopup(); openOrderModal(edit.dataset.editCalendarOrder); }
  });
}
function handleOrdersCalendarClick(event) {
  const btn = event.target.closest('[data-calendar-order-id]');
  if (!btn) return;
  openCalendarOrderPopup(btn.dataset.calendarOrderId);
}

const SCHEDULE_DAYS = [
  {key:'sun',label:'Sunday'}, {key:'mon',label:'Monday'}, {key:'tue',label:'Tuesday'}, {key:'wed',label:'Wednesday'},
  {key:'thu',label:'Thursday'}, {key:'fri',label:'Friday'}, {key:'sat',label:'Saturday'}
];
function defaultTypicalSchedule() {
  return Object.fromEntries(SCHEDULE_DAYS.map((day) => [day.key,{mode:'unavailable',start:'19:00',end:'22:00'}]));
}
function normalizeScheduleRecord(row = {}, uidValue = '') {
  const typical = defaultTypicalSchedule();
  for (const day of SCHEDULE_DAYS) {
    const source = row?.typical?.[day.key] || {};
    typical[day.key] = { mode: ['available','allday','unavailable'].includes(source.mode) ? source.mode : 'unavailable', start: normalizeInlineTimeValue(source.start) || '19:00', end: normalizeInlineTimeValue(source.end) || '22:00' };
  }
  const changes = Array.isArray(row.changes) ? row.changes.map((change) => ({date:String(change.date||''),mode:['available','allday','blocked','typical'].includes(change.mode)?change.mode:'typical',start:normalizeInlineTimeValue(change.start)||'19:00',end:normalizeInlineTimeValue(change.end)||'22:00',note:String(change.note||'')})).filter((change)=>change.date) : [];
  return { id: row.id || uidValue, uid: row.uid || row.id || uidValue, typical, changes, updatedAt: row.updatedAt || '' };
}
function scheduleForUid(uidValue = '') {
  return normalizeScheduleRecord((state.schedules || []).find((row)=>String(row.uid||row.id)===String(uidValue)) || {}, uidValue);
}
function schedulePersonOptions() {
  if (!isAdminUser()) return [{uid:getExperienceUser()?.uid || getExperienceUser()?.id || '', label:employeeDisplayName(getExperienceUser() || {})}];
  const currentUid = state.currentUser?.uid || state.currentUser?.id || '';
  return [{uid:currentUid,label:'My Schedule'}, ...approvedEmployees().map((u)=>({uid:u.uid||u.id,label:employeeDisplayName(u)}))];
}
function currentSchedulePersonId() {
  const options = schedulePersonOptions();
  if (!options.some((o)=>o.uid===state.schedulePersonId)) state.schedulePersonId = options[0]?.uid || '';
  return state.schedulePersonId;
}
function timeSelectMarkup(prefix, value='19:00') {
  const normalized = normalizeInlineTimeValue(value) || '19:00';
  const [hh,mm]=normalized.split(':').map(Number); const hour12=hh%12||12; const ap=hh>=12?'PM':'AM';
  const hours=Array.from({length:12},(_,i)=>`<option value="${i+1}"${i+1===hour12?' selected':''}>${i+1}</option>`).join('');
  const mins=['00','15','30','45'].map((m)=>`<option value="${m}"${Number(m)===mm?' selected':''}>${m}</option>`).join('');
  return `<div class="schedule-time-select" data-schedule-time="${prefix}"><select data-part="hour">${hours}</select><span>:</span><select data-part="minute">${mins}</select><select data-part="ampm"><option${ap==='AM'?' selected':''}>AM</option><option${ap==='PM'?' selected':''}>PM</option></select></div>`;
}
function readScheduleTime(container, prefix) {
  const wrap = container?.querySelector(`[data-schedule-time="${prefix}"]`); if (!wrap) return '';
  let h=Number(wrap.querySelector('[data-part="hour"]')?.value||12); const m=wrap.querySelector('[data-part="minute"]')?.value||'00'; const ap=wrap.querySelector('[data-part="ampm"]')?.value||'AM';
  if (ap==='PM' && h!==12) h+=12; if (ap==='AM' && h===12) h=0; return `${String(h).padStart(2,'0')}:${m}`;
}
function setWeeklyScheduleEditorOpen(open) {
  els.weeklyScheduleEditor?.classList.toggle('hidden', !open);
  if (els.editWeeklyScheduleBtn) {
    els.editWeeklyScheduleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    els.editWeeklyScheduleBtn.textContent = open ? 'Cancel' : 'Edit Weekly Schedule';
  }
}
function renderSchedule() {
  if (!els.typicalScheduleGrid) return;
  const people = schedulePersonOptions(); const uidValue=currentSchedulePersonId();
  if (els.schedulePersonSelect) { els.schedulePersonSelect.innerHTML=people.map((p)=>`<option value="${safeText(p.uid)}"${p.uid===uidValue?' selected':''}>${safeText(p.label)}</option>`).join(''); }
  const schedule=scheduleForUid(uidValue);
  els.typicalScheduleGrid.innerHTML=SCHEDULE_DAYS.map((day)=>{ const row=schedule.typical[day.key]; return `<div class="typical-schedule-row" data-typical-day="${day.key}"><strong>${day.label}</strong><select data-typical-mode><option value="unavailable"${row.mode==='unavailable'?' selected':''}>Unavailable</option><option value="available"${row.mode==='available'?' selected':''}>Available</option><option value="allday"${row.mode==='allday'?' selected':''}>All day</option></select><div class="typical-hours${row.mode==='available'?'':' muted-disabled'}">${timeSelectMarkup(`${day.key}-start`,row.start)}<span>to</span>${timeSelectMarkup(`${day.key}-end`,row.end)}</div></div>`; }).join('');
  els.typicalScheduleGrid.querySelectorAll('[data-typical-mode]').forEach((select)=>select.addEventListener('change',()=>select.closest('.typical-schedule-row')?.querySelector('.typical-hours')?.classList.toggle('muted-disabled',select.value!=='available')));
  renderScheduleCalendar();
}
async function saveTypicalScheduleFromForm() {
  const uidValue=currentSchedulePersonId(); if (!uidValue) return;
  const current=scheduleForUid(uidValue); const typical={};
  els.typicalScheduleGrid?.querySelectorAll('[data-typical-day]').forEach((row)=>{ const key=row.dataset.typicalDay; typical[key]={mode:row.querySelector('[data-typical-mode]')?.value||'unavailable',start:readScheduleTime(row,`${key}-start`)||'19:00',end:readScheduleTime(row,`${key}-end`)||'22:00'}; });
  const saved=await withBusy(()=>saveSchedule({...current,uid:uidValue,typical,changes:current.changes}), 'Saving schedule…');
  state.schedules=[saved,...(state.schedules||[]).filter((row)=>String(row.uid||row.id)!==uidValue)];
  if (els.scheduleSaveStatus) { els.scheduleSaveStatus.textContent='Weekly schedule saved.'; setTimeout(()=>{if(els.scheduleSaveStatus) els.scheduleSaveStatus.textContent='';},1800); }
  setWeeklyScheduleEditorOpen(false);
  renderSchedule(); renderCalendarView();
}
function shiftScheduleMonth(diff) { const d=monthStart(state.scheduleCalendarDate); d.setMonth(d.getMonth()+diff); state.scheduleCalendarDate=isoLocalDate(d); renderScheduleCalendar(); }
function scheduleAvailabilityOnDate(uidValue, dateStr) {
  const schedule=scheduleForUid(uidValue); const change=schedule.changes.find((entry)=>entry.date===dateStr && entry.mode!=='typical');
  if (change) { if (change.mode==='blocked') return {mode:'blocked',label:'Blocked off',source:'change',note:change.note}; if(change.mode==='allday') return {mode:'allday',label:'Available all day',source:'change',note:change.note}; return {mode:'available',label:`${formatClockTime(change.start)} – ${formatClockTime(change.end)}`,source:'change',note:change.note}; }
  const d=new Date(`${dateStr}T12:00:00`); const day=SCHEDULE_DAYS[d.getDay()]; const row=schedule.typical[day.key];
  if(row.mode==='unavailable') return {mode:'blocked',label:'Unavailable',source:'typical',note:''}; if(row.mode==='allday') return {mode:'allday',label:'Available all day',source:'typical',note:''}; return {mode:'available',label:`${formatClockTime(row.start)} – ${formatClockTime(row.end)}`,source:'typical',note:''};
}
function renderScheduleCalendar() {
  if(!els.scheduleMonthCalendar) return; const uidValue=currentSchedulePersonId(); const base=monthStart(state.scheduleCalendarDate); if(els.scheduleMonthLabel) els.scheduleMonthLabel.textContent=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric'}).format(base);
  const start=new Date(base); start.setDate(1-base.getDay()); const today=new Date().toISOString().slice(0,10); const cells=[];
  for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const iso=isoLocalDate(d);const avail=scheduleAvailabilityOnDate(uidValue,iso);const outside=d.getMonth()!==base.getMonth();cells.push(`<button type="button" class="schedule-calendar-day ${avail.mode}${outside?' outside':''}${iso===today?' today':''}${avail.source==='change'?' changed':''}" data-schedule-date="${iso}"><span>${d.getDate()}</span><small>${safeText(avail.label)}</small>${avail.source==='change'?'<b>Changed</b>':''}</button>`);}
  els.scheduleMonthCalendar.innerHTML=`<div class="schedule-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d)=>`<div>${d}</div>`).join('')}</div><div class="schedule-calendar-grid">${cells.join('')}</div>`;
}

function handleScheduleCalendarClick(event) {
  const btn = event.target.closest('[data-schedule-date]');
  if (!btn) return;
  openScheduleChangeModal(btn.dataset.scheduleDate);
}
function dateRangeInclusive(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const out = [];
  const cursor = new Date(start);
  while (cursor <= end) { out.push(isoLocalDate(cursor)); cursor.setDate(cursor.getDate() + 1); }
  return out;
}
function uniqueSortedDates(values = []) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}
function openScheduleChangeModal(initialDate = '') {
  state.scheduleEditingDate = initialDate || '';
  state.scheduleChangeSelectionMode = initialDate ? 'individual' : 'range';
  state.scheduleChangeSelectedDates = initialDate ? [initialDate] : [];
  renderScheduleChangeEditor();
  els.scheduleChangeModalWrap?.classList.add('open');
}
function closeScheduleChangeModal() {
  els.scheduleChangeModalWrap?.classList.remove('open');
  state.scheduleEditingDate = '';
  state.scheduleChangeSelectedDates = [];
  if (els.scheduleChangeEditor) els.scheduleChangeEditor.innerHTML = '';
}
function scheduleExistingChangeForDates(dates = []) {
  const schedule = scheduleForUid(currentSchedulePersonId());
  if (dates.length !== 1) return null;
  return schedule.changes.find((c) => c.date === dates[0]) || null;
}
function scheduleDateChipMarkup(date) {
  return `<span class="schedule-date-chip" data-selected-schedule-date="${safeText(date)}"><span>${safeText(formatFriendlyDate(date))}</span><button type="button" aria-label="Remove ${safeText(formatFriendlyDate(date))}" data-remove-schedule-date="${safeText(date)}">×</button></span>`;
}
function renderScheduleChangeEditor() {
  if (!els.scheduleChangeEditor) return;
  const selected = uniqueSortedDates(state.scheduleChangeSelectedDates || []);
  state.scheduleChangeSelectedDates = selected;
  const existing = scheduleExistingChangeForDates(selected) || { mode: 'blocked', start: '19:00', end: '22:00', note: '' };
  const mode = state.scheduleChangeSelectionMode || 'individual';
  const firstDate = selected[0] || '';
  const rangeStart = mode === 'range' ? (selected[0] || state.scheduleEditingDate || '') : '';
  const rangeEnd = mode === 'range' ? (selected[selected.length - 1] || state.scheduleEditingDate || '') : '';
  const title = selected.length === 1 ? `Change for ${formatFriendlyDate(selected[0])}` : 'Add schedule change';
  const titleEl = document.getElementById('scheduleChangeModalTitle'); if (titleEl) titleEl.textContent = title;
  els.scheduleChangeEditor.innerHTML = `
    <div class="schedule-change-modal-body">
      <div class="schedule-change-block">
        <div class="schedule-change-block-head"><div><strong>Dates</strong><div class="small muted">Choose a continuous range or add separate dates.</div></div></div>
        <div class="segmented-view-toggle schedule-date-mode-toggle">
          <button type="button" data-schedule-selection-mode="range" class="${mode === 'range' ? 'active' : ''}">Date Range</button>
          <button type="button" data-schedule-selection-mode="individual" class="${mode === 'individual' ? 'active' : ''}">Individual Dates</button>
        </div>
        <div class="schedule-range-fields${mode === 'range' ? '' : ' hidden'}">
          <label class="form-row"><span>From</span><input type="date" data-schedule-range-start value="${safeText(rangeStart)}" /></label>
          <label class="form-row"><span>Through</span><input type="date" data-schedule-range-end value="${safeText(rangeEnd)}" /></label>
          <div class="small muted schedule-range-count">${selected.length ? `${selected.length} day${selected.length === 1 ? '' : 's'} selected` : 'Choose the first and last day.'}</div>
        </div>
        <div class="schedule-individual-fields${mode === 'individual' ? '' : ' hidden'}">
          <div class="schedule-add-date-row"><label class="form-row"><span>Add a date</span><input type="date" data-schedule-add-date value="${safeText(firstDate && !selected.length ? firstDate : '')}" /></label><button type="button" class="btn btn-secondary btn-small" data-add-schedule-date>Add Date</button></div>
          <div class="schedule-selected-dates">${selected.length ? selected.map(scheduleDateChipMarkup).join('') : '<span class="small muted">No dates selected yet.</span>'}</div>
        </div>
      </div>
      <div class="schedule-change-block">
        <div class="schedule-change-fields-v39">
          <label class="form-row"><span>Availability</span><select data-change-mode><option value="blocked"${existing.mode === 'blocked' ? ' selected' : ''}>Block off entire day</option><option value="allday"${existing.mode === 'allday' ? ' selected' : ''}>Available all day</option><option value="available"${existing.mode === 'available' ? ' selected' : ''}>Change available hours</option><option value="typical"${existing.mode === 'typical' ? ' selected' : ''}>Use typical schedule / remove override</option></select></label>
          <div class="schedule-change-hours${existing.mode === 'available' ? '' : ' hidden'}">${timeSelectMarkup('change-start', existing.start)}<span>to</span>${timeSelectMarkup('change-end', existing.end)}</div>
          <label class="form-row"><span>Note (optional)</span><input data-change-note value="${safeText(existing.note || '')}" placeholder="Day off, appointment, available early…" /></label>
        </div>
      </div>
      <div class="schedule-change-modal-actions">
        <button type="button" class="btn btn-ghost" data-close-schedule-change>Cancel</button>
        ${selected.length === 1 && scheduleExistingChangeForDates(selected) ? '<button type="button" class="btn btn-ghost" data-remove-schedule-change>Remove This Change</button>' : ''}
        <button type="button" class="btn btn-primary" data-save-schedule-change>Save Change</button>
      </div>
    </div>`;
}
function syncScheduleRangeSelection() {
  const start = els.scheduleChangeEditor?.querySelector('[data-schedule-range-start]')?.value || '';
  const end = els.scheduleChangeEditor?.querySelector('[data-schedule-range-end]')?.value || '';
  state.scheduleChangeSelectedDates = dateRangeInclusive(start, end || start);
  const count = els.scheduleChangeEditor?.querySelector('.schedule-range-count');
  if (count) { const n = state.scheduleChangeSelectedDates.length; count.textContent = n ? `${n} day${n === 1 ? '' : 's'} selected` : 'Choose a valid first and last day.'; }
}
function handleScheduleChangeEditorChange(event) {
  if (event.target.matches('[data-change-mode]')) els.scheduleChangeEditor?.querySelector('.schedule-change-hours')?.classList.toggle('hidden', event.target.value !== 'available');
  if (event.target.matches('[data-schedule-range-start], [data-schedule-range-end]')) syncScheduleRangeSelection();
}
async function handleScheduleChangeEditorClick(event) {
  const modeBtn = event.target.closest('[data-schedule-selection-mode]');
  if (modeBtn) {
    state.scheduleChangeSelectionMode = modeBtn.dataset.scheduleSelectionMode;
    if (state.scheduleChangeSelectionMode === 'range' && state.scheduleChangeSelectedDates.length > 1) {
      const sorted = uniqueSortedDates(state.scheduleChangeSelectedDates); state.scheduleChangeSelectedDates = dateRangeInclusive(sorted[0], sorted[sorted.length - 1]);
    }
    renderScheduleChangeEditor(); return;
  }
  const addBtn = event.target.closest('[data-add-schedule-date]');
  if (addBtn) {
    const input = els.scheduleChangeEditor?.querySelector('[data-schedule-add-date]'); const date = input?.value || '';
    if (date) { state.scheduleChangeSelectedDates = uniqueSortedDates([...(state.scheduleChangeSelectedDates || []), date]); renderScheduleChangeEditor(); }
    return;
  }
  const removeDateBtn = event.target.closest('[data-remove-schedule-date]');
  if (removeDateBtn) { state.scheduleChangeSelectedDates = (state.scheduleChangeSelectedDates || []).filter((d) => d !== removeDateBtn.dataset.removeScheduleDate); renderScheduleChangeEditor(); return; }
  const saveBtn = event.target.closest('[data-save-schedule-change]');
  const removeBtn = event.target.closest('[data-remove-schedule-change]');
  if (!saveBtn && !removeBtn) return;
  if (state.scheduleChangeSelectionMode === 'range') syncScheduleRangeSelection();
  const dates = uniqueSortedDates(state.scheduleChangeSelectedDates || []);
  if (!dates.length) { alert('Choose at least one date for this schedule change.'); return; }
  const uidValue = currentSchedulePersonId(); const current = scheduleForUid(uidValue);
  let changes = (current.changes || []).filter((c) => !dates.includes(c.date));
  if (saveBtn) {
    const changeMode = els.scheduleChangeEditor.querySelector('[data-change-mode]')?.value || 'blocked';
    if (changeMode !== 'typical') {
      const start = readScheduleTime(els.scheduleChangeEditor, 'change-start') || '19:00';
      const end = readScheduleTime(els.scheduleChangeEditor, 'change-end') || '22:00';
      const note = els.scheduleChangeEditor.querySelector('[data-change-note]')?.value || '';
      changes.push(...dates.map((date) => ({ date, mode: changeMode, start, end, note })));
    }
  }
  const saved = await withBusy(() => saveSchedule({ ...current, uid: uidValue, changes }), dates.length > 1 ? `Saving ${dates.length} schedule changes…` : 'Saving schedule change…');
  state.schedules = [saved, ...(state.schedules || []).filter((row) => String(row.uid || row.id) !== uidValue)];
  closeScheduleChangeModal(); renderSchedule(); renderCalendarView();
}
function quickPeekSchedulePeople(locationId='company') {
  const currentUid=getExperienceUser()?.uid||getExperienceUser()?.id||'';
  if(String(locationId).startsWith('employee:')) {const uidValue=String(locationId).slice(9);const u=(state.users||[]).find((x)=>(x.uid||x.id)===uidValue);return u?[{uid:uidValue,label:employeeDisplayName(u)}]:[];}
  if(locationId==='main') return currentUid?[{uid:currentUid,label:'My Schedule'}]:[];
  return schedulePersonOptions();
}
function buildQuickPeekScheduleHtml(dateStr, locationId='company') {
  const people=quickPeekSchedulePeople(locationId); if(!people.length) return '';
  return `<div class="calendar-category-card quick-peek-schedule-card"><div class="section-header" style="margin-bottom:10px;"><div><strong>Schedule availability</strong><div class="small muted">Typical hours plus any changes saved for this event date.</div></div></div><div class="quick-peek-schedule-list">${people.map((p)=>{const a=scheduleAvailabilityOnDate(p.uid,dateStr);return `<div class="quick-peek-schedule-row ${a.mode}"><div><strong>${safeText(p.label)}</strong>${a.note?`<div class="small muted">${safeText(a.note)}</div>`:''}</div><div><span>${safeText(a.label)}</span>${a.source==='change'?'<b>Schedule change</b>':''}</div></div>`;}).join('')}</div></div>`;
}
function renderOrders() {
  renderOrdersViewMode();
  const experienceUser = getExperienceUser();
  const visibleOrders = filterOrdersByLocation(isEmployeeUser()
    ? state.orders.filter((o) => o.assignedEmployeeId === (experienceUser?.uid || experienceUser?.id))
    : state.orders);
  const pending = visibleOrders.filter((o) => getOrderColumn(o.status) === 'pending').sort(compareNextActionAsc);
  const confirmed = visibleOrders.filter((o) => getOrderColumn(o.status) === 'confirmed').sort(compareNextActionAsc);
  const active = [...pending, ...confirmed].sort((a, b) => {
    if (Boolean(a.newInquiry) !== Boolean(b.newInquiry)) return a.newInquiry ? -1 : 1;
    return compareNextActionAsc(a, b);
  });
  const completed = visibleOrders.filter((o) => getOrderColumn(o.status) === 'completed').sort(compareCompletedDesc);
  fillList(els.pendingList, '', '');
  fillList(els.confirmedList, renderOrderGroups(active, 'active'), 'No active orders yet.');
  if (state.completedOrdersLoaded) fillList(els.completedList, renderOrderGroups(completed, 'completed'), 'No completed orders yet.');
  if (els.pendingTotal) els.pendingTotal.textContent = `Pending: ${currency(sumOrderTotals(pending))}`;
  if (els.confirmedTotal) els.confirmedTotal.textContent = `Confirmed: ${currency(sumOrderTotals(confirmed))}`;
  if (els.completedTotal) els.completedTotal.textContent = state.completedOrdersLoaded ? `Total: ${currency(sumOrderTotals(completed, { revenueOnly: true }))}` : 'Not loaded';
  applyOrderColumnCollapseState();
  updateNewInquiryBadge();
  bindOrderCardActions();
}
function fillList(el, html, emptyText) {
  el.innerHTML = html || `<div class="empty-state">${emptyText}</div>`;
}
function isRevenueOrder(order = {}) {
  const isFree = Boolean(order.free) || String(order.paymentStatus || '').toLowerCase() === 'free';
  return !isFree && Number(getEffectiveOrderTotal(order) || 0) > 0;
}
function sumOrderTotals(orders = [], { revenueOnly = false } = {}) {
  return orders.reduce((sum, order) => {
    if (revenueOnly && !isRevenueOrder(order)) return sum;
    return sum + getEffectiveOrderTotal(order);
  }, 0);
}
function renderOrderGroups(orders, mode) {
  if (!orders.length) return '';
  const groups = new Map();
  orders.forEach((order) => {
    const key = mode === 'completed' ? (order.completedAt || 'Completed') : (order.newInquiry ? '__new_inquiries__' : (getOrderNextActionDate(order) || 'No action date'));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  });
  return [...groups.entries()].map(([date, groupOrders]) => {
    const highlight = Boolean(state.highlightedOrderDates?.[date]);
    const upcoming = mode !== 'completed' && date !== '__new_inquiries__' && isDateInUpcomingBusinessWeek(date);
    return `
    <div class="order-date-group${highlight ? ' day-highlight-green' : ''}${upcoming ? ' week-highlight-purple' : ''}" data-order-date-group="${safeText(date)}">
      <div class="order-date-heading-row">${formatGroupHeadingHtml(date, mode, groupOrders)}<button type="button" class="btn btn-ghost btn-small" data-toggle-day-highlight="${safeText(date)}">${highlight ? 'Unhighlight' : 'Highlight Day'}</button></div>
      ${groupOrders.map((order) => renderOrderAccordion(order, mode)).join('')}
    </div>
  `;
  }).join('');
}
function summarizeGroupEquipment(orders = []) {
  const totals = new Map();
  (orders || []).forEach((order) => {
    (order.items || []).forEach((item) => {
      const name = String(item.name || '').trim();
      const qty = Number(item.quantity || 0);
      if (!name || !qty) return;
      totals.set(name, (totals.get(name) || 0) + qty);
    });
  });
  return [...totals.entries()].map(([name, qty]) => `${qty} ${name}`).join(', ');
}
function summarizeGroupEquipmentByLocation(orders = []) {
  const byLocation = new Map();
  (orders || []).forEach((order) => {
    const label = locationLabelForOrder(order);
    if (!byLocation.has(label)) byLocation.set(label, []);
    byLocation.get(label).push(order);
  });
  if (byLocation.size <= 1) return summarizeGroupEquipment(orders);
  return [...byLocation.entries()].map(([label, rows]) => `${label}: ${summarizeGroupEquipment(rows) || 'No equipment'}`).join('  |  ');
}
function getBusinessWeekRangeForDate(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(`${date}T12:00:00`);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setHours(0, 1, 0, 0);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  nextMonday.setHours(0, 0, 0, 0);
  return { start: monday, end: nextMonday };
}
function isDateInUpcomingBusinessWeek(dateStr = '') {
  const target = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  const currentWeek = getBusinessWeekRangeForDate(new Date());
  return target >= currentWeek.start && target < currentWeek.end;
}
function getBusinessWeekOfMonth(dateStr = '') {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 1;
  const range = getBusinessWeekRangeForDate(d);
  const nextMonday = new Date(range.start);
  nextMonday.setDate(range.start.getDate() + 7);
  const anchor = range.start.getMonth() !== nextMonday.getMonth() ? nextMonday : d;
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
  const firstDay = first.getDay();
  const firstMonday = new Date(first);
  firstMonday.setDate(first.getDate() - ((firstDay + 6) % 7));
  firstMonday.setHours(0, 1, 0, 0);
  const diffDays = Math.max(0, Math.floor((range.start - firstMonday) / 86400000));
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

function getDaysFromToday(dateStr = '') {
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((target - today) / 86400000));
}

function formatGroupHeadingHtml(date, mode, groupOrders = []) {
  if (date === '__new_inquiries__') return `<div class="order-date-heading new-inquiry-heading">NEW INQUIRIES — REVIEW FIRST</div>`;
  if (mode === 'completed') return `<div class=\"order-date-heading\">${safeText(formatGroupHeading(date, mode, groupOrders))}</div>`;
  const d = new Date(`${date}T12:00:00`);
  const week = getBusinessWeekOfMonth(date);
  const dayCount = getDaysFromToday(date);
  const dateText = Number.isNaN(d.getTime()) ? date : new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  const equipment = summarizeGroupEquipment(groupOrders);
  return `<div class=\"order-date-heading-parts\"><span class=\"heading-chip heading-week\">${dayCount} Day${dayCount === 1 ? '' : 's'} Away · Week ${week}</span><span class=\"heading-chip heading-date\">${safeText(dateText)}</span><span class=\"heading-chip heading-equipment\">${safeText(equipment || 'No equipment')}</span></div>`;
}
function getGroupDayCount(orders = []) {
  return Math.max(1, ...(orders || []).map((order) => {
    const start = new Date(`${order.exchangeDate || ''}T12:00:00`);
    const end = new Date(`${order.returnDate || order.exchangeDate || ''}T12:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
  }));
}
function formatGroupHeading(date, mode, groupOrders = []) {
  if (date === '__new_inquiries__') return 'New inquiries';
  if (mode === 'completed') {
    const stamp = new Date(date);
    if (Number.isNaN(stamp.getTime())) return 'Completed orders';
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(stamp);
  }
  const d = new Date(`${date}T12:00:00`);
  const dateText = Number.isNaN(d.getTime()) ? date : new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  const equipment = summarizeGroupEquipment(groupOrders);
  return `${getGroupDayCount(groupOrders)} Days, Week ${getBusinessWeekOfMonth(date)} · ${dateText}${equipment ? ` · ${equipment}` : ''}`;
}
function renderOrderAccordion(order, mode) {
  const isOpen = state.expandedOrderId === order.id;
  const itemSummary = summarizeOrderItems(order.items || []);
  const displayName = `${safeText(order.firstName || '')} ${safeText(order.lastName || '')}`.trim() || 'Unnamed order';
  const effectiveTotal = getEffectiveOrderTotal(order);
  const displayTimeRaw = getOrderNextActionTime(order);
  const displayTime = /^\d{2}:\d{2}$/.test(String(displayTimeRaw || '').trim())
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(`2000-01-01T${displayTimeRaw}:00`))
    : '??:??';
  const iconParts = [];
  if (order.fulfillmentType === 'Delivery') iconParts.push('🚚');
  if (order.paymentStatus === 'Paid') iconParts.push('✅');
  else if (order.paymentStatus === 'Deposit Paid' || order.paymentStatus === 'Deposit') iconParts.push('☑️');
  const hasPhone = Boolean(String(order.contactMethods?.text || '').trim());
  const hasEmail = Boolean(String(order.contactMethods?.email || '').trim());
  if (!hasPhone && !hasEmail) iconParts.push('📋');
  const fulfillmentLabel = order.fulfillmentType === 'Delivery' ? 'Delivery' : order.fulfillmentType === 'Pickup' ? 'Pickup' : 'TBD';
  const paymentLabel = order.paymentStatus || 'Un-Paid';
  const actionDate = getOrderNextActionDate(order);
  const actionLabel = order.status === 'In-Progress' ? 'Return' : 'Exchange';
  const employeeForColor = assignedEmployeeForOrder(order);
  const employeeColors = employeeOrderColors(employeeForColor || {});
  const employeeBadgeText = readableTextColor(employeeColors.badge);
  const headerTitle = `<div class="order-glance-primary"><span class="order-glance-time">${safeText(displayTime)}</span><span class="order-glance-icons" aria-label="Order indicators">${iconParts.join(' ')}</span><span class="order-glance-name">${displayName}</span><span class="order-glance-total">${currency(effectiveTotal)}</span></div>
    <div class="order-glance-equipment">${safeText(itemSummary)}</div>`;
  const headerSub = mode === 'completed'
    ? `<span>${formatDateTime(order.exchangeDate, order.exchangeTime)}</span>${order.completedAt ? `<span>Completed ${new Date(order.completedAt).toLocaleDateString()}</span>` : ''}<span>${safeText(paymentLabel)}</span>`
    : `<span class="order-next-action-meta"><strong>${actionLabel}</strong> ${safeText(formatFriendlyShortDate(actionDate))}</span><span>${safeText(fulfillmentLabel)}</span>${order.eventDate ? `<span>Event ${formatFriendlyShortDate(order.eventDate)}</span>` : ''}<span>${safeText(paymentLabel)}</span><span>Remaining ${currency(getOrderAmountRemaining(order))}</span>`;
  const employeeBody = renderEmployeeOrderDetails(order);
  const adminBody = `${renderInlineOrderEditor(order)}
        <div class="hr"></div>
        <div class="order-action-row">
          <button class="btn btn-primary btn-small" type="button" data-save-inline-order="${order.id}">Save Inline Changes</button>
          <button class="btn btn-secondary btn-small" type="button" data-copy-reminder="${order.id}">Copy reminder</button>
          <button class="btn btn-ghost btn-small" type="button" data-copy-update="${order.id}">Copy update</button>
          ${order.status === 'Completed' ? `<button class="btn btn-secondary btn-small" type="button" data-copy-review-request="${order.id}">Copy review request</button>` : ''}
          ${order.fulfillmentType === 'Delivery' && order.address ? `<button class="btn btn-ghost btn-small" type="button" data-copy-delivery-address="${order.id}">Copy delivery address</button><a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}">Open in Google Maps</a>` : ''}
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="${safeText(getTrackingLinkForOrder(order, { admin: true }))}">Open Tracking</a>
          <button class="btn btn-ghost btn-small" type="button" data-edit-order="${order.id}">Open Full Editor</button>
          <button class="btn btn-ghost btn-small" type="button" data-delete-order="${order.id}">Delete</button>
        </div>`;
  return `
    <div class="order-card order-accordion ${order.status === 'Pending' ? 'pending-order' : ''} ${order.status === 'In-Progress' ? 'in-progress' : ''} ${isOpen ? 'open' : ''} ${isAdminUser() && order.assignedEmployeeId ? 'employee-assigned-order' : ''}" ${isAdminUser() && order.assignedEmployeeId ? `style="--employee-highlight:${safeText(employeeColors.accent)};--employee-background:${safeText(employeeColors.background)};--employee-badge:${safeText(employeeColors.badge)};--employee-badge-text:${safeText(employeeBadgeText)}"` : ''}>
      <button type="button" class="order-accordion-summary" data-expand-order="${order.id}">
        <div class="order-summary-main">
          <div class="order-summary-title separated-order-title">${headerTitle}</div>
          <div class="order-summary-sub order-glance-meta">${headerSub}${order.assignedEmployeeId && order.assignedEmployeeName ? `<span class="badge employee-assigned-chip">Assigned to ${safeText(order.assignedEmployeeName)}</span>` : ''}${order.newInquiry && isAdminUser() ? `<button type="button" class="badge badge-blue new-inquiry-clear" data-clear-new-inquiry="${order.id}" title="Mark this inquiry as seen">New Inquiry</button>` : ''}</div>
        </div>
        <div class="order-expand-cue"><span>${isOpen ? 'Hide' : 'Details'}</span><span class="order-summary-arrow">⌄</span></div>
      </button>
      <div class="order-accordion-body">${isEmployeeUser() ? employeeBody : adminBody}</div>
    </div>`;
}
function renderInlineOrderEditor(order) {
  const itemRows = (order.items || []).map((item, index) => `<div class="inline-item-row" data-inline-item-row="${index}">
    <input type="hidden" data-inline-field="item_inventoryId" value="${safeText(item.inventoryId || '')}" />
    <div><label>Item</label><input data-inline-field="item_name" value="${safeText(item.name || '')}" /></div>
    <div><label>Qty</label><input type="number" min="0" step="1" data-inline-field="item_quantity" value="${Number(item.quantity || 0)}" /></div>
    <div><label>Unit</label><input type="number" min="0" step="0.01" data-inline-field="item_unitPrice" value="${Number(item.unitPrice || 0)}" /></div>
    <div><label>Charged Unit</label><input type="number" min="0" step="0.01" data-inline-field="item_chargedUnitPrice" value="${item.chargedUnitPrice === '' || item.chargedUnitPrice == null ? '' : safeText(item.chargedUnitPrice)}" placeholder="Default" /></div>
    <div><label>Subtotal</label><input type="number" min="0" step="0.01" data-inline-field="item_subtotal" value="${Number(item.subtotal || 0)}" /></div>
  </div>`).join('') || '<div class="empty-state">No items on this order.</div>';

  const nav = `<div class="order-editor-nav" role="tablist">
    <button type="button" class="order-editor-nav-btn active" data-inline-editor-tab="overview">Overview</button>
    <button type="button" class="order-editor-nav-btn" data-inline-editor-tab="schedule">Schedule</button>
    <button type="button" class="order-editor-nav-btn" data-inline-editor-tab="equipment">Equipment</button>
    <button type="button" class="order-editor-nav-btn" data-inline-editor-tab="money">Money</button>
    <button type="button" class="order-editor-nav-btn" data-inline-editor-tab="contact">Contact & Notes</button>
  </div>`;

  return `<div class="inline-order-editor sectioned-order-editor" data-inline-order="${order.id}">
    ${nav}
    <section class="order-editor-section active" data-inline-editor-panel="overview">
      <div class="order-editor-section-head"><div><strong>Order overview</strong><span>Customer, status, and fulfillment</span></div></div>
      <div class="form-row three"><div><label>First Name</label><input data-inline-field="firstName" value="${safeText(order.firstName || '')}" /></div><div><label>Last Name</label><input data-inline-field="lastName" value="${safeText(order.lastName || '')}" /></div><div><label>Event Name</label><input data-inline-field="eventName" value="${safeText(order.eventName || '')}" /></div></div>
      <div class="form-row three"><div><label>Status</label><select data-inline-field="status">${ORDER_STATUSES.map((status) => `<option ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></div><div><label>Payment</label><select data-inline-field="paymentStatus">${PAYMENT_STATUSES.map((status) => `<option ${status === order.paymentStatus ? 'selected' : ''}>${status}</option>`).join('')}</select></div><div><label>Pickup / Delivery</label><select data-inline-field="fulfillmentType"><option ${order.fulfillmentType === 'Pickup' ? 'selected' : ''}>Pickup</option><option ${order.fulfillmentType === 'Delivery' ? 'selected' : ''}>Delivery</option><option ${order.fulfillmentType === 'To Be Determined' ? 'selected' : ''}>To Be Determined</option></select></div></div>
      <div class="form-row two"><div><label>Assigned Employee</label><select data-inline-field="assignedEmployeeId"><option value="">Unassigned</option>${approvedEmployees().map((u) => `<option value="${safeText(u.uid || u.id)}" ${(u.uid || u.id) === order.assignedEmployeeId ? 'selected' : ''}>${safeText(employeeDisplayName(u))}</option>`).join('')}</select></div><div><label>Verbal Confirmation</label><label class="check-pill"><input type="checkbox" data-inline-field="verbalConfirmation" ${order.verbalConfirmation ? 'checked' : ''}/> Confirmed</label></div></div>
    </section>

    <section class="order-editor-section" data-inline-editor-panel="schedule">
      <div class="order-editor-section-head"><div><strong>Schedule</strong><span>Event, exchange, and return timing</span></div></div>
      <div class="form-row three"><div><label>Event Date</label><input type="date" data-inline-field="eventDate" value="${safeText(order.eventDate || '')}" /></div><div><label>Event Time</label><input type="time" data-inline-field="eventTime" value="${safeText(normalizeInlineTimeValue(order.eventTime || ''))}" /></div><div></div></div>
      <div class="form-row four"><div><label>Exchange Date</label><input type="date" data-inline-field="exchangeDate" value="${safeText(order.exchangeDate || '')}" /></div><div><label>Exchange Time</label><input type="time" data-inline-field="exchangeTime" value="${safeText(normalizeInlineTimeValue(order.exchangeTime || ''))}" /></div><div><label>Return Date</label><input type="date" data-inline-field="returnDate" value="${safeText(order.returnDate || '')}" /></div><div><label>Return Time</label><input type="time" data-inline-field="returnTime" value="${safeText(normalizeInlineTimeValue(order.returnTime || ''))}" /></div></div>
    </section>

    <section class="order-editor-section" data-inline-editor-panel="equipment">
      <div class="order-editor-section-head"><div><strong>Equipment</strong><span>Items already on this order</span></div></div>
      <div class="inline-item-list">${itemRows}</div>
    </section>

    <section class="order-editor-section" data-inline-editor-panel="money">
      <div class="order-editor-section-head"><div><strong>Money</strong><span>Fees, tip, totals, and payment progress</span></div></div>
      <div class="form-row three"><div><label>Delivery Fee</label><input type="number" step="0.01" data-inline-field="deliveryFee" value="${Number(order.deliveryFee || 0)}" /></div><div><label>Setup Fee</label><input type="number" step="0.01" data-inline-field="setupFee" value="${Number(order.setupFee || 0)}" /></div><div><label>Tip</label><input type="number" step="0.01" data-inline-field="tipAmount" value="${Number(order.tipAmount || 0)}" /></div></div>
      <div class="form-row two"><div><label>Adjusted Total</label><input type="number" step="0.01" data-inline-field="adjustedTotal" value="${order.adjustedTotal === '' || order.adjustedTotal == null ? '' : safeText(order.adjustedTotal)}" /></div><div><label>Total</label><input type="number" step="0.01" data-inline-field="total" value="${Number(getEffectiveOrderTotal(order) || 0)}" /></div></div>
      <div class="order-money-summary"><div><span>Paid</span><strong>${currency(getOrderAmountPaid(order))}</strong></div><div><span>Remaining</span><strong>${currency(getOrderAmountRemaining(order))}</strong></div></div>
    </section>

    <section class="order-editor-section" data-inline-editor-panel="contact">
      <div class="order-editor-section-head"><div><strong>Contact & notes</strong><span>Where and how to reach the customer</span></div></div>
      <div class="form-row two"><div><label>Delivery Address</label><input data-inline-field="address" value="${safeText(order.address || '')}" /></div><div><label>Contact Text</label><input data-inline-field="contact_text" value="${safeText(order.contactMethods?.text || '')}" /></div></div>
      <div class="form-row two"><div><label>Contact Email</label><input data-inline-field="contact_email" value="${safeText(order.contactMethods?.email || '')}" /></div><div></div></div>
      <div class="form-row"><div><label>Notes</label><textarea data-inline-field="notes">${safeText(order.notes || '')}</textarea></div></div>
    </section>
  </div>`;
}
async function saveInlineOrder(orderId) {
  const order = getOrderById(orderId);
  const wrap = document.querySelector(`[data-inline-order="${CSS.escape(orderId)}"]`);
  if (!order || !wrap) return;
  const get = (name) => wrap.querySelector(`[data-inline-field="${name}"]`);
  const next = JSON.parse(JSON.stringify(order));
  ['firstName','lastName','eventName','eventDate','eventTime','status','paymentStatus','fulfillmentType','exchangeDate','exchangeTime','returnDate','returnTime','address','notes'].forEach((key) => { const field = get(key); if (field) next[key] = field.value; });
  ['deliveryMiles','deliveryFee','setupFee','tipAmount'].forEach((key) => { const field = get(key); if (field) next[key] = Number(field.value || 0); });
  next.verbalConfirmation = Boolean(get('verbalConfirmation')?.checked);
  const adjusted = get('adjustedTotal')?.value;
  next.adjustedTotal = adjusted === '' || adjusted == null ? '' : Number(adjusted || 0);
  next.contactMethods = { ...(next.contactMethods || {}) };
  const phone = get('contact_text')?.value || '';
  const email = get('contact_email')?.value || '';
  if (phone) next.contactMethods.text = phone; else delete next.contactMethods.text;
  if (email) next.contactMethods.email = email; else delete next.contactMethods.email;
  next.items = [...wrap.querySelectorAll('[data-inline-item-row]')].map((row, index) => {
    const oldItem = next.items?.[index] || {};
    const qty = Number(row.querySelector('[data-inline-field="item_quantity"]')?.value || 0);
    const unitPrice = Number(row.querySelector('[data-inline-field="item_unitPrice"]')?.value || 0);
    const chargedRaw = row.querySelector('[data-inline-field="item_chargedUnitPrice"]')?.value;
    const subtotalRaw = row.querySelector('[data-inline-field="item_subtotal"]')?.value;
    const chargedUnitPrice = chargedRaw === '' || chargedRaw == null ? '' : Number(chargedRaw || 0);
    const effectiveUnitPrice = chargedUnitPrice === '' ? unitPrice : chargedUnitPrice;
    return { ...oldItem, inventoryId: row.querySelector('[data-inline-field="item_inventoryId"]')?.value || oldItem.inventoryId || '', name: row.querySelector('[data-inline-field="item_name"]')?.value || oldItem.name || '', quantity: qty, unitPrice, chargedUnitPrice, subtotal: qty * effectiveUnitPrice + Number(oldItem.accessorySubtotal || 0) };
  }).filter((item) => Number(item.quantity || 0) > 0);
  next.baseTotal = calculateOrderItemsSubtotal(next.items) + Number(next.deliveryFee || 0) + Number(next.setupFee || 0) + Number(next.tipAmount || 0);
  next.total = next.adjustedTotal !== '' ? next.adjustedTotal : next.baseTotal;
  next.listedTotal = next.items.reduce((sum, item) => sum + (Number(item.unitPrice || 0) * Number(item.quantity || 0)) + Number(item.accessorySubtotal || 0), 0) + Number(next.deliveryFee || 0) + Number(next.setupFee || 0) + Number(next.tipAmount || 0);
  next.updatedAt = new Date().toISOString();
  next.completedAt = next.status === 'Completed' ? (next.completedAt || new Date().toISOString()) : '';
  syncOrderPaymentAmounts(next);
  const savedChanges = collectOrderChanges(order, next);
  appendOrderUpdate(next, savedChanges);
  await withBusy(async () => {
    state.orders = state.orders.map((entry) => entry.id === orderId ? next : entry);
    await saveSingleOrder(next, order, { actor: 'admin-inline-edit' });
    renderOrders(); renderOrdersCalendar(); renderCalendarView(); renderDeliveryRoute(); renderNumbers();
    await copyLatestOrderUpdate(next, savedChanges);
  }, 'Saving inline changes…');
}
function summarizeOrderItems(items = []) {
  const parts = items.map((item) => `${item.quantity} ${item.name}`);
  return parts.join(', ') || 'No equipment selected';
}
function bindOrderCardActions() {
  if (!state.orderActionDelegatesBound) {
    state.orderActionDelegatesBound = true;
    document.addEventListener('click', (event) => {
      const highlightBtn = event.target.closest('[data-toggle-day-highlight]');
      if (highlightBtn) {
        event.preventDefault();
        const date = highlightBtn.dataset.toggleDayHighlight;
        state.highlightedOrderDates[date] = !state.highlightedOrderDates[date];
        renderOrders();
        return;
      }
      const clearInquiryBtn = event.target.closest('[data-clear-new-inquiry]');
      if (clearInquiryBtn) {
        event.preventDefault();
        event.stopPropagation();
        clearNewInquiryStatus(clearInquiryBtn.dataset.clearNewInquiry);
        return;
      }
      const expandBtn = event.target.closest('[data-expand-order]');
      if (expandBtn) {
        const orderId = expandBtn.dataset.expandOrder;
        const opening = state.expandedOrderId !== orderId;
        state.expandedOrderId = opening ? orderId : null;
        renderOrders();
        if (opening && state.orders.find((order) => order.id === orderId)?.newInquiry) clearNewInquiryStatus(orderId);
        return;
      }
      const inlineSaveBtn = event.target.closest('[data-save-inline-order]');
      if (inlineSaveBtn) {
        event.preventDefault();
        event.stopPropagation();
        saveInlineOrder(inlineSaveBtn.dataset.saveInlineOrder);
        return;
      }
      const menuBtn = event.target.closest('[data-menu-toggle]');
      if (menuBtn) {
        event.preventDefault();
        event.stopPropagation();
        const menu = document.getElementById(`menu_${menuBtn.dataset.menuToggle}`);
        document.querySelectorAll('.dot-dropdown').forEach((el) => { if (el !== menu) el.classList.add('hidden'); });
        menu?.classList.toggle('hidden');
        return;
      }
      const editBtn = event.target.closest('[data-edit-order]');
      if (editBtn) {
        event.preventDefault();
        event.stopPropagation();
        openOrderModal(editBtn.dataset.editOrder);
        return;
      }
      const deleteBtn = event.target.closest('[data-delete-order]');
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        deleteOrder(deleteBtn.dataset.deleteOrder);
        return;
      }
      const verbalToggle = event.target.closest('[data-verbal-toggle]');
      if (verbalToggle) {
        event.stopPropagation();
        updateOrderVerbalConfirmation(verbalToggle.dataset.verbalToggle, verbalToggle.checked);
        return;
      }
      const copyReminderBtn = event.target.closest('[data-copy-reminder]');
      if (copyReminderBtn) {
        event.preventDefault();
        copyReminderMessage(copyReminderBtn.dataset.copyReminder);
        return;
      }
      const textReminderBtn = event.target.closest('[data-text-reminder]');
      if (textReminderBtn) {
        event.preventDefault();
        openTextReminder(textReminderBtn.dataset.textReminder);
        return;
      }
      const copyReviewRequestBtn = event.target.closest('[data-copy-review-request]');
      if (copyReviewRequestBtn) {
        event.preventDefault();
        event.stopPropagation();
        copyReviewRequestMessage(copyReviewRequestBtn.dataset.copyReviewRequest);
        return;
      }
      const deleteReviewBtn = event.target.closest('[data-delete-review]');
      if (deleteReviewBtn) {
        event.preventDefault();
        event.stopPropagation();
        deleteAdminReview(deleteReviewBtn.dataset.deleteReview);
        return;
      }
      const earningsBtn = event.target.closest('[data-toggle-earnings-period]');
      if (earningsBtn) {
        event.preventDefault();
        state.expandedEarningsPeriod = state.expandedEarningsPeriod === earningsBtn.dataset.toggleEarningsPeriod ? '' : earningsBtn.dataset.toggleEarningsPeriod;
        renderEarnings();
        return;
      }
      const saveEmployeeTimesBtn = event.target.closest('[data-save-employee-times]');
      if (saveEmployeeTimesBtn) {
        event.preventDefault();
        const id = saveEmployeeTimesBtn.dataset.saveEmployeeTimes;
        const exchangeTime = document.querySelector(`[data-employee-exchange-time="${CSS.escape(id)}"]`)?.value || '';
        const returnTime = document.querySelector(`[data-employee-return-time="${CSS.escape(id)}"]`)?.value || '';
        handleEmployeeOrderProgress(id, { exchangeTime, returnTime });
        return;
      }
      const employeeStatusBtn = event.target.closest('[data-employee-order-status]');
      if (employeeStatusBtn) {
        event.preventDefault();
        handleEmployeeOrderProgress(employeeStatusBtn.dataset.employeeOrderStatus, { status: employeeStatusBtn.dataset.nextStatus });
        return;
      }
      const inlineEditorTab = event.target.closest('[data-inline-editor-tab]');
      if (inlineEditorTab) {
        event.preventDefault();
        event.stopPropagation();
        const editor = inlineEditorTab.closest('[data-inline-order]');
        const target = inlineEditorTab.dataset.inlineEditorTab;
        editor?.querySelectorAll('[data-inline-editor-tab]').forEach((btn) => btn.classList.toggle('active', btn === inlineEditorTab));
        editor?.querySelectorAll('[data-inline-editor-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.inlineEditorPanel === target));
        return;
      }
      const copyUpdateBtn = event.target.closest('[data-copy-update]');
      if (copyUpdateBtn) {
        event.preventDefault();
        copyUpdateMessage(copyUpdateBtn.dataset.copyUpdate);
        return;
      }
      const copyDeliveryBtn = event.target.closest('[data-copy-delivery-address]');
      if (copyDeliveryBtn) {
        event.preventDefault();
        copyDeliveryAddress(copyDeliveryBtn.dataset.copyDeliveryAddress);
        return;
      }
      if (!event.target.closest('.dot-menu')) {
        document.querySelectorAll('.dot-dropdown').forEach((el) => el.classList.add('hidden'));
      }
    });
  }
  document.querySelectorAll('[data-status-select]').forEach((select) => {
    select.onchange = () => updateOrderStatus(select.dataset.statusSelect, select.value);
  });
  document.querySelectorAll('[data-payment-select]').forEach((select) => {
    select.onchange = () => updateOrderPayment(select.dataset.paymentSelect, select.value);
  });
}
function getOrderById(id) {
  return state.orders.find((item) => item.id === id) || null;
}
function getReminderEquipmentText(order) {
  const items = (order.items || []).map((item) => {
    const qty = Number(item.quantity || 0);
    const chargedUnitPrice = getItemEffectiveUnitPrice(item);
    const accessories = (item.accessories || []).map((acc) => `${acc.name} (${currency(acc.price)} each)`).join(', ');
    const markdownText = chargedUnitPrice < Number(item.unitPrice || 0)
      ? ` — marked down from ${currency(item.unitPrice || 0)} each to ${currency(chargedUnitPrice)} each`
      : '';
    return `${item.name}${qty > 1 ? ` (x${qty})` : ''}${markdownText}${accessories ? ` + ${accessories}` : ''}`;
  });
  return items.join(', ') || 'Rental equipment';
}
function getReminderTimingText(order) {
  const target = parseDateTime(order.exchangeDate, order.exchangeTime);
  if (!target || Number.isNaN(target.getTime())) return 'soon';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const dayDiff = Math.round((eventDay - today) / 86400000);
  if (dayDiff === 0) return 'today';
  if (dayDiff === 1) return 'tomorrow';
  if (dayDiff > 1) return `in ${dayDiff} days`;
  if (dayDiff === -1) return 'yesterday';
  return `on ${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(target)}`;
}
function getOrderPickupAddress(order = {}) {
  return order.assignedEmployeePickupAddress || state.settings?.pickupAddress || 'the pickup location on file';
}
function getReminderLocationText(order) {
  if (order.fulfillmentType === 'Delivery') {
    return `delivered to ${order.address || order.addressSnapshot || 'the provided delivery address'}`;
  }
  return `picked up at ${getOrderPickupAddress(order)}`;
}
function getTextPhoneNumber(order) {
  const raw = order?.contactMethods?.text || '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  if (digits.length === 10) return `1${digits}`;
  return '';
}
function buildReminderMessage(order, options = {}) {
  const opts = {
    verbalConfirmation: Boolean(options.verbalConfirmation ?? order?.verbalConfirmation),
    depositWaived: Boolean(options.depositWaived ?? order?.depositWaived),
    equipmentStillDiscussing: Boolean(options.equipmentStillDiscussing ?? order?.equipmentStillDiscussing),
    friendlyIntro: Boolean(options.friendlyIntro),
    includeTracking: options.includeTracking !== false,
    includeEquipment: options.includeEquipment !== false,
    includeAddress: options.includeAddress !== false
  };
  const fullDateTime = formatDateTime(order.exchangeDate, order.exchangeTime || 'To Be Determined');
  const missing = [];
  if (!opts.verbalConfirmation) missing.push('verbal confirmation');
  const depositRequired = orderRequiresDeposit(order) && !opts.depositWaived ? getOrderDepositAmount(order) : 0;
  if (depositRequired && !['Deposit Paid', 'Deposit', 'Paid', 'Free'].includes(order.paymentStatus)) missing.push(`deposit payment of ${currency(depositRequired)}`);
  if (opts.equipmentStillDiscussing) missing.push('final equipment selection');
  const intro = opts.friendlyIntro
    ? `This is a friendly reminder of your upcoming rental for ${fullDateTime}.`
    : order.status === 'Confirmed'
    ? `Your upcoming rental order has been confirmed for ${fullDateTime}.`
    : `An order has been started for ${fullDateTime}. This order is pending until the following items are addressed: ${missing.length ? missing.join(', ') : 'none'}.`;
  const lines = [`Hello ${order?.firstName || ''}!`, '', intro];

  if (opts.includeAddress) {
    lines.push('');
    lines.push(order.fulfillmentType === 'Delivery'
      ? `Delivery Address: ${order.address || order.addressSnapshot || 'Not set'}`
      : `Pickup Address: ${getOrderPickupAddress(order)}`);
  }

  const totalBefore = getListedOrderTotal(order);
  const totalAfter = getEffectiveOrderTotal(order);
  const hasDiscounts = getOrderDiscountAmount(order) > 0.004;
  if (opts.includeEquipment) {
    lines.push('');
    (order.items || []).forEach((item) => {
      const qty = Number(item.quantity || 0);
      const inventoryMatch = state.inventory.find((entry) => entry.id === item.inventoryId);
      const originalUnitPrice = Number(inventoryMatch?.price ?? item.unitPrice ?? 0);
      const effectiveUnitPrice = Number(getItemEffectiveUnitPrice(item));
      const lineTotal = qty * effectiveUnitPrice + Number(item.accessorySubtotal || 0);
      let line = `${qty}x ${item.name}: ${currency(lineTotal)} (${currency(effectiveUnitPrice)} each)`;
      if (effectiveUnitPrice < originalUnitPrice) line += `, marked down from ${currency(originalUnitPrice)} each`;
      lines.push(line);
      (item.accessories || []).forEach((acc) => lines.push(`  + ${acc.name}: ${currency(Number(acc.price || 0) * qty)} (${currency(acc.price)} each)`));
    });
    if (Number(order.deliveryFee || 0) > 0) lines.push(`Delivery Fee: ${currency(order.deliveryFee)}`);
    if (Number(order.setupFee || 0) > 0) lines.push(`Set Up Fee: ${currency(order.setupFee)}`);
    if (Number(order.tipAmount || 0) > 0) lines.push(`Tip: ${currency(order.tipAmount)}`);
  }

  lines.push('');
  const totalLabel = hasDiscounts ? `${currency(totalBefore)} before discounts / ${currency(totalAfter)} after discounts` : currency(totalAfter);
  lines.push(`Total: ${totalLabel} | Payment Status: ${order.paymentStatus || 'Un-Paid'}`);
  if (depositRequired && !['Deposit Paid', 'Deposit', 'Paid', 'Free'].includes(order.paymentStatus)) lines.push(`Deposit Required: ${currency(depositRequired)}`);
  if (depositRequired && ['Deposit Paid', 'Deposit'].includes(order.paymentStatus)) lines.push(`Deposit Paid: ${currency(getOrderAmountPaid(order))}`);
  if (depositRequired && !opts.depositWaived) lines.push(`Remaining Balance: ${currency(getOrderAmountRemaining(order))}`);

  lines.push('');
  lines.push(`If anything has changed or you need to make adjustments, please let us know. Otherwise, we look forward to taking care of your order ${getReminderTimingText(order)}!`);
  if (opts.includeTracking && order?.trackingCode) {
    lines.push('');
    lines.push(`Track your order here! ${getTrackingLinkForOrder(order)} and use ${order.trackingAccessCode || 'your 4-digit code'} to access.`);
  }
  return lines.filter((line, index, arr) => !(line === '' && arr[index - 1] === '')).join('\n').trim();
}


async function copyTextWithFallback(message, promptTitle = 'Copy the text below:') {
  try {
    await navigator.clipboard.writeText(message);
    if (els.reminderCopiedStatus) {
      els.reminderCopiedStatus.textContent = 'Copied to clipboard';
      window.clearTimeout(state.reminderCopiedTimer);
      state.reminderCopiedTimer = window.setTimeout(() => {
        if (els.reminderCopiedStatus?.textContent === 'Copied to clipboard') els.reminderCopiedStatus.textContent = '';
      }, 1600);
    }
  } catch (error) {
    window.prompt(promptTitle, message);
  }
}
function setReminderComposerTab(tab = 'details') {
  state.reminderComposer = state.reminderComposer || {};
  state.reminderComposer.tab = tab;
  els.reminderTabButtons?.forEach((btn) => btn.className = `btn ${btn.dataset.reminderTab === tab ? 'btn-primary' : 'btn-ghost'} btn-small`);
  els.reminderPanels?.forEach((panel) => panel.classList.toggle('active', panel.dataset.reminderPanel === tab));
  renderReminderComposerPreview();
}
function getReminderComposerSelectedUpdateIndexes() {
  return [...(els.reminderUpdatesList?.querySelectorAll('[data-update-index]:checked') || [])].map((input) => ({
    updateIndex: Number(input.dataset.updateIndex),
    changeIndex: Number(input.dataset.updateChangeIndex)
  })).filter((value) => Number.isInteger(value.updateIndex));
}
function populateReminderComposerUpdates(order) {
  if (!els.reminderUpdatesList) return;
  const updates = Array.isArray(order?.updateHistory) ? order.updateHistory : [];
  if (!updates.length) {
    els.reminderUpdatesList.innerHTML = '<div class="empty-state">No updates yet.</div>';
    return;
  }
  els.reminderUpdatesList.innerHTML = updates.flatMap((entry, index) => {
    const stamp = entry?.timestamp ? new Date(entry.timestamp).toLocaleString() : `Update ${index + 1}`;
    const changes = Array.isArray(entry?.changes) && entry.changes.length ? entry.changes : ['Please check your latest order details.'];
    return changes.map((change, changeIndex) => `<label class="reminder-update-option"><div style="display:flex; gap:10px; align-items:flex-start; justify-content:space-between;"><div style="display:flex; gap:10px; align-items:flex-start; flex:1 1 auto;"><input type="checkbox" data-update-index="${index}" data-update-change-index="${changeIndex}" /><div><div><strong>${safeText(stamp)}</strong></div><div class="small muted">${safeText(change)}</div></div></div><button type="button" class="btn btn-ghost btn-small" data-delete-update-index="${index}" data-delete-update-change-index="${changeIndex}">Delete</button></div></label>`);
  }).join('');
}

async function handleReminderUpdatesListClick(event) {
  const deleteButton = event?.target?.closest?.('[data-delete-update-index]');
  if (!deleteButton) return;
  event.preventDefault();
  event.stopPropagation();
  const composer = state.reminderComposer;
  const order = composer ? getOrderById(composer.orderId) : null;
  if (!composer || !order || !Array.isArray(order.updateHistory)) return;
  const index = Number(deleteButton.dataset.deleteUpdateIndex);
  if (!Number.isInteger(index) || index < 0 || index >= order.updateHistory.length) return;
  const before = JSON.parse(JSON.stringify(order));
  const changeIndex = Number(deleteButton.dataset.deleteUpdateChangeIndex);
  if (Number.isInteger(changeIndex) && Array.isArray(order.updateHistory[index]?.changes)) {
    order.updateHistory[index].changes.splice(changeIndex, 1);
    if (!order.updateHistory[index].changes.length) order.updateHistory.splice(index, 1);
  } else {
    order.updateHistory.splice(index, 1);
  }
  order.updatedAt = new Date().toISOString();
  await saveOrderOnly(order, before, 'admin-update-delete');
  populateReminderComposerUpdates(order);
  renderOrders();
  await copyReminderComposerPreview(false);
}
async function openReminderComposer(id, tab = 'details') {
  const order = getOrderById(id);
  if (!order || !els.reminderModalWrap) return;
  if (!order.trackingAccessCode) {
    const before = JSON.parse(JSON.stringify(order));
    order.trackingAccessCode = generateTrackingAccessCode(new Set(state.orders.map((entry) => entry.trackingAccessCode).filter(Boolean)));
    order.updatedAt = new Date().toISOString();
    await saveOrderOnly(order, before, 'admin-tracking-access-code');
  }
  state.reminderComposer = {
    orderId: id,
    tab,
    verbalConfirmation: Boolean(order.verbalConfirmation),
    depositWaived: Boolean(order.depositWaived),
    equipmentStillDiscussing: Boolean(order.equipmentStillDiscussing),
    friendlyIntro: false,
    includeTracking: true,
    includeEquipment: true,
    includeAddress: true,
    olderCustomer: false
  };
  if (els.reminderModalTitle) els.reminderModalTitle.textContent = 'Notifications';
  if (els.reminderVerbalCheckbox) els.reminderVerbalCheckbox.checked = state.reminderComposer.verbalConfirmation;
  if (els.reminderDepositWaivedCheckbox) els.reminderDepositWaivedCheckbox.checked = state.reminderComposer.depositWaived;
  if (els.reminderEquipmentDiscussionCheckbox) els.reminderEquipmentDiscussionCheckbox.checked = state.reminderComposer.equipmentStillDiscussing;
  if (els.reminderFriendlyIntroCheckbox) els.reminderFriendlyIntroCheckbox.checked = false;
  if (els.reminderIncludeTrackingCheckbox) els.reminderIncludeTrackingCheckbox.checked = true;
  if (els.reminderIncludeEquipmentCheckbox) els.reminderIncludeEquipmentCheckbox.checked = true;
  if (els.reminderIncludeAddressCheckbox) els.reminderIncludeAddressCheckbox.checked = true;
  if (els.reviewOlderCustomerCheckbox) els.reviewOlderCustomerCheckbox.checked = false;
  populateReminderComposerUpdates(order);
  els.reminderModalWrap.classList.add('open');
  setReminderComposerTab(tab);
  copyReminderComposerPreview(false);
}
function closeReminderComposer() {
  state.reminderComposer = null;
  els.reminderModalWrap?.classList.remove('open');
  if (els.reminderCopiedStatus) els.reminderCopiedStatus.textContent = '';
}
async function handleReminderComposerFieldChange() {
  const composer = state.reminderComposer;
  const order = composer ? getOrderById(composer.orderId) : null;
  if (!composer || !order) return;
  const before = JSON.parse(JSON.stringify(order));
  composer.verbalConfirmation = Boolean(els.reminderVerbalCheckbox?.checked);
  composer.depositWaived = Boolean(els.reminderDepositWaivedCheckbox?.checked);
  composer.equipmentStillDiscussing = Boolean(els.reminderEquipmentDiscussionCheckbox?.checked);
  composer.friendlyIntro = Boolean(els.reminderFriendlyIntroCheckbox?.checked);
  composer.includeTracking = Boolean(els.reminderIncludeTrackingCheckbox?.checked);
  composer.includeEquipment = Boolean(els.reminderIncludeEquipmentCheckbox?.checked);
  composer.includeAddress = Boolean(els.reminderIncludeAddressCheckbox?.checked);
  composer.olderCustomer = Boolean(els.reviewOlderCustomerCheckbox?.checked);
  order.verbalConfirmation = composer.verbalConfirmation;
  order.depositWaived = composer.depositWaived;
  order.equipmentStillDiscussing = composer.equipmentStillDiscussing;
  order.updatedAt = new Date().toISOString();
  await saveOrderOnly(order, before, 'admin-reminder');
  await copyReminderComposerPreview(false);
}
function renderReminderComposerPreview() {
  const composer = state.reminderComposer;
  const order = composer ? getOrderById(composer.orderId) : null;
  if (!composer || !order || !els.reminderPreviewOutput) return '';
  const preview = composer.tab === 'updates'
    ? buildOrderUpdateMessage(order, getReminderComposerSelectedUpdateIndexes())
    : composer.tab === 'review'
    ? buildReviewRequestMessage(order, { olderCustomer: composer.olderCustomer })
    : buildReminderMessage(order, composer);
  els.reminderPreviewOutput.value = preview;
  return preview;
}
async function copyReminderComposerPreview(showStatus = true) {
  const preview = renderReminderComposerPreview();
  if (!preview) return;
  await copyTextWithFallback(preview, 'Copy your message below:');
  if (!showStatus && els.reminderCopiedStatus?.textContent === 'Copied to clipboard') {
    // keep subtle status only
  }
}

function getPickupAddressCopyOptions() {
  const pickupAddress = state.settings?.pickupAddress || 'the pickup address on file';
  const firstSentence = `Here is the pickup address! ${pickupAddress}.`;
  const lastSentence = 'The pick up location is a small parking lot just outside of my neighborhood';
  const employeeAddresses = approvedEmployees()
    .filter((user) => String(user.pickupAddress || '').trim())
    .map((user) => ({
      id: `employee-address-${user.uid || user.id}`,
      label: `${employeeDisplayName(user)} pickup address`,
      text: String(user.pickupAddress || '').trim()
    }));
  return [
    { id: 'pickup-short', label: 'Pickup intro + address', text: firstSentence },
    { id: 'pickup-full', label: 'Full pickup message', text: `${firstSentence} ${lastSentence}` },
    { id: 'pickup-address', label: 'Main address only', text: pickupAddress },
    ...employeeAddresses
  ];
}
function getCustomCopyPasteTemplates() {
  return Array.isArray(state.settings?.copyPasteTemplates) ? state.settings.copyPasteTemplates : [];
}
function renderCopyPasteMenu() {
  if (!els.copyPasteOptions) return;
  const defaults = getPickupAddressCopyOptions();
  const customs = getCustomCopyPasteTemplates();
  els.copyPasteOptions.innerHTML = `
    <div class="copy-paste-group"><div class="eyebrow">Pickup Address</div>${defaults.map((item) => `<button type="button" class="copy-paste-option" data-copy-paste-default="${safeText(item.id)}"><strong>${safeText(item.label)}</strong><span>${safeText(item.text)}</span></button>`).join('')}</div>
    <div class="copy-paste-group"><div class="eyebrow">Custom Copy Paste</div>${customs.map((item) => `<div class="copy-paste-custom-row"><button type="button" class="copy-paste-option" data-copy-paste-custom="${safeText(item.id)}"><strong>${safeText(item.label || 'Untitled')}</strong><span>${safeText(item.text || '')}</span></button><button type="button" class="btn btn-ghost btn-small" data-edit-copy-paste="${safeText(item.id)}">Edit</button><button type="button" class="btn btn-ghost btn-small" data-delete-copy-paste="${safeText(item.id)}">Delete</button></div>`).join('') || '<div class="small muted">No custom buttons yet.</div>'}</div>`;
}
function openCopyPasteMenu() { renderCopyPasteMenu(); els.copyPasteModalWrap?.classList.add('open'); }
function closeCopyPasteMenu() { els.copyPasteModalWrap?.classList.remove('open'); }
async function persistCopyPasteTemplates(templates) {
  state.settings = { ...state.settings, copyPasteTemplates: templates };
  await saveSettings(state.settings);
  renderCopyPasteMenu();
}
async function addCustomCopyPasteTemplate(existingId = '') {
  const existing = getCustomCopyPasteTemplates().find((item) => item.id === existingId);
  const label = window.prompt('Button name:', existing?.label || '');
  if (label == null || !label.trim()) return;
  const text = window.prompt('Text to copy:', existing?.text || '');
  if (text == null) return;
  const templates = getCustomCopyPasteTemplates().slice();
  if (existing) Object.assign(existing, { label: label.trim(), text, updatedAt: new Date().toISOString() });
  const next = existing ? templates.map((item) => item.id === existing.id ? existing : item) : [...templates, { id: uid('copy'), label: label.trim(), text, createdAt: new Date().toISOString() }];
  await persistCopyPasteTemplates(next);
}
async function handleCopyPasteOptionClick(event) {
  const defaultBtn = event.target.closest('[data-copy-paste-default]');
  const customBtn = event.target.closest('[data-copy-paste-custom]');
  const editBtn = event.target.closest('[data-edit-copy-paste]');
  const deleteBtn = event.target.closest('[data-delete-copy-paste]');
  if (editBtn) return addCustomCopyPasteTemplate(editBtn.dataset.editCopyPaste);
  if (deleteBtn) {
    if (!window.confirm('Delete this custom copy paste button?')) return;
    return persistCopyPasteTemplates(getCustomCopyPasteTemplates().filter((item) => item.id !== deleteBtn.dataset.deleteCopyPaste));
  }
  let text = '';
  if (defaultBtn) text = getPickupAddressCopyOptions().find((item) => item.id === defaultBtn.dataset.copyPasteDefault)?.text || '';
  if (customBtn) text = getCustomCopyPasteTemplates().find((item) => item.id === customBtn.dataset.copyPasteCustom)?.text || '';
  if (!text) return;
  await copyTextWithFallback(text, 'Copy the text below:');
}

function copyReminderMessage(id) {
  openReminderComposer(id, 'details');
}
function copyUpdateMessage(id) {
  openReminderComposer(id, 'updates');
}
function buildReviewRequestMessage(order = {}, options = {}) {
  const name = (order.firstName || '').trim() || 'there';
  if (options.olderCustomer) {
    return `Hi ${name}! We recently added a review section to our order tickets. I know your rental order was a while ago, but if you have a moment, I would really appreciate it if you would leave a quick review about your experience with Rent Some - Event Rentals: ${getTrackingLinkForOrder(order)}`;
  }
  return `Thank you for choosing Rent Some - Event Rentals, ${name}! We would love to hear back about your experience. Please consider leaving a review, which is now available on your order ticket: ${getTrackingLinkForOrder(order)}`;
}
async function copyReviewRequestMessage(id) {
  const order = getOrderById(id);
  if (!order) return;
  await copyTextWithFallback(buildReviewRequestMessage(order), 'Copy your review request below:');
  alert('Review request copied.');
}
async function deleteAdminReview(trackingCode) {
  const code = String(trackingCode || '').trim();
  if (!code) return;
  if (!window.confirm('Delete this review?')) return;
  await withBusy(async () => {
    await deletePublicReview(code);
    state.reviews = await getPublicReviews().catch(() => []);
    renderAdminReviews();
  }, 'Deleting review…');
}
function renderAdminReviews() {
  if (!els.reviewsList) return;
  const reviews = Array.isArray(state.reviews) ? state.reviews : [];
  if (!reviews.length) {
    els.reviewsList.innerHTML = '<div class="empty-state">No reviews yet.</div>';
    return;
  }
  els.reviewsList.innerHTML = reviews.map((review) => {
    const code = review.trackingCode || review.id || '';
    const stamp = review.createdAt ? new Date(review.createdAt).toLocaleString() : '';
    return `<div class="review-admin-card">
      <div class="section-header"><div><strong>${safeText(review.name || review.orderName || 'Customer')}</strong><div class="small muted">${safeText(stamp)} · ${safeText(code)}</div></div><div><span class="badge badge-yellow">${safeText(review.rating || 5)}★</span></div></div>
      <div class="small" style="white-space:pre-wrap;">${safeText(review.message || '')}</div>
      <div style="display:flex; justify-content:flex-end; margin-top:10px;"><button class="btn btn-ghost btn-small" type="button" data-delete-review="${safeText(code)}">Delete Review</button></div>
    </div>`;
  }).join('');
}
async function copyDeliveryAddress(id) {
  const order = getOrderById(id);
  if (!order?.address) return;
  try {
    await navigator.clipboard.writeText(order.address);
    alert('Delivery address copied to clipboard.');
  } catch (error) {
    window.prompt('Copy the delivery address below:', order.address);
  }
}
function openTextReminder(id) {
  const order = getOrderById(id);
  if (!order) return;
  const phone = getTextPhoneNumber(order);
  if (!phone) {
    alert('This order does not have a text phone number saved yet.');
    return;
  }
  const message = buildReminderMessage(order);
  const url = `sms:${phone}?&body=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}
async function clearNewInquiryStatus(id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order || !order.newInquiry) return;
  const before = JSON.parse(JSON.stringify(order));
  order.newInquiry = false;
  order.updatedAt = new Date().toISOString();
  try {
    await saveOrderOnly(order, before, 'admin-inquiry-seen');
    renderOrders();
    updateNewInquiryBadge();
  } catch (error) {
    Object.assign(order, before);
    console.error('Unable to clear new inquiry status:', error);
    alert('The new inquiry status could not be updated. Please try again.');
  }
}
async function updateOrderStatus(id, status) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;
  const before = JSON.parse(JSON.stringify(order));
  order.status = status;
  order.newInquiry = false;
  order.updatedAt = new Date().toISOString();
  if (status === 'Completed' && !order.completedAt) order.completedAt = new Date().toISOString();
  if (status !== 'Completed') order.completedAt = '';
  const isFreeOrder = Boolean(order.free) || String(order.paymentStatus || '').toLowerCase() === 'free' || Number(getEffectiveOrderTotal(order) || 0) === 0;
  if (status === 'Completed' && !isFreeOrder) {
    order.paymentStatus = 'Paid';
    order.amountPaid = roundMoney(getEffectiveOrderTotal(order));
    order.depositPaidAmount = roundMoney(getEffectiveOrderTotal(order));
  }
  const savedChanges = collectOrderChanges(before, order);
  appendOrderUpdate(order, savedChanges);
  await saveOrderOnly(order, before, 'admin-status');
  await copyLatestOrderUpdate(order, savedChanges);
  await syncCompletedOrderIncome(order).catch((error) => console.error('Financial income sync failed:', error));
}
async function updateOrderPayment(id, paymentStatus) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;
  const before = JSON.parse(JSON.stringify(order));
  if (paymentStatus === 'Deposit Paid') {
    const currentDeposit = getOrderDepositAmount(order);
    const existingPaid = Number(order.depositPaidAmount || order.amountPaid || 0);
    const suggested = existingPaid > 0 ? existingPaid : currentDeposit;
    const confirmed = await confirmDepositPaidAmount(order, suggested, currentDeposit);
    if (!confirmed) return;
    order.depositPaidAmount = roundMoney(confirmed.amount);
    order.amountPaid = roundMoney(confirmed.amount);
  }
  order.paymentStatus = paymentStatus;
  syncOrderPaymentAmounts(order);
  order.updatedAt = new Date().toISOString();
  const savedChanges = collectOrderChanges(before, order);
  appendOrderUpdate(order, savedChanges);
  await saveOrderOnly(order, before, 'admin-payment');
  await copyLatestOrderUpdate(order, savedChanges);
}
function confirmDepositPaidAmount(order = {}, suggested = 0, currentDeposit = 0) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop open';
    modal.innerHTML = `<div class="modal deposit-confirm-modal"><div class="section-header"><h2 style="margin:0;">Confirm Deposit Paid</h2></div>
      <p class="small muted">This locks the amount the customer actually paid. If the order total changes later, the remaining deposit/balance will adjust against this paid amount.</p>
      <div class="numbers-summary-grid"><div class="numbers-metric"><div class="metric-label">Current 35% Deposit</div><div class="metric-value">${currency(currentDeposit)}</div></div><div class="numbers-metric"><div class="metric-label">Order Total</div><div class="metric-value">${currency(getEffectiveOrderTotal(order))}</div></div></div>
      <label class="form-row"><span>Amount customer paid</span><input type="number" step="0.01" min="0" data-deposit-confirm-input value="${Number(suggested || 0).toFixed(2)}" /></label>
      <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:14px;"><button type="button" class="btn btn-ghost" data-deposit-cancel>Cancel</button><button type="button" class="btn btn-primary" data-deposit-save>Confirm Paid</button></div></div>`;
    document.body.appendChild(modal);
    const finish = (value) => { modal.remove(); resolve(value); };
    modal.querySelector('[data-deposit-cancel]').addEventListener('click', () => finish(null));
    modal.addEventListener('click', (event) => { if (event.target === modal) finish(null); });
    modal.querySelector('[data-deposit-save]').addEventListener('click', () => {
      const amount = Number(modal.querySelector('[data-deposit-confirm-input]')?.value || 0);
      finish({ amount: Number.isFinite(amount) ? amount : 0 });
    });
  });
}
async function updateOrderVerbalConfirmation(id, verbalConfirmation) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;
  const before = JSON.parse(JSON.stringify(order));
  order.verbalConfirmation = Boolean(verbalConfirmation);
  order.updatedAt = new Date().toISOString();
  const savedChanges = collectOrderChanges(before, order);
  appendOrderUpdate(order, savedChanges);
  await saveOrderOnly(order, before, 'admin-verbal-confirmation');
  await copyLatestOrderUpdate(order, savedChanges);
}
async function deleteOrder(id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;
  if (!window.confirm(`Delete order for ${`${order.firstName || ''} ${order.lastName || ''}`.trim() || 'this order'}?`)) return;
  state.orders = state.orders.filter((item) => item.id !== id);
  if (state.expandedOrderId === id) state.expandedOrderId = null;
  await withBusy(async () => {
    await deleteSingleOrder(order, { actor: 'admin-delete' });
    renderOrders();
    renderCalendarView();
    renderDeliveryRoute();
    renderAdminReviews();
    renderNumbers();
  }, 'Deleting order…');
}
function renderInventory() {
  const html = state.inventory.map((item) => {
    const stats = inventoryAvailabilityStats(item.id);
    const expanded = Boolean(state.expandedInventoryIds?.[item.id]);
    const accessories = normalizeAccessories(item.accessories);
    return `
      <div class="inventory-card gallery-style-inventory${expanded ? ' expanded' : ''}">
        <button type="button" class="inventory-gallery-toggle" data-toggle-inventory="${safeText(item.id)}" aria-expanded="${expanded ? 'true' : 'false'}">
          <div class="gallery-image-wrap inventory-gallery-image-wrap" style="${inventoryBackgroundCss()}">
            ${getInventoryImageSrc(item) ? `<img class="gallery-image inventory-transparent-image" style="${inventoryImageCss()}" src="${getInventoryImageSrc(item)}" alt="${safeText(item.name)}" />` : `<div class="inventory-image-placeholder">No Image</div>`}
          </div>
          <div class="gallery-card-body inventory-gallery-body">
            <div class="gallery-card-top inventory-collapsed-title">
              <h3>${safeText(item.name)}</h3>
            </div>
          </div>
        </button>
        <div class="inventory-expanded-details" ${expanded ? '' : 'hidden'}>
          <div class="small muted">${safeText(item.description || 'No description yet.')}</div>
          <div class="small kv">
            <div class="kv-row"><span>Category</span><strong>${safeText(item.category || 'Other')}</strong></div>
            <div class="kv-row"><span>Price</span><strong>${currency(item.price)}</strong></div>
            <div class="kv-row"><span>Total stock</span><strong>${Number(item.stock || 0)}</strong></div>
            <div class="kv-row"><span>Accessories</span><strong>${accessories.length || 0}</strong></div>
            <div class="kv-row"><span>Out right now</span><strong>${stats.outNow}</strong></div>
            <div class="kv-row"><span>Available right now</span><strong>${stats.availableNow}</strong></div>
            <div class="kv-row"><span>Pending today</span><strong>${stats.pendingToday}</strong></div>
            <div class="kv-row"><span>Avg cleaning</span><strong>${secondsToHms(inventoryTimeSeconds(item, 'Cleaning'))} / unit</strong></div>
            <div class="kv-row"><span>Avg loading</span><strong>${secondsToHms(inventoryTimeSeconds(item, 'Loading'))} / unit</strong></div>
            <div class="kv-row"><span>Avg unloading</span><strong>${secondsToHms(inventoryTimeSeconds(item, 'Unloading'))} / unit</strong></div>
          </div>
          ${accessories.length ? `<div class="inventory-accessory-list">${accessories.map((acc) => `<span class="badge badge-light">${safeText(acc.name)} · charge ${currency(acc.price)}${getAccessoryCostTotal(acc) ? ` · spent ${currency(getAccessoryCostTotal(acc))}` : ''}</span>`).join('')}</div>` : ''}
          <div class="button-row inventory-action-row">
            <button class="btn btn-primary btn-small" data-add-accessory-cost="${safeText(item.id)}">+ Accessory Cost</button>
            <button class="btn btn-secondary btn-small" data-edit-inventory="${safeText(item.id)}">Edit</button>
            <button class="btn btn-ghost btn-small" data-delete-inventory="${safeText(item.id)}">Delete</button>
          </div>
        </div>
      </div>`;
  }).join('');
  els.inventoryList.innerHTML = html || '<div class="empty-state">No inventory added yet.</div>';
  const categories = getCategories();
  els.inventoryStats.innerHTML = `<span class="badge badge-blue">${state.inventory.length} items</span> <span class="badge badge-green">${categories.length} categories</span>`;
  document.querySelectorAll('[data-toggle-inventory]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.toggleInventory;
    const wasExpanded = Boolean(state.expandedInventoryIds?.[id]);
    state.expandedInventoryIds = wasExpanded ? {} : { [id]: true };
    renderInventory();
  }));
  document.querySelectorAll('[data-add-accessory-cost]').forEach((btn) => btn.addEventListener('click', (event) => { event.stopPropagation(); openAccessoryCostModal(btn.dataset.addAccessoryCost); }));
  document.querySelectorAll('[data-edit-inventory]').forEach((btn) => btn.addEventListener('click', (event) => { event.stopPropagation(); openInventoryModal(btn.dataset.editInventory); }));
  document.querySelectorAll('[data-delete-inventory]').forEach((btn) => btn.addEventListener('click', (event) => { event.stopPropagation(); deleteInventory(btn.dataset.deleteInventory); }));
}

function openAccessoryCostModal(inventoryId) {
  const item = (state.inventory || []).find((entry) => entry.id === inventoryId);
  if (!item) return;
  let modal = document.getElementById('accessoryCostModalWrap');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'accessoryCostModalWrap';
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }
  const accessories = normalizeAccessories(item.accessories || []);
  modal.innerHTML = `<div class="modal cost-modal"><div class="modal-header"><h3>Add Accessory Cost</h3><button type="button" class="icon-btn" data-close-accessory-cost-modal>×</button></div>
    <div class="small muted" style="margin-bottom:10px;">${safeText(item.name)} — add a new accessory and log what you spent on it.</div>
    <div class="cost-modal-grid">
      <label class="cost-modal-wide"><span>Accessory name</span><input id="accessoryCostName" list="accessoryCostExisting" placeholder="Black Fitted Table Clothes" /></label>
      <datalist id="accessoryCostExisting">${accessories.map((acc) => `<option value="${safeText(acc.name)}"></option>`).join('')}</datalist>
      <label><span>Customer price each</span><input id="accessoryCustomerPrice" type="number" min="0" step="0.01" placeholder="0.00" /></label>
      <label><span>Purchase quantity</span><input id="accessoryCostQty" type="number" min="0" step="1" value="1" /></label>
      <label><span>Cost each</span><input id="accessoryCostEach" type="number" min="0" step="0.01" placeholder="0.00" /></label>
      <div class="cost-modal-total"><span>Total spent</span><strong>$0.00</strong></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close-accessory-cost-modal>Cancel</button><button type="button" class="btn btn-primary" data-save-accessory-cost-modal>Save Accessory Cost</button></div></div>`;
  modal.classList.add('open');
  const nameInput = modal.querySelector('#accessoryCostName');
  const priceInput = modal.querySelector('#accessoryCustomerPrice');
  const qtyInput = modal.querySelector('#accessoryCostQty');
  const eachInput = modal.querySelector('#accessoryCostEach');
  const recalc = () => {
    const total = Number(qtyInput?.value || 0) * Number(eachInput?.value || 0);
    const totalEl = modal.querySelector('.cost-modal-total strong');
    if (totalEl) totalEl.textContent = currency(total);
  };
  const fillExisting = () => {
    const match = accessories.find((acc) => acc.name.toLowerCase() === String(nameInput?.value || '').trim().toLowerCase());
    if (!match) return;
    if (priceInput && !priceInput.value) priceInput.value = Number(match.price || 0);
    if (qtyInput && !qtyInput.value && match.costQuantity !== '') qtyInput.value = Number(match.costQuantity || 0);
    if (eachInput && !eachInput.value && match.costEach !== '') eachInput.value = Number(match.costEach || 0);
    recalc();
  };
  [qtyInput, eachInput].forEach((input) => input?.addEventListener('input', recalc));
  nameInput?.addEventListener('change', fillExisting);
  modal.querySelectorAll('[data-close-accessory-cost-modal]').forEach((btn) => btn.onclick = () => modal.classList.remove('open'));
  modal.querySelector('[data-save-accessory-cost-modal]').onclick = async () => {
    const name = String(nameInput?.value || '').trim();
    if (!name) { alert('Add an accessory name first.'); return; }
    const qty = Number(qtyInput?.value || 0);
    const costEach = Number(eachInput?.value || 0);
    const total = qty * costEach;
    const now = new Date().toISOString();
    let accessory = accessories.find((acc) => acc.name.toLowerCase() === name.toLowerCase());
    if (accessory) {
      accessory = { ...accessory, price: Number(priceInput?.value || accessory.price || 0), costQuantity: qty, costEach, costTotal: total };
    } else {
      accessory = { id: uid('acc'), name, price: Number(priceInput?.value || 0), costQuantity: qty, costEach, costTotal: total, imageData: '' };
    }
    const nextAccessories = accessories.some((acc) => acc.id === accessory.id) ? accessories.map((acc) => acc.id === accessory.id ? accessory : acc) : [...accessories, accessory];
    state.inventory = (state.inventory || []).map((entry) => entry.id === inventoryId ? { ...entry, accessories: nextAccessories, updatedAt: now } : entry);
    if (total > 0) {
      const cost = normalizeCostRecord({
        id: uid('cost'),
        category: 'Inventory',
        type: 'One-Time',
        inventoryId,
        accessoryId: accessory.id,
        name,
        quantity: qty,
        price: costEach,
        createdAt: now,
        updatedAt: now
      });
      state.costs = [cost, ...(state.costs || [])];
    }
    await withBusy(async () => {
      const changedInventory = state.inventory.find((entry) => entry.id === inventoryId);
      if (changedInventory) await saveSingleInventoryItem(changedInventory);
      if (total > 0) state.costs = await saveCostRecords(collectCostsFromTable());
      modal.classList.remove('open');
      renderInventory();
      renderNumbers();
    }, 'Saving accessory cost…');
  };
  recalc();
}

function normalizeOrderStatus(status = '') {
  return String(status || '').trim().toLowerCase().replace(/[\s_-]+/g, '-');
}
function statusMatchesOrder(order = {}, statuses = []) {
  const wanted = new Set((statuses || []).map(normalizeOrderStatus));
  return wanted.has(normalizeOrderStatus(order.status));
}
function orderItemMatchesInventory(item = {}, inventoryId) {
  return String(item.inventoryId || item.id || '') === String(inventoryId || '');
}
function orderQuantityForInventory(order = {}, inventoryId) {
  return (order.items || [])
    .filter((item) => orderItemMatchesInventory(item, inventoryId))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}
function orderDateRange(order = {}) {
  const startDate = order.exchangeDate || order.eventDate || order.date || '';
  const endDate = order.returnDate || order.eventDate || order.exchangeDate || startDate;
  return { startDate, endDate };
}
function dateRangeOverlaps(startDate, endDate, otherStartDate, otherEndDate) {
  if (!startDate || !endDate || !otherStartDate || !otherEndDate) return false;
  const start = parseDateTime(startDate, '00:00');
  const end = parseDateTime(endDate, '23:59');
  const otherStart = parseDateTime(otherStartDate, '00:00');
  const otherEnd = parseDateTime(otherEndDate, '23:59');
  if (!start || !end || !otherStart || !otherEnd) return false;
  return start <= otherEnd && end >= otherStart;
}
function quantityBookedForQuickPeekRange(inventoryId, rangeStartDate, rangeEndDate, statuses, locationId = 'company') {
  return state.orders
    .filter((order) => locationId === 'company' || orderLocationId(order) === locationId)
    .filter((order) => statusMatchesOrder(order, statuses))
    .reduce((sum, order) => {
      const qty = orderQuantityForInventory(order, inventoryId);
      if (!qty) return sum;
      const orderRange = orderDateRange(order);
      if (!dateRangeOverlaps(rangeStartDate, rangeEndDate, orderRange.startDate, orderRange.endDate)) return sum;
      return sum + qty;
    }, 0);
}
function ordersAffectingInventoryForQuickPeek(inventoryId, rangeStartDate, rangeEndDate, statuses) {
  return state.orders.filter((order) => {
    if (!statusMatchesOrder(order, statuses)) return false;
    if (!orderQuantityForInventory(order, inventoryId)) return false;
    const orderRange = orderDateRange(order);
    return dateRangeOverlaps(rangeStartDate, rangeEndDate, orderRange.startDate, orderRange.endDate);
  });
}
function quantityBookedForRange(inventoryId, startDate, startTime, endDate, endTime, statuses) {
  const start = parseDateTime(startDate, startTime);
  const end = parseDateTime(endDate, endTime);
  if (!start || !end || end <= start) return 0;
  return state.orders
    .filter((order) => statusMatchesOrder(order, statuses))
    .reduce((sum, order) => {
      const orderStart = parseDateTime(order.exchangeDate || order.eventDate || order.date, order.exchangeTime || '00:00');
      const orderEnd = parseDateTime(order.returnDate || order.eventDate || order.exchangeDate || order.date, order.returnTime || '23:59');
      if (!overlaps(start, end, orderStart, orderEnd)) return sum;
      return sum + orderQuantityForInventory(order, inventoryId);
    }, 0);
}

function inventoryAvailabilityStats(inventoryId) {
  const now = new Date();
  let outNow = 0;
  let pendingToday = 0;
  for (const order of state.orders) {
    const start = parseDateTime(order.exchangeDate, order.exchangeTime);
    const end = parseDateTime(order.returnDate, order.returnTime);
    const qty = order.items.filter((item) => item.inventoryId === inventoryId).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    if (!qty) continue;
    if ((order.status === 'Confirmed' || order.status === 'In-Progress') && overlaps(start, end, now, new Date(now.getTime() + 1))) outNow += qty;
    if (order.status === 'Pending' && order.exchangeDate <= addDays(new Date().toISOString().slice(0, 10), 0) && order.returnDate >= new Date().toISOString().slice(0, 10)) pendingToday += qty;
  }
  const item = state.inventory.find((entry) => entry.id === inventoryId);
  return {
    outNow,
    availableNow: Math.max(0, Number(item?.stock || 0) - outNow),
    pendingToday
  };
}
async function deleteInventory(id) {
  const item = state.inventory.find((entry) => entry.id === id);
  if (!item) return;
  if (!window.confirm(`Delete inventory item ${item.name}?`)) return;
  state.inventory = state.inventory.filter((entry) => entry.id !== id);
  await withBusy(async () => {
    await deleteSingleInventoryItem(id);
    renderInventory();
    renderCalendarView();
    renderNumbers();
  }, 'Deleting inventory item…');
}
function renderSettings() {
  const settings = state.settings;
  ['businessName', 'pickupName', 'pickupAddress', 'deliveryRatePerMile', 'depositMinimumOrder', 'notificationEmail', 'notificationFromName', 'emailjsPublicKey', 'emailjsServiceId', 'emailjsTemplateId', 'googleMapsApiKey'].forEach((field) => {
    const input = els.settingsForm.elements[field];
    if (input) input.value = settings[field] ?? '';
  });
  const emailToggle = els.settingsForm.elements.emailNotificationsEnabled;
  if (emailToggle) emailToggle.checked = Boolean(settings.emailNotificationsEnabled);
  if (els.pickupLookupStatus) {
    const coords = settings.pickupCoords;
    els.pickupLookupStatus.textContent = coords?.lat != null && coords?.lon != null
      ? `Saved pickup coordinates: ${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)}`
      : 'Save a valid pickup address to store coordinates for delivery quotes.';
  }
  renderPaymentOptionsSettings();
  if (els.paymentOptionsBox && !document.getElementById('paymentOptionsHelp')) {
    els.paymentOptionsBox.insertAdjacentHTML('beforebegin', '<div id="paymentOptionsHelp" class="note-block small">Venmo, Cash App, and PayPal work best with your handle or direct link. Zelle, Google Pay, Invoice, and Crypto can use a link if you have one, or the button will copy the email, phone, wallet, or instructions you enter.</div>');
  }
  updateQuickPeekProgressiveFields();
  ["Hero", "Quote", "Browse", "Track"].forEach((kind) => {
    const key = "home" + kind + "ImageData";
    setHomeImageData(kind, settings[key] || "");
  });
}
function renderReminderEditor() {}
async function handleReminderSettingsSave(event) { if (event) event.preventDefault(); }
function insertTemplateToken(token) {}
function renderCalendarView() {
  if (!els.calendarAvailabilityBoard) return;
  updateQuickPeekProgressiveFields();
  const date = getCalendarSelectedDate();
  if (!state.quickPeekEventChosen || !date) {
    if (els.calendarDateLabel) els.calendarDateLabel.textContent = '';
    els.calendarAvailabilityBoard.innerHTML = '<div class="empty-state">Choose the event date first. Exchange date, return date, location, orders, equipment, and schedule availability will appear next.</div>';
    return;
  }
  syncQuickPeekDatesFromEvent(false);
  const { eventDate, exchangeDate, returnDate } = getQuickPeekRange();
  const rangeEndExclusive = addDays(returnDate, 1);
  if (els.calendarDateLabel) els.calendarDateLabel.textContent = `${formatFriendlyDate(eventDate)} · out ${formatFriendlyShortDate(exchangeDate)} through ${formatFriendlyShortDate(returnDate)}`;

  populateQuickPeekLocationSelect();
  const selectedLocationId = state.quickPeekLocationId || 'company';
  const ordersInRange = state.orders
    .filter((order) => selectedLocationId === 'company' || orderLocationId(order) === selectedLocationId)
    .filter((order) => statusMatchesOrder(order, ['Pending', 'Confirmed', 'In-Progress']))
    .filter((order) => {
      const orderStartDate = order.exchangeDate || order.eventDate || order.date;
      const orderEndDate = order.returnDate || order.eventDate || order.exchangeDate || order.date;
      return dateRangeOverlaps(exchangeDate, returnDate, orderStartDate, orderEndDate);
    })
    .sort((a, b) => {
      const aDate = `${a.exchangeDate || a.eventDate || ''} ${a.exchangeTime || ''}`;
      const bDate = `${b.exchangeDate || b.eventDate || ''} ${b.exchangeTime || ''}`;
      return aDate.localeCompare(bDate);
    });

  const ordersHtml = ordersInRange.length
    ? `<div class="calendar-category-card quick-peek-orders-card">
        <div class="section-header" style="margin-bottom:10px;"><div><strong>Orders in this window</strong><div class="small muted">Pending, confirmed, and in-progress orders whose exchange-to-return dates touch this range.</div></div></div>
        <div class="calendar-stock-list">
          ${ordersInRange.map((order) => {
            const name = `${order.firstName || ''} ${order.lastName || ''}`.trim() || 'Unnamed order';
            const items = summarizeOrderItems(order.items || []);
            const statusClass = order.status === 'Pending' ? 'yellow' : order.status === 'Confirmed' ? 'blue' : 'green';
            const timeRaw = order.status === 'In-Progress' ? order.returnTime : order.exchangeTime;
            const time = /^\d{2}:\d{2}$/.test(String(timeRaw || '').trim())
              ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(`2000-01-01T${timeRaw}:00`))
              : '??:??';
            return `<div class="calendar-stock-row quick-peek-order-row">
              <div><strong>${safeText(time)} ${safeText(name)}</strong><div class="small muted">${safeText(items)}</div></div>
              <div class="calendar-stock-metrics"><span class="badge badge-${statusClass}">${safeText(order.status)}</span></div>
            </div>`;
          }).join('')}
        </div>
      </div>`
    : `<div class="calendar-category-card quick-peek-orders-card"><div class="empty-state">No pending, confirmed, or in-progress orders in this window.</div></div>`;

  const scheduleHtml = buildQuickPeekScheduleHtml(eventDate, selectedLocationId);
  if (!state.inventory.length) {
    els.calendarAvailabilityBoard.innerHTML = `${scheduleHtml}<div class="quick-peek-split"><div>${ordersHtml}</div><div><div class="empty-state">No inventory yet.</div></div></div>`;
    return;
  }
  const rankedInventory = (state.inventory || [])
    .map((item) => ({ item, usage: inventoryRentalUsage(item.id) }))
    .sort((a,b) => b.usage.score - a.usage.score || (a.item.name || '').localeCompare(b.item.name || ''));

  const inventoryHtml = `<div class="calendar-category-card quick-peek-gallery-category">
    <div class="section-header" style="margin-bottom:10px;"><div><strong>Equipment availability</strong><div class="small muted">Most-rented equipment appears first.</div></div></div>
    <div class="quick-peek-inventory-grid compact">
      ${rankedInventory.map(({item, usage}) => {
        const confirmed = quantityBookedForQuickPeekRange(item.id, exchangeDate, returnDate, ['Confirmed', 'In-Progress'], selectedLocationId);
        const pending = quantityBookedForQuickPeekRange(item.id, exchangeDate, returnDate, ['Pending'], selectedLocationId);
        const locationStock = getLocationStock(item.id, selectedLocationId);
        const available = Math.max(0, locationStock - confirmed - pending);
        const image = getInventoryImageSrc(item);
        const availabilityClass = available <= 0 ? 'none' : available <= Math.max(2, Math.ceil(locationStock * .2)) ? 'low' : 'good';
        return `<div class="quick-peek-inventory-card compact" title="${safeText(item.name)} · ${Math.round(usage.units)} historical units rented">
          <div class="quick-peek-inventory-image inventory-image-surface" style="${inventoryBackgroundCss()}">
            ${image ? `<img class="inventory-transparent-image" style="${inventoryImageCss()}" src="${image}" alt="${safeText(item.name)}" />` : '<div class="inventory-image-placeholder">No Image</div>'}
            <div class="quick-peek-remaining ${availabilityClass}"><strong>${available}</strong><span>left</span></div>
          </div>
          <div class="quick-peek-inventory-body">
            <strong>${safeText(item.name)}</strong>
            <div class="quick-peek-stock-strip">
              <span><b>${confirmed}</b> out</span>${pending ? `<span><b>${pending}</b> pending</span>` : ''}
            </div>
          </div>
        </div>`;
      }).join('') || '<div class="empty-state">No inventory yet.</div>'}
    </div>
  </div>`;
  els.calendarAvailabilityBoard.innerHTML = `${scheduleHtml}<div class="quick-peek-split"><div>${ordersHtml}</div><div>${inventoryHtml}</div></div>`;
}
async function handleSettingsSave(event) {
  event.preventDefault();
  await withBusy(async () => {
  const form = new FormData(els.settingsForm);
  const pickupAddress = (form.get('pickupAddress') || '').trim();
  const nextSettings = {
    ...state.settings,
    businessName: (form.get('businessName') || '').trim(),
    pickupName: (form.get('pickupName') || '').trim(),
    pickupAddress,
    deliveryRatePerMile: Number(form.get('deliveryRatePerMile') || 0),
    depositMinimumOrder: Number(form.get('depositMinimumOrder') || DEFAULT_DEPOSIT_THRESHOLD),
    notificationEmail: (form.get('notificationEmail') || '').trim(),
    notificationFromName: (form.get('notificationFromName') || '').trim(),
    emailNotificationsEnabled: Boolean(form.get('emailNotificationsEnabled')),
    emailjsPublicKey: (form.get('emailjsPublicKey') || '').trim(),
    emailjsServiceId: (form.get('emailjsServiceId') || '').trim(),
    emailjsTemplateId: (form.get('emailjsTemplateId') || '').trim(),
    googleMapsApiKey: (form.get('googleMapsApiKey') || '').trim(),
    homeHeroImageData: (form.get('homeHeroImageData') || '').trim(),
    homeQuoteImageData: (form.get('homeQuoteImageData') || '').trim(),
    homeBrowseImageData: (form.get('homeBrowseImageData') || '').trim(),
    homeTrackImageData: (form.get('homeTrackImageData') || '').trim(),
    paymentOptions: collectPaymentOptionsFromSettingsForm(),
    pickupCoords: null,
    pickupGeocodedAddress: '',
    pickupGeocodeUpdatedAt: ''
  };
  if (pickupAddress) {
    try {
      if (els.pickupLookupStatus) els.pickupLookupStatus.textContent = 'Geocoding pickup address…';
      const geocoded = await geocodeAddress(pickupAddress, { origin: state.settings?.pickupCoords || null, context: nextSettings });
      if (geocoded) {
        nextSettings.pickupCoords = { lat: geocoded.lat, lon: geocoded.lon };
        nextSettings.pickupGeocodedAddress = geocoded.label;
        nextSettings.pickupGeocodeUpdatedAt = new Date().toISOString();
      }
    } catch (error) {
      if (els.pickupLookupStatus) els.pickupLookupStatus.textContent = 'Could not geocode the pickup address. Saving the typed address only.';
    }
  }
  state.settings = nextSettings;
  const beforeDepositSync = new Map(state.orders.map((order) => [order.id, JSON.parse(JSON.stringify(order))]));
  const depositRuleChangedOrders = syncAllOrdersToDepositRule();
  await saveSettings(state.settings);
  if (depositRuleChangedOrders) {
    const changedOrders = state.orders.filter((order) => JSON.stringify(beforeDepositSync.get(order.id)) !== JSON.stringify(order));
    for (const order of changedOrders) {
      await saveSingleOrder(order, beforeDepositSync.get(order.id), { actor: 'deposit-rule-settings-update' });
    }
  }
  renderSettings();
  renderOrders();
  renderCalendarView();
  renderDeliveryRoute();
  renderAdminReviews();
  renderNumbers();
  els.settingsSaved.textContent = depositRuleChangedOrders
    ? 'Settings saved. Existing order deposits and remaining balances were updated.'
    : (state.settings.pickupCoords ? 'Settings saved.' : 'Settings saved (without pickup coordinates).');
  setTimeout(() => { els.settingsSaved.textContent = ''; }, 1800);
  }, 'Saving settings…');
}
function openOrderModal(orderId = null) {
  state.editingOrderId = orderId;
  els.orderModalTitle.textContent = orderId ? 'Edit Order' : 'Add Order';
  const order = state.orders.find((item) => item.id === orderId);
  resetOrderForm(order);
  els.orderForm?.querySelectorAll('[data-full-editor-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.fullEditorTab === 'overview'));
  els.orderForm?.querySelectorAll('[data-full-editor-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.fullEditorPanel === 'overview'));
  els.orderModalWrap.classList.add('open');
}
function resetOrderForm(order) {
  els.orderForm.reset();
  populateEmployeeAssignmentSelect(order?.assignedEmployeeId || '');
  ['exchangeDate','returnDate'].forEach((name) => { if (els.orderForm.elements[name]) els.orderForm.elements[name].dataset.userEdited = ''; });
  if (els.orderForm.elements.total) els.orderForm.elements.total.dataset.userAdjusted = '';
  const now = new Date();
  const defaultDate = now.toISOString().slice(0, 10);
  const values = order || {
    firstName: '', lastName: '', status: 'Pending', paymentStatus: 'Un-Paid', fulfillmentType: 'Pickup', verbalConfirmation: false,
    exchangeDate: defaultDate, exchangeTime: '19:00', returnDate: addDays(defaultDate, 1), returnTime: '17:00',
    total: 0, adjustedTotal: '', eventDate: '', eventTime: '', eventName: '', address: '', deliveryFee: 0, setupFee: 0, tipAmount: 0, notes: '', depositWaived: false, equipmentStillDiscussing: false
  };
  Object.keys(values).forEach((key) => {
    const field = els.orderForm.elements[key];
    if (!field) return;
    if (field.type === 'checkbox') field.checked = Boolean(values[key]);
    else field.value = values[key] ?? '';
  });
  if (els.orderForm.elements.total && order) { els.orderForm.elements.total.value = getEffectiveOrderTotal(order).toFixed(2); els.orderForm.elements.total.dataset.userAdjusted = order.adjustedTotal !== '' && order.adjustedTotal != null ? 'true' : ''; }
  if (els.orderForm.elements.eventDate) els.orderForm.elements.eventDate.value = order?.eventDate || '';
  if (els.orderForm.elements.eventTime) els.orderForm.elements.eventTime.value = order?.eventTime || '';
  if (els.orderForm.elements.eventName) els.orderForm.elements.eventName.value = order?.eventName || '';
  if (els.orderForm.elements.verbalConfirmation) els.orderForm.elements.verbalConfirmation.checked = Boolean(order?.verbalConfirmation);
  if (els.orderForm.elements.notes) els.orderForm.elements.notes.value = order?.notes || '';
  setTimeControlValue('eventTime', values.eventTime || '');
  setTimeControlValue('exchangeTime', values.exchangeTime || '7:00 PM');
  setTimeControlValue('returnTime', values.returnTime || '5:00 PM');
  if (els.orderForm.elements.returnDate) els.orderForm.elements.returnDate.dataset.userEdited = order ? 'true' : 'false';
  setReturnDateFromExchange(!order);
  const selectedMethods = order ? Object.keys(order.contactMethods || {}) : ['text'];
  renderContactMethodInputs(selectedMethods, order?.contactMethods || {});
  renderOrderItemInputs(order?.items || []);
  if (!order) setExchangeAndReturnFromEventDate(true);
  syncOrderTotalsPreview();
}
function renderContactMethodInputs(selectedMethods = [], values = {}) {
  const pickWrap = document.getElementById('contactMethodChecks');
  const inputWrap = document.getElementById('contactMethodInputs');
  pickWrap.innerHTML = CONTACT_METHODS.map((method) => `
    <label class="check-pill"><input type="checkbox" data-contact-check value="${method.key}" ${selectedMethods.includes(method.key) ? 'checked' : ''}/> ${method.label}</label>
  `).join('');
  function paintInputs() {
    const active = [...pickWrap.querySelectorAll('[data-contact-check]:checked')].map((input) => input.value);
    inputWrap.innerHTML = active.map((key) => {
      const method = CONTACT_METHODS.find((entry) => entry.key === key);
      const type = key === 'email' ? 'email' : key === 'text' ? 'tel' : 'text';
      const inputMode = key === 'text' ? 'tel' : key === 'email' ? 'email' : 'text';
      return `<div class="form-row"><label>${method.label}</label><input type="${type}" inputmode="${inputMode}" name="contact_${key}" placeholder="${method.placeholder}" value="${safeText(values[key] || '')}" /></div>`;
    }).join('');
  }
  pickWrap.querySelectorAll('[data-contact-check]').forEach((input) => input.addEventListener('change', paintInputs));
  paintInputs();
}

function normalizeItemName(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function findDefaultOrderInventoryItem() {
  const inventory = state.inventory || [];
  return inventory.find((item) => normalizeItemName(item.name).includes('white folding chair'))
    || inventory.find((item) => normalizeItemName(item.name).includes('folding chair'))
    || inventory.find((item) => normalizeItemName(item.category) === 'chairs')
    || inventory[0]
    || null;
}
function buildInventoryOptions(selectedId = '') {
  return (state.inventory || []).map((item) => `<option value="${safeText(item.id)}"${item.id === selectedId ? ' selected' : ''}>${safeText(item.name)} (${safeText(item.category)}) - ${currency(item.price)}</option>`).join('');
}
function getInventoryCategoriesForOrderPicker() {
  const seen = new Set();
  return (state.inventory || []).map((item) => item.category || 'Other').filter((category) => {
    const key = normalizeCategory(category || 'Other');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function inventoryRentalUsage(inventoryId) {
  let units = 0;
  let orders = 0;
  for (const order of (state.orders || [])) {
    // Completed rentals are strongest evidence of real use; confirmed/in-progress
    // rentals count too so the ranking adapts before the historical record catches up.
    const weight = order.status === 'Completed' ? 1 : ['Confirmed','In-Progress'].includes(order.status) ? 0.65 : 0.2;
    const matching = (order.items || []).filter((item) => item.inventoryId === inventoryId);
    if (!matching.length) continue;
    orders += weight;
    units += matching.reduce((sum, item) => sum + Number(item.quantity || 0), 0) * weight;
  }
  return { units, orders, score: units + (orders * 2) };
}
function sortedInventoryForCategory(category) {
  return (state.inventory || [])
    .filter((item) => normalizeCategory(item.category || 'Other') === normalizeCategory(category || 'Other'))
    .map((item) => ({ item, usage: inventoryRentalUsage(item.id) }))
    .sort((a,b) => b.usage.score - a.usage.score || (a.item.name || '').localeCompare(b.item.name || ''));
}
function renderQuickCategoryButtons() {
  const categories = getInventoryCategoriesForOrderPicker();
  if (!categories.length) return '';
  return `<div class="quick-item-picker"><div class="small muted">Add another item by category</div><div class="quick-category-row">${categories.map((category) => `<button type="button" class="btn btn-ghost btn-small" data-quick-category="${safeText(category)}">${safeText(category)}</button>`).join('')}</div><div class="quick-category-menu" data-quick-category-menu hidden></div></div>`;
}
function openQuickCategoryMenu(button) {
  const wrap = button.closest('.quick-item-picker');
  const menu = wrap?.querySelector('[data-quick-category-menu]');
  if (!wrap || !menu) return;
  const category = button.dataset.quickCategory || '';
  const ranked = sortedInventoryForCategory(category);
  const maxScore = Math.max(1, ...ranked.map((entry) => entry.usage.score));
  wrap.querySelectorAll('[data-quick-category]').forEach((btn) => btn.classList.toggle('active', btn === button));
  menu.hidden = false;
  menu.innerHTML = ranked.length ? `<div class="quick-inventory-ranked-list">${ranked.map(({item, usage}, index) => {
    const image = getInventoryImageSrc(item);
    const width = Math.max(4, Math.round((usage.score / maxScore) * 100));
    return `<button type="button" class="quick-inventory-option ranked" data-quick-inventory-id="${safeText(item.id)}">
      <div class="quick-ranked-thumb">${image ? `<img src="${image}" alt="" />` : '<span>◇</span>'}</div>
      <div class="quick-ranked-copy">
        <div class="quick-ranked-title"><strong>${safeText(item.name)}</strong>${index === 0 && usage.score > 0 ? '<span class="badge badge-blue">Most used</span>' : ''}</div>
        <div class="quick-use-meter"><span style="width:${width}%"></span></div>
        <div class="small muted">${usage.units > 0 ? `${Math.round(usage.units)} units rented across your order history` : 'No rental history yet'}</div>
      </div>
      <strong class="quick-ranked-price">${currency(item.price)}</strong>
    </button>`;
  }).join('')}</div>` : '<div class="small muted">No items in this category.</div>';
}
function closeQuickCategoryMenus(except = null) {
  document.querySelectorAll('[data-quick-category-menu]').forEach((menu) => {
    if (except && menu === except) return;
    menu.hidden = true;
    menu.innerHTML = '';
  });
  document.querySelectorAll('[data-quick-category]').forEach((btn) => btn.classList.remove('active'));
}

function renderOrderItemInputs(items = []) {
  const defaultItem = findDefaultOrderInventoryItem();
  const rows = items.length ? items.map((item) => ({
    ...item,
    customUnitPrice: item?.customUnitPrice ?? item?.chargedUnitPrice ?? ''
  })) : [{ inventoryId: defaultItem?.id || '', quantity: 1, customUnitPrice: '', accessories: [] }];
  els.orderItemsBox.innerHTML = `<div class="order-item-stack">${rows.map((item) => renderOrderItemRow(item)).join('')}</div>${renderQuickCategoryButtons()}`;
  [...els.orderItemsBox.querySelectorAll('.order-item-card')].forEach((row, index) => renderAccessoryOptionsForRow(row, rows[index]?.accessories || []));
  bindOrderItemRowEvents();
}
function renderOrderItemRow(item, config = {}) {
  const selectedId = item.inventoryId || findDefaultOrderInventoryItem()?.id || '';
  const inventoryItem = (state.inventory || []).find((entry) => entry.id === selectedId) || findDefaultOrderInventoryItem() || {};
  const imageSrc = getInventoryImageSrc(inventoryItem);
  return `
    <div class="card order-item-card compact-order-item-card">
      <input type="hidden" name="item_inventoryId" value="${safeText(selectedId)}" />
      <div class="order-item-line">
        <div class="order-item-thumb-wrap inventory-image-surface" style="${inventoryBackgroundCss()}">
          ${imageSrc ? `<img class="order-item-thumb inventory-transparent-image" style="${inventoryImageCss()}" src="${imageSrc}" alt="${safeText(inventoryItem.name || 'Item')}" />` : `<div class="order-item-thumb order-item-thumb-empty">No Image</div>`}
        </div>
        <div class="order-item-name-block">
          <strong>${safeText(inventoryItem.name || item.name || 'Inventory item')}</strong>
          <span class="small muted">${safeText(inventoryItem.category || item.category || 'Inventory')} · ${currency(inventoryItem.price ?? item.unitPrice ?? 0)} each</span>
        </div>
        <label class="order-item-mini-field"><span>Qty</span><input type="number" min="1" name="item_quantity" value="${item.quantity || 1}" /></label>
        <label class="order-item-mini-field"><span>Price Change</span><input type="number" step="0.01" min="0" name="item_customUnitPrice" value="${item.customUnitPrice ?? ''}" placeholder="Default" /></label>
        <button type="button" class="btn btn-ghost btn-small order-item-remove" data-remove-item-row>Remove</button>
      </div>
      <div class="order-item-accessories"></div>
    </div>`;
}
function renderAccessoryOptionsForRow(row, selectedAccessories = []) {
  const input = row.querySelector('[name="item_inventoryId"]');
  const wrap = row.querySelector('.order-item-accessories');
  if (!input || !wrap) return;
  const inventoryItem = state.inventory.find((entry) => entry.id === input.value);
  const accessories = normalizeAccessories(inventoryItem?.accessories || []);
  const selectedIds = (selectedAccessories || []).map((acc) => acc.id || acc).filter(Boolean);
  if (!accessories.length) {
    wrap.innerHTML = '<div class="small muted">No accessories for this item.</div>';
    return;
  }
  wrap.innerHTML = `<div class="small muted" style="margin-bottom:6px;">Accessories</div><div class="contact-options">${accessories.map((accessory) => `<label class="check-pill"><input type="checkbox" data-item-accessory value="${accessory.id}" ${selectedIds.includes(accessory.id) ? 'checked' : ''}/> ${safeText(accessory.name)} (${currency(accessory.price)} each)</label>`).join('')}</div>`;
}
function addOrderItemRow(inventoryId = '') {
  const picked = (state.inventory || []).find((item) => item.id === inventoryId) || findDefaultOrderInventoryItem();
  const stack = els.orderItemsBox.querySelector('.order-item-stack') || els.orderItemsBox;
  stack.insertAdjacentHTML('beforeend', renderOrderItemRow({ inventoryId: picked?.id || '', quantity: 1, customUnitPrice: '', accessories: [] }));
  const newRow = stack.lastElementChild;
  if (newRow) renderAccessoryOptionsForRow(newRow, []);
  bindOrderItemRowEvents();
  syncOrderTotalsPreview();
}
function bindOrderItemRowEvents() {
    els.orderItemsBox.querySelectorAll('[data-remove-item-row]').forEach((btn) => btn.onclick = () => {
    btn.closest('.order-item-card, .card').remove();
    syncOrderTotalsPreview();
  });
  els.orderItemsBox.querySelectorAll('[name="item_inventoryId"]').forEach((input) => {
    input.onchange = () => {
      renderAccessoryOptionsForRow(input.closest('.order-item-card, .card'), []);
      bindOrderItemRowEvents();
      syncOrderTotalsPreview();
    };
  });
  els.orderItemsBox.querySelectorAll('[data-quick-category]').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      openQuickCategoryMenu(btn);
    };
  });
  els.orderItemsBox.querySelectorAll('[data-quick-category-menu]').forEach((menu) => {
    menu.onclick = (event) => {
      const option = event.target.closest('[data-quick-inventory-id]');
      if (!option) return;
      addOrderItemRow(option.dataset.quickInventoryId || '');
      closeQuickCategoryMenus();
    };
  });
  els.orderItemsBox.querySelectorAll('[name="item_quantity"], [name="item_customUnitPrice"], [data-item-accessory]').forEach((input) => {
    input.oninput = syncOrderTotalsPreview;
    input.onchange = syncOrderTotalsPreview;
  });
}

function normalizePhoneDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}
function isValidAdminPhone(value = '') {
  const digits = normalizePhoneDigits(value);
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}
function isValidAdminEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}
function validateOrderContactRequirement(contactMap = {}) {
  const email = String(contactMap.email || '').trim();
  const phone = String(contactMap.text || '').trim();
  // Email/phone are optional for admin-created orders. If neither is saved, the public ticket page explains that tracking cannot be viewed until one is added.
  if (email && !isValidAdminEmail(email)) return 'Please enter a valid email address, or remove the email field.';
  if (phone && !isValidAdminPhone(phone)) return 'Please enter a valid 10-digit phone number, or remove the text field.';
  return '';
}

async function handleOrderSave(event) {
  event.preventDefault();
  await withBusy(async () => {
  const form = new FormData(els.orderForm);
  const contactChecks = [...document.querySelectorAll('[data-contact-check]:checked')].map((input) => input.value);
  const contactValues = Object.fromEntries(contactChecks.map((key) => [key, form.get(`contact_${key}`) || '']));
  const contactMap = buildContactMap(contactChecks, contactValues);
  const contactError = validateOrderContactRequirement(contactMap);
  if (contactError) { alert(contactError); return; }
  const rows = [...els.orderItemsBox.querySelectorAll('.order-item-card, .card')];
  const items = rows.map((row) => {
    const inventoryId = row.querySelector('[name="item_inventoryId"]')?.value;
    const inv = state.inventory.find((entry) => entry.id === inventoryId);
    if (!inv) return null;
    const quantity = Number(row.querySelector('[name="item_quantity"]')?.value || 0);
    const customRaw = row.querySelector('[name="item_customUnitPrice"]')?.value;
    const chargedUnitPrice = customRaw !== '' && customRaw != null ? Number(customRaw || 0) : '';
    const effectiveUnitPrice = chargedUnitPrice === '' ? Number(inv.price || 0) : chargedUnitPrice;
    const selectedAccessoryIds = [...row.querySelectorAll('[data-item-accessory]:checked')].map((input) => input.value);
    const selectedAccessories = normalizeAccessories(inv.accessories || []).filter((accessory) => selectedAccessoryIds.includes(accessory.id));
    const accessorySubtotal = selectedAccessories.reduce((sum, accessory) => sum + (Number(accessory.price || 0) * quantity), 0);
    return {
      inventoryId,
      name: inv.name,
      category: inv.category,
      imageUrl: inv.imageUrl,
      imageData: inv.imageData || '',
      unitPrice: Number(inv.price || 0),
      chargedUnitPrice,
      quantity,
      accessories: selectedAccessories.map((accessory) => ({ id: accessory.id, name: accessory.name, price: Number(accessory.price || 0), imageData: accessory.imageData || '' })),
      accessorySubtotal,
      subtotal: (quantity * effectiveUnitPrice) + accessorySubtotal
    };
  }).filter(Boolean).filter((item) => item.quantity > 0);
  const deliveryFee = Number(form.get('deliveryFee') || 0);
  const setupFee = Number(form.get('setupFee') || 0);
  const tipAmount = Number(form.get('tipAmount') || 0);
  const listedItemsSubtotal = items.reduce((sum, item) => sum + (Number(item.unitPrice || 0) * Number(item.quantity || 0)) + Number(item.accessorySubtotal || 0), 0);
  const chargedItemsSubtotal = calculateOrderItemsSubtotal(items);
  const baseTotal = chargedItemsSubtotal + deliveryFee + setupFee + tipAmount;
  const totalRaw = form.get('total');
  const finalTotal = totalRaw !== '' && totalRaw != null ? Number(totalRaw || 0) : baseTotal;
  const adjustedTotal = Math.abs(finalTotal - baseTotal) > 0.004 ? finalTotal : '';
  const existingOrder = state.orders.find((entry) => entry.id === state.editingOrderId) || null;
  const order = {
    id: state.editingOrderId || uid('ord'),
    firstName: String(form.get('firstName') || '').trim(),
    lastName: String(form.get('lastName') || '').trim(),
    eventDate: form.get('eventDate') || '',
    eventTime: form.get('eventTime') || '',
    eventName: String(form.get('eventName') || '').trim(),
    status: form.get('status'),
    paymentStatus: form.get('paymentStatus'),
    fulfillmentType: form.get('fulfillmentType'),
    verbalConfirmation: Boolean(form.get('verbalConfirmation')),
    assignedEmployeeId: isAdminUser() ? String(form.get('assignedEmployeeId') || '') : (existingOrder?.assignedEmployeeId || ''),
    assignedEmployeeName: isAdminUser() ? (String(form.get('assignedEmployeeId') || '') ? employeeDisplayName(approvedEmployees().find((u) => (u.uid || u.id) === String(form.get('assignedEmployeeId') || '')) || {}) : '') : (existingOrder?.assignedEmployeeName || ''),
    assignedEmployeePickupAddress: isAdminUser() ? String(approvedEmployees().find((u) => (u.uid || u.id) === String(form.get('assignedEmployeeId') || ''))?.pickupAddress || '') : (existingOrder?.assignedEmployeePickupAddress || ''),
    address: form.get('address').trim(),
    exchangeDate: form.get('exchangeDate'),
    exchangeTime: form.get('exchangeTime'),
    returnDate: form.get('returnDate'),
    returnTime: form.get('returnTime'),
    deliveryMiles: existingOrder?.deliveryMiles || 0,
    deliveryFee,
    setupFee,
    tipAmount,
    listedTotal: listedItemsSubtotal + deliveryFee + setupFee + tipAmount,
    baseTotal,
    adjustedTotal,
    total: finalTotal,
    requiresDeposit: finalTotal > getDepositMinimumOrder(),
    depositAmount: finalTotal > getDepositMinimumOrder() ? roundDepositAmount(finalTotal * DEPOSIT_RATE) : 0,
    depositPaidAmount: existingOrder?.depositPaidAmount ?? existingOrder?.amountPaid ?? '',
    amountPaid: existingOrder?.amountPaid ?? 0,
    amountRemaining: existingOrder?.amountRemaining ?? finalTotal,
    depositWaived: existingOrder?.depositWaived || false,
    equipmentStillDiscussing: existingOrder?.equipmentStillDiscussing || false,
    items,
    contactMethods: contactMap,
    notes: String(form.get('notes') || '').trim(),
    updatedAt: new Date().toISOString(),
    createdAt: existingOrder?.createdAt || new Date().toISOString(),
    completedAt: form.get('status') === 'Completed' ? (existingOrder?.completedAt || new Date().toISOString()) : '',
    newInquiry: false,
    source: existingOrder?.source || 'admin',
    updateHistory: Array.isArray(existingOrder?.updateHistory) ? existingOrder.updateHistory.slice() : [],
    trackingCode: existingOrder?.trackingCode || generateTrackingCode(new Set(state.orders.map((entry) => entry.trackingCode).filter(Boolean))),
    trackingAccessCode: existingOrder?.trackingAccessCode || generateTrackingAccessCode(new Set(state.orders.map((entry) => entry.trackingAccessCode).filter(Boolean)))
  };
  syncOrderPaymentAmounts(order);
  let savedChanges = [];
  if (existingOrder) {
    savedChanges = collectOrderChanges(existingOrder, order);
    appendOrderUpdate(order, savedChanges);
    state.orders = state.orders.map((entry) => entry.id === state.editingOrderId ? order : entry);
  } else {
    state.orders.unshift(order);
  }
  await saveSingleOrder(order, existingOrder ? JSON.parse(JSON.stringify(existingOrder)) : null, { actor: 'admin-edit' });
  if (!existingOrder) await copyTextWithFallback(buildReminderMessage(order), 'Copy the reminder below:');
  else await copyLatestOrderUpdate(order, savedChanges);
  closeModals();
  renderOrders();
  renderCalendarView();
  renderDeliveryRoute();
  renderAdminReviews();
  renderNumbers();
  }, state.editingOrderId ? 'Saving order changes…' : 'Saving order…');
}
function secondsToHms(totalSeconds = 0) {
  const total = Math.max(0, Math.round(Number(totalSeconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}
function hmsToSeconds(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const match = raw.match(/^(\d{1,3}):([0-5]\d):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}
function inventoryTimeSeconds(item = {}, kind = '') {
  const direct = Number(item[`average${kind}Seconds`]);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  // Backward compatibility with v19 minute-based records.
  const legacyMinutes = Number(item[`average${kind}Minutes`]);
  return Number.isFinite(legacyMinutes) && legacyMinutes >= 0 ? legacyMinutes * 60 : 0;
}
function openInventoryModal(id = null) {
  state.editingInventoryId = id;
  els.inventoryModalTitle.textContent = id ? 'Edit Inventory Item' : 'Add Inventory Item';
  const item = state.inventory.find((entry) => entry.id === id);
  els.inventoryForm.reset();
  els.categorySuggestions.innerHTML = getCategories().map((category) => `<option value="${safeText(category)}"></option>`).join('');
  if (item) {
    ['category', 'name', 'description', 'price', 'stock'].forEach((key) => {
      const field = els.inventoryForm.elements[key];
      if (field) field.value = item[key] ?? '';
    });
    const timeFields = { averageCleaningTime: 'Cleaning', averageLoadingTime: 'Loading', averageUnloadingTime: 'Unloading' };
    Object.entries(timeFields).forEach(([fieldName, kind]) => {
      const field = els.inventoryForm.elements[fieldName];
      if (field) field.value = secondsToHms(inventoryTimeSeconds(item, kind));
    });
    if (els.imageData) els.imageData.value = item.imageData || '';
    document.getElementById('inventoryPreview').src = item.imageData || item.imageUrl || '';
    renderAccessoryRows(item.accessories || []);
  } else {
    if (els.imageData) els.imageData.value = '';
    document.getElementById('inventoryPreview').src = '';
    renderAccessoryRows([]);
  }
  document.getElementById('inventoryPreview').hidden = !document.getElementById('inventoryPreview').src;
  if (els.inventoryPreviewSurface) { els.inventoryPreviewSurface.style.cssText = inventoryBackgroundCss(); const previewImg = els.inventoryPreviewSurface.querySelector('img'); if (previewImg) previewImg.style.cssText = inventoryImageCss(); }
  els.inventoryModalWrap.classList.add('open');
}
async function handleInventorySave(event) {
  event.preventDefault();
  await withBusy(async () => {
  const form = new FormData(els.inventoryForm);
  const existing = state.inventory.find((entry) => entry.id === state.editingInventoryId);
  const uploadedImageData = (form.get('imageData') || '').toString().trim();
  // A newly uploaded image is the canonical replacement. Clear any legacy
  // imageUrl so an older background image can never reappear as a fallback
  // after refresh. If no new image was uploaded, preserve the existing URL
  // for backward compatibility with inventory that has not been migrated yet.
  let imageUrl = uploadedImageData ? '' : (existing?.imageUrl || '');
  const cleaningSeconds = hmsToSeconds(form.get('averageCleaningTime'));
  const loadingSeconds = hmsToSeconds(form.get('averageLoadingTime'));
  const unloadingSeconds = hmsToSeconds(form.get('averageUnloadingTime'));
  if ([cleaningSeconds, loadingSeconds, unloadingSeconds].some((value) => value === null)) {
    alert('Handling times must use HH:MM:SS format, for example 00:00:45.');
    return;
  }
  const item = {
    id: state.editingInventoryId || uid('inv'),
    category: normalizeCategory(form.get('category')),
    name: form.get('name').trim(),
    description: form.get('description').trim(),
    imageUrl,
    imageData: uploadedImageData || existing?.imageData || '',
    accessories: collectAccessoriesFromForm(),
    price: Number(form.get('price') || 0),
    stock: Number(form.get('stock') || 0),
    averageCleaningSeconds: cleaningSeconds,
    averageLoadingSeconds: loadingSeconds,
    averageUnloadingSeconds: unloadingSeconds,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (state.editingInventoryId) {
    state.inventory = state.inventory.map((entry) => entry.id === item.id ? item : entry);
  } else {
    state.inventory.unshift(item);
  }
  await saveSingleInventoryItem(item);
  closeModals();
  await loadData();
  renderInventory();
  renderNumbers();
  }, state.editingInventoryId ? 'Saving inventory changes…' : 'Saving inventory item…');
}
function fillInventoryBackgroundForm(config = {}) {
  if (!els.inventoryBackgroundForm) return;
  const cfg = inventoryBackgroundConfig({ inventoryImageBackground: config });
  ['mode','color1','color2','angle','texture','textureOpacity','imageScale','imageX','imageY','shadowColor','shadowOpacity','shadowBlur','shadowX','shadowY','edgeGlow','brightness','contrast','saturation'].forEach((name) => {
    const field = els.inventoryBackgroundForm.elements[name];
    if (field) field.value = cfg[name];
  });
  if (els.inventoryBackgroundForm.elements.shadowEnabled) els.inventoryBackgroundForm.elements.shadowEnabled.checked = cfg.shadowEnabled;
}
function inventoryBackgroundDraft() {
  const form = els.inventoryBackgroundForm;
  if (!form) return inventoryBackgroundConfig();
  return inventoryBackgroundConfig({ inventoryImageBackground: {
    mode: form.elements.mode?.value,
    color1: form.elements.color1?.value,
    color2: form.elements.color2?.value,
    angle: Number(form.elements.angle?.value || 135),
    texture: form.elements.texture?.value,
    textureOpacity: Number(form.elements.textureOpacity?.value || 0),
    imageScale: Number(form.elements.imageScale?.value || 1.08),
    imageX: Number(form.elements.imageX?.value || 0),
    imageY: Number(form.elements.imageY?.value || 0),
    shadowEnabled: !!form.elements.shadowEnabled?.checked,
    shadowColor: form.elements.shadowColor?.value,
    shadowOpacity: Number(form.elements.shadowOpacity?.value || 0),
    shadowBlur: Number(form.elements.shadowBlur?.value || 0),
    shadowX: Number(form.elements.shadowX?.value || 0),
    shadowY: Number(form.elements.shadowY?.value || 0),
    edgeGlow: Number(form.elements.edgeGlow?.value || 0),
    brightness: Number(form.elements.brightness?.value || 1),
    contrast: Number(form.elements.contrast?.value || 1),
    saturation: Number(form.elements.saturation?.value || 1)
  }});
}
function updateInventoryBackgroundPreview() {
  if (!els.inventoryBackgroundForm) return;
  const cfg = inventoryBackgroundDraft();
  if (els.inventoryBackgroundPreview) {
    els.inventoryBackgroundPreview.style.cssText = inventoryBackgroundCss({ inventoryImageBackground: cfg });
    const sample = els.inventoryBackgroundPreview.querySelector('.inventory-background-preview-object, .inventory-background-preview-image');
    if (sample) sample.style.cssText = inventoryImageCss({ inventoryImageBackground: cfg });
  }
  if (els.inventoryBackgroundAngleLabel) els.inventoryBackgroundAngleLabel.textContent = `${cfg.angle}°`;
  if (els.inventoryTextureStrengthLabel) els.inventoryTextureStrengthLabel.textContent = `${Math.round(cfg.textureOpacity * 100)}%`;
  const labels = {
    inventoryImageScaleLabel: `${Math.round(cfg.imageScale * 100)}%`, inventoryImageXLabel: `${cfg.imageX}%`, inventoryImageYLabel: `${cfg.imageY}%`,
    inventoryShadowOpacityLabel: `${Math.round(cfg.shadowOpacity * 100)}%`, inventoryShadowBlurLabel: `${cfg.shadowBlur}px`, inventoryShadowXLabel: `${cfg.shadowX}px`, inventoryShadowYLabel: `${cfg.shadowY}px`,
    inventoryEdgeGlowLabel: `${Math.round(cfg.edgeGlow * 100)}%`, inventoryBrightnessLabel: `${Math.round(cfg.brightness * 100)}%`, inventoryContrastLabel: `${Math.round(cfg.contrast * 100)}%`, inventorySaturationLabel: `${Math.round(cfg.saturation * 100)}%`
  };
  Object.entries(labels).forEach(([id,text]) => { const el = document.getElementById(id); if (el) el.textContent = text; });
  els.inventoryBackgroundForm.querySelector('[data-shadow-controls]')?.classList.toggle('field-disabled', !cfg.shadowEnabled);
  els.inventoryBackgroundForm.querySelector('[data-background-color2-row]')?.classList.toggle('field-disabled', cfg.mode === 'solid');
  els.inventoryBackgroundForm.querySelector('[data-background-angle-row]')?.classList.toggle('field-disabled', cfg.mode !== 'linear');
}
function openInventoryBackgroundModal() {
  fillInventoryBackgroundForm(inventoryBackgroundConfig());
  if (els.inventoryBackgroundPreview) {
    const previewItem = (state.inventory || []).find((item) => getInventoryImageSrc(item));
    if (previewItem) {
      els.inventoryBackgroundPreview.innerHTML = `<img class="inventory-background-preview-image inventory-transparent-image" src="${getInventoryImageSrc(previewItem)}" alt="Inventory preview" />`;
    } else {
      els.inventoryBackgroundPreview.innerHTML = '<div class="inventory-background-preview-object">ITEM</div>';
    }
  }
  updateInventoryBackgroundPreview();
  els.inventoryBackgroundModalWrap?.classList.add('open');
}
function closeInventoryBackgroundModal() {
  els.inventoryBackgroundModalWrap?.classList.remove('open');
}
async function handleInventoryBackgroundSave(event) {
  event.preventDefault();
  const cfg = inventoryBackgroundDraft();
  await withBusy(async () => {
    state.settings = { ...state.settings, inventoryImageBackground: cfg };
    await saveSettings(state.settings);
    closeInventoryBackgroundModal();
    renderInventory();
    renderCalendarView();
  }, 'Applying image background…');
}

async function handleBackupExport() {
  const payload = await exportOrdersBackup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `rent-some-orders-backup-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setBackupStatus('Backup downloaded.');
}
async function handleCreateSnapshot() {
  await createOrderSnapshot('Admin manual snapshot');
  setBackupStatus('Snapshot saved.');
}
async function handleBackupImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!window.confirm('Import this backup? This will replace current orders, inventory, and settings.')) {
    event.target.value = '';
    return;
  }
  const payload = JSON.parse(await file.text());
  await importOrdersBackup(payload);
  await loadData();
  renderAll();
  setBackupStatus('Backup imported.');
  event.target.value = '';
}
function setBackupStatus(message) {
  if (!els.backupStatus) return;
  els.backupStatus.textContent = message;
  setTimeout(() => { if (els.backupStatus.textContent === message) els.backupStatus.textContent = ''; }, 2200);
}
function handleFatalError(error) {
  console.error(error);
  const target = document.getElementById('loginError') || document.body;
  if (target) target.textContent = error?.message || 'Something went wrong.';
}
function closeModals() {
  els.orderModalWrap.classList.remove('open');
  els.inventoryModalWrap.classList.remove('open');
  if (els.inventoryForm) els.inventoryForm.reset();
  if (els.imageData) els.imageData.value = '';
  const preview = document.getElementById('inventoryPreview');
  if (preview) {
    preview.src = '';
    preview.hidden = true;
  }
  renderAccessoryRows([]);
}
