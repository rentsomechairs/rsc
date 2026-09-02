import { signupEmployee, signupSecondaryEmployee, logoutAdmin } from './store.js?v=rental-ux-v59';

const form = document.getElementById('employeeSignupForm');
const status = document.getElementById('employeeSignupStatus');
const params = new URLSearchParams(window.location.search);
const secondaryFor = String(params.get('secondaryFor') || '').trim();
const secondaryName = String(params.get('secondaryName') || '').trim();
const isSecondary = Boolean(secondaryFor);

if (isSecondary) {
  document.querySelector('.eyebrow').textContent = 'Private Secondary Login';
  document.querySelector('h1').textContent = secondaryName ? `Help manage ${secondaryName}'s account` : 'Create a secondary login';
  document.querySelector('p.muted').textContent = 'After you sign up, the primary employee must review and approve your login before you can access anything.';
  const pickup = form.querySelector('[name="pickupAddress"]')?.closest('.form-row');
  if (pickup) pickup.remove();
  const emergencyName = form.querySelector('[name="emergencyContactName"]')?.closest('.form-row.two');
  if (emergencyName) emergencyName.remove();
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.textContent = 'Submit to Primary Employee';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  if (data.password !== data.confirmPassword) { status.textContent = 'Passwords do not match.'; return; }
  try {
    status.textContent = 'Creating account…';
    if (isSecondary) await signupSecondaryEmployee({ ...data, primaryEmployeeId: secondaryFor, primaryEmployeeName: secondaryName });
    else await signupEmployee(data);
    await logoutAdmin();
    form.reset();
    status.innerHTML = isSecondary
      ? '<strong>Signup received.</strong> The primary employee must approve this login before it can be used.'
      : '<strong>Signup received.</strong> Your account is pending administrator approval. You can use the admin login page after approval.';
  } catch (error) {
    status.textContent = error?.message || 'Signup failed.';
  }
});
