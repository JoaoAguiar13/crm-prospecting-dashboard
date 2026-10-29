// Servidor da plataforma. Substitui o que o Vercel fazia por configuração:
// servir as páginas, o gate de sessão, e o encaminhamento de
// /api/<nome> para api/<nome>.js.
//
// Os handlers não mudaram: já eram `Request` → `Response` da Web API, que é
// o que os torna portáveis. O que aqui está é a cola entre o http do Node e
// essa API — e é por isso que a migração cabe num ficheiro.
// Primeiro import de propósito: no modo demo põe valores por omissão no ambiente
// antes de os outros módulos o lerem (lib/demo.js).
import { DEMO, DEMO_EMAIL, prepararDemo } from './lib/demo.js';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessaoValida } from './lib/portao.js';
import { sign, setCookie } from './lib/session.js';
import { talvezComprimir } from './lib/comprimir.js';
import { manterFresco } from './lib/leads.js';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT) || 3000;

// Sem SESSION_SECRET o servico arranca na mesma e fica num ciclo de login
// infinito: o `verify` falha fechado e manda toda a gente para /login, e o
// POST /api/auth rebenta com "Zero-length key is not supported" — um erro do
// Node sobre criptografia, que nao diz a ninguem qual e' a variavel que falta.
// Mais vale nao arrancar e dizer porque.
if (!process.env.SESSION_SECRET) {
  console.error(
    'SESSION_SECRET em falta: sem ele ninguem consegue entrar, e o erro que aparece ' +
    'e um DataError de criptografia que nao ajuda nada.\n' +
    'Gera um com:  openssl rand -hex 32',
  );
  process.exit(1);
}

const PAGINAS = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/login': 'login.html',
  '/login.html': 'login.html',
  '/admin': 'admin.html',
  '/admin.html': 'admin.html',
};

/*
 * O que fica fora do gate, e porquê:
 *   /login      — é a porta de entrada.
 *   /api/auth   — é o que cria a sessão.
 *   /api/close-hook — vem do Close, não de um browser; autentica-se por HMAC.
 * Escrito por extenso porque uma lista explícita engana menos do que a
 * expressão regular invertida que o middleware do Vercel usava.
 */
const SEM_GATE = new Set(['/login', '/login.html', '/api/auth', '/api/close-hook']);

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

/*
 * Tecto do corpo de um pedido.
 *
 * Nenhuma rota desta plataforma precisa de mais: o maior corpo que se escreve
 * é um formulário de publicar trabalho, com uns 2 KB. Sem tecto, um pedido
 * podia obrigar o servidor a juntar em memória o que quisesse — e é um
 * processo só, portanto levava a plataforma toda com ele.
 */
const MAXIMO_DO_CORPO = 1024 * 1024;

class CorpoGrandeDemais extends Error {}

/** Converte o pedido do Node numa Request da Web API. */
async function paraRequest(req, url) {
  const pedacos = [];
  let tamanho = 0;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    for await (const p of req) {
      tamanho += p.length;
      if (tamanho > MAXIMO_DO_CORPO) throw new CorpoGrandeDemais();
      pedacos.push(p);
    }
  }
  const corpo = Buffer.concat(pedacos);
  return new Request(url, { method: req.method, headers: req.headers, body: corpo.length ? corpo : undefined });
}

/** Escreve uma Response da Web API na resposta do Node. */
async function escrever(req, res, resposta) {
  const headers = {};
  // Vários Set-Cookie têm de sair como linhas separadas.
  const cookies = resposta.headers.getSetCookie?.() || [];
  for (const [k, v] of resposta.headers.entries()) if (k.toLowerCase() !== 'set-cookie') headers[k] = v;
  if (cookies.length) headers['set-cookie'] = cookies;
  const bruto = Buffer.from(await resposta.arrayBuffer());
  const saida = talvezComprimir(req, res, headers, bruto);
  res.writeHead(resposta.status, saida.headers);
  res.end(saida.corpo);
}

