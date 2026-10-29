/*
 * As tarefas vêm do Close por API directa, sem n8n.
 *
 * Aqui testa-se tudo o que acontece antes de falar com o Close. As idas ao
 * Close foram provadas ao vivo a 10/09/2026: 64 tarefas lidas, uma criada, a
 * mesma concluída (`is_complete: true` confirmado no Close) e depois apagada,
 * com o total a voltar a 64.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'segredo-so-para-os-testes-das-tarefas';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'tarefas-'));
delete process.env.ACCESS_CODE;
delete process.env.CLOSE_API_KEY; // sem chave, qualquer ida ao Close falha — é o que quero medir

const { sign } = await import('../lib/session.js');
const { GET, POST, PATCH } = await import('../api/tasks.js');

const cookie = `session=${await sign({ email: 'admin@empresa.example', admin: true })}`;

const pedir = async (fn, metodo, corpo, comSessao = true) => {
  const r = await fn(new Request('https://exemplo/api/tasks', {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(comSessao ? { cookie } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }));
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
};

test('sem sessao nao passa, em nenhum dos tres', async () => {
  assert.equal((await pedir(GET, 'GET', undefined, false)).status, 401);
  assert.equal((await pedir(POST, 'POST', { leadId: 'l', text: 't', date: '2026-10-01' }, false)).status, 401);
  assert.equal((await pedir(PATCH, 'PATCH', { id: 'x' }, false)).status, 401);
});

test('criar uma tarefa sem lead, sem texto ou sem data e recusado', async () => {
  const semLead = await pedir(POST, 'POST', { text: 'x', date: '2026-10-01' });
  assert.equal(semLead.status, 400);
  assert.match(semLead.corpo.error, /lead/i);

  const semTexto = await pedir(POST, 'POST', { leadId: 'lead_x', date: '2026-10-01' });
  assert.equal(semTexto.status, 400);
  assert.match(semTexto.corpo.error, /texto/i);
});

test('uma data que o Close nao percebe e recusada aqui, com a forma certa na frase', async () => {
  for (const ma of ['amanhã', '01/10/2026', '2026-13-01x', '', null, 20261001]) {
    const r = await pedir(POST, 'POST', { leadId: 'lead_x', text: 'x', date: ma });
    assert.equal(r.status, 400, `${ma} devia ser recusada`);
    assert.match(r.corpo.error, /AAAA-MM-DD/, 'a frase tem de dizer a forma certa');
  }
});

test('concluir sem dizer qual e recusado', async () => {
  const r = await pedir(PATCH, 'PATCH', {});
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /tarefa/i);
});

test('sem CLOSE_API_KEY os erros dizem isso, em vez de rebentarem', async () => {
  const l = await pedir(GET, 'GET');
  assert.equal(l.status, 502);
  assert.match(l.corpo.error, /tarefas do Close/i);
  assert.doesNotMatch(l.corpo.error, /undefined|\[object/i);

  const c = await pedir(POST, 'POST', { leadId: 'lead_x', text: 'x', date: '2026-10-01' });
  assert.equal(c.status, 502);
  assert.match(c.corpo.error, /Close/);

  const p = await pedir(PATCH, 'PATCH', { id: 'task_x' });
  assert.equal(p.status, 502);
  assert.match(p.corpo.error, /Close/);
});

test('um metodo que nao existe da 405, nao 500', async () => {
  const r = await GET(new Request('https://exemplo/api/tasks', { method: 'DELETE', headers: { cookie } }));
  assert.equal(r.status, 405);
});
