const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* sem .env: usa os padrões */ }

const express = require('express');
const multer = require('multer');
const { db, UPLOAD_DIR, hashPassword, verifyPassword, getSettings, saveSettings } = require('./db');

const app = express();
const PROD = process.env.NODE_ENV === 'production';
const portArg = process.argv.find(a => a.startsWith('--port='));
const PORT = Number(portArg?.slice(7)) || Number(process.env.PORT) || 3000;
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://i.ytimg.com",
    "frame-src https://www.youtube-nocookie.com",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});
app.use(express.json({ limit: '200kb' }));

// ---------- utilidades ----------
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, error) => res.status(status).json({ error });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const digits = v => String(v ?? '').replace(/\D/g, '');
const str = (v, max = 5000) => String(v ?? '').trim().slice(0, max);

function validCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(cpf[len])) return false;
  }
  return true;
}

const buckets = new Map();
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = name + ':' + req.ip;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now > b.reset) { buckets.set(key, { n: 1, reset: now + windowMs }); return next(); }
    if (++b.n > max) return fail(res, 429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60_000).unref();

function youtubeId(input) {
  const s = String(input ?? '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
  return m ? m[1] : '';
}

function removeUpload(file) {
  if (!file || !/^[\w-]+\.(jpg|png|webp)$/.test(file)) return;
  fs.rm(path.join(UPLOAD_DIR, file), { force: true }, () => {});
}

// ---------- sessão ----------
const COOKIE = 'umjiu_s';
const SESSION_MS = 7 * 24 * 3600 * 1000;
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function setSessionCookie(res, token, maxAgeMs) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${PROD ? '; Secure' : ''}`);
}
function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(token));
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}
function requireAdmin(req, res, next) {
  // Toda alteração precisa do cabeçalho abaixo: um formulário de outro site não consegue enviá-lo.
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'umjiu-admin') return fail(res, 403, 'Requisição recusada.');
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'Faça login para continuar.');
  req.user = user;
  next();
}

// ---------- uploads ----------
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + '.' + EXT[file.mimetype])
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXT[file.mimetype]))
});

// =====================================================================
// API pública
// =====================================================================
function publicEvents() {
  return db.prepare(`
    SELECT e.id, e.title, e.description, e.details, e.starts_on, e.ends_on, e.location, e.audience,
           e.price_cents, e.max_installments, e.capacity, e.cover, e.featured, e.registration_open,
           (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status <> 'cancelada') AS taken
    FROM events e WHERE e.published = 1 ORDER BY e.starts_on ASC`).all()
    .map(e => {
      const { taken, ...rest } = e;
      return { ...rest, spots_left: e.capacity > 0 ? Math.max(0, e.capacity - taken) : null };
    });
}

app.get('/api/site', (req, res) => {
  const albums = db.prepare(`
    SELECT a.id, a.title, a.description, a.event_date,
           (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) AS count,
           COALESCE((SELECT thumb FROM photos p WHERE p.id = a.cover_photo_id),
                    (SELECT thumb FROM photos p WHERE p.album_id = a.id ORDER BY p.id LIMIT 1), '') AS cover
    FROM albums a WHERE a.published = 1 ORDER BY a.event_date DESC, a.id DESC`).all().filter(a => a.count > 0);
  const preview = albums.length
    ? db.prepare('SELECT id, album_id, thumb, width, height FROM photos WHERE album_id IN (SELECT id FROM albums WHERE published = 1) ORDER BY id DESC LIMIT 10').all()
    : [];
  res.json({
    settings: getSettings(),
    events: publicEvents(),
    videos: db.prepare('SELECT id, youtube_id, title, preacher, series, preached_on, duration, featured FROM videos WHERE published = 1 ORDER BY preached_on DESC, id DESC').all(),
    albums,
    preview,
    posts: db.prepare('SELECT id, tag, title, body, author, published_on FROM posts WHERE published = 1 ORDER BY published_on DESC, id DESC').all()
  });
});

app.get('/api/albums/:id', (req, res) => {
  const album = db.prepare('SELECT id, title, description, event_date FROM albums WHERE id = ? AND published = 1').get(Number(req.params.id) || 0);
  if (!album) return fail(res, 404, 'Álbum não encontrado.');
  album.photos = db.prepare('SELECT id, file, thumb, width, height, caption FROM photos WHERE album_id = ? ORDER BY id').all(album.id);
  res.json(album);
});

// Preenchimento automático: só devolve os dados se CPF e data de nascimento conferirem
// e se a pessoa autorizou guardar os dados (LGPD).
app.post('/api/lookup', rateLimit('lookup', 10, 15 * 60_000), (req, res) => {
  const cpf = digits(req.body.cpf);
  const birth = str(req.body.birth, 10);
  if (!validCpf(cpf) || !DATE_RE.test(birth)) return fail(res, 400, 'Informe um CPF válido e a data de nascimento.');
  const row = db.prepare(`
    SELECT r.name, r.email, r.phone, r.birth, r.city, r.church, r.shirt, e.title AS origem
    FROM registrations r JOIN events e ON e.id = r.event_id
    WHERE r.cpf = ? AND r.birth = ? AND r.consent = 1 ORDER BY r.id DESC LIMIT 1`).get(cpf, birth);
  res.json({ found: Boolean(row), data: row || null });
});

app.post('/api/registrations', rateLimit('reg', 20, 60 * 60_000), (req, res) => {
  const b = req.body || {};
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND published = 1').get(Number(b.event_id) || 0);
  if (!event) return fail(res, 404, 'Evento não encontrado.');
  if (!event.registration_open) return fail(res, 409, 'As inscrições deste evento estão encerradas.');

  const cpf = digits(b.cpf);
  const data = {
    name: str(b.name, 120), email: str(b.email, 160).toLowerCase(), phone: str(b.phone, 30),
    birth: str(b.birth, 10), city: str(b.city, 100), church: str(b.church, 120),
    shirt: str(b.shirt, 4), notes: str(b.notes, 500)
  };
  if (!validCpf(cpf)) return fail(res, 400, 'CPF inválido.');
  if (data.name.length < 3) return fail(res, 400, 'Informe o nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return fail(res, 400, 'E-mail inválido.');
  if (digits(data.phone).length < 10) return fail(res, 400, 'Informe o WhatsApp com DDD.');
  if (data.birth && !DATE_RE.test(data.birth)) return fail(res, 400, 'Data de nascimento inválida.');

  if (db.prepare(`SELECT 1 FROM registrations WHERE event_id = ? AND cpf = ? AND status <> 'cancelada'`).get(event.id, cpf)) {
    return fail(res, 409, 'Este CPF já está inscrito neste evento.');
  }
  if (event.capacity > 0) {
    const taken = db.prepare(`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status <> 'cancelada'`).get(event.id).n;
    if (taken >= event.capacity) return fail(res, 409, 'As vagas deste evento se esgotaram.');
  }

  const free = event.price_cents === 0;
  const method = free ? 'gratuito' : 'pix';
  const installments = free ? 1 : Math.min(Math.max(1, Number(b.installments) || 1), Math.max(1, event.max_installments));
  const code = 'UM' + crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare(`INSERT INTO registrations (event_id, code, cpf, name, email, phone, birth, city, church, shirt, notes, consent, pay_method, installments, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(event.id, code, cpf, data.name, data.email, data.phone, data.birth, data.city, data.church, data.shirt, data.notes,
      b.consent ? 1 : 0, method, installments, free ? 'pago' : 'pendente');
  res.status(201).json({ code, installments, free });
});

