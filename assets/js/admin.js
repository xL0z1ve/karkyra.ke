(() => {
'use strict';

/* ---------- утилиты ---------- */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const pad = n => String(n).padStart(2, '0');
const MONTHS_G = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DOW = ['вс','пн','вт','ср','чт','пт','сб'];
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => { const d = parseD(s); return `${d.getDate()} ${MONTHS_G[d.getMonth()]} ${d.getFullYear()}, ${DOW[d.getDay()]}`; };
const money = n => Number(n).toLocaleString('ru-RU') + ' сом';
const fmtT = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const tmin = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
const PALETTE = ['#e63946', '#f4a300', '#12857f', '#e76f51', '#3a86ff', '#8338ec', '#06a77d', '#d62839'];
function rainbow(el, text) {
  el.textContent = '';
  [...text].forEach((ch, i) => { const s = h('span', { text: ch === ' ' ? ' ' : ch }); s.style.color = PALETTE[i % PALETTE.length]; s.style.animationDelay = (i * .18) + 's'; el.append(s); });
  el.classList.add('rainbow');
}
let CSRF = '';
async function api(action, { query = '', body = null } = {}) {
  const opt = { method: body ? 'POST' : 'GET', cache: 'no-store', headers: { 'X-CSRF': CSRF } };
  if (body instanceof FormData) opt.body = body;
  else if (body) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  let r, j;
  try { r = await fetch('api.php?action=' + action + (query ? '&' + query : ''), opt); } catch { throw new Error('Нет связи с сервером.'); }
  try { j = await r.json(); } catch { throw new Error('Сервер не отвечает. Проверьте, что на хостинге включён PHP.'); }
  if (!j.ok) { const e = new Error(j.error || 'Ошибка'); e.status = r.status; if (r.status === 401) { CSRF = ''; boot(); } throw e; }
  return j;
}
function toast(msg, ms = 4000) { const t = h('div', { class: 'toast', text: msg }); document.body.append(t); setTimeout(() => t.remove(), ms); }
let modalEl = null;
function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; document.body.style.overflow = ''; } }
function openModal(content, wide) {
  closeModal();
  modalEl = h('div', { class: 'overlay', onmousedown: e => { if (e.target === modalEl) closeModal(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : '') }, h('button', { class: 'x', type: 'button', onclick: closeModal, text: '×', 'aria-label': 'Закрыть' }), content));
  $('#modalRoot').append(modalEl); document.body.style.overflow = 'hidden';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(.2, a.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, a.currentTime + .6); o.start(); o.stop(a.currentTime + .6);
  } catch {}
}

