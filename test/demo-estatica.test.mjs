// A demo estática (GitHub Pages) é construída a partir do código da plataforma
// por scripts/construir-demo.mjs. Estes testes garantem que o build acompanha o
// código: se uma rota passar a importar outro módulo do Node, ou mudarem os
// links que o build ajusta, fica vermelho aqui antes de a demo partir no ar.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(mkdtempSync(join(tmpdir(), 'demo-estatica-')), 'site');
execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-demo.mjs'), SITE], { stdio: 'pipe' });

const ler = (f) => readFileSync(join(SITE, f), 'utf8');
const modulos = ['api', 'lib'].flatMap((d) => readdirSync(join(SITE, d)).map((f) => `${d}/${f}`));

test('as páginas carregam o fetch da demo antes de qualquer outro script', () => {
  for (const pagina of ['index.html', 'admin.html']) {
    assert.match(ler(pagina), /<head>\s*<script src="demo\/navegador\.js"><\/script>/, pagina);
  }
});

test('nenhum módulo da demo importa o Node', () => {
  for (const f of modulos) assert.doesNotMatch(ler(f), /(from\s*|import\s*\(\s*)['"]node:/, f);
});

test('os links da app passam a relativos (no Pages o site vive numa subpasta)', () => {
  assert.doesNotMatch(ler('index.html'), /location\.(href\s*=|replace\()\s*['"]\/(login|admin)/);
  assert.doesNotMatch(ler('admin.html'), /href="\/"/);
});

test('o atalho da sessão só existe na demo, nunca no código do servidor', () => {
  assert.match(ler('lib/session.js'), /__SESSAO_DEMO__/);
  assert.doesNotMatch(readFileSync(join(RAIZ, 'lib', 'session.js'), 'utf8'), /__SESSAO_DEMO__/);
});

test('as rotas construídas respondem com os dados da demo, sem o Node por baixo', () => {
  // Corre num processo à parte, com os módulos da demo (que importam os shims
  // e não o Node), da mesma forma que o navegador.js os chama.
  const url = (f) => pathToFileURL(join(SITE, f)).href;
  const codigo = `
    const { sign } = await import(${JSON.stringify(url('lib/session.js'))});
    const demo = await import(${JSON.stringify(url('lib/demo.js'))});
    globalThis.__SESSAO_DEMO__ = 'session=' + await sign({ email: demo.DEMO_EMAIL, admin: true });
    await demo.prepararDemo();
    const pedir = async (rota, opcoes = {}) => {
      const m = await import(${JSON.stringify(url('api/'))} + rota.split('?')[0] + '.js');
      const r = await m[opcoes.method || 'GET'](new Request('https://demo.local/api/' + rota, opcoes));
      return r.json();
    };
    const leads = await pedir('leads');
    const quem = await pedir('auth');
    const conversas = await pedir('whatsapp?messages=1');
    const campanhas = await pedir('campaigns');
    console.log(JSON.stringify({ escolas: leads.escolas.length, empresas: leads.empresas.length, quem, mensagens: conversas.messages.length, campanhas: campanhas.campaigns.length }));
  `;
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', codigo], {
    env: { ...process.env, DEMO_MODE: '1', SESSION_SECRET: 'so-para-este-teste', DATA_DIR: join(SITE, '..', 'dados') },
    encoding: 'utf8',
  });
  const r = JSON.parse(saida.trim().split('\n').pop());
  assert.equal(r.escolas, 36);
  assert.equal(r.empresas, 54);
  assert.deepEqual(r.quem, { email: 'admin@empresa.example', admin: true });
  assert.ok(r.mensagens > 10, 'há conversas de WhatsApp');
  assert.equal(r.campanhas, 2);
});
