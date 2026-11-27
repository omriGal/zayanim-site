import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRootOp, defaultRoot, scaleQty, suggestList, portions, view } from '../public/model.js';

test('quantities scale every number and leave words alone', () => {
  assert.equal(scaleQty('25', 1.2), '30');
  assert.equal(scaleQty('10 / 4 / 10', 1.2), '12 / 5 / 12');
  assert.equal(scaleQty('1.5 ק״ג', 1.3), '2 ק״ג');
  assert.equal(scaleQty('500 גר׳', 1.13), '550 גר׳');
  assert.equal(scaleQty('שישיות', 2), 'שישיות');
  assert.equal(scaleQty('1', 0.2), '1');
});

test('the next event gets the last one scaled by headcount and by what ran out', () => {
  let r = defaultRoot();
  const next = r.events[0].event.id;
  r = applyRootOp(r, { type: 'addEvent', id: 'sep', kind: 'zimmer', title: 'ספטמבר', date: '2026-09-17', end: '2026-09-19' });
  r = applyRootOp(r, { type: 'setEvent', event: 'sep', fields: { adults: 20, kids: 20 } });
  assert.equal(portions(view(r, 'sep')), 30);
  const milk = r.events[1].lists.breakfast.find(i => i.name === 'חלב');
  r = applyRootOp(r, { type: 'updateItem', event: 'sep', list: 'breakfast', id: milk.id, fields: { qty: '5', fb: 'short' } });
  r = applyRootOp(r, { type: 'addItem', event: 'sep', list: 'breakfast', id: 'yog', name: 'יוגורטים', qty: '12' });
  r = applyRootOp(r, { type: 'addPerson', event: next, id: 'a', name: 'א', adults: 2, coming: 'yes' });
  r = applyRootOp(r, { type: 'updatePerson', event: next, id: 'a', fields: { kids: 2 } });
  const g = suggestList(r, next, 'breakfast');
  assert.equal(g.from.id, 'sep');
  assert.equal(g.portions, 3);
  assert.equal(g.items.find(i => i.name === 'חלב').qty, '1'); // 5 × 0.1 × 1.3 → at least 1
  assert.equal(g.items.find(i => i.name === 'יוגורטים').existing, null);
  // a later event is never the source for an earlier one
  assert.equal(suggestList(r, 'sep', 'breakfast'), null);
  // an event that hasn't happened yet is never the source, and the same kind comes first
  r = applyRootOp(r, { type: 'addEvent', id: 'dec', kind: 'camping', title: 'דצמבר', date: '2026-12-25', end: '2026-12-26' });
  r = applyRootOp(r, { type: 'setEvent', event: 'dec', fields: { adults: 10, kids: 20 } });
  assert.equal(suggestList(r, next, 'breakfast', '2026-11-27').from.id, 'sep');
  assert.equal(suggestList(r, next, 'breakfast', '2027-01-01').from.id, 'sep');
});

test('feedback only takes the known values', () => {
  const r = defaultRoot();
  const e = r.events[0].event.id, it = r.events[0].lists.meat[0].id;
  assert.equal(applyRootOp(r, { type: 'updateItem', event: e, list: 'meat', id: it, fields: { fb: 'over' } }).events[0].lists.meat[0].fb, 'over');
  assert.throws(() => applyRootOp(r, { type: 'updateItem', event: e, list: 'meat', id: it, fields: { fb: 'lots' } }));
});

test('a wine we did not like shows up as such before the next event', async () => {
  const { verdicts } = await import('../public/model.js');
  let r = defaultRoot();
  const next = r.events[0].event.id;
  r = applyRootOp(r, { type: 'addEvent', id: 'sep', kind: 'zimmer', title: 'ספטמבר', date: '2026-09-17', end: '2026-09-19' });
  r = applyRootOp(r, { type: 'addItem', event: 'sep', list: 'alcohol', id: 'w1', name: 'אוז שיראז', qty: '1' });
  r = applyRootOp(r, { type: 'updateItem', event: 'sep', list: 'alcohol', id: 'w1', fields: { liked: 'no' } });
  assert.deepEqual(verdicts(r, next, 'alcohol', '2026-11-27').get('אוז שיראז'), { liked: 'no', title: 'ספטמבר' });
  assert.equal(verdicts(r, 'sep', 'alcohol', '2026-11-27').size, 0);
  assert.throws(() => applyRootOp(r, { type: 'updateItem', event: 'sep', list: 'alcohol', id: 'w1', fields: { liked: 'meh' } }));
});
