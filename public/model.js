// Shared data model for the weekend: used by both the page and the server,
// so validation, edits and the settlement math are identical on both sides.
import { LISTS_TEMPLATE, GEAR_TEMPLATE } from './template.js';

// The four jobs the group hands out every time, in the order they are handed out.
export const LISTS = ['meat', 'alcohol', 'general', 'breakfast'];
export const LIST_LABELS = { meat: 'מנגל', alcohol: 'אלכוהול', general: 'קניות כלליות', breakfast: 'ארוחת בוקר' };
export const CATEGORIES = [...LISTS, 'lodging', 'other'];
export const CATEGORY_LABELS = { ...LIST_LABELS, lodging: 'הצימר', other: 'אחר' };
export const COMING = { yes: 'מגיעים', no: 'לא מגיעים' };
// Quick answers to "how was the quantity?" after a weekend.
export const LESSONS = { missing: 'היה חסר', extra: 'היה יותר מדי', ok: 'בדיוק' };
export const GEAR_GROUPS = { kitchen: 'מטבח', fire: 'מנגל ומדורה', fun: 'כללי ובידור' };
export const WEIGHTS = [0.5, 1, 1.5, 2];

const LIMITS = { people: 40, items: 200, gear: 150, expenses: 300, past: 50 };
const MAX_AMOUNT = 10_000_000; // agorot = ₪100,000

const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (x, allowed) => plain(x) && Object.keys(x).every(k => allowed.includes(k));
const text = (x, max) => typeof x === 'string' && x.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
const name = (x, max = 120) => text(x, max) && x.trim().length > 0;
const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
const date = x => x === '' || (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x));
const amount = x => Number.isInteger(x) && x > 0 && x <= MAX_AMOUNT;
const count = (x, max) => Number.isInteger(x) && x >= 0 && x <= max;
const url = x => x === '' || (text(x, 300) && /^https:\/\//.test(x));

export function newId() {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}

export function defaultState() {
  return {
    version: 4,
    event: { id: newId(), title: 'זיינים וזיינות - מאי 2027', date: '2027-05-20', place: 'טרה קוטה', link: 'https://www.weekend.co.il/zimmers/tera-kota', checkin: '', notes: '' },
    people: [],
    buyers: Object.fromEntries(LISTS.map(k => [k, null])),
    lists: Object.fromEntries(LISTS.map(k => [k, LISTS_TEMPLATE[k].map(it => ({ id: newId(), ...it, who: null, done: false }))])),
    gear: GEAR_TEMPLATE.map(g => ({ id: newId(), ...g, who: null, done: false })),
    expenses: [],
    paid: [],
    past: [],
  };
}

export function validState(s) {
  if (!onlyKeys(s, ['version', 'event', 'people', 'buyers', 'lists', 'gear', 'expenses', 'paid', 'past']) || s.version !== 4) return false;
  const e = s.event;
  if (!onlyKeys(e, ['id', 'title', 'date', 'place', 'link', 'checkin', 'notes']) || !id(e.id) || !name(e.title) || !date(e.date) || !text(e.place, 120) || !url(e.link) || !text(e.checkin, 120) || !text(e.notes, 2000)) return false;

  if (!Array.isArray(s.people) || s.people.length > LIMITS.people) return false;
  const people = new Set();
  for (const p of s.people) {
    if (!onlyKeys(p, ['id', 'name', 'coming', 'adults', 'kids', 'veg', 'weight', 'skip']) || !id(p.id) || people.has(p.id) || !name(p.name, 80)) return false;
    if (!count(p.adults, 4) || p.adults < 1 || !count(p.kids, 10) || !count(p.veg, 14) || p.veg > p.adults + p.kids || !WEIGHTS.includes(p.weight) || !(p.coming === null || Object.hasOwn(COMING, p.coming))) return false;
    if (!Array.isArray(p.skip) || !p.skip.every(c => LISTS.includes(c)) || new Set(p.skip).size !== p.skip.length) return false;
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
      if (!onlyKeys(it, ['id', 'name', 'qty', 'note', 'lesson', 'who', 'done']) || !fresh(it.id) || !name(it.name) || !text(it.qty, 60) || !text(it.note, 300) || !text(it.lesson, 300) || !person(it.who) || typeof it.done !== 'boolean') return false;
    }
  }

  if (!Array.isArray(s.gear) || s.gear.length > LIMITS.gear) return false;
  for (const g of s.gear) {
    if (!onlyKeys(g, ['id', 'group', 'name', 'note', 'who', 'done']) || !fresh(g.id) || !Object.hasOwn(GEAR_GROUPS, g.group) || !name(g.name) || !text(g.note, 300) || !person(g.who) || typeof g.done !== 'boolean') return false;
  }

  if (!Array.isArray(s.expenses) || s.expenses.length > LIMITS.expenses) return false;
  for (const x of s.expenses) {
    if (!onlyKeys(x, ['id', 'payer', 'amount', 'what', 'cat']) || !fresh(x.id) || !people.has(x.payer) || !amount(x.amount) || !name(x.what) || !CATEGORIES.includes(x.cat)) return false;
  }

  if (!Array.isArray(s.paid) || s.paid.length > 500 || !s.paid.every(k => text(k, 200))) return false;

  if (!Array.isArray(s.past) || s.past.length > LIMITS.past) return false;
  for (const p of s.past) {
    if (!onlyKeys(p, ['id', 'title', 'date', 'place', 'total', 'families']) || !id(p.id) || !name(p.title) || !date(p.date) || !text(p.place, 120)) return false;
    if (!Number.isInteger(p.total) || p.total < 0 || !Number.isInteger(p.families) || p.families < 0) return false;
  }
  return true;
}

