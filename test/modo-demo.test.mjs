// O modo demo (DEMO_MODE=1) abre a plataforma sem Close nem Twilio. Estes testes
// garantem que os dados fictícios chegam à interface pelo mesmo caminho que os
// reais, e que nada sai para a rede.
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DEMO_MODE = '1';
delete process.env.CLOSE_API_KEY;
delete process.env.TWILIO_AUTH_TOKEN;
globalThis.fetch = async (url) => { throw new Error(`o modo demo foi à rede: ${url}`); };

const { lerLeadsDoClose } = await import('../lib/leads-close.js');
const { close, escolhaDaEtapa } = await import('../lib/close.js');
const { tw, SENDERS, MSG_URL } = await import('../lib/twilio.js');
const { coordenadasDaMorada } = await import('../lib/leads.js');

test('os leads fictícios chegam na forma que a interface lê', async () => {
  const { escolas, empresas } = await lerLeadsDoClose();
  assert.equal(escolas.length, 36);
  assert.equal(empresas.length, 54);
  for (const l of [...escolas, ...empresas]) {
    assert.ok(l.name && l.city && Number.isFinite(l.lat) && Number.isFinite(l.lng), `lead incompleto: ${l.id}`);
    for (const c of l.contacts) {
      assert.match(c.email, /@[\w-]+\.exemplo\.pt$/, 'só emails de exemplo');
      assert.match(c.phone, /^\+351 900 /, 'só telefones do intervalo não atribuído');
    }
  }
});

test('mudar a etapa escreve no Close simulado', async () => {
  const { empresas } = await lerLeadsDoClose();
  const etapa = await escolhaDaEtapa(4);
  await close(`/lead/${empresas[0].id}/`, { method: 'PUT', body: { 'x-teste': etapa } });
  const lido = await close(`/lead/${empresas[0].id}/`);
  assert.equal(lido['x-teste'], '4 - Reunião / Resposta');
});

test('há conversas nos três remetentes e enviar acrescenta uma', async () => {
  const antes = await tw(`${MSG_URL}?PageSize=1000`);
  for (const s of Object.values(SENDERS)) {
    assert.ok(antes.messages.some((m) => m.from === s.wa || m.to === s.wa), `sem conversas em ${s.rotulo}`);
  }
  await tw(MSG_URL, { form: { From: SENDERS.prospecao.wa, To: 'whatsapp:+351900123456', Body: 'Olá' } });
  const depois = await tw(`${MSG_URL}?PageSize=1000`);
  assert.equal(depois.messages.length, antes.messages.length + 1);
});

test('a geocodificação não chama o Photon', async () => {
  const c = await coordenadasDaMorada('Rua Nova 10', 'Porto');
  assert.ok(Math.abs(c.lat - 41.15) < 0.05 && Math.abs(c.lng + 8.61) < 0.05);
});
