/*
 * Cópia de segurança do volume `/data`, e a forma de a repor.
 *
 * Existe porque o volume da Railway não se lê de fora: o `railway service files`
 * exige uma chave SSH registada na conta, e o `railway ssh` o mesmo. O que dá
 * para fazer sem isso é falar com a própria plataforma, que é o que isto faz.
 *
 * O que se guarda:
 *   acessos.json    quem entra — se se perder, ninguém entra até alguém repor
 *   campanhas.json  atrasos, templates e variantes de cada campanha
 *   leads-cache.json a última lista boa do Close, que é o que se vê quando a
 *                   automação do n8n está em baixo (e a 09/09/2026 estava)
 *
 * O que NÃO se guarda, de propósito: `enrich.json`, que tem a chave de
 * Enrichment de quem a pôs. Uma chave numa cópia de segurança é uma chave a
 * mais no mundo; reintroduz-se na interface, que demora dez segundos.
 *
 * Uso:
 *   SESSION_SECRET=… COMO=admin@empresa.example \
 *     node scripts/copia-de-seguranca.mjs guardar <pasta>
 *   SESSION_SECRET=… COMO=admin@empresa.example \
 *     node scripts/copia-de-seguranca.mjs repor   <pasta>
 *
 * O `SESSION_SECRET` é o da Railway (`railway variables --service prospecting
 * --json`). Corre-se de qualquer máquina; não precisa de acesso ao volume.
 *
 * O `COMO` tem de ser um email que esteja na lista de acessos **como admin**:
 * um cookie assinado com `admin: true` não chega, porque o `/api/access`
 * reconfirma na lista em vez de acreditar no cookie. É a defesa certa, e é por
 * isso que este guião não pode inventar um utilizador.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sign } from '../lib/session.js';

const BASE = process.env.PROSPECTING_URL || 'http://localhost:3000';
const [modo, pasta] = process.argv.slice(2);

if (!['guardar', 'repor'].includes(modo) || !pasta) {
  console.error('uso: node scripts/copia-de-seguranca.mjs guardar|repor <pasta>');
  process.exit(2);
}
if (!process.env.SESSION_SECRET) {
  console.error('falta SESSION_SECRET (railway variables --service prospecting --json)');
  process.exit(2);
}
if (!process.env.COMO) {
  console.error('falta COMO=<email de um admin da lista de acessos>');
  process.exit(2);
}

const cookie = `session=${await sign({ email: process.env.COMO, admin: true })}`;
const chamar = async (rota, opcoes = {}) => {
  const r = await fetch(BASE + rota, {
    ...opcoes,
    headers: { cookie, 'content-type': 'application/json', ...(opcoes.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${rota} → ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

if (modo === 'guardar') {
  mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString();

  const acessos = await chamar('/api/access');
  writeFileSync(join(pasta, 'acessos.json'), JSON.stringify({ users: acessos.users }, null, 1));

  const campanhas = await chamar('/api/campaigns');
  writeFileSync(join(pasta, 'campanhas.json'), JSON.stringify({ campaigns: campanhas.campaigns }, null, 1));

  const r = await fetch(`${BASE}/api/leads`, { headers: { cookie } });
  const leads = JSON.parse(await r.text());
  const at = Number(r.headers.get('x-cache-at')) || Date.now();
  writeFileSync(join(pasta, 'leads-cache.json'), JSON.stringify({ at, text: JSON.stringify(leads) }, null, 1));

  writeFileSync(join(pasta, 'quando.txt'), `${carimbo}\n${BASE}\n`);

  console.log(`cópia em ${pasta}, de ${BASE}`);
  console.log(`  acessos.json      ${acessos.users.length} pessoas`);
  console.log(`  campanhas.json    ${campanhas.campaigns.length} campanhas`);
  console.log(`  leads-cache.json  ${leads.escolas?.length || 0} escolas · ${leads.empresas?.length || 0} empresas · lida em ${new Date(at).toISOString().slice(0, 16)}`);
  console.log('  (enrich.json fica de fora: tem uma chave, e reintroduz-se na interface)');
}

if (modo === 'repor') {
  const ler = (n) => {
    const p = join(pasta, n);
    if (!existsSync(p)) throw new Error(`falta ${p}`);
    return JSON.parse(readFileSync(p, 'utf8'));
  };

  /*
   * Repõe-se pela API, um a um, e não escrevendo o ficheiro: o POST de cada
   * uma valida o que recebe, e o `/api/campaigns` preserva o `id` quando ele
   * vem no corpo — que é o que liga a campanha aos leads no Close.
   */
  const campanhas = ler('campanhas.json').campaigns || [];
  for (const c of campanhas) {
    await chamar('/api/campaigns', { method: 'POST', body: JSON.stringify(c) });
    console.log(`  campanha reposta: ${c.name}`);
  }

  const users = ler('acessos.json').users || [];
  for (const u of users) {
    await chamar('/api/access', { method: 'POST', body: JSON.stringify({ email: u.email, admin: !!u.admin }) });
    console.log(`  acesso reposto: ${u.email}${u.admin ? ' (admin)' : ''}`);
  }

  console.log(`\n${campanhas.length} campanhas e ${users.length} acessos repostos em ${BASE}.`);
  console.log('O cache dos leads não se repõe: refaz-se sozinho na primeira leitura que o n8n atender.');
}
