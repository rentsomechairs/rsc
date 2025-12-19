import { listEquipment, listCategories, readDb, writeDb, getCart, getCheckout, setCheckout, getPrefs, patchPrefs } from '../db.js';
import { updateFlowSummary } from '../ui/flowbar.js';

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

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
  let tiers = pricingTiers;

  // Support tiers saved as JSON strings (e.g., from imports or form serialization)
  if (typeof tiers === 'string'){
    try { tiers = JSON.parse(tiers); } catch (e) { tiers = []; }
  }

  // Support tiers saved as an object/map: { "1": 2.5, "50": 1.75 }
  if (tiers && !Array.isArray(tiers) && typeof tiers === 'object'){
    // If wrapped (e.g., { tiers: [...] })
    if (Array.isArray(tiers.tiers)) tiers = tiers.tiers;
    else {
      const out = [];
      for (const [k,v] of Object.entries(tiers)){
        const minQty = Number(k);
        const priceEach = Number(v);
        if (Number.isFinite(minQty) && Number.isFinite(priceEach)) out.push({ minQty, priceEach });
      }
      tiers = out;
    }
  }

  if (!Array.isArray(tiers)) tiers = [];
  return tiers
    .map(t => ({ minQty: Number(t?.minQty ?? 0), priceEach: Number(t?.priceEach ?? 0) }))
    .filter(t => Number.isFinite(t.minQty) && t.minQty >= 0 && Number.isFinite(t.priceEach) && t.priceEach > 0)
    .sort((a,b)=>a.minQty-b.minQty);
}
function unitPriceForQty(pricingTiers, qty){
  const tiers = normalizeTiers(pricingTiers);
  const q = Number(qty || 0);
  let chosen = null;
  for (const t of tiers){ if (q >= t.minQty) chosen = t; }
  // If the customer quantity is below the smallest tier's minQty,
  // treat the smallest tier as the base price.
  if (!chosen && tiers.length) chosen = tiers[0];
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

  const categories = listCategories();
  const eligible = new Set((categories||[]).filter(c=>c.annualEligible).map(c=>String(c.id)));
  const eligibleNames = new Set((categories||[]).filter(c=>c.annualEligible).map(c=>String(c.name||"").toLowerCase()));

  let chairsQty = 0;
  let normalPerDate = 0;

  for (const ci of cart){
    const eq = equipment.find(e => String(e.id) === String(ci.id));
    if (!eq) continue;
    const qty = Number(ci.qty||0);
    // Chair promo should be based on category/type, not the display name.
    // Back-compat: if category isn't set (older data), fall back to a name keyword check.
    const catId = String(eq.categoryId || "");
    const legacy = String(eq.category || "").toLowerCase();
    const name = (eq.name||'').toLowerCase();
    const isChair = (catId && eligible.has(catId))
      || (!catId && (eligibleNames.has(legacy) || legacy === 'chairs' || legacy === 'chair') && (eligible.size>0))
      || (!catId && eligible.size===0 && (legacy === 'chairs' || legacy === 'chair' || (legacy === '' && name.includes('chair'))));
    if (!isChair) continue;

    chairsQty += qty;
    const unitTier = unitPriceForQty(eq.pricingTiers, qty);
    const unitFallback = Number(eq.priceEach ?? eq.price ?? eq.basePrice ?? eq.unitPrice ?? 0);
    const unit = (unitTier != null ? unitTier : (Number.isFinite(unitFallback) && unitFallback > 0 ? unitFallback : null));
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
  const btnBackBottom = document.getElementById('btnCalBackBottom');
  const btnContinueBottom = document.getElementById('btnCalContinueBottom');
  const foot = document.getElementById('calFootnote');
  const shell = document.querySelector('.cal-shell');

  // Wire bottom nav buttons to match top buttons
  if (btnBackBottom) btnBackBottom.onclick = () => btnBack?.click();
  if (btnContinueBottom) btnContinueBottom.onclick = () => btnContinue?.click();

  // Button labels
  const backHtml = `<div class="btn-main">Back</div><div class="btn-sub">to Inventory</div>`;
  const nextHtml = `<div class="btn-main">Continue</div><div class="btn-sub">to Address</div>`;
  btnBack.innerHTML = backHtml;
  btnContinue.innerHTML = nextHtml;
  if (btnBackBottom) btnBackBottom.innerHTML = backHtml;
  if (btnContinueBottom) btnContinueBottom.innerHTML = nextHtml;

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

  // Generic UI modal helper (uses #uiModal)
  function openUiModal({ title, bodyHtml, actions=[] }){
    const um = document.getElementById('uiModal');
    const bd = document.getElementById('uiModalBackdrop');
    const cl = document.getElementById('uiModalClose');
    const tt = document.getElementById('uiModalTitle');
    const body = document.getElementById('uiModalBody');
    const act = document.getElementById('uiModalActions');
    if (!um||!bd||!cl||!tt||!body||!act) return;

    tt.textContent = title || 'Modal';
    body.innerHTML = bodyHtml || '';
    act.innerHTML = '';

    function close(){
      um.classList.add('hidden');
      um.setAttribute('aria-hidden','true');
      cl.onclick = null;
      bd.onclick = null;
    }

    for (const a of actions){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = a.className || 'btn btn-ghost';
      b.textContent = a.label || 'OK';
      b.onclick = () => { try{ a.onClick?.(); } finally { close(); } };
      act.appendChild(b);
    }

    cl.onclick = close;
    bd.onclick = close;
    um.classList.remove('hidden');
    um.setAttribute('aria-hidden','false');
  }

  function promptTimes(dateIso){
    return new Promise(resolve => {
      const cur = timesByDate?.[dateIso] || {};
      const defs = getDefaultTimesFor(dateIso);
      openUiModal({
        title: 'Delivery & Pickup Times',
        bodyHtml: `
          <div style="margin-bottom:10px;">Please pick times so we can plan delivery.</div>
          <div class="admin-row2" style="margin-top:10px;">
            <div class="admin-field">
              <label>Deliver by</label>
              <input class="input" id="timeDeliverBy" type="time" value="${cur.deliverBy || defs.deliverBy || ''}">
              <div class="muted-inline" style="margin-top:6px;">What time do the chairs need to be delivered by?</div>
            </div>
            <div class="admin-field">
              <label>Ready for pickup</label>
              <input class="input" id="timePickupAt" type="time" value="${cur.pickupAt || defs.pickupAt || ''}">
              <div class="muted-inline" style="margin-top:6px;">What time will the chairs be ready for pickup?</div>
            </div>
          </div>
        `,
        actions: [
          { label:'Cancel', className:'btn btn-ghost', onClick: () => resolve(false) },
          { label:'Confirm', className:'btn btn-good', onClick: () => {
              const d = document.getElementById('timeDeliverBy')?.value || '';
              const p = document.getElementById('timePickupAt')?.value || '';
              if (!d || !p){ resolve(false); return; }
              timesByDate = { ...(timesByDate||{}), [dateIso]: { deliverBy: d, pickupAt: p } };
              saveCheckout();
              updateContinue();
              // After confirming times for a single-date order, advance the flow (will trigger annual prompt if applicable)
              if (!annualMode) { setTimeout(() => btnContinue?.click(), 0); }
              resolve(true);
            } 
          }
        ]
      });
    });
  }

  const modalWeekdays = document.getElementById('annualWeekdays');
  const modalGrid = document.getElementById('annualGrid');
  const modalLabel = document.getElementById('annualMonthLabel');
  const modalPrev = document.getElementById('btnAnnualPrev');
  const modalNext = document.getElementById('btnAnnualNext');
  const modalFoot = document.getElementById('annualModalFoot');

  if (!weekdays || !grid || !label || !btnPrev || !btnNext || !btnBack || !btnContinue || !foot || !shell) return;

  btnBack.onclick = () => gotoInventory?.();

  const selectedIds = selectedEquipmentIds();
  const cartForQty = getCart();
  const requestedQtyById = new Map(cartForQty.map(ci => [ci.id, Math.max(0, Math.floor(Number(ci.qty||0)))]));
  if (!selectedIds.length){
    foot.textContent = 'No items selected. Go back and pick inventory first.';
    btnContinue.disabled = true;
  }

  // (today defined above)

  const checkout = getCheckout();
  let annualMode = !!checkout.annual;
  let pickedDates = Array.isArray(checkout.dates) ? checkout.dates.filter(Boolean) : (checkout.date ? [checkout.date] : []);
  // Default selected date: today
  const today = new Date(); today.setHours(0,0,0,0);
  const todayIso = isoDate(today);
  if (!pickedDates.length){ pickedDates = [todayIso]; }

  // times by date
  let timesByDate = (checkout.timesByDate && typeof checkout.timesByDate === 'object') ? checkout.timesByDate : {};


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
    setCheckout({
      ...(getCheckout()||{}),
      annual: annualMode,
      dates: pickedDates.slice(0,5),
      date: pickedDates[0] || null,
      timesByDate: timesByDate || {}
    });
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

  function haveTimesFor(iso){
    const t = timesByDate?.[iso];
    return !!(t && t.deliverBy && t.pickupAt);
  }

  function canContinue(){
    if (!annualMode) return pickedDates.length === 1 && haveTimesFor(pickedDates[0]);
    return pickedDates.length === 5 && pickedDates.every(d => haveTimesFor(d));
  }

  function updateContinue(){
    const dis = !canContinue();
    btnContinue.disabled = dis;
    if (btnContinueBottom) btnContinueBottom.disabled = dis;
  }

  btnContinue.onclick = () => {
    if (!canContinue()) return;

    const proceedToNext = () => {
      saveCheckout();
      gotoNext?.();
    };

    // If we're already in annual mode, just proceed (annual flow continues through the steps)
    if (annualMode) return proceedToNext();

    // Prompt for the 5-year promo right before leaving the calendar (after date + time selection)
    const prefs = getPrefs();
    if (prefs?.annualUpsellOff) return proceedToNext();

    const saveObj = calcAnnualSavings();
    const save = Number(saveObj?.save || 0);
    if (save <= 0) return proceedToNext();

    openUiModal({
      title: 'Annual event?',
      bodyHtml: `
        <div style="line-height:1.45;">
          Is your event annual? Save <strong>${money(save)}</strong> by booking for the next 5 years.
          <div class="muted" style="margin-top:10px; font-size:12px;">
            (Chairs promo: $${Number(saveObj?.promo || 0).toFixed(2)}/chair per date × 5 dates)
          </div>
          <div style="margin-top:12px; display:flex; gap:8px; align-items:center;">
            <input type="checkbox" id="annualDontShow"/>
            <label for="annualDontShow" class="muted-inline">Do not show this again</label>
          </div>
        </div>`,
      actions: [
        { label:'No', className:'btn btn-ghost', onClick: () => {
            const off = document.getElementById('annualDontShow')?.checked;
            if (off) patchPrefs({ annualUpsellOff: true });
            proceedToNext();
          } },
        { label:'Yes, make it annual', className:'btn btn-good', onClick: () => {
            const off = document.getElementById('annualDontShow')?.checked;
            if (off) patchPrefs({ annualUpsellOff: true });

            annualMode = true;
            chkAnnual.checked = true;

            // Keep first picked date and its times, then switch to annual picker UI.
            setAnnualShell();
            renderAnnualInline();
            renderAnnualPickers();
            renderMain();
            updateContinue();
          } }
      ]
    });
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
      const anyInsufficient = avail.some(a => a.remaining < (requestedQtyById.get(a.id) || 0));
      if (anyInsufficient) disabled = true;

      const selected = pickedDates[slotIndex] === iso;
      const isToday = iso === isoDate(today);

      const badges = avail.slice(0, 3).map(a => {
        let cls = 'cal-badge';
        if (a.remaining <= 0) cls += ' zero';
        else if (a.remaining <= Math.max(5, Math.floor(a.total*0.15))) cls += ' low';
        const label = (a.name || '').split(' ').slice(0,2).join(' ');
        return `<span class=\"${cls}\">${a.remaining}<small>${esc(label||a.id)}</small></span>`;
      }).join('');

      const el = document.createElement('div');
      // Only highlight "Today" when it is the selected date.
      el.className = 'cal-day' + (isOut ? ' is-out' : '') + (selected ? ' is-selected' : '') + (disabled ? ' is-disabled' : '') + ((isToday && selected) ? ' is-today' : '');
      el.innerHTML = `
        <div class="cal-day-top">
          <div class="cal-num">${d.getDate()}</div>
          <div class="cal-badges">${badges}</div>
        </div>
      `;

      el.addEventListener('click', async () => {
        if (disabled) return;

        // set date for this slot, clear future slots
        pickedDates[slotIndex] = iso;
        pickedDates = pickedDates.filter(Boolean);
        if (pickedDates.length > slotIndex+1){
          pickedDates = pickedDates.slice(0, slotIndex+1);
        }

        saveCheckout();

        // Time prompt (required)
        const ok = await promptTimes(iso);
        if (!ok) return;

        // After times are confirmed, show same-day notice if applicable, then offer annual upsell,
        // then (single-date mode only) advance to Address automatically.
        const proceedToNext = () => {
          if (annualMode) return; // stay on calendar for annual flow
          (gotoNext ? gotoNext() : (location.hash = '#address'));
        };

        const maybeAnnual = () => {
          if (annualMode) return proceedToNext();
          const prefs = getPrefs();
          if (prefs?.annualUpsellOff) return proceedToNext();
          const saveObj = calcAnnualSavings();
          const save = Number(saveObj?.save || 0);
          if (save <= 0) return proceedToNext();
          openUiModal({
            title: 'Annual event?',
            bodyHtml: `Is your event annual? Save <strong>${money(save)}</strong> by booking the next 5 years.<div style="margin-top:10px;display:flex;gap:10px;align-items:center;"><input type="checkbox" id="annualDontShow"/><label for="annualDontShow" class="muted-inline">Do not show this again</label></div>`,
            actions: [
              { label:'No', className:'btn btn-ghost', onClick: () => { const off = !!document.getElementById('annualDontShow')?.checked; if (off) patchPrefs({ annualUpsellOff: true }); proceedToNext(); } },
              { label:'Yes, make it annual', className:'btn btn-good', onClick: () => { const off = !!document.getElementById('annualDontShow')?.checked; if (off) patchPrefs({ annualUpsellOff: true });
                  annualMode = true;
                  chkAnnual.checked = true;
                  // keep first date and times
                  setAnnualShell();
                  renderAnnualInline();
                  renderAnnualPickers();
                  renderMain();
                  updateContinue();
                } }
            ]
          });
        };

        const fee = Number(readDb().settings?.sameDayFee || 0);
        if (iso === todayIso && fee > 0){
          openUiModal({
            title: 'Same-day delivery',
            bodyHtml: `There may be an extra fee added for same-day delivery.`,
            actions: [{ label:'OK', className:'btn btn-good', onClick: () => maybeAnnual() }]
          });
        } else {
          maybeAnnual();
        }
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
        const label = (a.name || '').split(' ').slice(0,2).join(' ');
        return `<span class=\"${cls}\">${a.remaining}<small>${esc(label||a.id)}</small></span>`;
      }).join('');

      const selected = pickedDates[0] === iso;
      const isToday = iso === isoDate(today);

      const el = document.createElement('div');
      // Only highlight "Today" when it is the selected date.
      el.className = 'cal-day' + (isOut ? ' is-out' : '') + (selected ? ' is-selected' : '') + (disabled ? ' is-disabled' : '') + ((isToday && selected) ? ' is-today' : '');

      el.innerHTML = `
        <div class="cal-day-top">
          <div class="cal-num">${d.getDate()}</div>
          <div class="cal-badges">${badges}</div>
        </div>
      `;

      el.addEventListener('click', async () => {
        if (disabled) return;
        pickedDates = [iso];
        saveCheckout();
        // Time prompt (required)
        const ok = await promptTimes(iso);
        if (!ok) return;

        const proceedToNext = () => {
          if (annualMode) return;
          (gotoNext ? gotoNext() : (location.hash = '#address'));
        };

        const maybeAnnual = () => {
          if (annualMode) return proceedToNext();
          const prefs = getPrefs();
          if (prefs?.annualUpsellOff) return proceedToNext();
          const saveObj = calcAnnualSavings();
          const save = Number(saveObj?.save || 0);
          if (save <= 0) return proceedToNext();
          openUiModal({
            title: 'Annual event?',
            bodyHtml: `Is your event annual? Save <strong>${money(save)}</strong> by booking the next 5 years.<div style="margin-top:10px;display:flex;gap:10px;align-items:center;"><input type="checkbox" id="annualDontShow"/><label for="annualDontShow" class="muted-inline">Do not show this again</label></div>`,
            actions: [
              { label:'No', className:'btn btn-ghost', onClick: () => { const off = !!document.getElementById('annualDontShow')?.checked; if (off) patchPrefs({ annualUpsellOff: true }); proceedToNext(); } },
              { label:'Yes, make it annual', className:'btn btn-good', onClick: () => { const off = !!document.getElementById('annualDontShow')?.checked; if (off) patchPrefs({ annualUpsellOff: true });
                  annualMode = true;
                  chkAnnual.checked = true;
                  setAnnualShell();
                  renderAnnualInline();
                  renderAnnualPickers();
                  renderMain();
                  updateContinue();
                } }
            ]
          });
        };

        const fee = Number(readDb().settings?.sameDayFee || 0);
        if (iso === todayIso && fee > 0){
          openUiModal({
            title: 'Same-day delivery',
            bodyHtml: `There may be an extra fee added for same-day delivery.`,
            actions: [{ label:'OK', className:'btn btn-good', onClick: () => maybeAnnual() }]
          });
        } else {
          maybeAnnual();
        }
        updateContinue();
        renderAnnualInline();
        foot.textContent = `Selected date: ${formatDateDisplay(iso)}`;
        renderMain();
      });

      grid.appendChild(el);
    }

    foot.textContent = pickedDates[0] ? `Selected date: ${formatDateDisplay(pickedDates[0])}` : 'Pick a day to continue.';
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

      // When turning annual ON, keep the currently selected first date (and times) if possible.
      // When turning annual OFF, keep only the first date.
      const first = pickedDates[0] || (getCheckout()?.date || null);
      if (annualMode){
        pickedDates = first ? [first] : [todayIso];
      } else {
        pickedDates = first ? [first] : [];
      }

      saveCheckout();
      setAnnualShell();
      renderAnnualInline();
      renderAnnualPickers();
      updateContinue();

      if (!annualMode) {
        renderMain();
      } else {
        foot.textContent = 'Pick your annual dates below.';
        // Help the user keep moving: open the picker for the 2nd date if the first is set.
        if (pickedDates[0]) openModal(1);
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
}function getDefaultTimesFor(dateIso){
    const db = readDb();
    const settings = db.settings || {};
    const defDeliver = settings.defaultDeliverBy || '';
    const defPickup = settings.defaultPickupAt || '';

    // Pull persisted checkout state (avoid relying on non-scoped variables)
    const co = getCheckout() || {};
    const picked = Array.isArray(co.pickedDates) ? co.pickedDates : [];
    const timesByDate = (co.timesByDate && typeof co.timesByDate === 'object') ? co.timesByDate
                     : (co.times && typeof co.times === 'object') ? co.times
                     : {};

    const isAnnual = (co.annualMode === true) || (co.mode === 'annual') || (co.bookingType === 'annual');

    // If in annual mode and we already have a time for the first picked date, reuse it for other dates by default
    const first = picked.length ? picked[0] : null;
    const firstTimes = first && timesByDate[first] ? timesByDate[first] : null;
    const fromFirst = (isAnnual && firstTimes) ? firstTimes : null;

    const cur = timesByDate[dateIso] ? timesByDate[dateIso] : null;
    return {
      deliverBy: (cur && cur.deliverBy) || (fromFirst && fromFirst.deliverBy) || defDeliver,
      pickupAt: (cur && cur.pickupAt) || (fromFirst && fromFirst.pickupAt) || defPickup
    };
  }


  