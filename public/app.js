import { LISTS, LIST_LABELS, CATEGORIES, CATEGORY_LABELS, WEIGHTS, COMING, applyOp, newId, settle, payers, coming, adults, kids, veg, total, shekels } from './model.js';

const TEST = new URLSearchParams(location.search).get('test') === '1';
const API = '/api/list' + (TEST ? '?test=1' : '');
const CODE_KEY = 'zayanim-code' + (TEST ? '-test' : '');
const TAB_KEY = 'zayanim-tab';
const SHOP_KEY = 'zayanim-shop';
const POLL_MS = 20_000;

const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const TABS = [
  { id: 'home', label: 'מסלול', icon: icon('<path d="M12 3c1.2 3 4.5 4.6 4.5 8.6a4.5 4.5 0 0 1-9 0c0-2.1 1-3.4 2.2-4.4 0 2 .9 3.1 2.1 3.3-.4-3 .1-5.2.2-7.5z"/><path d="M5 21h14M8 18l-1.5 3M16 18l1.5 3"/>') },
  { id: 'shop', label: 'תפקידים', icon: icon('<path d="M3 9.5h18l-2 10.5H5z"/><path d="M8 9.5 11 4M16 9.5 13 4M9 13.5v3M15 13.5v3M12 13.5v3"/>') },
  { id: 'gear', label: 'ציוד', icon: icon('<path d="M12 4 2.5 20h19z"/><path d="M12 4v16M8.5 20 12 13.5 15.5 20"/>') },
  { id: 'money', label: 'חשבון', icon: icon('<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8h6M9 11.5h6M9 15h3"/>') },
  { id: 'people', label: 'משפחות', icon: icon('<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.4"/><path d="M3 19.5c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2M14 15c.8-.5 1.6-.7 2.5-.7 2.2 0 3.9 1.5 4.5 4.2"/>') },
];
const BUY_LABELS = { meat: 'את המנגל', alcohol: 'את האלכוהול', general: 'את הקניות הכלליות', breakfast: 'את ארוחת הבוקר' };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const local = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: just not remembered */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let code = '';
let server = null;     // last state confirmed by the server
let revision = null;
let state = null;      // server state + edits not yet confirmed
let queue = [];        // edits waiting to be sent
let sending = false;
let offline = false;
let tab = TABS.some(t => t.id === local.get(TAB_KEY)) ? local.get(TAB_KEY) : 'home';
let shopList = LISTS.includes(local.get(SHOP_KEY)) ? local.get(SHOP_KEY) : 'meat';

// ---------- server ----------

