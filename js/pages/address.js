import { getCheckout, setCheckout, getSession, getCart, listEquipment } from '../db.js';
import { updateFlowSummary } from '../ui/flowbar.js';
import { computeTotals, wireGuestSignup } from '../ui/memberUpsell.js';

export function initAddress({ gotoCalendar, gotoReview } = {}){
  let session = getSession();
  let isGuest = session?.role === 'guest';

  const sideLines = document.getElementById('addrSideLines');
  const sideTotal = document.getElementById('addrSideTotal');
  const memberWrap = document.getElementById('addrMemberWrap');
  const memberTotalEl = document.getElementById('addrMemberTotal');
  const memberSaveTextEl = document.getElementById('addrMemberSaveText');
  const btnSignup = document.getElementById('btnAddrSignup');

  const street = document.getElementById('addrStreet');
  const city = document.getElementById('addrCity');
  const state = document.getElementById('addrState');
  const zip = document.getElementById('addrZip');
  const notes = document.getElementById('addrNotes');
  const btnBack = document.getElementById('btnAddrBack');
  const btnBackBottom = document.getElementById('btnAddrBackBottom');
  const btnContinue = document.getElementById('btnAddrContinue');
  const btnContinueBottom = document.getElementById('btnAddrContinueBottom');

  if (!street || !city || !state || !zip || !notes || !btnBack || !btnContinue) return;

  function renderSideSummary(){
    if (!sideLines || !sideTotal) return;
    const cart = getCart(session);
    const equipment = listEquipment();
    sideLines.innerHTML = '';
    for (const ci of cart){
      const eq = equipment.find(e => String(e.id)==String(ci.id));
      if (!eq) continue;
      const qty = Number(ci.qty||0);
      const row = document.createElement('div');
      row.className = 'inv-line';
      row.innerHTML = `<div class="inv-line-top"><div><div class="inv-line-name">${eq.name}</div><div class="inv-line-qty">Qty: <strong>${qty}</strong></div></div></div>`;
      sideLines.appendChild(row);
    }

    const totals = (isGuest ? computeTotals({ roleOverride: 'guest' }) : computeTotals({ roleOverride: session?.role || 'user' }));
    sideTotal.textContent = totals.money(isGuest ? totals.guestTotal : totals.memberTotal);

    if (memberWrap && memberTotalEl && memberSaveTextEl){
      if (isGuest && cart.length){
        memberWrap.classList.remove('hidden');
        memberTotalEl.textContent = totals.money(totals.memberTotal);
        memberSaveTextEl.innerHTML = totals.save > 0
          ? `Sign up for free now and save <strong>${totals.money(totals.save)}</strong> on this order.`
          : `Sign up for free to unlock member pricing and order tracking.`;
      } else {
        memberWrap.classList.add('hidden');
      }
    }
  }

  wireGuestSignup({
    button: btnSignup,
    onUpgraded: () => {
      session = getSession();
      isGuest = session?.role === 'guest';
      updateFlowSummary();
      renderSideSummary();
    }
  });

  const backHtml = `<div class="btn-main">Back</div><div class="btn-sub">to Date</div>`;
  const nextHtml = `<div class="btn-main">Continue</div><div class="btn-sub">to Review</div>`;
  btnBack.innerHTML = backHtml;
  btnContinue.innerHTML = nextHtml;
  if (btnBackBottom) btnBackBottom.innerHTML = backHtml;
  if (btnContinueBottom) btnContinueBottom.innerHTML = nextHtml;

  btnBack.onclick = () => gotoCalendar?.();
  if (btnBackBottom) btnBackBottom.onclick = () => btnBack.click();

  btnBack.onclick = () => gotoCalendar?.();

  const checkout = getCheckout();
  const a = checkout?.address ? checkout.address : {};
  street.value = a.street || '';
  city.value = a.city || '';
  state.value = a.state || '';
  zip.value = a.zip || '';
  notes.value = a.notes || '';

  btnContinue.onclick = () => {
    const streetV = (street.value || '').trim();
    const cityV = (city.value || '').trim();
    const stateV = (state.value || '').trim().toUpperCase();
    const zipV = (zip.value || '').trim();
    const notesV = (notes.value || '').trim();

    if (!streetV || !cityV || !stateV || !zipV){
      alert('Please fill out street, city, state, and ZIP.');
      return;
    }

    setCheckout({
      ...(getCheckout()||{}),
      address: { street: streetV, city: cityV, state: stateV, zip: zipV, notes: notesV }
    });
    updateFlowSummary();
    gotoReview?.();
  };
  if (btnContinueBottom) btnContinueBottom.onclick = () => btnContinue.click();

  updateFlowSummary();
  renderSideSummary();
}
