import * as db from '../db.js';
import { CONFIG } from '../config.js';

export function initLanding({ gotoAdmin, gotoInventory }) {
  const btnGmail = document.getElementById('btnGmail');
  const gmailHelper = document.getElementById('gmailHelper');

  const btnEmailLogin = document.getElementById('btnEmailLogin');
  const emailInput = document.getElementById('emailInput');
  const passInput = document.getElementById('passInput');

  const btnGuestToggle = document.getElementById('btnGuestToggle');
  const guestPanel = document.getElementById('guestPanel');
  const guestEmail = document.getElementById('guestEmail');
  const btnGuestContinue = document.getElementById('btnGuestContinue');

  btnGmail?.addEventListener('click', () => {
    if (gmailHelper) gmailHelper.textContent = 'Gmail login will be added later (requires hosted OAuth).';
    alert('Gmail login not wired yet.');
  });

  btnGuestToggle?.addEventListener('click', () => {
    guestPanel?.classList.toggle('open');
    const isOpen = guestPanel?.classList.contains('open');
    btnGuestToggle.setAttribute('aria-expanded', String(!!isOpen));
    const chev = btnGuestToggle.querySelector('.chev');
    if (chev) chev.textContent = isOpen ? '▴' : '▾';
  });

  btnGuestContinue?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const email = (guestEmail?.value || '').trim();
    if (!email) return alert('Guest email is required.');
    const u = db.upsertUser(email, '', 'guest');
    db.setSession({ userId: u.id, email: u.email, role: 'guest' });
    gotoInventory?.();
  });

  btnEmailLogin?.addEventListener('click', async () => {
    const email = (emailInput?.value || '').trim();
    const pass = passInput?.value || '';

    if (!email || !pass) return alert('Enter email and password.');

    // Admin shortcut in mock mode only (local prototype)
    if (CONFIG.MOCK_MODE && email.toLowerCase() === db.ADMIN.email.toLowerCase() && pass === db.ADMIN.password) {
      db.setSession({ userId: 'admin_1', email, role: 'admin' });
      gotoAdmin?.();
      return;
    }

    try {
      const r = await db.backendEmailLogin(email, pass);

      // If the backend requires verification, prompt for code (keeps UX minimal without adding a new page yet)
      if (r.needsVerification) {
        const code = prompt('Enter the verification code sent to your email:');
        if (!code) return alert('Verification required. Please try again.');
        await db.backendVerifyEmail(email, code.trim());
      }

      gotoInventory?.();
    } catch (e) {
      alert(e?.message || 'Login failed.');
    }
  });
}
