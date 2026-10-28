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
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const pad = n => String(n).padStart(2, '0');
const fmtT = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_G = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DOW = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const ds = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => { const d = parseD(s); return `${d.getDate()} ${MONTHS_G[d.getMonth()]} ${d.getFullYear()}, ${DOW[d.getDay()]}`; };
const money = n => Number(n).toLocaleString('ru-RU') + ' сом';
const guestsWord = n => (n % 10 === 1 && n % 100 !== 11) ? 'гость' : ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) ? 'гостя' : 'гостей';
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
async function api(action, { query = '', body = null } = {}) {
  let r, j;
  try { r = await fetch('api.php?action=' + action + (query ? '&' + query : ''), { method: body ? 'POST' : 'GET', body, cache: 'no-store' }); }
  catch { throw new Error('Нет связи с сервером. Проверьте интернет.'); }
  try { j = await r.json(); } catch { throw new Error('Сервер не отвечает. Убедитесь, что сайт загружен на хостинг с поддержкой PHP.'); }
  if (!j.ok) { const e = new Error(j.error || 'Ошибка'); e.status = r.status; throw e; }
  return j;
}
function toast(msg, ms = 4500) {
  const t = h('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t); setTimeout(() => t.remove(), ms);
}
const PALETTE = ['#e63946', '#f4a300', '#12857f', '#e76f51', '#3a86ff', '#8338ec', '#06a77d', '#d62839'];
function rainbow(el, text) {
  el.textContent = '';
  [...text].forEach((ch, i) => {
    const s = h('span', { text: ch === ' ' ? ' ' : ch });
    s.style.color = PALETTE[i % PALETTE.length];
    s.style.animationDelay = (i * 0.18) + 's';
    el.append(s);
  });
  el.classList.add('rainbow');
  el.setAttribute('aria-label', text);
}

/* ---------- состояние ---------- */
const S = { cfg: null, layout: [], menu: [], now: null, maxDate: '2030-12-31', openM: 600, closeM: 1380,
  date: null, time: null, guests: 2, zone: null, busy: [], month: { y: 0, m: 0 }, loadedAt: Date.now(), tableOpen: null };
const nowMin = () => S.now.min + Math.floor((Date.now() - S.loadedAt) / 60000);
const allTables = () => S.layout.flatMap(z => z.rows.flat().map(t => ({ ...t, zone: z.name, zoneType: z.type })));
const dur = () => S.cfg.duration;

function slotList() { const a = []; for (let m = S.openM; m + dur() <= S.closeM; m += S.cfg.step) a.push(m); return a; }
const isPast = m => S.date === S.now.date && m <= nowMin();
function tableFree(t, m) { const e = m + dur(); return !S.busy.some(b => b.table === t.id && m < b.e && b.s < e); }
function tableStatus(t) {
  if (t.cap < S.guests) return 'small';
  if (S.time === null) return 'free';
  return tableFree(t, S.time) ? 'free' : 'busy';
}
const slotHasPlace = m => allTables().some(t => t.cap >= S.guests && tableFree(t, m));
const rangeTxt = m => `${fmtT(m)}–${fmtT(m + dur())}`;

/* ---------- модалка ---------- */
let modalEl = null;
function closeModal() {
  if (!modalEl) return;
  modalEl.remove(); modalEl = null; document.body.style.overflow = '';
  if (S.tableOpen) { S.tableOpen = null; if (S.cfg) renderPlan(); }
}
function openModal(content, wide = false) {
  closeModal();
  const m = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    h('button', { class: 'x', type: 'button', 'aria-label': 'Закрыть', onclick: closeModal, text: '×' }), content);
  modalEl = h('div', { class: 'overlay', onmousedown: e => { if (e.target === modalEl) closeModal(); } }, m);
  $('#modalRoot').append(modalEl);
  document.body.style.overflow = 'hidden';
  return m;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- шапка, контакты, меню ---------- */
function renderStatic() {
  const c = S.cfg;
  document.title = `${c.name} — бронь столов онлайн`;
  const brand = $('#brand'); brand.textContent = '';
  if (c.logo) brand.append(h('img', { src: c.logo, alt: 'Логотип ' + c.name }));
  const bn = h('span', { class: 'brand-name' }); rainbow(bn, c.name); brand.append(bn);
  rainbow($('#heroName'), c.name);
  $('#tagline').textContent = c.tagline || '';
  if (c.description) $('#tagline').append(h('br'), c.description);
  const chips = $('#heroChips'); chips.textContent = '';
  chips.append(h('span', { class: 'chip', text: `🕒 ${c.open}–${c.close === '00:00' ? '24:00' : c.close}` }));
  if (c.address) chips.append(h('span', { class: 'chip', text: '📍 ' + c.address }));
  if (c.phone) chips.append(h('a', { class: 'chip', href: 'tel:' + c.phone.replace(/[^\d+]/g, ''), text: '📞 ' + c.phone, style: 'text-decoration:none;color:inherit' }));
  $('#foot').textContent = `© ${new Date().getFullYear()} ${c.name}`;

  const list = $('#contactList'); list.textContent = '';
  const add = (ic, label, val, href) => list.append(h('div', { class: 'contact' }, h('div', { class: 'ic', text: ic }),
    h('div', {}, h('b', { text: label }), href ? h('a', { href, target: href.startsWith('http') ? '_blank' : null, rel: 'noopener', text: val }) : h('span', { text: val }))));
  if (c.address) add('📍', 'Адрес', c.address, c.map_link || null);
  if (c.phone) add('📞', 'Телефон', c.phone, 'tel:' + c.phone.replace(/[^\d+]/g, ''));
  if (c.phone2) add('📞', 'Телефон', c.phone2, 'tel:' + c.phone2.replace(/[^\d+]/g, ''));
  if (c.whatsapp) add('💬', 'WhatsApp', c.whatsapp, 'https://wa.me/' + c.whatsapp.replace(/\D/g, ''));
  if (c.instagram) add('📷', 'Instagram', c.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '@').replace(/\/$/, ''), /^https?:/i.test(c.instagram) ? c.instagram : 'https://instagram.com/' + c.instagram.replace(/^@/, ''));
  add('🕒', 'Время работы', `${c.open}–${c.close === '00:00' ? '24:00' : c.close}`);
  if (c.map_link && !c.address) add('🗺️', 'Карта', 'Открыть на карте', c.map_link);

  const cats = S.menu.filter(k => k.items.length);
  $('#menu').classList.toggle('hidden', !cats.length);
  const ml = $('#menuList'); ml.textContent = '';
  cats.forEach(k => ml.append(h('div', { class: 'menu-cat' }, h('h3', { text: k.name || 'Без названия' }),
    k.items.map(i => h('div', { class: 'mi' }, h('span', { text: i.name }), h('span', { class: 'dots' }), h('span', { class: 'pr', text: money(i.price) }))))));
}

