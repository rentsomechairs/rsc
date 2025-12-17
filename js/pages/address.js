import { readDb, writeDb, getSession } from '../db.js';

export function initAddress({ gotoCalendar, gotoReview } = {}){
  const street = document.getElementById('addrStreet');
  const city = document.getElementById('addrCity');
  const state = document.getElementById('addrState');
  const zip = document.getElementById('addrZip');
  const notes = document.getElementById('addrNotes');
  const btnBack = document.getElementById('btnAddrBack');
  const btnContinue = document.getElementById('btnAddrContinue');

  if (!street || !city || !state || !zip || !notes || !btnBack || !btnContinue) return;

  btnBack.onclick = () => gotoCalendar?.();

  const db = readDb();
  const a = (db.checkout && db.checkout.address) ? db.checkout.address : {};
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

    const db2 = readDb();
    db2.checkout = { ...(db2.checkout||{}), address: {
      street: streetV, city: cityV, state: stateV, zip: zipV, notes: notesV
    }};
    writeDb(db2);
    gotoReview?.();
  };
}
