import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeHandler } from '../lib/api.mjs';
import { makeSession, sessionEmail } from '../lib/auth.mjs';
import { makePhotoHandler } from '../lib/photos.mjs';
import { MemoryStore } from './memory-store.mjs';

const code = 'TEST-ONLY-012345678901234567890123';
const env = { SYNC_ENABLED: 'true', EDIT_CODE_SHA256: createHash('sha256').update(code).digest('hex'), GOOGLE_CLIENT_ID: 'client-1.apps.googleusercontent.com' };

// Stands in for Google's tokeninfo: the "credential" is the token's JSON itself.
const fakeGoogle = async url => {
  const t = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('id_token')));
  return t.bad ? new Response('{}', { status: 400 }) : Response.json(t);
};
const token = (over = {}) => JSON.stringify({ aud: env.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), email: 'Dani@Example.com', email_verified: 'true', nonce: 'n1', ...over });

function harness() {
  const handler = makeHandler({ storeFor: () => store, env, fetchImpl: fakeGoogle });
  const store = new MemoryStore();
  const req = (path, method, headers = {}, body) => handler(new Request('https://camp.test' + path, {
    method, headers: { Origin: 'https://camp.test', 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  const withCode = (method, body) => req('/api/list', method, { 'X-Edit-Code': code }, body);
  const signIn = (credential, nonce = 'n1') => req('/api/login', 'POST', {}, { credential, nonce });
  return { req, withCode, signIn };
}

async function withDani(h) {
  const { state } = await (await h.withCode('GET')).json();
  await h.withCode('POST', { ops: [
    { type: 'addPerson', event: state.events[0].event.id, id: 'p1', name: 'דני' },
    { type: 'updatePerson', event: state.events[0].event.id, id: 'p1', fields: { email: 'dani@example.com' } },
  ] });
}

test('the page learns whether Google sign-in is set up', async () => {
  const { req } = harness();
  assert.deepEqual(await (await req('/api/login', 'GET')).json(), { clientId: env.GOOGLE_CLIENT_ID });
});

test('a family member signs in with Google and can then read and write', async () => {
  const h = harness();
  await withDani(h);
  const r = await h.signIn(token());
  assert.equal(r.status, 200);
  const { session, email } = await r.json();
  assert.equal(email, 'dani@example.com');
  const list = await h.req('/api/list', 'GET', { 'X-Session': session });
  assert.equal(list.status, 200);
  const { state } = await list.json();
  const w = await h.req('/api/list', 'POST', { 'X-Session': session }, { ops: [{ type: 'setEvent', event: state.events[0].event.id, fields: { title: 'x' } }] });
  assert.equal(w.status, 200);
});

test('an email that is not on any family is refused', async () => {
  const h = harness();
  await withDani(h);
  assert.equal((await h.signIn(token({ email: 'stranger@example.com' }))).status, 403);
});

test('a token for another site, another attempt, unverified or rejected by Google is refused', async () => {
  const h = harness();
  await withDani(h);
  assert.equal((await h.signIn(token({ aud: 'other-app' }))).status, 401);
  assert.equal((await h.signIn(token(), 'other-nonce')).status, 401);
  assert.equal((await h.signIn(token({ email_verified: 'false' }))).status, 401);
  assert.equal((await h.signIn(token({ exp: '1' }))).status, 401);
  assert.equal((await h.signIn(token({ bad: true }))).status, 401);
  assert.equal((await h.req('/api/login', 'POST', { Origin: 'https://evil.test' }, { credential: token(), nonce: 'n1' })).status, 403);
});

test('a forged or expired session does not get in, and removing the family locks it out', async () => {
  const h = harness();
  await withDani(h);
  const session = makeSession('dani@example.com', env);
  assert.equal((await h.req('/api/list', 'GET', { 'X-Session': session.slice(0, -2) + 'xx' })).status, 401);
  assert.equal(sessionEmail(makeSession('dani@example.com', env, Date.now() - 200 * 86_400_000), env), null);
  assert.equal(sessionEmail(session, { EDIT_CODE_SHA256: 'f'.repeat(64) }), null);
  const { state } = await (await h.withCode('GET')).json();
  await h.withCode('POST', { ops: [{ type: 'updatePerson', event: state.events[0].event.id, id: 'p1', fields: { email: '' } }] });
  assert.equal((await h.req('/api/list', 'GET', { 'X-Session': session })).status, 401);
});

test('photos accept a session too', async () => {
  const get = headers => makePhotoHandler({ env })(new Request('https://camp.test/api/photo?name=grill', { headers }));
  assert.equal((await get({ 'X-Session': makeSession('dani@example.com', env) })).status, 200);
  assert.equal((await get({ 'X-Session': 'nope.nope' })).status, 401);
});
