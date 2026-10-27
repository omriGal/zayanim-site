import { LISTS, LIST_LABELS, CATEGORIES, CATEGORY_LABELS, applyOp, newId, settle, headcount, total, shekels } from './model.js';

const TEST = new URLSearchParams(location.search).get('test') === '1';
const API = '/api/list' + (TEST ? '?test=1' : '');
const CODE_KEY = 'zayanim-code' + (TEST ? '-test' : '');
const TAB_KEY = 'zayanim-tab';
const POLL_MS = 20_000;

const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const TABS = [
  { id: 'meat', label: 'מנגל', icon: icon('<path d="M12 3c1.2 3 4.5 4.6 4.5 8.6a4.5 4.5 0 0 1-9 0c0-2.1 1-3.4 2.2-4.4 0 2 .9 3.1 2.1 3.3-.4-3 .1-5.2.2-7.5z"/><path d="M5 21h14M8 18l-1.5 3M16 18l1.5 3"/>') },
  { id: 'alcohol', label: 'אלכוהול', icon: icon('<path d="M7.5 3h9l-.8 6.5a3.7 3.7 0 0 1-7.4 0z"/><path d="M8 7h8M12 13.2V20M8.5 20.5h7"/>') },
  { id: 'general', label: 'כללי', icon: icon('<path d="M3 9.5h18l-2 10.5H5z"/><path d="M8 9.5 11 4M16 9.5 13 4M9 13.5v3M15 13.5v3M12 13.5v3"/>') },
  { id: 'gear', label: 'ציוד', icon: icon('<path d="M12 4 2.5 20h19z"/><path d="M12 4v16M8.5 20 12 13.5 15.5 20"/>') },
  { id: 'money', label: 'חשבון', icon: icon('<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8h6M9 11.5h6M9 15h3"/>') },
];
// "Hi, I'm buying ___" on each list's name tag.
const BUY_LABELS = { meat: 'את הבשר', alcohol: 'את האלכוהול', general: 'את האוכל הכללי' };

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
let tab = local.get(TAB_KEY) || 'meat';
let backTab = 'meat';

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
const BY_TAB = { alcohol: 'aperol', meat: 'grill', general: 'eggs' };
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
  if (/ביצ/.test(itemName) && photos.eggs) return 'eggs';
  if (adding && Math.random() < 0.3 && photos['not-needed']) return 'not-needed';
  const own = BY_TAB[list];
  if (own && own !== lastCameo && Math.random() < 0.55 && photos[own]) return own;
  return pickOne(ANYWHERE);
}

function cameoFor(op, before) {
  const list = op.list || (LISTS.includes(tab) ? tab : '');
  const itemName = op.name || (op.type === 'updateItem' ? before.lists[op.list]?.find(i => i.id === op.id)?.name : '') || '';
  showCameo(pickCameo(list, itemName, op.type === 'addItem' || op.type === 'addGear'));
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
    loadPhotos().then(morning);
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
const options = (selected, empty) =>
  `<option value="">${esc(empty)}</option>` +
  state.people.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : '';
const toAgorot = v => Math.round(parseFloat(String(v).replace(',', '.')) * 100);

function groupSummary() {
  const couples = state.people.filter(p => p.size === 2).length;
  const singles = state.people.length - couples;
  if (!state.people.length) return '+ הוסיפו את החברים';
  const parts = [];
  if (couples) parts.push(couples === 1 ? 'זוג אחד' : `${couples} זוגות`);
  if (singles) parts.push(singles === 1 ? 'יחיד אחד' : `${singles} יחידים`);
  return `${parts.join(' + ')} · ${headcount(state)} אנשים`;
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

  $('evTitle').textContent = state.event.title;
  $('evMeta').textContent = [fmtDate(state.event.date), state.event.place].filter(Boolean).join(' · ') || 'תאריך ומקום? בתפריט';
  $('peopleChip').textContent = groupSummary();
  $('moneyChip').textContent = 'בקופה: ' + shekels(total(state));
  document.title = state.event.title;

  $('tabs').innerHTML = TABS.map(t =>
    `<button data-tab="${t.id}" class="${tab === t.id ? 'on' : ''}">${t.icon}${t.label}</button>`).join('');

  $('view').innerHTML = LISTS.includes(tab) ? listView(tab)
    : tab === 'gear' ? gearView()
    : tab === 'money' ? moneyView()
    : peopleView();

  for (const [id, value] of kept) { const el = $(id); if (el) el.value = value; }
  if (focused && $(focused) && $('view').contains($(focused))) $(focused).focus();
  updateSync();
}

function noPeopleHint() {
  return state.people.length ? '' :
    `<section class="card"><h2>קודם כל, מי מגיע?</h2><p class="muted small">מוסיפים את הזוגות, ואז בוחרים מי קונה מה ומתחשבנים בסוף.</p><button class="btn fire" data-act="goPeople">הוספת החברים</button></section>`;
}

function listView(k) {
  const items = state.lists[k];
  const buyer = state.buyers[k];
  const done = items.filter(i => i.done).length;
  const exp = state.expenses.filter(x => x.cat === k);
  const spent = exp.reduce((n, x) => n + x.amount, 0);
  const sorted = [...items.filter(i => !i.done), ...items.filter(i => i.done)];
  return `
  ${noPeopleHint()}
  <section class="nametag">
    <div class="nametag-top"><span>מי קונה</span><b>${esc(BUY_LABELS[k])}</b></div>
    <div class="nametag-body">
      <select id="buyer-${k}" data-act="buyer" data-list="${k}" class="${buyer ? '' : 'unset'}" aria-label="מי קונה ${esc(LIST_LABELS[k])}">${options(buyer, 'מי? בחרו שם')}</select>
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
        <div class="grow"><button class="title" data-act="editItem" data-list="${k}" data-id="${it.id}">${esc(it.name)}<span class="sub">${esc([it.qty, it.note].filter(Boolean).join(' · '))}</span></button></div>
        <button class="x" data-act="removeItem" data-list="${k}" data-id="${it.id}" aria-label="מחיקה">×</button>
      </li>`).join('')}</ul>` : '<div class="empty">ריק פה. מה צריך?</div>'}
    ${items.length ? `<button class="btn sm" data-act="copyList" data-list="${k}" style="margin-top:14px">העתקת מה שחסר לוואטסאפ</button>` : ''}
  </section>`;
}

