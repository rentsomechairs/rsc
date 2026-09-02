import { getInventory, getOrders, getSettings } from './store.js?v=rental-ux-v60';
import { currency, safeText } from './utils.js?v=rental-ux-v60';

const els = {
  filters: document.getElementById('galleryFilters'),
  content: document.getElementById('galleryContent')
};

const state = {
  inventory: [],
  orders: [],
  settings: {},
  activeCategory: '__all__',
  categoryUsage: new Map(),
  selectedAccessoryByItem: new Map()
};

function normalizeCategory(value = '') {
  return String(value || 'Other').trim() || 'Other';
}

function normalizeAccessories(accessories = []) {
  return Array.isArray(accessories) ? accessories.map((entry, index) => ({
    id: String(entry?.id || `acc-${index}`),
    name: String(entry?.name || '').trim(),
    imageData: String(entry?.imageData || '').trim()
  })).filter((entry) => entry.name) : [];
}

function buildCategoryUsage() {
  const usage = new Map();
  const inventoryById = new Map(state.inventory.map((item) => [String(item.id || ''), item]));

  for (const order of state.orders || []) {
    const weight = order.status === 'Completed' ? 1 : ['Confirmed', 'In-Progress'].includes(order.status) ? 0.65 : 0.2;
    const categoriesInOrder = new Map();

    for (const line of order.items || []) {
      const inventoryItem = inventoryById.get(String(line.inventoryId || ''));
      const category = normalizeCategory(inventoryItem?.category || line.category || 'Other');
      categoriesInOrder.set(category, (categoriesInOrder.get(category) || 0) + Number(line.quantity || 0));
    }

    for (const [category, units] of categoriesInOrder.entries()) {
      const current = usage.get(category) || { units: 0, orders: 0, score: 0 };
      current.units += units * weight;
      current.orders += weight;
      current.score = current.units + (current.orders * 2);
      usage.set(category, current);
    }
  }

  state.categoryUsage = usage;
}

function categoryScore(category) {
  return Number(state.categoryUsage.get(normalizeCategory(category))?.score || 0);
}