// Each edit is a small operation, so two friends editing at once never
// overwrite each other: the server re-applies the operation to the latest list.
// Returns the new state, or throws an Error with a Hebrew message.
export function applyOp(state, op) {
  const s = structuredClone(state);
  const fail = msg => { throw new Error(msg); };
  const list = k => LISTS.includes(k) ? s.lists[k] : fail('רשימה לא מוכרת');
  const find = (arr, x) => arr.find(v => v.id === x) || fail('הפריט כבר לא קיים - כנראה מישהו מחק אותו');
  const pick = (src, allowed) => Object.fromEntries(Object.entries(src || {}).filter(([k]) => allowed.includes(k)));
  const str = x => String(x ?? '').trim();
  const clearPerson = pid => {
    for (const k of LISTS) {
      if (s.buyers[k] === pid) s.buyers[k] = null;
      for (const it of s.lists[k]) if (it.who === pid) it.who = null;
    }
    for (const g of s.gear) if (g.who === pid) g.who = null;
  };

  switch (op?.type) {
    case 'setEvent':
      Object.assign(s.event, pick(op.fields, ['title', 'date', 'place', 'link', 'checkin', 'notes']));
      break;

    case 'addPerson':
      s.people.push({ id: op.id, name: str(op.name), coming: op.coming ?? null, adults: op.adults ?? 2, kids: op.kids ?? 0, veg: 0, weight: op.weight ?? 1, skip: [] });
      break;
    case 'updatePerson':
      Object.assign(find(s.people, op.id), pick(op.fields, ['name', 'coming', 'adults', 'kids', 'veg', 'weight', 'skip']));
      break;
    case 'removePerson':
      find(s.people, op.id);
      if (s.expenses.some(x => x.payer === op.id)) fail('יש הוצאות על שמם - מחקו או העבירו אותן קודם');
      s.people = s.people.filter(p => p.id !== op.id);
      clearPerson(op.id);
      break;

    case 'setBuyer':
      list(op.list);
      s.buyers[op.list] = op.person ?? null;
      break;

    case 'addItem':
      list(op.list).push({ id: op.id, name: str(op.name), qty: str(op.qty), note: '', lesson: '', who: null, done: false });
      break;
    case 'updateItem':
      Object.assign(find(list(op.list), op.id), pick(op.fields, ['name', 'qty', 'note', 'lesson', 'who', 'done']));
      break;
    case 'removeItem':
      find(list(op.list), op.id);
      s.lists[op.list] = s.lists[op.list].filter(it => it.id !== op.id);
      break;

    case 'addGear':
      if (!Object.hasOwn(GEAR_GROUPS, op.group)) fail('קבוצת ציוד לא מוכרת');
      s.gear.push({ id: op.id, group: op.group, name: str(op.name), note: '', who: op.who ?? null, done: false });
      break;
    case 'updateGear':
      Object.assign(find(s.gear, op.id), pick(op.fields, ['name', 'note', 'who', 'done']));
      break;
    case 'removeGear':
      find(s.gear, op.id);
      s.gear = s.gear.filter(g => g.id !== op.id);
      break;

    case 'addExpense':
      s.expenses.push({ id: op.id, payer: op.payer, amount: op.amount, what: str(op.what), cat: op.cat });
      break;
    case 'updateExpense':
      Object.assign(find(s.expenses, op.id), pick(op.fields, ['payer', 'amount', 'what', 'cat']));
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

    // Close this weekend and start the next one: same families, lists and gear
    // (with the lessons learned), nobody confirmed, nothing bought or assigned yet, no expenses.
    case 'newEvent': {
      const old = s.event;
      s.past.unshift({ id: old.id, title: old.title, date: old.date, place: old.place, total: total(s), families: payers(s).length });
      s.past = s.past.slice(0, LIMITS.past);
      s.event = { id: op.id, title: str(op.title), date: op.date ?? '', place: str(op.place), link: '', checkin: '', notes: '' };
      for (const k of LISTS) for (const it of s.lists[k]) { it.done = false; it.who = null; }
      for (const g of s.gear) { g.done = false; g.who = null; }
      for (const p of s.people) p.coming = null;
      s.buyers = Object.fromEntries(LISTS.map(k => [k, null]));
      s.expenses = [];
      s.paid = [];
      break;
    }

    default:
      fail('פעולה לא מוכרת');
  }
  if (!validState(s)) fail('הנתונים לא תקינים - בדקו שהשם לא ריק ושהסכום חיובי');
  return s;
}