const existe = (p) => access(p).then(() => true, () => false);

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const caminho = url.pathname;

  try {
    if (caminho === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }

    /*
     * Modo demo: não há login. Quem abre uma página sem sessão recebe logo uma,
     * como administrador de demonstração, e o /login manda de volta para a app.
     */
    if (DEMO && !caminho.startsWith('/api/')) {
      const temSessao = await sessaoValida(req.headers.cookie);
      if (!temSessao || caminho.startsWith('/login')) {
        const cab = { location: caminho.startsWith('/login') ? '/' : url.pathname + url.search };
        if (!temSessao) cab['set-cookie'] = setCookie(await sign({ email: DEMO_EMAIL, name: 'Utilizador demo', admin: true }));
        res.writeHead(302, cab); res.end(); return;
      }
    }

    /*
     * O portão vem ANTES de se ler o corpo.
     *
     * Estava depois, e por isso quem não tinha sessão nenhuma conseguia
     * obrigar o servidor a juntar em memória um corpo inteiro antes de levar o
     * 401. O portão só precisa do cookie, que vem no cabeçalho.
     */
    if (!SEM_GATE.has(caminho)) {
      const sessao = await sessaoValida(req.headers.cookie);
      if (!sessao) {
        if (caminho.startsWith('/api/')) { res.writeHead(401, { 'content-type': 'text/plain' }); res.end('Unauthorized'); return; }
        res.writeHead(302, { location: '/login' }); res.end(); return;
      }
      if ((caminho === '/admin' || caminho === '/admin.html') && !sessao.admin) { res.writeHead(302, { location: '/' }); res.end(); return; }
    }

    const pedido = await paraRequest(req, url);

    const rota = caminho.match(/^\/api\/([\w-]+)$/);
    if (rota) {
      const ficheiro = join(RAIZ, 'api', `${rota[1]}.js`);
      if (!(await existe(ficheiro))) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"rota não existe"}'); return; }
      const modulo = await import(ficheiro);
      const handler = modulo[req.method] || modulo.default;
      if (!handler) { res.writeHead(405, { 'content-type': 'application/json' }); res.end('{"error":"método não permitido"}'); return; }
      await escrever(req, res, await handler(pedido));
      return;
    }

    // Páginas e ficheiros estáticos. Só o que está na lista ou na pasta
    // assets — não se serve a árvore toda, que é como se servem segredos sem
    // dar por isso.
    const nome = PAGINAS[caminho] || (/^\/assets\/[\w.-]+$/.test(caminho) ? caminho.slice(1) : null);
    if (nome) {
      const f = join(RAIZ, nome);
      if (await existe(f)) {
        const cab = { 'content-type': TIPOS[extname(nome)] || 'application/octet-stream', 'cache-control': nome.endsWith('.html') ? 'no-store' : 'public, max-age=3600' };
        const est = talvezComprimir(req, res, cab, await readFile(f));
        res.writeHead(200, est.headers);
        res.end(est.corpo);
        return;
      }
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Não existe');
  } catch (e) {
    if (e instanceof CorpoGrandeDemais) {
      /*
       * Responder sem ter lido o corpo todo deixa o resto dos bytes no socket,
       * e o pedido seguinte na mesma ligação começa a meio deles — o cliente
       * apanha um ECONNRESET numa chamada que não tem nada a ver com esta.
       * Medido a 12/09/2026, a testar isto mesmo.
       *
       * Fechar a ligação é o que o cliente sabe interpretar: reabre e continua.
       */
      res.writeHead(413, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ error: 'O pedido é grande de mais.' }));
      req.destroy();
      return;
    }
    /*
     * A mensagem fica no registo; para o cliente vai uma frase e mais nada.
     * `e.message` levava nomes de ficheiros e de campos internos para o ecrã,
     * e nenhum deles ajuda quem está a vender.
     */
    console.error(req.method, caminho, '→', e.stack || e.message);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Erro interno. Já ficou registado; se repetir, guarda a hora.' }));
  }
});

if (DEMO) await prepararDemo();
servidor.listen(PORTA, () => console.log(DEMO
  ? `modo demo (dados fictícios, em memória): http://localhost:${PORTA}`
  : `plataforma a servir na porta ${PORTA}`));

/*
 * A lista refresca-se sozinha.
 *
 * Sem isto só refrescava quando alguém carregava em «Atualizar» ou quando o
 * webhook do Close disparava — e o webhook não dispara, porque falta a chave.
 * A 10/09 a lista tinha cinco dias.
 *
 * Desliga-se com REFRESCAR_LEADS=0, se algum dia fizer falta.
 */
if (process.env.REFRESCAR_LEADS !== '0') manterFresco();

// A Railway manda SIGTERM antes de substituir o contentor; fechar em condições
// evita cortar um pedido a meio.
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
