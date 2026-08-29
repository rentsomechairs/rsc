import { getInventory, getSettings } from './store.js';
import { currency, safeText } from './utils.js';

const els = {
  filters: document.getElementById('galleryFilters'),
  content: document.getElementById('galleryContent')
};

const state = {
  inventory: [],
  settings: {},
  activeCategory: '__all__'
};

function byCategory(items = []) {
  const groups = new Map();
  items.forEach((item) => {
    const category = String(item.category || 'Other').trim() || 'Other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  });
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function getCategories() {
  return byCategory(state.inventory).map(([category]) => category);
}

function filterItems() {
  if (state.activeCategory === '__all__') return state.inventory;
  return state.inventory.filter((item) => String(item.category || 'Other') === state.activeCategory);
}

function resolveGalleryImage(src = '') {
  const value = String(src || '').trim();
  if (!value) return '../images/library.json';
  if (/^(data:|blob:|https?:\/\/|\/)/i.test(value)) return value;
  if (value.startsWith('../') || value.startsWith('./')) return value;
  return `../${value.replace(/^\/+/, '')}`;
}

function itemImage(item) {
  return item?.imageData || resolveGalleryImage(item?.imageUrl || '');
}

function inventoryBackgroundConfig() {
  const raw = state.settings?.inventoryImageBackground || {};
  const mode = ['solid','linear','radial'].includes(raw.mode) ? raw.mode : 'linear';
  const texture = ['none','noise','dots','grid','linen','diagonal'].includes(raw.texture) ? raw.texture : 'none';
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
  return { mode, color1: color(raw.color1,'#f8fafc'), color2: color(raw.color2,'#dbeafe'), angle: Math.max(0,Math.min(360,Number(raw.angle ?? 135)||0)), texture, textureOpacity: Math.max(0,Math.min(.45,Number(raw.textureOpacity ?? .18)||0)) };
}
function inventoryBackgroundCss() {
  const c=inventoryBackgroundConfig(), a=c.textureOpacity;
  const base=c.mode==='solid'?`linear-gradient(${c.color1},${c.color1})`:c.mode==='radial'?`radial-gradient(circle at 35% 25%,${c.color1} 0%,${c.color2} 100%)`:`linear-gradient(${c.angle}deg,${c.color1} 0%,${c.color2} 100%)`;
  let t='',size='auto';
  if(c.texture==='dots'){t=`radial-gradient(circle,rgba(15,23,42,${a}) 1px,transparent 1.5px)`;size='12px 12px, auto';}
  else if(c.texture==='grid'){t=`linear-gradient(rgba(15,23,42,${a}) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,${a}) 1px,transparent 1px)`;size='18px 18px,18px 18px,auto';}
  else if(c.texture==='diagonal')t=`repeating-linear-gradient(135deg,rgba(255,255,255,${a}) 0 2px,transparent 2px 9px)`;
  else if(c.texture==='linen')t=`repeating-linear-gradient(0deg,rgba(255,255,255,${a}) 0 1px,transparent 1px 4px),repeating-linear-gradient(90deg,rgba(15,23,42,${a*.45}) 0 1px,transparent 1px 5px)`;
  else if(c.texture==='noise'){t=`repeating-radial-gradient(circle at 20% 30%,rgba(15,23,42,${a*.55}) 0 0.7px,transparent .8px 3px)`;size='7px 7px,auto';}
  return `background-color:${c.color1};background-image:${t?`${t},${base}`:base};background-size:${size};background-position:center;`;
}

function renderFilters() {
  const categories = getCategories();
  const buttons = ['__all__', ...categories].map((category) => {
    const active = category === state.activeCategory;
    const label = category === '__all__' ? 'All Items' : category;
    return `<button type="button" class="category-chip ${active ? 'active' : ''}" data-gallery-filter="${safeText(category)}">${safeText(label)}</button>`;
  }).join('');
  els.filters.innerHTML = buttons;
  els.filters.querySelectorAll('[data-gallery-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeCategory = button.dataset.galleryFilter;
      renderFilters();
      renderContent();
    });
  });
}

function renderCard(item) {
  const stock = Number(item.stock || 0);
  const stockLabel = stock === 1 ? '1 available unit' : `${stock} available units`;
  return `
    <article class="gallery-card">
      <div class="gallery-image-wrap" style="${inventoryBackgroundCss()}">
        <img class="gallery-image inventory-transparent-image" src="${safeText(itemImage(item))}" alt="${safeText(item.name)}" loading="lazy" />
      </div>
      <div class="gallery-card-body">
        <div class="gallery-card-top">
          <span class="gallery-price">${currency(item.price)}</span>
        </div>
        <h3>${safeText(item.name)}</h3>
        <div class="gallery-card-footer">
          <span class="gallery-stock">${safeText(stockLabel)}</span>
          <a class="btn btn-primary btn-small" href="../quick-picker/index.html">Request</a>
        </div>
      </div>
    </article>`;
}

function renderContent() {
  const filtered = filterItems();
  const groups = byCategory(filtered);
  if (!filtered.length) {
    els.content.innerHTML = '<div class="card empty-state">No gallery items to show yet.</div>';
    return;
  }

  els.content.innerHTML = groups.map(([category, items]) => `
    <section class="gallery-section" id="gallery-${safeText(category).toLowerCase().replace(/[^a-z0-9]+/g, '-')}">
      ${state.activeCategory === '__all__' ? `<div class="section-header gallery-section-head"><div><h2>${safeText(category)}</h2></div><div class="badge badge-green">${items.length} item${items.length === 1 ? '' : 's'}</div></div>` : ''}
      <div class="gallery-grid">
        ${items.map(renderCard).join('')}
      </div>
    </section>
  `).join('');
}

async function init() {
  try {
    if (els.content) els.content.innerHTML = '<div class="section-loading-card"><span class="section-loading-spinner" aria-hidden="true"></span><span>Loading from Firebase…</span></div>';
    if (els.filters) els.filters.innerHTML = '<span class="badge badge-blue">Loading…</span>';
    const [inventory, settings] = await Promise.all([getInventory(), getSettings()]);
    state.inventory = inventory.sort((a, b) => {
      const categoryCompare = String(a.category || '').localeCompare(String(b.category || ''));
      if (categoryCompare !== 0) return categoryCompare;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    state.settings = settings || {};
    renderFilters();
    renderContent();
  } catch (error) {
    console.error(error);
    els.content.innerHTML = '<div class="card empty-state">The gallery could not be loaded right now.</div>';
  }
}

init();
