// Brings the site's families in line with people.local.json (git-ignored: names stay out of
// the public repo). New families are added; existing ones (matched by name, or by "was" for a
// rename) get their name, adults, kids and phone updated. Safe to run again.
// Usage: ZAYANIM_CODE=<group code> node scripts/add-people.mjs https://<site>
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
const ops = [];
let added = 0, updated = 0;
for (const p of people) {
  const fields = { name: p.name, adults: p.adults, kids: p.kids ?? 0, ...(p.phone ? { phone: p.phone } : {}) };
  const current = state.people.find(x => x.name === p.name || (p.was && x.name === p.was));
  if (!current) {
    ops.push({ type: 'addPerson', id: newId(), phone: '', ...fields });
    added++;
  } else if (Object.entries(fields).some(([k, v]) => current[k] !== v)) {
    // Keep the vegetarian count valid if the family got smaller.
    ops.push({ type: 'updatePerson', id: current.id, fields: { ...fields, veg: Math.min(current.veg, fields.adults + fields.kids) } });
    updated++;
  }
}
if (ops.length) await api('POST', { ops });
console.log(`added ${added}, updated ${updated}, unchanged ${people.length - added - updated}`);
