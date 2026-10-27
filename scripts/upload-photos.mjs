// Uploads the friends' photos from photos/ (git-ignored) to the live site's storage.
// Usage: ZAYANIM_CODE=<group code> node scripts/upload-photos.mjs https://<site>
import { readFile } from 'node:fs/promises';
import { PHOTOS } from '../lib/photos.mjs';

const site = (process.argv[2] || '').replace(/\/$/, '');
const code = process.env.ZAYANIM_CODE;
if (!site || !code) throw new Error('Usage: ZAYANIM_CODE=<code> node scripts/upload-photos.mjs <site url>');

for (const name of PHOTOS) {
  const body = await readFile(new URL(`../photos/${name}.jpg`, import.meta.url));
  const r = await fetch(`${site}/api/photo?name=${name}`, { method: 'POST', headers: { 'X-Edit-Code': code, 'Content-Type': 'image/jpeg', Origin: site }, body });
  console.log(name, r.status === 204 ? 'ok' : `failed (${r.status})`);
}
