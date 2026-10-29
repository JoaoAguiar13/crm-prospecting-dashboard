/*
 * Modo demo — `DEMO_MODE=1 node server.mjs`
 *
 * A plataforma abre sem Close, sem Twilio e sem login, com leads, contactos,
 * conversas de WhatsApp, campanhas, templates e tarefas fictícios.
 *
 * O Close e o Twilio são simulados ao nível das funções `close()` e `tw()`
 * (lib/close.js e lib/twilio.js). As rotas de api/ e a interface correm o
 * mesmo código que em produção; só a outra ponta é falsa. Escrever funciona
 * (mudar a etapa, criar leads e tarefas, enviar mensagens), mas tudo vive em
 * memória: reiniciar o servidor repõe os dados de partida.
 *
 * Todos os nomes, moradas, emails e telefones são inventados. Os telefones
 * usam o intervalo +351 900, que não está atribuído, e os emails usam
 * domínios de exemplo.
 */
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEMO = String(process.env.DEMO_MODE || '').trim() === '1';
// Está na lista de acessos de partida (lib/access.js) como admin.
export const DEMO_EMAIL = 'admin@empresa.example';

// Corre antes de qualquer outro módulo ler o ambiente (o server.mjs importa
// este ficheiro primeiro): o demo não precisa de nenhuma variável definida.
if (DEMO) {
  process.env.DATA_DIR ||= join(tmpdir(), `prospecting-demo-${process.pid}`);
  process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
  process.env.REFRESCAR_LEADS ||= '0';
}

// ------------------------------------------------------------ dados fictícios
function aleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ETAPAS = ['Não contactado', 'Primeiro contacto', 'Segundo contacto', 'Terceiro contacto',
  'Reunião / Resposta', 'Sem resposta', 'Para reciclar', 'Cliente / Parceiro'];
const FASES = ['1 - Fase 1 (Grande Porto)', '2 - Fase 2 (Portugal)'];
const TIPOS_ESCOLA = ['Escola Profissional', 'Universidade Pública', 'Politécnico Público', 'Escola Superior Pública',
  'Instituto Privado', 'Escola de Tecnologia', 'Instituto de Línguas', 'Formação Profissional'];
const SEGMENTOS = ['01 - Hotelaria', '02 - Retalho Alimentar', '03 - Retalho Moda', '05 - Restaurantes & Bares',
  '06 - Festivais, Concertos, Espetáculos', '07 - Catering', '08 - Promoções & Ativações de Marca',
  '09 - PMEs & Startups', '10 - Desporto', '14 - Trabalho Temporário / Recrutamento'];
// Centros públicos das cidades; cada lead fica num ponto aleatório à volta.
const CIDADES = [
  ['Porto', 41.1496, -8.611, '4000'], ['Vila Nova de Gaia', 41.1239, -8.6118, '4400'], ['Matosinhos', 41.1844, -8.6963, '4450'],
  ['Maia', 41.2357, -8.6199, '4470'], ['Gondomar', 41.1445, -8.5322, '4420'], ['Valongo', 41.1886, -8.4986, '4440'],
  ['Póvoa de Varzim', 41.3806, -8.7609, '4490'], ['Espinho', 41.0072, -8.6411, '4500'], ['Santo Tirso', 41.3434, -8.4775, '4780'],
  ['Braga', 41.5454, -8.4265, '4700'], ['Guimarães', 41.4425, -8.2918, '4800'], ['Aveiro', 40.6405, -8.6538, '3800'],
];
const RUAS = ['Rua das Flores', 'Avenida Central', 'Rua do Comércio', 'Rua da Estação', 'Praça da República',
  'Rua Nova', 'Avenida da Liberdade', 'Rua do Mercado', 'Travessa do Sol', 'Rua dos Pinheiros'];
const NOMES = ['Ana', 'Beatriz', 'Carla', 'Diana', 'Inês', 'Joana', 'Marta', 'Sara', 'Rita', 'Teresa',
  'André', 'Bruno', 'Carlos', 'Daniel', 'Hugo', 'Luís', 'Miguel', 'Nuno', 'Paulo', 'Tiago'];
