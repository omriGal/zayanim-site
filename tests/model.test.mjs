import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, defaultState, validState, settle, total, adults, kids, LESSONS } from '../public/model.js';

function weekend() {
  let s = defaultState();
  const add = (id, name, adults = 2, weight = 1) => { s = applyOp(s, { type: 'addPerson', id, name, adults, weight }); };
  add('dani', 'דני ומיכל');
  add('yossi', 'יוסי ורוני');
  add('avi', 'אבי', 1, 0.5);
  return s;
}
const pay = (s, id, payer, amount, cat) => applyOp(s, { type: 'addExpense', id, payer, amount, what: 'קבלה', cat });

test('the starting template is valid and has the next weekend', () => {
  const s = defaultState();
  assert(validState(s));
  assert.equal(s.event.date, '2027-05-20');
  assert.deepEqual(Object.keys(s.lists), ['meat', 'alcohol', 'general', 'breakfast']);
  assert(s.lists.breakfast.some(i => i.name === 'ביצים'));
});

test('rejects bad data', () => {
  const s = weekend();
  assert.throws(() => applyOp(s, { type: 'addPerson', id: 'x', name: '  ' }));
  assert.throws(() => applyOp(s, { type: 'addPerson', id: 'dani', name: 'כפול' }), 'duplicate id');
  assert.throws(() => applyOp(s, { type: 'addPerson', id: 'y', name: 'אף אחד', adults: 0 }));
  assert.throws(() => applyOp(s, { type: 'updatePerson', id: 'dani', fields: { weight: 0.7 } }));
  assert.throws(() => applyOp(s, { type: 'updatePerson', id: 'dani', fields: { veg: 3 } }), 'more vegetarians than people');
  assert.throws(() => pay(s, 'e1', 'nobody', 100, 'meat'), 'unknown payer');
  assert.throws(() => pay(s, 'e1', 'dani', -5, 'meat'));
  assert.throws(() => pay(s, 'e1', 'dani', 10.5, 'meat'), 'amounts are whole agorot');
  assert.throws(() => applyOp(s, { type: 'setBuyer', list: 'nope', person: 'dani' }));
  assert.throws(() => applyOp(s, { type: 'addGear', id: 'g', group: 'toString', name: 'x' }));
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
  assert.equal(share.dani, 20000);   // ₪300 over weights 1 + ½ (avi hasn't answered, so still pays)
  assert.throws(() => applyOp(s, { type: 'updatePerson', id: 'dani', fields: { coming: 'maybe' } }));
});

test('lessons are kept per item', () => {
  let s = weekend();
  const id = s.lists.alcohol[0].id;
  s = applyOp(s, { type: 'updateItem', list: 'alcohol', id, fields: { lesson: LESSONS.extra } });
  assert.equal(s.lists.alcohol[0].lesson, 'היה יותר מדי');
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

test('settlement splits equally per family, by weight, and balances to zero', () => {
  let s = weekend(); // weights 1 + 1 + ½ = 2.5
  s = pay(s, 'e1', 'dani', 100000, 'meat');     // ₪1,000
  s = pay(s, 'e2', 'yossi', 50000, 'alcohol');  // ₪500
  const { share, balance, transfers } = settle(s);
  assert.equal(share.dani + share.yossi + share.avi, total(s));
  assert.equal(share.dani, 60000);    // 1/2.5 of ₪1,500
  assert.equal(share.avi, 30000);     // half a family
  assert.equal(balance.dani, 40000);
  assert.equal(balance.yossi, -10000);
  assert.equal(Object.values(balance).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(transfers.map(t => [t.from, t.to, t.amount]), [['avi', 'dani', 30000], ['yossi', 'dani', 10000]]);
});

test('families who skip a category do not pay for it; lodging is shared by all', () => {
  let s = weekend();
  s = applyOp(s, { type: 'updatePerson', id: 'avi', fields: { skip: ['alcohol'] } });
  s = pay(s, 'e1', 'dani', 40000, 'alcohol');
  s = pay(s, 'e2', 'dani', 25000, 'lodging');
  const { share } = settle(s);
  assert.equal(share.avi, 5000);              // only his half-share of the zimmer
  assert.equal(share.yossi, 20000 + 10000);
});

test('odd amounts still add up exactly', () => {
  let s = weekend();
  s = pay(s, 'e1', 'avi', 10001, 'general');
  const { share, balance } = settle(s);
  assert.equal(share.dani + share.yossi + share.avi, 10001);
  assert.equal(Object.values(balance).reduce((a, b) => a + b, 0), 0);
});

test('a new weekend keeps families, lists and lessons, resets the rest', () => {
  let s = weekend();
  const item = s.lists.meat[0].id;
  s = applyOp(s, { type: 'updateItem', list: 'meat', id: item, fields: { done: true, who: 'dani', lesson: 'היה חסר' } });
  s = applyOp(s, { type: 'updatePerson', id: 'dani', fields: { coming: 'yes' } });
  s = applyOp(s, { type: 'setBuyer', list: 'meat', person: 'dani' });
  s = pay(s, 'e1', 'dani', 12345, 'meat');
  const oldId = s.event.id;
  s = applyOp(s, { type: 'newEvent', id: 'next', title: 'חורף', date: '2027-12-16', place: 'גליל' });
  assert.equal(s.people.length, 3);
  assert.equal(s.lists.meat[0].done, false);
  assert.equal(s.lists.meat[0].who, null);
  assert.equal(s.lists.meat[0].lesson, 'היה חסר');
  assert.equal(s.people[0].coming, null);
  assert.equal(s.buyers.meat, null);
  assert.equal(s.expenses.length, 0);
  assert.deepEqual(s.past[0], { id: oldId, title: 'זיינים וזיינות - מאי 2027', date: '2027-05-20', place: 'טרה קוטה', total: 12345, families: 3 });
  assert(validState(s));
});
