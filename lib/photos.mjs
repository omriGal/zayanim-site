import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOk } from './api.mjs';

// Friends' photos are not in public/: they are only served to someone with the group code.
export const PHOTOS = ['aperol', 'shades', 'grill', 'not-needed', 'cooling', 'eggs', 'morning', 'random-1', 'random-2', 'random-3', 'random-4'];

// Netlify ships photos/ next to the function (see included_files); where it lands differs
// between the bundle and local runs, so try the likely places.
const dirs = [join(process.cwd(), 'photos'), process.env.LAMBDA_TASK_ROOT && join(process.env.LAMBDA_TASK_ROOT, 'photos'), fileURLToPath(new URL('../photos/', import.meta.url))].filter(Boolean);
async function load(name) {
  for (const dir of dirs) {
    try { return await readFile(join(dir, name + '.jpg')); } catch { /* try the next place */ }
  }
  return null;
}

// GET /api/photo?name=grill with the X-Edit-Code header -> the JPEG.
export function makePhotoHandler({ env = process.env, read = load } = {}) {
  return async req => {
    const name = new URL(req.url).searchParams.get('name') || '';
    if (req.method !== 'GET') return new Response(null, { status: 405 });
    if (!codeOk(req.headers.get('X-Edit-Code') || '', env.EDIT_CODE_SHA256 || '')) return new Response(null, { status: 401 });
    if (!PHOTOS.includes(name)) return new Response(null, { status: 404 });
    const body = await read(name);
    if (!body) return new Response(null, { status: 404 });
    return new Response(body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  };
}
