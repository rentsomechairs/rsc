import { createQuickPickerOrder, getCategories, getInventory, getOpenOrders, getSettings } from './store.js?v=rental-ux-v59';
import { CONTACT_METHODS, addDays, buildContactMap, currency, overlaps, parseDateTime, safeText, uid, formatShortDate, formatDateTime } from './utils.js';
import { sendInquiryNotification } from './email-notify.js';

console.log('QUICK PICKER VERSION:', 'rental-ux-v59');

const state = {
  inventory: [],
  orders: [],
  settings: {},
  selectedCategories: new Set(),
  eventDate: '',
  eventTime: '12:00',
  eventName: '',
  receiveDate: '',
  receiveTime: '19:00',
  returnDate: '',
  returnTime: '17:00',
  selectedItems: {},
  selectedAccessories: {},
  fulfillmentType: '',
  deliveryAddress: '',
  deliveryLookupStatus: '',
  selectedContactMethods: [],
  contactValues: {},
  availabilityOffset: 0,
  step: 1,
  submitted: false,
  summaryVisible: false,
  reviewReady: false,
  notificationResult: null,
  lastSubmittedOrder: null,
  pickupLocationId: 'main'
};

const els = {};

const DEFAULT_DEPOSIT_THRESHOLD = 100;
const DEPOSIT_RATE = 0.35;

