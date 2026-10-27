// Adds the group from people.local.json (git-ignored: names stay out of the public repo).
// Usage: ZAYANIM_CODE=<group code> node scripts/add-people.mjs https://<site>
// Skips anyone already on the list, so it is safe to run twice.
import { readFile } from 'node:fs/promises';
import { newId } from '../public/model.js';

const site = (process.argv[2] || '').replace(/\/$/, '');
const code = process.env.ZAYANIM_CODE;
if (!site || !code) throw new Error('Usage: ZAYANIM_CODE=<code> node scripts/add-people.mjs <site url>');

const people = JSON.parse(await readFile(new URL('../people.local.json', import.meta.url), 'utf8'));
const headers = { 'X-Edit-Code': code, 'Content-Type': 'application/json', Origin: site };
const api = async (method, body) => {
  const r = await fetch(site + '/api/list', { method, headers, body: body && JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${data.error}`);
  return data;
};

const { state } = await api('GET');
const have = new Set(state.people.map(p => p.name));
const ops = people.filter(p => !have.has(p.name)).map(p => ({ type: 'addPerson', id: newId(), name: p.name, phone: p.phone ?? '', adults: p.adults, kids: p.kids ?? 0 }));
if (ops.length) await api('POST', { ops });
console.log(`added ${ops.length}, already there ${people.length - ops.length}`);
