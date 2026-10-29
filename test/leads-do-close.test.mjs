/*
 * Ler os leads direto do Close, para a lista não congelar quando o n8n cai.
 *
 * O que se testa é o mapeamento — é aqui que mora tudo o que pode estar errado,
 * e um erro de mapeamento não dá erro nenhum: dá uma coluna vazia que ninguém
 * repara. A leitura em si foi provada ao vivo a 10/09/2026: leads em 8 s,
 * todos classificados, e uma comparação campo a campo com a cópia que o n8n
 * tinha deixado (nome, morada e coordenadas com 0% de diferença).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CLOSE_API_KEY = 'chave-falsa-nenhuma-chamada-sai-daqui';
const { CF } = await import('../lib/close.js');
const { mapearLead } = await import('../lib/leads-close.js');

/* Um lead como o Close o devolve, com os casos que doem: moradas incompletas,
   vários contactos, e a etapa por extenso. */
const doClose = {
  id: 'lead_abc',
  display_name: 'Restaurante Exemplo',
  url: 'http://www.exemplo.pt',
  status_label: 'Parceiro',
  addresses: [
    { address_1: 'R. Dom Marcos da Cruz', city: '' },
    { address_1: '', city: 'Matosinhos', zipcode: '4450-000' },
  ],
  contacts: [
    { id: 'cont_1', name: 'Contabilidade', title: '', emails: [], phones: [] },
    { id: 'cont_2', name: 'Ana', title: 'Sócia', emails: [{ email: 'ana.ribeiro@exemplo.pt' }], phones: [{ phone: '+351900000007' }] },
  ],
  [CF.etapa]: '4 - Reunião / Resposta',
  [CF.campanha]: "Setembro '26 - Porto",
  [CF.variante]: 'B',
  [CF.lat]: 41.2119777,
  [CF.lng]: -8.6973532,
};

test('os campos chegam todos com o nome que a interface le', async () => {
  const l = mapearLead(doClose);
  assert.equal(l.id, 'lead_abc');
  assert.equal(l.name, 'Restaurante Exemplo');
  assert.equal(l.status, 4, 'a etapa vem do prefixo numerico');
  assert.equal(l.campanha, "Setembro '26 - Porto");
  assert.equal(l.variante, 'B');
  assert.equal(l.closeStatus, 'Parceiro');
  assert.equal(l.lat, 41.2119777);
});

test('a morada e a cidade juntam-se de moradas diferentes', async () => {
  const l = mapearLead(doClose);
  assert.equal(l.address, 'R. Dom Marcos da Cruz', 'da primeira que traz morada');
  assert.equal(l.city, 'Matosinhos', 'da primeira que traz cidade, que e outra');
  assert.equal(l.zipcode, '4450-000');
});

test('o email e o telefone saltam contactos vazios', async () => {
  const l = mapearLead(doClose);
  assert.equal(l.email, 'ana.ribeiro@exemplo.pt', 'o primeiro contacto nao tem email');
  assert.equal(l.phone, '+351900000007');
  assert.equal(l.contacts.length, 2, 'mas os contactos vao todos');
  assert.equal(l.contacts[1].title, 'Sócia');
});

test('o url e o link para abrir no Close, e o site vai para website', async () => {
  const l = mapearLead(doClose);
  assert.equal(l.url, 'https://app.close.com/lead/lead_abc/', 'era o n8n que construia isto');
  assert.equal(l.website, 'http://www.exemplo.pt', 'o campo url do Close e o site da empresa');
});

test('um lead vazio nao rebenta nem inventa', async () => {
  const l = mapearLead({ id: 'lead_x' });
  assert.equal(l.name, '');
  assert.equal(l.city, '');
  assert.equal(l.status, 0, 'sem etapa e Nao contactado');
  assert.equal(l.lat, '');
  assert.deepEqual(l.contacts, []);
  assert.equal(l.url, 'https://app.close.com/lead/lead_x/');
  for (const v of Object.values(l)) {
    assert.notEqual(String(v), 'undefined', 'nada pode chegar ao ecra como undefined');
    assert.notEqual(String(v), 'NaN');
  }
});

test('uma etapa sem numero a frente e tratada como Nao contactado', async () => {
  for (const e of ['Reunião', '', null, 'sem numero']) {
    assert.equal(mapearLead({ id: 'lead_x', [CF.etapa]: e }).status, 0);
  }
  assert.equal(mapearLead({ id: 'lead_x', [CF.etapa]: '6 - Para Reciclar' }).status, 6);
  assert.equal(mapearLead({ id: 'lead_x', [CF.etapa]: '7 - Cliente / Parceiro' }).status, 7);
});