// =====================================================================
// Painel administrativo
// =====================================================================
const admin = express.Router();

admin.post('/login', rateLimit('login', 8, 15 * 60_000), (req, res) => {
  if (req.get('X-Requested-With') !== 'umjiu-admin') return fail(res, 403, 'Requisição recusada.');
  const email = str(req.body.email, 160).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.pass_hash)) return fail(res, 401, 'E-mail ou senha incorretos.');
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), user.id, Date.now() + SESSION_MS);
  setSessionCookie(res, token, SESSION_MS);
  res.json({ email: user.email, name: user.name });
});

admin.get('/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'Sem sessão.');
  res.json({ email: user.email, name: user.name });
});

admin.use(requireAdmin);

admin.post('/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(readCookie(req, COOKIE)));
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

admin.post('/password', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const next = String(req.body.next || '');
  if (!verifyPassword(String(req.body.current || ''), user.pass_hash)) return fail(res, 400, 'A senha atual não confere.');
  if (next.length < 8) return fail(res, 400, 'A nova senha precisa de pelo menos 8 caracteres.');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user.id, sha(readCookie(req, COOKIE)));
  res.json({ ok: true });
});

admin.get('/stats', (req, res) => {
  const one = sql => db.prepare(sql).get().n;
  res.json({
    events: one('SELECT COUNT(*) AS n FROM events WHERE published = 1'),
    registrations: one(`SELECT COUNT(*) AS n FROM registrations WHERE status <> 'cancelada'`),
    pending: one(`SELECT COUNT(*) AS n FROM registrations WHERE status = 'pendente'`),
    photos: one('SELECT COUNT(*) AS n FROM photos'),
    videos: one('SELECT COUNT(*) AS n FROM videos'),
    posts: one('SELECT COUNT(*) AS n FROM posts'),
    latest: db.prepare(`SELECT r.id, r.name, r.status, r.created_at, e.title AS event FROM registrations r JOIN events e ON e.id = r.event_id ORDER BY r.id DESC LIMIT 6`).all()
  });
});

