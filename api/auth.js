// GET: quem sou (ou o modo de entrada) · POST: login · DELETE: logout
//
// Dois modos, e é o servidor que decide qual:
//
//   ACCESS_CODE definido  → código partilhado + email (modo actual)
//   caso contrário        → Google Identity (o modo original)
//
// O Google ficou de fora a 08/09/2026 porque o cliente OAuth recusa as origens
// que usamos (`origin_mismatch` em todas, incluindo o domínio da Railway), e a
// equipa precisava de entrar. Assim que a origem for autorizada na Google Cloud
// Console, tira-se o ACCESS_CODE do serviço e o Google volta sozinho — não há
// código a reverter.
//
// O que NÃO muda em nenhum dos modos: só entra quem for do domínio ou estiver
// na lista de acessos. O código é uma porta, não uma dispensa.
import { getSession, sign, setCookie } from '../lib/session.js';
import { readAccess, writeAccess, isAllowed, isAdmin, DOMAIN } from '../lib/access.js';
import { timingSafeEqual } from 'node:crypto';

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });

const CODIGO = (process.env.ACCESS_CODE || '').trim();

/** Comparação de tempo constante — um `===` deixa adivinhar o código à letra. */
function codigoCerto(dado) {
  const a = Buffer.from(String(dado || ''), 'utf8');
  const b = Buffer.from(CODIGO, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Entra de facto: regista quem é novo, assina o cookie. */
async function entrar(email, nome) {
  const acl = await readAccess();
  if (!isAllowed(acl, email)) {
    return json({ error: `Sem acesso. Só contas @${DOMAIN} entram directamente — pede a um admin para adicionar ${email}.` }, 403);
  }
  if (!acl.users.some((u) => u.email === email)) {
    acl.users.push({ email, admin: false, name: nome, since: new Date().toISOString().slice(0, 10) });
    await writeAccess(acl);
  }
  const me = { email, admin: isAdmin(acl, email) };
  return json(me, 200, { 'set-cookie': setCookie(await sign(me)) });
}

async function handler(req) {
  if (req.method === 'GET') {
    const s = await getSession(req);
    if (s) return json({ email: s.email, admin: s.admin });
    if (CODIGO) return json({ modo: 'codigo', dominio: DOMAIN });

    /*
     * O `hd` filtra o selector de contas do Google pelo nosso domínio, o que
     * evita o engano de escolher a conta pessoal. Mas o `hd` é um domínio só:
     * não sabe dizer «o domínio, e mais este email».
     *
     * Quem está na lista de acessos com um email de fora do domínio tem acesso
     * legítimo — é para isso que a lista existe. Filtrar o selector nesse caso
     * fecha-lhe a porta, porque o Google nem lhe oferece a conta.
     *
     * Então quem decide é a própria lista: filtra-se só quando ninguém de fora
     * do domínio tem acesso. Assim mantém-se correcto sozinho quando alguém for
     * acrescentado ou retirado, sem ninguém se lembrar de mexer aqui.
     */
    const acl = await readAccess();
    const alguemDeFora = acl.users.some((u) => !u.email.endsWith('@' + DOMAIN));

    return json({
      modo: 'google',
      dominio: DOMAIN,
      filtrarPorDominio: !alguemDeFora,
      clientId: process.env.GOOGLE_CLIENT_ID || null,
    });
  }
  if (req.method === 'DELETE') return json({ ok: true }, 200, { 'set-cookie': setCookie('') });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await req.json().catch(() => ({}));

  if (CODIGO) {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Escreve o teu email de trabalho.' }, 400);
    // `trim()` porque um codigo partilhado chega quase sempre por copiar/colar,
    // e um espaco invisivel no fim nao devia parecer "codigo errado".
    if (!codigoCerto(String(body.codigo || '').trim())) return json({ error: 'Código de acesso errado.' }, 401);
    return entrar(email);
  }

  // Google valida a assinatura do ID token; nós validamos audiência e email verificado.
  const { credential } = body;
  const info = credential ? await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential)).then((r) => r.json()).catch(() => ({})) : {};
  if (!info.email || info.aud !== process.env.GOOGLE_CLIENT_ID || info.email_verified !== 'true') return json({ error: 'Login Google inválido.' }, 401);
  return entrar(info.email.toLowerCase(), info.name);
}

export { handler as GET, handler as POST, handler as DELETE };
