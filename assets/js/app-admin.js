import { createOrderSnapshot, deletePublicReview, deleteSingleOrder, exportOrdersBackup, getCategories, getCostRecords, getInventory, getOrders, getAssignedOrders, getPublicReviews, getSession, getSettings, getCurrentUserProfile, getUsers, importOrdersBackup, loginAdmin, logoutAdmin, saveCostRecords, saveInventory, saveOrders, saveSettings, saveSingleOrder, saveUserProfile } from './store.js?v=employee-access-load-fix-v3';
import { CONTACT_METHODS, ORDER_STATUSES, PAYMENT_STATUSES, addDays, buildContactMap, compareCompletedDesc, compareExchangeAsc, contactSummary, currency, formatDateTime, getOrderColumn, normalizeCategory, overlaps, parseDateTime, safeText, uid } from './utils.js';
import { debounce, geocodeAddress, searchAddresses } from './geo.js';
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
  busyCount: 0,
  activeTemplateField: null,
  reminderComposer: null
};
const els = {};
const DEFAULT_DEPOSIT_THRESHOLD = 100;
const DEPOSIT_RATE = 0.35;
const TRACKING_PAGE_PATH = '../tracking/index.html';
const ADMIN_VERSION = 'employee-access-load-fix-v1';
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
    renderAll();
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
    newInquiryBell: document.getElementById('newInquiryBell'),
    newInquiryBadge: document.getElementById('newInquiryBadge'),
    collapsedColumnsRail: document.getElementById('collapsedColumnsRail'),
    addOrderBtn: document.getElementById('addOrderBtn'),
    routeDateInput: document.getElementById('routeDateInput'),
    routePrevBtn: document.getElementById('routePrevBtn'),
    routeTodayBtn: document.getElementById('routeTodayBtn'),
    routeNextBtn: document.getElementById('routeNextBtn'),
    planRouteBtn: document.getElementById('planRouteBtn'),
    routeDateLabel: document.getElementById('routeDateLabel'),
    routeStopsList: document.getElementById('routeStopsList'),
    addInventoryBtn: document.getElementById('addInventoryBtn'),
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
    employeeSignupLinkStatus: document.getElementById('employeeSignupLinkStatus')
  });
}
function isAdminUser() { return state.currentUser?.role === 'admin' && state.currentUser?.status === 'approved'; }
function applyRoleAccess() {
  const admin = isAdminUser();
  document.body.classList.toggle('employee-view', !admin);
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !admin));
  if (!admin) {
    state.activeTab = 'orders';
    document.querySelectorAll('[data-tab-btn]').forEach((btn) => btn.classList.toggle('hidden', btn.dataset.tabBtn !== 'orders'));
    document.querySelectorAll('[data-tab-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.tabPanel === 'orders'));
    if (state.currentUser?.status !== 'approved') {
      document.querySelector('[data-tab-panel="orders"]')?.insertAdjacentHTML('afterbegin', '<div class="card" style="padding:18px;margin-bottom:16px;"><strong>Account pending approval</strong><div class="small muted">Your signup was received. You will see assigned orders after an administrator approves your account.</div></div>');
    }
  }
}
function approvedEmployees() { return (state.users || []).filter((u) => u.role === 'employee' && u.status === 'approved'); }
function employeeDisplayName(user = {}) { return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Employee'; }
function populateEmployeeAssignmentSelect(selectedId = '') {
  const select = els.orderForm?.elements?.assignedEmployeeId;
  if (!select) return;
  select.innerHTML = '<option value="">Unassigned</option>' + approvedEmployees().map((u) => `<option value="${safeText(u.uid || u.id)}">${safeText(employeeDisplayName(u))}</option>`).join('');
  select.value = selectedId || '';
}
function renderEmployees() {
  if (!els.employeesList || !isAdminUser()) return;
  const employees = (state.users || []).filter((u) => u.role === 'employee').sort((a,b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));
  els.employeesList.innerHTML = employees.length ? employees.map((u) => `<div class="card" style="padding:16px;"><div class="section-header"><div><strong>${safeText(employeeDisplayName(u))}</strong><div class="small muted">${safeText(u.email || '')} · ${safeText(u.phone || 'No phone')}</div></div><span class="badge ${u.status === 'approved' ? 'badge-green' : 'badge-yellow'}">${safeText(u.status || 'pending')}</span></div><div class="small"><strong>Pickup location:</strong> ${safeText(u.pickupAddress || 'Not provided')}</div>${u.emergencyContactName ? `<div class="small muted">Emergency contact: ${safeText(u.emergencyContactName)} · ${safeText(u.emergencyContactPhone || '')}</div>` : ''}<div style="display:flex;gap:8px;margin-top:12px;">${u.status !== 'approved' ? `<button class="btn btn-primary btn-small" data-approve-employee="${safeText(u.uid || u.id)}">Approve</button>` : `<button class="btn btn-ghost btn-small" data-pend-employee="${safeText(u.uid || u.id)}">Set Pending</button>`}</div></div>`).join('') : '<div class="empty-state">No employee signups yet.</div>';
}
async function handleEmployeeListClick(event) {
  const approve = event.target.closest('[data-approve-employee]');
  const pend = event.target.closest('[data-pend-employee]');
  const id = approve?.dataset.approveEmployee || pend?.dataset.pendEmployee;
  if (!id) return;
  const user = state.users.find((u) => (u.uid || u.id) === id);
  if (!user) return;
  user.status = approve ? 'approved' : 'pending';
  await withBusy(() => saveUserProfile(user), 'Updating employee…');
  renderEmployees();
}
async function copyEmployeeSignupLink() {
  const url = new URL('../employee-signup/index.html', window.location.href).href;
  await navigator.clipboard.writeText(url);
  if (els.employeeSignupLinkStatus) els.employeeSignupLinkStatus.textContent = 'Private employee signup link copied.';
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
  els.tabButtons.forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tabBtn)));
  els.logoutBtn.addEventListener('click', async () => {
    await logoutAdmin();
    window.location.reload();
  });
  els.copyPickupAddressBtn?.addEventListener('click', openCopyPasteMenu);
  els.copyEmployeeSignupLinkBtn?.addEventListener('click', copyEmployeeSignupLink);
  els.employeesList?.addEventListener('click', handleEmployeeListClick);
  els.copyPasteModalWrap?.addEventListener('click', (event) => { if (event.target === els.copyPasteModalWrap) closeCopyPasteMenu(); });
  document.querySelectorAll('[data-close-copy-paste-modal]').forEach((btn) => btn.addEventListener('click', closeCopyPasteMenu));
  els.copyPasteOptions?.addEventListener('click', handleCopyPasteOptionClick);
  els.addCopyPasteTemplateBtn?.addEventListener('click', addCustomCopyPasteTemplate);
  els.addOrderBtn.addEventListener('click', () => openOrderModal());
  els.routeStopsList?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-plan-route-date]');
    if (!btn) return;
    planDeliveryRoute(btn.dataset.planRouteDate);
  });
  els.addInventoryBtn.addEventListener('click', () => openInventoryModal());
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
  document.querySelectorAll('[data-toggle-column]').forEach((btn) => btn.addEventListener('click', () => {
    state.activeOrderColumn = btn.dataset.toggleColumn || 'confirmed';
    applyOrderColumnCollapseState();
  }));
  els.newInquiryBell?.addEventListener('click', () => {
    state.activeTab = 'orders';
    state.activeOrderColumn = 'pending';
    document.querySelector('[data-tab-btn="orders"]')?.click();
    applyOrderColumnCollapseState();
    els.pendingColumn?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  els.inventoryForm.addEventListener('submit', handleInventorySave);
  els.settingsForm.addEventListener('submit', handleSettingsSave);
  els.calendarDateInput?.addEventListener('change', handleQuickPeekEventDateChange);
  els.quickPeekExchangeDateInput?.addEventListener('change', renderCalendarView);
  els.quickPeekReturnDateInput?.addEventListener('change', renderCalendarView);
  els.calendarPrevBtn?.addEventListener('click', () => shiftCalendarDate(-1));
  els.calendarNextBtn?.addEventListener('click', () => shiftCalendarDate(1));
  els.calendarTodayBtn?.addEventListener('click', () => { if (els.calendarDateInput) { els.calendarDateInput.value = new Date().toISOString().slice(0, 10); syncQuickPeekDatesFromEvent(true); renderCalendarView(); } });
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
      const compressed = await compressImageFile(file);
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
      const compressed = await compressImageFile(file);
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
}
async function loadData() {
  state.inventory = await getInventory();
  if (state.currentUser?.role === 'admin') state.users = await getUsers().catch(() => []);
  else state.users = [state.currentUser];
  state.settings = await getSettings();
  const rawOrders = state.currentUser?.role === 'employee' ? await getAssignedOrders(state.currentUser.uid) : await getOrders();
  const normalizedOrders = rawOrders.map((order) => ({
    ...order,
    paymentStatus: order.paymentStatus === 'Deposit' ? 'Deposit Paid' : order.paymentStatus
  }));
  const tracked = ensureOrdersHaveTrackingCodes(normalizedOrders);
  state.orders = tracked.orders.map((order) => ({ assignedEmployeeId: '', assignedEmployeeName: '', ...order }));
  if (state.currentUser?.role === 'employee') state.orders = state.orders.filter((order) => order.assignedEmployeeId === state.currentUser.uid);
  const paymentMigrated = syncAllOrdersToDepositRule();
  state.reviews = await getPublicReviews().catch(() => []);
  state.costs = await getCostRecords().catch(() => []);
  state.averages = Array.isArray(state.settings?.averageTasks) ? state.settings.averageTasks : [];
  // Legacy orders intentionally remain unassigned until an admin edits or assigns them.
  // Do not backfill employee fields during startup: rewriting the entire orders collection
  // can exhaust Firestore's queued write stream and freeze the admin panel.
  if (tracked.changed || paymentMigrated) {
    await saveOrders(state.orders, { actor: tracked.changed ? 'tracking-payment-backfill' : 'deposit-paid-lock-migration' });
  }
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
async function saveAndRefresh(actor = 'admin') {
  await withBusy(async () => {
    await saveInventory(state.inventory);
    await saveOrders(state.orders, { actor });
    await saveSettings(state.settings);
    await loadData();
    renderAll();
  }, 'Saving changes…');
}

async function saveOrderOnly(order, before = null, actor = 'admin-order') {
  await withBusy(async () => {
    await saveSingleOrder(order, before, { actor });
    renderOrders();
    renderCalendarView();
    renderDeliveryRoute();
    renderAdminReviews();
    renderNumbers();
  renderEmployees();
  }, 'Saving order…');
}
function renderAll() {
  renderTabs();
  renderOrders();
  renderDeliveryRoute();
  renderInventory();
  renderCalendarView();
  renderReminderEditor();
  renderSettings();
  renderAdminReviews();
  renderNumbers();
  renderEmployees();
}
function setTab(tab) {
  state.activeTab = tab;
  renderTabs();
}
function renderTabs() {
  els.tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tabBtn === state.activeTab));
  els.panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.tabPanel === state.activeTab));
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
  const completed = (state.orders || []).filter((order) => getOrderColumn(order.status) === 'completed');
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
  return getCompletedOrders().reduce((sum, order) => sum + (order.items || []).reduce((itemSum, item) => (!inventoryId || item.inventoryId === inventoryId) ? itemSum + Number(item.subtotal || 0) : itemSum, 0), 0);
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
function syncAllOrdersToDepositRule() {
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
      order.updatedAt = new Date().toISOString();
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
function getTrackingLinkForOrder(order = {}) {
  const code = encodeURIComponent(order?.trackingCode || '');
  const trackingUrl = new URL('../tracking/', window.location.href);
  trackingUrl.searchParams.set('c', code);
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
  return els.calendarDateInput?.value || new Date().toISOString().slice(0, 10);
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
  els.calendarDateInput.value = addDays(getCalendarSelectedDate(), days);
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
function formatOrderValueForUpdate(key, value) {
  if (key === 'exchangeDate' || key === 'returnDate' || key === 'eventDate') return formatFriendlyDate(value);
  if (key === 'exchangeTime' || key === 'returnTime' || key === 'eventTime') return normalizeTbdLabel(value);
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

function updateNewInquiryBadge() {
  const count = (state.orders || []).filter((order) => order.newInquiry).length;
  if (!els.newInquiryBadge) return;
  els.newInquiryBadge.textContent = String(count);
  els.newInquiryBadge.classList.toggle('hidden', count === 0);
  els.newInquiryBell?.classList.toggle('has-new', count > 0);
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
            <strong>${index + 1}. ${safeText(stop.type)} · ${safeText(stop.time || 'Time TBD')}</strong>
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

function renderOrders() {
  const pending = state.orders.filter((o) => getOrderColumn(o.status) === 'pending').sort(compareExchangeAsc);
  const confirmed = state.orders.filter((o) => getOrderColumn(o.status) === 'confirmed').sort(compareExchangeAsc);
  const completed = state.orders.filter((o) => getOrderColumn(o.status) === 'completed').sort(compareCompletedDesc);
  fillList(els.pendingList, renderOrderGroups(pending, 'pending'), 'No pending orders yet.');
  fillList(els.confirmedList, renderOrderGroups(confirmed, 'confirmed'), 'No confirmed orders yet.');
  fillList(els.completedList, renderOrderGroups(completed, 'completed'), 'No completed orders yet.');
  if (els.pendingTotal) els.pendingTotal.textContent = `Total: ${currency(sumOrderTotals(pending))}`;
  if (els.confirmedTotal) els.confirmedTotal.textContent = `Total: ${currency(sumOrderTotals(confirmed))}`;
  if (els.completedTotal) els.completedTotal.textContent = `Total: ${currency(sumOrderTotals(completed))}`;
  applyOrderColumnCollapseState();
  updateNewInquiryBadge();
  bindOrderCardActions();
}
function fillList(el, html, emptyText) {
  el.innerHTML = html || `<div class="empty-state">${emptyText}</div>`;
}
function sumOrderTotals(orders = []) {
  return orders.reduce((sum, order) => sum + getEffectiveOrderTotal(order), 0);
}
function renderOrderGroups(orders, mode) {
  if (!orders.length) return '';
  const groups = new Map();
  orders.forEach((order) => {
    const key = mode === 'completed' ? (order.completedAt || 'Completed') : (order.exchangeDate || 'No exchange date');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  });
  return [...groups.entries()].map(([date, groupOrders]) => {
    const highlight = Boolean(state.highlightedOrderDates?.[date]);
    const upcoming = mode !== 'completed' && isDateInUpcomingBusinessWeek(date);
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
  const displayTimeRaw = order.status === 'In-Progress' ? order.returnTime : order.exchangeTime;
  const displayTime = /^\d{2}:\d{2}$/.test(String(displayTimeRaw || '').trim())
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(`2000-01-01T${displayTimeRaw}:00`)).toLowerCase()
    : '??:??';
  const iconParts = [];
  if (order.fulfillmentType === 'Delivery') iconParts.push('🚚');
  if (order.paymentStatus === 'Paid') iconParts.push('✅');
  else if (order.paymentStatus === 'Deposit Paid' || order.paymentStatus === 'Deposit') iconParts.push('☑️');
  const hasPhone = Boolean(String(order.contactMethods?.text || '').trim());
  const hasEmail = Boolean(String(order.contactMethods?.email || '').trim());
  if (!hasPhone && !hasEmail) iconParts.push('📋');
  const headerTitle = mode === 'completed'
    ? `<span class="order-pill time">${safeText(displayTime)}</span><span class="order-pill name">${displayName}</span><span class="order-pill total">${currency(effectiveTotal)}</span>`
    : `<span class="order-pill time">${safeText(displayTime)}</span><span class="order-pill icons">${iconParts.join(' ') || '—'}</span><span class="order-pill name">${displayName}</span><span class="order-pill equipment">${safeText(itemSummary)}</span>`;
  const headerSub = mode === 'completed'
    ? `${formatDateTime(order.exchangeDate, order.exchangeTime)}${order.completedAt ? ` · completed ${new Date(order.completedAt).toLocaleString()}` : ''}`
    : `${order.eventDate ? `Event ${formatDateTime(order.eventDate, order.eventTime || 'To Be Determined')} · ` : ''}Exchange ${formatDateTime(order.exchangeDate, order.exchangeTime || 'To Be Determined')}`;
  return `
    <div class="order-card order-accordion ${order.status === 'In-Progress' ? 'in-progress' : ''} ${isOpen ? 'open' : ''}">
      <button type="button" class="order-accordion-summary" data-expand-order="${order.id}">
        <div class="order-summary-main">
          <div class="order-summary-title separated-order-title">${headerTitle}</div>
          <div class="order-summary-sub">${headerSub}${order.assignedEmployeeName ? ` · Assigned to ${safeText(order.assignedEmployeeName)}` : ''} · Remaining ${currency(getOrderAmountRemaining(order))}</div>
          <div>${order.newInquiry ? `<button type="button" class="badge badge-blue new-inquiry-clear" data-clear-new-inquiry="${order.id}" title="Mark this inquiry as seen">New Inquiry</button>` : ''}</div>
        </div>
        <div class="order-summary-arrow">⌄</div>
      </button>
      <div class="order-accordion-body">
        ${renderInlineOrderEditor(order)}
        <div class="hr"></div>
        <div class="order-action-row">
          <button class="btn btn-primary btn-small" type="button" data-save-inline-order="${order.id}">Save Inline Changes</button>
          <button class="btn btn-secondary btn-small" type="button" data-copy-reminder="${order.id}">Copy reminder</button>
          <button class="btn btn-ghost btn-small" type="button" data-copy-update="${order.id}">Copy update</button>
          ${order.status === 'Completed' ? `<button class="btn btn-secondary btn-small" type="button" data-copy-review-request="${order.id}">Copy review request</button>` : ''}
          ${order.fulfillmentType === 'Delivery' && order.address ? `<button class="btn btn-ghost btn-small" type="button" data-copy-delivery-address="${order.id}">Copy delivery address</button><a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}">Open in Google Maps</a>` : ''}
          <a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="${safeText(getTrackingLinkForOrder(order))}">Open Tracking</a>
          <button class="btn btn-ghost btn-small" type="button" data-edit-order="${order.id}">Open Full Editor</button>
          <button class="btn btn-ghost btn-small" type="button" data-delete-order="${order.id}">Delete</button>
        </div>
      </div>
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
  return `<div class="inline-order-editor" data-inline-order="${order.id}">
    <div class="form-row three"><div><label>First Name</label><input data-inline-field="firstName" value="${safeText(order.firstName || '')}" /></div><div><label>Last Name</label><input data-inline-field="lastName" value="${safeText(order.lastName || '')}" /></div><div><label>Event Name</label><input data-inline-field="eventName" value="${safeText(order.eventName || '')}" /></div></div>
    <div class="form-row three"><div><label>Status</label><select data-inline-field="status">${ORDER_STATUSES.map((status) => `<option ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></div><div><label>Payment</label><select data-inline-field="paymentStatus">${PAYMENT_STATUSES.map((status) => `<option ${status === order.paymentStatus ? 'selected' : ''}>${status}</option>`).join('')}</select></div><div><label>Pickup/Delivery</label><select data-inline-field="fulfillmentType"><option ${order.fulfillmentType === 'Pickup' ? 'selected' : ''}>Pickup</option><option ${order.fulfillmentType === 'Delivery' ? 'selected' : ''}>Delivery</option><option ${order.fulfillmentType === 'To Be Determined' ? 'selected' : ''}>To Be Determined</option></select></div></div>
    <div class="form-row three"><div><label>Event Date</label><input type="date" data-inline-field="eventDate" value="${safeText(order.eventDate || '')}" /></div><div><label>Event Time</label><input type="time" data-inline-field="eventTime" value="${safeText(normalizeInlineTimeValue(order.eventTime || ''))}" /></div><div><label>Verbal Confirmation</label><label class="check-pill"><input type="checkbox" data-inline-field="verbalConfirmation" ${order.verbalConfirmation ? 'checked' : ''}/> Confirmed</label></div></div>
    <div class="form-row four"><div><label>Exchange Date</label><input type="date" data-inline-field="exchangeDate" value="${safeText(order.exchangeDate || '')}" /></div><div><label>Exchange Time</label><input type="time" data-inline-field="exchangeTime" value="${safeText(normalizeInlineTimeValue(order.exchangeTime || ''))}" /></div><div><label>Return Date</label><input type="date" data-inline-field="returnDate" value="${safeText(order.returnDate || '')}" /></div><div><label>Return Time</label><input type="time" data-inline-field="returnTime" value="${safeText(normalizeInlineTimeValue(order.returnTime || ''))}" /></div></div>
    <div class="form-row two"><div><label>Delivery Fee</label><input type="number" step="0.01" data-inline-field="deliveryFee" value="${Number(order.deliveryFee || 0)}" /></div><div><label>Setup Fee</label><input type="number" step="0.01" data-inline-field="setupFee" value="${Number(order.setupFee || 0)}" /></div></div>
    <div class="form-row three"><div><label>Tip</label><input type="number" step="0.01" data-inline-field="tipAmount" value="${Number(order.tipAmount || 0)}" /></div><div><label>Adjusted Total</label><input type="number" step="0.01" data-inline-field="adjustedTotal" value="${order.adjustedTotal === '' || order.adjustedTotal == null ? '' : safeText(order.adjustedTotal)}" /></div><div><label>Total</label><input type="number" step="0.01" data-inline-field="total" value="${Number(getEffectiveOrderTotal(order) || 0)}" /></div></div>
    <div class="note-block small"><strong>Amount paid:</strong> ${currency(getOrderAmountPaid(order))} · <strong>Remaining balance:</strong> ${currency(getOrderAmountRemaining(order))}</div>
    <div class="form-row two"><div><label>Delivery Address</label><input data-inline-field="address" value="${safeText(order.address || '')}" /></div><div><label>Contact Text</label><input data-inline-field="contact_text" value="${safeText(order.contactMethods?.text || '')}" /></div></div>
    <div class="form-row two"><div><label>Contact Email</label><input data-inline-field="contact_email" value="${safeText(order.contactMethods?.email || '')}" /></div><div><label>Notes</label><textarea data-inline-field="notes">${safeText(order.notes || '')}</textarea></div></div>
    <div class="inline-items-wrap"><strong>Equipment</strong>${itemRows}</div>
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
  appendOrderUpdate(next, collectOrderChanges(order, next));
  await withBusy(async () => {
    state.orders = state.orders.map((entry) => entry.id === orderId ? next : entry);
    await saveSingleOrder(next, order, { actor: 'admin-inline-edit' });
    renderOrders(); renderCalendarView(); renderDeliveryRoute(); renderNumbers();
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
        state.expandedOrderId = state.expandedOrderId === expandBtn.dataset.expandOrder ? null : expandBtn.dataset.expandOrder;
        renderOrders();
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
function getReminderLocationText(order) {
  if (order.fulfillmentType === 'Delivery') {
    return `delivered to ${order.address || order.addressSnapshot || 'the provided delivery address'}`;
  }
  return `picked up at ${state.settings?.pickupAddress || 'the pickup location on file'}`;
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
      : `Pickup Address: ${state.settings?.pickupAddress || 'the pickup location on file'}`);
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
  return [
    { id: 'pickup-short', label: 'Pickup intro + address', text: firstSentence },
    { id: 'pickup-full', label: 'Full pickup message', text: `${firstSentence} ${lastSentence}` },
    { id: 'pickup-address', label: 'Address only', text: pickupAddress }
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
  appendOrderUpdate(order, collectOrderChanges(before, order));
  await saveOrderOnly(order, before, 'admin-status');
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
  appendOrderUpdate(order, collectOrderChanges(before, order));
  await saveOrderOnly(order, before, 'admin-payment');
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
  appendOrderUpdate(order, collectOrderChanges(before, order));
  await saveOrderOnly(order, before, 'admin-verbal-confirmation');
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
          <div class="gallery-image-wrap inventory-gallery-image-wrap">
            ${getInventoryImageSrc(item) ? `<img class="gallery-image" src="${getInventoryImageSrc(item)}" alt="${safeText(item.name)}" />` : `<div class="inventory-image-placeholder">No Image</div>`}
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
      await saveInventory(state.inventory);
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
function quantityBookedForQuickPeekRange(inventoryId, rangeStartDate, rangeEndDate, statuses) {
  return state.orders
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
  await saveAndRefresh('admin-status');
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
  if (els.calendarDateInput && !els.calendarDateInput.value) els.calendarDateInput.value = new Date().toISOString().slice(0, 10);
  syncQuickPeekDatesFromEvent(false);
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
  const date = getCalendarSelectedDate();
  if (els.calendarDateInput && !els.calendarDateInput.value) els.calendarDateInput.value = date;
  syncQuickPeekDatesFromEvent(false);
  const { eventDate, exchangeDate, returnDate } = getQuickPeekRange();
  const rangeEndExclusive = addDays(returnDate, 1);
  if (els.calendarDateLabel) els.calendarDateLabel.textContent = `${formatFriendlyDate(eventDate)} · out ${formatFriendlyShortDate(exchangeDate)} through ${formatFriendlyShortDate(returnDate)}`;

  const ordersInRange = state.orders
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
              ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(`2000-01-01T${timeRaw}:00`)).toLowerCase()
              : '??:??';
            return `<div class="calendar-stock-row quick-peek-order-row">
              <div><strong>${safeText(time)} ${safeText(name)}</strong><div class="small muted">${safeText(items)}</div></div>
              <div class="calendar-stock-metrics"><span class="badge badge-${statusClass}">${safeText(order.status)}</span></div>
            </div>`;
          }).join('')}
        </div>
      </div>`
    : `<div class="calendar-category-card quick-peek-orders-card"><div class="empty-state">No pending, confirmed, or in-progress orders in this window.</div></div>`;

  if (!state.inventory.length) {
    els.calendarAvailabilityBoard.innerHTML = `<div class="quick-peek-split"><div>${ordersHtml}</div><div><div class="empty-state">No inventory yet.</div></div></div>`;
    return;
  }
  const categories = [...new Set(state.inventory.map((item) => item.category || 'Other'))].sort((a, b) => a.localeCompare(b));
  const inventoryHtml = categories.map((category) => {
    const items = state.inventory.filter((item) => (item.category || 'Other') === category).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const rows = items.map((item) => {
      const confirmed = quantityBookedForRange(item.id, exchangeDate, '00:00', rangeEndExclusive, '00:00', ['Confirmed', 'In-Progress']);
      const pending = quantityBookedForRange(item.id, exchangeDate, '00:00', rangeEndExclusive, '00:00', ['Pending']);
      const available = Math.max(0, Number(item.stock || 0) - confirmed - pending);
      return `<div class="calendar-stock-row">
        <div>
          <strong>${safeText(item.name)}</strong>
          <div class="small muted">Total stock: ${Number(item.stock || 0)}</div>
        </div>
        <div class="calendar-stock-metrics">
          <span class="badge badge-green">Available: ${available}</span>
          <span class="badge badge-blue">Confirmed: ${confirmed}</span>
          <span class="badge badge-yellow">Pending: ${pending}</span>
        </div>
      </div>`;
    }).join('');
    return `<div class="calendar-category-card">
      <div class="section-header" style="margin-bottom:10px;"><div><strong>${safeText(category)}</strong></div></div>
      <div class="calendar-stock-list">${rows || '<div class="empty-state">No items in this category.</div>'}</div>
    </div>`;
  }).join('');
  els.calendarAvailabilityBoard.innerHTML = `<div class="quick-peek-split"><div>${ordersHtml}</div><div>${inventoryHtml}</div></div>`;
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
  const depositRuleChangedOrders = syncAllOrdersToDepositRule();
  await saveSettings(state.settings);
  if (depositRuleChangedOrders) await saveOrders(state.orders, { actor: 'deposit-rule-settings-update' });
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
    exchangeDate: defaultDate, exchangeTime: '10:00', returnDate: addDays(defaultDate, 1), returnTime: '17:00',
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
  setTimeControlValue('exchangeTime', values.exchangeTime || '10:00 AM');
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
  const items = (state.inventory || []).filter((item) => normalizeCategory(item.category || 'Other') === normalizeCategory(category || 'Other'));
  wrap.querySelectorAll('[data-quick-category]').forEach((btn) => btn.classList.toggle('active', btn === button));
  menu.hidden = false;
  menu.innerHTML = items.length ? items.map((item) => `<button type="button" class="quick-inventory-option" data-quick-inventory-id="${safeText(item.id)}"><span>${safeText(item.name)}</span><strong>${currency(item.price)}</strong></button>`).join('') : '<div class="small muted">No items in this category.</div>';
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
        <div class="order-item-thumb-wrap">
          ${imageSrc ? `<img class="order-item-thumb" src="${imageSrc}" alt="${safeText(inventoryItem.name || 'Item')}" />` : `<div class="order-item-thumb order-item-thumb-empty">No Image</div>`}
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
    assignedEmployeeName: isAdminUser() ? employeeDisplayName(approvedEmployees().find((u) => (u.uid || u.id) === String(form.get('assignedEmployeeId') || '')) || {}) : (existingOrder?.assignedEmployeeName || ''),
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
  if (existingOrder) {
    appendOrderUpdate(order, collectOrderChanges(existingOrder, order));
    state.orders = state.orders.map((entry) => entry.id === state.editingOrderId ? order : entry);
  } else {
    state.orders.unshift(order);
  }
  await saveSingleOrder(order, existingOrder ? JSON.parse(JSON.stringify(existingOrder)) : null, { actor: 'admin-edit' });
  closeModals();
  renderOrders();
  renderCalendarView();
  renderDeliveryRoute();
  renderAdminReviews();
  renderNumbers();
  }, state.editingOrderId ? 'Saving order changes…' : 'Saving order…');
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
    if (els.imageData) els.imageData.value = item.imageData || '';
    document.getElementById('inventoryPreview').src = item.imageData || item.imageUrl || '';
    renderAccessoryRows(item.accessories || []);
  } else {
    if (els.imageData) els.imageData.value = '';
    document.getElementById('inventoryPreview').src = '';
    renderAccessoryRows([]);
  }
  document.getElementById('inventoryPreview').hidden = !document.getElementById('inventoryPreview').src;
  els.inventoryModalWrap.classList.add('open');
}
async function handleInventorySave(event) {
  event.preventDefault();
  await withBusy(async () => {
  const form = new FormData(els.inventoryForm);
  const existing = state.inventory.find((entry) => entry.id === state.editingInventoryId);
  const uploadedImageData = (form.get('imageData') || '').toString().trim();
  let imageUrl = existing?.imageUrl || '';
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
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (state.editingInventoryId) {
    state.inventory = state.inventory.map((entry) => entry.id === item.id ? item : entry);
  } else {
    state.inventory.unshift(item);
  }
  await saveInventory(state.inventory);
  closeModals();
  await loadData();
  renderInventory();
  renderNumbers();
  }, state.editingInventoryId ? 'Saving inventory changes…' : 'Saving inventory item…');
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