const APELIDOS = ['Almeida', 'Barbosa', 'Cardoso', 'Costa', 'Ferreira', 'Gomes', 'Lopes', 'Marques',
  'Moreira', 'Nunes', 'Pereira', 'Ribeiro', 'Santos', 'Silva', 'Sousa', 'Teixeira'];
const CARGOS_ESCOLA = ['Diretora', 'Coordenador de Estágios', 'Gabinete de Empregabilidade', 'Secretaria'];
const CARGOS_EMPRESA = ['Gerente', 'Recursos Humanos', 'Diretora de Operações', 'Sócio'];
const ESCOLAS_A = ['Escola Profissional', 'Instituto', 'Escola Superior', 'Academia', 'Centro de Formação', 'Escola de Hotelaria'];
const ESCOLAS_B = ['Aurora', 'Lumen', 'Vértice', 'Alvorada', 'Horizonte', 'Nascente', 'Mirante', 'Atlas', 'Bússola', 'Farol', 'Carvalhal', 'Seixal'];
const EMPRESAS_A = ['Sabores', 'Hotel', 'Café', 'Mercearia', 'Eventos', 'Logística', 'Ateliê', 'Catering', 'Ginásio', 'Quiosque', 'Pastelaria', 'Agência'];
const EMPRESAS_B = ['do Largo', 'Ribeirinho', 'Boa Onda', 'Central', 'Maré Alta', 'do Bairro', 'Girassol', 'Encosta', 'Ponte Velha', 'Sete Mares', 'Pátio', 'Lua Cheia'];

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pad = (n, w) => String(n).padStart(w, '0');
const diasAtras = (d, h = 10) => new Date(Date.now() - d * 86400e3 - h * 3600e3);

let estado = null;

