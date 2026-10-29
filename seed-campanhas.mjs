// Seed inicial (28 Ago 2026): 2 templates de email no Close (texto atual + assinatura HTML), 1 template WhatsApp para escolas no Twilio, 2 campanhas no Blob.
// Correr: node --env-file=.env.local seed-campanhas.mjs
import { close, CAMPANHA_FIELD } from './lib/close.js';
import { tw } from './lib/twilio.js';
import { readJson, writeJson } from './lib/store.js';

// Sem assinatura no corpo: o Close acrescenta a assinatura da conta de email ao enviar.
const p = (...ls) => ls.map(l => `<div>${l}</div>`).join('<div><br></div>');
const EMPRESA = p('Bom dia {{ contact.first_name }},',
  'O meu nome é Nome Apelido, e sou responsável de operações da Unilinkr, uma plataforma que conecta estudantes universitários ao mundo do trabalho.',
  'Temos atualmente milhares de estudantes registados, dos mais variados cursos e por todo o país. O nosso modelo é simples: percebemos as vossas necessidades e apresentamos perfis que encaixam no que procuram, sem precisarem de publicar anúncios.',
  'Seria possível agendarmos uma reunião presencial ao longo das próximas semanas?');
const ESCOLA = p('Boa tarde {{ contact.first_name }},',
  'O meu nome é Nome Apelido e sou responsável de operações da Unilinkr, uma plataforma que conecta estudantes universitários com empresas que precisam de mão de obra flexível e compatível com os horários académicos.',
  'Temos hoje milhares de estudantes inscritos e várias empresas parceiras em Portugal.',
  'Contacto a {{ lead.display_name }} porque gostaríamos de explorar uma parceria, à semelhança do que já fazemos com outras instituições, para promover o empreendedorismo jovem, dinamizar oportunidades profissionais e contribuir para a formação dos estudantes.',
  'Estariam disponíveis para uma reunião presencial nas próximas semanas?');

const existing = (await close('/email_template/?_fields=id,name&_limit=200')).data;
async function tmpl(name, subject, body) {
  const e = existing.find(t => t.name === name); if (e) { console.log('template existe', e.id, name); return e.id; }
  const t = await close('/email_template/', { method: 'POST', body: { name, subject, body, is_shared: true } }); console.log('template criado', t.id, name); return t.id;
}
const tE = await tmpl('Campanha Empresas 2026 · Email 1 A', 'Estudantes universitários para a {{ lead.display_name }} — Unilinkr', EMPRESA);
const tS = await tmpl('Campanha Escolas 2026 · Email 1 A', 'Parceria Unilinkr × {{ lead.display_name }}', ESCOLA);

const wa = (await tw('https://content.twilio.com/v1/ContentAndApprovals?PageSize=100')).contents || [];
let waS = wa.find(c => c.friendly_name === 'prospeccao_whatsapp_escola')?.sid;
if (!waS) {
  const body = 'Olá {{1}}, sou o Nome Apelido, da Unilinkr. Enviei-vos um email há uns dias sobre uma parceria com a {{2}} para dar oportunidades de trabalho aos vossos estudantes. Faz sentido conversarmos 15 minutos? https://cal.com/exemplo/15min';
  const c = await tw('https://content.twilio.com/v1/Content', { json: { friendly_name: 'prospeccao_whatsapp_escola', language: 'pt_PT', variables: { 1: 'Nome', 2: 'Escola' }, types: { 'twilio/text': { body } } } });
  const ap = await tw(`https://content.twilio.com/v1/Content/${c.sid}/ApprovalRequests/whatsapp`, { json: { name: 'prospeccao_whatsapp_escola', category: 'MARKETING' } });
  waS = c.sid; console.log('twilio template escola', waS, ap.status);
} else console.log('twilio template escola existe', waS);

const db = await readJson('campanhas.json', { campaigns: [] });
const add = (name, tipo, email, wa) => { if (db.campaigns.some(c => c.name === name)) return; db.campaigns.push({ id: 'cmp_' + tipo.toLowerCase() + '_' + Date.now().toString(36), name, tipo, estado: 'ativa', delay1: 5760, delay2: 4320, variants: { A: { email, wa }, B: { email: null, wa: null } }, createdAt: '2026-08-28', by: 'seed' }); };
add('Empresas 2026', 'Empresa', tE, 'HX00000000000000000000000000000003');
add('Escolas 2026', 'Escola', tS, waS);
await writeJson('campanhas.json', db);
await close(`/custom_field/lead/${CAMPANHA_FIELD}/`, { method: 'PUT', body: { choices: db.campaigns.map(c => c.name) } });
console.log(JSON.stringify(db.campaigns, null, 1));
