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

test('only listed names are served', async () => {
  assert.equal((await get('../package')).status, 404);
  assert.equal((await get('nobody')).status, 404);
});
