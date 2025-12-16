/* js/pages/review.js
   Review + place booking page
   Uses session helpers from app.js (NOT db.js)
*/

import { getCart, setCart, getCheckout, setCheckout } from "../app.js";
import { api } from "../api.js";

export async function renderReview(ctx) {
  const root = document.getElementById("page-review");
  if (!root) return;

  const cart = getCart();
  const checkout = getCheckout();

  if (!cart.length || !checkout.date || !checkout.address) {
    root.innerHTML = `<p>Missing checkout information.</p>`;
    return;
  }

  root.innerHTML = `
    <h2>Review Your Order</h2>

    <div id="reviewItems"></div>
    <div id="reviewDelivery"></div>
    <div id="reviewTotal" style="font-weight:bold;margin-top:8px"></div>

    <button id="placeOrderBtn" style="margin-top:12px">
      Place Booking
    </button>

    <div id="reviewMsg" style="margin-top:8px"></div>
  `;

  const itemsEl = root.querySelector("#reviewItems");
  const deliveryEl = root.querySelector("#reviewDelivery");
  const totalEl = root.querySelector("#reviewTotal");
  const msg = root.querySelector("#reviewMsg");

  // Render items
  itemsEl.innerHTML = `
    <h3>Items</h3>
    ${cart
      .map(
        (c) => `
        <div>
          ${c.qty} × ${c.id}
        </div>
      `
      )
      .join("")}
  `;

  // Delivery
  const deliveryFee = checkout.address.deliveryFee || 0;
  deliveryEl.innerHTML = `
    <h3>Delivery</h3>
    <div>${checkout.address.formatted}</div>
    <div>Fee: $${deliveryFee.toFixed(2)}</div>
  `;

  // Totals (final calculation always server-side)
  const quote = await api("booking.quote", {
    cart,
    date: checkout.date,
    address: checkout.address,
  });

  totalEl.textContent = `Total: $${quote.total.toFixed(2)}`;

  // Place booking
  root.querySelector("#placeOrderBtn").onclick = async () => {
    msg.textContent = "Placing booking…";

    try {
      await api("booking.create", {
        cart,
        checkout,
      });

      // Clear checkout session on success
      setCart([]);
      setCheckout({});

      msg.textContent = "Booking placed successfully ✔";
      location.hash = "#landing";
    } catch (err) {
      console.error(err);
      msg.textContent = "Failed to place booking.";
    }
  };
}