/* ---------- календарь ---------- */
function renderCalendar() {
  const { y, m } = S.month;
  const min = S.now.date, max = S.maxDate;
  const minD = parseD(min), maxD = parseD(max);
  $('#calTitle').textContent = `${MONTHS[m]} ${y}`;
  $('#prevM').disabled = (y === minD.getFullYear() && m <= minD.getMonth());
  $('#nextM').disabled = (y === maxD.getFullYear() && m >= maxD.getMonth());
  const sm = $('#selMonth'), sy = $('#selYear');
  if (!sy.options.length) for (let yy = minD.getFullYear(); yy <= maxD.getFullYear(); yy++) sy.append(h('option', { value: yy, text: yy }));
  if (!sm.options.length) MONTHS.forEach((n, i) => sm.append(h('option', { value: i, text: n })));
  sm.value = m; sy.value = y;
  const cal = $('#cal'); cal.textContent = '';
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d => cal.append(h('div', { class: 'dow', text: d })));
  const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  for (let i = 0; i < first; i++) cal.append(h('button', { class: 'blank', disabled: true, tabindex: '-1' }));
  for (let d = 1; d <= days; d++) {
    const s = ds(y, m, d);
    cal.append(h('button', { type: 'button', text: d, disabled: s < min || s > max,
      class: (s === S.now.date ? 'today ' : '') + (s === S.date ? 'sel' : ''), 'aria-label': fmtDate(s),
      onclick: () => selectDate(s) }));
  }
  $('#pickedDate').textContent = S.date ? fmtDate(S.date) : '';
}
function gotoMonth(y, m) {
  const minD = parseD(S.now.date), maxD = parseD(S.maxDate);
  let v = y * 12 + m;
  v = Math.max(minD.getFullYear() * 12 + minD.getMonth(), Math.min(maxD.getFullYear() * 12 + maxD.getMonth(), v));
  S.month = { y: Math.floor(v / 12), m: v % 12 };
  renderCalendar();
}
async function selectDate(s) {
  S.date = s; renderCalendar();
  await loadDay(true);
}

