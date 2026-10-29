// A porta de entrada por codigo: existe porque o Google recusa as nossas
// origens. Estes testes garantem que ela e' uma porta, nao uma dispensa.
process.env.SESSION_SECRET = 'segredo-de-teste-com-32-caracteres-ou-mais';
process.env.ACCESS_CODE = 'codigo-de-teste';

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'auth-teste-'));
const { POST, GET } = await import('../api/auth.js');

const pedir = (corpo) => POST(new Request('http://x/api/auth', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
}));

test('o servidor anuncia o modo codigo quando ACCESS_CODE existe', async () => {
  const r = await GET(new Request('http://x/api/auth'));
  const j = await r.json();
  assert.equal(j.modo, 'codigo');
  assert.equal(j.clientId, undefined, 'nao deve expor o clientId neste modo');
});

test('codigo certo + email do dominio entra', async () => {
  const r = await pedir({ email: 'alguem@empresa.example', codigo: 'codigo-de-teste' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie') || '', /^session=.+HttpOnly/);
});

test('codigo errado nao entra, mesmo com email do dominio', async () => {
  for (const codigo of ['', 'errado', 'codigo de teste', 'CODIGO-DE-TESTE', 'codigo-de-teste-x']) {
    const r = await pedir({ email: 'alguem@empresa.example', codigo });
    assert.equal(r.status, 401, `deixou entrar com ${JSON.stringify(codigo)}`);
    assert.equal(r.headers.get('set-cookie'), null);
  }
});

test('codigo certo NAO chega: o email tem de ser do dominio ou da lista', async () => {
  const r = await pedir({ email: 'pessoa1@exemplo.com', codigo: 'codigo-de-teste' });
  assert.equal(r.status, 403, 'o codigo nao pode ser uma dispensa da lista de acessos');
  assert.equal(r.headers.get('set-cookie'), null);
});

test('espacos a volta do codigo nao sao erro — vem quase sempre de copiar/colar', async () => {
  for (const codigo of [' codigo-de-teste', 'codigo-de-teste ', '  codigo-de-teste\n']) {
    const r = await pedir({ email: 'alguem@empresa.example', codigo });
    assert.equal(r.status, 200, `recusou ${JSON.stringify(codigo)}`);
  }
});

test('email invalido e recusado antes de olhar ao codigo', async () => {
  const r = await pedir({ email: 'nao-e-email', codigo: 'codigo-de-teste' });
  assert.equal(r.status, 400);
});

test('uma credencial Google nao serve enquanto o modo for codigo', async () => {
  const r = await pedir({ credential: 'o-que-quer-que-seja' });
  assert.equal(r.status, 400, 'sem email/codigo tem de recusar');
});
