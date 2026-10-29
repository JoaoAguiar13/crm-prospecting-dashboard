// Lista de acessos em disco (ver lib/store.js). Quem tem @empresa.example
// entra sempre; externos só se estiverem aqui.
import { readJson, writeJson } from './store.js';

export const DOMAIN = process.env.ALLOWED_DOMAIN || 'empresa.example';
const PATH = 'acessos.json';
const SEED = { users: [
  { email: 'consultor@exemplo.com', admin: true },
  { email: 'admin@empresa.example', admin: true },
  { email: 'comercial@empresa.example', admin: false },
  { email: 'equipa@empresa.example', admin: false },
] };

export const readAccess = () => readJson(PATH, SEED);
export const writeAccess = (acl) => writeJson(PATH, acl);

export const isAllowed = (acl, email) => email.endsWith('@' + DOMAIN) || acl.users.some(u => u.email === email);
export const isAdmin = (acl, email) => !!acl.users.find(u => u.email === email)?.admin;