/* ---------- загрузка занятости ---------- */
async function loadDay(pickTime) {
  if (!S.date) return;
  try {
    const j = await api('day', { query: 'date=' + S.date });
    S.busy = j.busy;
  } catch (e) { toast(e.message); }
  ensureTime(pickTime);
  refresh();
}
function ensureTime(force) {
  const ok = m => m !== null && slotList().includes(m) && !isPast(m) && slotHasPlace(m);
  if (!ok(S.time) || force && S.time === null) {
    const f = slotList().find(m => !isPast(m) && slotHasPlace(m));
    S.time = f === undefined ? null : f;
  }
}

/* ---------- время / гости ---------- */
function renderSlots() {
  const box = $('#slots'); box.textContent = '';
  const list = slotList();
  let any = false;
  list.forEach(m => {
    const past = isPast(m), full = !past && !slotHasPlace(m);
    if (!past && !full) any = true;
    box.append(h('button', { type: 'button', text: fmtT(m), disabled: past || full,
      class: 'slot' + (m === S.time ? ' sel' : '') + (full ? ' full' : ''),
      title: past ? 'Время уже прошло' : full ? 'Нет свободных столов' : '',
      onclick: () => { S.time = m; refresh(); } }));
  });
  $('#slotHint').textContent = !list.length ? 'Для брони нет доступного времени.' :
    !any ? 'На эту дату свободного времени для такой компании нет — выберите другую дату.' :
    `Бронь на ${dur() / 60 >= 1 && dur() % 60 === 0 ? dur() / 60 + ' ч' : dur() + ' мин'}${S.time !== null ? ': ' + rangeTxt(S.time) : ''}. Зачёркнутое время недоступно.`;
}
function setGuests(n, fromUser) {
  S.guests = Math.max(1, Math.min(maxCap(), n));
  $('#gCount').textContent = S.guests;
  if (fromUser) {
    const z = S.layout.find(z => z.key === S.zone);
    const zcap = z ? Math.max(...z.rows.flat().map(t => t.cap)) : 0;
    if (zcap < S.guests) { const alt = S.layout.find(z => Math.max(...z.rows.flat().map(t => t.cap)) >= S.guests); if (alt) S.zone = alt.key; }
  }
  ensureTime(false); refresh();
}
const maxCap = () => Math.max(1, ...allTables().map(t => t.cap));