/* ---------- вход ---------- */
let pollTimer = null;
async function boot() {
  clearInterval(pollTimer);
  const app = $('#app'); app.textContent = '';
  let me;
  try { me = await api('me'); } catch (e) { app.append(h('div', { class: 'login-box card' }, h('div', { class: 'err', text: e.message }))); return; }
  if (me.auth) { CSRF = me.csrf; return startApp(); }
  const setup = me.setup_needed;
  const pw = h('input', { type: 'password', placeholder: setup ? 'Придумайте пароль (от 6 символов)' : 'Пароль', autocomplete: setup ? 'new-password' : 'current-password' });
  const pw2 = setup ? h('input', { type: 'password', placeholder: 'Повторите пароль', autocomplete: 'new-password' }) : null;
  const err = h('div', { class: 'err hidden' });
  const title = h('h1'); rainbow(title, 'Каркыра');
  const form = h('form', { class: 'login-box card' }, title,
    h('p', { class: 'sec-sub', text: setup ? 'Первый вход: создайте пароль администратора' : 'Кабинет администратора' }), pw, pw2, err,
    h('button', { class: 'btn block', type: 'submit', text: setup ? 'Создать пароль и войти' : 'Войти', style: 'margin-top:8px' }));
  form.addEventListener('submit', async ev => {
    ev.preventDefault(); err.classList.add('hidden');
    try {
      if (setup && pw.value !== pw2.value) throw new Error('Пароли не совпадают.');
      const j = await api(setup ? 'setup' : 'login', { body: { password: pw.value } });
      CSRF = j.csrf; startApp();
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  });
  app.append(form); pw.focus();
}

/* ---------- приложение ---------- */
const A = { tab: 'bookings', bookings: [], today: '', seen: null, pub: null, filter: 'new', fdate: '', q: '' };
async function startApp() {
  A.pub = await api('public');
  const app = $('#app'); app.textContent = '';
  const title = h('span', { class: 'brand-name' }); rainbow(title, A.pub.settings.name);
  const bBadge = h('span', { class: 'badge-dot hidden', id: 'newBadge' });
  const tabBtns = {};
  const mk = (k, label, extra) => (tabBtns[k] = h('button', { type: 'button', class: A.tab === k ? 'on' : '', onclick: () => { A.tab = k; Object.entries(tabBtns).forEach(([kk, b]) => b.classList.toggle('on', kk === k)); renderTab(); } }, label, extra));
  app.append(h('div', { class: 'wrap' },
    h('div', { style: 'display:flex;align-items:center;gap:12px;padding:16px 0 0;flex-wrap:wrap' }, title, h('span', { class: 'chip', text: 'Кабинет администратора' }),
      h('div', { style: 'margin-left:auto;display:flex;gap:8px' },
        h('a', { class: 'btn ghost sm', href: 'index.html', target: '_blank', text: 'Открыть сайт' }),
        h('button', { class: 'btn ghost sm', type: 'button', text: 'Выйти', onclick: async () => { await api('logout', { body: {} }).catch(() => {}); CSRF = ''; boot(); } }))),
    h('div', { class: 'atabs' }, mk('bookings', 'Заявки', bBadge), mk('menu', 'Меню'), mk('settings', 'Настройки')),
    h('div', { id: 'tabBody' })));
  await loadBookings(true);
  renderTab();
  pollTimer = setInterval(() => { if (!document.hidden) loadBookings(false); }, 15000);
}
function renderTab() {
  const b = $('#tabBody'); if (!b) return; b.textContent = '';
  if (A.tab === 'bookings') renderBookings();
  else if (A.tab === 'menu') renderMenu();
  else renderSettings();
}

/* ---------- заявки ---------- */
async function loadBookings(first) {
  try {
    const j = await api('admin_bookings');
    A.bookings = j.bookings; A.today = j.today;
    const pend = A.bookings.filter(b => b.status === 'pending');
    if (A.seen === null) A.seen = new Set(A.bookings.map(b => b.id));
    const fresh = pend.filter(b => !A.seen.has(b.id));
    if (fresh.length && !first) {
      beep(); toast(`🔔 Новая заявка: ${fresh[0].name}, ${fresh[0].table_label}, ${fmtDate(fresh[0].date)} ${fresh[0].start}`, 8000);
    }
    A.bookings.forEach(b => A.seen.add(b.id));
    const bd = $('#newBadge'); if (bd) { bd.textContent = pend.length; bd.classList.toggle('hidden', !pend.length); }
    document.title = (pend.length ? `(${pend.length}) ` : '') + 'Кабинет администратора';
    if (A.tab === 'bookings' && $('#bkList') && !modalEl) renderBookingList();
  } catch (e) { if (first) toast(e.message); }
}
const STL = { pending: 'Новая заявка', confirmed: 'Подтверждена', rejected: 'Отклонена', cancelled: 'Отменена' };
function filterFn(f) {
  const t = A.today;
  return {
    new: b => b.status === 'pending',
    upcoming: b => b.status === 'confirmed' && b.date >= t,
    past: b => b.date < t && (b.status === 'confirmed' || b.status === 'pending'),
    closed: b => b.status === 'rejected' || b.status === 'cancelled',
    all: () => true,
  }[f];
}
function renderBookings() {
  const body = $('#tabBody');
  const chips = h('div', { class: 'filters' });
  const defs = [['new', 'Новые'], ['upcoming', 'Предстоящие'], ['past', 'Прошедшие'], ['closed', 'Отклонённые/отменённые'], ['all', 'Все']];
  const date = h('input', { type: 'date', value: A.fdate, min: '2020-01-01', max: '2030-12-31', 'aria-label': 'Дата', onchange: e => { A.fdate = e.target.value; renderBookingList(); } });
  const q = h('input', { type: 'search', placeholder: 'Поиск: имя или телефон', value: A.q, oninput: e => { A.q = e.target.value; renderBookingList(); } });
  const draw = () => { chips.textContent = '';
    defs.forEach(([k, l]) => { const n = A.bookings.filter(filterFn(k)).length;
      chips.append(h('button', { type: 'button', class: 'chipb' + (A.filter === k ? ' on' : ''), text: `${l} · ${n}`, onclick: () => { A.filter = k; draw(); renderBookingList(); } })); });
    chips.append(date, q, h('button', { class: 'btn sm', type: 'button', text: '+ Новая бронь', style: 'margin-left:auto', onclick: openCreate })); };
  draw(); window.__drawChips = draw;
  body.append(chips, h('div', { id: 'bkList' }));
  renderBookingList();
}
function renderBookingList() {
  const box = $('#bkList'); if (!box) return;
  if (window.__drawChips) { const act = document.activeElement; if (!(act && act.type === 'search')) window.__drawChips(); }
  box.textContent = '';
  const q = A.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  let list = A.bookings.filter(filterFn(A.filter)).filter(b => !A.fdate || b.date === A.fdate)
    .filter(b => !q || b.name.toLowerCase().includes(q) || (qd && b.phone.replace(/\D/g, '').includes(qd)));
  list.sort((a, b) => (A.filter === 'past' || A.filter === 'closed' || A.filter === 'all') ? (b.date + b.start).localeCompare(a.date + a.start) : (a.date + a.start).localeCompare(b.date + b.start));
  if (!list.length) { box.append(h('div', { class: 'empty', text: 'Здесь пока ничего нет.' })); return; }
  list.forEach(b => box.append(bookingCard(b)));
}
async function act(id, payload, okMsg) {
  try { await api('booking_update', { body: { id, ...payload } }); if (okMsg) toast(okMsg); await loadBookings(false); renderBookingList(); }
  catch (e) { toast(e.message, 6000); }
}
function bookingCard(b) {
  const digits = b.phone.replace(/\D/g, '');
  const pre = b.preorder.length ? h('div', { class: 'pre' }, h('b', { text: 'Предзаказ: ' }), b.preorder.map(i => `${i.name} × ${i.qty}`).join(', '), ` — ${money(b.preorder_total)}`) : null;
  const acts = h('div', { class: 'acts' });
  if (b.status === 'pending') acts.append(h('button', { class: 'btn ok sm', type: 'button', text: '✓ Подтвердить', onclick: () => act(b.id, { status: 'confirmed' }, 'Бронь подтверждена') }),
    h('button', { class: 'btn danger sm', type: 'button', text: 'Отклонить', onclick: () => confirm('Отклонить заявку? Стол освободится.') && act(b.id, { status: 'rejected' }, 'Заявка отклонена') }));
  if (b.status === 'confirmed') acts.append(h('button', { class: 'btn danger sm', type: 'button', text: 'Отменить бронь', onclick: () => confirm('Отменить бронь? Стол освободится.') && act(b.id, { status: 'cancelled' }, 'Бронь отменена') }));
  if (b.status === 'rejected' || b.status === 'cancelled') acts.append(h('button', { class: 'btn ghost sm', type: 'button', text: 'Вернуть бронь', onclick: () => act(b.id, { status: 'confirmed' }, 'Бронь возвращена') }));
  acts.append(h('button', { class: 'btn ghost sm', type: 'button', text: b.paid ? 'Снять отметку об оплате' : '💰 Отметить оплату', onclick: () => act(b.id, { paid: !b.paid }) }),
    h('button', { class: 'btn danger sm', type: 'button', text: 'Удалить', onclick: async () => { if (!confirm('Удалить запись навсегда?')) return; try { await api('booking_delete', { body: { id: b.id } }); await loadBookings(false); renderBookingList(); } catch (e) { toast(e.message); } } }));
  return h('div', { class: 'bk' + (b.status === 'pending' ? ' new' : '') },
    h('div', { class: 'h' }, h('div', { class: 'when', text: `${fmtDate(b.date)} · ${b.start}–${b.end}` }), h('span', { class: 'st ' + b.status, text: STL[b.status] })),
    h('div', {}, h('b', { text: `${b.table_label}` }), ` · ${b.zone} · ${b.guests} гост.`),
    h('div', {}, h('b', { text: b.name }), '  ', digits ? h('a', { href: 'tel:' + b.phone.replace(/[^\d+]/g, ''), text: b.phone }) : '', digits ? ' · ' : '',
      digits ? h('a', { href: 'https://wa.me/' + digits, target: '_blank', rel: 'noopener', text: 'WhatsApp' }) : ''),
    b.comment ? h('div', { class: 'meta', text: '💬 ' + b.comment }) : null, pre,
    h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
      h('span', { text: `Задаток: ${money(b.deposit)}${b.has_preorder ? ' (с предзаказом)' : ''}`, style: 'font-weight:800' }),
      h('span', { class: 'tag ' + (b.paid ? 'paid' : 'unpaid'), text: b.paid ? 'Оплачено' : 'Оплата не отмечена' }),
      b.receipt ? h('img', { class: 'rc', src: b.receipt, alt: 'Чек', title: 'Открыть чек', onclick: () => { openModal(h('img', { class: 'zoom', src: b.receipt, alt: 'Чек' }), true); } }) : h('span', { class: 'meta', text: 'чек не приложен' })),
    h('div', { class: 'meta', text: `${b.source === 'admin' ? 'Добавлено администратором' : 'С сайта'} · ${new Date(b.created_at).toLocaleString('ru-RU')}` }),
    acts);
}
function openCreate() {
  const c = A.pub.settings;
  const slots = []; for (let m = A.pub.open_m; m + c.duration <= A.pub.close_m; m += c.step) slots.push(m);
  const date = h('input', { type: 'date', value: A.today, min: A.today, max: '2030-12-31' });
  const time = h('select', { style: 'width:100%;padding:10px 12px' }, slots.map(m => h('option', { value: fmtT(m), text: `${fmtT(m)}–${fmtT(m + c.duration)}` })));
  const guests = h('input', { type: 'number', min: '1', max: '40', value: '2' });
  const table = h('select', { style: 'width:100%;padding:10px 12px' }, A.pub.layout.map(z => h('optgroup', { label: z.name }, z.rows.flat().map(t => h('option', { value: t.id, text: `${t.label} (до ${t.cap})` })))));
  const name = h('input', { type: 'text', placeholder: 'Имя гостя', maxlength: '60' });
  const phone = h('input', { type: 'tel', placeholder: 'Телефон (необязательно)' });
  const comment = h('input', { type: 'text', placeholder: 'Комментарий', maxlength: '500' });
  const paid = h('input', { type: 'checkbox', style: 'width:auto' });
  const err = h('div', { class: 'err hidden' });
  const f = h('form', {}, h('h3', { text: 'Новая бронь (по звонку / лично)' }),
    h('div', { class: 'form-grid', style: 'margin-top:12px' },
      h('label', {}, h('span', { text: 'Дата' }), date), h('label', {}, h('span', { text: 'Время' }), time),
      h('label', {}, h('span', { text: 'Гостей' }), guests), h('label', {}, h('span', { text: 'Стол' }), table),
      h('label', {}, h('span', { text: 'Имя' }), name), h('label', {}, h('span', { text: 'Телефон' }), phone),
      h('label', { class: 'full' }, h('span', { text: 'Комментарий' }), comment),
      h('label', { class: 'full' }, paid, ' Задаток получен')), err,
    h('button', { class: 'btn block', type: 'submit', text: 'Добавить бронь', style: 'margin-top:14px' }),
    h('p', { class: 'hint', text: 'Бронь сразу подтверждается, а стол на сайте отображается занятым.' }));
  f.addEventListener('submit', async ev => {
    ev.preventDefault(); err.classList.add('hidden');
    try {
      await api('booking_create', { body: { date: date.value, start: time.value, guests: +guests.value, table: table.value, name: name.value, phone: phone.value, comment: comment.value, paid: paid.checked } });
      closeModal(); toast('Бронь добавлена'); await loadBookings(false); renderBookingList();
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  });
  openModal(f);
}

/* ---------- меню ---------- */
let menuData = [], saveTimer = null, savedEl = null;
const uid = () => Math.random().toString(36).slice(2, 10);
function queueSave() {
  if (savedEl) { savedEl.textContent = 'Сохранение…'; savedEl.style.color = 'var(--muted)'; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { const j = await api('menu_save', { body: { menu: menuData } }); if (savedEl) { savedEl.textContent = 'Сохранено ✓'; savedEl.style.color = 'var(--free)'; } A.pub.menu = j.menu; }
    catch (e) { if (savedEl) { savedEl.textContent = 'Ошибка: ' + e.message; savedEl.style.color = 'var(--busy)'; } }
  }, 600);
}
function renderMenu() {
  menuData = JSON.parse(JSON.stringify(A.pub.menu || []));
  const body = $('#tabBody');
  savedEl = h('span', { class: 'saved' });
  body.append(h('div', { class: 'filters' }, h('button', { class: 'btn sm', type: 'button', text: '+ Добавить категорию', onclick: () => { menuData.push({ id: uid(), name: '', items: [] }); drawMenu(true); queueSave(); } }), savedEl),
    h('p', { class: 'hint', text: 'Изменения сохраняются автоматически и сразу появляются на сайте. Эти блюда гости могут выбрать для предзаказа.' }), h('div', { id: 'menuBox' }));
  drawMenu();
}
function drawMenu(focusLast) {
  const box = $('#menuBox'); box.textContent = '';
  if (!menuData.length) box.append(h('div', { class: 'empty', text: 'Категорий пока нет. Нажмите «+ Добавить категорию» (например: Горячие блюда, Напитки, Десерты).' }));
  menuData.forEach((c, ci) => {
    const items = h('div');
    const drawItems = () => { items.textContent = '';
      c.items.forEach((it, ii) => items.append(h('div', { class: 'mitem' },
        h('input', { type: 'text', placeholder: 'Название блюда', value: it.name, maxlength: '100', oninput: e => { it.name = e.target.value; queueSave(); } }),
        h('input', { type: 'number', min: '0', step: '1', placeholder: 'Цена', value: it.price === 0 && !it.touched ? '' : it.price, 'aria-label': 'Цена, сом', oninput: e => { it.price = Math.max(0, parseInt(e.target.value || '0', 10) || 0); it.touched = true; queueSave(); } }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Удалить блюдо', text: '🗑', onclick: () => { c.items.splice(ii, 1); drawItems(); queueSave(); } })))); };
    drawItems();
    const catName = h('input', { type: 'text', placeholder: 'Название категории', value: c.name, maxlength: '60', oninput: e => { c.name = e.target.value; queueSave(); } });
    box.append(h('div', { class: 'mcat' },
      h('div', { class: 'mcat-h' }, catName,
        h('button', { class: 'icon-btn', type: 'button', title: 'Вверх', text: '↑', disabled: ci === 0, onclick: () => { [menuData[ci - 1], menuData[ci]] = [menuData[ci], menuData[ci - 1]]; drawMenu(); queueSave(); } }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Вниз', text: '↓', disabled: ci === menuData.length - 1, onclick: () => { [menuData[ci + 1], menuData[ci]] = [menuData[ci], menuData[ci + 1]]; drawMenu(); queueSave(); } }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Удалить категорию', text: '🗑', onclick: () => { if (!c.items.length || confirm(`Удалить категорию «${c.name || 'без названия'}» вместе с блюдами?`)) { menuData.splice(ci, 1); drawMenu(); queueSave(); } } })),
      items,
      h('button', { class: 'btn ghost sm', type: 'button', text: '+ Добавить блюдо', onclick: () => { c.items.push({ id: uid(), name: '', price: 0 }); drawItems(); const ins = items.querySelectorAll('input[type=text]'); ins[ins.length - 1].focus(); queueSave(); } })));
    if (focusLast && ci === menuData.length - 1) catName.focus();
  });
}

/* ---------- настройки ---------- */
async function renderSettings() {
  const body = $('#tabBody');
  let S;
  try { S = (await api('settings_get')).settings; } catch (e) { body.append(h('div', { class: 'err', text: e.message })); return; }
  const f = {};
  const inp = (key, label, opts = {}) => { f[key] = h(opts.area ? 'textarea' : 'input', { type: opts.area ? null : (opts.type || 'text'), rows: opts.area ? '3' : null, value: S[key] ?? '', placeholder: opts.ph || '', maxlength: opts.max || null, min: opts.min || null, step: opts.step || null });
    return h('label', { class: opts.full ? 'full' : '' }, h('span', { text: label }), f[key]); };
  const sel = (key, label, options) => { f[key] = h('select', { style: 'width:100%;padding:10px 12px' }, options.map(([v, t]) => h('option', { value: v, text: t }))); f[key].value = S[key]; return h('label', {}, h('span', { text: label }), f[key]); };

  const imgPanel = (kind, label, hint) => {
    const box = h('div', { class: 'imgbox' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden' });
    const draw = () => { box.textContent = '';
      box.append(S[kind] ? h('img', { src: S[kind] + '?v=' + Date.now(), alt: label }) : h('div', { class: 'ph', text: 'Не добавлен' }),
        h('div', { style: 'display:grid;gap:8px' }, h('button', { class: 'btn sm', type: 'button', text: S[kind] ? 'Заменить' : 'Загрузить', onclick: () => file.click() }),
          S[kind] ? h('button', { class: 'btn danger sm', type: 'button', text: 'Удалить', onclick: async () => { await api('remove_image', { body: { kind } }); S[kind] = ''; A.pub.settings[kind] = ''; draw(); toast('Удалено'); } }) : null,
          h('span', { class: 'hint', text: hint }))); };
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      const fd = new FormData(); fd.set('kind', kind); fd.set('file', file.files[0]);
      try { const j = await api('upload_image', { body: fd }); S[kind] = j.path; A.pub.settings[kind] = j.path; draw(); toast('Загружено ✓'); } catch (e) { toast(e.message, 6000); }
      file.value = '';
    });
    draw();
    return h('div', { class: 'card panel' }, h('h3', { text: label }), box, file);
  };

  const fl = S.floors;
  const floorRows = fl.map((x, i) => { f['fn' + i] = h('input', { type: 'text', value: x.name, maxlength: '30' }); f['fr' + i] = h('input', { type: 'text', value: x.rows.join(','), placeholder: '3,3' }); f['fc' + i] = h('input', { type: 'number', min: '1', max: '30', value: x.capacity });
    return h('div', { class: 'form-grid', style: 'margin-bottom:10px' }, h('label', {}, h('span', { text: 'Название' }), f['fn' + i]), h('label', {}, h('span', { text: 'Столов в рядах (через запятую)' }), f['fr' + i]), h('label', {}, h('span', { text: 'Мест за столом' }), f['fc' + i])); });
  f.cc = h('input', { type: 'number', min: '0', max: '10', value: S.cabins.count }); f.ccap = h('input', { type: 'number', min: '1', max: '40', value: S.cabins.capacity });

  const oldPw = h('input', { type: 'password', placeholder: 'Текущий пароль', autocomplete: 'current-password' });
  const newPw = h('input', { type: 'password', placeholder: 'Новый пароль (от 6 символов)', autocomplete: 'new-password' });
  const err = h('div', { class: 'err hidden' });

  body.append(
    h('div', { class: 'card panel' }, h('h3', { text: 'Основное' }), h('div', { class: 'form-grid' },
      inp('name', 'Название кафе', { max: 40 }), inp('tagline', 'Подзаголовок на главной', { max: 120 }), inp('description', 'Короткое описание кафе (необязательно)', { area: true, full: true, max: 500 }))),
    imgPanel('logo', 'Логотип', 'PNG/JPG/WEBP, лучше квадратный'),
    h('div', { class: 'card panel' }, h('h3', { text: 'Контакты' }), h('div', { class: 'form-grid' },
      inp('address', 'Адрес', { full: true }), inp('phone', 'Телефон', { ph: '+996 ...' }), inp('phone2', 'Второй телефон'), inp('whatsapp', 'WhatsApp (номер)', { ph: '+996 ...' }),
      inp('instagram', 'Instagram (@имя или ссылка)'), inp('map_link', 'Ссылка на карту (2GIS / Google Maps)', { full: true }))),
    imgPanel('qr', 'QR-код для оплаты задатка', 'Гости увидят этот QR при бронировании'),
    h('div', { class: 'card panel' }, h('div', { class: 'form-grid' }, inp('qr_note', 'Текст под QR-кодом (получатель, банк, реквизиты)', { area: true, full: true, max: 300 }))),
    h('div', { class: 'card panel' }, h('h3', { text: 'Время и задаток' }), h('div', { class: 'form-grid' },
      inp('open', 'Открытие', { type: 'time' }), inp('close', 'Закрытие (00:00 = полночь)', { type: 'time' }),
      sel('step', 'Шаг выбора времени', [[15, 'каждые 15 минут'], [30, 'каждые 30 минут'], [60, 'каждый час']]),
      inp('duration', 'Длительность брони, минут', { type: 'number', min: '30', step: '15' }),
      inp('deposit_without', 'Задаток без предзаказа, сом', { type: 'number', min: '0' }), inp('deposit_with', 'Задаток с предзаказом, сом', { type: 'number', min: '0' }),
      sel('timezone', 'Часовой пояс', [['Asia/Bishkek', 'Бишкек (UTC+6)'], ['Asia/Almaty', 'Алматы'], ['Asia/Tashkent', 'Ташкент'], ['Europe/Moscow', 'Москва'], ['Asia/Dubai', 'Дубай']]))),
    h('div', { class: 'card panel' }, h('h3', { text: 'Залы и столы' }), h('p', { class: 'hint', text: 'Каждое число — количество столов в одном ряду. Например «3,3» — два ряда по 3 стола. Брони уже созданных столов сохраняются, но при смене схемы проверьте нумерацию.' }),
      floorRows, h('div', { class: 'form-grid' }, h('label', {}, h('span', { text: 'Кабинок' }), f.cc), h('label', {}, h('span', { text: 'Мест в кабинке' }), f.ccap))),
    h('div', { class: 'card panel' }, h('h3', { text: 'Уведомления в Telegram (по желанию)' }), h('p', { class: 'hint', text: 'Создайте бота через @BotFather, нажмите у него Start и укажите токен и свой chat id — тогда новые заявки будут приходить вам в Telegram.' }),
      h('div', { class: 'form-grid' }, inp('tg_token', 'Токен бота', { max: 80 }), inp('tg_chat', 'Chat ID', { max: 40 }),
        h('div', {}, h('button', { class: 'btn ghost sm', type: 'button', text: 'Отправить тест', onclick: async () => { try { await api('tg_test', { body: { tg_token: f.tg_token.value, tg_chat: f.tg_chat.value } }); toast('Тест отправлен ✓'); } catch (e) { toast(e.message, 7000); } } })))),
    h('div', { class: 'card panel' }, h('h3', { text: 'Сменить пароль' }), h('div', { class: 'form-grid' }, h('label', {}, oldPw), h('label', {}, newPw),
      h('div', {}, h('button', { class: 'btn ghost sm', type: 'button', text: 'Сменить пароль', onclick: async () => { try { await api('password_change', { body: { old: oldPw.value, new: newPw.value } }); oldPw.value = newPw.value = ''; toast('Пароль изменён ✓'); } catch (e) { toast(e.message, 6000); } } })))),
    err,
    h('div', { style: 'position:sticky;bottom:12px;margin:12px 0 40px' }, h('button', { class: 'btn block', type: 'button', text: 'Сохранить настройки', onclick: async ev => {
      err.classList.add('hidden');
      const payload = { floors: fl.map((x, i) => ({ name: f['fn' + i].value, rows: f['fr' + i].value, capacity: +f['fc' + i].value })), cabins: { count: +f.cc.value, capacity: +f.ccap.value } };
      ['name','tagline','description','address','phone','phone2','whatsapp','instagram','map_link','qr_note','open','close','step','duration','deposit_with','deposit_without','timezone','tg_token','tg_chat'].forEach(k => payload[k] = f[k].value);
      const btn = ev.target; btn.disabled = true;
      try { await api('settings_save', { body: payload }); A.pub = await api('public'); toast('Сохранено ✓'); }
      catch (e) { err.textContent = e.message; err.classList.remove('hidden'); err.scrollIntoView({ block: 'center' }); }
      btn.disabled = false;
    } })));
}

boot();
})();
