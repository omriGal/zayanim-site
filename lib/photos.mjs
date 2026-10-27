import { readFile } from 'node:fs/promises';
import { codeOk } from './api.mjs';

// Friends' photos never go into the repo (it is public): on Netlify they live in a Blobs
// store, uploaded once with scripts/upload-photos.mjs; locally they are read from photos/.
// Either way they are only served to someone with the group code.
export const PHOTOS = ['aperol', 'shades', 'grill', 'not-needed', 'cooling', 'eggs', 'morning'];
const MAX_PHOTO = 1_000_000;

export const fileStore = {
  get: async name => { try { return await readFile(new URL(`../photos/${name}.jpg`, import.meta.url)); } catch { return null; } },
  set: async () => { throw new Error('read only'); },
};

// GET  /api/photo?name=grill  -> the JPEG
// POST /api/photo?name=grill  (body: JPEG) -> stores it
// Both need the X-Edit-Code header.
export function makePhotoHandler({ env = process.env, store = fileStore } = {}) {
  return async req => {
    const url = new URL(req.url);
    const name = url.searchParams.get('name') || '';
    if (!['GET', 'POST'].includes(req.method)) return new Response(null, { status: 405 });
    if (!codeOk(req.headers.get('X-Edit-Code') || '', env.EDIT_CODE_SHA256 || '')) return new Response(null, { status: 401 });
    if (!PHOTOS.includes(name)) return new Response(null, { status: 404 });

    if (req.method === 'POST') {
      if (req.headers.get('origin') !== url.origin) return new Response(null, { status: 403 });
      if (req.headers.get('content-type') !== 'image/jpeg') return new Response(null, { status: 415 });
      const body = Buffer.from(await req.arrayBuffer());
      if (!body.length || body.length > MAX_PHOTO || body[0] !== 0xff || body[1] !== 0xd8) return new Response(null, { status: 400 });
      await store.set(name, body);
      return new Response(null, { status: 204 });
    }

    const body = await store.get(name);
    if (!body) return new Response(null, { status: 404 });
    return new Response(body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  };
}
