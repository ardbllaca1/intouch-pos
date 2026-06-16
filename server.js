require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DOMAIN = (process.env.ROOT_DOMAIN || 'intouch-data.com').toLowerCase();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const API_KEY = process.env.API_KEY || 'change-this-api-key';

// ── Database setup ──────────────────────────────────────────────
const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);

const db = new Database(path.join(DB_DIR, 'pos.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain   TEXT    UNIQUE NOT NULL,
    name        TEXT    NOT NULL,
    language    TEXT    NOT NULL DEFAULT 'sq',
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain   TEXT    NOT NULL,
    username    TEXT    NOT NULL,
    password    TEXT    NOT NULL,
    UNIQUE(subdomain, username)
  );

  CREATE TABLE IF NOT EXISTS sales_summary (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain    TEXT NOT NULL,
    date         TEXT NOT NULL,
    total_sales  REAL DEFAULT 0,
    updated_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(subdomain, date)
  );

  CREATE TABLE IF NOT EXISTS waiter_summary (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain  TEXT NOT NULL,
    date       TEXT NOT NULL,
    name       TEXT NOT NULL,
    total      REAL DEFAULT 0,
    UNIQUE(subdomain, date, name)
  );

  CREATE TABLE IF NOT EXISTS department_summary (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain  TEXT NOT NULL,
    date       TEXT NOT NULL,
    name       TEXT NOT NULL,
    total      REAL DEFAULT 0,
    UNIQUE(subdomain, date, name)
  );

  CREATE TABLE IF NOT EXISTS hourly_summary (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain  TEXT NOT NULL,
    date       TEXT NOT NULL,
    hour       TEXT NOT NULL,
    count      INTEGER DEFAULT 0,
    UNIQUE(subdomain, date, hour)
  );

  CREATE TABLE IF NOT EXISTS tables_status (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain  TEXT NOT NULL,
    date       TEXT NOT NULL,
    name       TEXT NOT NULL,
    active     INTEGER DEFAULT 0,
    UNIQUE(subdomain, date, name)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain  TEXT NOT NULL,
    date       TEXT NOT NULL,
    produkti   TEXT NOT NULL,
    sasia      INTEGER DEFAULT 1,
    vlera      REAL DEFAULT 0,
    tav        TEXT,
    time       TEXT,
    kam        TEXT,
    is_active  INTEGER DEFAULT 0,
    session_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products_summary (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain  TEXT NOT NULL,
    date       TEXT NOT NULL,
    produkti   TEXT NOT NULL,
    sasia      INTEGER DEFAULT 0,
    qmimi      REAL DEFAULT 0,
    vlera      REAL DEFAULT 0,
    UNIQUE(subdomain, date, produkti)
  );
`);

function ensureColumn(tableName, columnName, definition) {
  const hasColumn = db.prepare(`PRAGMA table_info(${tableName})`).all().some(col => col.name === columnName);
  if (!hasColumn) db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
}

ensureColumn('orders', 'is_active', 'INTEGER DEFAULT 0');
ensureColumn('orders', 'session_id', 'TEXT');
ensureColumn('tables_status', 'opened_at', 'TEXT');
ensureColumn('clients', 'language', "TEXT NOT NULL DEFAULT 'sq'");

// ── Middleware ──────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
    }
  }
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── Helpers ─────────────────────────────────────────────────────
function getSubdomain(req) {
  const host = req.headers.host || '';
  const hostname = host.split(':')[0].toLowerCase();
  const skipSubdomainExtraction = hostname === 'localhost' || net.isIP(hostname) !== 0;
  if (!skipSubdomainExtraction) {
    if (hostname.endsWith(`.${ROOT_DOMAIN}`) && hostname !== `www.${ROOT_DOMAIN}`) {
      return hostname.slice(0, -ROOT_DOMAIN.length - 1).split('.')[0];
    }
    if (hostname !== ROOT_DOMAIN && hostname !== `www.${ROOT_DOMAIN}`) {
      const parts = hostname.split('.');
      if (parts.length >= 3 && parts[0] !== 'www') return parts[0].toLowerCase();
    }
  }
  const requestedClient = req.query.client || req.headers['x-subdomain'];
  if (requestedClient) return String(requestedClient).toLowerCase();
  if (req.user && req.user.subdomain) return String(req.user.subdomain).toLowerCase();

  const clients = db.prepare('SELECT subdomain FROM clients LIMIT 2').all();
  return clients.length === 1 ? clients[0].subdomain : null;
}

app.get(['/', '/index.html', '/index-sr.html'], (req, res) => {
  const subdomain = getSubdomain(req);
  const client = subdomain
    ? db.prepare('SELECT language FROM clients WHERE subdomain = ?').get(subdomain)
    : null;
  const loginPage = client && client.language === 'sr' ? 'index-sr.html' : 'index.html';
  res.sendFile(path.join(__dirname, 'public', loginPage));
});

app.use(express.static(path.join(__dirname, 'public')));

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    const subdomain = getSubdomain(req);
    if (subdomain && decoded.subdomain && subdomain !== decoded.subdomain) {
      return res.status(401).json({ error: 'Token belongs to a different client' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired' });
  }
}

function apiKeyMiddleware(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

// ── Auth routes ─────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const subdomain = getSubdomain(req);
  const client = subdomain
    ? db.prepare('SELECT * FROM clients WHERE subdomain = ?').get(subdomain)
    : null;
  const isSerbian = client && client.language === 'sr';
  if (!username || !password) {
    return res.status(400).json({
      error: isSerbian ? 'Korisničko ime i lozinka su obavezni' : 'Username dhe fjalëkalimi janë të nevojshëm'
    });
  }
  if (!subdomain) {
    return res.status(400).json({ error: 'Mungon klienti. Hap linkun me ?client=emri ose perdor subdomain-in.' });
  }
  const user = db.prepare(
    'SELECT * FROM users WHERE subdomain = ? AND username = ?'
  ).get(subdomain, username);
  if (!user) return res.status(401).json({ error: isSerbian ? 'Pogrešni podaci za prijavu' : 'Kredencialet janë të gabuara' });
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: isSerbian ? 'Pogrešni podaci za prijavu' : 'Kredencialet janë të gabuara' });
  const token = jwt.sign({ username, subdomain }, JWT_SECRET, { expiresIn: '12h' });
  res.json({
    token,
    subdomain,
    restaurantName: client ? client.name : subdomain,
    language: client && client.language === 'sr' ? 'sr' : 'sq'
  });
});

// ── Sales data route ────────────────────────────────────────────
app.get('/api/sales/today', authMiddleware, (req, res) => {
  const subdomain = getSubdomain(req);
  const date = todayDate();

  const summary = db.prepare(
    'SELECT * FROM sales_summary WHERE subdomain = ? AND date = ?'
  ).get(subdomain, date);

  const byWaiter = db.prepare(
    'SELECT name, total FROM waiter_summary WHERE subdomain = ? AND date = ? ORDER BY total DESC'
  ).all(subdomain, date);

  const byDepartment = db.prepare(
    'SELECT name, total FROM department_summary WHERE subdomain = ? AND date = ? ORDER BY total DESC'
  ).all(subdomain, date);

  const hourly = db.prepare(
    'SELECT hour, count FROM hourly_summary WHERE subdomain = ? AND date = ? ORDER BY hour ASC'
  ).all(subdomain, date);

  const tables = db.prepare(
    `SELECT name, active, opened_at AS openedAt
     FROM tables_status
     WHERE subdomain = ? AND date = ?
     ORDER BY
       CASE WHEN name GLOB '[0-9]*' THEN 0 ELSE 1 END,
       CAST(name AS INTEGER),
       name ASC`
  ).all(subdomain, date);

  const recentOrders = db.prepare(`
    SELECT produkti, sasia, vlera, tav, time, kam, is_active AS isActive, session_id AS sessionId
    FROM orders WHERE subdomain = ? AND date = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(subdomain, date);

  const allOrders = db.prepare(`
    SELECT produkti, sasia, vlera, tav, time, kam, is_active AS isActive, session_id AS sessionId
    FROM orders WHERE subdomain = ? AND date = ?
    ORDER BY created_at DESC
  `).all(subdomain, date);

  const products = db.prepare(`
    SELECT produkti, sasia, qmimi, vlera
    FROM products_summary WHERE subdomain = ? AND date = ?
    ORDER BY sasia DESC
  `).all(subdomain, date);

  res.json({
    date,
    totalSales: summary ? summary.total_sales : 0,
    lastUpdated: summary ? summary.updated_at : null,
    byWaiter,
    byDepartment,
    hourly,
    tables: tables.map(t => ({ ...t, active: t.active === 1 })),
    recentOrders,
    allOrders,
    products
  });
});

