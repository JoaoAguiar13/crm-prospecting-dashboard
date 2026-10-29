// Verificação da plataforma, sem dependências. Corre em segundos.
//
// Existe porque este repositório publica direto para produção com `vercel
// deploy` e não tinha nada entre um commit e os comerciais. E o primeiro
// commit desta verificação provou a sua própria necessidade: o package.json
// referia este ficheiro e o ficheiro não existia — o .gitignore é uma lista
// branca (`*` e depois `!...`), `scripts/` não estava na lista, e o git
// ignorou-o em silêncio. A verificação 5 apanha exatamente isso.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let erros = 0;
const falha = (m) => { erros++; console.error('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

// 1. Sintaxe de todo o JS servido (servidor, rotas, libs).
//    A lista vem do disco, não escrita à mão: a versão anterior tinha
//    'middleware.js' fixo e passou a acusar erro quando esse ficheiro saiu na
//    migração. Um verificador que precisa de ser mantido a par das mudanças é
//    um verificador que alguém acaba por desligar.
const js = [
  ...['server.mjs'].filter((f) => existsSync(f)),
  ...readdirSync('api').map((f) => 'api/' + f),
  ...readdirSync('lib').map((f) => 'lib/' + f),
].filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
for (const f of js) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { falha(`${f}: ${String(e.stderr).split('\n')[0]}`); }
}
ok(`sintaxe de ${js.length} ficheiros JS`);

// 2. Sintaxe dos <script> das três páginas
const tmp = mkdtempSync(join(tmpdir(), 'verificar-'));
for (const page of ['index.html', 'login.html', 'admin.html']) {
  const blocos = [...readFileSync(page, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const p = join(tmp, page + '.js');
  writeFileSync(p, blocos.join('\n;\n'));
  try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); ok(`${page}: ${blocos.length} bloco(s) de script`); }
  catch (e) { falha(`${page}: ${String(e.stderr).split('\n')[0]}`); }
}

// 3. Todos os handlers inline do index.html têm função definida.
//    Foi um refactor de renomeação (ph → key) que motivou isto: um onclick a
//    apontar para uma função que já não existe só rebenta ao clique.
const idx = readFileSync('index.html', 'utf8');
const chamados = new Set();
for (const m of idx.matchAll(/on(?:click|change|input|keydown|submit)="\s*(?:if\([^)]*\)\s*)?([a-zA-Z_$][\w$]*)\s*\(/g)) chamados.add(m[1]);
const definidos = new Set([...idx.matchAll(/(?:function\s+|const\s+|let\s+)([a-zA-Z_$][\w$]*)/g)].map(m => m[1]));
const embutidos = new Set(['event', 'this', 'alert', 'confirm', 'window', 'document', 'if', 'for', 'while', 'return']);
const semDef = [...chamados].filter(f => !definidos.has(f) && !embutidos.has(f));
if (semDef.length) falha('handlers sem função definida: ' + semDef.join(', '));
else ok(`${chamados.size} handlers inline, todos definidos`);

// 4. Os remetentes usados na UI existem no mapa do servidor
const lib = readFileSync('lib/twilio.js', 'utf8');
const noMapa = new Set([...lib.matchAll(/^\s*([a-z]+):\s*\{\s*wa:/gm)].map(m => m[1]));
const naUI = new Set([...idx.matchAll(/SENDER_COR=\{([^}]+)\}/g)].flatMap(m => [...m[1].matchAll(/([a-z]+):/g)].map(x => x[1])));
const fora = [...naUI].filter(k => !noMapa.has(k));
if (fora.length) falha('remetentes na UI sem entrada em SENDERS: ' + fora.join(', '));
else if (noMapa.size) ok(`remetentes coerentes entre UI e servidor (${[...noMapa].join(', ')})`);

// 5. Tudo o que o package.json e o vercel.json referem existe E está versionado.
//    O .gitignore é uma lista branca: um ficheiro novo fora dela desaparece do
//    commit sem erro nenhum. `git ls-files` é a verdade do que vai no deploy.
const versionados = new Set(execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const [nome, cmd] of Object.entries(pkg.scripts || {})) {
  for (const m of String(cmd).matchAll(/(?:^|\s)(?:node\s+)?([\w./-]+\.(?:mjs|js))/g)) {
    if (!existsSync(m[1])) falha(`package.json script "${nome}" refere ${m[1]}, que não existe`);
    else if (!versionados.has(m[1])) falha(`${m[1]} existe mas NÃO está versionado — falta no whitelist do .gitignore`);
  }
}
// 5b. A regra de "precisa de uma pessoa" tem de existir num sítio só. Esteve
//     escrita em dois, e os dois números discordaram no mesmo ecrã (4 e 66).
{
  const html = readFileSync('index.html', 'utf8');
  const inline = (html.match(/\?\.bot\s*\|\|\s*t\.assumida/g) || []).length;
  if (inline > 1) falha(`a regra "precisa de uma pessoa" aparece ${inline}× em index.html — devia ser só dentro de precisaDePessoa()`);
  else if (!html.includes('precisaDePessoa')) falha('precisaDePessoa() desapareceu do index.html');
  else ok('a regra de "por responder" existe num sítio só');
}

// 5c. Nenhum código do Twilio pode chegar ao ecrã sem uma frase que diga o que
//     fazer. A bolha da conversa mostrava «· erro 63024», que para quem vende
//     não é informação nenhuma. A explicação vem do servidor
//     (lib/erros-twilio.js) e a UI só a mostra.
{
  const html = readFileSync('index.html', 'utf8');
  if (/erro\s*'\s*\+\s*m\.err\b/.test(html) || /\$\{m\.err\}/.test(html)) {
    falha('index.html mostra o código do Twilio a cru — usar m.erro.curto/.frase (lib/erros-twilio.js)');
  } else if (!html.includes('m.erro.curto')) {
    falha('a bolha deixou de mostrar a explicação do erro (m.erro.curto)');
  } else ok('os erros do Twilio chegam ao ecrã explicados, não em código');
}

// 5d. Uma variável CSS usada e nunca definida não dá erro nenhum: o browser
//     descarta a declaração e a propriedade fica no valor inicial. Um
//     `border-bottom: 1px solid var(--nao-existe)` não fica com uma cor
//     errada — fica SEM BORDA, e ninguém repara a ler o código.
//
//     A 10/09/2026 havia sete usos assim, todos no ecrã das Conversas: a linha
//     separadora media 0px e as chips dos remetentes não tinham contorno
//     nenhum, portanto não se lia que eram botões. Alguém escreveu `--line` e
//     `--muted` onde a paleta do comercial diz `--border` e `--text-2`.
{
  const html = readFileSync('index.html', 'utf8');
  const usados = new Set([...html.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
  const definidos = new Set([...html.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const orfaos = [...usados].filter((v) => !definidos.has(v));
  if (orfaos.length) {
    falha(`index.html usa variáveis CSS que nunca define: ${orfaos.join(', ')} — o browser descarta a declaração inteira`);
  } else ok(`as ${usados.size} variáveis CSS usadas estão todas definidas`);
}

// 5e. A escala de tamanhos existe para ser usada. Quinze `font-size` estavam
//     escritos à mão, cinco deles ABAIXO do piso da escala — ou seja, a escala
//     não descrevia o que o ecrã fazia. Agora descreve, e esta regra é o que
//     impede que volte a divergir.
//
//     A excepção é o botão de fechar do maplibre: é chrome de uma biblioteca,
//     dimensionado pelo próprio, e não faz parte da tipografia da app.
{
  const html = readFileSync('index.html', 'utf8');
  const mao = [...html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
    .map((m) => ({ px: m[1], linha: html.slice(0, m.index).split('\n').length }))
    .filter((x) => !html.split('\n')[x.linha - 1].includes('maplibregl'));
  if (mao.length) {
    falha(`index.html tem ${mao.length} font-size em px à mão (linhas ${mao.map((x) => x.linha).join(', ')}) — usar a escala --fs-0..4`);
  } else ok('os tamanhos de letra vêm todos da escala');
}

// 5f. A regra central da prospeção — quem é uma PESSOA e quem é uma caixa
//     geral — vive em três funções no index.html. A 11/09/2026 apaguei-as sem
//     querer: estavam ao lado do bloco do n8n e foram à frente com ele, porque
//     apaguei por POSIÇÃO em vez de por nome.
//
//     O `person is not defined` que se seguiu partiu a coluna de contacto, a
//     ficha do lead, o cabeçalho da conversa e a guarda do «Iniciar sequência».
//     Nada disso deu erro visível: cada um morria dentro do seu try.
//
//     Um verificador genérico de nomes por definir precisaria de um analisador
//     de sintaxe, e este repositório vale por não ter dependências. Isto é o
//     que interessa mesmo, e é concreto.
{
  const html = readFileSync('index.html', 'utf8');
  const precisam = ['GENERIC', 'isPersonal', 'person', 'paraEmail'];
  const faltam = precisam.filter((n) => !new RegExp(`(?:const|let|var|function)\\s+${n}\\b`).test(html));
  if (faltam.length) {
    falha(`index.html usa mas não define: ${faltam.join(', ')} — é a regra de «só se prospeta a uma pessoa»`);
  } else ok('a regra de quem é pessoa e quem é caixa geral está definida');
}

// 5g. A marca que diz onde o cursor fica ao escrever um email vive em dois
//     sítios do index.html: a constante que a janela procura, e o corpo dos
//     templates novos criados na secção Campanhas. Se divergirem, nada dá erro
//     — o cursor passa a cair no fim do email e ninguém percebe porquê, porque
//     continua tudo a funcionar.
//
//     O mesmo se alguém apagar a procura: a marca ficaria escrita no email que
//     chega à empresa.
{
  const html = readFileSync('index.html', 'utf8');
  const marca = /const\s+MARCA_DO_MEIO\s*=\s*'([^']+)'/.exec(html);
  const corpo = /const\s+DEFAULT_BODY\s*=\s*'([^']*)'/.exec(html);
  if (!marca) {
    falha('index.html não define MARCA_DO_MEIO — é o que põe o cursor onde falta escrever');
  } else if (!corpo) {
    falha('index.html não define DEFAULT_BODY — é o corpo de um template novo');
  } else if (!corpo[1].includes(marca[1])) {
    // Compara-se com o VALOR da constante, não com o literal: trocar a marca
    // num sítio e não no outro é exactamente o que isto tem de apanhar.
    falha(`o DEFAULT_BODY não traz ${marca[1]} — um template novo nasce sem o sítio onde o cursor deve ficar`);
  } else if (!/function\s+porCursorNoMeio\b/.test(html)) {
    // A DEFINIÇÃO, não o nome: procurar só o nome encontrava a chamada, e
    // renomear a função passava despercebido.
    falha('porCursorNoMeio() desapareceu — a marca iria dentro do email para a empresa');
  } else ok(`a marca ${marca[1]} está na janela do email e nos templates novos`);
}

// O script de teste usa um glob (`test/*.test.mjs`), que a regra acima não
// alcança — e um teste que o git ignora é um teste que nunca corre no CI.
for (const f of readdirSync('test').filter((n) => n.endsWith('.test.mjs'))) {
  if (!versionados.has(`test/${f}`)) falha(`test/${f} existe mas NÃO está versionado — falta no whitelist do .gitignore`);
}
ok('referências do package.json existem e estão versionadas');

console.log(erros ? `\n${erros} problema(s).` : '\nTudo verde.');
process.exit(erros ? 1 : 0);