/* ---------- схема ---------- */
function chairs(n, cls) { return h('div', { class: 'chairs ' + cls }, Array.from({ length: n }, () => h('b'))); }
function tableEl(t, z) {
  const st = tableStatus(t);
  const word = st === 'free' ? 'свободно' : st === 'busy' ? 'занято' : 'мало мест';
  const cabin = z.type === 'cabins';
  return h('button', { type: 'button', class: `tbl ${st}${cabin ? ' cabin' : ''}${S.tableOpen === t.id ? ' pick' : ''}`,
    'aria-label': `${t.label}, ${t.cap} мест, ${word}`, onclick: () => openTable(t, z) },
    chairs(Math.ceil(t.cap / 2), 'top'),
    h('span', { class: 'tbody' }, h('strong', { text: cabin ? t.label : '№' + t.num }), h('small', { text: cabin ? `${t.cap} мест · ${word}` : word })),
    chairs(Math.floor(t.cap / 2), 'bot'));
}
function renderPlan() {
  if (!S.zone || !S.layout.find(z => z.key === S.zone)) S.zone = S.layout[0] && S.layout[0].key;
  const tabs = $('#zoneTabs'); tabs.textContent = '';
  S.layout.forEach(z => {
    const ts = z.rows.flat();
    const free = ts.filter(t => tableStatus(t) === 'free').length;
    tabs.append(h('button', { type: 'button', class: 'tab' + (z.key === S.zone ? ' on' : ''), text: `${z.name} · свободно ${free}`, onclick: () => { S.zone = z.key; renderPlan(); } }));
  });
  const z = S.layout.find(z => z.key === S.zone);
  const plan = $('#plan'); plan.textContent = '';
  if (!z) return;
  plan.append(h('div', { class: 'room' + (z.type === 'cabins' ? ' cabins' : '') },
    z.type === 'cabins' ? z.rows[0].map(t => tableEl(t, z)) : z.rows.map(row => h('div', { class: 'trow' }, row.map(t => tableEl(t, z))))));
  $('#planHint').textContent = S.time === null ? 'Выберите дату и время, чтобы увидеть занятость.' : `Показана занятость на ${fmtDate(S.date)}, ${rangeTxt(S.time)}. Нажмите на стол, чтобы забронировать.`;
}
function refresh() {
  renderSlots(); renderPlan();
  if (S.tableOpen && modalEl && modalEl.dataset.kind === 'table') renderTableModal();
}

/* ---------- окно стола ---------- */
let tableCtx = null;
function openTable(t, z) {
  tableCtx = { t, z };
  const m = openModal(h('div', { id: 'tableBody' })); m.dataset.kind = 'table';
  S.tableOpen = t.id;
  renderTableModal(); renderPlan();
}
function renderTableModal() {
  const { t, z } = tableCtx;
  const body = $('#tableBody'); if (!body) return;
  body.textContent = '';
  const st = tableStatus(t);
  body.append(h('h3', { text: `${t.label} · ${z.name}` }),
    h('div', { class: 'hint', text: `До ${t.cap} гостей · ${fmtDate(S.date)}` }));
  if (st === 'small') {
    body.append(h('div', { class: 'status small', text: `🪑 Этот стол рассчитан на ${t.cap} мест, а вас ${S.guests}. Выберите другой стол или кабинку.` }));
  } else if (S.time === null) {
    body.append(h('div', { class: 'status busy', text: '⛔ На эту дату нет свободного времени. Выберите другую дату.' }));
  } else if (st === 'free') {
    body.append(h('div', { class: 'status free', text: `✅ Свободно: ${rangeTxt(S.time)}` }));
  } else {
    body.append(h('div', { class: 'status busy', text: `⛔ Занято в это время (${rangeTxt(S.time)})` }));
  }
  const mine = S.busy.filter(b => b.table === t.id).sort((a, b) => a.s - b.s);
  body.append(h('span', { class: 'lbl', text: 'Занято в этот день:' }),
    h('div', { class: 'mini' }, mine.length ? mine.map(b => h('span', { class: 'b', text: `${fmtT(b.s)}–${fmtT(b.e)}` })) : h('span', { text: 'Весь день свободно' })));
  if (t.cap >= S.guests) {
    const frees = slotList().filter(m => !isPast(m) && tableFree(t, m));
    if (frees.length && st !== 'free' || frees.length && frees.length < slotList().length) {
      body.append(h('span', { class: 'lbl', text: 'Свободное время начала (нажмите, чтобы выбрать):' }),
        h('div', { class: 'mini' }, frees.map(m => h('button', { type: 'button', text: fmtT(m), onclick: () => { S.time = m; refresh(); } }))));
    }
    if (st === 'free') body.append(h('button', { class: 'btn block', type: 'button', text: `Забронировать на ${fmtT(S.time)}`, style: 'margin-top:8px', onclick: () => openBook(t, z) }));
  }
}

