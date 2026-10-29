"""Cria/atualiza o workflow n8n "Unilinkr - Sequência Outreach" (Email → WhatsApp → Chamada).

>>> ESTA SEQUÊNCIA ESTÁ DESLIGADA DESDE 19/09/2026, DE PROPÓSITO. <<<

O o comercial pediu que todos os emails passassem a ser personalizados, e esta cadeia
mandava o mesmo email de campanha a toda a gente. A plataforma deixou de ter
botão para a disparar, o workflow foi despublicado no n8n e a linha dele saiu
da tabela `webhook_entity` — o `start-outreach` já não responde.

Este ficheiro fica como registo do que a cadeia era. Correr o script NÃO volta
a ligá-la: a activação no fim está atrás do RELIGAR=1, senão desfazia o que
foi decidido sem ninguém dar por isso.

O que a substituiu:
  - o email escreve-se à mão na ficha do lead (api/email.js);
  - o lembrete de chamada nasce no envio, como tarefa no Close a 7 dias;
  - o WhatsApp do dia 4 não foi substituído — manda-se pelo separador
    Conversas, porque um template aprovado pela Meta é igual para toda a gente.

Uso (só para inspecionar ou recriar a definição): N8N_KEY=... python3 n8n-sequencia-outreach.py
Webhook start-outreach: { leadId, emailTemplateId (Close), waContentSid? (Twilio), delay1?, delay2? (min), teamPhone?, campanha?, variante? }
O email 1 é renderizado e enviado PELO CLOSE (fica na ficha do lead, com opens); o WhatsApp usa o template da campanha.
"""
import json, os, sys, uuid, urllib.request

S = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ.get("N8N_KEY") or open(f"{S}/n8n.env").read().strip().split("=", 1)[1]
# Base do n8n: N8N_BASE_URL no ambiente, ou o valor de sempre.
N8N_BASE = os.environ.get("N8N_BASE_URL", "https://exemplo.app.n8n.cloud")
API = f"{N8N_BASE}/api/v1"
CLOSE_CRED = {"httpBasicAuth": {"id": "CREDENCIAL000001", "name": "Credencial Close"}}
EMAIL_ACCOUNT = "emailacct_Exemplo0010"  # comercial@empresa.example ligado ao Close
TWILIO_CRED = {"httpBasicAuth": {"id": "CREDENCIAL000002", "name": "Unnamed credential 4"}}
TWILIO_MSG = "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000001/Messages.json"
WA_FROM = "whatsapp:+12025550102"
WA_TPL_TEAM = "HX00000000000000000000000000000002"   # chamada_equipa — "3.º contacto: ligar a {{1}} ({{2}}) — {{3}}"
TEAM_PHONE = "+351900000005"
ETAPA = "custom.cf_Exemplo0001"
TIPO = "custom.cf_Exemplo0002"

PREPARAR = r'''
const lead = $input.first().json;
const body = $('Webhook').first().json.body || {};
// Prospeção só à PESSOA: primeiro contacto com nome e email não genérico. Nunca ao email geral da empresa.
const GENERIC = /^(geral|info|contacto|contact|secretaria|mail|hello|admin|comercial|marketing|office|suporte|support|recrutamento|rh)@/i;
const people = (lead.contacts || []).filter(x => (x.name || '').trim() && (x.emails || []).some(e => e.email && !GENERIC.test(e.email)));
if (!people.length) throw new Error('Lead sem pessoa de contacto com email pessoal: ' + (lead.display_name || lead.id));
const c = people[0];
const name = lead.display_name || lead.name || '';
const contact = c.name || '';
const firstName = contact.trim().split(/\s+/)[0] || '';
const email = (c.emails || []).find(e => e.email && !GENERIC.test(e.email)).email;
const phone = ((c.phones || [])[0] || {}).phone || '';
if (!email) throw new Error('Lead sem email: ' + lead.id);
if (!phone) throw new Error('Lead sem telefone: ' + lead.id);
if (!/^tmpl_/.test(body.emailTemplateId || '')) throw new Error('Sem template de email: atribui o lead a uma campanha');
return [{ json: {
  leadId: lead.id, name, contact, firstName, email, phone, contactId: c.id,
  emailTemplateId: body.emailTemplateId, waContentSid: /^HX/.test(body.waContentSid || '') ? body.waContentSid : '',
  campanha: body.campanha || '', variante: body.variante || '',
  // ponytail: delays em minutos; defeito 4 dias / 3 dias. Testar com delay1=1&delay2=1.
  delay1: Number(body.delay1) || 4 * 24 * 60,
  delay2: Number(body.delay2) || 3 * 24 * 60,
  teamPhone: body.teamPhone || 'TEAM_PHONE',
}}];
'''.replace("TIPO_KEY", TIPO).replace("TEAM_PHONE", TEAM_PHONE).strip()

