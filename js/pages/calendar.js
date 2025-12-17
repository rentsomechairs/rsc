import { listEquipment, readDb, writeDb, getCart } from '../db.js';
import { updateFlowSummary } from '../ui/flowbar.js';

function formatDateDisplay(iso){
  if (!iso) return '—';
  const [y,m,d] = String(iso).split('-').map(Number);
  if (!y||!m||!d) return iso;
  const dt = new Date(y, m-1, d);
  const mon = dt.toLocaleString(undefined,{month:'short'});
  const day = d;
  const yr = y;
  const suf = (day % 100 >= 11 && day % 100 <= 13) ? 'th' : ({1:'st',2:'nd',3:'rd'}[day%10]||'th');
  // Add period after month abbrev
  return `${mon}. ${day}${suf}, ${yr}`;
}


function pad2(n){ return String(n).padStart(2,'0'); }
function isoDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseISO(s){
  const [y,m,d]=String(s).split('-').map(Number);
  return new Date(y, (m||1)-1, d||1);
}
function addMonths(date, months){
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}
function monthLabel(year, monthIndex){
  const d = new Date(year, monthIndex, 1);
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
function clampMonth(year, month){
  if (month < 0) return { year: year-1, month: 11 };
  if (month > 11) return { year: year+1, month: 0 };
  return { year, month };
}
function money(n){ return `$${Number(n||0).toFixed(2)}`; }

function normalizeTiers(pricingTiers){
  return (pricingTiers || [])
    .map(t => ({ minQty: Number(t.minQty||0), priceEach: Number(t.priceEach||0) }))
    .filter(t => t.minQty > 0 && t.priceEach > 0)
    .sort((a,b)=>a.minQty-b.minQty);
}
function unitPriceForQty(pricingTiers, qty){
  const tiers = normalizeTiers(pricingTiers);
  const q = Number(qty || 0);
  let chosen = null;
  for (const t of tiers){ if (q >= t.minQty) chosen = t; }
  return chosen ? chosen.priceEach : null;
}

function selectedEquipmentIds(){
  return getCart().map(x => x.id);
}

function availabilityForDate(dateIso, selectedIds){
  const equipment = listEquipment();
  const db = readDb();
  const byId = new Map(equipment.map(e => [e.id, e]));
  const bookings = db.bookings || [];

  const bookedByItem = new Map();
  for (const b of bookings){
    if (b.date !== dateIso) continue;
    const items = b.items || {};
    for (const [id, qty] of Object.entries(items)){
      bookedByItem.set(id, (bookedByItem.get(id)||0) + Number(qty||0));
    }
  }

  const result = [];
  for (const id of selectedIds){
    const eq = byId.get(id);
    if (!eq) continue;
    const total = Math.max(0, Math.floor(Number(eq.quantity||0)));
    const booked = Math.max(0, Math.floor(Number(bookedByItem.get(id)||0)));
    const remaining = Math.max(0, total - booked);
    result.push({ id, name: eq.name, remaining, total });
  }
  return result;
}

function calcAnnualSavings(){
  // Promo: chairs at $0.75/ea for each of 5 dates.
  const PROMO = 0.75;
  const cart = getCart();
  const equipment = listEquipment();

  let chairsQty = 0;
  let normalPerDate = 0;

  for (const ci of cart){
    const eq = equipment.find(e => e.id === ci.id);
    if (!eq) continue;
    const qty = Number(ci.qty||0);
    const name = (eq.name||'').toLowerCase();
    if (!name.includes('chair')) continue;

    chairsQty += qty;
    const unit = unitPriceForQty(eq.pricingTiers, qty);
    if (unit != null) normalPerDate += unit * qty;
  }

  if (chairsQty <= 0 || normalPerDate <= 0) return null;
  const normal5 = normalPerDate * 5;
  const promo5 = (PROMO * chairsQty) * 5;
  const save = Math.max(0, normal5 - promo5);
  return { chairsQty, normal5, promo5, save, promo: PROMO };
}

export function initCalendar({ gotoInventory, gotoNext } = {}){
  // Main refs
  const weekdays = document.getElementById('calWeekdays');
  const grid = document.getElementById('calGrid');
  const label = document.getElementById('calMonthLabel');
  const btnPrev = document.getElementById('btnCalPrev');
  const btnNext = document.getElementById('btnCalNext');
  const btnBack = document.getElementById('btnCalBack');
  const btnContinue = document.getElementById('btnCalContinue');
  const foot = document.getElementById('calFootnote');
  const shell = document.querySelector('.cal-shell');

  // Annual refs
  const chkAnnual = document.getElementById('chkAnnual');
  const annualBody = document.getElementById('calAnnualBody');
  const annualSavings = document.getElementById('calAnnualSavings');
  const annualDates = document.getElementById('calAnnualDates');
  const annualSaveInline = document.getElementById('annualSaveInline');

  // Modal refs
  const modal = document.getElementById('annualModal');
  const modalBackdrop = document.getElementById('annualModalBackdrop');
  const modalClose = document.getElementById('annualModalClose');
  const modalWeekdays = document.getElementById('annualWeekdays');
  const modalGrid = document.getElementById('annualGrid');
  const modalLabel = document.getElementById('annualMonthLabel');
  const modalPrev = document.getElementById('btnAnnualPrev');
  const modalNext = document.getElementById('btnAnnualNext');
  const modalFoot = document.getElementById('annualModalFoot');

  if (!weekdays || !grid || !label || !btnPrev || !btnNext || !btnBack || !btnContinue || !foot || !shell) return;

  btnBack.onclick = () => gotoInventory?.();

  const selectedIds = selectedEquipmentIds();
  if (!selectedIds.length){
    foot.textContent = 'No items selected. Go back and pick inventory first.';
    btnContinue.disabled = true;
  }

  const today = new Date();
  today.setHours(0,0,0,0);

  const db = readDb();
  if (!db.checkout) db.checkout = {};

  let annualMode = !!db.checkout.annual;
  let pickedDates = Array.isArray(db.checkout.dates) ? db.checkout.dates.filter(Boolean) : (db.checkout.date ? [db.checkout.date] : []);

  // Main calendar month state (non-annual)
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();

  // Modal state
  let modalOpen = false;
  let slotIndex = 0;
  let mYear = year;
  let mMonth = month;

  const weekdayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  weekdays.innerHTML = weekdayNames.map(n => `<div>${n}</div>`).join('');
  if (modalWeekdays) modalWeekdays.innerHTML = weekdayNames.map(n => `<div>${n}</div>`).join('');

  function saveCheckout(){
    const db2 = readDb();
    db2.checkout = {
      ...(db2.checkout||{}),
      annual: annualMode,
      dates: pickedDates.slice(0,5),
      date: pickedDates[0] || null
    };
    writeDb(db2);
    updateFlowSummary?.();
  }

  function setAnnualShell(){
    shell.classList.toggle('annual-on', annualMode);
    annualBody?.classList.toggle('hidden', !annualMode);
  }

  function renderAnnualInline(){
    const save = calcAnnualSavings();
    if (annualSaveInline){
      annualSaveInline.textContent = save ? money(save.save) : '$—';
    }
    if (annualSavings){
      if (!save){
        annualSavings.textContent = 'Add chairs + quantity to see 5-year savings.';
      } else {
        annualSavings.textContent = `Save about ${money(save.save)} over 5 years (${money(save.normal5)} → ${money(save.promo5)}).`;
      }
    }
  }

  function allowedWindowForSlot(i){
    if (i === 0){
      return { min: today, max: null };
    }
    const prev = pickedDates[i-1];
    if (!prev) return null;
    const prevD = parseISO(prev);
    const min = addMonths(prevD, 10);
    const max = addMonths(prevD, 14);
    min.setHours(0,0,0,0); max.setHours(0,0,0,0);
    // Also never allow past
    if (min < today) min.setTime(today.getTime());
    return { min, max };
  }

  function renderAnnualPickers(){
    if (!annualDates) return;
    annualDates.innerHTML = '';
    annualDates.classList.add('annual-picks');

    const labels = ['First date','Second date','Third date','Fourth date','Fifth date'];

    for (let i=0;i<5;i++){
      const have = pickedDates[i];
      const locked = i > 0 && !pickedDates[i-1];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'annual-pick' + (have ? ' is-ready' : '') + (locked ? ' is-locked' : '');
      btn.dataset.slot = String(i);

      const right = have ? 'Change' : (locked ? 'Locked' : 'Pick');
      const tag = locked ? 'Pick previous first' : right;

      btn.innerHTML = `
        <div>
          <div><strong>${labels[i]}</strong></div>
          <div class="muted" style="font-size:12px; margin-top:4px;">${have ? have : (locked ? '—' : 'Click to choose')}</div>
        </div>
        <div class="tag">${tag}</div>
      `;

      btn.addEventListener('click', () => {
        if (locked) return;
        openModal(i);
      });

      annualDates.appendChild(btn);
    }
  }

  function canContinue(){
    if (!annualMode) return pickedDates.length === 1;
    return pickedDates.length === 5;
  }

  function updateContinue(){
    btnContinue.disabled = !canContinue();
  }

  btnContinue.onclick = () => {
    if (!canContinue()) return;
    saveCheckout();
    gotoNext?.();
  };

  // ---------- Modal ----------
  function showModal(){
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
    modalOpen = true;
  }
  function hideModal(){
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');
    modalOpen = false;
  }
  modalBackdrop?.addEventListener('click', hideModal);
  modalClose?.addEventListener('click', hideModal);
  document.addEventListener('keydown', (e) => {
    if (modalOpen && e.key === 'Escape') hideModal();
  });

  function monthStart(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }

  function setModalMonthToSuggested(i){
    if (i === 0){
      mYear = today.getFullYear();
      mMonth = today.getMonth();
      return;
    }
    const prev = parseISO(pickedDates[i-1]);
    const focus = addMonths(prev, 12);
    mYear = focus.getFullYear();
    mMonth = focus.getMonth();
  }

  function monthCompare(aYear, aMonth, bYear, bMonth){
    if (aYear !== bYear) return aYear - bYear;
    return aMonth - bMonth;
  }

  function renderModal(){
    if (!modalGrid || !modalLabel) return;

    modalLabel.textContent = monthLabel(mYear, mMonth);
    modalGrid.innerHTML = '';

    const window = allowedWindowForSlot(slotIndex);
    if (!window){
      modalFoot && (modalFoot.textContent = 'Pick the previous date first.');
      return;
    }

    // nav restrictions
    const minMonth = window.min ? monthStart(window.min) : null;
    const maxMonth = window.max ? monthStart(window.max) : null;

    const curMonthStart = new Date(mYear, mMonth, 1);

    if (modalPrev){
      modalPrev.disabled = !!minMonth && monthCompare(curMonthStart.getFullYear(), curMonthStart.getMonth(), minMonth.getFullYear(), minMonth.getMonth()) <= 0;
    }
    if (modalNext){
      if (!maxMonth){
        // allow up to 7 years forward from today in first-date picker
        const cap = addMonths(today, 12*7);
        const capMonth = monthStart(cap);
        modalNext.disabled = monthCompare(curMonthStart.getFullYear(), curMonthStart.getMonth(), capMonth.getFullYear(), capMonth.getMonth()) >= 0;
      } else {
        modalNext.disabled = monthCompare(curMonthStart.getFullYear(), curMonthStart.getMonth(), maxMonth.getFullYear(), maxMonth.getMonth()) >= 0;
      }
    }

    const first = new Date(mYear, mMonth, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(mYear, mMonth+1, 0).getDate();
    const prevMonthDays = new Date(mYear, mMonth, 0).getDate();

    const totalCells = 42;
    for (let i=0;i<totalCells;i++){
      const cellIndex = i - startDay + 1;
      let d, isOut = false;
      if (cellIndex < 1){
        d = new Date(mYear, mMonth-1, prevMonthDays + cellIndex);
        isOut = true;
      } else if (cellIndex > daysInMonth){
        d = new Date(mYear, mMonth+1, cellIndex - daysInMonth);
        isOut = true;
      } else {
        d = new Date(mYear, mMonth, cellIndex);
      }
      d.setHours(0,0,0,0);
      const iso = isoDate(d);

      // disable rules
      let disabled = false;
      if (d < today) disabled = true;
      if (window.min && d < window.min) disabled = true;
      if (window.max && d > window.max) disabled = true;

      // availability rules (all selected items must have >0 remaining)
      const avail = availabilityForDate(iso, selectedIds);
      const anyZero = avail.some(a => a.remaining <= 0);
      if (anyZero) disabled = true;

      const selected = pickedDates[slotIndex] === iso;
      const isToday = iso === isoDate(today);

      const badges = avail.slice(0, 3).map(a => {
        let cls = 'cal-badge';
        if (a.remaining <= 0) cls += ' zero';
        else if (a.remaining <= Math.max(5, Math.floor(a.total*0.15))) cls += ' low';
        return `<span class="${cls}">${a.remaining}</span>`;
      }).join('');

      const el = document.createElement('div');
      el.className = 'cal-day' + (isOut ? ' is-out' : '') + (selected ? ' is-selected' : '') + (disabled ? ' is-disabled' : '') + (isToday ? ' is-today' : '');
      el.innerHTML = `
        <div class="cal-day-top">
          <div class="cal-num">${d.getDate()}</div>
          <div class="cal-badges">${badges}</div>
        </div>
      `;

      el.addEventListener('click', () => {
        if (disabled) return;

        // set date for this slot, clear future slots
        pickedDates[slotIndex] = iso;
        pickedDates = pickedDates.filter(Boolean);
        if (pickedDates.length > slotIndex+1){
          pickedDates = pickedDates.slice(0, slotIndex+1);
        }

        saveCheckout();
        renderAnnualInline();
        renderAnnualPickers();
        updateContinue();

        hideModal();

        if (modalFoot) modalFoot.textContent = 'Picked!';
      });

      modalGrid.appendChild(el);
    }

    if (modalFoot){
      if (slotIndex === 0){
        modalFoot.textContent = 'Pick your first date (today or later).';
      } else {
        const w = allowedWindowForSlot(slotIndex);
        modalFoot.textContent = w ? `Pick date ${slotIndex+1} between ${isoDate(w.min)} and ${isoDate(w.max)}.` : 'Pick the previous date first.';
      }
    }
  }

  modalPrev?.addEventListener('click', () => {
    const r = clampMonth(mYear, mMonth-1);
    mYear = r.year; mMonth = r.month;
    renderModal();
  });
  modalNext?.addEventListener('click', () => {
    const r = clampMonth(mYear, mMonth+1);
    mYear = r.year; mMonth = r.month;
    renderModal();
  });

  function openModal(i){
    slotIndex = i;
    setModalMonthToSuggested(i);
    showModal();
    renderModal();
  }

  // ---------- Main Calendar (non-annual) ----------
  function renderMain(){
    label.textContent = monthLabel(year, month);
    grid.innerHTML = '';

    const first = new Date(year, month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const totalCells = 42;
    for (let i=0;i<totalCells;i++){
      const cellIndex = i - startDay + 1;
      let d, isOut = false;
      if (cellIndex < 1){
        d = new Date(year, month-1, prevMonthDays + cellIndex);
        isOut = true;
      } else if (cellIndex > daysInMonth){
        d = new Date(year, month+1, cellIndex - daysInMonth);
        isOut = true;
      } else {
        d = new Date(year, month, cellIndex);
      }

      d.setHours(0,0,0,0);
      const iso = isoDate(d);

      const isPast = d < today;
      const avail = availabilityForDate(iso, selectedIds);
      const anyZero = avail.some(a => a.remaining <= 0);
      const disabled = isPast || anyZero;

      const badges = avail.slice(0, 3).map(a => {
        let cls = 'cal-badge';
        if (a.remaining <= 0) cls += ' zero';
        else if (a.remaining <= Math.max(5, Math.floor(a.total*0.15))) cls += ' low';
        return `<span class="${cls}">${a.remaining}</span>`;
      }).join('');

      const selected = pickedDates[0] === iso;
      const isToday = iso === isoDate(today);

      const el = document.createElement('div');
      el.className = 'cal-day' + (isOut ? ' is-out' : '') + (selected ? ' is-selected' : '') + (disabled ? ' is-disabled' : '') + (isToday ? ' is-today' : '');

      el.innerHTML = `
        <div class="cal-day-top">
          <div class="cal-num">${d.getDate()}</div>
          <div class="cal-badges">${badges}</div>
        </div>
      `;

      el.addEventListener('click', () => {
        if (disabled) return;
        pickedDates = [iso];
        saveCheckout();
        updateContinue();
        renderAnnualInline();
        foot.textContent = `Selected date: ${formatDateDisplay(iso)}`;
        renderMain();
      });

      grid.appendChild(el);
    }

    foot.textContent = pickedDates[0] ? `Selected date: ${pickedDates[0]}` : 'Pick a day to continue.';
  }

  btnPrev.onclick = () => {
    const r = clampMonth(year, month-1);
    year = r.year; month = r.month;
    renderMain();
  };
  btnNext.onclick = () => {
    const r = clampMonth(year, month+1);
    year = r.year; month = r.month;
    renderMain();
  };

  // Toggle annual mode
  if (chkAnnual){
    chkAnnual.checked = annualMode;
    chkAnnual.addEventListener('change', () => {
      annualMode = chkAnnual.checked;

      // Reset date(s) when switching modes, to avoid confusion
      pickedDates = [];
      saveCheckout();
      setAnnualShell();
      renderAnnualInline();
      renderAnnualPickers();
      updateContinue();

      if (!annualMode) {
        renderMain();
      } else {
        foot.textContent = 'Pick your annual dates below.';
      }
    });
  }

  // Initial render
  setAnnualShell();
  renderAnnualInline();
  renderAnnualPickers();
  updateContinue();

  if (!annualMode) renderMain();
  else foot.textContent = 'Pick your annual dates below.';
}
