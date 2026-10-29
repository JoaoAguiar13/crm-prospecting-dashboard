// O cookie de sessao e' a unica coisa entre a plataforma e quem nao devia
// entrar. Testes com o executor do Node (`node --test`), sem dependencias.
//
// O segredo e' posto aqui e nao vem do ambiente, para isto correr num clone
// limpo. O lib/session.js le' `process.env.SESSION_SECRET` dentro da funcao,
// nao no import, portanto basta defini-lo antes da primeira chamada.
process.env.SESSION_SECRET = 'segredo-de-teste-com-32-caracteres-ou-mais';

import assert from 'node:assert/strict';
import test from 'node:test';
import { sign, verify, MAX_AGE, setCookie } from '../lib/session.js';

test('um cookie assinado por nos volta a ler-se', async () => {
  const t = await sign({ email: 'x@empresa.example', admin: true });
  const p = await verify(t);
  assert.equal(p.email, 'x@empresa.example');
  assert.equal(p.admin, true);
});

test('assinatura adulterada e' + ' recusada', async () => {
  const t = await sign({ email: 'x@empresa.example', admin: false });
  assert.equal(await verify(t.slice(0, -2) + 'zz'), null);
});

test('lixo e' + ' recusado sem atirar', async () => {
  for (const lixo of ['', 'lixo', 'a.b', '.', 'a.'.repeat(50)]) {
    assert.equal(await verify(lixo), null, `deixou passar: ${JSON.stringify(lixo)}`);
  }
});

test('um cookie assinado com outro segredo nao entra', async () => {
  const t = await sign({ email: 'intruso@exemplo.com', admin: true });
  const nosso = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = 'outro-segredo-completamente-diferente-aqui';
    assert.equal(await verify(t), null);
  } finally {
    process.env.SESSION_SECRET = nosso;
  }
});

test('um cookie fora de prazo nao entra', async () => {
  // Assinado como se fosse ha' mais tempo do que a validade: o `exp` que fica
  // gravado ja' passou. Nao mexe no relogio de mais ninguem — so' do sign.
  const relogio = Date.now;
  let t;
  try {
    Date.now = () => relogio() - (MAX_AGE + 60) * 1000;
    t = await sign({ email: 'x@empresa.example', admin: false });
  } finally {
    Date.now = relogio;
  }
  assert.notEqual(await verify(t), undefined);
  assert.equal(await verify(t), null, 'aceitou um cookie expirado');
});

test('o cookie sai fechado ao browser e ao site do lado', () => {
  const c = setCookie('abc');
  for (const parte of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
    assert.ok(c.includes(parte), `falta ${parte} no cookie`);
  }
  // Terminar sessao tem de expirar o cookie, nao so' esvaziar o valor.
  assert.ok(setCookie('').includes('Max-Age=0'));
});
