/*
 * Não pode ser possível ficar sem nenhum admin.
 *
 * O /api/access só responde a admins. Sem nenhum, ninguém — nem quem o fez —
 * volta a abrir a lista pela interface; só se recupera mexendo no volume da
 * Railway. Medido a 10/09/2026 contra uma instância local: quatro pedidos e a
 * porta fecha-se por fora.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'segredo-so-para-os-testes-do-ultimo-admin';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ultimo-admin-'));
delete process.env.ACCESS_CODE;

const { writeAccess, readAccess, DOMAIN } = await import('../lib/access.js');
const { sign } = await import('../lib/session.js');
const { POST, DELETE, GET } = await import('../api/access.js');

const EU = `admin@${DOMAIN}`;
const OUTRO = `comercial@${DOMAIN}`;

const comoAdmin = async (email = EU) => `session=${await sign({ email, admin: true })}`;

const pedir = async (metodo, corpo, email = EU) => {
  const req = new Request('https://exemplo/api/access', {
    method: metodo,
    headers: { cookie: await comoAdmin(email), 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const r = await (metodo === 'DELETE' ? DELETE(req) : POST(req));
  return { status: r.status, corpo: await r.json() };
};

const admins = async () => (await readAccess()).users.filter((u) => u.admin).length;

test('despromover o ultimo admin e recusado', async () => {
  await writeAccess({ users: [{ email: EU, admin: true }, { email: OUTRO, admin: false }] });
  const r = await pedir('POST', { email: EU, admin: false });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /pelo menos um admin/i);
  assert.equal(await admins(), 1, 'a lista nao pode ter mudado');
});

test('despromover-se a si proprio funciona enquanto sobrar outro admin', async () => {
  await writeAccess({ users: [{ email: EU, admin: true }, { email: OUTRO, admin: true }] });
  const r = await pedir('POST', { email: EU, admin: false });
  assert.equal(r.status, 200, 'abdicar e legitimo quando ha quem fique');
  assert.equal(await admins(), 1);
});

test('nao da para esvaziar a lista de admins um a um', async () => {
  await writeAccess({
    users: [{ email: EU, admin: true }, { email: OUTRO, admin: true }, { email: `equipa@${DOMAIN}`, admin: true }],
  });
  for (const alvo of [OUTRO, `equipa@${DOMAIN}`]) {
    assert.equal((await pedir('POST', { email: alvo, admin: false }, EU)).status, 200);
  }
  // resta um: o proprio
  assert.equal(await admins(), 1);
  const ultimo = await pedir('POST', { email: EU, admin: false }, EU);
  assert.equal(ultimo.status, 400);
  assert.equal(await admins(), 1);
});

test('remover o ultimo admin tambem e recusado', async () => {
  // Nao e' o proprio, portanto a guarda antiga (nao te removes a ti) nao chega.
  await writeAccess({ users: [{ email: OUTRO, admin: true }, { email: EU, admin: false }] });
  const r = await pedir('DELETE', { email: OUTRO }, OUTRO);
  // o proprio: bloqueado pela guarda antiga
  assert.equal(r.status, 400);

  await writeAccess({ users: [{ email: OUTRO, admin: true }, { email: EU, admin: true }] });
  assert.equal((await pedir('DELETE', { email: OUTRO }, EU)).status, 200);
  assert.equal(await admins(), 1);
});

test('a lista continua a responder depois de tudo', async () => {
  const r = await GET(new Request('https://exemplo/api/access', { headers: { cookie: await comoAdmin() } }));
  assert.equal(r.status, 200, 'se ficasse sem admins, isto seria 403 para toda a gente');
});
