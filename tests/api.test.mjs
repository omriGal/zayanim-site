import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeHandler } from '../lib/api.mjs';
import { MemoryStore } from './memory-store.mjs';

const code = 'TEST-ONLY-012345678901234567890123';
const env = { SYNC_ENABLED: 'true', EDIT_CODE_SHA256: createHash('sha256').update(code).digest('hex') };

function harness() {
  const prod = new MemoryStore(), testStore = new MemoryStore();
  const handler = makeHandler({ storeFor: t => t ? testStore : prod, env });
  const call = (method = 'GET', body, headers = {}, suffix = '') => handler(new Request('https://camp.test/api/list' + suffix, {
    method,
    headers: { 'X-Edit-Code': code, ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: 'https://camp.test' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
  // The first (and at the start, only) event.
  const first = async () => (await (await call()).json()).state.events[0];
  return { prod, testStore, call, first };
}

test('reading and writing need the group code', async () => {
  const { call } = harness();
  assert.equal((await call('GET', undefined, { 'X-Edit-Code': 'wrong-code-wrong-code-wrong' })).status, 401);
  assert.equal((await call('GET', undefined, { 'X-Edit-Code': '' })).status, 401);
  assert.equal((await call('POST', { ops: [{ type: 'setEvent', fields: { title: 'x' } }] }, { 'X-Edit-Code': 'nope' })).status, 401);
  assert.equal((await call('GET')).status, 200);
});

test('first read saves the template so every device sees the same ids', async () => {
  const { call } = harness();
  const a = await (await call()).json();
  const b = await (await call()).json();
  assert.equal(a.state.events[0].lists.meat[0].id, b.state.events[0].lists.meat[0].id);
  assert.equal(a.revision, b.revision);
});

test('a single-weekend save from before is moved into the first event', async () => {
  const { call, prod } = harness();
  const old = { version: 5, event: { id: 'may', title: 'מאי', date: '2027-05-20', place: 'צימר', link: '', checkin: '', notes: 'x' },
    people: [{ id: 'p1', name: 'דני', phone: '', coming: 'yes', adults: 2, kids: 1, veg: 0 }],
    buyers: { meat: 'p1', alcohol: null, general: null, breakfast: null }, lists: { meat: [], alcohol: [], general: [], breakfast: [] },
    gear: [], notes: { meat: '', alcohol: '', general: '', breakfast: '', gear: '' }, expenses: [], paid: [], past: [] };
  await prod.setJSON('weekend-v5', { state: old });
  const { state } = await (await call()).json();
  assert.equal(state.version, 6);
  assert.equal(state.people[0].name, 'דני');
  assert.equal(state.events[0].event.end, '2027-05-22');
  assert.deepEqual(state.events[0].attend.p1, { coming: 'yes', adults: 2, kids: 1, veg: 0 });
  assert.equal(state.events[0].buyers.meat, 'p1');
});

test('writes from another site are refused', async () => {
  const { call } = harness();
  const r = await call('POST', { ops: [{ type: 'setEvent', fields: { title: 'x' } }] }, { Origin: 'https://evil.test' });
  assert.equal(r.status, 403);
});

test('two people editing at once both keep their changes', async () => {
  const { call, first } = harness();
  const e = await first();
  const [a, b] = await Promise.all([
    call('POST', { ops: [{ type: 'addPerson', event: e.event.id, id: 'p1', name: 'דני' }] }),
    call('POST', { ops: [{ type: 'updateItem', event: e.event.id, list: 'meat', id: e.lists.meat[0].id, fields: { done: true } }] }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const after = (await (await call()).json()).state;
  assert.equal(after.people[0].name, 'דני');
  assert.equal(after.events[0].lists.meat[0].done, true);
});

test('an edit that no longer applies is reported with its position, nothing saved', async () => {
  const { call, first } = harness();
  const id = (await first()).event.id;
  const r = await call('POST', { ops: [
    { type: 'addPerson', event: id, id: 'p1', name: 'דני' },
    { type: 'removeItem', event: id, list: 'meat', id: 'already-gone' },
  ] });
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.index, 1);
  assert.equal(body.state.people.length, 0);
  assert.equal((await (await call()).json()).state.people.length, 0);
});

test('the test namespace is separate from the real list', async () => {
  const { call, prod } = harness();
  const { state } = await (await call('GET', undefined, {}, '?test=1')).json();
  await call('POST', { ops: [{ type: 'addPerson', event: state.events[0].event.id, id: 'p1', name: 'טסט', adults: 1 }] }, {}, '?test=1');
  assert.equal(prod.map.size, 0);
  assert.equal((await call('GET', undefined, {}, '?bad=1')).status, 400);
});

test('previous versions are kept', async () => {
  const { call, prod, first } = harness();
  const id = (await first()).event.id;
  await call('POST', { ops: [{ type: 'setEvent', event: id, fields: { title: 'קיץ' } }] });
  assert([...prod.map.keys()].some(k => k.startsWith('history/')));
});

test('large or malformed bodies are refused', async () => {
  const { call } = harness();
  assert.equal((await call('POST', { ops: [] })).status, 400);
  assert.equal((await call('POST', { ops: Array(51).fill({ type: 'setEvent', fields: {} }) })).status, 400);
  assert.equal((await call('POST', { ops: [{ type: 'setEvent', fields: { title: 'x'.repeat(60000) } }] })).status, 413);
});