async function dados() {
  if (estado) return estado;
  // Importados aqui e não no topo: close.js e twilio.js importam este módulo.
  const { CF } = await import('./close.js');
  const { SENDERS } = await import('./twilio.js');
  const r = aleatorio(2026);
  const escolhe = (lista) => lista[Math.floor(r() * lista.length)];
  let proximoTelefone = 100;
  const novoTelefone = () => `+351 900 ${pad(proximoTelefone++, 3)} ${pad(Math.floor(r() * 1000), 3)}`;

  const leads = [];
  const nomesUsados = new Set();
  const criar = (tipo, i) => {
    let nome;
    do {
      nome = tipo === 'Escola' ? `${escolhe(ESCOLAS_A)} ${escolhe(ESCOLAS_B)}` : `${escolhe(EMPRESAS_A)} ${escolhe(EMPRESAS_B)}`;
    } while (nomesUsados.has(nome));
    nomesUsados.add(nome);
    const [cidade, lat, lng, cp] = escolhe(CIDADES);
    const etapa = r() < 0.45 ? 0 : 1 + Math.floor(r() * 7);
    const contactos = Array.from({ length: 1 + Math.floor(r() * 2) }, (_, k) => {
      const pessoa = `${escolhe(NOMES)} ${escolhe(APELIDOS)}`;
      return {
        id: `cont_demo${tipo[0]}${pad(i, 3)}${k}`,
        name: pessoa,
        title: escolhe(tipo === 'Escola' ? CARGOS_ESCOLA : CARGOS_EMPRESA),
        emails: [{ email: `${slug(pessoa).replace('-', '.')}@${slug(nome)}.exemplo.pt` }],
        phones: [{ phone: novoTelefone() }],
      };
    });
    return {
      id: `lead_demo${tipo === 'Escola' ? 'E' : 'C'}${pad(i, 3)}`,
      display_name: nome,
      url: `https://www.${slug(nome)}.exemplo.pt`,
      status_label: etapa === 0 ? 'Outreach' : etapa === 7 ? 'Parceiro' : 'Contactado',
      addresses: [{ address_1: `${escolhe(RUAS)} ${1 + Math.floor(r() * 200)}`, city: cidade, zipcode: `${cp}-${pad(Math.floor(r() * 1000), 3)}` }],
      contacts: contactos,
      [CF.etapa]: `${etapa} - ${ETAPAS[etapa]}`,
      [CF.tipo]: tipo,
      [CF.campanha]: etapa > 0 && etapa < 7 ? (tipo === 'Escola' ? 'Escolas 2026' : 'Empresas 2026') : '',
      [CF.variante]: etapa > 0 && etapa < 7 ? (r() < 0.5 ? 'A' : 'B') : '',
      [CF.lat]: +(lat + (r() - 0.5) * 0.06).toFixed(6),
      [CF.lng]: +(lng + (r() - 0.5) * 0.08).toFixed(6),
      [CF.fase]: tipo === 'Escola' ? (/Braga|Guimarães|Aveiro/.test(cidade) ? FASES[1] : FASES[0]) : '',
      [CF.segmento]: tipo === 'Empresa' ? escolhe(SEGMENTOS) : '',
      [CF.tipoInst]: tipo === 'Escola' ? escolhe(TIPOS_ESCOLA) : '',
      date_created: diasAtras(10 + Math.floor(r() * 120)).toISOString(),
    };
  };
  for (let i = 1; i <= 36; i++) leads.push(criar('Escola', i));
  for (let i = 1; i <= 54; i++) leads.push(criar('Empresa', i));

  const templates = [
    { id: 'tmpl_demo0001', name: 'Campanha Empresas 2026 · Email 1 A', subject: 'Estudantes universitários para a {{ lead.display_name }}',
      body: '<div>Bom dia {{ contact.first_name }},</div><div><br></div><div>Somos uma plataforma que liga estudantes universitários a empresas que precisam de equipas flexíveis.</div><div><br></div><div>Podemos marcar 15 minutos esta semana?</div>' },
    { id: 'tmpl_demo0002', name: 'Campanha Escolas 2026 · Email 1 A', subject: 'Parceria com a {{ lead.display_name }}',
      body: '<div>Boa tarde {{ contact.first_name }},</div><div><br></div><div>Gostávamos de levar oportunidades de trabalho em part-time aos estudantes da {{ lead.display_name }}.</div><div><br></div><div>Estariam disponíveis para uma reunião?</div>' },
  ].map((t) => ({ ...t, date_updated: diasAtras(20).toISOString(), is_archived: false }));

  const conteudos = [
    { sid: 'HX' + pad(9001, 32), friendly_name: 'prospeccao_whatsapp_escola', variables: { 1: 'Nome', 2: 'Escola' },
      body: 'Olá {{1}}, enviámos um email há uns dias sobre uma parceria com a {{2}} para dar oportunidades de trabalho aos vossos estudantes. Faz sentido conversarmos 15 minutos?' },
    { sid: 'HX' + pad(9002, 32), friendly_name: 'prospeccao_whatsapp_empresa', variables: { 1: 'Nome', 2: 'Empresa' },
      body: 'Olá {{1}}, temos estudantes disponíveis para reforçar a equipa da {{2}} em turnos flexíveis. Posso enviar-lhe perfis?' },
  ].map((c) => ({ sid: c.sid, friendly_name: c.friendly_name, variables: c.variables, types: { 'twilio/text': { body: c.body } }, approval_requests: { status: 'approved' } }));

  // Conversas de WhatsApp nos três remetentes, nos últimos dias (cabem na janela de 7 dias da interface).
  const mensagens = [];
  let sid = 1;
  const msg = (remetente, outro, dir, texto, quando, extra = {}) => mensagens.push({
    sid: 'SM' + pad(sid++, 32),
    from: dir === 'in' ? 'whatsapp:' + outro.replace(/ /g, '') : SENDERS[remetente].wa,
    to: dir === 'in' ? SENDERS[remetente].wa : 'whatsapp:' + outro.replace(/ /g, ''),
    body: texto,
    status: dir === 'in' ? 'received' : 'read',
    direction: dir === 'in' ? 'inbound' : 'outbound-api',
    date_sent: quando.toUTCString(),
    error_code: null,
    ...extra,
  });
  const contactados = leads.filter((l) => /^[2-4] /.test(l[CF.etapa]) && l.contacts[0]?.phones[0]).slice(0, 8);
  contactados.forEach((l, i) => {
    const c = l.contacts[0], primeiro = c.name.split(' ')[0], tel = c.phones[0].phone;
    const modelo = conteudos[l[CF.tipo] === 'Escola' ? 0 : 1].types['twilio/text'].body;
    msg('prospecao', tel, 'out', modelo.replace('{{1}}', primeiro).replace('{{2}}', l.display_name), diasAtras(6 - (i % 5), 15));
    // A primeira resposta é de há poucas horas: a janela de 24 h do WhatsApp está aberta e dá para escrever.
    const resposta = i === 0 ? new Date(Date.now() - 2 * 3600e3) : diasAtras(5 - (i % 5), 11);
    if (i % 3 !== 2) msg('prospecao', tel, 'in', ['Olá! Sim, pode enviar mais informação.', 'Boa tarde, falamos na próxima semana?', 'Obrigado. Envie por email, por favor.'][i % 3], resposta);
    if (i === 1) msg('prospecao', tel, 'out', 'Combinado! Envio já por email.', diasAtras(4, 10));
  });
  // Uma mensagem falhada, para mostrar como a interface explica os erros do Twilio.
  msg('prospecao', '+351 900 999 001', 'out', 'Olá, voltamos a contactar sobre a proposta de parceria.', diasAtras(1, 9),
    { status: 'undelivered', error_code: 63016 });
  const bots = {
    empresas: [['Olá, queria publicar uma vaga para fim de semana.', 'Claro! Para que dias e quantas pessoas precisa?'],
      ['Preciso de 3 pessoas para um evento no sábado.', 'Perfeito. Qual é a morada e o horário do evento?'],
      ['Ainda não recebi os perfis que pedi.', 'Peço desculpa pela demora. Um colega vai acompanhar o seu pedido.']],
    estudantes: [['Olá, como me inscrevo nas vagas?', 'Olá! Basta criar conta na app e completar o perfil.'],
      ['Já fiz o turno de ontem, quando recebo?', 'Os pagamentos são processados até ao fim da semana.'],
      ['Posso trocar de turno?', 'Pode pedir a troca na app, na secção dos seus turnos.'],
      ['A app não me deixa validar o email da universidade.', 'Vamos verificar. Qual é o email que está a usar?']],
  };
  let telBot = 500;
  for (const [remetente, conversas] of Object.entries(bots)) {
    conversas.forEach(([pergunta, resposta], i) => {
      const tel = `+351 900 ${telBot++} ${pad(100 + i * 37, 3)}`;
      const quando = new Date(Date.now() - (i * 26 + 3) * 3600e3); // a primeira de cada bot é de hoje
      msg(remetente, tel, 'in', pergunta, quando);
      msg(remetente, tel, 'out', resposta, new Date(quando.getTime() + 60e3));
    });
  }

  const tarefas = leads.filter((l) => /^[1-3] /.test(l[CF.etapa])).slice(0, 5).map((l, i) => ({
    id: `task_demo${pad(i + 1, 3)}`, _type: 'lead', lead_id: l.id, lead_name: l.display_name,
    text: `Ligar a ${l.contacts[0].name} — ${l.display_name} — sem resposta ao email`,
    due_date: new Date(Date.now() + (i - 1) * 86400e3).toISOString().slice(0, 10),
    assigned_to_name: 'Equipa Comercial', created_by_name: 'Equipa Comercial', is_complete: false,
  }));

  const escolhas = {
    [CF.etapa]: ETAPAS.map((e, i) => `${i} - ${e}`),
    [CF.fase]: FASES,
    [CF.tipo]: ['Escola', 'Empresa'],
    [CF.segmento]: SEGMENTOS,
    [CF.tipoInst]: TIPOS_ESCOLA,
    [CF.campanha]: ['Empresas 2026', 'Escolas 2026'],
    [CF.variante]: ['A', 'B'],
  };

  estado = { leads, templates, conteudos, mensagens, tarefas, escolhas, silenciadas: new Set(), seq: 1000 };
  return estado;
}

