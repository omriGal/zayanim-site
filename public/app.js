import { LISTS, LIST_LABELS, CATEGORIES, CATEGORY_LABELS, COMING, KINDS, applyRootOp, view, nights, newId, settle, payers, coming, adults, kids, veg, total, expected, shekels } from './model.js';

const TEST = new URLSearchParams(location.search).get('test') === '1';
const API = '/api/list' + (TEST ? '?test=1' : '');
const CODE_KEY = 'zayanim-code' + (TEST ? '-test' : '');
const SESSION_KEY = 'zayanim-session' + (TEST ? '-test' : '');
const NONCE_KEY = 'zayanim-nonce';
const TAB_KEY = 'zayanim-tab';
const SHOP_KEY = 'zayanim-shop';
const POLL_MS = 20_000;

const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const TABS = [
  { id: 'events', label: 'דף הבית', icon: icon('<path d="M3 11 12 3.5l9 7.5"/><path d="M5.5 9.5V20.5h13V9.5"/><path d="M10 20.5v-6h4v6"/>') },
  { id: 'home', label: 'האירוע', icon: icon('<path d="M12 3c1.2 3 4.5 4.6 4.5 8.6a4.5 4.5 0 0 1-9 0c0-2.1 1-3.4 2.2-4.4 0 2 .9 3.1 2.1 3.3-.4-3 .1-5.2.2-7.5z"/><path d="M5 21h14M8 18l-1.5 3M16 18l1.5 3"/>') },
  { id: 'shop', label: 'תפקידים', icon: icon('<path d="M3 9.5h18l-2 10.5H5z"/><path d="M8 9.5 11 4M16 9.5 13 4M9 13.5v3M15 13.5v3M12 13.5v3"/>') },
  { id: 'gear', label: 'ציוד', icon: icon('<path d="M12 4 2.5 20h19z"/><path d="M12 4v16M8.5 20 12 13.5 15.5 20"/>') },
  { id: 'money', label: 'חשבון', icon: icon('<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8h6M9 11.5h6M9 15h3"/>') },
  { id: 'people', label: 'משפחות', icon: icon('<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.4"/><path d="M3 19.5c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2M14 15c.8-.5 1.6-.7 2.5-.7 2.2 0 3.9 1.5 4.5 4.2"/>') },
];
const BUY_LABELS = { meat: 'את המנגל', alcohol: 'את האלכוהול', general: 'את הקניות הכלליות', breakfast: 'את ארוחת הבוקר', dinner: 'על ארוחת הערב הראשונה' };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const local = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: just not remembered */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let code = '';
let session = '';   // after Google sign-in, instead of the code
const auth = () => code ? { 'X-Edit-Code': code } : { 'X-Session': session };
let server = null;     // last document confirmed by the server
let revision = null;
let root = null;       // server document + edits not yet confirmed
let eventId = null;    // the event being looked at; null = the list of events
let state = null;      // view(root, eventId): that one event, as the screens use it
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
    headers: { ...auth(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
  root = queue.reduce((r, op) => { try { return applyRootOp(r, op); } catch { return r; } }, server);
  refreshView();
  render();
}

function refreshView() {
  state = eventId ? view(root, eventId) : null;
  if (eventId && !state) eventId = null; // someone removed it
}

// Apply an edit on screen right away, then send it in the background.
// Edits made inside an event say which event they belong to.
function send(op) {
  const before = state;
  const full = state && !op.event && op.type !== 'addEvent' ? { ...op, event: eventId } : op;
  try { root = applyRootOp(root, full); } catch (e) { toast(e.message); return false; }
  refreshView();
  queue.push(full);
  render();
  flush();
  if (before && state) cameoFor(op, before);
  return true;
}

// ---------- friends popping up ----------

// Who says what. Photos come from /api/photo, which needs the group code.
const SAYS = {
  morning: 'בוקר טוב, דבר ראשון הכל בסדר',
  grill: 'בטוח שיש מספיק בשר?',
  eggs: 'יש מספיק ביצים?',
  'not-needed': 'את זה לא צריך',
  cooling: 'דרוש קירור?',
  shades: 'בסדר יא אפס',
};
// Who greets you on each tab; on other tabs one of the rest.
const BY_LIST = { meat: 'grill', alcohol: 'cooling', breakfast: 'eggs' };
const ANYWHERE = ['not-needed', 'cooling'];
const photos = {};
let lastCameo = '';
let cameoTimer;

async function loadPhotos() {
  await Promise.all(Object.keys(SAYS).map(async name => {
    if (photos[name]) return;
    try {
      const r = await fetch('/api/photo?name=' + name, { headers: auth() });
      if (r.ok) photos[name] = URL.createObjectURL(await r.blob());
    } catch { /* no photo, no cameo */ }
  }));
}

const pickOne = list => {
  const options = list.filter(n => photos[n] && n !== lastCameo);
  return options[Math.floor(Math.random() * options.length)];
};

// Switching tabs: that tab's person, or now and then one of the others.
function pickCameo(list) {
  const own = BY_LIST[list];
  if (own && own !== lastCameo && Math.random() < 0.6 && photos[own]) return own;
  return pickOne(ANYWHERE);
}

// Every save gets "בסדר יא אפס", unless the item calls for someone more specific.
function cameoFor(op, before) {
  const named = arr => arr?.find(x => x.id === op.id)?.name;
  const itemName = op.name || named(before.lists[op.list]) || named(before.gear) || '';
  const pick = op.type === 'updateGear' && op.fields?.skipped ? 'not-needed'
    : /ביצ|שקשוק/.test(itemName) ? 'eggs'
    : /מנגל|בשר|פחמ/.test(itemName) ? 'grill'
    : 'shades';
  showCameo(photos[pick] ? pick : '', true);
}

// A save replaces whoever is on screen, so every save gets its answer.
function showCameo(name, replace = false) {
  const el = $('cameo');
  if (!name || (el.classList.contains('on') && !replace)) return;
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
  if (!(code || session) || sending || queue.length) return;
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

// Either the group code or a session from Google sign-in.
async function login(c, s = '') {
  code = c;
  session = s;
  $('gateError').textContent = '';
  try {
    const data = await api('GET');
    if (code) local.set(CODE_KEY, code); else local.set(SESSION_KEY, session);
    $('gate').hidden = true;
    $('app').hidden = false;
    accept(data);
    loadPhotos().then(() => { render(); morning(); });
  } catch (e) {
    if (e.status === 401) { local.del(CODE_KEY); local.del(SESSION_KEY); code = session = ''; }
    showGate(e.status === 401 ? (s ? e.message : 'הקוד לא נכון') : e.message);
  }
}

function showGate(error = '') {
  $('app').hidden = true;
  $('gate').hidden = false;
  $('gateError').textContent = error;
  offerGoogle();
}

function logout(msg = '') {
  local.del(CODE_KEY);
  local.del(SESSION_KEY);
  code = session = '';
  showGate(msg);
}

// Google sign-in: a full-page trip to Google and back, with the ID token in the #fragment.
// The server checks it and that the email belongs to one of the families.
let googleClient;
async function offerGoogle() {
  if (TEST || googleClient !== undefined) return;
  try { googleClient = (await (await fetch('/api/login', { cache: 'no-store' })).json()).clientId || null; } catch { googleClient = null; }
  $('googleBtn').hidden = $('gateOr').hidden = !googleClient;
}

function googleStart() {
  const nonce = crypto.randomUUID();
  try { sessionStorage.setItem(NONCE_KEY, nonce); } catch { /* checked on return */ }
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: googleClient, redirect_uri: location.origin + '/', response_type: 'id_token',
    scope: 'openid email', nonce, prompt: 'select_account',
  });
}

