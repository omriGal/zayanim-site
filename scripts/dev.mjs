// Local preview: serves public/ and the API with in-memory storage (lost on restart).
// Usage: node scripts/dev.mjs   then open http://localhost:8888  - code: local-dev-code-1234567890
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { makeHandler } from '../lib/api.mjs';
import { makePhotoHandler, fileStore } from '../lib/photos.mjs';
import { MemoryStore } from '../tests/memory-store.mjs';

const PORT = Number(process.env.PORT) || 8888;
const CODE = 'local-dev-code-1234567890';
const root = new URL('../public/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const stores = { false: new MemoryStore(), true: new MemoryStore() };
const env = { SYNC_ENABLED: 'true', EDIT_CODE_SHA256: createHash('sha256').update(CODE).digest('hex') };
const api = makeHandler({ storeFor: t => stores[t], env });
// Photos: uploads stay in memory, otherwise fall back to photos/ on disk.
const uploaded = new Map();
const photo = makePhotoHandler({ env, store: { get: async n => uploaded.get(n) ?? fileStore.get(n), set: async (n, b) => { uploaded.set(n, b); } } });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/list' || url.pathname === '/api/photo') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await (url.pathname === '/api/photo' ? photo : api)(new Request(url, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(normalize(root))) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}  (code: ${CODE})`));