P = "$('Preparar').first().json"

def node(name, type_, ver, params, x, cred=None, extra=None):
    n = {"id": str(uuid.uuid4()), "name": name, "type": type_, "typeVersion": ver,
         "position": [x, 0], "parameters": params}
    if cred: n["credentials"] = cred
    if extra: n.update(extra)
    return n

def close_get(name, x, expr):
    return node(name, "n8n-nodes-base.httpRequest", 4.4, {
        "url": f"=https://api.close.com/api/v1/lead/{{{{ {expr} }}}}/",
        "authentication": "genericCredentialType", "genericAuthType": "httpBasicAuth",
        "sendQuery": True,
        "queryParameters": {"parameters": [{"name": "_fields", "value": f"id,display_name,contacts,{ETAPA},{TIPO}"}]},
        "options": {}}, x, CLOSE_CRED)

def etapa(name, x, status):
    return node(name, "n8n-nodes-base.httpRequest", 4.4, {
        "method": "POST", "url": f"{N8N_BASE}/webhook/update-outreach",
        "sendBody": True, "specifyBody": "json",
        "jsonBody": f"={{{{ JSON.stringify({{leadId: {P}.leadId, status: {status}}}) }}}}",
        "options": {}}, x)

def wait(name, x, field):
    return node(name, "n8n-nodes-base.wait", 1.1, {
        "resume": "timeInterval", "amount": f"={{{{ {P}.{field} }}}}", "unit": "minutes"},
        x, extra={"webhookId": str(uuid.uuid4())})

def ainda_ativo(name, x):
    # continua só se a etapa no Close ainda for < 4 (não respondeu / não morreu)
    return node(name, "n8n-nodes-base.if", 2.3, {
        "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
                       "conditions": [{"id": str(uuid.uuid4()),
                                       "leftValue": f"={{{{ parseInt($json['{ETAPA}'] || '0') }}}}",
                                       "rightValue": 4, "operator": {"type": "number", "operation": "lt"}}],
                       "combinator": "and"}, "options": {}}, x)

def whatsapp(name, x, to_expr, tpl, vars_expr):
    return node(name, "n8n-nodes-base.httpRequest", 4.4, {
        "method": "POST", "url": TWILIO_MSG,
        "authentication": "genericCredentialType", "genericAuthType": "httpBasicAuth",
        "sendBody": True, "contentType": "form-urlencoded",
        "bodyParameters": {"parameters": [
            {"name": "From", "value": WA_FROM},
            {"name": "To", "value": f"=whatsapp:{{{{ {to_expr} }}}}"},
            {"name": "ContentSid", "value": tpl},
            {"name": "ContentVariables", "value": f"={{{{ JSON.stringify({vars_expr}) }}}}"},
        ]}, "options": {}}, x, TWILIO_CRED)

