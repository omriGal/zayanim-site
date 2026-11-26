// Brings the site's families in line with people.local.json (git-ignored: names stay out of
// the public repo). New families are added; existing ones (matched by name, or by "was" for a
// rename) get their name, contact details and their size in the first event updated.
// Safe to run again.
// Usage: ZAYANIM_CODE=<group code> node scripts/add-people.mjs https://<site>
import { readFile } from 'node:fs/promises';
import { newId, view, CONTACT_FIELDS } from '../public/model.js';

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

const { state: root } = await api('GET');
const event = root.events[0].event.id;
const current = view(root, event).people;
const ops = [];
let added = 0, updated = 0;
for (const p of people) {
  const contacts = Object.fromEntries(CONTACT_FIELDS.filter(k => p[k]).map(k => [k, p[k]]));
  const fields = { name: p.name, adults: p.adults, kids: p.kids ?? 0, ...contacts };
  const now = current.find(x => x.name === p.name || (p.was && x.name === p.was));
  if (!now) {
    ops.push({ type: 'addPerson', event, id: newId(), name: p.name, adults: p.adults, kids: p.kids ?? 0 });
    ops.push({ type: 'updatePerson', event, id: ops.at(-1).id, fields: contacts });
    added++;
  } else if (Object.entries(fields).some(([k, v]) => now[k] !== v)) {
    // Keep the vegetarian count valid if the family got smaller.
    ops.push({ type: 'updatePerson', event, id: now.id, fields: { ...fields, veg: Math.min(now.veg, fields.adults + fields.kids) } });
    updated++;
  }
}
if (ops.length) await api('POST', { ops });
console.log(`added ${added}, updated ${updated}, unchanged ${people.length - added - updated}`);
