import { getPublicReview, getPublicTrackingRecord, getPublicTrackingRecords, getSettings, getSession, savePublicReview } from './store.js?v=rental-ux-v40';
import { currency, formatDateTime, safeText } from './utils.js';

const els = {};
const TRACKING_VERSION = 'v28-single-ticket-ios-safe';
const state = { records: [], settings: {}, trackingUrl: '', activeRecord: null, activeReview: null, verifiedCodes: new Set(), adminSession: null };
const PAYMENT_METHOD_ORDER = ['cash', 'invoice', 'venmo', 'paypal', 'cashapp', 'zelle', 'googlepay', 'crypto'];
const PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  invoice: 'Invoice',
  venmo: 'Venmo',
  paypal: 'PayPal',
  cashapp: 'Cash App',
  zelle: 'Zelle',
  googlepay: 'Google Pay',
  crypto: 'Crypto'
};

document.addEventListener('DOMContentLoaded', () => init().catch(handleFatalError));

async function init() {
  console.log('TRACKING VERSION:', TRACKING_VERSION);
  cacheEls();
  bindStaticEvents();
  state.trackingUrl = getCanonicalTrackingUrl();
  if (isMessengerBrowser()) {
    renderMessengerInterstitial();
    return;
  }
  const code = getRequestedCode();
  if (code) showTicketLoading(code);
  else if (els.trackingStatus) els.trackingStatus.innerHTML = '<div class="section-loading-card"><span class="section-loading-spinner" aria-hidden="true"></span><span>Loading from Firebase…</span></div>';
  els.trackingForm?.addEventListener('submit', handleSubmit);
  if (code) {
    // Normal customer links stay single-read and do not wait for Auth. Admin order links
    // include ?admin=1 so an already signed-in admin can bypass the 4-character gate.
    const adminRequested = new URLSearchParams(window.location.search).get('admin') === '1';
    const [record, settings, session] = await withTimeout(
      Promise.all([
        getPublicTrackingRecord(normalizeCode(code)),
        getSettings().catch(() => ({})),
        adminRequested ? getSession().catch(() => null) : Promise.resolve(null)
      ]),
      12000,
      'Ticket loading timed out. Please check your connection and try again.'
    );
    state.settings = settings || {};
    state.records = record ? [record] : [];
    state.adminSession = session || null;
    if (state.adminSession && record) state.verifiedCodes.add(normalizeCode(record.trackingCode || code));
    els.trackingCodeInput.value = normalizeCode(code);
    await renderTracking(code);
    return;
  }

  // The no-code tracking screen may show the admin list, so Auth is only needed here.
  state.settings = await getSettings().catch(() => ({}));
  state.adminSession = await getSession().catch(() => null);
  state.records = state.adminSession ? await getPublicTrackingRecords() : [];
  if (state.adminSession) {
    renderAdminTrackingList();
  } else if (els.trackingStatus) {
    els.trackingStatus.textContent = 'Enter your tracking number.';
  }
}

function withTimeout(promise, ms, message = 'Request timed out.') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function cacheEls() {
  Object.assign(els, {
    trackingForm: document.getElementById('trackingForm'),
    trackingCodeInput: document.getElementById('trackingCodeInput'),
    trackingStatus: document.getElementById('trackingStatus'),
    trackingResult: document.getElementById('trackingResult'),
    tipModalWrap: document.getElementById('tipModalWrap'),
    tipModalBody: document.getElementById('tipModalBody'),
    tipModalCloseBtn: document.getElementById('tipModalCloseBtn')
  });
}

function bindStaticEvents() {
  els.tipModalCloseBtn?.addEventListener('click', closeTipModal);
  els.tipModalWrap?.addEventListener('click', (event) => {
    if (event.target === els.tipModalWrap) closeTipModal();
  });
  document.addEventListener('click', (event) => {
    const copyBtn = event.target.closest('[data-copy-payment]');
    if (copyBtn) {
      copyToClipboard(copyBtn.dataset.copyPayment || '', copyBtn);
      return;
    }
    const tipBtn = event.target.closest('[data-open-tip-modal]');
    if (tipBtn) {
      openTipModal();
    }
    const switchVerifyBtn = event.target.closest('[data-switch-verify]');
    if (switchVerifyBtn) {
      const target = document.getElementById(`verify_${switchVerifyBtn.dataset.switchVerify}`);
      target?.focus();
    }
  });
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('#reviewForm');
    if (!form) return;
    event.preventDefault();
    await handleReviewSubmit(form);
  });
}