nodes = [
    node("Webhook", "n8n-nodes-base.webhook", 2.1, {"httpMethod": "POST", "path": "start-outreach", "options": {}},
         0, extra={"webhookId": str(uuid.uuid4())}),
    close_get("Ler lead", 220, "$json.body.leadId"),
    node("Preparar", "n8n-nodes-base.code", 2, {"jsCode": PREPARAR}, 440),
    node("Render email (Close)", "n8n-nodes-base.httpRequest", 4.4, {
        "url": f"=https://api.close.com/api/v1/email_template/{{{{ {P}.emailTemplateId }}}}/render/",
        "authentication": "genericCredentialType", "genericAuthType": "httpBasicAuth",
        "sendQuery": True, "queryParameters": {"parameters": [{"name": "lead_id", "value": f"={{{{ {P}.leadId }}}}"}, {"name": "contact_id", "value": f"={{{{ {P}.contactId }}}}"}]},
        "options": {}}, 660, CLOSE_CRED),
    node("Email 1 (Close)", "n8n-nodes-base.httpRequest", 4.4, {
        "method": "POST", "url": "https://api.close.com/api/v1/activity/email/",
        "authentication": "genericCredentialType", "genericAuthType": "httpBasicAuth",
        "sendBody": True, "specifyBody": "json",
        "jsonBody": f"={{{{ JSON.stringify({{lead_id: {P}.leadId, contact_id: {P}.contactId, template_id: {P}.emailTemplateId, email_account_id: '{EMAIL_ACCOUNT}', status: 'outbox', sender: 'Nome Apelido <comercial@empresa.example>', to: [{P}.email], subject: $json.subject, body_html: $json.body}}) }}}}",
        "options": {}}, 880, CLOSE_CRED),
    etapa("Etapa 1 - Email", 1100, 1),
    wait("Esperar 4 dias", 1320, "delay1"),
    close_get("Reler lead A", 1540, f"{P}.leadId"),
    ainda_ativo("Ainda sem resposta? A", 1760),
    node("Tem WhatsApp?", "n8n-nodes-base.if", 2.3, {
        "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
                       "conditions": [{"id": str(uuid.uuid4()), "leftValue": f"={{{{ {P}.waContentSid }}}}", "rightValue": "HX", "operator": {"type": "string", "operation": "startsWith"}}],
                       "combinator": "and"}, "options": {}}, 1980),
    whatsapp("WhatsApp ao lead", 2200, f"{P}.phone", f"={{{{ {P}.waContentSid }}}}",
             f"{{'1': {P}.firstName, '2': {P}.name}}"),
    etapa("Etapa 2 - WhatsApp", 2420, 2),
    wait("Esperar 3 dias", 2640, "delay2"),
    close_get("Reler lead B", 2860, f"{P}.leadId"),
    ainda_ativo("Ainda sem resposta? B", 3080),
    node("Tarefa Close: ligar", "n8n-nodes-base.httpRequest", 4.4, {
        "method": "POST", "url": "https://api.close.com/api/v1/task/",
        "authentication": "genericCredentialType", "genericAuthType": "httpBasicAuth",
        "sendBody": True, "specifyBody": "json",
        "jsonBody": f"={{{{ JSON.stringify({{_type: 'lead', lead_id: {P}.leadId, date: $now.toISODate(), is_complete: false, text: 'Ligar a ' + ({P}.contact ? {P}.contact + ' — ' : '') + {P}.name + ' (' + {P}.phone + ') — 3.º contacto da sequência de prospeção'}}) }}}}",
        "options": {}}, 3300, CLOSE_CRED),
    whatsapp("Avisar equipa", 3520, f"{P}.teamPhone", WA_TPL_TEAM,
             f"{{'1': {P}.contact || '(sem nome)', '2': {P}.name, '3': {P}.phone}}"),
    etapa("Etapa 3 - Chamada", 3740, 3),
]

order = [n["name"] for n in nodes]
connections = {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(order, order[1:])}
# sem template WhatsApp na campanha: salta o passo 2 e vai direto à espera antes da chamada
connections["Tem WhatsApp?"] = {"main": [[{"node": "WhatsApp ao lead", "type": "main", "index": 0}], [{"node": "Esperar 3 dias", "type": "main", "index": 0}]]}
wf = {"name": "Unilinkr - Sequência Outreach", "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1"}}

def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"X-N8N-API-KEY": KEY, "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:1500]); sys.exit(1)

existing = [w for w in call("GET", "/workflows?limit=100")["data"] if w["name"] == wf["name"]]
if existing:
    wid = existing[0]["id"]; call("PUT", f"/workflows/{wid}", wf); print("updated", wid)
else:
    wid = call("POST", "/workflows", wf)["id"]; print("created", wid)
# A activação está atrás de uma porta.
#
# Antes o script activava sempre no fim. Depois de 19/09/2026 isso passou a ser
# um problema: correr este ficheiro — para inspecionar, para recriar a
# definição, por engano — voltava a pôr a cadeia a mandar emails de campanha,
# que foi exactamente o que se decidiu acabar. E ninguém dava por isso até uma
# empresa receber um email que não devia.
if os.environ.get("RELIGAR") == "1":
    r = call("POST", f"/workflows/{wid}/activate")
    print("active:", r.get("active"), "| nodes:", len(r.get("nodes", [])))
else:
    print(f"workflow {wid} gravado e DEIXADO DESLIGADO.")
    print("A sequência foi desligada a 19/09/2026 de propósito — os emails são escritos à mão.")
    print("Para a religar mesmo a sério: RELIGAR=1 python3 n8n-sequencia-outreach.py")
