import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makePhotoHandler, PHOTOS } from '../lib/photos.mjs';

const code = 'TEST-ONLY-012345678901234567890123';
const env = { EDIT_CODE_SHA256: createHash('sha256').update(code).digest('hex') };
const get = (name, secret = code) => makePhotoHandler({ env })(new Request('https://camp.test/api/photo?name=' + name, { headers: { 'X-Edit-Code': secret } }));

test('photos need the group code', async () => {
  assert.equal((await get('grill', 'wrong-code-wrong-code-wrong')).status, 401);
  assert.equal((await get('grill', '')).status, 401);
});

test('every listed photo is in the repo', async () => {
  for (const name of PHOTOS) {
    const r = await get(name);
    assert.equal(r.status, 200, name);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
  }
});

test('photos can be uploaded with the code, only as JPEG from the same site', async () => {
  const saved = new Map();
  const handler = makePhotoHandler({ env, store: { get: async n => saved.get(n) ?? null, set: async (n, b) => { saved.set(n, b); } } });
  const post = (headers, body = Buffer.from([0xff, 0xd8, 0xff, 0xe0])) => handler(new Request('https://camp.test/api/photo?name=grill', { method: 'POST', headers: { 'X-Edit-Code': code, 'Content-Type': 'image/jpeg', Origin: 'https://camp.test', ...headers }, body }));
  assert.equal((await post({ 'X-Edit-Code': 'wrong-code-wrong-code-wrong' })).status, 401);
  assert.equal((await post({ Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post({ 'Content-Type': 'text/html' })).status, 415);
  assert.equal((await post({}, Buffer.from('<html>'))).status, 400);
  assert.equal((await post({})).status, 204);
  const r = await handler(new Request('https://camp.test/api/photo?name=grill', { headers: { 'X-Edit-Code': code } }));
  assert.equal(r.status, 200);
});

test('only listed names are served', async () => {
  assert.equal((await get('../package')).status, 404);
  assert.equal((await get('nobody')).status, 404);
});