function gearView() {
  const missing = state.gear.filter(g => !g.who).length;
  return `
  ${noPeopleHint()}
  <section class="card">
    <h2>ציוד מהבית <small>${missing ? `ל-${missing} פריטים אין עדיין מי שמביא` : 'לכל פריט יש מי שמביא'}</small></h2>
    <p class="muted small" style="margin-top:0">דברים שמביאים, לא קונים. בחרו ליד כל פריט מי מביא אותו, וסמנו ✓ כשהוא כבר באוטו.</p>
    <form class="quick" data-form="addGear" style="grid-template-columns:1fr 44px">
      <input type="text" id="q-gear" data-keep name="name" placeholder="עוד משהו להביא…" maxlength="120" required autocomplete="off">
      <button class="btn primary" aria-label="הוספה">+</button>
    </form>
    ${state.gear.length ? `<ul class="rows">${state.gear.map(g => `
      <li class="row ${g.done ? 'done' : ''}">
        <input type="checkbox" class="check" data-act="toggleGear" data-id="${g.id}" ${g.done ? 'checked' : ''} aria-label="נארז">
        <div class="grow"><button class="title" data-act="editGear" data-id="${g.id}">${esc(g.name)}</button></div>
        <select data-act="gearWho" data-id="${g.id}" class="${g.who ? '' : 'unset'}" aria-label="מי מביא">${options(g.who, 'מי מביא?')}</select>
        <button class="x" data-act="removeGear" data-id="${g.id}" aria-label="מחיקה">×</button>
      </li>`).join('')}</ul>` : '<div class="empty">אין ציוד ברשימה.</div>'}
  </section>`;
}

function moneyView() {
  if (!state.people.length) return noPeopleHint();
  const sum = total(state);
  const hc = headcount(state);
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
      <div><b>${hc ? shekels(Math.round(sum / hc)) : '—'}</b><span>${skips.length ? 'ממוצע לאדם' : 'לאדם'}</span></div>
      <div><b>${hc ? shekels(Math.round(sum * 2 / hc)) : '—'}</b><span>${skips.length ? 'ממוצע לזוג' : 'לזוג'}</span></div>
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
    <h2>מאזן לכל זוג</h2>
    <ul class="rows">${state.people.map(p => {
      const paidBy = state.expenses.filter(x => x.payer === p.id).reduce((n, x) => n + x.amount, 0);
      const b = balance[p.id];
      return `<li class="row"><div class="grow"><b>${esc(p.name)}</b><span class="sub">שילמו ${shekels(paidBy)} · החלק שלהם ${shekels(share[p.id])}</span></div>
        <span class="amount ${b > 0 ? 'plus' : b < 0 ? 'minus' : ''}">${b > 0 ? 'מקבלים ' + shekels(b) : b < 0 ? 'משלמים ' + shekels(-b) : 'מאוזן'}</span></li>`;
    }).join('')}</ul>
  </section>` : ''}`;
}

