/* js/pages/address.js
   Address page
   Uses session helpers from app.js (NOT db.js)
*/

import { getCheckout, setCheckout } from "../app.js";
import { api } from "../api.js";

export async function renderAddress(ctx) {
  const root = document.getElementById("page-address");
  if (!root) return;

  const checkout = getCheckout();

  root.innerHTML = `
    <h2>Delivery Address</h2>
    <input
      type="text"
      id="addressInput"
      placeholder="Start typing your address…"
      style="width:100%;padding:8px"
    />
    <div id="addressMsg" style="margin-top:8px"></div>
  `;

  const input = root.querySelector("#addressInput");
  const msg = root.querySelector("#addressMsg");

  if (checkout.address?.formatted) {
    input.value = checkout.address.formatted;
  }

  input.addEventListener("change", async () => {
    const formatted = input.value.trim();
    if (!formatted) return;

    msg.textContent = "Calculating delivery…";

    try {
      // Backend geocodes + calculates distance + fee
      const res = await api("delivery.quote", {
        address: formatted,
      });

      setCheckout({
        ...checkout,
        address: {
          formatted,
          lat: res.lat,
          lng: res.lng,
          distanceMiles: res.distanceMiles,
          deliveryFee: res.deliveryFee,
        },
      });

      msg.textContent = `Delivery fee: $${res.deliveryFee.toFixed(2)} (${res.distanceMiles.toFixed(
        1
      )} mi)`;
    } catch (err) {
      console.error(err);
      msg.textContent = "Unable to calculate delivery.";
    }
  });
}