async function api(method, body) {
  const r = await fetch(API, {
    method,
    cache: 'no-store',
    headers: { 'X-Edit-Code': code, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch { /* non-JSON error page */ }
  if (!r.ok) throw Object.assign(new Error(data.error || 'שגיאה בשרת'), { status: r.status, data });
  return data;
}

function accept(data) {
  server = data.state;
  revision = data.revision;
  state = queue.reduce((s, op) => { try { return applyOp(s, op); } catch { return s; } }, server);
  render();
}

// Apply an edit on screen right away, then send it in the background.
function send(op) {
  const before = state;
  try { state = applyOp(state, op); } catch (e) { toast(e.message); return false; }
  queue.push(op);
  render();
  flush();
  cameoFor(op, before);
  return true;
}

// ---------- friends popping up ----------

// Who says what. Photos come from /api/photo, which needs the group code.
const SAYS = {
  morning: 'בוקר טוב, דבר ראשון הכל בסדר',
  grill: 'בטוח שיש מספיק בשר?',
  eggs: 'יש מספיק ביצים?',
  'not-needed': 'את זה לא צריך',
  cooling: 'דרוש קירור',
  aperol: '', shades: '', 'random-1': '', 'random-2': '', 'random-3': '', 'random-4': '',
};
const BY_LIST = { alcohol: 'aperol', meat: 'grill', breakfast: 'eggs' };
const ANYWHERE = ['shades', 'not-needed', 'cooling', 'random-1', 'random-2', 'random-3', 'random-4'];
const photos = {};
let lastCameo = '';
let cameoTimer;

async function loadPhotos() {
  await Promise.all(Object.keys(SAYS).map(async name => {
    if (photos[name]) return;
    try {
      const r = await fetch('/api/photo?name=' + name, { headers: { 'X-Edit-Code': code } });
      if (r.ok) photos[name] = URL.createObjectURL(await r.blob());
    } catch { /* no photo, no cameo */ }
  }));
}

const pickOne = list => {
  const options = list.filter(n => photos[n] && n !== lastCameo);
  return options[Math.floor(Math.random() * options.length)];
};

function pickCameo(list, itemName = '', adding = false) {
  if (/ביצ|שקשוק/.test(itemName) && photos.eggs) return 'eggs';
  if (/מנגל|בשר|פחמ/.test(itemName) && photos.grill) return 'grill';
  if (adding && Math.random() < 0.3 && photos['not-needed']) return 'not-needed';
  const own = BY_LIST[list];
  if (own && own !== lastCameo && Math.random() < 0.55 && photos[own]) return own;
  return pickOne(ANYWHERE);
}

function cameoFor(op, before) {
  if (op.type === 'updateGear' && op.fields?.skipped) return showCameo(photos['not-needed'] ? 'not-needed' : '');
  const list = op.list || (tab === 'shop' ? shopList : '');
  const named = arr => arr?.find(x => x.id === op.id)?.name;
  const itemName = op.name || named(before.lists[op.list]) || named(before.gear) || '';
  showCameo(pickCameo(list, itemName, /^add(Item|Gear)$/.test(op.type)));
}

function showCameo(name) {
  const el = $('cameo');
  if (!name || el.classList.contains('on')) return;
  lastCameo = name;
  $('cameoImg').src = photos[name];
  $('cameoSays').textContent = SAYS[name];
  $('cameoSays').hidden = !SAYS[name];
  el.classList.add('on');
  clearTimeout(cameoTimer);
  cameoTimer = setTimeout(() => el.classList.remove('on'), 2800);
}
$('cameo').addEventListener('click', () => { clearTimeout(cameoTimer); $('cameo').classList.remove('on'); });

// Every time the site opens.
function morning() {
  if (!photos.morning) return;
  const el = $('splash');
  $('splashImg').src = photos.morning;
  $('splashSays').textContent = SAYS.morning;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('on'));
  const close = () => { el.classList.remove('on'); setTimeout(() => { el.hidden = true; }, 300); };
  el.onclick = close;
  setTimeout(close, 3200);
}

async function flush() {
  if (sending || !queue.length) return;
  sending = true;
  updateSync();
  const batch = queue.slice(0, 50);
  try {
    const data = await api('POST', { ops: batch });
    queue.splice(0, batch.length);
    offline = false;
    accept(data);
  } catch (e) {
    if (e.status === 422) {
      // Someone else's change made one edit impossible (e.g. they deleted the item). Drop just that one.
      queue.splice(e.data?.index ?? 0, 1);
      toast(e.message);
      if (e.data?.state) accept(e.data);
    } else if (e.status === 401) {
      queue = [];
      logout('קוד הקבוצה השתנה. הכניסו את הקוד החדש.');
    } else {
      offline = true;
      setTimeout(() => { offline = false; flush(); }, 5000);
    }
  } finally {
    sending = false;
    updateSync();
    if (queue.length && !offline) flush();
  }
}

async function refresh() {
  if (!code || sending || queue.length) return;
  try {
    const data = await api('GET');
    offline = false;
    if (data.revision !== revision) accept(data);
  } catch (e) {
    if (e.status === 401) logout('קוד הקבוצה השתנה. הכניסו את הקוד החדש.');
    else offline = true;
  }
  updateSync();
}

setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('beforeunload', e => { if (queue.length) e.preventDefault(); });

// ---------- login ----------

async function login(c) {
  code = c;
  $('gateError').textContent = '';
  try {
    const data = await api('GET');
    local.set(CODE_KEY, c);
    $('gate').hidden = true;
    $('app').hidden = false;
    accept(data);
    loadPhotos().then(() => { render(); morning(); });
  } catch (e) {
    if (e.status === 401) { local.del(CODE_KEY); code = ''; }
    showGate(e.status === 401 ? 'הקוד לא נכון' : e.message);
  }
}

function showGate(error = '') {
  $('app').hidden = true;
  $('gate').hidden = false;
  $('gateError').textContent = error;
}

function logout(msg = '') {
  local.del(CODE_KEY);
  code = '';
  showGate(msg);
}

$('gateForm').addEventListener('submit', e => {
  e.preventDefault();
  const c = $('gateCode').value.trim();
  $('gateCode').value = '';
  if (c) login(c);
});

// ---------- helpers ----------

const person = id => state.people.find(p => p.id === id);
const personName = id => person(id)?.name ?? '—';
// Families who aren't coming can't be picked for jobs (unless they already hold one).
const options = (selected, empty) =>
  `<option value="">${esc(empty)}</option>` +
  state.people.filter(p => p.coming !== 'no' || p.id === selected)
    .map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
const dayDate = (base, offset) => { const d = new Date(base + 'T12:00'); d.setDate(d.getDate() + offset); return d; };
const short = d => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const toAgorot = v => Math.round(parseFloat(String(v).replace(',', '.')) * 100);
const weightLabel = w => ({ 0.5: '½', 1: '1', 1.5: '1½', 2: '2' })[w];

function eventWhen() {
  const e = state.event;
  if (!e.date) return 'תאריך? בתפריט';
  const start = dayDate(e.date, 0), end = dayDate(e.date, 2);
  const days = Math.ceil((start - new Date()) / 86_400_000);
  const left = days > 1 ? ` · עוד ${days} ימים` : days === 1 ? ' · מחר!' : days === 0 ? ' · היום!' : '';
  return `חמישי-שבת ${start.getDate()}-${short(end)}.${String(end.getFullYear()).slice(2)}${left}`;
}

function groupSummary() {
  if (!state.people.length) return '+ הוסיפו משפחות';
  const yes = coming(state).length;
  const open = state.people.filter(p => p.coming === null).length;
  return `${familiesComing(yes)}${open ? ` · ${open} עוד לא ענו` : ''}`;
}
// 050-1234567 -> 972501234567 for wa.me links.
const waNumber = ph => { const d = ph.replace(/\D/g, ''); return d.startsWith('0') ? '972' + d.slice(1) : d; };
const familiesComing = n => n === 1 ? 'משפחה אחת מגיעה' : `${n} משפחות מגיעות`;

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

async function copyText(text, done = 'הועתק - אפשר להדביק בוואטסאפ') {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { prompt('העתיקו מכאן:', text); }
}

function updateSync() {
  const el = $('sync');
  if (offline) el.textContent = 'אין חיבור - השינויים יישמרו כשהחיבור יחזור';
  else if (sending || queue.length) el.textContent = 'שומר…';
  else el.textContent = 'הכל שמור · מתעדכן אצל כולם';
}

// ---------- render ----------

let renderLater = false;
function render() {
  if (!state) return;
  // A redraw must not close a dropdown someone is using. Wait until they leave it, plus a beat,
  // so the tap that moved focus away still lands on the button it was aimed at.
  const active = document.activeElement;
  if (active?.tagName === 'SELECT' && $('view').contains(active)) {
    if (!renderLater) {
      renderLater = true;
      active.addEventListener('blur', () => setTimeout(() => { renderLater = false; render(); }, 300), { once: true });
    }
    return;
  }
  const kept = [...$('view').querySelectorAll('input[data-keep]')].map(i => [i.id, i.value]);
  const focused = active?.id;

  const e = state.event;
  $('evTitle').textContent = e.title;
  $('evMeta').textContent = eventWhen();
  $('evPlace').innerHTML = e.place ? (e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.place)} ↗</a>` : esc(e.place)) + (e.checkin ? ` · ${esc(e.checkin)}` : '') : '';
  $('peopleChip').textContent = groupSummary();
  $('moneyChip').textContent = 'בקופה: ' + shekels(total(state));
  document.title = e.title;

  $('tabs').innerHTML = TABS.map(t =>
    `<button data-tab="${t.id}" class="${tab === t.id ? 'on' : ''}">${t.icon}${t.label}</button>`).join('');

  $('view').innerHTML = { home: homeView, shop: shopView, gear: gearView, money: moneyView, people: peopleView }[tab]();

  for (const [id, value] of kept) { const el = $(id); if (el) el.value = value; }
  if (focused && $(focused) && $('view').contains($(focused))) $(focused).focus();
  updateSync();
}

function noPeopleHint() {
  return state.people.length ? '' :
    `<section class="card"><h2>קודם כל, מי מגיע?</h2><p class="muted small">מוסיפים את המשפחות, ואז מחלקים ארוחות, קניות וציוד, ומתחשבנים בסוף.</p><button class="btn fire" data-act="goPeople">הוספת משפחות</button></section>`;
}

// The weekend's steps, the way the group runs it: place, who's coming, the four jobs,
// extra gear, settling up.
function homeView() {
  const e = state.event;
  const yes = coming(state).length;
  const noAnswer = state.people.filter(p => p.coming === null);
  const rolesOpen = LISTS.filter(k => !state.buyers[k]).length;
  const gearOpen = state.gear.filter(g => !g.who && !g.skipped).length;
  const sum = total(state);
  const { transfers } = settle(state);
  const openPay = transfers.filter(t => !state.paid.includes(t.key)).length;
  const step = (n, done, title, body, action = '') => `
    <section class="card stepcard ${done ? 'done' : ''}">
      <div class="step-n">${done ? '✓' : n}</div>
      <div class="step-body"><h2>${title}</h2>${body}${action}</div>
    </section>`;
  return `
  ${step(1, e.place && e.date, 'קובעים מקום',
    `<p>${e.place ? `<b>${esc(e.place)}</b>` : 'עוד לא נקבע'}${e.date ? ` · ${esc(eventWhen())}` : ''}${e.checkin ? ` · ${esc(e.checkin)}` : ''}</p>`,
    `<button class="btn sm" data-act="editEvent">${e.place ? 'עריכה' : 'קביעת מקום ותאריך'}</button>`)}
  ${step(2, state.people.length && !noAnswer.length, 'מי מגיע',
    state.people.length
      ? `<p><b>${familiesComing(yes)}</b>${noAnswer.length ? ` · <b>${noAnswer.length}</b> עוד לא ענו` : ''}${yes ? ` · ${adults(state)} מבוגרים${kids(state) ? `, ${kids(state)} ילדים` : ''}` : ''}</p>
         ${noAnswer.length ? `<p class="small muted">מחכים ל: ${noAnswer.map(p => esc(p.name)).join(', ')}</p>` : ''}`
      : '<p>עוד אין משפחות ברשימה</p>',
    `<button class="btn sm" data-act="goPeople">${state.people.length ? 'עדכון מי מגיע' : 'הוספת משפחות'}</button>`)}
  ${step(3, !rolesOpen, 'מחלקים תפקידים',
    `<div class="roles">${LISTS.map((k, i) => `
      <label class="role"><span><i>${i + 1}</i>${esc(LIST_LABELS[k])}</span>
        <select data-act="buyer" data-list="${k}" class="${state.buyers[k] ? '' : 'unset'}">${options(state.buyers[k], 'מי לוקח?')}</select></label>`).join('')}</div>`)}
  ${step(4, !gearOpen, 'ציוד שחוזר כל פעם',
    `<p>${gearOpen ? `ל-<b>${gearOpen}</b> פריטים מתוך ${state.gear.length} אין עדיין מי שמביא` : 'לכל פריט יש מי שמביא'}</p>`,
    `<button class="btn sm" data-act="goTab" data-tab="gear">חלוקת ציוד</button>`)}
  ${step(5, sum && !openPay, 'מתחשבנים',
    `<p>${sum ? `שולמו <b>${shekels(sum)}</b> · ${openPay ? `${openPay} העברות פתוחות` : 'הכל סגור'}` : 'בסוף כל אחד כותב כמה שילם'}</p>`,
    `<button class="btn sm" data-act="goTab" data-tab="money">${sum ? 'להתחשבנות' : 'הוספת קבלה'}</button>`)}
`;
}

function shopView() {
  const k = shopList;
  const items = state.lists[k];
  const buyer = state.buyers[k];
  const done = items.filter(i => i.done).length;
  const exp = state.expenses.filter(x => x.cat === k);
  const spent = exp.reduce((n, x) => n + x.amount, 0);
  const sorted = [...items.filter(i => !i.done), ...items.filter(i => i.done)];
  const a = adults(state), c = kids(state), v = veg(state);
  return `
  ${noPeopleHint()}
  <nav class="cats">${LISTS.map(l => {
    const left = state.lists[l].filter(i => !i.done).length;
    return `<button data-act="shopList" data-list="${l}" class="${l === k ? 'on' : ''}">${esc(LIST_LABELS[l])}<i>${left}</i></button>`;
  }).join('')}</nav>
  ${state.people.length ? `<p class="key">מפתח כמויות: <b>${a}</b> מבוגרים${c ? ` · <b>${c}</b> ילדים` : ''}${v ? ` · <b>${v}</b> צמחונים` : ''}</p>` : ''}
  <section class="nametag">
    <div class="nametag-top"><span>מי קונה</span><b>${esc(BUY_LABELS[k])}</b></div>
    <div class="nametag-body">
      <select id="buyer-${k}" data-act="buyer" data-list="${k}" class="${buyer ? '' : 'unset'}" aria-label="מי קונה ${esc(LIST_LABELS[k])}">${options(buyer, 'מי? בחרו משפחה')}</select>
      <div class="spent">
        <span>שולם עד עכשיו <strong class="num">${shekels(spent)}</strong></span>
        <button class="btn fire sm" data-act="addExpense" data-cat="${k}">+ קבלה</button>
      </div>
      ${exp.length ? `<div class="receipts-mini">${exp.map(x => `<div>${esc(x.what)} · <span class="num">${shekels(x.amount)}</span> · ${esc(personName(x.payer))}</div>`).join('')}</div>` : ''}
    </div>
  </section>
  <section class="card">
    <h2>מה קונים <span class="tally">${done} מתוך ${items.length}</span></h2>
    <form class="quick" data-form="addItem" data-list="${k}">
      <input type="text" id="q-name-${k}" data-keep name="name" placeholder="מה עוד צריך?" maxlength="120" required autocomplete="off">
      <input type="text" id="q-qty-${k}" data-keep name="qty" placeholder="כמה" maxlength="60" autocomplete="off">
      <button class="btn" aria-label="הוספה">+</button>
    </form>
    ${items.length ? `<ul class="rows">${sorted.map(it => `
      <li class="row ${it.done ? 'done' : ''}">
        <input type="checkbox" class="check" data-act="toggleItem" data-list="${k}" data-id="${it.id}" ${it.done ? 'checked' : ''} aria-label="נקנה">
        <div class="grow"><button class="title" data-act="editItem" data-list="${k}" data-id="${it.id}">${esc(it.name)}
          <span class="sub">${esc([it.qty, it.who && 'מביאים: ' + personName(it.who), it.note].filter(Boolean).join(' · '))}</span>
</button></div>
        <button class="x" data-act="removeItem" data-list="${k}" data-id="${it.id}" aria-label="מחיקה">×</button>
      </li>`).join('')}</ul>` : '<div class="empty">ריק פה. מה צריך?</div>'}
    ${items.length ? `<button class="btn sm" data-act="copyList" data-list="${k}" style="margin-top:14px">העתקת מה שחסר לוואטסאפ</button>` : ''}
  </section>
  ${notesBlock(k)}`;
}

// Free-text notes from earlier weekends, one point per line.
function notesBlock(section) {
  const lines = state.notes[section].split('\n').map(l => l.trim()).filter(Boolean);
  return `<section class="card notes">
    <h2>מהפעמים הקודמות</h2>
    ${lines.length ? `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted small">עוד אין הערות. מה היה חסר? מה היה מיותר?</p>'}
    <button class="btn sm" data-act="editNotes" data-section="${section}">${lines.length ? 'עריכת הערות' : 'הוספת הערות'}</button>
  </section>`;
}

function gearView() {
  const needed = state.gear.filter(g => !g.skipped);
  const skipped = state.gear.filter(g => g.skipped);
  const missing = needed.filter(g => !g.who).length;
  // The "את זה לא צריך" guy's face: skips an item for this weekend only.
  const face = photos['not-needed'] ? `<img src="${photos['not-needed']}" alt="">` : 'לא';
  return `
  ${noPeopleHint()}
  <section class="card">
    <h2>ציוד שחוזר כל פעם <small>${missing ? `ל-${missing} פריטים אין עדיין מי שמביא` : 'לכל פריט יש מי שמביא'}</small></h2>
    ${needed.length ? `<ul class="rows">${needed.map(g => `
      <li class="row ${g.done ? 'done' : ''}">
        <input type="checkbox" class="check" data-act="toggleGear" data-id="${g.id}" ${g.done ? 'checked' : ''} aria-label="ארוז">
        <div class="grow"><button class="title" data-act="editGear" data-id="${g.id}">${esc(g.name)}</button></div>
        <select data-act="gearWho" data-id="${g.id}" class="${g.who ? '' : 'unset'}" aria-label="מי מביא">${options(g.who, 'מי מביא?')}</select>
        <button class="nope" data-act="skipGear" data-id="${g.id}" title="הפעם לא צריך" aria-label="הפעם לא צריך">${face}</button>
      </li>`).join('')}</ul>` : '<div class="empty">הפעם לא צריך כלום</div>'}
    ${skipped.length ? `<div class="skipped">
      <b>הפעם לא צריך</b> <span class="small muted">יחזרו לרשימה בסופ״ש הבא</span>
      <div class="skipped-list">${skipped.map(g => `<button class="pill" data-act="unskipGear" data-id="${g.id}">${esc(g.name)} ↺</button>`).join('')}</div>
    </div>` : ''}
    <form class="quick" data-form="addGear" style="grid-template-columns:1fr 46px">
      <input type="text" id="q-gear" data-keep name="name" placeholder="עוד משהו להביא…" maxlength="120" required autocomplete="off">
      <button class="btn" aria-label="הוספה">+</button>
    </form>
  </section>
  ${notesBlock('gear')}`;
}

function moneyView() {
  if (!state.people.length) return noPeopleHint();
  const sum = total(state);
  const units = payers(state).reduce((n, p) => n + p.weight, 0);
  const { share, balance, transfers } = settle(state);
  const skips = LISTS.map(k => [k, state.people.filter(p => p.skip.includes(k))]).filter(([, ps]) => ps.length);
  const open = transfers.filter(t => !state.paid.includes(t.key)).length;
  return `
  <section class="receipt">
    <div class="r-head"><b>חשבון סופי</b><span>${esc(state.event.title)}</span></div>
    ${state.expenses.length ? state.expenses.map(x => `
      <div class="r-line">
        <button class="what" data-act="editExpense" data-id="${x.id}"><b>${esc(x.what)}</b><span>${esc(CATEGORY_LABELS[x.cat])} · שילמו ${esc(personName(x.payer))}</span></button>
        <span class="amount">${shekels(x.amount)}</span>
        <button class="x" data-act="removeExpense" data-id="${x.id}" aria-label="מחיקה">×</button>
      </div>`).join('') : '<div class="empty">עוד אין קבלות</div>'}
    <div class="r-total"><span>סה״כ</span><b>${shekels(sum)}</b></div>
    <div class="r-split">
      <div><b>${units ? shekels(Math.round(sum / units)) : '—'}</b><span>${skips.length ? 'בממוצע למשפחה' : 'לכל משפחה'}</span></div>
      <div><b>${payers(state).length}</b><span>משפחות</span></div>
    </div>
    ${skips.length ? `<p class="r-note">${skips.map(([k, ps]) => `בלי ${esc(LIST_LABELS[k])}: ${ps.map(p => esc(p.name)).join(', ')}`).join('<br>')}</p>` : ''}
    <button class="btn fire block" data-act="addExpense" data-cat="">+ הוספת קבלה</button>
  </section>

  ${sum ? `
  <section class="card">
    <h2>מי מעביר למי <small>${open ? `${open} פתוחות` : 'הכל סגור'}</small></h2>
    ${transfers.length ? transfers.map(t => {
      const paid = state.paid.includes(t.key);
      return `<div class="ticket ${paid ? 'done' : ''}">
        <input type="checkbox" class="check" data-act="paid" data-key="${esc(t.key)}" ${paid ? 'checked' : ''} aria-label="הועבר">
        <div class="grow"><b>${esc(personName(t.from))}</b> ← <b>${esc(personName(t.to))}</b></div>
        <span class="amount">${shekels(t.amount)}</span>
      </div>`;
    }).join('') : '<div class="empty">כולם שילמו בדיוק את החלק שלהם</div>'}
    <button class="btn block" data-act="copySettle" style="margin-top:6px">העתקה לוואטסאפ</button>
  </section>

  <section class="card">
    <h2>מאזן לכל משפחה</h2>
    <ul class="rows">${payers(state).map(p => {
      const paidBy = state.expenses.filter(x => x.payer === p.id).reduce((n, x) => n + x.amount, 0);
      const b = balance[p.id];
      return `<li class="row"><div class="grow"><b>${esc(p.name)}</b><span class="sub">שילמו ${shekels(paidBy)} · החלק שלהם ${shekels(share[p.id])}</span></div>
        <span class="amount ${b > 0 ? 'plus' : b < 0 ? 'minus' : ''}">${b > 0 ? 'מקבלים ' + shekels(b) : b < 0 ? 'משלמים ' + shekels(-b) : 'מאוזן'}</span></li>`;
    }).join('')}</ul>
  </section>` : ''}`;
}

const stepper = (p, field, label, min, max) => `
  <span class="step"><button data-act="step" data-id="${p.id}" data-field="${field}" data-d="-1" ${p[field] <= min ? 'disabled' : ''} aria-label="פחות ${label}">−</button><b>${p[field]}</b><button data-act="step" data-id="${p.id}" data-field="${field}" data-d="1" ${p[field] >= max ? 'disabled' : ''} aria-label="עוד ${label}">+</button>${label}</span>`;

function peopleView() {
  const v = veg(state);
  return `
  <section class="card">
    <h2>מי מגיע <small>${esc(groupSummary())}${v ? ` · ${v} צמחונים` : ''}</small></h2>
    <form class="quick" data-form="addPerson" style="grid-template-columns:1fr 92px 46px">
      <input type="text" id="q-person" data-keep name="name" placeholder="למשל: דני ומיכל כהן" maxlength="80" required autocomplete="off">
      <select name="adults" aria-label="מבוגרים"><option value="2">זוג</option><option value="1">לבד</option></select>
      <button class="btn" aria-label="הוספה">+</button>
    </form>
    <p class="muted small">ההוצאות מתחלקות שווה בשווה בין המשפחות שמגיעות. "חלק" קובע כמה משפחה משלמת ביחס לאחרות, למשל ½ למי שמגיע לבד. מי שלא שותה או לא אוכל בשר - לחצו על הקטגוריה כדי להוציא אותו ממנה.</p>
    ${state.people.length ? state.people.map(p => `
      <div class="person ${p.coming === 'no' ? 'not-coming' : ''}">
        <div class="person-head">
          <button class="title" data-act="editPerson" data-id="${p.id}">${esc(p.name)}</button>
          ${p.phone ? `<a class="contact" href="tel:${esc(p.phone.replace(/[ -]/g, ''))}" aria-label="התקשרות">☎</a><a class="contact" href="https://wa.me/${esc(waNumber(p.phone))}" target="_blank" rel="noopener" aria-label="וואטסאפ">✉</a>` : `<button class="pill" data-act="editPerson" data-id="${p.id}">+ טלפון</button>`}
          <button class="x" data-act="removePerson" data-id="${p.id}" aria-label="מחיקה">×</button>
        </div>
        <div class="rsvp">${Object.entries(COMING).map(([v, label]) =>
          `<button class="pill ${p.coming === v ? (v === 'yes' ? 'on' : 'off') : ''}" data-act="coming" data-id="${p.id}" data-v="${v}">${label}</button>`).join('')}
          ${p.coming === null ? '<span class="small" style="color:var(--fire)">עוד לא ענו</span>' : ''}</div>
        ${p.coming === 'no' ? '' : `<div class="steps">${stepper(p, 'adults', 'מבוגרים', 1, 4)}${stepper(p, 'kids', 'ילדים', 0, 10)}${stepper(p, 'veg', 'צמחונים', 0, p.adults + p.kids)}</div>
        <div class="toggles">חלק בחשבון:
          ${WEIGHTS.map(w => `<button class="pill ${p.weight === w ? 'on' : ''}" data-act="weight" data-id="${p.id}" data-w="${w}">${weightLabel(w)}</button>`).join('')}
        </div>
        <div class="toggles">משתתפים ב:
          ${LISTS.map(k => `<button class="pill ${p.skip.includes(k) ? 'off' : 'on'}" data-act="toggleSkip" data-id="${p.id}" data-list="${k}">${esc(LIST_LABELS[k])}</button>`).join('')}
        </div>`}
      </div>`).join('') : '<div class="empty">עוד אין אף אחד ברשימה.</div>'}
  </section>`;
}

// ---------- dialogs ----------

let dlgHandler = null;
function openDialog(html, onSubmit) {
  $('dlgForm').innerHTML = html;
  dlgHandler = onSubmit;
  $('dlg').showModal();
}
$('dlgForm').addEventListener('submit', e => {
  e.preventDefault();
  const action = e.submitter?.value || 'ok';
  const data = Object.fromEntries(new FormData(e.target));
  $('dlg').close();
  if (action !== 'cancel') dlgHandler?.(data, action);
});
const cancelBtn = '<button class="btn" value="cancel" formnovalidate>ביטול</button>';
const deleteBtn = '<button class="btn danger" value="delete" formnovalidate>מחיקה</button>';

function itemDialog(k, it) {
  openDialog(`<h3>עריכת פריט</h3>
    <label>מה</label><input type="text" name="name" value="${esc(it.name)}" maxlength="120" required>
    <label>כמות</label><input type="text" name="qty" value="${esc(it.qty)}" maxlength="60">
    <label>מי מביא (אם לא הקונה)</label><select name="who">${options(it.who, 'הקונה של הרשימה')}</select>
    <label>הערה</label><input type="text" name="note" value="${esc(it.note)}" maxlength="300" placeholder="מותג, איפה קונים, לקנות ביום…">
    <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}${deleteBtn}</div>`,
  (d, action) => {
    if (action === 'delete') send({ type: 'removeItem', list: k, id: it.id });
    else send({ type: 'updateItem', list: k, id: it.id, fields: { name: d.name.trim(), qty: d.qty.trim(), who: d.who || null, note: d.note.trim() } });
  });
}

function expenseDialog(x, cat) {
  const editing = Boolean(x);
  x ||= { what: cat ? LIST_LABELS[cat] : '', amount: 0, payer: (cat && state.buyers[cat]) || '', cat: cat || 'other' };
  openDialog(`<h3>${editing ? 'עריכת הוצאה' : 'הוספת הוצאה'}</h3>
    <label>על מה</label><input type="text" name="what" value="${esc(x.what)}" maxlength="120" required placeholder="למשל: קצביה, סופר, חנות משקאות">
    <label>סכום (₪)</label><input type="number" name="amount" value="${x.amount ? x.amount / 100 : ''}" min="0.01" step="0.01" inputmode="decimal" required>
    <label>מי שילם</label><select name="payer" required>${options(x.payer, 'בחרו')}</select>
    <label>קטגוריה</label><select name="cat">${CATEGORIES.map(c => `<option value="${c}" ${c === x.cat ? 'selected' : ''}>${esc(CATEGORY_LABELS[c])}</option>`).join('')}</select>
    <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}</div>`,
  d => {
    const fields = { what: d.what.trim(), amount: toAgorot(d.amount), payer: d.payer, cat: d.cat };
    if (editing) send({ type: 'updateExpense', id: x.id, fields });
    else if (send({ type: 'addExpense', id: newId(), ...fields })) toast('ההוצאה נוספה להתחשבנות');
  });
}

function eventDialog() {
  const e = state.event;
  openDialog(`<h3>פרטי הסופ״ש</h3>
    <label>שם</label><input type="text" name="title" value="${esc(e.title)}" maxlength="120" required>
    <label>יום חמישי של הסופ״ש</label><input type="date" name="date" value="${esc(e.date)}">
    <label>מקום</label><input type="text" name="place" value="${esc(e.place)}" maxlength="120" placeholder="שם הצימר">
    <label>קישור לצימר</label><input type="text" name="link" value="${esc(e.link)}" maxlength="300" placeholder="https://…" inputmode="url">
    <label>צ׳ק אין</label><input type="text" name="checkin" value="${esc(e.checkin)}" maxlength="120" placeholder="למשל: צ׳ק אין 14:30">
    <label>הערות לכולם</label><input type="text" name="notes" value="${esc(e.notes)}" maxlength="2000" placeholder="חניה, בריכה, מה יש במטבח…">
    <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}</div>`,
  d => {
    const link = d.link.trim();
    if (link && !link.startsWith('https://')) return toast('הקישור צריך להתחיל ב-https://');
    send({ type: 'setEvent', fields: { title: d.title.trim(), date: d.date, place: d.place.trim(), link, checkin: d.checkin.trim(), notes: d.notes.trim() } });
  });
}

function newEventDialog() {
  const { transfers } = settle(state);
  const open = transfers.filter(t => !state.paid.includes(t.key)).length;
  openDialog(`<h3>סיום וסופ״ש חדש</h3>
    ${open ? `<p style="color:var(--red)">שימו לב: יש עוד ${open} העברות שלא סומנו כשולמו.</p>` : ''}
    <p class="small muted">הסופ״ש הנוכחי יישמר בהיסטוריה עם סכום ההוצאות. המשפחות, הרשימות, הציוד והלקחים נשארים; מי מגיע, התפקידים, הסימונים וההוצאות מתאפסים.</p>
    <label>שם הסופ״ש החדש</label><input type="text" name="title" value="${esc(state.event.title)}" maxlength="120" required>
    <label>יום חמישי</label><input type="date" name="date">
    <label>מקום</label><input type="text" name="place" maxlength="120">
    <div class="actions"><button class="btn primary">פתיחת סופ״ש חדש</button>${cancelBtn}</div>`,
  d => { if (send({ type: 'newEvent', id: newId(), title: d.title.trim(), date: d.date, place: d.place.trim() })) { tab = 'home'; render(); toast('סופ״ש חדש נפתח'); } });
}

function pastDialog() {
  openDialog(`<h3>סופ״שים קודמים</h3>
    ${state.past.length ? `<ul class="rows">${state.past.map(p => `<li class="row"><div class="grow"><b>${esc(p.title)}</b><span class="sub">${esc([fmtDate(p.date), p.place].filter(Boolean).join(' · '))}</span></div>
      <span class="amount">${shekels(p.total)}${p.families ? `<span class="sub">${shekels(Math.round(p.total / p.families))} למשפחה</span>` : ''}</span></li>`).join('')}</ul>`
      : '<p class="muted">עוד אין. כשסופ״ש נגמר, בחרו בתפריט "סיום וסופ״ש חדש".</p>'}
    <div class="actions"><button class="btn" value="cancel">סגירה</button></div>`);
}

function menuDialog() {
  openDialog(`<h3>תפריט</h3>
    <div class="menu-list">
      <button class="btn" value="event">פרטי הסופ״ש: תאריך, מקום, צ׳ק אין</button>
      <button class="btn" value="share">שליחת קישור לקבוצה</button>
      <button class="btn" value="new">סיום וסופ״ש חדש</button>
      <button class="btn" value="past">סופ״שים קודמים</button>
      <button class="btn" value="logout">יציאה מהמכשיר הזה</button>
    </div>
    <div class="actions"><button class="btn" value="cancel">סגירה</button></div>`,
  (d, action) => {
    if (action === 'event') eventDialog();
    if (action === 'share') shareLink();
    if (action === 'new') newEventDialog();
    if (action === 'past') pastDialog();
    if (action === 'logout' && confirm('לצאת? תצטרכו את הקוד כדי להיכנס שוב.')) logout();
  });
}

// The code rides in the #fragment, which browsers never send to the server.
async function shareLink() {
  const url = `${location.origin}/${TEST ? '?test=1' : ''}#k=${encodeURIComponent(code)}`;
  const text = `${state.event.title} - מי מגיע, תפקידים, ציוד והתחשבנות. הקישור כולל את הקוד, אז רק בקבוצה שלנו 🙏`;
  if (navigator.share) {
    try { await navigator.share({ title: state.event.title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(`${text}\n${url}`, 'הקישור הועתק');
}

function goTab(next) {
  tab = next;
  local.set(TAB_KEY, tab);
  render();
  scrollTo(0, 0);
}

// ---------- events ----------

$('menuBtn').onclick = menuDialog;
$('peopleChip').onclick = () => goTab('people');
$('moneyChip').onclick = () => goTab('money');
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  goTab(b.dataset.tab);
  refresh();
  showCameo(pickCameo(tab === 'shop' ? shopList : ''));
});

$('view').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const d = Object.fromEntries(new FormData(f));
  const name = (d.name || '').trim();
  if (!name) return;
  let ok = false;
  if (f.dataset.form === 'addItem') ok = send({ type: 'addItem', list: f.dataset.list, id: newId(), name, qty: d.qty });
  if (f.dataset.form === 'addGear') ok = send({ type: 'addGear', id: newId(), name, who: null });
  if (f.dataset.form === 'addPerson') ok = send({ type: 'addPerson', id: newId(), name, adults: Number(d.adults), weight: 1 });
  if (ok) {
    // send() already redrew the page, so clear the new copy of the form.
    const sel = `form[data-form="${f.dataset.form}"]` + ['list'].map(k => f.dataset[k] ? `[data-${k}="${f.dataset[k]}"]` : '').join('');
    const fresh = $('view').querySelector(sel);
    fresh?.querySelectorAll('input').forEach(i => { i.value = ''; });
    fresh?.querySelector('input')?.focus();
  }
});

$('view').addEventListener('change', e => {
  const el = e.target;
  const { act, list, id } = el.dataset;
  const who = el.value || null;
  if (act === 'buyer') send({ type: 'setBuyer', list, person: who });
  if (act === 'toggleItem') send({ type: 'updateItem', list, id, fields: { done: el.checked } });
  if (act === 'toggleGear') send({ type: 'updateGear', id, fields: { done: el.checked } });
  if (act === 'gearWho') send({ type: 'updateGear', id, fields: { who } });
  if (act === 'paid') send({ type: 'setPaid', key: el.dataset.key, paid: el.checked });
});

$('view').addEventListener('click', e => {
  const el = e.target.closest('button[data-act]');
  if (!el) return;
  const { act, list, id, cat } = el.dataset;
  const p = id && person(id);
  switch (act) {
    case 'goPeople': return goTab('people');
    case 'goTab': return goTab(el.dataset.tab);
    case 'editEvent': return eventDialog();
    case 'editNotes': {
      const section = el.dataset.section;
      return openDialog(`<h3>הערות מהפעמים הקודמות</h3>
        <p class="small muted">שורה לכל הערה: מה היה חסר, מה היה מיותר, מה לזכור.</p>
        <textarea name="text" rows="9" maxlength="3000">${esc(state.notes[section])}</textarea>
        <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}</div>`,
      d => send({ type: 'setNotes', section, text: d.text }));
    }
    case 'coming': {
      const v = el.dataset.v || null;
      return send({ type: 'updatePerson', id, fields: { coming: p.coming === v ? null : v } });
    }
    case 'shopList':
      shopList = list;
      local.set(SHOP_KEY, list);
      render();
      return showCameo(pickCameo(list));
    case 'editItem': return itemDialog(list, state.lists[list].find(i => i.id === id));
    case 'removeItem': return send({ type: 'removeItem', list, id });
    case 'copyList': {
      const left = state.lists[list].filter(i => !i.done);
      if (!left.length) return toast('הכל כבר נקנה 🎉');
      return copyText(`🛒 ${LIST_LABELS[list]} - ${state.event.title}\n` + left.map(i => `• ${i.name}${i.qty ? ` (${i.qty})` : ''}${i.note ? ` - ${i.note}` : ''}`).join('\n'));
    }
    case 'editGear': {
      const g = state.gear.find(x => x.id === id);
      return openDialog(`<h3>עריכת ציוד</h3><label>מה</label><input type="text" name="name" value="${esc(g.name)}" maxlength="120" required>
        <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}${deleteBtn}</div>`,
      (f, action) => action === 'delete' ? send({ type: 'removeGear', id }) : send({ type: 'updateGear', id, fields: { name: f.name.trim() } }));
    }
    case 'removeGear': return send({ type: 'removeGear', id });
    case 'skipGear': return send({ type: 'updateGear', id, fields: { skipped: true } });
    case 'unskipGear': return send({ type: 'updateGear', id, fields: { skipped: false } });
    case 'addExpense':
      if (!state.people.length) return toast('הוסיפו קודם משפחות');
      return expenseDialog(null, cat);
    case 'editExpense': return expenseDialog(state.expenses.find(x => x.id === id));
    case 'removeExpense': {
      const x = state.expenses.find(v => v.id === id);
      if (confirm(`למחוק את ההוצאה "${x.what}" (${shekels(x.amount)})?`)) send({ type: 'removeExpense', id });
      return;
    }
    case 'copySettle': {
      const { transfers } = settle(state);
      const lines = transfers.filter(t => !state.paid.includes(t.key)).map(t => `• ${personName(t.from)} מעבירים ל${personName(t.to)}: ${shekels(t.amount)}`);
      return copyText(`💸 התחשבנות - ${state.event.title}\nסה״כ הוצאות: ${shekels(total(state))}\n\n` +
        (lines.length ? `העברות:\n${lines.join('\n')}` : 'הכל סגור 🎉'));
    }
    case 'editPerson':
      return openDialog(`<h3>${esc(p.name)}</h3>
        <label>שם</label><input type="text" name="name" value="${esc(p.name)}" maxlength="80" required>
        <label>טלפון</label><input type="tel" name="phone" value="${esc(p.phone)}" maxlength="20" placeholder="050-0000000" inputmode="tel" pattern="\\+?[0-9 \\-]{7,20}">
        <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}</div>`,
      d => send({ type: 'updatePerson', id, fields: { name: d.name.trim(), phone: d.phone.trim() } }));
    case 'step': {
      const field = el.dataset.field;
      const fields = { [field]: p[field] + Number(el.dataset.d) };
      // Fewer people can't leave more vegetarians than people.
      if (field !== 'veg') fields.veg = Math.min(p.veg, (fields.adults ?? p.adults) + (fields.kids ?? p.kids));
      return send({ type: 'updatePerson', id, fields });
    }
    case 'weight': return send({ type: 'updatePerson', id, fields: { weight: Number(el.dataset.w) } });
    case 'toggleSkip': return send({ type: 'updatePerson', id, fields: { skip: p.skip.includes(list) ? p.skip.filter(c => c !== list) : [...p.skip, list] } });
    case 'removePerson':
      if (confirm(`להסיר את ${p.name} מהסופ״ש?`)) send({ type: 'removePerson', id });
      return;
  }
});

// ---------- start ----------

const fromLink = new URLSearchParams(location.hash.slice(1)).get('k');
if (fromLink) history.replaceState(null, '', location.pathname + location.search);
const saved = fromLink || local.get(CODE_KEY);
if (saved) login(saved); else showGate();
