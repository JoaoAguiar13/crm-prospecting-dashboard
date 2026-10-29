// Ler os leads direto do Close, quando o n8n não responde.
//
// A lista da plataforma vinha toda do webhook `get-close-leads` do n8n. Com
// esse fluxo desligado — o caso desde algures antes de 09/09/2026 — a lista
// congelava: a 10/09 tinha cinco dias e não havia caminho nenhum para a
// refrescar.
//
// Isto não substitui o n8n. É o que se tenta quando ele falha, e por isso a
// forma devolvida é a MESMA, à letra: `{escolas: [...], empresas: [...]}` com
// os campos que o `mapE`/`mapC` do index.html já lêem.
//
// Equivalência medida a 10/09/2026, comparando leads campo a campo com a
// cópia que o n8n tinha deixado:
//
//   nome     0,0%   morada   0,0%   lat/lng  0,0%   diferentes
//   cidade   0,2%   etapa    1,7%   email    3,9%   campanha 4,6%
//
// e em todas essas o Close era quem tinha o dado mais fresco ou mais completo.
import { close, CF } from './close.js';

/* Quantas páginas se pedem ao mesmo tempo. Catorze páginas em 8 s com quatro. */
const EM_PARALELO = 4;
const POR_PAGINA = 100;

const CAMPOS = [
  'id', 'display_name', 'url', 'status_label', 'addresses', 'contacts',
  CF.etapa, CF.tipo, CF.campanha, CF.variante, CF.lat, CF.lng, CF.fase, CF.segmento, CF.tipoInst,
].join(',');

const texto = (v) => String(v ?? '').trim();

/** A primeira morada que traga cada coisa; nem todas as moradas trazem tudo. */
const daMorada = (l, chave) => {
  for (const a of l.addresses || []) if (texto(a[chave])) return texto(a[chave]);
  return '';
};

/** O primeiro email/telefone de qualquer contacto do lead. */
const doContacto = (l, chave, sub) => {
  for (const c of l.contacts || []) for (const x of c[chave] || []) if (x[sub]) return texto(x[sub]);
  return '';
};

/*
 * A etapa vem por extenso («2 - WhatsApp 1 enviado») e a interface quer o
 * número. Sem etapa é 0, que é «Não contactado» — o mesmo que o cliente já
 * fazia com `parseInt(r.status) || 0`.
 */
const etapa = (l) => {
  const m = /^\s*(\d+)\s*-/.exec(texto(l[CF.etapa]));
  return m ? Number(m[1]) : 0;
};

const fase = (l) => {
  const m = /^\s*(\d+)\s*-/.exec(texto(l[CF.fase]));
  return m ? Number(m[1]) : 1;
};

/*
 * Exportada para ser testável: é aqui que mora tudo o que pode estar errado
 * neste ficheiro, e um erro de mapeamento não dá erro nenhum — dá uma coluna
 * vazia que ninguém repara.
 */
export const mapearLead = (l) => ({
  id: l.id,
  name: texto(l.display_name),
  city: daMorada(l, 'city'),
  address: daMorada(l, 'address_1'),
  zipcode: daMorada(l, 'zipcode'),
  lat: l[CF.lat] ?? '',
  lng: l[CF.lng] ?? '',
  email: doContacto(l, 'emails', 'email'),
  phone: doContacto(l, 'phones', 'phone'),
  status: etapa(l),
  campanha: texto(l[CF.campanha]),
  variante: texto(l[CF.variante]),
  closeStatus: texto(l.status_label),
  // O `url` da interface é o link para abrir o lead no Close, e era o n8n que
  // o construía. O campo `url` do próprio lead é o site da empresa, e vai para
  // `website` — que é onde o `mapC` o procura.
  url: `https://app.close.com/lead/${l.id}/`,
  website: texto(l.url),
  contacts: (l.contacts || []).map((c) => ({
    id: c.id,
    name: texto(c.name),
    title: texto(c.title),
    email: (c.emails || [])[0]?.email || '',
    phone: (c.phones || [])[0]?.phone || '',
  })),
});

/**
 * Todos os leads classificados como Escola ou Empresa, na forma que a
 * interface já lê.
 *
 * Os que não têm «Tipo de Lead» ficam de fora — a 10/09 eram uma minoria, e o
 * n8n também os excluía. Um lead sem tipo não sabe a que separador pertence.
 */
export async function lerLeadsDoClose() {
  const url = (salto) => `/lead/?_limit=${POR_PAGINA}&_skip=${salto}&_fields=${encodeURIComponent(CAMPOS)}`;
  const primeira = await close(url(0));
  const total = primeira.total_results ?? (primeira.data || []).length;
  const paginas = Math.ceil(total / POR_PAGINA);
  const todos = [...(primeira.data || [])];

  for (let i = 1; i < paginas; i += EM_PARALELO) {
    const lote = [];
    for (let j = i; j < Math.min(i + EM_PARALELO, paginas); j++) lote.push(close(url(j * POR_PAGINA)));
    for (const r of await Promise.all(lote)) todos.push(...(r.data || []));
  }

  const escolas = [], empresas = [];
  for (const l of todos) {
    const t = texto(l[CF.tipo]);
    if (t === 'Escola') escolas.push({ ...mapearLead(l), type: texto(l[CF.tipoInst]), phase: fase(l) });
    else if (t === 'Empresa') empresas.push({ ...mapearLead(l), sector: texto(l[CF.segmento]) });
  }

  if (!escolas.length && !empresas.length) {
    throw new Error('O Close respondeu, mas nenhum lead tem «Tipo de Lead» preenchido.');
  }
  return { escolas, empresas };
}