/* ---------- форма брони ---------- */
function openBook(t, z) {
  const pre = {};
  const hasMenu = S.menu.some(k => k.items.length);
  const sum = h('div', { class: 'summary', text: `${t.label} · ${z.name} · ${fmtDate(S.date)} · ${rangeTxt(S.time)} · ${S.guests} ${guestsWord(S.guests)}` });
  const name = h('input', { type: 'text', placeholder: 'Ваше имя', maxlength: '60', autocomplete: 'name', required: true });
  const phone = h('input', { type: 'tel', placeholder: '+996 ___ ___ ___', maxlength: '30', autocomplete: 'tel', required: true });
  const comment = h('textarea', { rows: '2', maxlength: '500', placeholder: 'Пожелания (необязательно): день рождения, детский стульчик…' });
  const honey = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', style: 'position:absolute;left:-9999px;opacity:0;height:0;width:0' });
  const receipt = h('input', { type: 'file', accept: 'image/*' });
  const totalEl = h('div', { class: 'sumline' });
  const amt = h('div', { class: 'amt' });
  const depNote = h('div', { class: 'hint' });
  const err = h('div', { class: 'err hidden' });
  const submit = h('button', { class: 'btn block', type: 'submit', text: 'Отправить заявку', style: 'margin-top:14px' });

  const items = {}; S.menu.forEach(k => k.items.forEach(i => items[i.id] = i));
  function recalc() {
    const total = Object.entries(pre).reduce((a, [id, q]) => a + items[id].price * q, 0);
    const cnt = Object.values(pre).reduce((a, q) => a + q, 0);
    const dep = cnt ? S.cfg.deposit_with : S.cfg.deposit_without;
    amt.textContent = money(dep);
    depNote.textContent = cnt ? `Задаток с предзаказом: ${money(S.cfg.deposit_with)}` : `Без предзаказа задаток ${money(S.cfg.deposit_without)}. С предзаказом — ${money(S.cfg.deposit_with)}.`;
    totalEl.textContent = '';
    if (cnt) totalEl.append(h('span', { text: `Предзаказ: ${cnt} шт.` }), h('b', { text: money(total) }));
  }
  const menuBox = h('div');
  if (hasMenu) {
    menuBox.append(h('span', { class: 'lbl', text: 'Предзаказ блюд (необязательно)' }),
      h('div', { class: 'hint', style: 'margin:-2px 0 8px', text: `Без предзаказа задаток ${money(S.cfg.deposit_without)}, с предзаказом — ${money(S.cfg.deposit_with)}.` }));
    S.menu.filter(k => k.items.length).forEach(k => {
      menuBox.append(h('details', { class: 'pre-cat' }, h('summary', { text: k.name || 'Без названия' }),
        k.items.map(i => {
          const out = h('output', { text: '0' });
          const set = d => { const q = Math.max(0, Math.min(50, (pre[i.id] || 0) + d)); if (q) pre[i.id] = q; else delete pre[i.id]; out.textContent = q; recalc(); };
          return h('div', { class: 'pre-item' }, h('span', { text: i.name }), h('span', { class: 'pr', text: money(i.price) }),
            h('div', { class: 'qty' }, h('button', { type: 'button', text: '−', 'aria-label': 'Убрать', onclick: () => set(-1) }), out, h('button', { type: 'button', text: '+', 'aria-label': 'Добавить', onclick: () => set(1) })));
        })));
    });
  }
  const payBox = h('div', { class: 'pay' }, h('div', { class: 'hint', style: 'margin:0', text: 'Задаток для подтверждения брони' }), amt,
    S.cfg.qr ? h('img', { class: 'qr', src: S.cfg.qr, alt: 'QR-код для оплаты' }) : h('div', { class: 'hint', text: 'QR-код пока не добавлен. Реквизиты для оплаты уточните по телефону.' }),
    S.cfg.qr_note ? h('div', { class: 'note', text: S.cfg.qr_note }) : null, depNote,
    h('span', { class: 'lbl', style: 'text-align:left', text: 'Скриншот или фото чека (по желанию)' }), receipt);

  const form = h('form', { novalidate: true }, h('h3', { text: 'Оформление брони' }), sum,
    h('span', { class: 'lbl', text: 'Имя' }), name, h('span', { class: 'lbl', text: 'Телефон' }), phone,
    h('span', { class: 'lbl', text: 'Комментарий' }), comment, menuBox, totalEl, payBox, honey, err, submit,
    h('div', { class: 'hint', style: 'text-align:center', text: 'Администратор проверит оплату и подтвердит бронь. Статус вы увидите в разделе «Мои брони».' }));
  recalc();
  openModal(form).dataset.kind = 'book';

  form.addEventListener('submit', async ev => {
    ev.preventDefault(); err.classList.add('hidden');
    const showErr = m => { err.textContent = m; err.classList.remove('hidden'); err.scrollIntoView({ block: 'nearest' }); };
    if (name.value.trim().length < 2) return showErr('Введите имя.');
    const digits = phone.value.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) return showErr('Введите корректный номер телефона.');
    const fd = new FormData();
    fd.set('table', t.id); fd.set('date', S.date); fd.set('start', fmtT(S.time)); fd.set('guests', S.guests);
    fd.set('name', name.value.trim()); fd.set('phone', phone.value.trim()); fd.set('comment', comment.value.trim());
    fd.set('preorder', JSON.stringify(Object.entries(pre).map(([id, qty]) => ({ id, qty })))); fd.set('website', honey.value);
    if (receipt.files[0]) fd.set('receipt', receipt.files[0]);
    submit.disabled = true; submit.textContent = 'Отправляем…';
    try {
      const j = await api('book', { body: fd });
      const ids = ls.get('karkyra_my', []); ids.unshift(j.booking.id); ls.set('karkyra_my', ids.slice(0, 30));
      const stm = ls.get('karkyra_st', {}); stm[j.booking.id] = 'pending'; ls.set('karkyra_st', stm);
      showSuccess(j.booking); loadDay(false); updateBadge();
    } catch (e) {
      submit.disabled = false; submit.textContent = 'Отправить заявку';
      showErr(e.message);
      if (e.status === 409) loadDay(false);
    }
  });
}
function showSuccess(b) {
  openModal(h('div', { class: 'okbox' }, h('div', { class: 'big', text: '🎉' }), h('h3', { text: 'Заявка отправлена!', style: 'margin:0 0 6px' }),
    h('p', { text: `${b.table_label} · ${b.zone}`, style: 'font-weight:800;margin:0' }),
    h('p', { text: `${fmtDate(b.date)}, ${b.start}–${b.end}, ${b.guests} ${guestsWord(b.guests)}`, style: 'margin:4px 0' }),
    h('p', { text: `Задаток: ${money(b.deposit)}`, style: 'margin:4px 0;color:var(--red-d);font-weight:800' }),
    h('p', { class: 'hint', text: 'Стол уже отмечен занятым. Администратор проверит оплату и подтвердит бронь — статус смотрите в разделе «Мои брони».' }),
    h('button', { class: 'btn', type: 'button', text: 'Готово', onclick: closeModal })));
}

