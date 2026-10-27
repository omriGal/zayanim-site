import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, defaultState, validState, settle, total } from '../public/model.js';

function weekend() {
  let s = defaultState();
  const add = (id, name, size = 2) => { s = applyOp(s, { type: 'addPerson', id, name, size }); };
  add('dani', 'דני ומיכל');
  add('yossi', 'יוסי ורוני');
  add('avi', 'אבי', 1);
  return s;
}
const pay = (s, id, payer, amount, cat) => applyOp(s, { type: 'addExpense', id, payer, amount, what: 'קבלה', cat });

test('the starting template is valid', () => {
  assert(validState(defaultState()));
});

test('rejects bad data', () => {
  const s = weekend();
  assert.throws(() => applyOp(s, { type: 'addPerson', id: 'x', name: '  ', size: 2 }));
  assert.throws(() => applyOp(s, { type: 'addPerson', id: 'dani', name: 'כפול', size: 2 }), 'duplicate id');
  assert.throws(() => applyOp(s, { type: 'addPerson', id: 'y', name: 'שלושה', size: 3 }));
  assert.throws(() => pay(s, 'e1', 'nobody', 100, 'meat'), 'unknown payer');
  assert.throws(() => pay(s, 'e1', 'dani', -5, 'meat'));
  assert.throws(() => pay(s, 'e1', 'dani', 10.5, 'meat'), 'amounts are whole agorot');
  assert.throws(() => applyOp(s, { type: 'setBuyer', list: 'breakfast', person: 'dani' }));
  assert.throws(() => applyOp(s, { type: 'updateItem', list: 'meat', id: 'missing', fields: { done: true } }));
  assert.throws(() => applyOp(s, { type: 'hack' }));
  assert.throws(() => applyOp(s, { type: 'updatePerson', id: 'dani', fields: { size: 2, name: '' } }));
  assert(!validState({ ...s, extra: 1 }));
  assert.equal(applyOp(s, { type: 'updatePerson', id: 'dani', fields: { admin: true } }).people[0].admin, undefined, 'unknown fields ignored');
});

test('edits do not change the original state', () => {
  const s = weekend();
  const before = structuredClone(s);
  applyOp(s, { type: 'setBuyer', list: 'meat', person: 'dani' });
  assert.deepEqual(s, before);
});

test('removing a person clears their roles but refuses if they paid', () => {
  let s = weekend();
  s = applyOp(s, { type: 'setBuyer', list: 'alcohol', person: 'yossi' });
  s = applyOp(s, { type: 'updateGear', id: s.gear[0].id, fields: { who: 'yossi' } });
  const gone = applyOp(s, { type: 'removePerson', id: 'yossi' });
  assert.equal(gone.buyers.alcohol, null);
  assert.equal(gone.gear[0].who, null);
  assert.throws(() => applyOp(pay(s, 'e1', 'yossi', 100, 'meat'), { type: 'removePerson', id: 'yossi' }), /הוצאות/);
});

test('settlement splits by headcount and balances to zero', () => {
  let s = weekend(); // 2 + 2 + 1 = 5 people
  s = pay(s, 'e1', 'dani', 100000, 'meat');     // ₪1,000
  s = pay(s, 'e2', 'yossi', 50000, 'alcohol');  // ₪500
  const { share, balance, transfers } = settle(s);
  assert.equal(share.dani + share.yossi + share.avi, total(s));
  assert.equal(share.avi, 30000);     // 1/5 of ₪1,500
  assert.equal(share.dani, 60000);
  assert.equal(balance.dani, 40000);  // paid 1000, owes 600
  assert.equal(balance.yossi, -10000);
  assert.equal(balance.avi, -30000);
  assert.equal(Object.values(balance).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(transfers.map(t => [t.from, t.to, t.amount]), [['avi', 'dani', 30000], ['yossi', 'dani', 10000]]);
});

test('people who skip a category do not pay for it', () => {
  let s = weekend();
  s = applyOp(s, { type: 'updatePerson', id: 'avi', fields: { skip: ['alcohol'] } });
  s = pay(s, 'e1', 'dani', 40000, 'alcohol');
  s = pay(s, 'e2', 'dani', 5000, 'other');
  const { share } = settle(s);
  assert.equal(share.avi, 1000);              // only his fifth of "other"
  assert.equal(share.yossi, 20000 + 2000);
});

test('odd amounts still add up exactly', () => {
  let s = weekend();
  s = pay(s, 'e1', 'avi', 10001, 'general');
  const { share, balance } = settle(s);
  assert.equal(share.dani + share.yossi + share.avi, 10001);
  assert.equal(Object.values(balance).reduce((a, b) => a + b, 0), 0);
});

test('a new weekend keeps friends and lists, resets the rest', () => {
  let s = weekend();
  const item = s.lists.meat[0].id;
  s = applyOp(s, { type: 'updateItem', list: 'meat', id: item, fields: { done: true } });
  s = applyOp(s, { type: 'setBuyer', list: 'meat', person: 'dani' });
  s = pay(s, 'e1', 'dani', 12345, 'meat');
  const oldId = s.event.id;
  s = applyOp(s, { type: 'newEvent', id: 'next', title: 'חורף', date: '2027-01-15', place: 'גליל' });
  assert.equal(s.people.length, 3);
  assert.equal(s.lists.meat[0].done, false);
  assert.equal(s.buyers.meat, null);
  assert.equal(s.expenses.length, 0);
  assert.deepEqual(s.past[0], { id: oldId, title: 'סופ״ש צימרים', date: '', place: '', total: 12345, people: 5 });
  assert(validState(s));
});