// ── VBA push route ───────────────────────────────────────────────
app.post('/api/sales', apiKeyMiddleware, (req, res) => {
  const subdomain = getSubdomain(req);
  const date = todayDate();
  const payload = req.body;
  if (!payload) return res.status(400).json({ error: 'Empty payload' });

  try {
    const upsert = db.transaction(() => {
      db.prepare(`
        INSERT INTO sales_summary (subdomain, date, total_sales, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(subdomain, date)
        DO UPDATE SET total_sales = excluded.total_sales, updated_at = excluded.updated_at
      `).run(subdomain, date, payload.totalSales || 0);

      if (Array.isArray(payload.byWaiter)) {
        db.prepare('DELETE FROM waiter_summary WHERE subdomain = ? AND date = ?').run(subdomain, date);
        const insW = db.prepare('INSERT INTO waiter_summary (subdomain, date, name, total) VALUES (?, ?, ?, ?)');
        for (const w of payload.byWaiter) insW.run(subdomain, date, w.name, w.total);
      }

      if (Array.isArray(payload.byDepartment)) {
        db.prepare('DELETE FROM department_summary WHERE subdomain = ? AND date = ?').run(subdomain, date);
        const insD = db.prepare('INSERT INTO department_summary (subdomain, date, name, total) VALUES (?, ?, ?, ?)');
        for (const d of payload.byDepartment) insD.run(subdomain, date, d.name, d.total);
      }

      if (Array.isArray(payload.hourly)) {
        db.prepare('DELETE FROM hourly_summary WHERE subdomain = ? AND date = ?').run(subdomain, date);
        const insH = db.prepare('INSERT INTO hourly_summary (subdomain, date, hour, count) VALUES (?, ?, ?, ?)');
        for (const h of payload.hourly) insH.run(subdomain, date, h.hour, h.count);
      }

      if (Array.isArray(payload.tables)) {
        db.prepare('DELETE FROM tables_status WHERE subdomain = ? AND date = ?').run(subdomain, date);
        const insT = db.prepare('INSERT INTO tables_status (subdomain, date, name, active, opened_at) VALUES (?, ?, ?, ?, ?)');
        for (const t of payload.tables) insT.run(subdomain, date, t.name, t.active ? 1 : 0, t.openedAt || t.opened_at || null);
      }

      if (Array.isArray(payload.allOrders)) {
        db.prepare('DELETE FROM orders WHERE subdomain = ? AND date = ?').run(subdomain, date);
        const insO = db.prepare(`
          INSERT INTO orders (subdomain, date, produkti, sasia, vlera, tav, time, kam, is_active, session_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const o of payload.allOrders) {
          const isActive = o.isActive || o.active || o.current || o.open ? 1 : 0;
          insO.run(subdomain, date, o.produkti, o.sasia, o.vlera, o.tav, o.time, o.kam, isActive, o.sessionId || o.session_id || null);
        }
      }

      if (Array.isArray(payload.products)) {
        db.prepare('DELETE FROM products_summary WHERE subdomain = ? AND date = ?').run(subdomain, date);
        const insP = db.prepare(`
          INSERT INTO products_summary (subdomain, date, produkti, sasia, qmimi, vlera)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const p of payload.products) {
          insP.run(subdomain, date, p.produkti, p.sasia, p.qmimi, p.vlera);
        }
      }
    });

    upsert();
    console.log(`[${new Date().toISOString()}] Updated: ${subdomain}`);
    res.json({ status: 'ok', subdomain, date });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin routes ─────────────────────────────────────────────────
app.post('/api/admin/client', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { subdomain, name, username, password, language = 'sq' } = req.body;
  if (!subdomain || !name || !username || !password) {
    return res.status(400).json({ error: 'subdomain, name, username, password required' });
  }
  if (!['sq', 'sr'].includes(language)) {
    return res.status(400).json({ error: 'language must be sq or sr' });
  }
  try {
    const hashedPw = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO clients (subdomain, name, language) VALUES (?, ?, ?)').run(subdomain.toLowerCase(), name, language);
    db.prepare('INSERT INTO users (subdomain, username, password) VALUES (?, ?, ?)').run(subdomain.toLowerCase(), username, hashedPw);
    res.json({ status: 'ok', message: `Client '${subdomain}' created` });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Client already exists' });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/clients', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const clients = db.prepare('SELECT subdomain, name, language, created_at FROM clients').all();
  res.json(clients);
});

// ── SPA fallback ────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ───────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`✅ InTouch Dashboard running on http://${HOST}:${PORT}`);
});
