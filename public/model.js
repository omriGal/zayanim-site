// Shared data model: used by both the page and the server, so validation, edits and the
// settlement math are identical on both sides.
//
// The saved document ("root") holds the group's families once, and a list of events
// (the May zimmer weekend, the December dads-and-kids camping, ...). Each event has its
// own attendance, roles, lists, gear, notes and expenses. The page works on one event at
// a time through view(root, eventId), which looks like a single weekend with the families
// in it; edits go through applyRootOp, which applies them to that view and writes back.
import { LISTS_TEMPLATE, GEAR_TEMPLATE, NOTES_TEMPLATE, PLACE, CAMPING_GEAR, CAMPING_NOTES } from './template.js';

// The jobs the group hands out every time, in the order they are handed out.
export const LISTS = ['meat', 'alcohol', 'general', 'breakfast', 'dinner'];
export const LIST_LABELS = { meat: 'מנגל', alcohol: 'אלכוהול', general: 'קניות כלליות', breakfast: 'ארוחת בוקר', dinner: 'ארוחת ערב ראשונה' };
export const CATEGORIES = [...LISTS, 'lodging', 'other'];
export const CATEGORY_LABELS = { ...LIST_LABELS, lodging: 'לינה', other: 'אחר' };
export const COMING = { yes: 'מגיעים', no: 'לא מגיעים' };
// After an event: was there enough of each item? Feeds the next event's suggested amounts.
export const FEEDBACK = { '': '', short: 'נגמר', ok: 'בדיוק', over: 'נשאר הרבה' };
const FEEDBACK_FACTOR = { short: 1.3, over: 0.7 };
// For drinks: did we like it? Tells whether to bring the same one next time.
export const LIKED = { '': '', yes: 'אהבנו', no: 'לא אהבנו' };
export const KINDS = { zimmer: 'סופ״ש בצימרים', camping: 'קמפינג אבות וילדים' };
// Each section keeps free-text notes from earlier events.
export const SECTIONS = [...LISTS, 'gear'];
// Each family can have two of each: usually one per partner.
export const CONTACT_FIELDS = ['phone', 'phone2', 'email', 'email2'];
const SIZE_FIELDS = ['adults', 'kids', 'veg'];

const LIMITS = { people: 40, events: 30, items: 200, gear: 100, expenses: 300 };
const MAX_AMOUNT = 100_000_000; // agorot = ₪1,000,000