// Families who said they're not coming drop out of the counts and the bill.
export const payers = s => s.people.filter(p => p.coming !== 'no');
export const coming = s => s.people.filter(p => p.coming === 'yes');
export const adults = s => coming(s).reduce((n, p) => n + p.adults, 0);
export const kids = s => coming(s).reduce((n, p) => n + p.kids, 0);
export const veg = s => coming(s).reduce((n, p) => n + p.veg, 0);
export const total = s => s.expenses.reduce((n, x) => n + x.amount, 0);

// Who owes what. Like the group always did it: each family pays an equal share,
// times its weight (e.g. ½ for someone coming alone), among the families that take
// part in that expense's category. All money is in agorot to avoid rounding drift.
export function settle(s) {
  const balance = Object.fromEntries(s.people.map(p => [p.id, 0]));
  const share = Object.fromEntries(s.people.map(p => [p.id, 0]));
  for (const x of s.expenses) {
    balance[x.payer] += x.amount;
    let members = payers(s).filter(p => !LISTS.includes(x.cat) || !p.skip.includes(x.cat));
    if (!members.length) members = payers(s);
    if (!members.length) members = s.people.filter(p => p.id === x.payer);
    // Weights are multiples of ½, so work in halves to keep everything in integers.
    const units = members.reduce((n, p) => n + p.weight * 2, 0);
    let left = x.amount;
    const parts = members.map(p => { const v = Math.floor(x.amount * p.weight * 2 / units); left -= v; return [p.id, v]; });
    for (let i = 0; left > 0; i = (i + 1) % parts.length, left--) parts[i][1]++;
    for (const [pid, v] of parts) { share[pid] += v; balance[pid] -= v; }
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
