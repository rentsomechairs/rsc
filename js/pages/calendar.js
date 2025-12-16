/* js/pages/calendar.js
   Calendar / date selection page
   Uses session helpers from app.js (NOT db.js)
*/

import { getCart, getCheckout, setCheckout } from "../app.js";
import { api } from "../api.js";

export async function renderCalendar(ctx) {
  const root = document.getElementById("page-calendar");
  if (!root) return;

  const cart = getCart();
  const checkout = getCheckout();

  if (!cart.length) {
    root.innerHTML = `<p>Please select inventory first.</p>`;
    return;
  }

  root.innerHTML = `
    <h2>Select Date</h2>
    <input type="date" id="dateInput" />
    <div id="dateMsg"></div>
  `;

  const dateInput = root.querySelector("#dateInput");
  const msg = root.querySelector("#dateMsg");

  if (checkout.date) {
    dateInput.value = checkout.date;
  }

  dateInput.addEventListener("change", async () => {
    const date = dateInput.value;
    if (!date) return;

    msg.textContent = "Checking availability…";

    try {
      // Server validates availability against existing bookings
      const res = await api("availability.check", {
        date,
        cart,
      });

      if (!res.available) {
        msg.textContent = "Not enough inventory for that date.";
        return;
      }

      setCheckout({
        ...checkout,
        date,
      });

      msg.textContent = "Date available ✔";
    } catch (err) {
      console.error(err);
      msg.textContent = "Error checking availability.";
    }
  });
}
