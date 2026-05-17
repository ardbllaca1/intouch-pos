require('dotenv').config();
console.log('ADMIN_KEY loaded as:', process.env.ADMIN_KEY);
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const net = require('net');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});
const PORT = process.env.PORT || 3000;
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

  CREATE TABLE IF NOT EXISTS menu_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain  TEXT NOT NULL,
    name       TEXT NOT NULL,
    icon       TEXT DEFAULT '🍽️',
    color      TEXT DEFAULT '#6366f1',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu_products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain   TEXT NOT NULL,
    code        INTEGER,
    name        TEXT NOT NULL,
    price       REAL NOT NULL,
    category_id INTEGER,
    department  TEXT NOT NULL DEFAULT 'Banaku',
    active      INTEGER DEFAULT 1,
    sort_order  INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS floor_tables (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain  TEXT NOT NULL,
    name       TEXT NOT NULL,
    pos_x      INTEGER DEFAULT 0,
    pos_y      INTEGER DEFAULT 0,
    width      INTEGER DEFAULT 80,
    height     INTEGER DEFAULT 80,
    shape      TEXT DEFAULT 'square',
    status     TEXT DEFAULT 'free',
    waiter_id  INTEGER,
    opened_at  TEXT,
    UNIQUE(subdomain, name)
  );

  CREATE TABLE IF NOT EXISTS live_orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain   TEXT NOT NULL,
    table_id    INTEGER NOT NULL,
    waiter_name TEXT NOT NULL,
    status      TEXT DEFAULT 'open',
    created_at  TEXT DEFAULT (datetime('now')),
    closed_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS live_order_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL,
    product_id   INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    price        REAL NOT NULL,
    qty          INTEGER DEFAULT 1,
    note         TEXT,
    sent_kitchen INTEGER DEFAULT 0,
    sent_bar     INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS live_payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain   TEXT NOT NULL,
    order_id    INTEGER NOT NULL,
    total       REAL NOT NULL,
    cash_given  REAL NOT NULL,
    change_due  REAL NOT NULL,
    waiter_name TEXT,
    closed_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS waiters (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain TEXT NOT NULL,
    name      TEXT NOT NULL,
    pin       TEXT NOT NULL,
    role      TEXT DEFAULT 'waiter',
    active    INTEGER DEFAULT 1,
    UNIQUE(subdomain, name)
  );
`);

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
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ─────────────────────────────────────────────────────
function getSubdomain(req) {
  const host = req.headers.host || '';
  const hostname = host.split(':')[0].toLowerCase();
  const skipSubdomainExtraction = hostname === 'localhost' || net.isIP(hostname) !== 0;
  if (!skipSubdomainExtraction) {
    const parts = hostname.split('.');
    if (parts.length >= 3) return parts[0].toLowerCase();
  }
  return req.query.client || req.headers['x-subdomain'] || null;
}

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

app.locals.authMiddleware = authMiddleware;
app.locals.io = io;

// ── Socket.io ───────────────────────────────────────────────────
io.of(/^\/[a-z0-9-]+$/).on('connection', (socket) => {
  socket.emit('connected', { ok: true });
});

// ── Auth routes ─────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const subdomain = getSubdomain(req);
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dhe fjalëkalimi janë të nevojshëm' });
  }
  const user = db.prepare(
    'SELECT * FROM users WHERE subdomain = ? AND username = ?'
  ).get(subdomain, username);
  if (!user) return res.status(401).json({ error: 'Kredencialet janë të gabuara' });
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Kredencialet janë të gabuara' });
  const client = db.prepare('SELECT * FROM clients WHERE subdomain = ?').get(subdomain);
  const token = jwt.sign({ username, subdomain }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, restaurantName: client ? client.name : subdomain });
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
    'SELECT name, active FROM tables_status WHERE subdomain = ? AND date = ? ORDER BY name ASC'
  ).all(subdomain, date);

  const recentOrders = db.prepare(`
    SELECT produkti, sasia, vlera, tav, time, kam
    FROM orders WHERE subdomain = ? AND date = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(subdomain, date);

  const allOrders = db.prepare(`
    SELECT produkti, sasia, vlera, tav, time, kam
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
        const insT = db.prepare('INSERT INTO tables_status (subdomain, date, name, active) VALUES (?, ?, ?, ?)');
        for (const t of payload.tables) insT.run(subdomain, date, t.name, t.active ? 1 : 0);
      }

      if (Array.isArray(payload.allOrders)) {
        db.prepare('DELETE FROM orders WHERE subdomain = ? AND date = ?').run(subdomain, date);
        const insO = db.prepare(`
          INSERT INTO orders (subdomain, date, produkti, sasia, vlera, tav, time, kam)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const o of payload.allOrders) {
          insO.run(subdomain, date, o.produkti, o.sasia, o.vlera, o.tav, o.time, o.kam);
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

// ── POS routes ──────────────────────────────────────────────────
require('./src/routes/menu')(app, db, getSubdomain);
require('./src/routes/tables')(app, db, getSubdomain, io);
require('./src/routes/orders')(app, db, getSubdomain, io);
require('./src/routes/payments')(app, db, getSubdomain, io);
require('./src/routes/print')(app, db, getSubdomain);
require('./src/routes/waiters')(app, db, getSubdomain);

// ── Admin routes ─────────────────────────────────────────────────
app.post('/api/admin/client', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { subdomain, name, username, password } = req.body;
  if (!subdomain || !name || !username || !password) {
    return res.status(400).json({ error: 'subdomain, name, username, password required' });
  }
  try {
    const hashedPw = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO clients (subdomain, name) VALUES (?, ?)').run(subdomain.toLowerCase(), name);
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
  const clients = db.prepare('SELECT subdomain, name, created_at FROM clients').all();
  res.json(clients);
});

// ── SPA fallback ────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ───────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ POS server running on port ${PORT}`);
});