function peopleView() {
  return `
  <section class="card">
    <h2>מי מגיע <small>${esc(groupSummary())}</small></h2>
    <form class="quick" data-form="addPerson" style="grid-template-columns:1fr 96px 44px">
      <input type="text" id="q-person" data-keep name="name" placeholder="למשל: דני ומיכל" maxlength="80" required autocomplete="off">
      <select name="size" aria-label="זוג או יחיד"><option value="2">זוג</option><option value="1">יחיד</option></select>
      <button class="btn primary" aria-label="הוספה">+</button>
    </form>
    <p class="muted small">ההוצאות מתחלקות לפי מספר אנשים: זוג משלם כפול מיחיד. מי שלא שותה או לא אוכל בשר - לחצו על הקטגוריה כדי להוציא אותו ממנה.</p>
    ${state.people.length ? state.people.map(p => `
      <div class="person">
        <div class="person-head">
          <button class="title" data-act="editPerson" data-id="${p.id}">${esc(p.name)}</button>
          <button class="pill" data-act="toggleSize" data-id="${p.id}">${p.size === 2 ? 'זוג' : 'יחיד'}</button>
          <button class="x" data-act="removePerson" data-id="${p.id}" aria-label="מחיקה">×</button>
        </div>
        <div class="toggles">משתתפים ב:
          ${LISTS.map(k => `<button class="pill ${p.skip.includes(k) ? 'off' : 'on'}" data-act="toggleSkip" data-id="${p.id}" data-list="${k}">${esc(LIST_LABELS[k])}</button>`).join('')}
        </div>
      </div>`).join('') : '<div class="empty">עוד אין אף אחד ברשימה.</div>'}
  </section>
  <button class="btn block" data-act="back">→ חזרה</button>`;
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

function itemDialog(k, it) {
  openDialog(`<h3>עריכת פריט</h3>
    <label>מה</label><input type="text" name="name" value="${esc(it.name)}" maxlength="120" required>
    <label>כמות</label><input type="text" name="qty" value="${esc(it.qty)}" maxlength="60">
    <label>הערה</label><input type="text" name="note" value="${esc(it.note)}" maxlength="300" placeholder="מותג, איפה קונים…">
    <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}<button class="btn danger" value="delete" formnovalidate>מחיקה</button></div>`,
  (d, action) => {
    if (action === 'delete') send({ type: 'removeItem', list: k, id: it.id });
    else send({ type: 'updateItem', list: k, id: it.id, fields: { name: d.name.trim(), qty: d.qty.trim(), note: d.note.trim() } });
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
    <label>תאריך</label><input type="date" name="date" value="${esc(e.date)}">
    <label>מקום</label><input type="text" name="place" value="${esc(e.place)}" maxlength="120" placeholder="שם הצימר / יישוב">
    <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}</div>`,
  d => send({ type: 'setEvent', fields: { title: d.title.trim(), date: d.date, place: d.place.trim() } }));
}

function newEventDialog() {
  const { transfers } = settle(state);
  const open = transfers.filter(t => !state.paid.includes(t.key)).length;
  openDialog(`<h3>סיום וסופ״ש חדש</h3>
    ${open ? `<p style="color:var(--red)">שימו לב: יש עוד ${open} העברות שלא סומנו כשולמו.</p>` : ''}
    <p class="small muted">הסופ״ש הנוכחי יישמר בהיסטוריה עם סכום ההוצאות. החברים, הרשימות והציוד נשארים; הסימונים, הקונים וההוצאות מתאפסים.</p>
    <label>שם הסופ״ש החדש</label><input type="text" name="title" value="${esc(state.event.title)}" maxlength="120" required>
    <label>תאריך</label><input type="date" name="date">
    <label>מקום</label><input type="text" name="place" maxlength="120">
    <div class="actions"><button class="btn primary">פתיחת סופ״ש חדש</button>${cancelBtn}</div>`,
  d => { if (send({ type: 'newEvent', id: newId(), title: d.title.trim(), date: d.date, place: d.place.trim() })) { tab = 'meat'; render(); toast('סופ״ש חדש נפתח'); } });
}

function pastDialog() {
  openDialog(`<h3>סופ״שים קודמים</h3>
    ${state.past.length ? `<ul class="rows">${state.past.map(p => `<li class="row"><div class="grow"><b>${esc(p.title)}</b><span class="sub">${esc([fmtDate(p.date), p.place].filter(Boolean).join(' · '))}</span></div>
      <span class="amount">${shekels(p.total)}${p.people ? `<span class="sub">${shekels(Math.round(p.total / p.people))} לאדם</span>` : ''}</span></li>`).join('')}</ul>`
      : '<p class="muted">עוד אין. כשסופ״ש נגמר, בחרו בתפריט "סיום וסופ״ש חדש".</p>'}
    <div class="actions"><button class="btn" value="cancel">סגירה</button></div>`);
}

function menuDialog() {
  openDialog(`<h3>תפריט</h3>
    <div class="menu-list">
      <button class="btn" value="event">פרטי הסופ״ש: שם, תאריך, מקום</button>
      <button class="btn" value="people">מי מגיע</button>
      <button class="btn" value="share">שליחת קישור לקבוצה</button>
      <button class="btn" value="new">סיום וסופ״ש חדש</button>
      <button class="btn" value="past">סופ״שים קודמים</button>
      <button class="btn" value="logout">יציאה מהמכשיר הזה</button>
    </div>
    <div class="actions"><button class="btn" value="cancel">סגירה</button></div>`,
  (d, action) => {
    if (action === 'event') eventDialog();
    if (action === 'people') goPeople();
    if (action === 'share') shareLink();
    if (action === 'new') newEventDialog();
    if (action === 'past') pastDialog();
    if (action === 'logout' && confirm('לצאת? תצטרכו את הקוד כדי להיכנס שוב.')) logout();
  });
}

// The code rides in the #fragment, which browsers never send to the server.
async function shareLink() {
  const url = `${location.origin}/${TEST ? '?test=1' : ''}#k=${encodeURIComponent(code)}`;
  const text = `${state.event.title} - רשימות, ציוד והתחשבנות. הקישור כולל את הקוד, אז רק בקבוצה שלנו 🙏`;
  if (navigator.share) {
    try { await navigator.share({ title: state.event.title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(`${text}\n${url}`, 'הקישור הועתק');
}

function goPeople() {
  if (tab !== 'people') backTab = tab;
  tab = 'people';
  render();
  scrollTo(0, 0);
}

// ---------- events ----------

$('menuBtn').onclick = menuDialog;
$('peopleChip').onclick = goPeople;
$('moneyChip').onclick = () => { tab = 'money'; local.set(TAB_KEY, tab); render(); };
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  local.set(TAB_KEY, tab);
  render();
  scrollTo(0, 0);
  refresh();
  showCameo(pickCameo(tab));
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
  if (f.dataset.form === 'addPerson') ok = send({ type: 'addPerson', id: newId(), name, size: Number(d.size) });
  if (ok) {
    // send() already redrew the page, so clear the new copy of the form.
    const fresh = $('view').querySelector(`form[data-form="${f.dataset.form}"]`);
    fresh?.querySelectorAll('input').forEach(i => { i.value = ''; });
    fresh?.querySelector('input')?.focus();
  }
});

$('view').addEventListener('change', e => {
  const el = e.target;
  const { act, list, id } = el.dataset;
  if (act === 'buyer') send({ type: 'setBuyer', list, person: el.value || null });
  if (act === 'toggleItem') send({ type: 'updateItem', list, id, fields: { done: el.checked } });
  if (act === 'toggleGear') send({ type: 'updateGear', id, fields: { done: el.checked } });
  if (act === 'gearWho') send({ type: 'updateGear', id, fields: { who: el.value || null } });
  if (act === 'paid') send({ type: 'setPaid', key: el.dataset.key, paid: el.checked });
});

$('view').addEventListener('click', e => {
  const el = e.target.closest('button[data-act]');
  if (!el) return;
  const { act, list, id, cat } = el.dataset;
  const p = id && person(id);
  switch (act) {
    case 'goPeople': return goPeople();
    case 'back': tab = backTab; render(); return;
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
        <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}</div>`,
      d => send({ type: 'updateGear', id, fields: { name: d.name.trim() } }));
    }
    case 'removeGear': return send({ type: 'removeGear', id });
    case 'addExpense':
      if (!state.people.length) return toast('הוסיפו קודם את החברים');
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
      return openDialog(`<h3>עריכת שם</h3><input type="text" name="name" value="${esc(p.name)}" maxlength="80" required>
        <div class="actions"><button class="btn primary">שמירה</button>${cancelBtn}</div>`,
      d => send({ type: 'updatePerson', id, fields: { name: d.name.trim() } }));
    case 'toggleSize': return send({ type: 'updatePerson', id, fields: { size: p.size === 2 ? 1 : 2 } });
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
