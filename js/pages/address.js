import { getCheckout, setCheckout } from '../db.js';

export function initAddress({ gotoCalendar, gotoReview } = {}){
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
    gotoReview?.();
  };
  if (btnContinueBottom) btnContinueBottom.onclick = () => btnContinue.click();
}
