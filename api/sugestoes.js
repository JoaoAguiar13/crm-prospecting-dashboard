// Sugestões de quem usa a plataforma: POST {texto} escreve · GET lê (só admins).
//
// Sem notificações, sem estados, sem categorias, sem integrações. O pedido era
// «um botãozinho para todos poderem submeter as suas sugestões à medida que vão
// trabalhando» — e o ponto de escrever à medida que se trabalha é não ter de
// parar nem chatear ninguém. Uma sugestão que dispara um aviso a alguém é uma
// interrupção, que é o contrário do que foi pedido.
import { readJson, writeJson } from '../lib/store.js';
import { sessaoValida } from '../lib/portao.js';

const PATH = 'sugestoes.json';
const VAZIO = { sugestoes: [] };
const json = (body, status = 200) => Response.json(body, { status });

/*
 * Tecto do texto.
 *
 * O ficheiro fica no volume e é lido inteiro a cada leitura. Sem tecto, uma
 * sugestão colada de um documento enche-o sozinha. Dois mil caracteres são
 * umas trinta linhas, que chega de sobra para «o filtro de setor devia guardar
 * a escolha».
 */
const MAXIMO = 2000;

/*
 * Quantas ficam.
 *
 * ponytail: guarda as últimas 500 e esquece as mais velhas. É um ficheiro JSON
 * num volume, não uma base de dados; se um dia forem precisas todas, é aí que
 * muda de sítio.
 */
const QUANTAS = 500;

async function handler(req) {
  /*
   * O portão, e não o `getSession`.
   *
   * O `admin` do cookie é o que era verdade no dia do login, e o cookie dura 30
   * dias. Quem for despromovido continuaria a ler as sugestões todas durante um
   * mês. O `sessaoValida` relê a lista de acessos e recalcula o nível — é a
   * regra da casa, e a lista de sugestões tem nomes de quem as escreveu.
   */
  const s = await sessaoValida(req.headers.get('cookie'));
  if (!s) return json({ error: 'Sem sessão.' }, 401);

  if (req.method === 'GET') {
    if (!s.admin) return json({ error: 'Só admins.' }, 403);
    const db = await readJson(PATH, VAZIO);
    return json(db, 200);
  }

  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405);

  const b = await req.json().catch(() => ({}));
  const texto = String(b.texto ?? '').trim();
  if (!texto) return json({ error: 'A sugestão está vazia.' }, 400);
  if (texto.length > MAXIMO) {
    return json({ error: `A sugestão tem ${texto.length} caracteres; o máximo são ${MAXIMO}.` }, 400);
  }

  const db = await readJson(PATH, VAZIO);
  db.sugestoes = [{ texto, por: s.email, quando: new Date().toISOString() }, ...(db.sugestoes || [])].slice(0, QUANTAS);
  await writeJson(PATH, db);
  return json({ ok: true, total: db.sugestoes.length });
}

export { handler as GET, handler as POST };
