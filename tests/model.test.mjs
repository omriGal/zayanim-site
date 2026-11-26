import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, applyRootOp, defaultRoot, defaultState, migrate, validRoot, validState, view, nights, settle, total, expected, adults, kids } from '../public/model.js';

function weekend() {
  let s = defaultState();
  const add = (id, name, adults = 2) => { s = applyOp(s, { type: 'addPerson', id, name, adults }); };
  add('dani', 'דני ומיכל');
  add('yossi', 'יוסי ורוני');
  add('levi', 'משפחת לוי');
  return s;
}
const pay = (s, id, payer, amount, cat) => applyOp(s, { type: 'addExpense', id, payer, amount, what: 'קבלה', cat });

test('the starting template is valid and has the next weekend', () => {
  const s = defaultState();
  assert(validState(s));
  assert.equal(s.event.date, '2027-05-20');
  assert.deepEqual(Object.keys(s.lists), ['meat', 'alcohol', 'general', 'breakfast', 'dinner']);
  assert(s.lists.breakfast.some(i => i.name === 'ביצים'));
});

test('rejects bad data', () => {
  const s = weekend();
  assert.throws(() => applyOp(s, { type: 'addPerson', id: 'x', name: '  ' }));
  assert.throws(() => applyOp(s, { type: 'addPerson', id: 'dani', name: 'כפול' }), 'duplicate id');
  assert.throws(() => applyOp(s, { type: 'addPerson', id: 'y', name: 'אף אחד', adults: 0 }));
  assert.throws(() => applyOp(s, { type: 'addExpense', id: 'e9', payer: 'dani', amount: 100, what: 'x', cat: 'other', for: 'nobody' }), 'unknown family');
  assert.throws(() => applyOp(s, { type: 'updatePerson', id: 'dani', fields: { veg: 3 } }), 'more vegetarians than people');
  assert.throws(() => pay(s, 'e1', 'nobody', 100, 'meat'), 'unknown payer');
  assert.throws(() => pay(s, 'e1', 'dani', -5, 'meat'));
  assert.throws(() => pay(s, 'e1', 'dani', 10.5, 'meat'), 'amounts are whole agorot');
  assert.throws(() => applyOp(s, { type: 'setBuyer', list: 'nope', person: 'dani' }));
  assert.throws(() => applyOp(s, { type: 'setNotes', section: 'toString', text: 'x' }));
  assert.throws(() => applyOp(s, { type: 'updatePerson', id: 'dani', fields: { phone: 'call me' } }));
  assert.throws(() => applyOp(s, { type: 'setEvent', fields: { link: 'javascript:alert(1)' } }));
  assert.throws(() => applyOp(s, { type: 'updateItem', list: 'meat', id: 'missing', fields: { done: true } }));
  assert.throws(() => applyOp(s, { type: 'hack' }));
  assert(!validState({ ...s, extra: 1 }));
  assert.equal(applyOp(s, { type: 'updatePerson', id: 'dani', fields: { admin: true } }).people[0].admin, undefined, 'unknown fields ignored');
});

test('edits do not change the original state', () => {
  const s = weekend();
  const before = structuredClone(s);
  applyOp(s, { type: 'setBuyer', list: 'meat', person: 'dani' });
  assert.deepEqual(s, before);
});

test('families who are not coming drop out of the counts and the bill', () => {
  let s = weekend();
  s = applyOp(s, { type: 'updatePerson', id: 'dani', fields: { coming: 'yes', kids: 2 } });
  s = applyOp(s, { type: 'updatePerson', id: 'yossi', fields: { coming: 'no' } });
  assert.equal(adults(s), 2);       // only confirmed families count toward quantities
  assert.equal(kids(s), 2);
  s = pay(s, 'e1', 'dani', 30000, 'meat');
  const { share } = settle(s);
  assert.equal(share.yossi, 0);
  assert.equal(share.dani, 15000);   // ₪300 over dani and levi (levi hasn't answered, so still pays)
  assert.throws(() => applyOp(s, { type: 'updatePerson', id: 'dani', fields: { coming: 'maybe' } }));
});



test('each section keeps free-text notes, and families a phone number', () => {
  let s = weekend();
  assert(s.notes.meat.includes('מנגל אחד לא הספיק'));
  s = applyOp(s, { type: 'setNotes', section: 'gear', text: '  רמקול!\nמשחקים לילדים  ' });
  assert.equal(s.notes.gear, 'רמקול!\nמשחקים לילדים');
  s = applyOp(s, { type: 'updatePerson', id: 'dani', fields: { phone: '050-1234567' } });
  assert.equal(s.people[0].phone, '050-1234567');
});

test('removing a family clears everything assigned to it but refuses if they paid', () => {
  let s = weekend();
  s = applyOp(s, { type: 'setBuyer', list: 'alcohol', person: 'yossi' });
  s = applyOp(s, { type: 'updateGear', id: s.gear[0].id, fields: { who: 'yossi' } });
  s = applyOp(s, { type: 'updateItem', list: 'meat', id: s.lists.meat[0].id, fields: { who: 'yossi' } });
  const gone = applyOp(s, { type: 'removePerson', id: 'yossi' });
  assert.equal(gone.buyers.alcohol, null);
  assert.equal(gone.gear[0].who, null);
  assert.equal(gone.lists.meat[0].who, null);
  assert.throws(() => applyOp(pay(s, 'e1', 'yossi', 100, 'meat'), { type: 'removePerson', id: 'yossi' }), /הוצאות/);
});

