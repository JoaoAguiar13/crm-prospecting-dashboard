// Criar um lead no Close: POST /api/lead-novo {type, name, city, …}.
//
// Chama-se `lead-novo` e não `lead` porque o `/api/lead` já existe e faz outra
// coisa: escreve campos num lead que já lá está (campanha, variante, website).
// Criar e editar são operações diferentes e ficam em ficheiros diferentes.
//
// Era o webhook `add-lead` do n8n, desligado a 09/09/2026 e chamado do browser,
// onde o preflight CORS devolvia 500 — o «Novo lead» não fazia nada.
//
// Como na etapa e nas tarefas: a plataforma já fala com o Close por API
// directa, e criar um lead é um POST.
import { getSession } from '../lib/session.js';
import { close, CF } from '../lib/close.js';
import { coordenadasDaCidade, coordenadasDaMorada, juntarLeadNaCopia } from '../lib/leads.js';

const json = (body, status = 200) => Response.json(body, { status });
const limpar = (v) => String(v ?? '').trim();

/*
 * A «Fase Prospeção» no Close é uma escolha por extenso; na interface é 1 ou 2.
 * Mapeio pelo prefixo numérico, como na etapa: renomear a frase lá não parte
 * isto aqui.
 */
async function escolhaPorNumero(campoId, numero) {
  const f = await close(`/custom_field/lead/${campoId.replace('custom.', '')}/`);
  return (f.choices || []).find((c) => new RegExp(`^\\s*${numero}\\s*-`).test(c)) || null;
}

async function handler(req) {
  const s = await getSession(req);
  if (!s) return json({ error: 'Sem sessão.' }, 401);
  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405);

  const b = await req.json().catch(() => ({}));
  const tipo = limpar(b.type).toLowerCase();
  const name = limpar(b.name);
  const city = limpar(b.city);

  const faltam = [];
  if (tipo !== 'escola' && tipo !== 'empresa') faltam.push('o tipo (escola ou empresa)');
  if (!name) faltam.push('o nome');
  if (!city) faltam.push('a cidade');
  if (faltam.length) return json({ error: `Falta ${faltam.join(' · ')}.` }, 400);

  const email = limpar(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: `Email inválido: ${email}` }, 400);
  }

  /*
   * O pin vai para a morada quando o Photon a encontra perto da cidade; senão
   * para a média dos leads que já temos na mesma cidade. Se a cidade for nova e
   * a morada não se encontrar, o lead é criado na mesma — só não aparece no
   * mapa, e a resposta di-lo. Recusar por causa de um pin seria pior.
   */
  const media = await coordenadasDaCidade(city);
  const naMorada = await coordenadasDaMorada(b.address, city, media).catch(() => null);
  const coords = naMorada || media;

  const corpo = {
    name,
    url: limpar(b.website) || undefined,
    contacts: [],
    addresses: [{ address_1: limpar(b.address) || undefined, city, country: 'PT' }],
    [CF.tipo]: tipo === 'escola' ? 'Escola' : 'Empresa',
  };

  const contacto = limpar(b.contact);
  const phone = limpar(b.phone);
  if (contacto || email || phone) {
    corpo.contacts.push({
      name: contacto || name,
      emails: email ? [{ email, type: 'office' }] : [],
      phones: phone ? [{ phone, type: 'office' }] : [],
    });
  }

  if (coords) {
    corpo[CF.lat] = coords.lat;
    corpo[CF.lng] = coords.lng;
  }

  try {
    if (tipo === 'escola') {
      const ti = limpar(b.schoolType);
      if (ti) corpo[CF.tipoInst] = ti;
      const fase = parseInt(b.phase, 10);
      if (fase === 1 || fase === 2) {
        const escolha = await escolhaPorNumero(CF.fase, fase);
        if (escolha) corpo[CF.fase] = escolha;
      }
    } else {
      const seg = limpar(b.sector);
      if (seg) corpo[CF.segmento] = seg;
    }
  } catch (e) {
    return json({ error: `Não consegui ler as escolhas do Close. ${e.message}` }, 502);
  }

  let criado;
  try {
    criado = await close('/lead/', { method: 'POST', body: corpo });
  } catch (e) {
    return json({ error: `O Close recusou criar o lead. ${e.message}` }, 502);
  }

  /*
   * A lista do Close é eventualmente consistente e o `get-close-leads` está
   * desligado, portanto sem isto o lead novo só apareceria na próxima leitura
   * — que pode nunca acontecer. Junta-se à cópia com os mesmos campos que a
   * interface espera.
   */
  const linha = {
    id: criado.id,
    name: criado.display_name || name,
    city,
    address: limpar(b.address),
    zipcode: '',
    lat: coords?.lat ?? '',
    lng: coords?.lng ?? '',
    email,
    phone,
    status: 0,
    url: criado.url || '',
    type: tipo === 'escola' ? limpar(b.schoolType) : limpar(b.sector),
    phase: tipo === 'escola' ? parseInt(b.phase, 10) || 1 : undefined,
    contacts: [],
  };
  const naCopia = await juntarLeadNaCopia(tipo === 'escola' ? 'escolas' : 'empresas', linha);

  return json({ ...linha, naCopia, semCoordenadas: !coords, pinNaMorada: !!naMorada });
}

export { handler as POST };
