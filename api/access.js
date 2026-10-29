// Gestão de acessos (só admins): GET lista · POST {email, admin} adiciona/atualiza · DELETE {email} remove
import { getSession } from '../lib/session.js';
import { readAccess, writeAccess, isAdmin, DOMAIN } from '../lib/access.js';

async function handler(req) {
  const s = await getSession(req);
  const acl = await readAccess();
  if (!s || !isAdmin(acl, s.email)) return Response.json({ error: 'Só admins.' }, { status: 403 });
  if (req.method === 'GET') return Response.json({ ...acl, domain: DOMAIN });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: 'Email inválido.' }, { status: 400 });

  if (req.method === 'POST') {
    const u = acl.users.find(x => x.email === email);
    if (u) u.admin = !!body.admin;
    else acl.users.push({ email, admin: !!body.admin, by: s.email, since: new Date().toISOString().slice(0, 10) });
  } else if (req.method === 'DELETE') {
    if (email === s.email) return Response.json({ error: 'Não te podes remover a ti próprio.' }, { status: 400 });
    acl.users = acl.users.filter(x => x.email !== email);
  } else return Response.json({ error: 'Method not allowed' }, { status: 405 });

  /*
   * Ficar sem nenhum admin é uma porta que se fecha por fora: o /api/access só
   * responde a admins, portanto ninguém — nem quem o fez — volta a abrir a
   * lista pela interface. Só se recupera mexendo no volume.
   *
   * A guarda vai aqui, depois de a alteração estar aplicada e antes de gravar,
   * porque assim vale para os dois métodos e para o que vier a seguir. Contar
   * antes obrigava a prever cada caminho; contar depois pergunta a única coisa
   * que interessa: com isto gravado, ainda há quem mande?
   *
   * Despromover-se a si próprio continua a ser possível enquanto sobrar outro
   * admin. É legítimo: alguém sai da equipa e abdica.
   */
  if (!acl.users.some(u => u.admin)) {
    return Response.json(
      { error: 'Tem de ficar pelo menos um admin. Torna outra pessoa admin antes de tirares este.' },
      { status: 400 }
    );
  }

  await writeAccess(acl);
  return Response.json({ ...acl, domain: DOMAIN });
}

export { handler as GET, handler as POST, handler as DELETE };
