// O envio de template falhava SEMPRE em 7 dos 11 templates da conta: mandava
// {1,2} fixos, e o Twilio devolve 21656 quando isso nao bate com o que o
// template declara. Aqui guarda-se a metade que vive no servidor.
process.env.SESSION_SECRET = 'segredo-de-teste-com-32-caracteres-ou-mais';
process.env.TWILIO_ACCOUNT_SID = 'ACtestetestetestetestetestetestete';
process.env.TWILIO_AUTH_TOKEN = 'token-de-teste';

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'wa-teste-'));
const { sign } = await import('../lib/session.js');
const { POST } = await import('../api/whatsapp.js');
const cookie = 'session=' + await sign({ email: 'a@empresa.example', admin: true });

const enviar = (body) => POST(new Request('http://x/api/whatsapp', {
  method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

test('uma variavel vazia e recusada antes de ir ao Twilio, e diz qual', async () => {
  const r = await enviar({ to: '+351900000000', contentSid: 'HXabc', variables: { 1: 'o comercial', 2: '   ' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /\{\{2\}\}/);
});

test('todas vazias sao listadas, nao so a primeira', async () => {
  const r = await enviar({ to: '+351900000000', contentSid: 'HXabc', variables: { 1: '', 2: '', 3: 'x' } });
  const erro = (await r.json()).error;
  assert.match(erro, /\{\{1\}\}/);
  assert.match(erro, /\{\{2\}\}/);
  assert.doesNotMatch(erro, /\{\{3\}\}/);
});

test('numero invalido continua a ser recusado', async () => {
  const r = await enviar({ to: 'nao-e-numero', contentSid: 'HXabc', variables: { 1: 'x' } });
  assert.equal(r.status, 400);
});