/* ---------- мои брони ---------- */
const ST = { pending: 'Ожидает подтверждения', confirmed: 'Подтверждена ✅', rejected: 'Отклонена', cancelled: 'Отменена' };
async function fetchMy() {
  const ids = ls.get('karkyra_my', []);
  if (!ids.length) return [];
  const j = await api('status', { query: 'ids=' + ids.join(',') });
  const found = new Set(j.bookings.map(b => b.id));
  ls.set('karkyra_my', ids.filter(i => found.has(i)));
  return j.bookings.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
}
async function checkMy(silent) {
  try {
    const list = await fetchMy();
    const old = ls.get('karkyra_st', {}), nw = {};
    list.forEach(b => {
      nw[b.id] = b.status;
      if (!silent && old[b.id] && old[b.id] !== b.status) {
        if (b.status === 'confirmed') toast(`✅ Ваша бронь на ${b.date.split('-').reverse().join('.')} в ${b.start} подтверждена!`, 8000);
        else if (b.status === 'rejected' || b.status === 'cancelled') toast(`Бронь на ${b.date.split('-').reverse().join('.')} в ${b.start}: ${ST[b.status].toLowerCase()}. Свяжитесь с кафе.`, 9000);
      }
    });
    ls.set('karkyra_st', nw);
    updateBadge(list);
  } catch {}
}
function updateBadge(list) {
  const n = list ? list.filter(b => (b.status === 'pending' || b.status === 'confirmed') && b.date >= S.now.date).length : ls.get('karkyra_my', []).length;
  const bd = $('#myBadge'); bd.textContent = n; bd.classList.toggle('hidden', !n);
}
async function openMy() {
  const box = h('div', {}, h('p', { class: 'hint', text: 'Загрузка…' }));
  const m = openModal(h('div', {}, h('h3', { text: 'Мои брони' }), box), true); m.dataset.kind = 'my';
  try {
    const list = await fetchMy();
    box.textContent = '';
    if (!list.length) { box.append(h('p', { class: 'hint', text: 'Здесь будут ваши брони с этого устройства. Пока их нет.' })); return; }
    list.forEach(b => box.append(h('div', { class: 'mb' },
      h('div', { class: 'row' }, h('b', { text: `${fmtDate(b.date)}, ${b.start}–${b.end}` }), h('span', { class: 'st ' + b.status, text: ST[b.status] })),
      h('div', { class: 'hint', style: 'margin:4px 0 0', text: `${b.table_label} · ${b.zone} · ${b.guests} ${guestsWord(b.guests)} · задаток ${money(b.deposit)}` }))));
    const stm = {}; list.forEach(b => stm[b.id] = b.status); ls.set('karkyra_st', stm); updateBadge(list);
  } catch (e) { box.textContent = e.message; }
}

