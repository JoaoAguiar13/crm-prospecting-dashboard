// Enrichment (Apollo ou RocketReach, chave do utilizador guardada no Blob enrich.json, nunca devolvida):
// GET → {provider, configured, plan, credits} · POST {key, provider} → valida e guarda · DELETE → apaga
// POST {preview:{leadId, name, domain}} → {company, people[]} (gasta créditos: Apollo 1/org + 1/pessoa; RocketReach 1/empresa + 1/pessoa)
import { getSession } from '../lib/session.js';
import { readJson, writeJson } from '../lib/store.js';

export const maxDuration = 60;
const PATH = 'enrich.json';
const TITLES = ['Recursos Humanos', 'HR', 'Human Resources', 'Recrutamento', 'Talent', 'People', 'Operações', 'Operations', 'CEO', 'Diretor Geral', 'General Manager', 'Gerente', 'Sócio', 'Owner', 'Founder', 'Administrador'];
const domainOf = u => String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();

async function j(url, { headers, method, body, query } = {}) {
  if (query) url += (url.includes('?') ? '&' : '?') + query;
  const r = await fetch(url, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.message || d.detail || `HTTP ${r.status}`);
  return d;
}

const apollo = {
  h: key => ({ 'x-api-key': key }),
  async check(key) {
    const p = await j('https://api.apollo.io/api/v1/users/api_profile?include_credit_usage=true', { headers: apollo.h(key) });
    const credits = p.num_credits_remaining ?? p.effective_num_lead_credits ?? null;
    return { email: p.email || '', plan: credits > 0 ? 'com créditos' : 'sem créditos', credits, premium: credits > 0 };
  },
  async preview(key, { domain, name }) {
    const H = { headers: apollo.h(key) };
    let company = null;
    if (domain) try { const o = (await j('https://api.apollo.io/api/v1/organizations/enrich?domain=' + encodeURIComponent(domain), H)).organization; if (o) company = { name: o.name, website: o.website_url, industry: o.industry, employees: o.estimated_num_employees, linkedin: o.linkedin_url, phone: o.primary_phone?.number || o.phone, description: o.short_description, city: o.city, country: o.country }; } catch (e) { company = { error: e.message }; }
    const qs = new URLSearchParams(); if (domain) qs.append('q_organization_domains_list[]', domain); else qs.append('q_organization_name', name);
    for (const t of TITLES) qs.append('person_titles[]', t); qs.set('include_similar_titles', 'true'); qs.set('per_page', '5'); qs.set('page', '1');
    const s = await j('https://api.apollo.io/api/v1/mixed_people/api_search', { ...H, method: 'POST', query: qs.toString() });
    const cands = (s.people || []).sort((a, b) => (b.has_email === true) - (a.has_email === true)).slice(0, 2);
    const people = [];
    for (const c of cands) { try { const p = (await j('https://api.apollo.io/api/v1/people/match?id=' + c.id + '&reveal_personal_emails=true', { ...H, method: 'POST' })).person; if (p) people.push({ name: p.name, title: p.title, email: p.email || (p.personal_emails || [])[0] || '', emailStatus: p.email_status || '', phone: (p.phone_numbers || [])[0]?.sanitized_number || '', linkedin: p.linkedin_url || '' }); } catch (e) { people.push({ name: c.first_name, title: c.title, error: e.message }); } }
    return { company, people, found: s.total_entries || 0 };
  },
};