function byCategory(items = []) {
  const groups = new Map();
  items.forEach((item) => {
    const category = normalizeCategory(item.category);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  });

  for (const [, groupItems] of groups) {
    groupItems.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  return [...groups.entries()].sort((a, b) => {
    const scoreDifference = categoryScore(b[0]) - categoryScore(a[0]);
    if (scoreDifference !== 0) return scoreDifference;
    return a[0].localeCompare(b[0]);
  });
}

function getCategories() {
  return byCategory(state.inventory).map(([category]) => category);
}

function filterItems() {
  if (state.activeCategory === '__all__') return state.inventory;
  return state.inventory.filter((item) => normalizeCategory(item.category) === state.activeCategory);
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

function renderAccessoryNames(item) {
  const accessories = normalizeAccessories(item.accessories);
  if (!accessories.length) return '';
  return `<div class="gallery-accessories" aria-label="Accessories for ${safeText(item.name)}">
    <span class="gallery-accessories-label">Accessories:</span>
    ${accessories.map((accessory) => `<button type="button" class="gallery-accessory-name${accessory.imageData ? '' : ' no-image'}" data-gallery-item-id="${safeText(item.id)}" data-gallery-accessory-id="${safeText(accessory.id)}" ${accessory.imageData ? '' : 'disabled title="No accessory image uploaded"'}>${safeText(accessory.name)}</button>`).join('')}
  </div>`;
}

function renderCard(item) {
  const stock = Number(item.stock || 0);
  const stockLabel = stock === 1 ? '1 available unit' : `${stock} available units`;
  const selectedAccessoryId = state.selectedAccessoryByItem.get(String(item.id || '')) || '';
  const selectedAccessory = normalizeAccessories(item.accessories).find((accessory) => accessory.id === selectedAccessoryId && accessory.imageData);
  const displayImage = selectedAccessory?.imageData || itemImage(item);
  return `
    <article class="gallery-card" data-gallery-card="${safeText(item.id)}">
      <div class="gallery-image-wrap" style="${inventoryBackgroundCss()}">
        <img class="gallery-image inventory-transparent-image" style="${inventoryImageCss()}" src="${safeText(displayImage)}" alt="${safeText(item.name)}" loading="lazy" data-gallery-card-image />
      </div>
      ${renderAccessoryNames(item)}
      <div class="gallery-card-body">
        <div class="gallery-card-top">
          <span class="gallery-price">${currency(item.price)}</span>
        </div>
        <h3>${safeText(item.name)}</h3>
        <div class="gallery-card-footer">
          <span class="gallery-stock">${safeText(stockLabel)}</span>
        </div>
      </div>
    </article>`;
}

function findInventoryItem(itemId) {
  return state.inventory.find((item) => String(item.id || '') === String(itemId || '')) || null;
}

function persistentImageForItem(item) {
  if (!item) return '';
  const selectedAccessoryId = state.selectedAccessoryByItem.get(String(item.id || '')) || '';
  const selectedAccessory = normalizeAccessories(item.accessories).find((accessory) => accessory.id === selectedAccessoryId && accessory.imageData);
  return selectedAccessory?.imageData || itemImage(item);
}

function updateAccessorySelectedState(card, itemId) {
  const selectedId = state.selectedAccessoryByItem.get(String(itemId || '')) || '';
  card.querySelectorAll('[data-gallery-accessory-id]').forEach((button) => {
    const selected = button.dataset.galleryAccessoryId === selectedId;
    button.classList.toggle('selected', selected);
    let remove = button.querySelector('.gallery-accessory-remove');
    if (selected && !remove) {
      remove = document.createElement('span');
      remove.className = 'gallery-accessory-remove';
      remove.setAttribute('aria-hidden', 'true');
      remove.textContent = '×';
      button.appendChild(remove);
    } else if (!selected && remove) {
      remove.remove();
    }
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    if (selected) button.title = 'Click again or click the red × to show the main image';
    else button.removeAttribute('title');
  });
}

function wireAccessoryPreviews() {
  els.content.querySelectorAll('[data-gallery-card]').forEach((card) => {
    const itemId = card.dataset.galleryCard;
    const item = findInventoryItem(itemId);
    const image = card.querySelector('[data-gallery-card-image]');
    if (!item || !image) return;

    const restorePersistentImage = () => {
      image.src = persistentImageForItem(item);
    };

    card.querySelectorAll('[data-gallery-accessory-id]').forEach((button) => {
      const accessory = normalizeAccessories(item.accessories).find((entry) => entry.id === button.dataset.galleryAccessoryId);
      if (!accessory?.imageData) return;

      button.addEventListener('mouseenter', () => { image.src = accessory.imageData; });
      button.addEventListener('mouseleave', restorePersistentImage);
      button.addEventListener('focus', () => { image.src = accessory.imageData; });
      button.addEventListener('blur', restorePersistentImage);
      button.addEventListener('click', () => {
        const key = String(itemId || '');
        if (state.selectedAccessoryByItem.get(key) === accessory.id) {
          state.selectedAccessoryByItem.delete(key);
          image.src = itemImage(item);
        } else {
          state.selectedAccessoryByItem.set(key, accessory.id);
          image.src = accessory.imageData;
        }
        updateAccessorySelectedState(card, itemId);
      });
    });

    updateAccessorySelectedState(card, itemId);
  });
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

  wireAccessoryPreviews();
}

async function init() {
  try {
    if (els.content) els.content.innerHTML = '<div class="section-loading-card"><span class="section-loading-spinner" aria-hidden="true"></span><span>Loading from Firebase…</span></div>';
    if (els.filters) els.filters.innerHTML = '<span class="badge badge-blue">Loading…</span>';
    const [inventory, orders, settings] = await Promise.all([getInventory(), getOrders(), getSettings()]);
    state.inventory = inventory;
    state.orders = orders || [];
    state.settings = settings || {};
    buildCategoryUsage();
    renderFilters();
    renderContent();
  } catch (error) {
    console.error(error);
    els.content.innerHTML = '<div class="card empty-state">The gallery could not be loaded right now.</div>';
  }
}

init();