// ----- recursos com cadastro simples (eventos, vídeos, álbuns, mural) -----
const RESOURCES = {
  events: {
    fields: { title: 's', description: 's', details: 's', starts_on: 'd', ends_on: 'd', location: 's', audience: 's',
      price_cents: 'i', max_installments: 'i', capacity: 'i', cover: 'f', published: 'b', featured: 'b', registration_open: 'b' },
    required: ['title', 'starts_on'],
    list: `SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status <> 'cancelada') AS registrations FROM events e ORDER BY e.starts_on DESC`
  },
  videos: {
    fields: { youtube_id: 'y', title: 's', preacher: 's', series: 's', preached_on: 'd', duration: 's', published: 'b', featured: 'b' },
    required: ['title'],
    list: 'SELECT * FROM videos ORDER BY preached_on DESC, id DESC'
  },
  albums: {
    fields: { title: 's', description: 's', event_date: 'd', published: 'b' },
    required: ['title'],
    list: `SELECT a.*, (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) AS count,
      COALESCE((SELECT thumb FROM photos p WHERE p.id = a.cover_photo_id), (SELECT thumb FROM photos p WHERE p.album_id = a.id ORDER BY p.id LIMIT 1), '') AS cover
      FROM albums a ORDER BY a.event_date DESC, a.id DESC`
  },
  posts: {
    fields: { tag: 's', title: 's', body: 's', author: 's', published_on: 'd', published: 'b' },
    required: ['title'],
    list: 'SELECT * FROM posts ORDER BY published_on DESC, id DESC'
  }
};

