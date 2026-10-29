#!/usr/bin/env node
/*
 * Constrói a demo estática (GitHub Pages) a partir do código da plataforma.
 *
 *   node scripts/construir-demo.mjs [pasta]            → constrói em _site/ (por omissão)
 *   node scripts/construir-demo.mjs --servir [--porta 4173]   → constrói e serve localmente
 *
 * A demo corre as MESMAS rotas de api/ no browser. São handlers
 * `Request → Response` da Web API, que funcionam fora do Node. O que o build
 * acrescenta ou ajusta:
 *
 *   - demo/navegador.js intercepta o fetch('/api/…') da interface e chama o
 *     handler certo, com DEMO_MODE=1 (Close e Twilio simulados por lib/demo.js);
 *   - os módulos do Node que as rotas importam (fs/promises, path, os, crypto)
 *     passam a apontar para os equivalentes em demo/shims/;
 *   - a sessão não pode vir de um cookie (o browser não deixa pôr esse
 *     cabeçalho num Request): o lib/session.js da demo aceita também a sessão
 *     assinada que o navegador.js guarda em memória;
 *   - os links para /login e /admin passam a relativos, porque no GitHub Pages
 *     o site vive numa subpasta e não na raiz do domínio.
 *
 * Cada ajuste confirma que encontrou o que procurava. Se o código mudar e o
 * build deixar de acompanhar, falha com uma frase a dizer onde, em vez de
 * publicar uma demo partida.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const servir = args.includes('--servir');
const iPorta = args.indexOf('--porta');
const porta = iPorta >= 0 ? Number(args[iPorta + 1]) : 4173;
const pasta = args.find((a, i) => !a.startsWith('--') && (iPorta < 0 || i !== iPorta + 1));
const DESTINO = path.resolve(RAIZ, pasta || '_site');
const MARCA = '.demo-estatica';

// O que é só do servidor fica de fora: o webhook do Close e a compressão HTTP.
const SO_SERVIDOR = new Set(['api/close-hook.js', 'lib/comprimir.js']);
const SHIMS = { 'node:fs/promises': 'fs-promises.js', 'node:path': 'path.js', 'node:os': 'os.js', 'node:crypto': 'crypto.js' };

const falhar = (m) => { console.error('✗ ' + m); process.exit(1); };
const ler = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const escrever = (f, conteudo) => {
  const p = path.join(DESTINO, f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, conteudo);
};
function trocar(texto, de, para, onde, vezes = null) {
  const n = texto.split(de).length - 1;
  if (!n || (vezes !== null && n !== vezes)) {
    falhar(`${onde}: esperava ${vezes ?? 'pelo menos uma'} ocorrência de ${JSON.stringify(de)} e encontrei ${n}. O código mudou e o build tem de acompanhar.`);
  }
  return texto.split(de).join(para);
}

// ------------------------------------------------------------ destino
// Só se apaga uma pasta que este script criou (tem a marca) ou que está vazia:
// um caminho errado na linha de comandos não pode levar o projeto com ele.
if (RAIZ === DESTINO || RAIZ.startsWith(DESTINO + path.sep)) falhar('o destino não pode ser o projeto nem uma pasta acima dele.');
if (fs.existsSync(DESTINO) && fs.readdirSync(DESTINO).length && !fs.existsSync(path.join(DESTINO, MARCA))) {
  falhar(`${DESTINO} já existe, não está vazia e não foi criada por este script.`);
}
fs.rmSync(DESTINO, { recursive: true, force: true });

// ------------------------------------------------------------ 1. rotas e bibliotecas
const shimExporta = (ficheiro, nome) => new RegExp(`export\\s+(async\\s+)?(function|const|let)\\s+${nome}\\b`).test(ler(`demo/shims/${ficheiro}`));

const modulos = ['api', 'lib']
  .flatMap((d) => fs.readdirSync(path.join(RAIZ, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`))
  .filter((f) => !SO_SERVIDOR.has(f));

for (const f of modulos) {
  let t = ler(f);
  for (const m of t.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](node:[\w/]+)['"]/g)) {
    if (!SHIMS[m[2]]) continue; // apanhado já a seguir, com uma mensagem melhor
    for (const nome of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!shimExporta(SHIMS[m[2]], nome)) falhar(`${f} importa ${nome} de ${m[2]}, e demo/shims/${SHIMS[m[2]]} não o exporta.`);
    }
  }
  t = t.replace(/(from\s*|import\s*\(\s*)(['"])(node:[\w/]+)\2/g, (_, antes, aspas, nome) => {
    if (!SHIMS[nome]) falhar(`${f} importa ${nome}, que não tem equivalente em demo/shims/.`);
    const rel = path.posix.relative(path.posix.dirname(f), `demo/shims/${SHIMS[nome]}`);
    return `${antes}${aspas}${rel.startsWith('.') ? rel : './' + rel}${aspas}`;
  });
  if (f === 'lib/session.js') {
    t = trocar(t, "req.headers.get('cookie')", "(req.headers.get('cookie') || globalThis.__SESSAO_DEMO__ || '')", f, 1);
  }
  escrever(f, t);
}

// ------------------------------------------------------------ 2. a demo no browser
for (const f of ['demo/navegador.js', ...fs.readdirSync(path.join(RAIZ, 'demo/shims')).map((s) => `demo/shims/${s}`)]) {
  escrever(f, ler(f));
}

// ------------------------------------------------------------ 3. páginas
const SCRIPT = '<head>\n<script src="demo/navegador.js"></script>';

let index = trocar(ler('index.html'), '<head>', SCRIPT, 'index.html', 1);
index = trocar(index, "location.href='/admin'", "location.href='admin.html'", 'index.html');
index = trocar(index, "location.href='/login'", "location.href='./'", 'index.html');
index = trocar(index, "location.replace('/login')", "location.replace('./')", 'index.html');
escrever('index.html', index);

let admin = trocar(ler('admin.html'), '<head>', SCRIPT, 'admin.html', 1);
admin = trocar(admin, 'href="/"', 'href="./"', 'admin.html');
escrever('admin.html', admin);

escrever('.nojekyll', '');
escrever(MARCA, 'Pasta gerada por scripts/construir-demo.mjs. Pode ser apagada.\n');

// ------------------------------------------------------------ 4. o que saiu
for (const f of modulos) {
  const t = fs.readFileSync(path.join(DESTINO, f), 'utf8');
  if (/(from\s*|import\s*\(\s*)['"]node:/.test(t)) falhar(`${f} ainda importa um módulo do Node.`);
  for (const m of t.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    if (!fs.existsSync(path.join(DESTINO, path.dirname(f), m[1]))) falhar(`${f} importa ${m[1]}, que não está na demo.`);
  }
}
for (const [pagina, html] of [['index.html', index], ['admin.html', admin]]) {
  if (/location\.(href|replace)\(?\s*=?\s*\(?['"]\/(login|admin)/.test(html)) falhar(`${pagina} ainda manda para a raiz do domínio.`);
}

console.log(`demo estática construída em ${path.relative(RAIZ, DESTINO) || DESTINO} (${modulos.length} módulos)`);

// ------------------------------------------------------------ servir (opcional)
if (servir) {
  const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  http.createServer((req, res) => {
    let f = path.join(DESTINO, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (f !== DESTINO && !f.startsWith(DESTINO + path.sep)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Não existe'); return; }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  }).listen(porta, () => console.log(`a servir em http://localhost:${porta}/`));
}