test('settlement splits every expense equally between families and balances to zero', () => {
  let s = weekend();
  s = pay(s, 'e1', 'dani', 90000, 'meat');     // ₪900
  s = pay(s, 'e2', 'yossi', 30000, 'alcohol'); // ₪300
  const { share, balance, transfers } = settle(s);
  assert.deepEqual(share, { dani: 40000, yossi: 40000, levi: 40000 });
  assert.equal(balance.dani, 50000);
  assert.equal(balance.yossi, -10000);
  assert.equal(Object.values(balance).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(transfers.map(t => [t.from, t.to, t.amount]), [['levi', 'dani', 40000], ['yossi', 'dani', 10000]]);
});

test('an expense for one family only is carried by that family', () => {
  let s = weekend();
  // The zimmer: ₪1,000 a night per unit, the Levi unit ₪1,300; dani paid it all for 2 nights.
  s = pay(s, 'e1', 'dani', 600000, 'lodging');
  s = applyOp(s, { type: 'addExpense', id: 'e2', payer: 'dani', amount: 60000, what: 'תוספת ליחידה', cat: 'lodging', for: 'levi' });
  const { share } = settle(s);
  assert.equal(share.levi, 200000 + 60000);
  assert.equal(share.yossi, 200000);
  assert.throws(() => applyOp(s, { type: 'removePerson', id: 'levi' }), /הוצאות/);
});

test('odd amounts still add up exactly', () => {
  let s = weekend();
  s = pay(s, 'e1', 'levi', 10001, 'general');
  const { share, balance } = settle(s);
  assert.equal(share.dani + share.yossi + share.levi, 10001);
  assert.equal(Object.values(balance).reduce((a, b) => a + b, 0), 0);
});


test('events share families but keep their own answers, sizes, roles and money', () => {
  let r = defaultRoot();
  const may = r.events[0].event.id;
  r = applyRootOp(r, { type: 'addPerson', event: may, id: 'dani', name: 'דני ומיכל', kids: 2 });
  r = applyRootOp(r, { type: 'addEvent', id: 'dec', kind: 'camping', title: 'קמפינג אבות וילדים', date: '2026-12-25', end: '2026-12-26' });
  const camp = view(r, 'dec');
  assert.equal(camp.people[0].name, 'דני ומיכל');
  assert.equal(camp.people[0].adults, 1, 'dads and kids: one adult to start');
  assert.equal(camp.people[0].kids, 2);
  assert(camp.gear.some(g => g.name === 'אוהלים'));
  assert.equal(nights(camp.event), 1);
  r = applyRootOp(r, { type: 'updatePerson', event: 'dec', id: 'dani', fields: { coming: 'yes', phone: '050-1234567' } });
  r = applyRootOp(r, { type: 'setBuyer', event: 'dec', list: 'meat', person: 'dani' });
  assert.equal(view(r, may).people[0].coming, null, 'answers are per event');
  assert.equal(view(r, may).people[0].adults, 2);
  assert.equal(view(r, may).people[0].phone, '050-1234567', 'contact details are shared');
  assert.equal(view(r, may).buyers.meat, null);
  assert(validRoot(r));
});

test('removing a family takes it out of every event, unless it has expenses somewhere', () => {
  let r = defaultRoot();
  const may = r.events[0].event.id;
  r = applyRootOp(r, { type: 'addPerson', event: may, id: 'dani', name: 'דני' });
  r = applyRootOp(r, { type: 'addEvent', id: 'dec', kind: 'camping', title: 'קמפינג', date: '2026-12-25', end: '2026-12-26' });
  r = applyRootOp(r, { type: 'updateGear', event: 'dec', id: view(r, 'dec').gear[0].id, fields: { who: 'dani' } });
  const paid = applyRootOp(r, { type: 'addExpense', event: 'dec', id: 'x', payer: 'dani', amount: 100, what: 'גז', cat: 'other' });
  assert.throws(() => applyRootOp(paid, { type: 'removePerson', event: may, id: 'dani' }), /קמפינג/);
  r = applyRootOp(r, { type: 'removePerson', event: may, id: 'dani' });
  assert.equal(r.people.length, 0);
  assert.equal(view(r, 'dec').gear[0].who, null);
  assert(validRoot(r));
});

test('known costs can be entered before anyone pays; transfers only count what was paid', () => {
  let s = weekend();
  s = applyOp(s, { type: 'addExpense', id: 'z', payer: null, amount: 2200000, what: 'הצימר', calc: '₪1,000 × 11 יחידות × 2 לילות', cat: 'lodging' });
  s = pay(s, 'm', 'dani', 90000, 'meat');
  assert.equal(expected(s), 2290000);
  assert.equal(total(s), 90000);
  const { share, balance, transfers } = settle(s);
  assert.equal(share.levi, Math.round(2290000 / 3));
  assert.equal(balance.dani, 60000);
  assert.equal(transfers.reduce((n, t) => n + t.amount, 0), 60000);
});

test('a single-weekend save from before becomes the first event, old fields and all', () => {
  const old = defaultState();
  old.event = { ...old.event }; delete old.event.end; delete old.event.kind;
  for (const g of old.gear) delete g.skipped;
  old.people.push({ id: 'old', name: 'ישנים', phone: '', coming: 'no', adults: 2, kids: 1, veg: 0, weight: 1, skip: [] });
  old.expenses.push({ id: 'e1', payer: 'old', amount: 100, what: 'x', cat: 'other' });
  const r = migrate({ ...old, version: 5, past: [] });
  assert(validRoot(r));
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].event.end, '2027-05-22');
  assert.deepEqual(r.events[0].attend.old, { coming: 'no', adults: 2, kids: 1, veg: 0 });
  assert.equal(r.events[0].expenses[0].for, null);
});
