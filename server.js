'use strict';
// Boutique SaaS — serveur sans dépendance externe
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { users: [], states: {}, sessions: {} };
try {
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) { console.error('db read', e.message); }

function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function uid() { return crypto.randomBytes(12).toString('hex'); }
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function safeEqual(a, b) {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (p) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const s = db.sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) { delete db.sessions[token]; persist(); return null; }
  return db.users.find(function (u) { return u.id === s.userId; }) || null;
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let raw = '';
    req.on('data', function (c) {
      raw += c;
      if (raw.length > 2000000) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', function () {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extraHeaders || {}));
  res.end(body);
}
function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId: userId, expires: Date.now() + 30 * 24 * 3600 * 1000 };
  persist();
  return 'sid=' + token + '; HttpOnly; Path=/; Max-Age=' + (30 * 24 * 3600) + '; SameSite=Lax';
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon'
};

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    if (p.startsWith('/api/')) {
      const method = req.method;

      if (p === '/api/signup' && method === 'POST') {
        const b = await readBody(req);
        const email = String(b.email || '').trim().toLowerCase();
        const shop = String(b.shop || '').trim();
        const password = String(b.password || '');
        if (!email || email.indexOf('@') < 1) return json(res, 400, { error: 'Adresse e-mail invalide.' });
        if (!shop) return json(res, 400, { error: 'Nom de la boutique obligatoire.' });
        if (password.length < 6) return json(res, 400, { error: 'Mot de passe : 6 caractères minimum.' });
        if (db.users.some(function (u) { return u.email === email; })) return json(res, 409, { error: 'Ce compte existe déjà.' });
        const salt = crypto.randomBytes(16).toString('hex');
        const user = { id: uid(), email: email, shop: shop, salt: salt, hash: hashPassword(password, salt), createdAt: new Date().toISOString() };
        db.users.push(user);
        db.states[user.id] = null;
        persist();
        const cookie = setSession(res, user.id);
        return json(res, 200, { user: { id: user.id, email: user.email, shop: user.shop } }, { 'Set-Cookie': cookie });
      }

      if (p === '/api/login' && method === 'POST') {
        const b = await readBody(req);
        const email = String(b.email || '').trim().toLowerCase();
        const password = String(b.password || '');
        const user = db.users.find(function (u) { return u.email === email; });
        if (!user) return json(res, 401, { error: 'Compte introuvable.' });
        if (!safeEqual(hashPassword(password, user.salt), user.hash)) return json(res, 401, { error: 'Mot de passe incorrect.' });
        const cookie = setSession(res, user.id);
        return json(res, 200, { user: { id: user.id, email: user.email, shop: user.shop } }, { 'Set-Cookie': cookie });
      }

      if (p === '/api/logout' && method === 'POST') {
        const token = parseCookies(req).sid;
        if (token) { delete db.sessions[token]; persist(); }
        return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
      }

      if (p === '/api/me' && method === 'GET') {
        const u = currentUser(req);
        if (!u) return json(res, 401, { error: 'non connecté' });
        return json(res, 200, { user: { id: u.id, email: u.email, shop: u.shop } });
      }

      if (p === '/api/state') {
        const u = currentUser(req);
        if (!u) return json(res, 401, { error: 'non connecté' });
        if (method === 'GET') {
          return json(res, 200, { state: db.states[u.id] || null });
        }
        if (method === 'PUT') {
          const b = await readBody(req);
          if (!b || typeof b.state !== 'object' || b.state === null) return json(res, 400, { error: 'état invalide' });
          db.states[u.id] = b.state;
          persist();
          return json(res, 200, { ok: true, savedAt: new Date().toISOString() });
        }
      }

      return json(res, 404, { error: 'route inconnue' });
    }

    // fichiers statiques
    let file = p === '/' ? '/index.html' : p;
    file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
    const full = path.join(PUBLIC_DIR, file);
    if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(full, function (err, data) {
      if (err) {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), function (e2, html) {
          if (e2) { res.writeHead(404); return res.end('not found'); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    json(res, 500, { error: 'erreur serveur' });
  }
});

server.listen(PORT, function () {
  console.log('Boutique SaaS en écoute sur le port ' + PORT);
});
