/*
 * O filtro do selector de contas do Google tem de obedecer à lista de acessos.
 *
 * Com alguém de fora do domínio na lista — hoje o `consultor@exemplo.com`, que
 * é admin — filtrar o selector fecha-lhe a porta, porque o Google nem lhe
 * oferece a conta. Este teste existe para essa regra não se perder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'segredo-so-para-os-testes-do-filtro';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'filtro-google-'));
delete process.env.ACCESS_CODE;

const { writeAccess, DOMAIN } = await import('../lib/access.js');
const { GET } = await import('../api/auth.js');

const perguntarOModo = async () => {
  const r = await GET(new Request('https://exemplo/api/auth', { method: 'GET' }));
  return r.json();
};

test('com alguem de fora do dominio na lista, o selector NAO filtra', async () => {
  await writeAccess({
    users: [
      { email: `admin@${DOMAIN}`, admin: true },
      { email: 'consultor@exemplo.com', admin: true },
    ],
  });
  const d = await perguntarOModo();
  assert.equal(d.modo, 'google');
  assert.equal(d.filtrarPorDominio, false, 'filtrar aqui fecharia a porta ao gmail que tem acesso');
});

test('so com gente do dominio, o selector filtra', async () => {
  await writeAccess({
    users: [
      { email: `admin@${DOMAIN}`, admin: true },
      { email: `comercial@${DOMAIN}`, admin: false },
    ],
  });
  const d = await perguntarOModo();
  assert.equal(d.filtrarPorDominio, true);
  assert.equal(d.dominio, DOMAIN);
});

test('a decisao acompanha a lista sem ninguem mexer no codigo', async () => {
  await writeAccess({ users: [{ email: `admin@${DOMAIN}`, admin: true }] });
  assert.equal((await perguntarOModo()).filtrarPorDominio, true);

  await writeAccess({
    users: [{ email: `admin@${DOMAIN}`, admin: true }, { email: 'externo@outra.pt', admin: false }],
  });
  assert.equal((await perguntarOModo()).filtrarPorDominio, false);
});

test('um dominio parecido nao conta como sendo do dominio', async () => {
  await writeAccess({ users: [{ email: `alguem@nao-${DOMAIN}`, admin: false }] });
  assert.equal((await perguntarOModo()).filtrarPorDominio, false);
});
