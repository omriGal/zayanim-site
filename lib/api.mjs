import { codeOk, who, isMember, googleEmail, makeSession } from './auth.mjs';
import { applyRootOp, defaultRoot, migrate, validRoot } from '../public/model.js';

// All events live under one key. The single-weekend save before it ('weekend-v5') is moved
// over on first load and left in place; Omri's original list ('current') is untouched.
const KEY = 'events-v6';
const PREVIOUS = 'weekend-v5';
const MAX_BODY = 50_000;
const MAX_OPS = 50;

const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export { codeOk };

async function readJson(req) {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw Object.assign(new Error('too large'), { status: 413 }); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// GET  /api/list        -> { state, revision }
// POST /api/list {ops}  -> applies the operations to the latest saved state, retrying on a race.
// Both need the group code: the list holds names and money, so it is not public.
export function makeHandler({ storeFor, env = process.env, fetchImpl = fetch }) {
  return async req => {
    try {
      const url = new URL(req.url);
      if (env.SYNC_ENABLED !== 'true') return reply(503, { error: 'השמירה המשותפת לא מופעלת' });
      if (!['GET', 'POST'].includes(req.method)) return reply(405, { error: 'Method not allowed' });
      const keys = [...url.searchParams.keys()];
      if (keys.some(k => k !== 'test') || (keys.length && url.searchParams.get('test') !== '1')) return reply(400, { error: 'Invalid parameters' });
      if (!/^[a-f0-9]{64}$/.test(env.EDIT_CODE_SHA256 || '')) return reply(503, { error: 'קוד הקבוצה לא הוגדר בשרת' });
      const store = storeFor(url.searchParams.get('test') === '1');
      // The first visit saves the starting template, so every device sees the same item ids.
      const load = async () => {
        let cur = await store.getWithMetadata(KEY, { type: 'json', consistency: 'strong' });
        if (!cur) {
          const old = await store.getWithMetadata(PREVIOUS, { type: 'json', consistency: 'strong' });
          const first = old ? migrate(old.data.state) : defaultRoot();
          await store.setJSON(KEY, { state: first, updatedAt: new Date().toISOString() }, { onlyIfNew: true });
          cur = await store.getWithMetadata(KEY, { type: 'json', consistency: 'strong' });
        }
        return { state: migrate(cur.data.state), revision: cur.etag, etag: cur.etag };
      };

      // GET  /api/login               -> { clientId } so the page can offer Google sign-in
      // POST /api/login {credential, nonce} -> { session } if the Google email is on a family
      if (url.pathname.endsWith('/api/login')) {
        if (req.method === 'GET') return reply(200, { clientId: env.GOOGLE_CLIENT_ID || null });
        if (req.headers.get('origin') !== url.origin) return reply(403, { error: 'Origin not allowed' });
        let body;
        try { body = await readJson(req); } catch (e) { return reply(e.status || 400, { error: 'בקשה לא תקינה' }); }
        const email = await googleEmail(body?.credential, body?.nonce, env, fetchImpl);
        if (!email) return reply(401, { error: 'הכניסה עם Google לא הצליחה, נסו שוב' });
        if (!isMember((await load()).state, email)) return reply(403, { error: `${email} לא רשום באף משפחה. אפשר להיכנס עם הקוד, או לבקש שיוסיפו את המייל.` });
        return reply(200, { session: makeSession(email, env), email });
      }

      const email = who(req, env);
      if (email === null) return reply(401, { error: 'קוד שגוי' });

      if (req.method === 'GET') {
        const { state, revision } = await load();
        if (!isMember(state, email)) return reply(401, { error: 'המייל כבר לא ברשימת המשפחות' });
        return reply(200, { state, revision });
      }

      // Ordinary fetch POSTs carry Origin; refusing other origins blocks cross-site writes.
      if (req.headers.get('origin') !== url.origin) return reply(403, { error: 'Origin not allowed' });
      if (!req.headers.get('content-type')?.startsWith('application/json')) return reply(415, { error: 'JSON required' });
      let body;
      try { body = await readJson(req); } catch (e) { return reply(e.status || 400, { error: 'בקשה לא תקינה' }); }
      if (!body || !Array.isArray(body.ops) || !body.ops.length || body.ops.length > MAX_OPS) return reply(400, { error: 'בקשה לא תקינה' });

      for (let attempt = 0; attempt < 5; attempt++) {
        const cur = await load();
        if (!validRoot(cur.state)) return reply(500, { error: 'הנתונים השמורים פגומים' });
        if (!isMember(cur.state, email)) return reply(401, { error: 'המייל כבר לא ברשימת המשפחות' });
        // All or nothing: if one edit no longer applies, none are saved and the page drops that one.
        let next = cur.state;
        for (const [index, op] of body.ops.entries()) {
          try { next = applyRootOp(next, op); } catch (e) {
            return reply(422, { error: e.message, index, state: cur.state, revision: cur.revision });
          }
        }
        // Keep the previous version before replacing it, so a bad edit can be recovered from the Netlify dashboard.
        if (cur.etag) await store.setJSON('history/' + Date.now() + '-' + cur.etag.replace(/\W/g, ''), { state: cur.state }, { onlyIfNew: true });
        const write = await store.setJSON(KEY, { state: next, updatedAt: new Date().toISOString() }, cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
        if (write.modified) return reply(200, { state: next, revision: write.etag });
      }
      return reply(409, { error: 'יותר מדי עדכונים בבת אחת - נסו שוב' });
    } catch {
      return reply(503, { error: 'השרת לא זמין כרגע - השינוי לא נשמר' });
    }
  };
}
