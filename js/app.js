export const BUILD_TAG = '3.6.1-fix19';
import { initLanding } from './pages/landing.js';
import { initAdmin } from './pages/admin.js';
import { initInventory } from './pages/inventory.js';
import { initCalendar } from './pages/calendar.js';
import { initAddress } from './pages/address.js';
import { initReview } from './pages/review.js';
import { initProfile } from './pages/profile.js';
import { getSession, clearSession, readDb, getCart, getCheckout } from './db.js';
import { setActiveStep, updateFlowSummary, wireFlowbarNav } from './ui/flowbar.js';

const landing = document.getElementById('pageLanding');
const admin = document.getElementById('pageAdmin');
const inventory = document.getElementById('pageInventory');
const calendar = document.getElementById('pageCalendar');
const address = document.getElementById('pageAddress');
const review = document.getElementById('pageReview');
const profile = document.getElementById('pageProfile');


const btnFlowLogin = document.getElementById('btnFlowLogin');
const btnFlowProfile = document.getElementById('btnFlowProfile');
const btnFlowSignOut = document.getElementById('btnFlowSignOut');
const btnFlowAdmin = document.getElementById('btnFlowAdmin');
const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');

function refreshTopbar(session){
  const role = session?.role || null;
  const email = session?.email || '';
  const signedIn = !!role;
  if (statusText){
    statusText.textContent = signedIn ? `${role === 'guest' ? 'Guest' : 'Signed in'}: ${email}` : 'Not signed in';
  }
  if (statusPill){
    statusPill.classList.toggle('on', signedIn);
  }
  if (btnFlowLogin) btnFlowLogin.classList.toggle('hidden', signedIn);
  if (btnFlowProfile) btnFlowProfile.classList.toggle('hidden', !signedIn);
  if (btnFlowSignOut) btnFlowSignOut.classList.toggle('hidden', !signedIn);
  if (btnFlowAdmin) btnFlowAdmin.classList.toggle('hidden', role !== 'admin');
}

let adminInitialized = false;

function route(page){
  landing.classList.toggle('hidden', page !== 'landing');
  admin.classList.toggle('hidden', page !== 'admin');
  inventory.classList.toggle('hidden', page !== 'inventory');
  calendar.classList.toggle('hidden', page !== 'calendar');
  address.classList.toggle('hidden', page !== 'address');
  review.classList.toggle('hidden', page !== 'review');
  profile.classList.toggle('hidden', page !== 'profile');

  document.body.classList.toggle('is-admin', page === 'admin');
}

function gotoLanding(){ location.hash = ''; showLanding(); }
function gotoAdmin(){ location.hash = '#admin'; showAdmin(); }
function gotoInventory(){ location.hash = '#inventory'; showInventory(); }
function gotoCalendar(){ location.hash = '#calendar'; showCalendar(); }
function gotoAddress(){ location.hash = '#address'; showAddress(); }
function gotoReview(){ location.hash = '#review'; showReview(); }
function gotoProfile(){ location.hash = '#profile'; showProfile(); }
wireFlowbarNav({ gotoInventory, gotoCalendar, gotoAddress, gotoReview });

function showLanding(){
  route('landing');
  setActiveStep('');
  updateFlowSummary();
  initLanding({ gotoAdmin, gotoInventory });
}

function showAdmin(){
  route('admin');
  if (!adminInitialized) {
    initAdmin({ route });
    adminInitialized = true;
  }
}

function showInventory(){
  route('inventory');
  setActiveStep('inventory');
  updateFlowSummary();
  initInventory({ gotoLanding, gotoCalendar, softRefresh: true });
}

function showCalendar(){
  route('calendar');
  setActiveStep('date');
  updateFlowSummary();
  initCalendar({ gotoInventory, gotoNext: gotoAddress });
}

function showAddress(){
  route('address');
  setActiveStep('address');
  updateFlowSummary();
  initAddress({ gotoCalendar, gotoReview });
}

function showReview(){
  route('review');
  setActiveStep('review');
  updateFlowSummary();
  initReview({ gotoAddress, gotoDone: gotoLanding });
}

function showProfile(){
  route('profile');
  // No flowstep here; keep current active
  updateFlowSummary();
  initProfile({ gotoLanding, gotoInventory });
}

// Keep summary fresh when localStorage changes elsewhere
window.addEventListener('storage', () => updateFlowSummary());

// DEV: global session reset button (works anywhere)
const devBtn = document.getElementById('devResetSession');
if (devBtn) {
  devBtn.addEventListener('click', () => {
    clearSession();
    adminInitialized = false;
    history.replaceState({}, '', location.pathname);
    location.reload();
  });
}

// DEV: emergency reset via URL
const params = new URLSearchParams(location.search);
if (params.get('reset') === '1') {
  clearSession();
  history.replaceState({}, '', location.pathname);
}

function needsAuth(session){
  return session?.role === 'user' || session?.role === 'guest' || session?.role === 'admin';
}

function handleRoute(){
  const session = getSession();
  refreshTopbar(session);
  const hash = (location.hash || '').toLowerCase();
  const cart = getCart();
  const checkout = getCheckout() || {};
  const hasCart = cart.some(ci => Number(ci.qty||0) > 0);
  const datesArr = Array.isArray(checkout.dates) ? checkout.dates : (checkout.date ? [checkout.date] : []);
  const annual = !!checkout.annual;
  const hasDate = annual ? (datesArr.length === 5) : (datesArr.length > 0);
  const hasAddress = !!checkout.address;

  if (hash === '#profile') {
    if (needsAuth(session)) return showProfile();
    location.hash = '';
    showLanding();
    alert('Please sign in or continue as guest first.');
    return;
  }

  if (hash === '#admin') {
    if (session?.role === 'admin') return showAdmin();
    location.hash = '';
    showLanding();
    alert('Admin access requires admin login.');
    return;
  }

  if (hash === '#inventory') {
    if (needsAuth(session)) return showInventory();
    location.hash = '';
    showLanding();
    alert('Please sign in or continue as guest first.');
    return;
  }

  if (hash === '#calendar') {
    if (needsAuth(session)) return showCalendar();
    location.hash = '';
    showLanding();
    alert('Please sign in or continue as guest first.');
    return;
  }

  if (hash === '#address') {
    if (needsAuth(session) && hasCart && hasDate) return showAddress();
    location.hash = '#inventory';
    showInventory();
    return;
  }

  if (hash === '#review') {
    if (needsAuth(session) && hasCart && hasDate && hasAddress) return showReview();
    location.hash = '#address';
    showAddress();
    return;
  }
  if (needsAuth(session) && !hash) return showProfile();
  showLanding();
}


// Flowbar actions
btnFlowLogin?.addEventListener('click', () => {
  location.hash = '';
  showLanding();
});

btnFlowProfile?.addEventListener('click', () => gotoProfile());

btnFlowSignOut?.addEventListener('click', () => {
  clearSession();
  location.hash = '';
  handleRoute();
});

btnFlowAdmin?.addEventListener('click', () => gotoAdmin());
window.addEventListener('hashchange', handleRoute);
handleRoute();

// Update summary after any route (useful after date selection)
