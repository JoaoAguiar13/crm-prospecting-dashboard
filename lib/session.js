// Cookie de sessão assinado (HMAC-SHA256, Web Crypto) — corre no middleware (edge) e nas funções (node).
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const key = () => crypto.subtle.importKey('raw', enc.encode(process.env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export const COOKIE = 'session';
export const MAX_AGE = 30 * 24 * 3600; // 30 dias

export async function sign(payload) {
  const body = b64(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + MAX_AGE })));
  return body + '.' + b64(await crypto.subtle.sign('HMAC', await key(), enc.encode(body)));
}

export async function verify(token) {
  try {
    const [body, sig] = token.split('.');
    if (!(await crypto.subtle.verify('HMAC', await key(), unb64(sig), enc.encode(body)))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64(body)));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

export function getSession(req) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)session=([^;]+)/);
  return m ? verify(m[1]) : null;
}

export const setCookie = token => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? MAX_AGE : 0}`;