/* ---------- запуск ---------- */
async function init() {
  let j;
  try { j = await api('public'); }
  catch (e) {
    $('#plan').append(h('div', { class: 'err', text: e.message }));
    return;
  }
  Object.assign(S, { cfg: j.settings, layout: j.layout, menu: j.menu, now: j.now, maxDate: j.max_date, openM: j.open_m, closeM: j.close_m, loadedAt: Date.now() });
  renderStatic();
  // стартовая дата: сегодня, если ещё есть время, иначе завтра
  const todayHas = slotList().some(m => m > nowMin());
  let start = S.now.date;
  if (!todayHas) { const d = parseD(start); d.setDate(d.getDate() + 1); start = ds(d.getFullYear(), d.getMonth(), d.getDate()); }
  if (start > S.maxDate) start = S.maxDate;
  S.date = start;
  const sd = parseD(start); S.month = { y: sd.getFullYear(), m: sd.getMonth() };
  $('#prevM').onclick = () => gotoMonth(S.month.y, S.month.m - 1);
  $('#nextM').onclick = () => gotoMonth(S.month.y, S.month.m + 1);
  $('#selMonth').onchange = e => gotoMonth(S.month.y, +e.target.value);
  $('#selYear').onchange = e => gotoMonth(+e.target.value, S.month.m);
  $('#gMinus').onclick = () => setGuests(S.guests - 1, true);
  $('#gPlus').onclick = () => setGuests(S.guests + 1, true);
  $('#myBtn').onclick = openMy;
  S.zone = S.layout[0] && S.layout[0].key;
  renderCalendar();
  await loadDay(true);
  checkMy(true);
  setInterval(() => { if (!document.hidden) { loadDay(false); checkMy(false); } }, 20000);
}
init();
})();
