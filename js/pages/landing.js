/* js/pages/landing.js */

import { api } from "../api.js";
import { setSession } from "../app.js";

const PENDING_EMAIL_KEY = "rsc_pending_email_v1";

export function renderLanding(root){
  root.innerHTML = `
    <h2>Welcome</h2>
    <p class="muted">Sign in with Google, email, or continue as guest.</p>

    <div class="card" style="margin-top:12px">
      <h3>Login with Google</h3>
      <div id="googleBtnWrap" style="margin-top:10px"></div>
      <div class="muted" style="margin-top:8px;font-size:13px">If the button doesn't appear, check your browser blocks or Google OAuth settings.</div>
    </div>

    <div class="card" style="margin-top:12px">
      <h3>Login with Email</h3>
      <input id="emailInput" type="email" placeholder="Email" />
      <input id="passwordInput" type="password" placeholder="Password" />
      <button id="emailLoginBtn">Login / Sign Up</button>
    </div>

    <div class="card" style="margin-top:12px">
      <h3>Continue as Guest</h3>
      <button id="guestBtn" class="btn-secondary">Continue as Guest</button>
    </div>

    <div id="landingMsg" style="margin-top:10px"></div>
  `;

  const msg = root.querySelector("#landingMsg");

  // ---------- Guest ----------
  root.querySelector("#guestBtn").addEventListener("click", async () => {
    msg.textContent = "Continuing as guest…";
    try{
      const res = await api("auth.guest", {});
      setSession(res.session);
    }catch(e){
      // fallback (mock mode or offline)
      console.warn(e);
      setSession({ role:"guest", email:null, token:null });
    }
    location.hash = "#inventory";
  });

  // ---------- Email ----------
  root.querySelector("#emailLoginBtn").addEventListener("click", async () => {
    const email = root.querySelector("#emailInput").value.trim().toLowerCase();
    const password = root.querySelector("#passwordInput").value;

    if (!email || !password) {
      msg.textContent = "Enter email and password.";
      return;
    }

    msg.textContent = "Signing in…";

    try {
      const res = await api("auth.email", { email, password });

      // Backend returns {status:'verify_required'} when user is unverified
      if (res.status === "verify_required"){
        sessionStorage.setItem(PENDING_EMAIL_KEY, email);
        location.hash = "#verify";
        return;
      }

      // Backend returns {session:{...}}
      if (res.session){
        setSession(res.session);
        location.hash = "#inventory";
        return;
      }

      msg.textContent = "Unexpected login response.";
    } catch (e) {
      console.error(e);
      msg.textContent = e?.message || "Login failed.";
    }
  });

  // ---------- Google ----------
  // Uses Google Identity Services loaded in index.html
  const wrap = root.querySelector("#googleBtnWrap");

  function renderGoogleButton(){
    const clientIdMeta = document.querySelector('meta[name="google-signin-client_id"]')?.getAttribute("content");
    const clientId = clientIdMeta || null;

    if (!window.google?.accounts?.id || !clientId){
      wrap.innerHTML = `<div class="muted">Google Sign-In not ready.</div>`;
      return;
    }

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        msg.textContent = "Signing in with Google…";
        try{
          const r = await api("auth.google", { idToken: resp.credential });
          setSession(r.session);
          location.hash = "#inventory";
        }catch(e){
          console.error(e);
          msg.textContent = e?.message || "Google login failed.";
        }
      },
    });

    wrap.innerHTML = "";
    window.google.accounts.id.renderButton(wrap, { theme: "outline", size: "large", text: "signin_with" });
  }

  // slight delay so GIS can finish loading
  setTimeout(renderGoogleButton, 250);
}
