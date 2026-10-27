// Shared data model for the weekend: used by both the page and the server,
// so validation, edits and the settlement math are identical on both sides.

export const LISTS = ['meat', 'alcohol', 'general'];
export const CATEGORIES = [...LISTS, 'other'];
export const LIST_LABELS = { meat: 'בשר ומנגל', alcohol: 'אלכוהול', general: 'אוכל כללי וכלים' };
export const CATEGORY_LABELS = { ...LIST_LABELS, other: 'אחר' };

const LIMITS = { people: 60, items: 300, gear: 200, expenses: 300, past: 50 };
const MAX_AMOUNT = 10_000_000; // agorot = ₪100,000

const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (x, allowed) => plain(x) && Object.keys(x).every(k => allowed.includes(k));
const text = (x, max) => typeof x === 'string' && x.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
const name = (x, max = 120) => text(x, max) && x.trim().length > 0;
const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
const date = x => x === '' || (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x));
const amount = x => Number.isInteger(x) && x > 0 && x <= MAX_AMOUNT;

export function newId() {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}

const item = (n, qty = '') => ({ id: newId(), name: n, qty, note: '', done: false });

export function defaultState() {
  return {
    version: 3,
    event: { id: newId(), title: 'סופ״ש צימרים', date: '', place: '' },
    people: [],
    buyers: { meat: null, alcohol: null, general: null },
    lists: {
      meat: [
        item('אנטריקוט'), item('פרגיות'), item('קבב / המבורגרים'), item('נקניקיות'), item('כנפיים'),
        item('פחמים'), item('מדליק גחלים'), item('פיתות / לחמניות'), item('חומוס וטחינה'),
        item('סלטים למנגל'), item('ירקות לגריל'),
      ],
      alcohol: [
        item('בירות'), item('יין אדום'), item('יין לבן'), item('ערק'), item('וודקה'), item('וויסקי'),
        item('מיקסרים - טוניק, ספרייט, מיצים'), item('קרח'), item('לימונים'),
      ],
      general: [
        item('סודה ושתייה קלה'), item('מים'), item('חלב'), item('ביצים'), item('לחם'), item('גבינות'),
        item('ירקות לסלט'), item('פירות'), item('קפה, תה וסוכר'), item('חטיפים ונשנושים'),
        item('צלחות, כוסות וסכו״ם חד״פ'), item('מפיות ומגבות נייר'), item('שקיות זבל'), item('נייר כסף'),
      ],
    },
    gear: [
      { id: newId(), name: 'מנגל', who: null, done: false },
      { id: newId(), name: 'מלקחיים ומברשת למנגל', who: null, done: false },
      { id: newId(), name: 'צידנית', who: null, done: false },
      { id: newId(), name: 'רמקול', who: null, done: false },
      { id: newId(), name: 'סכין חדה וקרש חיתוך', who: null, done: false },
      { id: newId(), name: 'כבל מאריך', who: null, done: false },
      { id: newId(), name: 'משחקי קופסה / קלפים', who: null, done: false },
    ],
    expenses: [],
    paid: [],
    past: [],
  };
}