const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (x, allowed) => plain(x) && Object.keys(x).every(k => allowed.includes(k));
const text = (x, max) => typeof x === 'string' && x.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
const name = (x, max = 120) => text(x, max) && x.trim().length > 0;
const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
const date = x => x === '' || (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x));
const amount = x => Number.isInteger(x) && x > 0 && x <= MAX_AMOUNT;
const count = (x, max) => Number.isInteger(x) && x >= 0 && x <= max;
const url = x => x === '' || (text(x, 300) && /^https:\/\//.test(x));
const phone = x => x === '' || (typeof x === 'string' && /^\+?[0-9 -]{7,20}$/.test(x));
const email = x => x === '' || (typeof x === 'string' && x.length <= 120 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(x));
const fail = msg => { throw new Error(msg); };
const pick = (src, allowed) => Object.fromEntries(Object.entries(src || {}).filter(([k]) => allowed.includes(k)));
const str = x => String(x ?? '').trim();

export function newId() {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}

// Nights between the first and last day, e.g. Thursday to Saturday = 2.
export function nights(event) {
  if (!event.date || !event.end) return 0;
  return Math.max(0, Math.round((new Date(event.end + 'T12:00') - new Date(event.date + 'T12:00')) / 86_400_000));
}

// ---------- one event ----------

function newEvent({ id: eid = newId(), kind = 'zimmer', title, date: start = '', end = '', place = '', link = '', checkin = '', notes = '' }) {
  const camping = kind === 'camping';
  return {
    event: { id: eid, kind, title, date: start, end, place, link, checkin, notes },
    attend: {},
    buyers: Object.fromEntries(LISTS.map(k => [k, null])),
    lists: Object.fromEntries(LISTS.map(k => [k, LISTS_TEMPLATE[k].map(it => ({ id: newId(), ...it, who: null, done: false }))])),
    gear: (camping ? CAMPING_GEAR : GEAR_TEMPLATE).map(n => ({ id: newId(), name: n, who: null, done: false, skipped: false })),
    notes: Object.fromEntries(SECTIONS.map(k => [k, ((camping ? CAMPING_NOTES[k] : NOTES_TEMPLATE[k]) ?? []).join('\n')])),
    expenses: [],
    paid: [],
  };
}

const MAY = () => newEvent({
  title: 'אחוזת טרה קוטה, מאי 2027', date: '2027-05-20', end: '2027-05-22', place: PLACE.place,
  link: 'https://www.weekend.co.il/zimmers/tera-kota', checkin: PLACE.checkin, notes: PLACE.details.join('\n'),
});

export function defaultRoot() {
  return { version: 6, people: [], events: [MAY()] };
}

// One event as the page sees it: the event's own parts, plus every family with its answer
// and its size for this event.
export function view(root, eventId) {
  const e = root.events.find(x => x.event.id === eventId);
  if (!e) return null;
  return {
    event: e.event,
    people: root.people.map(p => ({ ...p, coming: null, ...e.attend[p.id] })),
    buyers: e.buyers, lists: e.lists, gear: e.gear, notes: e.notes, expenses: e.expenses, paid: e.paid,
  };
}

// The starting weekend as a view, for tests and the first visit.
export function defaultState() {
  const root = defaultRoot();
  return view(root, root.events[0].event.id);
}

function writeBack(root, w) {
  const e = root.events.find(x => x.event.id === w.event.id);
  const base = Object.fromEntries(root.people.map(p => [p.id, p]));
  root.people = w.people.map(p => ({
    ...(base[p.id] ?? pick(p, SIZE_FIELDS)),
    id: p.id, name: p.name, ...pick(p, CONTACT_FIELDS),
  }));
  e.attend = Object.fromEntries(w.people.map(p => [p.id, { coming: p.coming, ...pick(p, SIZE_FIELDS) }]));
  Object.assign(e, { event: w.event, buyers: w.buyers, lists: w.lists, gear: w.gear, notes: w.notes, expenses: w.expenses, paid: w.paid });
}

export function validState(s) {
  if (!onlyKeys(s, ['event', 'people', 'buyers', 'lists', 'gear', 'notes', 'expenses', 'paid'])) return false;
  const e = s.event;
  if (!onlyKeys(e, ['id', 'kind', 'title', 'date', 'end', 'place', 'link', 'checkin', 'notes', 'adults', 'kids']) || !id(e.id) || !Object.hasOwn(KINDS, e.kind) || !name(e.title)) return false;
  if ((e.adults !== undefined && !count(e.adults, 300)) || (e.kids !== undefined && !count(e.kids, 300))) return false;
  if (!date(e.date) || !date(e.end) || (e.date && e.end && e.end < e.date) || !text(e.place, 120) || !url(e.link) || !text(e.checkin, 120) || !text(e.notes, 2000)) return false;

  if (!Array.isArray(s.people) || s.people.length > LIMITS.people) return false;
  const people = new Set();
  for (const p of s.people) {
    if (!onlyKeys(p, ['id', 'name', ...CONTACT_FIELDS, 'coming', ...SIZE_FIELDS]) || !id(p.id) || people.has(p.id) || !name(p.name, 80)) return false;
    if (!phone(p.phone) || !phone(p.phone2) || !email(p.email) || !email(p.email2)) return false;
    if (!count(p.adults, 4) || p.adults < 1 || !count(p.kids, 10) || !count(p.veg, 14) || p.veg > p.adults + p.kids || !(p.coming === null || Object.hasOwn(COMING, p.coming))) return false;
    people.add(p.id);
  }
  const person = x => x === null || people.has(x);

  if (!onlyKeys(s.buyers, LISTS) || !LISTS.every(k => person(s.buyers[k]))) return false;

  const ids = new Set();
  const fresh = x => id(x) && !ids.has(x) && ids.add(x);
  if (!onlyKeys(s.lists, LISTS)) return false;
  for (const k of LISTS) {
    const list = s.lists[k];
    if (!Array.isArray(list) || list.length > LIMITS.items) return false;
    for (const it of list) {
      if (!onlyKeys(it, ['id', 'name', 'qty', 'note', 'who', 'done', 'fb', 'liked']) || !fresh(it.id) || !name(it.name) || !text(it.qty, 60) || !text(it.note, 300) || !person(it.who) || typeof it.done !== 'boolean') return false;
      if (it.fb !== undefined && !Object.hasOwn(FEEDBACK, it.fb)) return false;
      if (it.liked !== undefined && !Object.hasOwn(LIKED, it.liked)) return false;
    }
  }

  if (!Array.isArray(s.gear) || s.gear.length > LIMITS.gear) return false;
  for (const g of s.gear) {
    if (!onlyKeys(g, ['id', 'name', 'who', 'done', 'skipped']) || !fresh(g.id) || !name(g.name) || !person(g.who) || typeof g.done !== 'boolean' || typeof g.skipped !== 'boolean') return false;
  }

  if (!onlyKeys(s.notes, SECTIONS) || !SECTIONS.every(k => text(s.notes[k], 3000))) return false;

  // payer null = a known cost nobody has paid yet (say, the zimmer before booking).
  if (!Array.isArray(s.expenses) || s.expenses.length > LIMITS.expenses) return false;
  for (const x of s.expenses) {
    if (!onlyKeys(x, ['id', 'payer', 'amount', 'what', 'calc', 'cat', 'for']) || !fresh(x.id) || !person(x.payer) || !person(x.for) || !amount(x.amount) || !name(x.what) || !text(x.calc, 80) || !CATEGORIES.includes(x.cat)) return false;
  }

  if (!Array.isArray(s.paid) || s.paid.length > 500 || !s.paid.every(k => text(k, 200))) return false;
  return true;
}

// Each edit is a small operation, so two friends editing at once never
// overwrite each other: the server re-applies the operation to the latest list.
// Works on one event's view; returns the new view, or throws an Error with a Hebrew message.
export function applyOp(state, op) {
  const s = structuredClone(state);
  const list = k => LISTS.includes(k) ? s.lists[k] : fail('רשימה לא מוכרת');
  const find = (arr, x) => arr.find(v => v.id === x) || fail('הפריט כבר לא קיים - כנראה מישהו מחק אותו');
  const clearPerson = pid => {
    for (const k of LISTS) {
      if (s.buyers[k] === pid) s.buyers[k] = null;
      for (const it of s.lists[k]) if (it.who === pid) it.who = null;
    }
    for (const g of s.gear) if (g.who === pid) g.who = null;
  };

  switch (op?.type) {
    case 'setEvent':
      Object.assign(s.event, pick(op.fields, ['title', 'date', 'end', 'place', 'link', 'checkin', 'notes', 'adults', 'kids']));
      break;

    case 'addPerson':
      s.people.push({ id: op.id, name: str(op.name), phone: str(op.phone), phone2: '', email: '', email2: '', coming: op.coming ?? null, adults: op.adults ?? 2, kids: op.kids ?? 0, veg: 0 });
      break;
    case 'updatePerson':
      Object.assign(find(s.people, op.id), pick(op.fields, ['name', ...CONTACT_FIELDS, 'coming', ...SIZE_FIELDS]));
      break;
    case 'removePerson':
      find(s.people, op.id);
      if (s.expenses.some(x => x.payer === op.id || x.for === op.id)) fail('יש הוצאות על שמם - מחקו או העבירו אותן קודם');
      s.people = s.people.filter(p => p.id !== op.id);
      clearPerson(op.id);
      break;

    case 'setBuyer':
      list(op.list);
      s.buyers[op.list] = op.person ?? null;
      break;

    case 'addItem':
      list(op.list).push({ id: op.id, name: str(op.name), qty: str(op.qty), note: '', who: null, done: false });
      break;
    case 'updateItem':
      Object.assign(find(list(op.list), op.id), pick(op.fields, ['name', 'qty', 'note', 'who', 'done', 'fb', 'liked']));
      break;
    case 'removeItem':
      find(list(op.list), op.id);
      s.lists[op.list] = s.lists[op.list].filter(it => it.id !== op.id);
      break;

    case 'addGear':
      s.gear.push({ id: op.id, name: str(op.name), who: op.who ?? null, done: false, skipped: false });
      break;
    case 'updateGear':
      Object.assign(find(s.gear, op.id), pick(op.fields, ['name', 'who', 'done', 'skipped']));
      break;
    case 'removeGear':
      find(s.gear, op.id);
      s.gear = s.gear.filter(g => g.id !== op.id);
      break;

    case 'setNotes':
      if (!SECTIONS.includes(op.section)) fail('חלק לא מוכר');
      s.notes[op.section] = String(op.text ?? '').trim();
      break;

    case 'addExpense':
      s.expenses.push({ id: op.id, payer: op.payer ?? null, amount: op.amount, what: str(op.what), calc: str(op.calc), cat: op.cat, for: op.for ?? null });
      break;
    case 'updateExpense':
      Object.assign(find(s.expenses, op.id), pick(op.fields, ['payer', 'amount', 'what', 'calc', 'cat', 'for']));
      break;
    case 'removeExpense':
      find(s.expenses, op.id);
      s.expenses = s.expenses.filter(x => x.id !== op.id);
      break;

    case 'setPaid': {
      const has = s.paid.includes(op.key);
      if (op.paid && !has) s.paid.push(op.key);
      if (!op.paid && has) s.paid = s.paid.filter(k => k !== op.key);
      break;
    }

    default:
      fail('פעולה לא מוכרת');
  }
  if (!validState(s)) fail('הנתונים לא תקינים - בדקו שהשם לא ריק ושהסכום חיובי');
  return s;
}

// ---------- the whole document ----------

export function validRoot(r) {
  if (!onlyKeys(r, ['version', 'people', 'events']) || r.version !== 6) return false;
  if (!Array.isArray(r.people) || !Array.isArray(r.events) || r.events.length > LIMITS.events) return false;
  for (const p of r.people) if (!onlyKeys(p, ['id', 'name', ...CONTACT_FIELDS, ...SIZE_FIELDS])) return false;
  const seen = new Set();
  for (const e of r.events) {
    if (!onlyKeys(e, ['event', 'attend', 'buyers', 'lists', 'gear', 'notes', 'expenses', 'paid']) || !plain(e.attend)) return false;
    if (seen.has(e.event?.id)) return false;
    seen.add(e.event?.id);
    for (const [pid, a] of Object.entries(e.attend)) {
      if (!r.people.some(p => p.id === pid) || !onlyKeys(a, ['coming', ...SIZE_FIELDS])) return false;
    }
    if (!validState(view(r, e.event.id))) return false;
  }
  return true;
}

// Edits to the whole document: adding or removing an event, or any edit to one event
// (op.event says which). Families are shared, so removing one touches every event.
export function applyRootOp(root, op) {
  const r = structuredClone(root);
  switch (op?.type) {
    case 'addEvent': {
      if (!Object.hasOwn(KINDS, op.kind)) fail('סוג אירוע לא מוכר');
      const e = newEvent({ id: op.id, kind: op.kind, title: str(op.title), date: op.date ?? '', end: op.end ?? '', place: str(op.place) });
      // Dads and kids: one adult per family to start with.
      if (op.kind === 'camping') e.attend = Object.fromEntries(r.people.map(p => [p.id, { coming: null, adults: 1, kids: p.kids, veg: 0 }]));
      r.events.push(e);
      break;
    }
    case 'removeEvent': {
      const e = r.events.find(x => x.event.id === op.event) || fail('האירוע כבר לא קיים');
      if (e.expenses.length) fail('יש באירוע הוצאות - מחקו אותן קודם');
      if (r.events.length === 1) fail('זה האירוע האחרון');
      r.events = r.events.filter(x => x !== e);
      break;
    }
    case 'removePerson':
      // The family leaves every event, so check them all before touching any.
      for (const e of r.events) if (e.expenses.some(x => x.payer === op.id || x.for === op.id)) fail(`יש להם הוצאות ב"${e.event.title}" - מחקו או העבירו אותן קודם`);
      if (!r.people.some(p => p.id === op.id)) fail('המשפחה כבר לא ברשימה');
      for (const e of r.events) {
        const w = applyOp(view(r, e.event.id), op);
        Object.assign(e, { buyers: w.buyers, lists: w.lists, gear: w.gear });
        delete e.attend[op.id];
      }
      r.people = r.people.filter(p => p.id !== op.id);
      break;
    default: {
      const w = view(r, op?.event) || fail('האירוע כבר לא קיים');
      writeBack(r, applyOp(w, op));
    }
  }
  if (!validRoot(r)) fail('הנתונים לא תקינים');
  return r;
}

// Saved data from before events were separate: the single weekend becomes the first event.
export function migrate(saved) {
  if (saved?.version === 6) return upgrade(saved);
  const w = upgradeWeekend(saved);
  const root = { version: 6, people: [], events: [] };
  const e = newEvent({ ...w.event, kind: 'zimmer', end: w.event.date ? addDays(w.event.date, 2) : '' });
  Object.assign(e, { buyers: w.buyers, lists: w.lists, gear: w.gear, notes: w.notes, expenses: w.expenses, paid: w.paid });
  root.people = w.people.map(p => ({ id: p.id, name: p.name, ...pick(p, CONTACT_FIELDS), ...pick(p, SIZE_FIELDS) }));
  e.attend = Object.fromEntries(w.people.map(p => [p.id, { coming: p.coming ?? null, ...pick(p, SIZE_FIELDS) }]));
  root.events.push(e);
  return root;
}

// Fills in fields added after a document was first saved.
export function upgrade(root) {
  for (const e of root?.events ?? []) for (const x of e.expenses) x.calc ??= '';
  return root;
}

const addDays = (d, n) => { const t = new Date(d + 'T12:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };

// Older single-weekend saves, field by field as they grew.
function upgradeWeekend(s) {
  for (const g of s.gear ?? []) g.skipped ??= false;
  for (const p of s.people ?? []) { delete p.weight; delete p.skip; for (const k of CONTACT_FIELDS) p[k] ??= ''; }
  for (const x of s.expenses ?? []) { x.for ??= null; x.calc ??= ''; }
  for (const k of LISTS) {
    if (s.buyers && !(k in s.buyers)) s.buyers[k] = null;
    if (s.lists && !s.lists[k]) s.lists[k] = LISTS_TEMPLATE[k].map(it => ({ id: newId(), ...it, who: null, done: false }));
    if (s.notes && !(k in s.notes)) s.notes[k] = NOTES_TEMPLATE[k].join('\n');
  }
  const e = s.event;
  if (e && e.place === 'טרה קוטה' && !e.notes) Object.assign(e, { place: PLACE.place, checkin: e.checkin || PLACE.checkin, notes: PLACE.details.join('\n') });
  return s;
}

// ---------- counts and money, for one event's view ----------

// Families who said they're not coming drop out of the counts and the bill.
export const payers = s => s.people.filter(p => p.coming !== 'no');
export const coming = s => s.people.filter(p => p.coming === 'yes');
export const adults = s => coming(s).reduce((n, p) => n + p.adults, 0);
export const kids = s => coming(s).reduce((n, p) => n + p.kids, 0);
export const veg = s => coming(s).reduce((n, p) => n + p.veg, 0);
// What has actually been paid, and what the event is expected to cost in all.
export const total = s => s.expenses.filter(x => x.payer).reduce((n, x) => n + x.amount, 0);
export const expected = s => s.expenses.reduce((n, x) => n + x.amount, 0);

// Split equally between the families that are coming, or all on one family for an
// expense entered for that family only. Money is in agorot, so nothing drifts.
function split(s, x, add) {
  let members = x.for ? s.people.filter(p => p.id === x.for) : payers(s);
  if (!members.length) members = s.people.filter(p => p.id === x.payer);
  let left = x.amount;
  const parts = members.map(p => { const v = Math.floor(x.amount / members.length); left -= v; return [p.id, v]; });
  for (let i = 0; left > 0; i = (i + 1) % parts.length, left--) parts[i][1]++;
  for (const [pid, v] of parts) add(pid, v);
}

// Who owes what. `share` is each family's part of everything, including costs nobody has
// paid yet; balances and transfers only count what was actually paid.
export function settle(s) {
  const zero = () => Object.fromEntries(s.people.map(p => [p.id, 0]));
  const share = zero(), balance = zero();
  for (const x of s.expenses) {
    split(s, x, (pid, v) => { share[pid] += v; });
    if (!x.payer) continue;
    balance[x.payer] += x.amount;
    split(s, x, (pid, v) => { balance[pid] -= v; });
  }

  const debtors = [], creditors = [];
  for (const p of s.people) {
    if (balance[p.id] < 0) debtors.push({ id: p.id, left: -balance[p.id] });
    if (balance[p.id] > 0) creditors.push({ id: p.id, left: balance[p.id] });
  }
  debtors.sort((a, b) => b.left - a.left);
  creditors.sort((a, b) => b.left - a.left);
  const transfers = [];
  for (let d = 0, c = 0; d < debtors.length && c < creditors.length;) {
    const v = Math.min(debtors[d].left, creditors[c].left);
    transfers.push({ from: debtors[d].id, to: creditors[c].id, amount: v, key: `${s.event.id}:${debtors[d].id}>${creditors[c].id}:${v}` });
    debtors[d].left -= v;
    creditors[c].left -= v;
    if (!debtors[d].left) d++;
    if (!creditors[c].left) c++;
  }
  return { share, balance, transfers };
}

export const shekels = agorot => '₪' + (agorot / 100).toLocaleString('he-IL', { minimumFractionDigits: agorot % 100 ? 2 : 0, maximumFractionDigits: 2 });

// ---------- amounts for next time ----------

// A kid eats about half of what an adult does. An event from before the site, where nobody
// marked who came, can carry the headcount on the event itself.
export const portions = s => coming(s).length ? adults(s) + kids(s) / 2 : (s.event.adults || 0) + (s.event.kids || 0) / 2;

// Every number in a quantity is scaled: "25" → "30", "10 / 4 / 10" → "12 / 5 / 12",
// "1.5 ק״ג" → "2 ק״ג". Text without numbers ("שישיות", "חבילה") stays as it is.
export function scaleQty(qty, f) {
  if (Math.abs(f - 1) < 0.01) return qty;
  return String(qty).replace(/\d+(?:\.\d+)?/g, m => {
    const n = Number(m), v = n * f;
    if (n >= 100) return String(Math.max(50, Math.round(v / 50) * 50));
    if (m.includes('.')) return String(Math.max(0.5, Math.round(v * 2) / 2));
    return String(Math.max(1, Math.round(v)));
  });
}

const sameName = (a, b) => a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ');

// The latest event that is already over, had this list and a headcount (the same kind of
// event if there is one), scaled to this event's headcount and to how each item went
// ("נגמר" → 30% more, "נשאר הרבה" → 30% less).
export function suggestList(root, eventId, k, today = new Date().toLocaleDateString('en-CA')) {
  const here = view(root, eventId);
  const from = previousEvent(root, eventId, k, today);
  if (!here || !from) return null;
  const now = portions(here);
  const scale = now > 0 ? now / portions(from) : 1;
  return {
    from: from.event, fromPortions: portions(from), portions: now, scale,
    items: from.lists[k].map(it => {
      const qty = scaleQty(it.qty, scale * (FEEDBACK_FACTOR[it.fb] ?? 1));
      const existing = here.lists[k].find(x => sameName(x.name, it.name));
      return { name: it.name, was: it.qty, qty, fb: it.fb || '', liked: it.liked || '', existing: existing?.id || null, same: existing ? existing.qty === qty : false };
    }),
  };
}

// The latest event that is already over and had this list and a headcount, as a view.
export function previousEvent(root, eventId, k, today = new Date().toLocaleDateString('en-CA')) {
  const here = view(root, eventId);
  if (!here || !LISTS.includes(k)) return null;
  const before = root.events
    .filter(e => e.event.id !== eventId && e.lists[k].length && e.event.date && (e.event.end || e.event.date) < today
      && (!here.event.date || e.event.date < here.event.date))
    .map(e => view(root, e.event.id))
    .filter(v => portions(v) > 0)
    .sort((a, b) => (b.event.kind === here.event.kind) - (a.event.kind === here.event.kind) || b.event.date.localeCompare(a.event.date));
  return before[0] || null;
}

// What the group thought of each item the last time it was there: name → { liked, title }.
// Only events that are over and came before this one count; the latest verdict wins.
export function verdicts(root, eventId, k, today = new Date().toLocaleDateString('en-CA')) {
  const here = root.events.find(e => e.event.id === eventId);
  const out = new Map();
  if (!here || !LISTS.includes(k)) return out;
  root.events
    .filter(e => e !== here && e.event.date && (e.event.end || e.event.date) < today && (!here.event.date || e.event.date < here.event.date))
    .sort((a, b) => a.event.date.localeCompare(b.event.date))
    .forEach(e => e.lists[k].forEach(it => { if (it.liked) out.set(it.name.trim(), { liked: it.liked, title: e.event.title }); }));
  return out;
}