/** Campanhas de partida, gravadas no DATA_DIR temporário quando o servidor arranca. */
export async function prepararDemo() {
  const { readJson, writeJson } = await import('./store.js');
  const d = await dados();
  const db = await readJson('campanhas.json', { campaigns: [] });
  if (!db.campaigns.length) {
    db.campaigns = [
      { id: 'cmp_demo_empresas', name: 'Empresas 2026', tipo: 'Empresa', estado: 'ativa', delay1: 5760, delay2: 4320,
        variants: { A: { email: d.templates[0].id, wa: d.conteudos[1].sid }, B: { email: null, wa: null } }, createdAt: '2026-09-01', by: DEMO_EMAIL },
      { id: 'cmp_demo_escolas', name: 'Escolas 2026', tipo: 'Escola', estado: 'ativa', delay1: 5760, delay2: 4320,
        variants: { A: { email: d.templates[1].id, wa: d.conteudos[0].sid }, B: { email: null, wa: null } }, createdAt: '2026-09-01', by: DEMO_EMAIL },
    ];
    await writeJson('campanhas.json', db);
  }
}

// ------------------------------------------------------------ Close simulado
const naoSimulado = (method, path) => { throw new Error(`Close (demo): ${method} ${path} não está simulado.`); };

export async function closeDemo(path, { method = 'GET', body } = {}) {
  const d = await dados();
  const url = new URL(path, 'https://close.demo');
  const p = url.pathname, q = url.searchParams;
  let m;

  if (p === '/lead/' && method === 'GET') {
    const limite = Number(q.get('_limit')) || 100, salto = Number(q.get('_skip')) || 0;
    return { data: d.leads.slice(salto, salto + limite), total_results: d.leads.length, has_more: salto + limite < d.leads.length };
  }
  if (p === '/lead/' && method === 'POST') {
    const lead = { id: `lead_demoN${d.seq++}`, status_label: 'Outreach', addresses: [], ...body, date_created: new Date().toISOString() };
    lead.contacts = (body.contacts || []).map((c, i) => ({ id: `cont_demoN${d.seq++}${i}`, ...c }));
    d.leads.push(lead);
    return lead;
  }
  if ((m = p.match(/^\/lead\/([^/]+)\/$/))) {
    const lead = d.leads.find((l) => l.id === decodeURIComponent(m[1]));
    if (!lead) throw new Error('Close 404: o lead não existe');
    if (method === 'PUT') Object.assign(lead, body);
    return lead;
  }
  if (p === '/contact/' && method === 'POST') {
    const lead = d.leads.find((l) => l.id === body.lead_id);
    if (!lead) throw new Error('Close 404: o lead não existe');
    const c = { id: `cont_demoN${d.seq++}`, ...body };
    lead.contacts.push(c);
    return c;
  }
  if ((m = p.match(/^\/custom_field\/lead\/([^/]+)\/$/))) {
    const chave = 'custom.' + m[1];
    if (method === 'PUT') d.escolhas[chave] = body.choices || [];
    return { id: m[1], choices: d.escolhas[chave] || [] };
  }
  if (p === '/email_account/') {
    const identidade = { email: 'comercial@empresa.example', name: 'Equipa Comercial' };
    return { data: [{ id: 'emailacct_demo', email: identidade.email, enabled_features: ['email_sending'], send_status: 'ok', identities: [identidade], default_identity: identidade }] };
  }
  if (p === '/activity/email/' && method === 'POST') return { id: `acti_demo${d.seq++}`, status: 'sent', ...body };
  if (p === '/email_template/') {
    if (method === 'POST') {
      const t = { id: `tmpl_demoN${d.seq++}`, date_updated: new Date().toISOString(), is_archived: false, ...body };
      d.templates.push(t);
      return t;
    }
    return { data: d.templates };
  }
  if ((m = p.match(/^\/email_template\/([^/]+)\/(render\/)?$/))) {
    const t = d.templates.find((x) => x.id === m[1]);
    if (!t) throw new Error('Close 404: o template não existe');
    if (method === 'PUT') return Object.assign(t, body, { date_updated: new Date().toISOString() });
    if (m[2]) {
      const lead = d.leads.find((l) => l.id === q.get('lead_id'));
      const contacto = lead?.contacts.find((c) => c.id === q.get('contact_id')) || lead?.contacts[0];
      const preencher = (s) => s
        .replace(/\{\{\s*contact\.first_name\s*\}\}/g, contacto?.name.split(' ')[0] || '')
        .replace(/\{\{\s*lead\.display_name\s*\}\}/g, lead?.display_name || '');
      return { subject: preencher(t.subject), body: preencher(t.body) };
    }
    return t;
  }
  if (p === '/task/') {
    if (method === 'POST') {
      const lead = d.leads.find((l) => l.id === body.lead_id);
      const t = { id: `task_demoN${d.seq++}`, lead_name: lead?.display_name || '', assigned_to_name: 'Equipa Comercial', created_by_name: 'Equipa Comercial', is_complete: false, ...body };
      d.tarefas.push(t);
      return t;
    }
    const abertas = d.tarefas.filter((t) => !t.is_complete);
    return { data: abertas, total_results: abertas.length };
  }
  if ((m = p.match(/^\/task\/([^/]+)\/$/)) && method === 'PUT') {
    const t = d.tarefas.find((x) => x.id === decodeURIComponent(m[1]));
    if (!t) throw new Error('Close 404: a tarefa não existe');
    return Object.assign(t, body);
  }
  return naoSimulado(method, path);
}

