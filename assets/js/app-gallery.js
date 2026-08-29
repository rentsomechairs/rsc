import { getInventory, getSettings } from './store.js?v=rental-ux-v47';
import { currency, safeText } from './utils.js?v=rental-ux-v47';

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
  return { mode, color1: color(raw.color1,'#f8fafc'), color2: color(raw.color2,'#dbeafe'), angle: Math.max(0,Math.min(360,Number(raw.angle ?? 135)||0)), texture, textureOpacity: Math.max(0,Math.min(.45,Number(raw.textureOpacity ?? .18)||0)), imageScale:Math.max(.55,Math.min(1.8,Number(raw.imageScale??1.08)||1.08)), imageX:Math.max(-25,Math.min(25,Number(raw.imageX??0)||0)), imageY:Math.max(-25,Math.min(25,Number(raw.imageY??0)||0)), shadowEnabled:raw.shadowEnabled!==false, shadowColor:color(raw.shadowColor,'#0f172a'), shadowOpacity:Math.max(0,Math.min(.8,Number(raw.shadowOpacity??.28)||0)), shadowBlur:Math.max(0,Math.min(40,Number(raw.shadowBlur??14)||0)), shadowX:Math.max(-20,Math.min(20,Number(raw.shadowX??0)||0)), shadowY:Math.max(-20,Math.min(20,Number(raw.shadowY??7)||0)), edgeGlow:Math.max(0,Math.min(.6,Number(raw.edgeGlow??.12)||0)), brightness:Math.max(.7,Math.min(1.35,Number(raw.brightness??1)||1)), contrast:Math.max(.7,Math.min(1.5,Number(raw.contrast??1.04)||1.04)), saturation:Math.max(0,Math.min(1.8,Number(raw.saturation??1)||1)) };
}
function inventoryBackgroundCss() {
  const c=inventoryBackgroundConfig(), a=c.textureOpacity;
  const base=c.mode==='solid'?`linear-gradient(${c.color1},${c.color1})`:c.mode==='radial'?`radial-gradient(circle at 50% 50%,${c.color1} 0%,${c.color2} 100%)`:`linear-gradient(${c.angle}deg,${c.color1} 0%,${c.color2} 100%)`;
  let t='',size='auto';
  if(c.texture==='dots'){t=`radial-gradient(circle,rgba(15,23,42,${a}) 1px,transparent 1.5px)`;size='12px 12px, auto';}
  else if(c.texture==='grid'){t=`linear-gradient(rgba(15,23,42,${a}) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,${a}) 1px,transparent 1px)`;size='18px 18px,18px 18px,auto';}
  else if(c.texture==='diagonal')t=`repeating-linear-gradient(135deg,rgba(255,255,255,${a}) 0 2px,transparent 2px 9px)`;
  else if(c.texture==='linen')t=`repeating-linear-gradient(0deg,rgba(255,255,255,${a}) 0 1px,transparent 1px 4px),repeating-linear-gradient(90deg,rgba(15,23,42,${a*.45}) 0 1px,transparent 1px 5px)`;
  else if(c.texture==='noise'){t=`repeating-radial-gradient(circle at 20% 30%,rgba(15,23,42,${a*.55}) 0 0.7px,transparent .8px 3px)`;size='7px 7px,auto';}
  return `background-color:${c.color1};background-image:${t?`${t},${base}`:base};background-size:${size};background-position:center;`;
}

function inventoryHexRgba(hex,a){const v=/^#[0-9a-f]{6}$/i.test(String(hex||''))?String(hex).slice(1):'0f172a';return `rgba(${parseInt(v.slice(0,2),16)},${parseInt(v.slice(2,4),16)},${parseInt(v.slice(4,6),16)},${a})`;}
function inventoryImageCss(){const c=inventoryBackgroundConfig(),f=[];if(c.shadowEnabled&&c.shadowOpacity>0)f.push(`drop-shadow(${c.shadowX}px ${c.shadowY}px ${c.shadowBlur}px ${inventoryHexRgba(c.shadowColor,c.shadowOpacity)})`);if(c.edgeGlow>0)f.push(`drop-shadow(0 0 1.5px rgba(255,255,255,${c.edgeGlow}))`,`drop-shadow(0 0 1px rgba(15,23,42,${c.edgeGlow*.55}))`);f.push(`brightness(${c.brightness})`,`contrast(${c.contrast})`,`saturate(${c.saturation})`);return `transform:translate(${c.imageX}%,${c.imageY}%) scale(${c.imageScale});transform-origin:center;filter:${f.join(' ')};`;}

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
        <img class="gallery-image inventory-transparent-image" style="${inventoryImageCss()}" src="${safeText(itemImage(item))}" alt="${safeText(item.name)}" loading="lazy" />
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
