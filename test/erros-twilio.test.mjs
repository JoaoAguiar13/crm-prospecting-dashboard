// Nenhum código do Twilio pode chegar ao ecrã sem uma frase que diga o que
// fazer. Estes testes existem para essa regra não se perder num refactor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explicarTwilio, CODIGOS_CONHECIDOS } from '../lib/erros-twilio.js';

// Os cinco que o registo da conta mostrou nos 30 dias lidos a 09/09/2026.
const VISTOS_NO_REGISTO = [63016, 63024, 21656, 21655, 12300];

test('os codigos vistos no registo tem todos explicacao propria', () => {
  for (const c of VISTOS_NO_REGISTO) {
    assert.ok(CODIGOS_CONHECIDOS.includes(c), `${c} devia estar no mapa`);
  }
});

test('cada explicacao tem frase curta para a bolha e frase inteira', () => {
  for (const c of CODIGOS_CONHECIDOS) {
    const e = explicarTwilio(c);
    assert.equal(e.codigo, c);
    assert.ok(e.curto.length > 3 && e.curto.length <= 32, `${c}: curto mal dimensionado (${e.curto.length})`);
    assert.ok(e.frase.length > 40, `${c}: a frase inteira tem de dizer o que fazer`);
  }
});

test('nenhuma frase e' + ' so o numero — o codigo nunca aparece sozinho', () => {
  for (const c of CODIGOS_CONHECIDOS) {
    const e = explicarTwilio(c);
    assert.ok(!/^\d+$/.test(e.curto.trim()), `${c}: o curto e' so um numero`);
    assert.ok(!e.curto.includes(String(c)), `${c}: o curto mostra o codigo em vez de o explicar`);
  }
});

test('um codigo desconhecido continua a dizer o que fazer', () => {
  const e = explicarTwilio(99999);
  assert.equal(e.codigo, 99999);
  assert.ok(e.frase.includes('99999'), 'o codigo tem de ficar la para o suporte');
  assert.ok(e.frase.length > 60, 'a alternativa tambem tem de dizer o passo seguinte');
  assert.ok(!/^\d+$/.test(e.curto.trim()));
});

test('sem erro nao ha explicacao (a bolha fica limpa)', () => {
  for (const v of [null, undefined, 0, '']) assert.equal(explicarTwilio(v), null);
});

test('o codigo vem como texto do Twilio e continua a bater certo', () => {
  // A API devolve `error_code` como numero, mas o proxy n8n devolve string.
  assert.equal(explicarTwilio('63016').curto, explicarTwilio(63016).curto);
});
