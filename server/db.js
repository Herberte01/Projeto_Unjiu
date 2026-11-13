// Banco de dados (SQLite embutido no Node, sem dependência nativa para instalar).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'umjiu.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '', starts_on TEXT NOT NULL, ends_on TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0, max_installments INTEGER NOT NULL DEFAULT 1,
  capacity INTEGER NOT NULL DEFAULT 0, cover TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0,
  registration_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code TEXT NOT NULL, cpf TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
  birth TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', church TEXT NOT NULL DEFAULT '',
  shirt TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', consent INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT NOT NULL DEFAULT 'pix', installments INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pendente',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reg_event ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_reg_cpf ON registrations(cpf);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY, youtube_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
  preacher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '', preached_on TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '', cover_photo_id INTEGER, published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY, album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  file TEXT NOT NULL, thumb TEXT NOT NULL, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photo_album ON photos(album_id);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY, tag TEXT NOT NULL DEFAULT 'Aviso', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '', published_on TEXT NOT NULL DEFAULT (date('now')),
  published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- senhas ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// ---------- configurações ----------
const DEFAULT_SETTINGS = {
  org_short: 'UMJIU',
  org_name: 'União Mineira dos Jovens das Igrejas Unida',
  hero_eyebrow: 'Bem-vindo à UMJIU',
  hero_title: 'Jovens unidos em Cristo por toda Minas Gerais',
  hero_text: 'A União Mineira dos Jovens das Igrejas Unida reúne as mocidades das igrejas para adorar, servir e crescer juntas.',
  announcement: '',
  email: '',
  whatsapp: '',
  city: '',
  instagram: '',
  youtube: '',
  pix_key: '',
  pix_holder: ''
};
function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    if (row.key in DEFAULT_SETTINGS) out[row.key] = row.value;
  }
  return out;
}
function saveSettings(values) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof values[key] === 'string') stmt.run(key, values[key].trim().slice(0, 600));
  }
}

// ---------- primeiro acesso ----------
function ensureAdmin() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@umjiu.local').trim().toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    try {
      fs.appendFileSync(path.join(ROOT, '.env'), `\n# Gerado no primeiro acesso. Troque a senha em Configurações no painel.\nADMIN_EMAIL=${email}\nADMIN_PASSWORD=${password}\n`);
      console.log(`\n  Administrador criado: ${email}\n  A senha inicial foi gravada no arquivo .env (ADMIN_PASSWORD).\n`);
    } catch {
      // Em contêiner a pasta do código é somente leitura: defina ADMIN_PASSWORD nas variáveis de ambiente.
      console.log(`\n  Administrador criado: ${email}\n  Senha inicial (troque em Configurações): ${password}\n`);
    }
  }
  db.prepare('INSERT INTO users (email, name, pass_hash) VALUES (?, ?, ?)').run(email, 'Administrador', hashPassword(password));
}

// ---------- conteúdo de demonstração (o mesmo da versão de validação) ----------
function seedDemo() {
  if (db.prepare('SELECT COUNT(*) AS n FROM events').get().n > 0) return;
  if (process.env.SEED_DEMO === '0') return;
  const ev = db.prepare(`INSERT INTO events (title, description, details, starts_on, ends_on, location, audience, price_cents, max_installments, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ev.run('Encontro Regional de Jovens', 'Um dia inteiro de louvor, palavra e almoço juntos.', '', '2026-11-21', '', '[IGREJA ANFITRIÃ]', 'Todas as igrejas', 9000, 1, 1);
  ev.run('Retiro de Liderança Jovem', 'Um fim de semana de formação para quem lidera os jovens nas igrejas, com hospedagem e refeições.', '', '2026-12-05', '2026-12-07', '[LOCAL DO EVENTO]', 'Líderes de mocidade', 62000, 2, 0);
  ev.run('Acampamento de Jovens 2027', 'Quatro dias de louvor, palavra e comunhão fora da cidade.', '', '2027-02-14', '2027-02-17', '[LOCAL DO EVENTO]', 'Jovens de 15 a 29 anos', 48000, 5, 1);

  const vd = db.prepare('INSERT INTO videos (title, preacher, series, preached_on, duration) VALUES (?, ?, ?, ?, ?)');
  vd.run('A fé que permanece', 'Pr. [NOME]', '[NOME DA SÉRIE]', '2026-10-19', '48:12');
  vd.run('Servir com alegria', 'Pra. [NOME]', '', '2026-10-12', '41:05');
  vd.run('Família no altar', 'Pr. [NOME]', '', '2026-10-05', '52:40');
  vd.run('Esperança em tempos difíceis', 'Pr. [NOME]', '', '2026-09-28', '45:18');

  const ps = db.prepare('INSERT INTO posts (tag, title, body, author, published_on) VALUES (?, ?, ?, ?, ?)');
  ps.run('Aviso', 'Reunião de líderes de mocidade', 'Líderes das igrejas associadas: reunião on-line na quinta-feira às 20h. O link chega pelo grupo.', 'Diretoria UMJIU', '2026-10-20');
  ps.run('Palavra da semana', 'Perseverar na esperança', 'Um trecho para meditar durante a semana, com uma reflexão curta da diretoria.', 'Pr. [NOME]', '2026-10-18');
  ps.run('Evento', 'Inscrições abertas: Acampamento de Jovens 2027', 'Garanta sua vaga parcelando no Pix sem juros. Quem já participou só precisa informar CPF e data de nascimento.', 'Diretoria UMJIU', '2026-10-15');
}

ensureAdmin();
seedDemo();

module.exports = { db, DATA_DIR, UPLOAD_DIR, hashPassword, verifyPassword, getSettings, saveSettings, DEFAULT_SETTINGS };