async function googleReturn(credential) {
  let nonce = '';
  try { nonce = sessionStorage.getItem(NONCE_KEY) || ''; sessionStorage.removeItem(NONCE_KEY); } catch { /* ignore */ }
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential, nonce }) });
    const data = await r.json();
    if (!r.ok) return showGate(data.error || 'הכניסה עם Google לא הצליחה');
    login('', data.session);
  } catch { showGate('אין חיבור לשרת, נסו שוב'); }
}

$('googleBtn').onclick = () => googleClient && googleStart();

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

const weekday = d => d.toLocaleDateString('he-IL', { weekday: 'long' }).replace(/^יום /, '');

// "שישי-שבת 25-26.12.26 · עוד 29 ימים"
function eventWhen(e = state.event) {
  if (!e.date) return 'תאריך? בתפריט';
  const start = dayDate(e.date, 0), end = e.end ? dayDate(e.end, 0) : start;
  const days = Math.ceil((start - new Date()) / 86_400_000);
  const left = days > 1 ? ` · עוד ${days} ימים` : days === 1 ? ' · מחר!' : days === 0 ? ' · היום!' : end < new Date() ? ' · עבר' : ' · עכשיו!';
  const year = '.' + String(end.getFullYear()).slice(2);
  if (e.end === e.date || !e.end) return `${weekday(start)} ${short(start)}${year}${left}`;
  const range = start.getMonth() === end.getMonth() ? `${start.getDate()}-${short(end)}` : `${short(start)}-${short(end)}`;
  return `${weekday(start)}-${weekday(end)} ${range}${year}${left}`;
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

// Each phone with call and WhatsApp links, each email as a mail link.
function contactsLine(p) {
  const phones = [p.phone, p.phone2].filter(Boolean).map(ph =>
    `<span class="contact-item"><a href="tel:${esc(ph.replace(/[ -]/g, ''))}">☎ ${esc(ph)}</a><a class="wa" href="https://wa.me/${esc(waNumber(ph))}" target="_blank" rel="noopener">וואטסאפ</a></span>`);
  const mails = [p.email, p.email2].filter(Boolean).map(m => `<span class="contact-item"><a href="mailto:${esc(m)}" dir="ltr">${esc(m)}</a></span>`);
  return phones.length || mails.length ? `<div class="contacts">${[...phones, ...mails].join('')}</div>` : '';
}

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
  if (!root) return;
  document.body.classList.toggle('picking', !state);
  if (!state) return renderEvents();
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
  $('moneyChip').textContent = 'צפוי: ' + shekels(expected(state));
  document.title = e.title;

  $('tabs').innerHTML = TABS.map(t =>
    `<button data-tab="${t.id}" class="${tab === t.id ? 'on' : ''}">${t.icon}${t.label}</button>`).join('');

  $('view').innerHTML = { home: homeView, shop: shopView, gear: gearView, money: moneyView, people: peopleView }[tab]();

  for (const [id, value] of kept) { const el = $(id); if (el) el.value = value; }
  if (focused && $(focused) && $('view').contains($(focused))) $(focused).focus();
  updateSync();
}

