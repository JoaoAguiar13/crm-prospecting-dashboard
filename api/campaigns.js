// Campanhas de outreach: GET lista · POST cria/atualiza {id?, name, tipo, estado, delay1, delay2, variants:{A:{email,wa},B:{email,wa}}} · DELETE {id}
// Os emails vivem no Close (email templates) e as mensagens WhatsApp no Twilio (Content); aqui só ficam os ids. A atribuição lead→campanha está no Close (campo Campanha).
import { getSession } from '../lib/session.js';
import { readJson, writeJson } from '../lib/store.js';
import { close, CAMPANHA_FIELD } from '../lib/close.js';

const PATH = 'campanhas.json', EMPTY = { campaigns: [] };
const clean = s => String(s || '').trim();

async function syncCloseChoices(names) {
  // o campo "Campanha" no Close é uma lista de escolhas: mantém-na igual à lista de campanhas (editável também lá)
  const f = await close(`/custom_field/lead/${CAMPANHA_FIELD}/`);
  const want = [...new Set(names.filter(Boolean))];
  const cur = f.choices || [];
  if (want.length && (want.some(n => !cur.includes(n)) || cur.some(c => !want.includes(c) && c !== '(nenhuma)')))
    await close(`/custom_field/lead/${CAMPANHA_FIELD}/`, { method: 'PUT', body: { choices: [...want, ...cur.filter(c => !want.includes(c))] } });
}

async function handler(req) {
  const s = await getSession(req); if (!s) return Response.json({ error: 'Sem sessão.' }, { status: 401 });
  const db = await readJson(PATH, EMPTY);
  if (req.method === 'GET') return Response.json(db, { headers: { 'cache-control': 'no-store' } });
  const b = await req.json().catch(() => ({}));
  if (req.method === 'DELETE') {
    /*
     * Sem `id`, o filtro abaixo ficava com tudo o que tivesse um id definido —
     * ou seja, não apagava nada e devolvia 200 na mesma. Um DELETE que responde
     * «correu bem» sem ter feito nada é pior do que um erro.
     */
    const id = clean(b.id);
    if (!id) return Response.json({ error: 'Falta dizer que campanha apagar.' }, { status: 400 });
    if (!db.campaigns.some(c => c.id === id)) {
      return Response.json({ error: 'Não há nenhuma campanha com esse id.' }, { status: 404 });
    }
    db.campaigns = db.campaigns.filter(c => c.id !== id);
  } else if (req.method === 'POST') {
    const name = clean(b.name); if (!name) return Response.json({ error: 'Nome em falta.' }, { status: 400 });
    /*
     * O nome da campanha viaja para o Close como valor de uma lista de
     * escolhas (`syncCloseChoices`). Um nome de 5000 caracteres ia para lá
     * inteiro e ficava na interface para sempre. Oitenta chega de sobra para
     * «Setembro '26 - Porto».
     */
    if (name.length > 80) {
      return Response.json({ error: `O nome da campanha tem ${name.length} caracteres; o máximo são 80.` }, { status: 400 });
    }
    if (db.campaigns.some(c => c.name === name && c.id !== b.id)) return Response.json({ error: 'Já existe uma campanha com esse nome.' }, { status: 400 });
    const v = k => ({ email: clean(b.variants?.[k]?.email) || null, wa: clean(b.variants?.[k]?.wa) || null });
    const c = { id: b.id || 'cmp_' + Date.now().toString(36), name, tipo: b.tipo === 'Escola' ? 'Escola' : 'Empresa',
      estado: ['ativa', 'pausada', 'rascunho'].includes(b.estado) ? b.estado : 'rascunho',
      delay1: Math.max(1, parseInt(b.delay1) || 5760), delay2: Math.max(1, parseInt(b.delay2) || 4320),
      variants: { A: v('A'), B: v('B') } };
    const i = db.campaigns.findIndex(x => x.id === c.id);
    if (i >= 0) { const old = db.campaigns[i]; db.campaigns[i] = { ...old, ...c }; if (old.name !== name) db.renamed = { from: old.name, to: name }; }
    else db.campaigns.push({ ...c, createdAt: new Date().toISOString().slice(0, 10), by: s.email });
  } else return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const renamed = db.renamed; delete db.renamed;
  await writeJson(PATH, db);
  try { await syncCloseChoices(db.campaigns.map(c => c.name)); } catch (e) { console.error('choices Close', e.message); }
  return Response.json({ ...db, renamed });
}
export { handler as GET, handler as POST, handler as DELETE };
