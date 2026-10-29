// Quem entra na plataforma. A regra e' uma linha, e e' precisamente por isso
// que merece testes: e' facil "simplifica-la" para um `includes` e abrir a
// porta a um dominio parecido.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowed, isAdmin, DOMAIN } from '../lib/access.js';

const acl = { users: [
  { email: 'convidado.admin@exemplo.com', admin: true },
  { email: 'convidado@exemplo.com', admin: false },
] };

test('quem e' + ` do @${DOMAIN} entra sem estar na lista`, () => {
  assert.ok(isAllowed(acl, `qualquer.pessoa@${DOMAIN}`));
});

test('externo entra so' + ' se estiver na lista', () => {
  assert.ok(isAllowed(acl, 'convidado.admin@exemplo.com'));
  assert.ok(!isAllowed(acl, 'pessoa1@exemplo.com'));
});

test('dominios parecidos nao passam', () => {
  // O `endsWith('@dominio')` protege-nos destes. Se alguem trocar por
  // `includes(dominio)` ou tirar o `@`, este teste fica vermelho.
  for (const email of [
    `atacante@evil-${DOMAIN}`,
    `atacante@sub.${DOMAIN}`,
    `atacante@${DOMAIN}.evil.com`,
    `${DOMAIN}@gmail.com`,
    `atacante@${DOMAIN}x`,
  ]) {
    assert.ok(!isAllowed(acl, email), `deixou entrar ${email}`);
  }
});

test('admin e' + ' so' + ' quem esta' + ' marcado na lista', () => {
  assert.ok(isAdmin(acl, 'convidado.admin@exemplo.com'));
  assert.ok(!isAdmin(acl, 'convidado@exemplo.com'));
  // Entrar pelo dominio nao da' admin — e' a diferenca entre "entra" e "manda".
  assert.ok(!isAdmin(acl, `alguem@${DOMAIN}`));
  assert.ok(!isAdmin(acl, 'ninguem@lado-nenhum.com'));
});