// ------------------------------------------------------------ Twilio simulado
export async function twDemo(url, { method, form, json } = {}) {
  const d = await dados();
  const u = new URL(url);
  method = method || (form || json ? 'POST' : 'GET');

  if (u.pathname.endsWith('/ContentAndApprovals')) return { contents: d.conteudos };
  if (u.pathname.endsWith('/Content') && method === 'POST') {
    const c = { sid: 'HX' + pad(d.seq++, 32), friendly_name: json.friendly_name, variables: json.variables, types: json.types, approval_requests: { status: 'pending' } };
    d.conteudos.push(c);
    return c;
  }
  if (u.pathname.endsWith('/ApprovalRequests/whatsapp')) return { status: 'pending' };

  if (u.pathname.endsWith('/Messages.json')) {
    if (method === 'POST') {
      let body = form.Body;
      if (form.ContentSid) {
        const c = d.conteudos.find((x) => x.sid === form.ContentSid);
        const vars = JSON.parse(form.ContentVariables || '{}');
        body = (c?.types['twilio/text'].body || '').replace(/\{\{(\d+)\}\}/g, (_, k) => vars[k] ?? '');
      }
      const m = { sid: 'SM' + pad(d.seq++, 32), from: form.From, to: form.To, body, status: 'sent', direction: 'outbound-api', date_sent: new Date().toUTCString(), error_code: null };
      d.mensagens.push(m);
      return m;
    }
    const de = u.searchParams.get('From'), para = u.searchParams.get('To');
    const desde = new Date(u.searchParams.get('DateSent>') || 0);
    return {
      messages: d.mensagens.filter((m) => (!de || m.from === de) && (!para || m.to === para) && new Date(m.date_sent) >= desde),
      next_page_uri: null,
    };
  }
  throw new Error(`Twilio (demo): ${method} ${u.pathname} não está simulado.`);
}

