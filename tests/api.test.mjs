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
  return { prod, testStore, call };
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
  assert.equal(a.state.lists.meat[0].id, b.state.lists.meat[0].id);
  assert.equal(a.revision, b.revision);
});

test('writes from another site are refused', async () => {
  const { call } = harness();
  const r = await call('POST', { ops: [{ type: 'setEvent', fields: { title: 'x' } }] }, { Origin: 'https://evil.test' });
  assert.equal(r.status, 403);
});

test('two people editing at once both keep their changes', async () => {
  const { call } = harness();
  const { state } = await (await call()).json();
  const [a, b] = await Promise.all([
    call('POST', { ops: [{ type: 'addPerson', id: 'p1', name: 'דני', size: 2 }] }),
    call('POST', { ops: [{ type: 'updateItem', list: 'meat', id: state.lists.meat[0].id, fields: { done: true } }] }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const after = (await (await call()).json()).state;
  assert.equal(after.people[0].name, 'דני');
  assert.equal(after.lists.meat[0].done, true);
});

test('an edit that no longer applies is reported with its position, nothing saved', async () => {
  const { call } = harness();
  const r = await call('POST', { ops: [
    { type: 'addPerson', id: 'p1', name: 'דני', size: 2 },
    { type: 'removeItem', list: 'meat', id: 'already-gone' },
  ] });
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.index, 1);
  assert.equal(body.state.people.length, 0);
  assert.equal((await (await call()).json()).state.people.length, 0);
});

test('the test namespace is separate from the real list', async () => {
  const { call, prod } = harness();
  await call('POST', { ops: [{ type: 'addPerson', id: 'p1', name: 'טסט', size: 1 }] }, {}, '?test=1');
  assert.equal(prod.map.size, 0);
  assert.equal((await call('GET', undefined, {}, '?bad=1')).status, 400);
});

test('previous versions are kept', async () => {
  const { call, prod } = harness();
  await call();
  await call('POST', { ops: [{ type: 'setEvent', fields: { title: 'קיץ' } }] });
  assert([...prod.map.keys()].some(k => k.startsWith('history/')));
});

test('large or malformed bodies are refused', async () => {
  const { call } = harness();
  assert.equal((await call('POST', { ops: [] })).status, 400);
  assert.equal((await call('POST', { ops: Array(51).fill({ type: 'setEvent', fields: {} }) })).status, 400);
  assert.equal((await call('POST', { ops: [{ type: 'setEvent', fields: { title: 'x'.repeat(60000) } }] })).status, 413);
});
