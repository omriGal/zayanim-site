import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Two ways in: the group code, or a Google account whose email is on one of the families.
// Google sign-in ends with a session token signed here, so the code itself is never needed.
const SESSION_DAYS = 180;
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export function codeOk(secret, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || secret.length < 15 || secret.length > 200) return false;
  return timingSafeEqual(createHash('sha256').update(secret).digest(), Buffer.from(expected, 'hex'));
}

// Tied to the group code: changing the code signs everyone out.
const key = env => createHash('sha256').update('session:' + (env.EDIT_CODE_SHA256 || '')).digest();
const sign = (body, env) => createHmac('sha256', key(env)).update(body).digest('base64url');

export function makeSession(email, env, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ e: email, x: now + SESSION_DAYS * 86_400_000 })).toString('base64url');
  return `${body}.${sign(body, env)}`;
}

// The email a session token was issued to, or null if it's forged or expired.
export function sessionEmail(token, env, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(env.EDIT_CODE_SHA256 || '')) return null;
  const [body, mac, extra] = String(token || '').split('.');
  if (!body || !mac || extra !== undefined || body.length > 500) return null;
  const want = Buffer.from(sign(body, env)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof e === 'string' && x > now ? e : null;
  } catch { return null; }
}

// null = not allowed; '' = the group code; otherwise the signed-in email.
export function who(req, env) {
  if (codeOk(req.headers.get('X-Edit-Code') || '', env.EDIT_CODE_SHA256 || '')) return '';
  return sessionEmail(req.headers.get('X-Session'), env);
}

export const emailsOf = root => root.people.flatMap(p => [p.email, p.email2]).filter(Boolean).map(m => m.trim().toLowerCase());
export const isMember = (root, email) => email === '' || emailsOf(root).includes(email.toLowerCase());

// Google checks its own token (signature, expiry); we check it was made for this site,
// for this sign-in attempt, and that Google verified the address.
export async function googleEmail(credential, nonce, env, fetchImpl = fetch) {
  if (!env.GOOGLE_CLIENT_ID || typeof credential !== 'string' || credential.length > 5000) return null;
  const r = await fetchImpl('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) return null;
  const t = await r.json();
  const fresh = Number(t.exp) * 1000 > Date.now();
  if (t.aud !== env.GOOGLE_CLIENT_ID || !ISSUERS.includes(t.iss) || !fresh) return null;
  if (String(t.email_verified) !== 'true' || !t.email || !nonce || t.nonce !== nonce) return null;
  return t.email.toLowerCase();
}
