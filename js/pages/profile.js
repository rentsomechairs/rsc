/* js/pages/profile.js
   User profile page
   Exports renderProfile as expected by app.js
*/

import { api } from "../api.js";
import { getSession, setSession } from "../app.js";

export async function renderProfile(ctx) {
  const root = document.getElementById("page-profile");
  if (!root) return;

  const session = getSession();

  if (!session) {
    root.innerHTML = `<p>Please log in to view your profile.</p>`;
    return;
  }

  root.innerHTML = `
    <h2>Your Profile</h2>

    <div id="profileInfo">Loading…</div>

    <h3 style="margin-top:16px">Booking History</h3>
    <div id="bookingHistory">Loading…</div>

    <div style="margin-top:16px">
      <button id="logoutBtn">Log out</button>
    </div>
  `;

  const infoEl = root.querySelector("#profileInfo");
  const historyEl = root.querySelector("#bookingHistory");

  try {
    const res = await api("me.get", {});
    const user = res.user;

    infoEl.innerHTML = `
      <div><strong>Email:</strong> ${user.email}</div>
      <div><strong>Role:</strong> ${user.role}</div>
      <div><strong>Verified:</strong> ${user.verified ? "Yes" : "No"}</div>
    `;
  } catch (err) {
    console.error(err);
    infoEl.innerHTML = `<span style="color:red">Failed to load profile.</span>`;
  }

  try {
    const res = await api("booking.my", {});
    const bookings = res.items || [];

    if (!bookings.length) {
      historyEl.innerHTML = `<em>No bookings yet.</em>`;
    } else {
      historyEl.innerHTML = bookings
        .map(
          (b) => `
          <div style="border-bottom:1px solid #ddd;padding:6px 0">
            <div><strong>ID:</strong> ${b.id}</div>
            <div><strong>Date:</strong> ${b.date}</div>
            <div><strong>Status:</strong> ${b.status}</div>
            <div><strong>Total:</strong> $${Number(b.total).toFixed(2)}</div>
          </div>
        `
        )
        .join("");
    }
  } catch (err) {
    console.error(err);
    historyEl.innerHTML = `<span style="color:red">Failed to load bookings.</span>`;
  }

  root.querySelector("#logoutBtn").onclick = () => {
    setSession(null);
    location.hash = "#landing";
  };
}