function enforceAccordionState() {
  const sections = [1, 2, 3, 4, 5, 6]
    .map((step) => document.getElementById(`step${step}`))
    .filter(Boolean);
  sections.forEach((section, index) => {
    const stepNumber = index + 1;
    section.classList.toggle('open', stepNumber === 1);
    section.classList.toggle('collapsed', stepNumber !== 1);
  });
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getDepositMinimumOrder() {
  const value = Number(state.settings?.depositMinimumOrder);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DEPOSIT_THRESHOLD;
}

function requiresDeposit(total = 0) {
  return Number(total || 0) > getDepositMinimumOrder();
}

function getDepositAmount(total = 0) {
  return requiresDeposit(total) ? roundMoney(Number(total || 0) * DEPOSIT_RATE) : 0;
}


function getItemImageSrc(item) {
  return item?.imageData || item?.imageUrl || '';
}

function normalizeAccessories(accessories = []) {
  return Array.isArray(accessories) ? accessories.map((entry) => ({
    id: entry?.id || uid('acc'),
    name: (entry?.name || '').trim(),
    price: Number(entry?.price || 0),
    imageData: entry?.imageData || ''
  })).filter((entry) => entry.name) : [];
}

function getSelectedAccessoryIds(inventoryId) {
  return Array.isArray(state.selectedAccessories[inventoryId]) ? state.selectedAccessories[inventoryId] : [];
}

function getSelectedAccessoriesForItem(item) {
  const selectedIds = getSelectedAccessoryIds(item.id);
  return normalizeAccessories(item.accessories).filter((accessory) => selectedIds.includes(accessory.id));
}

function getDisplayImageForPickerItem(item) {
  const selected = getSelectedAccessoriesForItem(item);
  const accessoryWithImage = [...selected].reverse().find((entry) => entry.imageData);
  return accessoryWithImage?.imageData || getItemImageSrc(item);
}


function normalizeImageUrl(url) {
  if (!url) return '';
  if (/^(https?:)?\/\//.test(url)) return url;
  if (url.startsWith('/')) return url;
  url = url.replace(/^\.\.\//, '').replace(/^\.\//, '');
  if (url.startsWith('images/')) return `/${url}`;
  return `/${url}`;
}

let summaryObserver;

document.addEventListener('DOMContentLoaded', () => { init().catch(console.error); });

async function init() {
  cacheEls();
  renderQuickLoadingPlaceholders();
  await loadData();
  setDefaultDates();
  state.step = 1;
  state.reviewReady = false;
  bindEvents();
  enforceAccordionState();
  setupSummaryObserver();
  render();
  [0, 60, 180, 320].forEach((delay) => {
    window.setTimeout(() => {
      enforceAccordionState();
      renderSections();
      renderActionStates();
      renderSummary();
    }, delay);
  });
}


function cacheEls() {
  Object.assign(els, {
    pickerForm: document.getElementById('pickerForm'),
    pickerStepsWrap: document.getElementById('pickerStepsWrap'),
    summary: document.getElementById('summary'),
    summaryCard: document.getElementById('summaryCard'),
    responseMessage: document.getElementById('responseMessage'),
    mobileTotalBar: document.getElementById('mobileTotalBar'),
    mobileTotalAmount: document.getElementById('mobileTotalAmount'),
    mobileStepCount: document.getElementById('mobileStepCount'),
    mobileTotalWrap: document.getElementById('mobileTotalWrap'),
    step1: document.getElementById('step1'),
    step2: document.getElementById('step2'),
    step3: document.getElementById('step3'),
    step4: document.getElementById('step4'),
    step5: document.getElementById('step5'),
    step6: document.getElementById('step6'),
    nextStep1: document.getElementById('nextStep1'),
    nextStep2: document.getElementById('nextStep2'),
    nextStep3: document.getElementById('nextStep3'),
    nextStep4: document.getElementById('nextStep4'),
    nextStep5: document.getElementById('nextStep5'),
    categoryChips: document.getElementById('categoryChips'),
    eventDate: document.getElementById('eventDate'),
    eventTime: document.getElementById('eventTime'),
    eventName: document.getElementById('eventName'),
    eventNameSkip: document.getElementById('eventNameSkip'),
    receiveDate: document.getElementById('receiveDate'),
    receiveTime: document.getElementById('receiveTime'),
    returnDate: document.getElementById('returnDate'),
    returnTime: document.getElementById('returnTime'),
    availabilityBoard: document.getElementById('availabilityBoard'),
    availabilityPrev: document.getElementById('availabilityPrev'),
    availabilityNext: document.getElementById('availabilityNext'),
    availabilityDateLabel: document.getElementById('availabilityDateLabel'),
    itemChooser: document.getElementById('itemChooser'),
    contactChecks: document.getElementById('contactChecks'),
    contactInputs: document.getElementById('contactInputs'),
    fulfillmentPickup: document.getElementById('fulfillmentPickup'),
    fulfillmentDelivery: document.getElementById('fulfillmentDelivery'),
    deliveryFields: document.getElementById('deliveryFields'),
    pickupName: document.getElementById('pickupName'),
    pickupAddress: document.getElementById('pickupAddress'),
    quotePickupLocationSelect: document.getElementById('quotePickupLocationSelect'),
    quotePickupLocationHelp: document.getElementById('quotePickupLocationHelp'),
    pickupLocationWarning: document.getElementById('pickupLocationWarning'),
    deliveryStreet: document.getElementById('deliveryStreet'),
    deliveryCity: document.getElementById('deliveryCity'),
    deliveryState: document.getElementById('deliveryState'),
    deliveryZip: document.getElementById('deliveryZip'),
    deliveryAddress: document.getElementById('deliveryAddress'),
    deliveryLookupStatus: document.getElementById('deliveryLookupStatus'),
    firstName: document.getElementById('firstName'),
    lastName: document.getElementById('lastName'),
    reviewInquiry: document.getElementById('reviewInquiry'),
    backToContact: document.getElementById('backToContact'),
    reviewSection: document.getElementById('reviewSection'),
    reviewContent: document.getElementById('reviewContent'),
    submitInquiry: document.getElementById('submitInquiry'),
    firebaseLoadingOverlay: document.getElementById('firebaseLoadingOverlay'),
    firebaseLoadingText: document.getElementById('firebaseLoadingText')
  });
}

function publicPickupLocations() {
  const employees = Array.isArray(state.settings?.employeePickupLocations) ? state.settings.employeePickupLocations : [];
  return [
    { id: 'main', employeeUid: '', employeeName: '', name: state.settings?.pickupName || 'Main Pickup Location', address: state.settings?.pickupAddress || '', pickupCoords: state.settings?.pickupCoords || null, allocations: [] },
    ...employees
  ];
}
function activePickupLocation() {
  const locations = publicPickupLocations();
  return locations.find((loc) => loc.id === state.pickupLocationId) || locations[0];
}
function employeeAllocatedQuantity(inventoryId = '') {
  return (state.settings?.employeePickupLocations || []).reduce((sum, loc) => {
    const a = (loc.allocations || []).find((entry) => String(entry.inventoryId) === String(inventoryId));
    return sum + Number(a?.quantity || 0);
  }, 0);
}
function locationStock(inventoryId = '') {
  const inventory = state.inventory.find((item) => item.id === inventoryId);
  const companyStock = Math.max(0, Number(inventory?.stock || 0));
  const location = activePickupLocation();
  if (!location || location.id === 'main') return Math.max(0, companyStock - employeeAllocatedQuantity(inventoryId));
  const a = (location.allocations || []).find((entry) => String(entry.inventoryId) === String(inventoryId));
  return Math.max(0, Number(a?.quantity || 0));
}
function orderPickupLocationId(order = {}) {
  if (order.assignedEmployeeId) return `employee:${order.assignedEmployeeId}`;
  if (String(order.requestedPickupLocationId || '').startsWith('employee:')) return String(order.requestedPickupLocationId);
  return 'main';
}
function populateQuotePickupLocations() {
  if (!els.quotePickupLocationSelect) return;
  const locations = publicPickupLocations();
  if (!locations.some((loc) => loc.id === state.pickupLocationId)) state.pickupLocationId = 'main';
  els.quotePickupLocationSelect.innerHTML = locations.map((loc) => `<option value="${safeText(loc.id)}" ${loc.id === state.pickupLocationId ? 'selected' : ''}>${safeText(loc.address || loc.name || loc.employeeName || 'Pickup Location')}</option>`).join('');
  const active = activePickupLocation();
  if (els.quotePickupLocationHelp) els.quotePickupLocationHelp.textContent = active?.address ? `Pickup address: ${active.address}` : 'Choose where the equipment will be picked up.';
}
function activePickupCoords() { return activePickupLocation()?.pickupCoords || state.settings?.pickupCoords || null; }
function renderQuickLoadingPlaceholders() {
  const loading = '<div class="section-loading-card"><span class="section-loading-spinner" aria-hidden="true"></span><span>Loading from Firebase…</span></div>';
  [els.categoryChips, els.availabilityBoard, els.itemChooser, els.summaryCard].forEach((target) => { if (target) target.innerHTML = loading; });
}

function setFirebaseBusy(isBusy, message = 'Working…') {
  if (els.firebaseLoadingText) els.firebaseLoadingText.textContent = message;
  els.firebaseLoadingOverlay?.classList.toggle('hidden', !isBusy);
  document.body.classList.toggle('firebase-busy', isBusy);
}

async function loadData() {
  setFirebaseBusy(true, 'Loading quote information…');
  try {
  state.inventory = await getInventory();
  state.orders = await getOpenOrders();
  state.settings = await getSettings();
  populateQuotePickupLocations();
  } finally {
    setFirebaseBusy(false);
  }
}

function setDefaultDates() {
  const today = new Date();
  today.setDate(today.getDate() + 2);
  state.eventDate = today.toISOString().slice(0, 10);
  state.eventTime = '12:00';
  state.receiveDate = addDays(state.eventDate, -1);
  state.returnDate = addDays(state.eventDate, 1);
}


function bindEvents() {
  els.quotePickupLocationSelect?.addEventListener('change', () => {
    state.pickupLocationId = els.quotePickupLocationSelect.value || 'main';
    populateQuotePickupLocations();
    const affected = selectedOrderItems().filter((item) => Number(item.quantity || 0) > selectedRangeAvailability(item.inventoryId).available);
    if (els.pickupLocationWarning) {
      els.pickupLocationWarning.classList.toggle('hidden', !affected.length);
      els.pickupLocationWarning.innerHTML = affected.length
        ? `<strong>There was not enough equipment at this location for this order.</strong><div style="margin-top:6px;">Please check equipment and make changes or choose another pickup location.</div><div style="margin-top:6px;"><strong>Affected:</strong> ${affected.map((item) => safeText(item.name)).join(', ')}</div>`
        : '';
    }
    render();
  });
  els.eventDate.value = state.eventDate;
  els.eventTime.value = state.eventTime;
  els.eventName.value = state.eventName;
  els.eventDate.value = state.eventDate;
  els.eventTime.value = state.eventTime;
  els.eventName.value = state.eventName;
  els.receiveDate.value = state.receiveDate;
  els.receiveTime.value = state.receiveTime;
  els.returnDate.value = state.returnDate;
  els.returnTime.value = state.returnTime;

  els.eventDate.addEventListener('input', onEventInput);
  els.eventTime.addEventListener('input', onEventInput);
  els.eventName.addEventListener('input', () => { state.eventName = els.eventName.value.trim(); renderSummary(); });
  els.eventNameSkip?.addEventListener('click', () => { state.eventName = ''; els.eventName.value = ''; advanceTo(3); });
  els.receiveDate.addEventListener('input', onReceiveInput);
  els.receiveTime.addEventListener('input', onReceiveInput);
  els.returnDate.addEventListener('input', onReturnInput);
  els.returnTime.addEventListener('input', onReturnInput);

  const syncDeliveryAddressParts = () => {
    const parts = [els.deliveryStreet?.value, els.deliveryCity?.value, els.deliveryState?.value, els.deliveryZip?.value]
      .map((v) => String(v || '').trim());
    state.deliveryAddress = parts.filter(Boolean).join(', ');
    if (els.deliveryAddress) els.deliveryAddress.value = state.deliveryAddress;
    state.deliveryLookupStatus = state.deliveryAddress ? 'A delivery fee will be discussed.' : '';
    renderFulfillment();
    renderSummary();
    renderActionStates();
  };
  [els.deliveryStreet, els.deliveryCity, els.deliveryState, els.deliveryZip].forEach((input) => input?.addEventListener('input', syncDeliveryAddressParts));

  els.firstName.addEventListener('input', renderActionStates);
  els.lastName.addEventListener('input', renderActionStates);

  els.availabilityPrev.addEventListener('click', () => {
    state.availabilityOffset = Math.max(-3, state.availabilityOffset - 1);
    renderAvailabilityBoard(getVisibleInventory());
  });
  els.availabilityNext.addEventListener('click', () => {
    state.availabilityOffset = Math.min(3, state.availabilityOffset + 1);
    renderAvailabilityBoard(getVisibleInventory());
  });

  els.nextStep1.addEventListener('click', () => advanceTo(3));
  els.nextStep2.addEventListener('click', () => advanceTo(3));
  els.nextStep3.addEventListener('click', () => advanceTo(4));
  els.nextStep4.addEventListener('click', () => advanceTo(5));
  els.nextStep5.addEventListener('click', () => advanceTo(6));
  els.reviewInquiry.addEventListener('click', showReviewSection);
  els.backToContact?.addEventListener('click', () => {
    renderReviewSection();
    advanceTo(6);
  });
  document.querySelectorAll('[data-step-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetStep = Number(button.dataset.stepTarget || 1);
      state.step = Math.min(targetStep, getHighestAllowedStep());
      // Once reviewed, edits may be made without forcing a second Review click.
      renderSections();
      const target = document.getElementById(`step${state.step}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  els.fulfillmentPickup.addEventListener('click', () => {
    state.fulfillmentType = 'Pickup';
    render();
  });
  els.fulfillmentDelivery.addEventListener('click', () => {
    state.fulfillmentType = 'Delivery';
    render();
  });

  els.pickerForm.addEventListener('submit', handleSubmit);
  window.addEventListener('scroll', updateFloatingTotalVisibility, { passive: true });
  window.addEventListener('resize', updateFloatingTotalVisibility);
}



function onEventInput() {
  state.eventDate = els.eventDate.value;
  state.eventTime = els.eventTime.value;
  if (state.eventDate) {
    state.receiveDate = addDays(state.eventDate, -1);
    state.returnDate = addDays(state.eventDate, 1);
    els.receiveDate.value = state.receiveDate;
    els.returnDate.value = state.returnDate;
  }
  state.availabilityOffset = 0;
  render();
}

function onReceiveInput() {
  state.receiveDate = els.receiveDate.value;
  state.receiveTime = els.receiveTime.value;
  state.availabilityOffset = 0;
  syncRange();
  render();
}

function onReturnInput() {
  state.returnDate = els.returnDate.value;
  state.returnTime = els.returnTime.value;
  render();
}

function syncRange() {
  if (!state.returnDate || state.returnDate < state.receiveDate) {
    state.returnDate = addDays(state.receiveDate, 1);
    els.returnDate.value = state.returnDate;
  }
}

function advanceTo(nextStep) {
  state.step = Math.min(nextStep, getHighestAllowedStep());
  // Preserve review readiness while the customer makes corrections.
  renderSections();
  const target = document.getElementById(`step${state.step}`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getHighestAllowedStep() {
  if (!hasReceiveSelection()) return 1;
  if (!hasValidReturnRange()) return 2;
  if (!hasSelectedCategories()) return 3;
  if (!hasSelectedEquipment()) return 4;
  if (!hasFulfillmentSelection()) return 5;
  return 6;
}

function render() {
  renderSubmittedState();
  if (state.submitted) return;
  renderCategories();
  renderAvailabilityAndChooser();
  renderContactMethods();
  renderFulfillment();
  renderSummary();
  renderSections();
  renderActionStates();
}

function renderSubmittedState(isDuplicate = false) {
  els.pickerForm.classList.toggle('hidden', state.submitted);
  els.responseMessage.classList.toggle('hidden', !state.submitted);
els.mobileTotalBar.classList.toggle('hidden', state.submitted);

  if (state.submitted) {
    els.responseMessage.innerHTML = `
      <section class="card staged-card thanks-card">
        <div class="eyebrow">${isDuplicate ? 'Already Received' : 'Request Received'}</div>
        <h1 class="step-title">${isDuplicate ? 'We already have this quote request.' : 'Thank you for reaching out!'}</h1>
        <div class="note-block">${isDuplicate
          ? 'There is no need to submit it again. Our team will reach out soon.'
          : 'Your quote request was submitted successfully. Someone from our team will reach out as soon as possible.'}</div>
        <p class="muted" style="margin:14px 0 0;">We appreciate the opportunity to help with your event.</p>
        <div class="part-time-response-warning">As we are currently part time, response time may be slower than expected. We apologize for any delay.</div>
        <div class="step-actions step-actions-left">
          <button type="button" id="placeAnotherOrder" class="btn btn-primary">Submit a different request</button>
        </div>
      </section>`;
    document.getElementById('placeAnotherOrder')?.addEventListener('click', resetAfterSubmit);
  } else {
    els.responseMessage.innerHTML = '';
  }
}

function renderSections() {
  const highest = getHighestAllowedStep();
  const sections = [els.step1, els.step2, els.step3, els.step4, els.step5, els.step6].filter(Boolean);
  sections.forEach((section, index) => {
    const stepNumber = index + 1;
    if (stepNumber === 2) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    section.classList.toggle('open', stepNumber === state.step);
    section.classList.toggle('collapsed', stepNumber !== state.step);
    section.classList.toggle('completed', stepNumber < state.step);
    section.classList.toggle('locked', stepNumber > highest);
    const toggle = section.querySelector('[data-step-target]');
    if (toggle) toggle.disabled = stepNumber > highest;
  });
  if (els.mobileStepCount) {
    const names = { 1: 'Event Date and Time', 3: 'Category Selection', 4: 'Equipment Selection', 5: 'Pick-Up or Delivery', 6: 'Communication Preference' };
    const displayStep = ({1:1,3:2,4:3,5:4,6:5})[state.step] || 1;
    els.mobileStepCount.textContent = `Step ${displayStep}/5 • ${names[state.step] || ''}`;
  }
  updateFloatingTotalVisibility();
}

function renderActionStates() {
  const affected = selectedOrderItems().filter((item) => Number(item.quantity || 0) > selectedRangeAvailability(item.inventoryId).available);
  if (els.pickupLocationWarning) {
    els.pickupLocationWarning.classList.toggle('hidden', !affected.length);
    els.pickupLocationWarning.innerHTML = affected.length ? `<strong>There was not enough equipment at this location for this order.</strong><div style="margin-top:6px;">Please check equipment and make changes or choose another pickup location.</div><div style="margin-top:6px;"><strong>Affected:</strong> ${affected.map((item) => safeText(item.name)).join(', ')}</div>` : '';
  }
  const canStep1 = hasReceiveSelection();
  const canStep2 = hasValidReturnRange();
  const canStep3 = hasSelectedCategories();
  const canStep4 = hasSelectedEquipment();
  const canStep5 = hasFulfillmentSelection();
  els.nextStep1.disabled = !canStep1;
  els.nextStep2.disabled = !canStep2;
  els.nextStep3.disabled = !canStep3;
  els.nextStep4.disabled = !canStep4;
  els.nextStep5.disabled = !canStep5;
  els.nextStep1.dataset.enabled = String(canStep1);
  els.nextStep2.dataset.enabled = String(canStep2);
  els.nextStep3.dataset.enabled = String(canStep3);
  els.nextStep4.dataset.enabled = String(canStep4);
  els.nextStep5.dataset.enabled = String(canStep5);
  const contactValid = hasValidContactSection();
  els.reviewInquiry.disabled = !contactValid;
  els.submitInquiry.disabled = !contactValid || !state.reviewReady;
}


function renderCategories() {
  const stockedInventory = state.inventory.filter((item) => locationStock(item.id) > 0 || Number(state.selectedItems[item.id] || 0) > 0);
  const availableCategories = [...new Set(stockedInventory.filter((item) => locationStock(item.id) > 0).map((item) => item.category).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const validSelected = [...state.selectedCategories].filter((key) => key === '__all__' || availableCategories.includes(key));
  state.selectedCategories = new Set(validSelected.length ? validSelected : ['__all__']);
  const categories = ['All Categories', ...availableCategories];
  els.categoryChips.innerHTML = categories.map((category, index) => {
    const key = index === 0 ? '__all__' : category;
    const active = state.selectedCategories.has(key);
    return `<button type="button" class="category-chip ${active ? 'active' : ''}" data-category="${safeText(key)}">${index === 0 ? 'All Categories' : safeText(category)} ${active ? '✓' : ''}</button>`;
  }).join('');

  els.categoryChips.querySelectorAll('[data-category]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.category;
    if (key === '__all__') {
      state.selectedCategories = new Set(['__all__']);
    } else {
      state.selectedCategories.delete('__all__');
      state.selectedCategories.has(key) ? state.selectedCategories.delete(key) : state.selectedCategories.add(key);
      if (!state.selectedCategories.size) state.selectedCategories = new Set(['__all__']);
    }
    render();
    renderSections();
    renderActionStates();
  }));
}

function hasSelectedCategories() {
  return state.selectedCategories.size > 0;
}

function getVisibleInventory() {
  const stockedHere = state.inventory.filter((item) => locationStock(item.id) > 0 || Number(state.selectedItems[item.id] || 0) > 0);
  if (state.selectedCategories.has('__all__')) return stockedHere;
  return stockedHere.filter((item) => state.selectedCategories.has(item.category));
}

function hasReceiveSelection() {
  return Boolean(state.eventDate && state.eventTime);
}

function hasValidReturnRange() {
  const start = parseDateTime(state.receiveDate, state.receiveTime);
  const end = parseDateTime(state.returnDate, state.returnTime);
  return Boolean(start && end && end > start);
}

function renderAvailabilityAndChooser() {
  const affected = selectedOrderItems().filter((item) => Number(item.quantity || 0) > selectedRangeAvailability(item.inventoryId).available);
  if (els.pickupLocationWarning) {
    els.pickupLocationWarning.classList.toggle('hidden', !affected.length);
    els.pickupLocationWarning.innerHTML = affected.length ? `<strong>There was not enough equipment at this location for this order.</strong><div style="margin-top:6px;">Please check equipment and make changes or choose another pickup location.</div><div style="margin-top:6px;"><strong>Affected:</strong> ${affected.map((item) => safeText(item.name)).join(', ')}</div>` : '';
  }
  const visible = getVisibleInventory();
  renderAvailabilityBoard(visible);
  renderItemChooser(visible);
}

function renderAvailabilityBoard(visible) {
  if (!visible.length || !hasReceiveSelection()) {
    els.availabilityBoard.innerHTML = '<div class="empty-state">No matching equipment yet.</div>';
    els.availabilityDateLabel.textContent = 'Pick a receive date';
    syncAvailabilityNav();
    return;
  }
  const offset = state.availabilityOffset || 0;
  const currentStart = addDays(state.receiveDate, offset);
  const currentEnd = addDays(state.returnDate, offset);
  const rangeLabel = `${formatShortDate(currentStart)} – ${formatShortDate(currentEnd)}`;
  els.availabilityDateLabel.textContent = rangeLabel;
  els.availabilityBoard.innerHTML = `
    <div class="date-column single-date-column">
      <div class="date-column-head">${safeText(rangeLabel)} window</div>
      <div class="date-item-list compact-date-list">
        ${visible.map((item) => {
          const range = rangeAvailability(item.id, currentStart, state.receiveTime, currentEnd, state.returnTime);
          return `<div class="date-item-row compact"><span>${safeText(item.name)}</span><strong>${range.available} available${range.pending ? ` · ${range.pending} pending` : ''}</strong></div>`;
        }).join('')}
      </div>
    </div>`;
  syncAvailabilityNav();
}

function renderItemChooser(visible) {
  if (!visible.length) {
    els.itemChooser.innerHTML = '';
    return;
  }
  const groups = visible.reduce((acc, item) => {
    acc[item.category] ||= [];
    acc[item.category].push(item);
    return acc;
  }, {});

  els.itemChooser.innerHTML = Object.entries(groups).map(([category, items]) => `
    <div class="category-group">
      <div class="section-header" style="margin-bottom:10px;"><div><strong>${safeText(category)}</strong></div></div>
      <div class="compact-item-list">
        ${items.map((item) => renderChooserItem(item)).join('')}
      </div>
    </div>
  `).join('');

  els.itemChooser.querySelectorAll('[data-select-item]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.selectItem;
    const availability = selectedRangeAvailability(id).available;
    if (availability > 0) {
      state.selectedItems[id] = 1;
      state.selectedAccessories[id] ||= [];
    }
    renderItemChooser(visible);
    renderSummary();
    renderActionStates();
  }));

  els.itemChooser.querySelectorAll('[data-clear-item]').forEach((btn) => btn.addEventListener('click', () => {
    delete state.selectedItems[btn.dataset.clearItem];
    delete state.selectedAccessories[btn.dataset.clearItem];
    renderItemChooser(visible);
    renderSummary();
    renderActionStates();
  }));

  els.itemChooser.querySelectorAll('[data-accessory-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      const inventoryId = input.dataset.accessoryToggle;
      const selected = [...els.itemChooser.querySelectorAll(`[data-accessory-toggle="${inventoryId}"]:checked`)].map((entry) => entry.value);
      state.selectedAccessories[inventoryId] = selected;
      renderItemChooser(visible);
      renderSummary();
      renderActionStates();
    });
  });

  els.itemChooser.querySelectorAll('[data-qty-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const raw = input.value;
      if (raw === '') return;
      const max = Number(input.max || 0);
      const value = Math.max(1, Math.min(max, Number(raw || 0)));
      if (!Number.isFinite(value)) return;
      state.selectedItems[input.dataset.qtyInput] = value;
      renderSummary();
      renderActionStates();
    });

    const commitQty = () => {
      const raw = input.value.trim();
      const max = Number(input.max || 0);
      if (!raw) {
        delete state.selectedItems[input.dataset.qtyInput];
      } else {
        const value = Math.max(1, Math.min(max, Number(raw || 0)));
        if (!Number.isFinite(value) || value <= 0) delete state.selectedItems[input.dataset.qtyInput];
        else state.selectedItems[input.dataset.qtyInput] = value;
      }
      renderItemChooser(visible);
      renderSummary();
      renderActionStates();
    };

    input.addEventListener('change', commitQty);
    input.addEventListener('blur', commitQty);
  });
}

function inventoryBackgroundConfig() {
  const raw = state.settings?.inventoryImageBackground || {};
  const mode = ['solid','linear','radial'].includes(raw.mode) ? raw.mode : 'linear';
  const texture = ['none','noise','dots','grid','linen','diagonal'].includes(raw.texture) ? raw.texture : 'none';
  const color=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value):fallback;
  return {mode,color1:color(raw.color1,'#f8fafc'),color2:color(raw.color2,'#dbeafe'),angle:Math.max(0,Math.min(360,Number(raw.angle??135)||0)),texture,textureOpacity:Math.max(0,Math.min(.45,Number(raw.textureOpacity??.18)||0)),imageScale:Math.max(.55,Math.min(1.8,Number(raw.imageScale??1.08)||1.08)),imageX:Math.max(-25,Math.min(25,Number(raw.imageX??0)||0)),imageY:Math.max(-25,Math.min(25,Number(raw.imageY??0)||0)),shadowEnabled:raw.shadowEnabled!==false,shadowColor:color(raw.shadowColor,'#0f172a'),shadowOpacity:Math.max(0,Math.min(.8,Number(raw.shadowOpacity??.28)||0)),shadowBlur:Math.max(0,Math.min(40,Number(raw.shadowBlur??14)||0)),shadowX:Math.max(-20,Math.min(20,Number(raw.shadowX??0)||0)),shadowY:Math.max(-20,Math.min(20,Number(raw.shadowY??7)||0)),edgeGlow:Math.max(0,Math.min(.6,Number(raw.edgeGlow??.12)||0)),brightness:Math.max(.7,Math.min(1.35,Number(raw.brightness??1)||1)),contrast:Math.max(.7,Math.min(1.5,Number(raw.contrast??1.04)||1.04)),saturation:Math.max(0,Math.min(1.8,Number(raw.saturation??1)||1))};
}
function inventoryBackgroundCss(){const c=inventoryBackgroundConfig(),a=c.textureOpacity;const base=c.mode==='solid'?`linear-gradient(${c.color1},${c.color1})`:c.mode==='radial'?`radial-gradient(circle at 50% 50%,${c.color1} 0%,${c.color2} 100%)`:`linear-gradient(${c.angle}deg,${c.color1} 0%,${c.color2} 100%)`;let t='',size='auto';if(c.texture==='dots'){t=`radial-gradient(circle,rgba(15,23,42,${a}) 1px,transparent 1.5px)`;size='12px 12px, auto';}else if(c.texture==='grid'){t=`linear-gradient(rgba(15,23,42,${a}) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,${a}) 1px,transparent 1px)`;size='18px 18px,18px 18px,auto';}else if(c.texture==='diagonal')t=`repeating-linear-gradient(135deg,rgba(255,255,255,${a}) 0 2px,transparent 2px 9px)`;else if(c.texture==='linen')t=`repeating-linear-gradient(0deg,rgba(255,255,255,${a}) 0 1px,transparent 1px 4px),repeating-linear-gradient(90deg,rgba(15,23,42,${a*.45}) 0 1px,transparent 1px 5px)`;else if(c.texture==='noise'){t=`repeating-radial-gradient(circle at 20% 30%,rgba(15,23,42,${a*.55}) 0 0.7px,transparent .8px 3px)`;size='7px 7px,auto';}return `background-color:${c.color1};background-image:${t?`${t},${base}`:base};background-size:${size};background-position:center;`;}

function inventoryHexRgba(hex,a){const v=/^#[0-9a-f]{6}$/i.test(String(hex||''))?String(hex).slice(1):'0f172a';return `rgba(${parseInt(v.slice(0,2),16)},${parseInt(v.slice(2,4),16)},${parseInt(v.slice(4,6),16)},${a})`;}
function inventoryImageCss(){const c=inventoryBackgroundConfig(),f=[];if(c.shadowEnabled&&c.shadowOpacity>0)f.push(`drop-shadow(${c.shadowX}px ${c.shadowY}px ${c.shadowBlur}px ${inventoryHexRgba(c.shadowColor,c.shadowOpacity)})`);if(c.edgeGlow>0)f.push(`drop-shadow(0 0 1.5px rgba(255,255,255,${c.edgeGlow}))`,`drop-shadow(0 0 1px rgba(15,23,42,${c.edgeGlow*.55}))`);f.push(`brightness(${c.brightness})`,`contrast(${c.contrast})`,`saturate(${c.saturation})`);return `transform:translate(${c.imageX}%,${c.imageY}%) scale(${c.imageScale});transform-origin:center;filter:${f.join(' ')};`;}

function renderChooserItem(item) {
  const selectedQty = Number(state.selectedItems[item.id] || 0);
  const availabilityNow = selectedRangeAvailability(item.id);
  const isSelected = selectedQty > 0;
  const locationShortage = isSelected && selectedQty > availabilityNow.available;
  const accessories = normalizeAccessories(item.accessories);
  const selectedAccessoryIds = getSelectedAccessoryIds(item.id);
  return `
    <div class="picker-card compact-picker-card ${isSelected ? 'selected' : ''} ${locationShortage ? 'location-shortage' : ''}">
      <div class="compact-picker-main">
        <span class="picker-image compact inventory-image-surface" style="${inventoryBackgroundCss()}"><img class="inventory-transparent-image" style="${inventoryImageCss()}" src="${getDisplayImageForPickerItem(item)}" alt="${safeText(item.name)}" /></span>
        <div class="stack-sm picker-item-content">
          <strong>${safeText(item.name)}</strong>
          <span class="small">${safeText(item.description || '')}</span>
          <div class="small muted">${currency(item.price)} per unit</div>
          <div><span class="badge badge-green">Available: ${availabilityNow.available}</span> <span class="badge badge-blue">Confirmed: ${availabilityNow.confirmed}</span> <span class="badge badge-yellow">Pending: ${availabilityNow.pending}</span></div>
          ${locationShortage ? '<div class="equipment-check-warning">Please check equipment and make changes or choose another pickup location</div>' : ''}
          ${isSelected && accessories.length ? `
            <div class="accessory-picker-list">
              ${accessories.map((accessory) => `
                <label class="accessory-check ${selectedAccessoryIds.includes(accessory.id) ? 'selected' : ''}">
                  <input type="checkbox" data-accessory-toggle="${item.id}" value="${accessory.id}" ${selectedAccessoryIds.includes(accessory.id) ? 'checked' : ''} />
                  <span><strong>Add ${safeText(accessory.name)}</strong><small>${currency(accessory.price)} each</small></span>
                </label>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <div class="compact-picker-actions">
          ${isSelected
            ? `<div class="qty-pop"><label class="small">Qty</label><input type="number" min="1" max="${Math.max(1, availabilityNow.available)}" step="1" data-qty-input="${item.id}" value="${selectedQty}" /></div><button type="button" class="btn btn-secondary btn-small" data-clear-item="${item.id}">Remove</button>`
            : `<button type="button" class="btn btn-primary btn-small" data-select-item="${item.id}" ${availabilityNow.available <= 0 ? 'disabled' : ''}>${availabilityNow.available <= 0 ? 'Unavailable' : 'Choose'}</button>`}
        </div>
      </div>
    </div>`;
}

function syncAvailabilityNav() {
  els.availabilityPrev.disabled = state.availabilityOffset <= -3;
  els.availabilityNext.disabled = state.availabilityOffset >= 3;
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

function selectedRangeAvailability(inventoryId) {
  return rangeAvailability(inventoryId, state.receiveDate, state.receiveTime, state.returnDate, state.returnTime);
}

function rangeAvailability(inventoryId, startDate, startTime, endDate, endTime) {
  const inventory = state.inventory.find((item) => item.id === inventoryId);
  const confirmedRangeQty = quantityBookedForRange(inventoryId, startDate, startTime, endDate, endTime, ['Confirmed', 'In-Progress']);
  const pendingQty = quantityBookedForRange(inventoryId, startDate, startTime, endDate, endTime, ['Pending']);
  const totalHeld = confirmedRangeQty + pendingQty;
  return {
    available: Math.max(0, locationStock(inventoryId) - totalHeld),
    confirmed: confirmedRangeQty,
    pending: pendingQty
  };
}

function quantityBookedForRange(inventoryId, startDate, startTime, endDate, endTime, statuses) {
  // Match Admin Quick Peek exactly: any Pending, Confirmed, or In-Progress order
  // whose exchange-to-return date range touches this quote window holds inventory.
  // Times are intentionally ignored here because the admin availability board is
  // date-range based and customers should never see looser availability than admin.
  if (!startDate || !endDate) return 0;
  return state.orders
    .filter((order) => orderPickupLocationId(order) === (state.pickupLocationId || 'main'))
    .filter((order) => statusMatchesOrder(order, statuses))
    .reduce((sum, order) => {
      const qty = orderQuantityForInventory(order, inventoryId);
      if (!qty) return sum;
      const orderRange = orderDateRange(order);
      if (!dateRangeOverlaps(startDate, endDate, orderRange.startDate, orderRange.endDate)) return sum;
      return sum + qty;
    }, 0);
}

function availabilityForSingleDay(inventoryId, date) {
  const range = rangeAvailability(inventoryId, date, state.receiveTime, date, state.returnTime || '23:00');
  return range.available;
}

function hasLocationStockIssues() {
  return selectedOrderItems().some((item) => Number(item.quantity || 0) > selectedRangeAvailability(item.inventoryId).available);
}

function hasSelectedEquipment() {
  return selectedOrderItems().length > 0 && !hasLocationStockIssues();
}

function isValidPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function formatPhoneInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
}

function renderContactMethods() {
  els.contactChecks.innerHTML = CONTACT_METHODS.map((method) => `
    <label class="check-pill"><input type="checkbox" data-contact-method value="${method.key}" ${state.selectedContactMethods.includes(method.key) ? 'checked' : ''} /> ${method.label}</label>
  `).join('');
  els.contactChecks.querySelectorAll('[data-contact-method]').forEach((input) => input.addEventListener('change', () => {
    state.selectedContactMethods = [...els.contactChecks.querySelectorAll('[data-contact-method]:checked')].map((entry) => entry.value);
    paintContactInputs();
    renderActionStates();
  }));
  paintContactInputs();
}

function paintContactInputs() {
  const activeElement = document.activeElement;
  const activeName = activeElement?.name || '';
  const activePos = typeof activeElement?.selectionStart === 'number' ? activeElement.selectionStart : null;

  els.contactInputs.innerHTML = state.selectedContactMethods.map((key) => {
    const meta = CONTACT_METHODS.find((entry) => entry.key === key);
    if (key === 'facebook') {
      return `<div class="note-block small">This option is for customers who contacted us through Facebook Messenger. If you have not already established a conversation in Facebook Messenger, please choose another option.</div>`;
    }
    const type = key === 'email' ? 'email' : key === 'text' ? 'tel' : 'text';
    const inputMode = key === 'text' ? 'tel' : key === 'email' ? 'email' : 'text';
    const extra = key === 'text' ? 'maxlength="14"' : '';
    return `<div class="form-row"><label>${meta.label}${key === 'text' || key === 'email' ? ' <span class="required-mark">*</span>' : ''}</label><input type="${type}" inputmode="${inputMode}" name="contact_${key}" placeholder="${meta.placeholder}" value="${safeText(state.contactValues[key] || '')}" ${extra} /></div>`;
  }).join('');

  els.contactInputs.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.name.replace('contact_', '');
      let value = input.value;
      if (key === 'text') {
        value = formatPhoneInput(value);
        input.value = value;
      }
      state.contactValues[key] = value;
      renderActionStates();
    });
  });

  if (activeName) {
    const replacement = els.contactInputs.querySelector(`[name="${activeName}"]`);
    if (replacement) {
      replacement.focus();
      if (activePos !== null) replacement.setSelectionRange(activePos, activePos);
    }
  }
}

function hasFulfillmentSelection() {
  if (state.fulfillmentType === 'Pickup') return true;
  if (state.fulfillmentType === 'Delivery') return Boolean((els.deliveryStreet?.value || '').trim() && (els.deliveryCity?.value || '').trim() && (els.deliveryState?.value || '').trim() && (els.deliveryZip?.value || '').trim());
  return false;
}

function hasValidContactSection() {
  const first = (els.firstName.value || '').trim();
  const last = (els.lastName.value || '').trim();
  if (!first || !last || !state.selectedContactMethods.length) return false;

  return state.selectedContactMethods.every((key) => {
    if (key === 'facebook') return true;
    if (key === 'text') return isValidPhone(String(state.contactValues.text || '').trim());
    if (key === 'email') return isValidEmail(String(state.contactValues.email || '').trim());
    const value = String(state.contactValues[key] || '').trim();
    return Boolean(value);
  });
}

function renderFulfillment() {
  els.fulfillmentPickup.classList.toggle('active', state.fulfillmentType === 'Pickup');
  els.fulfillmentDelivery.classList.toggle('active', state.fulfillmentType === 'Delivery');
  els.deliveryFields.classList.toggle('hidden', state.fulfillmentType !== 'Delivery');
  const pickupLocation = activePickupLocation();
  els.pickupName.textContent = pickupLocation?.name || state.settings.pickupName || 'Pickup location';
  els.pickupAddress.textContent = pickupLocation?.address || state.settings.pickupAddress || 'Add pickup address in admin settings.';
  populateQuotePickupLocations();
  if (els.deliveryLookupStatus) els.deliveryLookupStatus.textContent = state.deliveryLookupStatus || '';
  if (state.fulfillmentType === 'Delivery' && !state.deliveryLookupStatus && els.deliveryLookupStatus) {
    els.deliveryLookupStatus.textContent = 'A delivery fee will be discussed.';
  }
}

function selectedOrderItems() {
  return state.inventory
    .filter((item) => Number(state.selectedItems[item.id] || 0) > 0)
    .map((item) => {
      const quantity = Number(state.selectedItems[item.id] || 0);
      const selectedAccessories = getSelectedAccessoriesForItem(item);
      const accessorySubtotal = selectedAccessories.reduce((sum, accessory) => sum + (Number(accessory.price || 0) * quantity), 0);
      return {
        inventoryId: item.id,
        name: item.name,
        quantity,
        price: Number(item.price || 0),
        accessories: selectedAccessories.map((accessory) => ({
          id: accessory.id,
          name: accessory.name,
          price: Number(accessory.price || 0),
          imageData: accessory.imageData || ''
        })),
        accessorySubtotal,
        subtotal: (Number(item.price || 0) * quantity) + accessorySubtotal
      };
    });
}

function computeTotals() {
  const items = selectedOrderItems();
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return {
    items,
    subtotal,
    deliveryFee: 0,
    total: subtotal
  };
}

function renderReviewSection() {
  const { items, subtotal, deliveryFee, total } = computeTotals();
  const canSubmit = hasValidContactSection();
  const contactLines = state.selectedContactMethods.map((key) => {
    if (key === 'facebook') return '<div class="kv-row"><span>Facebook Messenger</span><strong>Existing conversation</strong></div>';
    const meta = CONTACT_METHODS.find((entry) => entry.key === key);
    return `<div class="kv-row"><span>${safeText(meta?.label || key)}</span><strong>${safeText(state.contactValues[key] || '')}</strong></div>`;
  }).join('');
  const itemsHtml = items.map((item) => {
    const accessories = item.accessories?.length
      ? `<div class="small muted">Accessories: ${item.accessories.map((accessory) => `${safeText(accessory.name)} (${currency(accessory.price)} each)`).join(', ')}</div>`
      : '';
    return `<div class="kv-row-block"><div class="kv-row"><span>${safeText(item.name)} × ${item.quantity}</span><strong>${currency(item.subtotal)}</strong></div>${accessories}</div>`;
  }).join('') || '<div class="muted">No equipment selected yet.</div>';
  els.reviewContent.innerHTML = `
    <div class="kv">
      <div class="kv-row"><span>Name</span><strong>${safeText((els.firstName.value || '').trim())} ${safeText((els.lastName.value || '').trim())}</strong></div>
      <div class="kv-row"><span>Event</span><strong>${safeText(state.eventName || 'No event provided')}</strong></div>
      <div class="kv-row"><span>Event date</span><strong>${safeText(formatDateTime(state.eventDate, state.eventTime))}</strong></div>
      <div class="note-block small">Date and time of the equipment exchanges will be discussed before confirmation.</div>
      <div class="kv-row"><span>Fulfillment</span><strong>${safeText(state.fulfillmentType || '--')}</strong></div>
      <div class="kv-row"><span>${state.fulfillmentType === 'Delivery' ? 'Delivery address' : 'Pickup address'}</span><strong>${safeText(state.fulfillmentType === 'Delivery' ? (els.deliveryAddress.value || state.deliveryAddress || '--') : (activePickupLocation()?.address || state.settings.pickupAddress || '--'))}</strong></div>
      ${contactLines}
      <div class="hr"></div>
      ${itemsHtml}
      <div class="hr"></div>
      ${state.fulfillmentType === 'Delivery' ? '<div class="note-block small"><strong>Delivery fee:</strong> A delivery fee will be discussed.</div>' : '<div class="kv-row"><span>Delivery fee</span><strong>Pickup selected</strong></div>'}
      <div class="kv-row"><span>Order total</span><strong>${currency(total)}</strong></div>
      <div class="review-submit-inline"><button type="submit" class="btn btn-primary review-submit-inline-btn" ${canSubmit && state.reviewReady ? '' : 'disabled'}>Submit</button></div>
    </div>`;
  els.reviewSection?.classList.toggle('hidden', !state.reviewReady);
  if (els.submitInquiry) {
    els.submitInquiry.disabled = !canSubmit || !state.reviewReady;
    els.submitInquiry.classList.add('hidden');
    els.submitInquiry.style.display = 'none';
  }
  if (state.reviewReady) els.reviewSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function renderSummary() {
  const { items, subtotal, deliveryFee, total } = computeTotals();
  const itemsHtml = items.length
    ? items.map((item) => {
        const accessoryText = item.accessories?.length
          ? `<div class="small muted">+ ${item.accessories.map((accessory) => `${safeText(accessory.name)} (${currency(accessory.price)} each)`).join(', ')}</div>`
          : '';
        return `<div class="kv-row-block"><div class="kv-row"><span>${safeText(item.name)} × ${item.quantity}</span><strong>${currency(item.subtotal)}</strong></div>${accessoryText}</div>`;
      }).join('')
    : '<div class="muted">No equipment selected yet.</div>';

  if (els.summary) {
    els.summary.innerHTML = '';
  }

  els.mobileTotalAmount.textContent = currency(total);
  renderReviewSection();
  updateFloatingTotalVisibility();
}


function showReviewSection() {
  if (!hasValidContactSection()) return;
  state.reviewReady = true;
  renderReviewSection();
  renderFulfillment();
  renderSections();
  renderActionStates();
}


function setupSummaryObserver() {
  if (!('IntersectionObserver' in window)) return;
  summaryObserver = new IntersectionObserver((entries) => {
    state.summaryVisible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.2);
    updateFloatingTotalVisibility();
  }, { threshold: [0.2, 0.6] });
  if (els.summaryCard) summaryObserver.observe(els.summaryCard);
}

function updateFloatingTotalVisibility() {
  const shouldShowBar = !state.submitted;
  const shouldShowTotal = !state.submitted;
  els.mobileTotalBar.classList.toggle('hidden', !shouldShowBar);
  els.mobileTotalWrap?.classList.toggle('hidden', !shouldShowTotal);
  els.mobileTotalBar.classList.remove('faded');
}

function generateQuoteTrackingCode(existingCodes = new Set()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    code = `${code.slice(0, 4)}-${code.slice(4)}`;
  } while (existingCodes.has(code));
  return code;
}

function generateQuoteAccessCode(existingCodes = new Set()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (existingCodes.has(code));
  return code;
}

function stableOrderFingerprint(order) {
  const normalized = {
    firstName: String(order.firstName || '').trim().toLowerCase(),
    lastName: String(order.lastName || '').trim().toLowerCase(),
    eventDate: order.eventDate || '', eventTime: order.eventTime || '', eventName: String(order.eventName || '').trim().toLowerCase(),
    fulfillmentType: order.fulfillmentType || '', address: String(order.address || '').trim().toLowerCase(),
    items: (order.items || []).map((item) => [item.inventoryId || item.name || '', Number(item.quantity || 0), Number(item.unitPrice || 0)]).sort(),
    contactMethods: order.contactMethods || {}
  };
  const text = JSON.stringify(normalized);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `quote_${(hash >>> 0).toString(36)}`;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!hasValidContactSection() || !state.reviewReady) return;
  const form = new FormData(els.pickerForm);
  const { items, subtotal, deliveryFee, total } = computeTotals();
  const contactValues = Object.fromEntries(state.selectedContactMethods.map((key) => {
    if (key === 'facebook') return [key, 'Established via Facebook Messenger'];
    return [key, form.get(`contact_${key}`) || state.contactValues[key] || ''];
  }));
  const contactMap = buildContactMap(state.selectedContactMethods, contactValues);
  const order = {
    id: '',
    firstName: (form.get('firstName') || '').trim(),
    lastName: (form.get('lastName') || '').trim(),
    status: 'Pending',
    paymentStatus: 'Un-Paid',
    fulfillmentType: state.fulfillmentType,
    verbalConfirmation: false,
    address: state.fulfillmentType === 'Delivery' ? (form.get('deliveryAddress') || '').trim() : '',
    eventDate: state.eventDate,
    eventTime: state.eventTime,
    eventName: state.eventName,
    exchangeDate: state.receiveDate,
    exchangeTime: state.receiveTime,
    returnDate: state.returnDate,
    returnTime: state.returnTime,
    deliveryMiles: 0,
    deliveryMinutes: 0,
    deliveryFee,
    deliveryNeedsReview: state.fulfillmentType === 'Delivery',
    deliveryEstimateSource: '',
    deliveryCoords: null,
    pickupCoordsSnapshot: null,
    requestedPickupLocationId: activePickupLocation()?.id || 'main',
    requestedPickupLocationName: activePickupLocation()?.name || '',
    requestedPickupAddress: activePickupLocation()?.address || '',
    assignedEmployeeId: activePickupLocation()?.employeeUid || '',
    assignedEmployeeName: activePickupLocation()?.employeeName || '',
    assignedEmployeePickupAddress: activePickupLocation()?.employeeUid ? (activePickupLocation()?.address || '') : '',
    addressSnapshot: state.fulfillmentType === 'Delivery' ? state.deliveryAddress : '',
    total,
    amountPaid: 0,
    amountRemaining: total,
    requiresDeposit: requiresDeposit(total),
    depositAmount: getDepositAmount(total),
    items,
    contactMethods: contactMap,
    trackingCode: generateQuoteTrackingCode(new Set(state.orders.map((entry) => String(entry.trackingCode || '').trim()).filter(Boolean))),
    trackingAccessCode: generateQuoteAccessCode(new Set(state.orders.map((entry) => String(entry.trackingAccessCode || '').trim()).filter(Boolean))),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: '',
    newInquiry: true,
    source: 'quick-picker',
    subtotal
  };
  order.id = stableOrderFingerprint(order);
  setFirebaseBusy(true, 'Submitting your quote request…');
  try {
    await createQuickPickerOrder(order);
    state.orders = [order, ...state.orders.filter((item) => item.id !== order.id)];
    state.settings = await getSettings();
    try {
      const notificationResult = await sendInquiryNotification(state.settings, order);
      state.notificationResult = notificationResult;
    } catch (notificationError) {
      state.notificationResult = { status: 'failed', reason: notificationError?.message || 'Notification failed.' };
      console.error('Inquiry email notification failed:', notificationError);
    }
    state.lastSubmittedOrder = order;
    state.submitted = true;
    renderSubmittedState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    if (error?.code === 'duplicate-order') {
      state.lastSubmittedOrder = order;
      state.notificationResult = null;
      state.submitted = true;
      renderSubmittedState(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    console.error('Quote submission failed:', error);
    alert('We could not submit your request. Please wait a moment and try again.');
  } finally {
    setFirebaseBusy(false);
  }
}

function resetAfterSubmit() {
  els.pickerForm.reset();
  state.selectedCategories = new Set();
  state.eventName = '';
  state.selectedItems = {};
  state.selectedAccessories = {};
  state.selectedContactMethods = [];
  state.contactValues = {};
  state.fulfillmentType = '';
  state.deliveryAddress = '';
  state.deliveryLookupStatus = '';
  state.reviewReady = false;
  state.notificationResult = null;
  state.availabilityOffset = 0;
  state.step = 1;
  state.submitted = false;
  state.summaryVisible = false;
  state.lastSubmittedOrder = null;
  state.pickupLocationId = 'main';
  populateQuotePickupLocations();
  [els.deliveryStreet, els.deliveryCity, els.deliveryZip].forEach((input) => { if (input) input.value = ''; });
  if (els.deliveryState) els.deliveryState.value = 'NC';
  setDefaultDates();
  els.eventDate.value = state.eventDate;
  els.eventTime.value = state.eventTime;
  els.eventName.value = state.eventName;
  els.receiveDate.value = state.receiveDate;
  els.receiveTime.value = state.receiveTime;
  els.returnDate.value = state.returnDate;
  els.returnTime.value = state.returnTime;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