export function validState(s) {
  if (!onlyKeys(s, ['version', 'event', 'people', 'buyers', 'lists', 'gear', 'expenses', 'paid', 'past']) || s.version !== 3) return false;
  const e = s.event;
  if (!onlyKeys(e, ['id', 'title', 'date', 'place']) || !id(e.id) || !name(e.title) || !date(e.date) || !text(e.place, 120)) return false;

  if (!Array.isArray(s.people) || s.people.length > LIMITS.people) return false;
  const people = new Set();
  for (const p of s.people) {
    if (!onlyKeys(p, ['id', 'name', 'size', 'skip']) || !id(p.id) || people.has(p.id) || !name(p.name, 80)) return false;
    if (p.size !== 1 && p.size !== 2) return false;
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
      if (!onlyKeys(it, ['id', 'name', 'qty', 'note', 'done']) || !fresh(it.id) || !name(it.name) || !text(it.qty, 60) || !text(it.note, 300) || typeof it.done !== 'boolean') return false;
    }
  }

  if (!Array.isArray(s.gear) || s.gear.length > LIMITS.gear) return false;
  for (const g of s.gear) {
    if (!onlyKeys(g, ['id', 'name', 'who', 'done']) || !fresh(g.id) || !name(g.name) || !person(g.who) || typeof g.done !== 'boolean') return false;
  }

  if (!Array.isArray(s.expenses) || s.expenses.length > LIMITS.expenses) return false;
  for (const x of s.expenses) {
    if (!onlyKeys(x, ['id', 'payer', 'amount', 'what', 'cat']) || !fresh(x.id) || !people.has(x.payer) || !amount(x.amount) || !name(x.what) || !CATEGORIES.includes(x.cat)) return false;
  }

  if (!Array.isArray(s.paid) || s.paid.length > 500 || !s.paid.every(k => text(k, 200))) return false;

  if (!Array.isArray(s.past) || s.past.length > LIMITS.past) return false;
  for (const p of s.past) {
    if (!onlyKeys(p, ['id', 'title', 'date', 'place', 'total', 'people']) || !id(p.id) || !name(p.title) || !date(p.date) || !text(p.place, 120)) return false;
    if (!Number.isInteger(p.total) || p.total < 0 || !Number.isInteger(p.people) || p.people < 0) return false;
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

  switch (op?.type) {
    case 'setEvent':
      Object.assign(s.event, pick(op.fields, ['title', 'date', 'place']));
      break;

    case 'addPerson':
      s.people.push({ id: op.id, name: String(op.name ?? '').trim(), size: op.size, skip: [] });
      break;
    case 'updatePerson':
      Object.assign(find(s.people, op.id), pick(op.fields, ['name', 'size', 'skip']));
      break;
    case 'removePerson': {
      find(s.people, op.id);
      if (s.expenses.some(x => x.payer === op.id)) fail('יש הוצאות על שמם - מחקו או העבירו אותן קודם');
      s.people = s.people.filter(p => p.id !== op.id);
      for (const k of LISTS) if (s.buyers[k] === op.id) s.buyers[k] = null;
      for (const g of s.gear) if (g.who === op.id) g.who = null;
      break;
    }

    case 'setBuyer':
      list(op.list);
      s.buyers[op.list] = op.person ?? null;
      break;

    case 'addItem':
      list(op.list).push({ id: op.id, name: String(op.name ?? '').trim(), qty: String(op.qty ?? '').trim(), note: '', done: false });
      break;
    case 'updateItem':
      Object.assign(find(list(op.list), op.id), pick(op.fields, ['name', 'qty', 'note', 'done']));
      break;
    case 'removeItem':
      find(list(op.list), op.id);
      s.lists[op.list] = s.lists[op.list].filter(it => it.id !== op.id);
      break;

    case 'addGear':
      s.gear.push({ id: op.id, name: String(op.name ?? '').trim(), who: op.who ?? null, done: false });
      break;
    case 'updateGear':
      Object.assign(find(s.gear, op.id), pick(op.fields, ['name', 'who', 'done']));
      break;
    case 'removeGear':
      find(s.gear, op.id);
      s.gear = s.gear.filter(g => g.id !== op.id);
      break;

    case 'addExpense':
      s.expenses.push({ id: op.id, payer: op.payer, amount: op.amount, what: String(op.what ?? '').trim(), cat: op.cat });
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

    // Close this weekend and start the next one: same friends and lists,
    // nothing bought yet, no expenses. A summary of the old one stays in `past`.
    case 'newEvent': {
      const old = s.event;
      s.past.unshift({ id: old.id, title: old.title, date: old.date, place: old.place, total: total(s), people: headcount(s) });
      s.past = s.past.slice(0, LIMITS.past);
      s.event = { id: op.id, title: String(op.title ?? '').trim(), date: op.date ?? '', place: String(op.place ?? '').trim() };
      for (const k of LISTS) for (const it of s.lists[k]) it.done = false;
      for (const g of s.gear) { g.done = false; g.who = null; }
      s.buyers = { meat: null, alcohol: null, general: null };
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

export const headcount = s => s.people.reduce((n, p) => n + p.size, 0);
export const total = s => s.expenses.reduce((n, x) => n + x.amount, 0);

// Who owes what. Every expense is split by headcount between the people who
// take part in its category (couples count twice, singles once; "other" is
// shared by everyone). All money is in agorot to avoid rounding drift.
export function settle(s) {
  const balance = Object.fromEntries(s.people.map(p => [p.id, 0]));
  const share = Object.fromEntries(s.people.map(p => [p.id, 0]));
  for (const x of s.expenses) {
    balance[x.payer] += x.amount;
    let members = s.people.filter(p => x.cat === 'other' || !p.skip.includes(x.cat));
    if (!members.length) members = s.people;
    const units = members.reduce((n, p) => n + p.size, 0);
    // Split exactly: hand out the leftover agorot one by one so the shares add up to the expense.
    let left = x.amount;
    const parts = members.map(p => { const v = Math.floor(x.amount * p.size / units); left -= v; return [p.id, v]; });
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