// ------------------------------------------------------------ outros serviços
/** Morada → coordenadas sem ir ao Photon: um ponto estável perto da cidade pedida. */
export function coordenadasDemo(morada, cidade, perto) {
  const c = CIDADES.find(([nome]) => nome.toLowerCase() === String(cidade || '').trim().toLowerCase());
  const base = c ? { lat: c[1], lng: c[2] } : perto || { lat: CIDADES[0][1], lng: CIDADES[0][2] };
  let h = 0;
  for (const ch of String(morada)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    lat: +(base.lat + ((h % 1000) / 1000 - 0.5) * 0.02).toFixed(6),
    lng: +(base.lng + (((h >>> 10) % 1000) / 1000 - 0.5) * 0.02).toFixed(6),
  };
}

/** Assumir/devolver conversas do bot (api/mute.js), guardado em memória. */
export async function muteDemo(req) {
  const d = await dados();
  if (req.method === 'GET') return Response.json({ muted: [...d.silenciadas] });
  const b = await req.json().catch(() => ({}));
  if (!b.phone) return Response.json({ error: 'phone é obrigatório.' }, { status: 400 });
  if (b.action === 'resume') d.silenciadas.delete(b.phone); else d.silenciadas.add(b.phone);
  return Response.json({ phone: b.phone, muted: d.silenciadas.has(b.phone) });
}