function normalizeCode(value = '') {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.{4,}$)/, '$1-');
}

function isMessengerBrowser() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Messenger|FB_IAB|FB4A|Meta/i.test(ua);
}

function getRequestedCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('c') || params.get('code') || window.location.hash.replace(/^#/, '') || '';
}

function getCanonicalTrackingUrl() {
  const url = new URL(window.location.href);
  const requestedCode = getRequestedCode();
  url.hash = '';
  url.search = '';
  if (requestedCode) url.searchParams.set('c', normalizeCode(requestedCode));
  return url.toString();
}

function renderMessengerInterstitial() {
  const ua = navigator.userAgent || '';
  const isIos = /iPhone|iPad|Macintosh/i.test(ua);
  const dotsLabel = isIos ? 'three dots at the bottom' : 'three dots at the top right';
  document.body.innerHTML = `
    <div style="min-height:100vh; background:#eef3f9; box-sizing:border-box; padding:18px 12px 32px; font-family:Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#14213d;">
      <div style="max-width:620px; margin:0 auto; position:relative;">
        <div style="position:absolute; top:8px; right:10px; font-size:72px; line-height:1; color:#2f66e8; font-weight:900; transform:rotate(-10deg);">↗</div>
        <div style="background:#fff; border:1px solid #d8e1ef; border-radius:28px; box-shadow:0 12px 30px rgba(20,33,61,0.08); padding:28px 22px 24px; margin-top:56px;">
          <div style="font-size:14px; letter-spacing:0.16em; text-transform:uppercase; color:#2f66e8; font-weight:800; margin-bottom:10px;">Rent Some Chairs</div>
          <h1 style="font-size:40px; line-height:1.02; margin:0 0 12px; font-weight:800; letter-spacing:-0.04em;">Open in your browser</h1>
          <p style="font-size:18px; line-height:1.35; color:#56657f; margin:0 0 18px;">Unfortunately, tracking does not work inside Messenger.</p>
          <div style="background:#f5f8ff; border:1px solid #d8e1ef; border-radius:20px; padding:16px 16px 14px; margin-bottom:16px;">
            <ol style="margin:0; padding-left:22px; color:#223250; line-height:1.6; font-size:16px;">
              <li>Tap the <strong>${safeText(dotsLabel)}</strong>.</li>
              <li>Tap <strong>Open in browser</strong> or <strong>Open in external browser</strong>.</li>
              <li>If it asks which browser to use, choose <strong>Safari</strong> or <strong>Chrome</strong>.</li>
            </ol>
          </div>
          <div style="display:grid; gap:12px;">
            <div style="border:1px solid #d8e1ef; border-radius:18px; padding:14px 16px;"><strong>iPhone / iPad:</strong> Tap the three dots at the bottom, then tap <strong>Open in browser</strong>.</div>
            <div style="border:1px solid #d8e1ef; border-radius:18px; padding:14px 16px;"><strong>Android:</strong> Tap the three dots at the top right, then tap <strong>Open in browser</strong> or <strong>Open in external browser</strong>.</div>
            <div style="border:1px solid #d8e1ef; border-radius:18px; padding:14px 16px;"><strong>If you do not see that option:</strong> Copy the link from Messenger and paste it into Chrome or Safari.</div>
          </div>
          <div style="margin-top:16px; border:1px dashed #c7d3ea; border-radius:18px; padding:12px 14px; background:#fbfcff;">
            <div style="font-size:13px; font-weight:700; color:#2f66e8; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.08em;">Tracking Link</div>
            <div style="font-size:14px; color:#56657f; line-height:1.45; overflow-wrap:anywhere; user-select:all;">${safeText(state.trackingUrl)}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function showTicketLoading(code) {
  if (els.trackingCodeInput) els.trackingCodeInput.value = normalizeCode(code);
  if (els.trackingForm) els.trackingForm.classList.add('hidden');
  if (els.trackingStatus) {
    els.trackingStatus.innerHTML = `<div class="ticket-loading-card"><div class="app-busy-spinner"></div><strong>Loading your order ticket…</strong><div class="small muted">Please wait while we pull up your ticket.</div></div>`;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  await renderTracking(els.trackingCodeInput?.value || '');
}


function normalizeAccessCode(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function renderVerificationGate(record = {}) {
  return `<div class="card" style="padding:18px; margin-top:18px;">
    <div class="section-header"><div><div class="eyebrow">Protected Ticket</div><h2 style="margin:6px 0 0;">Enter your 4-character access code</h2><div class="small muted">Tracking Number: ${safeText(record.trackingCode || '')}</div></div></div>
    <form id="ticketVerifyForm" class="form-grid">
      <div class="note-block small">Use the four-letter/number code included with your order reminder.</div>
      <div class="form-row"><label>Access code</label><input id="verify_access" type="text" inputmode="text" maxlength="4" autocomplete="one-time-code" placeholder="AB12" style="text-transform:uppercase;letter-spacing:.25em;font-weight:800;" required /></div>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;"><button type="submit" class="btn btn-primary">View My Order</button><span id="ticketVerifyError" class="small" style="color:#b91c1c;"></span></div>
    </form>
  </div>`;
}

function bindVerificationForm(record = {}) {
  const form = document.getElementById('ticketVerifyForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const typed = normalizeAccessCode(document.getElementById('verify_access')?.value || '');
    const stored = normalizeAccessCode(record.trackingAccessCode || '');
    if (!stored || typed !== stored) {
      const error = document.getElementById('ticketVerifyError');
      if (error) error.textContent = 'That access code does not match this order. Please try again.';
      return;
    }
    state.verifiedCodes.add(normalizeCode(record.trackingCode || ''));
    await renderTracking(record.trackingCode || '');
  });
}

function getEffectiveTotal(order = {}) {
  if (order.adjustedTotal !== '' && order.adjustedTotal != null && !Number.isNaN(Number(order.adjustedTotal))) return Number(order.adjustedTotal);
  if (!Number.isNaN(Number(order.total))) return Number(order.total || 0);
  return Number(order.baseTotal || 0);
}

function getListedTotal(order = {}) {
  if (!Number.isNaN(Number(order.listedTotal))) return Number(order.listedTotal || 0);
  return getEffectiveTotal(order);
}

function getOutstandingAmount(record = {}) {
  if (Number.isFinite(Number(record.amountRemaining)) && Number(record.amountRemaining) >= 0 && ['Paid', 'Free', 'Deposit Paid', 'Deposit'].includes(record.paymentStatus)) return Number(record.amountRemaining || 0);
  const total = getEffectiveTotal(record);
  if (['Paid', 'Free'].includes(record.paymentStatus)) return 0;
  if (['Deposit Paid', 'Deposit'].includes(record.paymentStatus)) {
    const candidates = [record.depositPaidAmount, record.amountPaid, record.depositAmount];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return Math.max(0, total - value);
    }
  }
  return total;
}

function buildPaymentMethods(record = {}, includeCash = true) {
  const options = state.settings?.paymentOptions || {};
  return PAYMENT_METHOD_ORDER
    .filter((key) => includeCash || key !== 'cash')
    .map((key) => ({ key, ...(options[key] || {}) }))
    .filter((entry) => entry.active);
}

function buildPaymentUrl(method, amount, record) {
  const rawValue = String(method?.value || '').trim();
  const rawUrl = String(method?.url || '').trim();
  const note = encodeURIComponent(`${state.settings?.businessName || 'Rent Some Chairs'} ${record?.trackingCode || ''}`.trim());
  const amountFixed = Number(amount || 0).toFixed(2);
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (!url.searchParams.get('amount') && amount > 0) url.searchParams.set('amount', amountFixed);
      return url.toString();
    } catch {
      return rawUrl;
    }
  }
  if (method.key === 'venmo' && rawValue) return `https://venmo.com/${rawValue.replace(/^@/, '')}?txn=pay&amount=${amountFixed}&note=${note}`;
  if (method.key === 'paypal' && rawValue) {
    const value = rawValue.replace(/^https?:\/\/(www\.)?paypal\.me\//i, '').replace(/^paypal\.me\//i, '');
    return `https://www.paypal.me/${value}/${amountFixed}`;
  }
  if (method.key === 'cashapp' && rawValue) return `https://cash.app/$${rawValue.replace(/^[$@]/, '')}?amount=${amountFixed}`;
  return '';
}

function renderPaymentCards(record = {}) {
  const methods = buildPaymentMethods(record, true);
  if (!methods.length) return '';
  const depositAvailable = record.requiresDeposit && !record.depositWaived && !['Deposit Paid', 'Paid', 'Free'].includes(record.paymentStatus) && Number(record.depositAmount || 0) > 0;
  const fullAmount = getOutstandingAmount(record);
  const sections = [];
  if (depositAvailable) sections.push({ title: `Pay Deposit (${currency(record.depositAmount || 0)})`, amount: Number(record.depositAmount || 0) });
  if (fullAmount > 0) sections.push({ title: depositAvailable ? `Or Pay Full Remaining Amount (${currency(fullAmount)})` : `Pay Order (${currency(fullAmount)})`, amount: fullAmount });
  if (!sections.length) return '';
  return `<div class="payment-link-grid">${sections.map((section) => `
    <div class="payment-link-card">
      <div><strong>${safeText(section.title)}</strong></div>
      <div class="payment-link-actions">${methods.map((method) => {
        if (method.key === 'cash') return `<span class="badge badge-yellow">Cash available on request</span>`;
        const url = buildPaymentUrl(method, section.amount, record);
        if (url) return `<a class="btn btn-primary btn-small" target="_blank" rel="noopener noreferrer" href="${safeText(url)}">${safeText(method.label || PAYMENT_METHOD_LABELS[method.key] || method.key)}</a>`;
        return `<button type="button" class="btn btn-secondary btn-small" data-copy-payment="${safeText(method.value || '')}">${safeText(method.label || PAYMENT_METHOD_LABELS[method.key] || method.key)}</button>`;
      }).join('')}</div>
    </div>`).join('')}</div>`;
}

function renderReviewSection(record = {}, review = null) {
  if (record.status !== 'Completed') return '';
  if (review?.message) {
    return `<div class="review-card" style="margin-top:18px;"><div class="section-header"><div><strong>Review Submitted</strong></div></div><div><strong>${safeText(review.rating || 5)}★</strong></div><div class="small muted" style="margin-top:6px;">${safeText(review.message || '')}</div><button type="button" class="btn btn-primary btn-small" data-open-tip-modal style="margin-top:12px;">Leave a Tip</button></div>`;
  }
  return `
    <div class="review-card" style="margin-top:18px;">
      <div class="section-header"><div><strong>Leave a Review</strong><div class="small muted">Available after completed orders.</div></div></div>
      <form id="reviewForm" class="review-grid">
        <input type="hidden" name="trackingCode" value="${safeText(record.trackingCode || '')}" />
        <div class="form-row" style="margin:0;"><label>Your Name</label><input name="name" value="${safeText((record.firstName || '').trim())}" placeholder="Optional" /></div>
        <div class="form-row" style="margin:0;"><label>Rating</label><div class="review-stars">${[5,4,3,2,1].map((value) => `<label><input type="radio" name="rating" value="${value}" ${value===5?'checked':''}/> ${value}★</label>`).join('')}</div></div>
        <div class="form-row" style="margin:0;"><label>Review</label><textarea name="message" rows="4" required placeholder="How was your experience?"></textarea></div>
        <div><button type="submit" class="btn btn-primary">Submit Review</button></div>
      </form>
    </div>`;
}

function renderAdminTrackingList() {
  if (!els.trackingResult) return;
  const records = [...(state.records || [])].sort((a, b) => String(a.exchangeDate || '').localeCompare(String(b.exchangeDate || '')) || String(a.exchangeTime || '').localeCompare(String(b.exchangeTime || '')));
  els.trackingForm?.classList.add('hidden');
  els.trackingStatus.innerHTML = `<div class="note-block small">Admin mode: all tickets are visible without customer email or phone verification.</div>`;
  els.trackingResult.innerHTML = `<div class="card" style="padding:18px; margin-top:18px;"><div class="section-header"><div><div class="eyebrow">Admin Tracking</div><h2 style="margin:6px 0 0;">All Tracking Tickets</h2></div></div><div class="calendar-stock-list">${records.map((record) => {
    const name = `${record.firstName || ''} ${record.lastName || ''}`.trim() || 'Customer';
    return `<a class="calendar-stock-row" href="?c=${encodeURIComponent(record.trackingCode || '')}"><div><strong>${safeText(name)}</strong><div class="small muted">${safeText(record.trackingCode || '')} · ${safeText(formatDateTime(record.exchangeDate, record.exchangeTime || 'To Be Determined'))}</div></div><div class="calendar-stock-metrics"><span class="badge badge-blue">${currency(getOutstandingAmount(record))} remaining</span></div></a>`;
  }).join('') || '<div class="empty-state">No tracking tickets yet.</div>'}</div></div>`;
  els.trackingResult.classList.remove('hidden');
}

async function renderTracking(rawCode) {
  const code = normalizeCode(rawCode);
  if (els.trackingCodeInput) els.trackingCodeInput.value = code;
  const record = state.records.find((entry) => normalizeCode(entry.trackingCode) === code);
  state.activeRecord = record || null;
  state.activeReview = record ? await getPublicReview(code).catch(() => null) : null;
  if (!record) {
    if (els.trackingForm) els.trackingForm.classList.remove('hidden');
    els.trackingResult?.classList.add('hidden');
    if (els.trackingStatus) els.trackingStatus.textContent = code ? 'Tracking number not found.' : 'Enter your tracking number.';
    return;
  }
  if (els.trackingStatus) els.trackingStatus.textContent = '';
  if (!state.adminSession && !state.verifiedCodes.has(code)) {
    els.trackingResult.innerHTML = renderVerificationGate(record);
    els.trackingResult.classList.remove('hidden');
    if (els.trackingForm) els.trackingForm.classList.add('hidden');
    bindVerificationForm(record);
    return;
  }
  const total = getEffectiveTotal(record);
  const listed = getListedTotal(record);
  const hasDiscount = listed - total > 0.004;
  const itemsHtml = (record.items || []).map((item) => {
    const original = Number(item.unitPrice || 0);
    const current = item.chargedUnitPrice !== '' && item.chargedUnitPrice != null && !Number.isNaN(Number(item.chargedUnitPrice)) ? Number(item.chargedUnitPrice) : original;
    return `<div class="calendar-stock-row"><div><strong>${safeText(item.name || 'Item')}</strong><div class="small muted">${Number(item.quantity || 0)} × ${currency(original)}${current < original ? ` (Marked down to ${currency(current)} each)` : ''}</div></div><div class="calendar-stock-metrics">${(item.accessories || []).map((acc) => `<span class="badge badge-blue">${safeText(acc.name)}</span>`).join(' ')}</div></div>`;
  }).join('') || '<div class="empty-state">No equipment listed.</div>';
  const remainingBalance = getOutstandingAmount(record);
  const paymentLine = record.requiresDeposit && !record.depositWaived && !['Deposit Paid', 'Paid', 'Free'].includes(record.paymentStatus)
    ? `Deposit Required: ${currency(record.depositAmount || 0)}`
    : `Payment Status: ${safeText(record.paymentStatus || 'Un-Paid')}`;
  els.trackingResult.innerHTML = `
    <div class="card" style="padding:18px; margin-top:18px;">
      <div class="section-header"><div><div class="eyebrow">Tracking Number</div><h2 style="margin:6px 0 0;">${safeText(record.trackingCode || '')}</h2></div><div class="badge ${record.status === 'Confirmed' ? 'badge-green' : record.status === 'Pending' ? 'badge-yellow' : 'badge-blue'}">${safeText(record.status || 'Pending')}</div></div>
      <div class="stack-sm">
        <div><strong>Name:</strong> ${safeText(`${record.firstName || ''} ${record.lastName || ''}`.trim() || 'Customer')}</div>
        <div><strong>Exchange:</strong> ${safeText(formatDateTime(record.exchangeDate, record.exchangeTime || 'To Be Determined'))}</div>
        <div><strong>Return:</strong> ${safeText(formatDateTime(record.returnDate, record.returnTime || 'To Be Determined'))}</div>
        <div><strong>${record.fulfillmentType === 'Delivery' ? 'Delivery Address' : 'Pickup Address'}:</strong> ${safeText(record.fulfillmentType === 'Delivery' ? (record.address || 'Not set') : (record.pickupAddress || state.settings?.pickupAddress || 'Not set'))}</div>
        <div><strong>${hasDiscount ? 'Total Before Discounts' : 'Total'}:</strong> ${currency(hasDiscount ? listed : total)}</div>
        ${hasDiscount ? `<div><strong>Total After Discounts:</strong> ${currency(total)}</div>` : ''}
        <div><strong>${paymentLine.split(':')[0]}:</strong> ${paymentLine.split(':').slice(1).join(':').trim()}</div>
        <div><strong>Remaining Balance:</strong> ${currency(remainingBalance)}</div>
      </div>
      <div class="section-header" style="margin-top:18px;"><div><strong>Equipment</strong></div></div>
      <div class="calendar-stock-list">${itemsHtml}</div>
      ${renderPaymentCards(record)}
      ${renderReviewSection(record, state.activeReview)}
    </div>`;
  els.trackingResult.classList.remove('hidden');
}

async function handleReviewSubmit(form) {
  const record = state.activeRecord;
  if (!record) return;
  const data = new FormData(form);
  const review = {
    name: String(data.get('name') || '').trim(),
    rating: Number(data.get('rating') || 5),
    message: String(data.get('message') || '').trim(),
    orderName: `${record.firstName || ''} ${record.lastName || ''}`.trim(),
    createdAt: new Date().toISOString()
  };
  await savePublicReview(record.trackingCode, review);
  state.activeReview = review;
  await renderTracking(record.trackingCode);
  openTipModal();
}

function openTipModal() {
  const record = state.activeRecord;
  if (!record || !els.tipModalWrap || !els.tipModalBody) return;
  const methods = buildPaymentMethods(record, false);
  els.tipModalBody.innerHTML = `
    <p>Thank you so much for choosing ${safeText(state.settings?.businessName || 'Rent Some: Event Rentals')}. Our goal is to keep pricing low and stay as flexible as possible so every event gets what it needs with the least amount of stress.</p>
    <p>If you had an exceptional experience and would like to leave a tip, it would mean a lot and helps us keep costs down for future customers.</p>
    <div class="payment-link-actions">${methods.map((method) => {
      const url = buildPaymentUrl(method, 0, record);
      if (url) return `<a class="btn btn-primary btn-small" target="_blank" rel="noopener noreferrer" href="${safeText(url)}">${safeText(method.label || PAYMENT_METHOD_LABELS[method.key] || method.key)}</a>`;
      return `<button type="button" class="btn btn-secondary btn-small" data-copy-payment="${safeText(method.value || '')}">${safeText(method.label || PAYMENT_METHOD_LABELS[method.key] || method.key)}</button>`;
    }).join('') || '<div class="small muted">No online tip methods are active right now.</div>'}</div>`;
  els.tipModalWrap.classList.add('open');
}

function closeTipModal() {
  els.tipModalWrap?.classList.remove('open');
}

async function copyToClipboard(text, trigger = null) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (trigger) {
      const oldText = trigger.textContent;
      trigger.textContent = 'Copied!';
      trigger.disabled = true;
      window.setTimeout(() => { trigger.textContent = oldText; trigger.disabled = false; }, 1400);
    }
  } catch {
    window.prompt('Copy this:', text);
  }
}

function handleFatalError(error) {
  console.error('Tracking load failed:', error);
  if (els.trackingForm) els.trackingForm.classList.remove('hidden');
  if (els.trackingResult) els.trackingResult.classList.add('hidden');
  if (els.trackingStatus) {
    const timedOut = /timed out/i.test(String(error?.message || ''));
    els.trackingStatus.textContent = timedOut
      ? 'This ticket is taking too long to load. Check your connection, then refresh or open the link in Safari/Chrome.'
      : 'Could not load tracking right now. Please refresh and try again.';
  }
}