const rocket = {
  h: key => ({ 'Api-Key': key }),
  async check(key) {
    const a = await j('https://api.rocketreach.co/api/v2/account/', { headers: rocket.h(key) });
    const cu = Array.isArray(a.credit_usage) ? a.credit_usage : [];
    const exp = cu.find(c => /export|lookup/i.test(c.credit_type)) || cu[0];
    const credits = exp?.remaining ?? a.export_credit_remaining ?? a.lookup_credit_remaining ?? null;
    return { email: a.email || '', plan: a.plan?.name || (credits > 0 ? 'com créditos' : 'sem créditos'), credits, premium: credits > 0 };
  },
  async preview(key, { domain, name }) {
    const H = { headers: rocket.h(key) }, B = 'https://api.rocketreach.co/api/v2';
    let company = null;
    if (domain) try { const o = await j(`${B}/company/lookup/?domain=${encodeURIComponent(domain)}`, H); company = { name: o.name, website: o.domain, industry: o.industry, employees: o.num_employees, linkedin: o.links?.linkedin, phone: o.phone, description: o.description, city: o.address?.city, country: o.address?.country }; } catch (e) { company = { error: e.message }; }
    const query = domain ? { current_employer_domain: [domain] } : { current_employer: [name] };
    const s = await j(`${B}/person/search`, { ...H, body: { query: { ...query, current_title: TITLES }, start: 1, page_size: 5, order_by: 'relevance' } });
    const cands = (s.profiles || []).slice(0, 2), people = [];
    for (const c of cands) {
      let p = null; try { p = await j(`${B}/person/lookup?id=${c.id}`, H); } catch (e) { people.push({ name: c.name, title: c.current_title, linkedin: c.linkedin_url, error: e.message }); continue; }
      for (let i = 0; i < 6 && p && p.status && p.status !== 'complete' && p.status !== 'failed'; i++) { await new Promise(r => setTimeout(r, 3000)); const st = await j(`${B}/person/checkStatus?ids=${c.id}`, H); p = Array.isArray(st) ? st[0] : p; }
      people.push({ name: p?.name || c.name, title: p?.current_title || c.current_title, email: p?.recommended_professional_email || p?.current_work_email || p?.recommended_email || (p?.emails || [])[0]?.email || '', emailStatus: (p?.emails || [])[0]?.grade || '', phone: (p?.phones || []).find(x => x.recommended)?.number || (p?.phones || [])[0]?.number || '', linkedin: p?.linkedin_url || c.linkedin_url || '', pending: p?.status && p.status !== 'complete' ? p.status : '' });
    }
    return { company, people, found: s.pagination?.total || cands.length };
  },
};
const PROV = { apollo, rocketreach: rocket };

async function handler(req) {
  const s = await getSession(req); if (!s) return Response.json({ error: 'Sem sessão.' }, { status: 401 });
  const cfg = await readJson(PATH, {});
  const pub = c => ({ provider: c.provider || '', configured: !!c.key, keyHint: c.key ? '…' + c.key.slice(-4) : '', email: c.email || '', plan: c.plan || '', credits: c.credits ?? null, premium: !!c.premium, checkedAt: c.checkedAt || '', by: c.by || '' });
  try {
    if (req.method === 'GET') {
      if (cfg.key && new URL(req.url).searchParams.has('refresh')) { Object.assign(cfg, await PROV[cfg.provider].check(cfg.key), { checkedAt: new Date().toISOString() }); await writeJson(PATH, cfg); }
      return Response.json(pub(cfg));
    }
    if (req.method === 'DELETE') { await writeJson(PATH, {}); return Response.json(pub({})); }
    const b = await req.json().catch(() => ({}));
    if (b.preview) {
      if (!cfg.key) return Response.json({ error: 'Sem chave de API.' }, { status: 400 });
      const domain = domainOf(b.preview.domain), name = String(b.preview.name || '').trim();
      if (!domain && !name) return Response.json({ error: 'Lead sem website nem nome.' }, { status: 400 });
      const out = await PROV[cfg.provider].preview(cfg.key, { domain, name });
      return Response.json({ ...out, provider: cfg.provider, domain });
    }
    const provider = PROV[b.provider] ? b.provider : null, key = String(b.key || '').trim();
    if (!provider || !key) return Response.json({ error: 'Fornecedor ou chave em falta.' }, { status: 400 });
    const info = await PROV[provider].check(key);
    const next = { provider, key, ...info, checkedAt: new Date().toISOString(), by: s.email };
    await writeJson(PATH, next);
    return Response.json(pub(next));
  } catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
}
export { handler as GET, handler as POST, handler as DELETE };