// The first screen: every event, soonest first, each opening into its own planning.
function renderEvents() {
  $('evTitle').textContent = 'האירועים שלנו';
  $('evMeta').textContent = `${root.events.length} אירועים · ${root.people.length} משפחות`;
  $('evPlace').innerHTML = '';
  document.title = 'זיינים וזיינות';
  const upcoming = [...root.events].sort((a, b) => (a.event.date || '9999').localeCompare(b.event.date || '9999'));
  $('view').innerHTML = `
  ${upcoming.map(({ event: e }) => {
    const v = view(root, e.id);
    const yes = coming(v).length, open = v.people.filter(p => p.coming === null).length;
    return `<button class="event-card ${e.kind}" data-act="openEvent" data-id="${e.id}">
      <span class="kind">${esc(KINDS[e.kind])}</span>
      <b>${esc(e.title)}</b>
      <span class="when">${esc(eventWhen(e))}</span>
      ${e.place ? `<span class="where">${esc(e.place)}</span>` : ''}
      <span class="stats">${familiesComing(yes)}${open ? ` · ${open} עוד לא ענו` : ''}${expected(v) ? ` · צפוי ${shekels(expected(v))}` : ''}</span>
    </button>`;
  }).join('')}
  <button class="btn fire block" data-act="addEvent" style="margin-top:6px">+ אירוע חדש</button>`;
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
  const sum = total(state), all = expected(state), families = payers(state).length;
  const { transfers } = settle(state);
  const openPay = transfers.filter(t => !state.paid.includes(t.key)).length;
  const step = (n, done, title, body, action = '') => `
    <section class="card stepcard ${done ? 'done' : ''}">
      <div class="step-n">${done ? '✓' : n}</div>
      <div class="step-body"><h2>${title}</h2>${body}${action}</div>
    </section>`;
  return `
  ${step(1, e.place && e.date, 'קובעים מקום',
    `<p>${e.place ? `<b>${esc(e.place)}</b>` : 'עוד לא נקבע'}${e.date ? ` · ${esc(eventWhen())}` : ''}${e.checkin ? ` · ${esc(e.checkin)}` : ''}</p>
     ${e.notes ? `<ul class="place-details">${e.notes.split('\n').map(l => l.trim()).filter(Boolean).map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
     ${e.link ? `<p class="small"><a href="${esc(e.link)}" target="_blank" rel="noopener">לדף המקום ↗</a></p>` : ''}`,
    `<button class="btn sm" data-act="editEvent">${e.place ? 'עריכה' : 'קביעת מקום ותאריך'}</button>`)}
  ${step(2, state.people.length && !noAnswer.length, 'מי מגיע',
    state.people.length
      ? `<p><b>${familiesComing(yes)}</b>${noAnswer.length ? ` · <b>${noAnswer.length}</b> עוד לא ענו` : ''}${yes ? ` · ${adults(state)} מבוגרים${kids(state) ? `, ${kids(state)} ילדים` : ''}` : ''}</p>
         ${noAnswer.length ? `<p class="small muted">מחכים ל: ${noAnswer.map(p => esc(p.name)).join(', ')}</p>` : ''}`
      : '<p>עוד אין משפחות ברשימה</p>',
    `<button class="btn sm" data-act="goPeople">${state.people.length ? 'עדכון מי מגיע' : 'הוספת משפחות'}</button>${state.people.length ? ' <button class="btn sm fire" data-act="invite">📨 זימון לכולם</button>' : ''}`)}
  ${step(3, !rolesOpen, 'מחלקים תפקידים',
    `<div class="roles">${LISTS.map((k, i) => `
      <label class="role"><span><i>${i + 1}</i>${esc(LIST_LABELS[k])}</span>
        <select data-act="buyer" data-list="${k}" class="${state.buyers[k] ? '' : 'unset'}">${options(state.buyers[k], 'מי לוקח?')}</select></label>`).join('')}</div>`)}
  ${step(4, !gearOpen, 'ציוד שחוזר כל פעם',
    `<p>${gearOpen ? `ל-<b>${gearOpen}</b> פריטים מתוך ${state.gear.length} אין עדיין מי שמביא` : 'לכל פריט יש מי שמביא'}</p>`,
    `<button class="btn sm" data-act="goTab" data-tab="gear">חלוקת ציוד</button>`)}
  ${step(5, sum && !openPay && sum === all, 'כמה זה עולה ומתחשבנים',
    `<p>${all ? `צפוי <b>${shekels(all)}</b>${families ? `, כ-<b>${shekels(Math.round(all / families))}</b> למשפחה` : ''}` : 'מכניסים מחירים ידועים (למשל הצימר ללילה), ובסוף כל אחד כותב כמה שילם'}</p>
     ${sum ? `<p class="small">שולמו ${shekels(sum)} · ${openPay ? `${openPay} העברות פתוחות` : 'הכל סגור'}</p>` : ''}`,
    `<button class="btn sm" data-act="goTab" data-tab="money">${all ? 'לחשבון' : 'הוספת עלות'}</button>`)}
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
      <li class="row gear-row ${g.done ? 'done' : ''}">
        <input type="checkbox" class="check" data-act="toggleGear" data-id="${g.id}" ${g.done ? 'checked' : ''} aria-label="ארוז">
        <div class="grow"><button class="title" data-act="editGear" data-id="${g.id}">${esc(g.name)}</button></div>
        <select data-act="gearWho" data-id="${g.id}" class="who ${g.who ? '' : 'unset'}" aria-label="מי מביא">${options(g.who, 'מי מביא?')}</select>
        <button class="nope" data-act="skipGear" data-id="${g.id}" aria-label="הפעם לא צריך"><span class="nope-says">הפעם<br>לא צריך</span><span class="nope-face">${face}</span></button>
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

