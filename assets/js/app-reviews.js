import { getPublicReviews } from './store.js?v=rental-ux-v60';
import { safeText } from './utils.js?v=rental-ux-v60';

const list = document.getElementById('publicReviewsList');
const status = document.getElementById('publicReviewsStatus');

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    if (list) list.innerHTML = '<div class="section-loading-card"><span class="section-loading-spinner" aria-hidden="true"></span><span>Loading from Firebase…</span></div>';
    const reviews = (await getPublicReviews()).filter((review) => String(review.message || '').trim());
    if (!reviews.length) {
      if (status) status.textContent = 'No reviews have been posted yet.';
      return;
    }
    if (status) status.classList.add('hidden');
    if (list) {
      list.innerHTML = reviews.map((review) => {
        const rating = Math.max(1, Math.min(5, Number(review.rating || 5)));
        const name = review.name || review.orderName || 'Customer';
        const stamp = review.createdAt ? new Date(review.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        return `<article class="public-review-card">
          <div class="review-stars-display">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div>
          <p>${safeText(review.message || '')}</p>
          <div class="small muted">— ${safeText(name)}${stamp ? ` · ${safeText(stamp)}` : ''}</div>
        </article>`;
      }).join('');
    }
  } catch (error) {
    console.error(error);
    if (status) status.textContent = 'Could not load reviews right now.';
  }
}
