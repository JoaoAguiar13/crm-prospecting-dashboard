#!/usr/bin/env node
/*
 * Sonda a produção e diz se está tudo de pé.
 *
 *   SESSION_SECRET=… COMO=admin@empresa.example node scripts/sondar-producao.mjs
 *
 * O `SESSION_SECRET` é o da Railway (`railway variables --service prospecting
 * --json`). O `COMO` tem de ser um email da lista de acessos, porque o
 * `/api/access` reconfirma na lista em vez de acreditar no cookie.
 *
 * Só leitura e casos que TÊM de ser recusados. Nada aqui escreve num lead, numa
 * tarefa ou numa conversa a sério — dá para correr a meio do dia sem medo.
 *
 * Escrito a 12/09/2026, depois de dois dias a religar funcionalidades: era
 * preciso uma maneira de confirmar que continua tudo de pé sem abrir o browser
 * e clicar em sete separadores.
 */
import { sign } from '../lib/session.js';

const BASE = process.env.PROSPECTING_URL || 'http://localhost:3000';
const COMO = process.env.COMO || '';

if (!process.env.SESSION_SECRET) {
  console.error('falta SESSION_SECRET (railway variables --service prospecting --json)');
  process.exit(2);
}
if (!COMO) {
  console.error('falta COMO=<email de alguém na lista de acessos>');
  process.exit(2);
}

const cookie = `session=${await sign({ email: COMO, admin: true })}`;
const passou = [];
const falhou = [];
const registar = (nome, bom, detalhe = '') => {
  (bom ? passou : falhou).push(nome);
  console.log(`  ${bom ? '✓' : '✗'} ${nome.padEnd(30)} ${detalhe}`);
};

const pedir = (rota, opts = {}) =>
  fetch(BASE + rota, { ...opts, headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}), ...opts.headers } });

console.log(`\n${BASE}\n`);

console.log('LEITURAS');
for (const [nome, rota, conferir] of [
  ['lista de leads', '/api/leads', (d) => (d.escolas || []).length + (d.empresas || []).length > 1000],
  ['tarefas', '/api/tasks', (d) => Array.isArray(d.tasks)],
  ['templates do WhatsApp', '/api/templates', (d) => (d.templates || []).length > 0],
  ['campanhas', '/api/campaigns', (d) => Array.isArray(d.campaigns)],
  ['acessos', '/api/access', (d) => (d.users || []).length > 0],
  ['conversas caladas', '/api/mute', (d) => Array.isArray(d.muted)],
  ['enrichment', '/api/enrich', (d) => 'configured' in d],
]) {
  const t0 = Date.now();
  let bom = false, detalhe = '';
  try {
    const r = await pedir(rota);
    const d = await r.json().catch(() => ({}));
    bom = r.ok && conferir(d);
    detalhe = `${r.status} · ${Date.now() - t0}ms`;
  } catch (e) {
    detalhe = e.message;
  }
  registar(nome, bom, detalhe);
}

console.log('\nO QUE TEM DE SER RECUSADO, E EM PORTUGUÊS');
/*
 * Cada linha é um defeito que já existiu. Um 200 aqui quer dizer que a guarda
 * caiu; uma frase em inglês quer dizer que quem vende vai ler um código.
 */
for (const [nome, metodo, rota, corpo] of [
  ['etapa fora de 0..7', 'POST', '/api/lead-status', { leadId: 'lead_x', status: 99 }],
  ['etapa em falta (Number(null) é 0)', 'POST', '/api/lead-status', { leadId: 'lead_x' }],
  ['tarefa com data que o Close não lê', 'POST', '/api/tasks', { leadId: 'lead_x', text: 'x', date: 'ontem' }],
  ['concluir tarefa sem dizer qual', 'PATCH', '/api/tasks', {}],
  ['lead sem cidade', 'POST', '/api/lead-novo', { type: 'empresa', name: 'X' }],
  ['contacto sem forma de contacto', 'POST', '/api/contacto', { leadId: 'lead_x', name: 'X' }],
  ['email sem lead', 'POST', '/api/email', { subject: 'x', bodyHtml: 'x' }],
  ['email sem assunto', 'POST', '/api/email', { leadId: 'lead_x', contactId: 'cont_x', bodyHtml: 'x' }],
  ['sugestão vazia', 'POST', '/api/sugestoes', { texto: '   ' }],
  ['campanha com nome sem fim', 'POST', '/api/campaigns', { name: 'x'.repeat(500) }],
  ['apagar campanha sem id', 'DELETE', '/api/campaigns', {}],
]) {
  let bom = false, detalhe = '';
  try {
    const r = await pedir(rota, { method: metodo, body: JSON.stringify(corpo) });
    const d = await r.json().catch(() => ({}));
    const frase = String(d.error || '');
    const portugues = /[ãáàâçéêíóôõú]|falta|inválid|obrigat|precisa|máximo|etapa/i.test(frase);
    bom = r.status === 400 && portugues;
    detalhe = `${r.status} · ${frase.slice(0, 44)}`;
  } catch (e) {
    detalhe = e.message;
  }
  registar(nome, bom, detalhe);
}

console.log('\nSEM SESSÃO NÃO ABRE NADA');
const rotas = ['/api/leads', '/api/tasks', '/api/access', '/api/campaigns', '/api/whatsapp', '/api/mute',
  '/api/templates', '/api/enrich', '/api/job', '/api/lead', '/api/lead-status', '/api/lead-novo',
  '/api/contacto', '/api/email', '/api/sugestoes'];
const abertas = [];
for (const rota of rotas) {
  const r = await fetch(BASE + rota).catch(() => ({ status: 0 }));
  if (r.status !== 401) abertas.push(`${rota} → ${r.status}`);
}
registar(`as ${rotas.length} rotas pedem sessão`, abertas.length === 0, abertas.join(' · '));

console.log('\nO QUE CHEGA AO BROWSER');
const html = await (await pedir('/')).text();
const usadas = new Set([...html.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
const definidas = new Set([...html.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
registar('zero chamadas ao n8n', (html.match(/n8n\(/g) || []).length === 0);
registar('o endereço do n8n não viaja', !/n8n\.cloud|n8n-production/.test(html));
registar('nenhuma variável CSS por definir', [...usadas].every((v) => definidas.has(v)));
/* Uma só: o botão de fechar do maplibre, que é chrome da biblioteca. */
registar('tamanhos de letra pela escala', (html.match(/font-size:\s*\d+(\.\d+)?px/g) || []).length <= 1);

console.log('\nCOMPRESSÃO');
const r = await pedir('/api/leads');
await r.arrayBuffer();
registar('o que sai comprime', r.headers.get('content-encoding') === 'gzip',
  `vary: ${r.headers.get('vary') || 'nenhum'}`);

console.log(`\n${passou.length} passaram · ${falhou.length} falharam`);
if (falhou.length) {
  console.log('\nfalhou:');
  for (const f of falhou) console.log('  ·', f);
}
process.exit(falhou.length ? 1 : 0);