function parseBody(cfg, body, partial) {
  const out = {};
  for (const [field, type] of Object.entries(cfg.fields)) {
    if (!(field in body)) continue;
    const v = body[field];
    if (type === 's') out[field] = str(v);
    else if (type === 'd') { const d = str(v, 10); if (d && !DATE_RE.test(d)) throw new Error('Data inválida.'); out[field] = d; }
    else if (type === 'i') out[field] = Math.max(0, Math.min(Math.round(Number(v) || 0), 100_000_000));
    else if (type === 'b') out[field] = v ? 1 : 0;
    else if (type === 'f') out[field] = /^[\w-]+\.(jpg|png|webp)$/.test(String(v)) ? String(v) : '';
    else if (type === 'y') {
      const id = youtubeId(v);
      if (str(v) && !id) throw new Error('Não reconheci esse link do YouTube.');
      out[field] = id;
    }
  }
  for (const field of cfg.required) {
    if ((!partial || field in out) && !out[field]) throw new Error('Preencha os campos obrigatórios.');
  }
  if (out.max_installments !== undefined) out.max_installments = Math.min(Math.max(1, out.max_installments), 12);
  return out;
}

for (const [name, cfg] of Object.entries(RESOURCES)) {
  admin.get('/' + name, (req, res) => res.json(db.prepare(cfg.list).all()));

  admin.post('/' + name, (req, res) => {
    let data;
    try { data = parseBody(cfg, req.body || {}, false); } catch (e) { return fail(res, 400, e.message); }
    const cols = Object.keys(data);
    if (name === 'videos' && data.featured) db.prepare('UPDATE videos SET featured = 0').run();
    const info = db.prepare(`INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => data[c]));
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  admin.put('/' + name + '/:id', (req, res) => {
    const id = Number(req.params.id) || 0;
    const before = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
    if (!before) return fail(res, 404, 'Registro não encontrado.');
    let data;
    try { data = parseBody(cfg, req.body || {}, true); } catch (e) { return fail(res, 400, e.message); }
    const cols = Object.keys(data);
    if (!cols.length) return res.json({ ok: true });
    if (name === 'videos' && data.featured) db.prepare('UPDATE videos SET featured = 0').run();
    db.prepare(`UPDATE ${name} SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).run(...cols.map(c => data[c]), id);
    if (name === 'events' && 'cover' in data && before.cover && before.cover !== data.cover) removeUpload(before.cover);
    res.json({ ok: true });
  });

  admin.delete('/' + name + '/:id', (req, res) => {
    const id = Number(req.params.id) || 0;
    const row = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
    if (!row) return fail(res, 404, 'Registro não encontrado.');
    if (name === 'events') removeUpload(row.cover);
    if (name === 'albums') {
      for (const p of db.prepare('SELECT file, thumb FROM photos WHERE album_id = ?').all(id)) { removeUpload(p.file); removeUpload(p.thumb); }
    }
    db.prepare(`DELETE FROM ${name} WHERE id = ?`).run(id);
    res.json({ ok: true });
  });
}

// ----- imagens -----
admin.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return fail(res, 400, 'Envie uma imagem JPG, PNG ou WebP.');
  res.status(201).json({ file: req.file.filename });
});

admin.get('/albums/:id/photos', (req, res) => {
  res.json(db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY id').all(Number(req.params.id) || 0));
});

admin.post('/albums/:id/photos', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), (req, res) => {
  const file = req.files?.file?.[0];
  const thumb = req.files?.thumb?.[0];
  const album = db.prepare('SELECT id FROM albums WHERE id = ?').get(Number(req.params.id) || 0);
  if (!file || !album) {
    removeUpload(file?.filename); removeUpload(thumb?.filename);
    return fail(res, 400, file ? 'Álbum não encontrado.' : 'Envie uma imagem JPG, PNG ou WebP.');
  }
  const info = db.prepare('INSERT INTO photos (album_id, file, thumb, width, height) VALUES (?, ?, ?, ?, ?)')
    .run(album.id, file.filename, (thumb || file).filename, Math.min(Number(req.body.width) || 0, 20000), Math.min(Number(req.body.height) || 0, 20000));
  res.status(201).json(db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(info.lastInsertRowid)));
});

