/*
 * As sugestões: qualquer pessoa com sessão escreve, só admins lêem.
 *
 * O que interessa provar é o portão. A lista tem o email de quem escreveu cada
 * sugestão, e o `admin` do cookie é o que era verdade no dia do login — um
 * cookie dura 30 dias. Quem for despromovido tem de deixar de ler NO PEDIDO
 * SEGUINTE, não daqui a um mês.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'segredo-so-para-os-testes-das-sugestoes';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'sugestoes-'));

const { sign } = await import('../lib/session.js');
const { writeJson, readJson } = await import('../lib/store.js');
const { GET, POST } = await import('../api/sugestoes.js');

await writeJson('acessos.json', { users: [
  { email: 'admin@empresa.example', admin: true },
  { email: 'consultor@exemplo.com', admin: false },
] });

/* O cookie diz `admin: true` de propósito nos dois — o portão tem de o ignorar. */
const cookieAdmin = `session=${await sign({ email: 'admin@empresa.example', admin: true })}`;
const cookieRian = `session=${await sign({ email: 'consultor@exemplo.com', admin: true })}`;
const cookieDeFora = `session=${await sign({ email: 'pessoa2@exemplo.com', admin: true })}`;

const escrever = (texto, cookie = cookieRian) => POST(new Request('https://exemplo/api/sugestoes', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify({ texto }),
}));
const ler = (cookie) => GET(new Request('https://exemplo/api/sugestoes', {
  headers: cookie ? { cookie } : {},
}));

test('sem sessao nao escreve nem le', async () => {
  assert.equal((await escrever('a', null)).status, 401);
  assert.equal((await ler(null)).status, 401);
});

test('quem saiu da lista de acessos deixa de entrar, mesmo com cookie valido', async () => {
  assert.equal((await escrever('a', cookieDeFora)).status, 401);
  assert.equal((await ler(cookieDeFora)).status, 401);
});

test('uma sugestao vazia e recusada', async () => {
  for (const mau of ['', '   ', '\n\n']) {
    const r = await escrever(mau);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /vazia/i);
  }
});

test('uma sugestao sem fim e recusada, e a frase diz o tamanho', async () => {
  const r = await escrever('x'.repeat(2001));
  assert.equal(r.status, 400);
  const d = await r.json();
  assert.match(d.error, /2001/);
  assert.match(d.error, /2000/);
});

test('escrever guarda o texto, quem escreveu e quando', async () => {
  assert.equal((await escrever('  O filtro de setor devia guardar a escolha.  ')).status, 200);
  const db = await readJson('sugestoes.json', null);
  assert.equal(db.sugestoes.length, 1);
  assert.equal(db.sugestoes[0].texto, 'O filtro de setor devia guardar a escolha.');
  assert.equal(db.sugestoes[0].por, 'consultor@exemplo.com');
  assert.match(db.sugestoes[0].quando, /^\d{4}-\d{2}-\d{2}T/);
});

test('o comercial escreve mas NAO le — o admin vem da lista, nao do cookie', async () => {
  const r = await ler(cookieRian);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /admin/i);
});

test('um admin le, e as mais recentes vem primeiro', async () => {
  await escrever('a segunda');
  const r = await ler(cookieAdmin);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.sugestoes[0].texto, 'a segunda');
  assert.equal(d.sugestoes.length, 2);
});