// Two kinds of lines: known costs nobody has paid yet (the zimmer before booking) and
// expenses someone paid. Each family's part covers both; transfers only cover what was paid.
function moneyView() {
  if (!state.people.length) return noPeopleHint();
  const all = expected(state), paidSum = total(state);
  const families = payers(state).length;
  const shared = state.expenses.filter(x => !x.for).reduce((n, x) => n + x.amount, 0);
  const { share, balance, transfers } = settle(state);
  const open = transfers.filter(t => !state.paid.includes(t.key)).length;
  const line = x => `
      <div class="r-line ${x.payer ? '' : 'unpaid'}">
        <button class="what" data-act="editExpense" data-id="${x.id}"><b>${esc(x.what)}</b><span>${esc(CATEGORY_LABELS[x.cat])}${x.calc ? ` · ${esc(x.calc)}` : ''} · ${x.payer ? `שילמו ${esc(personName(x.payer))}` : '<b class="only">עוד לא שולם</b>'}${x.for ? ` · <b class="only">רק על ${esc(personName(x.for))}</b>` : ''}</span></button>
        <span class="amount">${shekels(x.amount)}</span>
        <button class="x" data-act="removeExpense" data-id="${x.id}" aria-label="מחיקה">×</button>
      </div>`;
  const unpaid = state.expenses.filter(x => !x.payer), paidLines = state.expenses.filter(x => x.payer);
  return `
  <section class="receipt">
    <div class="r-head"><b>כמה זה עולה</b><span>${esc(state.event.title)}</span></div>
    ${unpaid.length ? `<div class="r-sub">עלויות צפויות - עוד לא שולמו</div>${unpaid.map(line).join('')}` : ''}
    ${paidLines.length ? `<div class="r-sub">שולם</div>${paidLines.map(line).join('')}` : ''}
    ${state.expenses.length ? '' : '<div class="empty">עוד אין עלויות. אפשר להכניס גם מה שעוד לא שולם, כמו מחיר הצימר ללילה.</div>'}
    <div class="r-total"><span>סה״כ</span><b>${shekels(all)}</b></div>
    <div class="r-split">
      <div><b>${families ? shekels(Math.round(shared / families)) : '—'}</b><span>לכל משפחה</span></div>
      <div><b>${shekels(paidSum)}</b><span>שולם עד עכשיו</span></div>
      <div><b>${families}</b><span>משפחות</span></div>
    </div>
    ${shared !== all ? `<p class="r-note">ועוד ${shekels(all - shared)} שנרשמו על משפחה מסוימת</p>` : ''}
    <button class="btn fire block" data-act="addExpense" data-cat="">+ הוספת הוצאה או עלות צפויה</button>
  </section>

  ${paidSum ? `
  <section class="card">
    <h2>מי מעביר למי <small>${open ? `${open} פתוחות` : 'הכל סגור'}</small></h2>
    ${unpaid.length ? `<p class="small muted" style="margin-top:0">לפי מה ששולם בפועל. ${shekels(all - paidSum)} עוד לא שולמו ולכן לא נכנסו.</p>` : ''}
    ${transfers.length ? transfers.map(t => {
      const paid = state.paid.includes(t.key);
      return `<div class="ticket ${paid ? 'done' : ''}">
        <input type="checkbox" class="check" data-act="paid" data-key="${esc(t.key)}" ${paid ? 'checked' : ''} aria-label="הועבר">
        <div class="grow"><b>${esc(personName(t.from))}</b> ← <b>${esc(personName(t.to))}</b></div>
        <span class="amount">${shekels(t.amount)}</span>
      </div>`;
    }).join('') : '<div class="empty">כולם שילמו בדיוק את החלק שלהם</div>'}
    <button class="btn block" data-act="copySettle" style="margin-top:6px">העתקה לוואטסאפ</button>
  </section>` : ''}

  ${all ? `
  <section class="card">
    <h2>לכל משפחה</h2>
    <ul class="rows">${payers(state).map(p => {
      const paidBy = state.expenses.filter(x => x.payer === p.id).reduce((n, x) => n + x.amount, 0);
      const b = balance[p.id];
      return `<li class="row"><div class="grow"><b>${esc(p.name)}</b><span class="sub">החלק שלהם ${shekels(share[p.id])}${paidBy ? ` · שילמו ${shekels(paidBy)}` : ''}</span></div>
        ${paidSum ? `<span class="amount ${b > 0 ? 'plus' : b < 0 ? 'minus' : ''}">${b > 0 ? 'מקבלים ' + shekels(b) : b < 0 ? 'משלמים ' + shekels(-b) : 'מאוזן'}</span>` : ''}</li>`;
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
    <p class="muted small">ההוצאות מתחלקות שווה בשווה בין המשפחות שמגיעות. הוצאה שהיא של משפחה אחת (למשל יחידה יקרה יותר) נרשמת בחשבון "רק על" אותה משפחה.</p>
    ${state.people.length ? state.people.map(p => `
      <div class="person ${p.coming === 'no' ? 'not-coming' : ''}">
        <div class="person-head">
          <button class="title" data-act="editPerson" data-id="${p.id}">${esc(p.name)}</button>
          ${[p.phone, p.phone2, p.email, p.email2].some(Boolean) ? '' : `<button class="pill" data-act="editPerson" data-id="${p.id}">+ פרטי קשר</button>`}
          <button class="x" data-act="removePerson" data-id="${p.id}" aria-label="מחיקה">×</button>
        </div>
        ${contactsLine(p)}
        <div class="rsvp">${Object.entries(COMING).map(([v, label]) =>
          `<button class="pill ${p.coming === v ? (v === 'yes' ? 'on' : 'off') : ''}" data-act="coming" data-id="${p.id}" data-v="${v}">${label}</button>`).join('')}
          ${p.coming === null ? '<span class="small" style="color:var(--fire)">עוד לא ענו</span>' : ''}</div>
        ${p.coming === 'no' ? '' : `<div class="steps">${stepper(p, 'adults', 'מבוגרים', 1, 4)}${stepper(p, 'kids', 'ילדים', 0, 10)}${stepper(p, 'veg', 'צמחונים', 0, p.adults + p.kids)}</div>`}
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

// An expense or a known cost. Nobody has to have paid yet ("עוד לא שולם"), and the amount
// can be entered as price × units × nights, e.g. ₪1,000 a night × 11 units × 2 nights.
function expenseDialog(x, cat) {
  const editing = Boolean(x);
  const n = nights(state.event) || 1;
  x ||= { what: cat ? LIST_LABELS[cat] : '', amount: 0, calc: '', payer: (cat && state.buyers[cat]) || null, cat: cat || 'other', for: null };
  openDialog(`<h3>${editing ? 'עריכת הוצאה' : 'הוספת הוצאה או עלות צפויה'}</h3>
    <label>על מה</label><input type="text" name="what" value="${esc(x.what)}" maxlength="120" required placeholder="למשל: הצימר, קצביה, סופר">
    <label>מחיר (₪)</label><input type="number" name="price" value="${x.amount ? x.amount / 100 : ''}" min="0.01" step="0.01" inputmode="decimal" required>
    <div class="calc-row">
      <label>× יחידות<input type="number" name="units" value="1" min="1" max="100" step="1" inputmode="numeric"></label>
      <label>× לילות<input type="number" name="nights" value="1" min="1" max="30" step="1" inputmode="numeric"></label>
    </div>
    <p class="small muted" style="margin:4px 0 0">למשל צימר: מחיר ללילה ליחידה × מספר היחידות × ${n} לילות. לסכום רגיל משאירים 1 ו-1.</p>
    <p class="calc-total" id="calcTotal"></p>
    <label>מי שילם</label><select name="payer">${options(x.payer, 'עוד לא שולם')}</select>
    <label>על חשבון</label><select name="for">${options(x.for, 'כולם, שווה בשווה')}</select>
    <p class="small muted" style="margin:4px 0 0">משפחה אחת רק כשההוצאה היא שלה בלבד, למשל ההפרש על יחידה יקרה יותר.</p>
    <label>קטגוריה</label><select name="cat">${CATEGORIES.map(c => `<option value="${c}" ${c === x.cat ? 'selected' : ''}>${esc(CATEGORY_LABELS[c])}</option>`).join('')}</select>
    <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}</div>`,
  d => {
    const units = Math.max(1, parseInt(d.units, 10) || 1), times = Math.max(1, parseInt(d.nights, 10) || 1);
    const price = toAgorot(d.price);
    const calc = units > 1 || times > 1 ? [shekels(price), units > 1 && `${units} יחידות`, times > 1 && `${times} לילות`].filter(Boolean).join(' × ') : '';
    const fields = { what: d.what.trim(), amount: price * units * times, calc, payer: d.payer || null, cat: d.cat, for: d.for || null };
    if (editing) send({ type: 'updateExpense', id: x.id, fields });
    else if (send({ type: 'addExpense', id: newId(), ...fields })) toast(fields.payer ? 'ההוצאה נוספה להתחשבנות' : 'העלות הצפויה נוספה');
  });
  // Show the total as it's typed.
  const f = $('dlgForm');
  const update = () => {
    const total = toAgorot(f.price.value || 0) * Math.max(1, +f.units.value || 1) * Math.max(1, +f.nights.value || 1);
    $('calcTotal').textContent = total ? `סה״כ ${shekels(total)}` : '';
  };
  f.addEventListener('input', update);
  update();
}

function eventDialog() {
  const e = state.event;
  openDialog(`<h3>פרטי האירוע</h3>
    <label>שם</label><input type="text" name="title" value="${esc(e.title)}" maxlength="120" required>
    <div class="calc-row">
      <label>מתאריך<input type="date" name="date" value="${esc(e.date)}"></label>
      <label>עד<input type="date" name="end" value="${esc(e.end)}"></label>
    </div>
    <label>מקום</label><input type="text" name="place" value="${esc(e.place)}" maxlength="120" placeholder="שם הצימר / החניון">
    <label>קישור למקום</label><input type="text" name="link" value="${esc(e.link)}" maxlength="300" placeholder="https://…" inputmode="url">
    <label>צ׳ק אין</label><input type="text" name="checkin" value="${esc(e.checkin)}" maxlength="120" placeholder="למשל: צ׳ק אין 14:30">
    <label>פרטים על המקום (שורה לכל פרט)</label><textarea name="notes" rows="7" maxlength="2000" placeholder="בריכה, מנגלים, מקלחות, טלפון…">${esc(e.notes)}</textarea>
    <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}${root.events.length > 1 ? '<button class="btn danger" value="delete" formnovalidate>מחיקת האירוע</button>' : ''}</div>`,
  (d, action) => {
    if (action === 'delete') {
      if (confirm(`למחוק את "${e.title}" על כל הרשימות שלו? אי אפשר לבטל.`) && send({ type: 'removeEvent', event: e.id })) { eventId = null; refreshView(); render(); }
      return;
    }
    const link = d.link.trim();
    if (link && !link.startsWith('https://')) return toast('הקישור צריך להתחיל ב-https://');
    if (d.date && d.end && d.end < d.date) return toast('תאריך הסיום לפני תאריך ההתחלה');
    send({ type: 'setEvent', fields: { title: d.title.trim(), date: d.date, end: d.end, place: d.place.trim(), link, checkin: d.checkin.trim(), notes: d.notes.trim() } });
  });
}

function addEventDialog() {
  openDialog(`<h3>אירוע חדש</h3>
    <label>סוג</label><select name="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
    <label>שם</label><input type="text" name="title" maxlength="120" required placeholder="למשל: קמפינג אבות וילדים - דצמבר">
    <div class="calc-row">
      <label>מתאריך<input type="date" name="date" required></label>
      <label>עד<input type="date" name="end" required></label>
    </div>
    <label>מקום</label><input type="text" name="place" maxlength="120">
    <p class="small muted">המשפחות משותפות לכל האירועים. הרשימות מתחילות מהתבנית של סוג האירוע. בקמפינג אבות וילדים כל משפחה מתחילה עם מבוגר אחד.</p>
    <div class="actions"><button class="btn primary">יצירה</button>${cancelBtn}</div>`,
  d => {
    if (d.end < d.date) return toast('תאריך הסיום לפני תאריך ההתחלה');
    const id = newId();
    if (send({ type: 'addEvent', id, kind: d.kind, title: d.title.trim(), date: d.date, end: d.end, place: d.place.trim() })) openEvent(id);
  });
}

function menuDialog() {
  openDialog(`<h3>תפריט</h3>
    <div class="menu-list">
      ${state ? '<button class="btn" value="event">פרטי האירוע: תאריכים, מקום, צ׳ק אין</button>' : ''}
      ${state ? '<button class="btn" value="invite">📨 זימון לכולם לאירוע</button>' : ''}
      ${state ? '<button class="btn" value="events">דף הבית - כל האירועים</button>' : ''}
      <button class="btn" value="new">+ אירוע חדש</button>
      <button class="btn" value="share">שליחת קישור לקבוצה</button>
      <button class="btn" value="logout">יציאה מהמכשיר הזה</button>
    </div>
    <div class="actions"><button class="btn" value="cancel">סגירה</button></div>`,
  (d, action) => {
    if (action === 'event') eventDialog();
    if (action === 'events') openEvent(null);
    if (action === 'invite') inviteDialog();
    if (action === 'new') addEventDialog();
    if (action === 'share') shareLink();
    if (action === 'logout' && confirm('לצאת? תצטרכו את הקוד או את Google כדי להיכנס שוב.')) logout();
  });
}

// Invite every family to this event: a Google Calendar event with everyone as guests (Google
// emails the invitations when it's saved), a plain email to everyone, or a WhatsApp message.
function inviteDialog() {
  const e = state.event;
  const emails = [...new Set(state.people.flatMap(p => [p.email, p.email2]).filter(Boolean))];
  const site = location.origin + (TEST ? '/?test=1' : '/');
  const when = e.date ? eventWhen(e).replace(/ · .*$/, '') : '';
  const text = [e.title, when && `מתי: ${when}`, e.place && `איפה: ${e.place}`, e.checkin, e.link].filter(Boolean)
    .concat('', 'מאשרים הגעה, תפקידים וציוד באתר:', site).join(String.fromCharCode(10));
  const ymd = d => d.replaceAll('-', '');
  const after = d => { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
  const cal = e.date ? 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE', text: e.title, dates: `${ymd(e.date)}/${ymd(after(e.end || e.date))}`,
    location: e.place || '', details: text, add: emails.join(','),
  }) : '';
  const mail = `mailto:?bcc=${emails.map(encodeURIComponent).join(',')}&subject=${encodeURIComponent('זימון: ' + e.title)}&body=${encodeURIComponent(text)}`;
  const missing = state.people.filter(p => !p.email && !p.email2).map(p => p.name);
  openDialog(`<h3>זימון לכולם</h3>
    <p class="small muted" style="margin-top:0">${emails.length} כתובות מייל מ-${state.people.length} משפחות${missing.length ? ` · בלי מייל: ${esc(missing.join(', '))}` : ''}</p>
    <div class="menu-list">
      ${cal ? `<a class="btn fire" href="${esc(cal)}" target="_blank" rel="noopener">📅 זימון ביומן גוגל לכולם</a>
      <p class="small muted" style="margin:-4px 0 0">נפתח אירוע ביומן שלך עם כולם כמוזמנים. לוחצים "שמירה" ו"שליחה" וכל אחד מקבל זימון במייל.</p>` : '<p class="small">קודם קובעים תאריך בפרטי האירוע.</p>'}
      <a class="btn" href="${esc(mail)}">✉️ מייל לכולם</a>
      <a class="btn" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 הודעה לקבוצת הוואטסאפ</a>
      <button class="btn" type="button" id="copyInvite">העתקת הטקסט</button>
    </div>
    <div class="actions"><button class="btn" value="cancel">סגירה</button></div>`);
  $('copyInvite').onclick = () => copyText(text);
}

// The code rides in the #fragment, which browsers never send to the server.
async function shareLink() {
  const url = `${location.origin}/${TEST ? '?test=1' : ''}${code ? '#k=' + encodeURIComponent(code) : ''}`;
  const title = state?.event.title ?? 'זיינים וזיינות';
  const text = `${title} - מי מגיע, תפקידים, ציוד והתחשבנות. ${code ? 'הקישור כולל את הקוד, אז רק בקבוצה שלנו 🙏' : 'נכנסים עם חשבון ה-Google שלכם.'}`;
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(`${text}\n${url}`, 'הקישור הועתק');
}

// null = back to the list of events.
function openEvent(id) {
  eventId = id;
  refreshView();
  if (state) tab = 'home';
  render();
  scrollTo(0, 0);
}

function goTab(next) {
  tab = next;
  local.set(TAB_KEY, tab);
  render();
  scrollTo(0, 0);
}

// ---------- events ----------

$('menuBtn').onclick = menuDialog;
$('eventsChip').onclick = () => openEvent(null);
$('peopleChip').onclick = () => goTab('people');
$('moneyChip').onclick = () => goTab('money');
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  if (b.dataset.tab === 'events') return openEvent(null);
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
  if (f.dataset.form === 'addPerson') ok = send({ type: 'addPerson', id: newId(), name, adults: Number(d.adults) });
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
  if (act === 'openEvent') return openEvent(id);
  if (act === 'addEvent') return addEventDialog();
  const p = id && person(id);
  switch (act) {
    case 'goPeople': return goTab('people');
    case 'goTab': return goTab(el.dataset.tab);
    case 'editEvent': return eventDialog();
    case 'invite': return inviteDialog();
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
      if (confirm(`למחוק את "${x.what}" (${shekels(x.amount)})?`)) send({ type: 'removeExpense', id });
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
        <label>טלפון נוסף</label><input type="tel" name="phone2" value="${esc(p.phone2)}" maxlength="20" placeholder="050-0000000" inputmode="tel" pattern="\\+?[0-9 \\-]{7,20}">
        <label>אימייל</label><input type="email" name="email" value="${esc(p.email)}" maxlength="120" dir="ltr">
        <label>אימייל נוסף</label><input type="email" name="email2" value="${esc(p.email2)}" maxlength="120" dir="ltr">
        <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}</div>`,
      d => send({ type: 'updatePerson', id, fields: { name: d.name.trim(), phone: d.phone.trim(), phone2: d.phone2.trim(), email: d.email.trim(), email2: d.email2.trim() } }));
    case 'step': {
      const field = el.dataset.field;
      const fields = { [field]: p[field] + Number(el.dataset.d) };
      // Fewer people can't leave more vegetarians than people.
      if (field !== 'veg') fields.veg = Math.min(p.veg, (fields.adults ?? p.adults) + (fields.kids ?? p.kids));
      return send({ type: 'updatePerson', id, fields });
    }
    case 'removePerson':
      if (confirm(`להסיר את ${p.name} מהסופ״ש?`)) send({ type: 'removePerson', id });
      return;
  }
});

// ---------- start ----------

const fragment = new URLSearchParams(location.hash.slice(1));
const fromLink = fragment.get('k');
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
if (fragment.get('id_token')) googleReturn(fragment.get('id_token'));
else if (fragment.get('error')) showGate('הכניסה עם Google בוטלה');
else if (fromLink || local.get(CODE_KEY)) login(fromLink || local.get(CODE_KEY));
else if (local.get(SESSION_KEY)) login('', local.get(SESSION_KEY));
else showGate();