admin.put('/photos/:id', (req, res) => {
  const id = Number(req.params.id) || 0;
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
  if (!photo) return fail(res, 404, 'Foto não encontrada.');
  if ('caption' in req.body) db.prepare('UPDATE photos SET caption = ? WHERE id = ?').run(str(req.body.caption, 200), id);
  if (req.body.cover) db.prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').run(id, photo.album_id);
  res.json({ ok: true });
});

admin.delete('/photos/:id', (req, res) => {
  const id = Number(req.params.id) || 0;
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
  if (!photo) return fail(res, 404, 'Foto não encontrada.');
  db.prepare('UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = ?').run(id);
  db.prepare('DELETE FROM photos WHERE id = ?').run(id);
  removeUpload(photo.file);
  if (photo.thumb !== photo.file) removeUpload(photo.thumb);
  res.json({ ok: true });
});

// ----- YouTube: busca o título para o administrador não precisar digitar -----
admin.get('/youtube', wrap(async (req, res) => {
  const id = youtubeId(req.query.url);
  if (!id) return fail(res, 400, 'Não reconheci esse link do YouTube.');
  let title = '', author = '';
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { signal: AbortSignal.timeout(6000) });
    if (r.ok) { const j = await r.json(); title = str(j.title, 200); author = str(j.author_name, 120); }
  } catch { /* sem internet: o administrador digita o título */ }
  res.json({ id, title, author });
}));

// ----- inscrições -----
function registrationRows(query) {
  const where = [], args = [];
  if (Number(query.event)) { where.push('r.event_id = ?'); args.push(Number(query.event)); }
  if (['pendente', 'pago', 'cancelada'].includes(query.status)) { where.push('r.status = ?'); args.push(query.status); }
  return db.prepare(`SELECT r.*, e.title AS event, e.price_cents FROM registrations r JOIN events e ON e.id = r.event_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC`).all(...args);
}
admin.get('/registrations', (req, res) => res.json(registrationRows(req.query)));

admin.get('/registrations.csv', (req, res) => {
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmula ao abrir no Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ['Código', 'Evento', 'Nome', 'CPF', 'E-mail', 'WhatsApp', 'Nascimento', 'Cidade', 'Igreja', 'Camiseta', 'Observações', 'Pagamento', 'Parcelas', 'Situação', 'Inscrito em'];
  const lines = registrationRows(req.query).map(r => [r.code, r.event, r.name, r.cpf, r.email, r.phone, r.birth, r.city, r.church, r.shirt, r.notes, r.pay_method, r.installments, r.status, r.created_at].map(cell).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="inscricoes-umjiu.csv"');
  res.send('﻿' + [head.map(cell).join(';'), ...lines].join('\r\n'));
});

admin.put('/registrations/:id', (req, res) => {
  if (!['pendente', 'pago', 'cancelada'].includes(req.body.status)) return fail(res, 400, 'Situação inválida.');
  const info = db.prepare('UPDATE registrations SET status = ? WHERE id = ?').run(req.body.status, Number(req.params.id) || 0);
  if (!info.changes) return fail(res, 404, 'Inscrição não encontrada.');
  res.json({ ok: true });
});

admin.delete('/registrations/:id', (req, res) => {
  db.prepare('DELETE FROM registrations WHERE id = ?').run(Number(req.params.id) || 0);
  res.json({ ok: true });
});

// ----- configurações -----
admin.get('/settings', (req, res) => res.json(getSettings()));
admin.put('/settings', (req, res) => { saveSettings(req.body || {}); res.json(getSettings()); });

app.use('/api/admin', admin);
app.use('/api', (req, res) => fail(res, 404, 'Rota não encontrada.'));

// ---------- arquivos ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: PROD ? '1h' : 0 }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'A imagem passa de 12 MB.' : 'Não foi possível receber o arquivo.');
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return fail(res, 400, 'Dados inválidos.');
  console.error(err);
  fail(res, 500, 'Erro interno. Tente de novo.');
});

app.listen(PORT, () => console.log(`UMJIU no ar: http://localhost:${PORT}  (painel em /admin)`));
