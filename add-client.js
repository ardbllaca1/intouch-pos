#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'pos.db');
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'intouch-data.com';

function usage() {
  console.log(`
Usage:
  node add-client.js
  node add-client.js --subdomain cimazone --name "Cima Zone" --username admin --password secret123
  node add-client.js --delete --subdomain cimazone --yes
  node add-client.js --list-users --subdomain cimazone
  node add-client.js --add-user --subdomain cimazone --username manager --password secret123
  node add-client.js --delete-user --subdomain cimazone --username manager --yes

Options:
  --subdomain   Client subdomain, e.g. cimazone
  --name        Restaurant/client display name
  --username    Dashboard username. Default: admin
  --password    Dashboard password. Minimum 4 characters
  --force       Update existing client/user instead of failing
  --delete      Delete a client and all dashboard data for that subdomain
  --list-users  List dashboard users for a subdomain
  --add-user    Add or update a dashboard user for a subdomain
  --delete-user Delete a dashboard user from a subdomain
  --yes         Skip delete confirmation
  --list        List existing clients
  --help        Show this help
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'force' || key === 'delete' || key === 'list-users' || key === 'add-user' || key === 'delete-user' || key === 'yes' || key === 'list' || key === 'help') {
      args[key] = true;
    } else {
      args[key] = argv[i + 1] || '';
      i += 1;
    }
  }
  return args;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function createQuestioner() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask(question) {
      return new Promise(resolve => rl.question(question, answer => resolve(answer)));
    },
    close() {
      rl.close();
    }
  };
}

function openDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subdomain TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subdomain TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      UNIQUE(subdomain, username)
    );
  `);
  return db;
}

function listClients(db) {
  const rows = db.prepare('SELECT subdomain, name, created_at FROM clients ORDER BY subdomain ASC').all();
  if (!rows.length) {
    console.log('No clients found.');
    return;
  }
  console.log('Existing clients:');
  for (const row of rows) {
    console.log(`- ${row.subdomain} | ${row.name} | ${row.created_at || ''}`);
  }
}

async function collectInput(args) {
  const q = createQuestioner();
  try {
    const result = { ...args };

    if (!result.name) {
      result.name = await q.ask('Restaurant/client name: ');
    }

    if (!result.subdomain) {
      const suggested = slugify(result.name);
      const answer = await q.ask(`Subdomain [${suggested}]: `);
      result.subdomain = answer || suggested;
    }

    if (!result.username) {
      const answer = await q.ask('Dashboard username [admin]: ');
      result.username = answer || 'admin';
    }

    if (!result.password) {
      result.password = await q.ask('Dashboard password (min 4 chars): ');
    }

    result.subdomain = slugify(result.subdomain);
    result.username = String(result.username || '').trim();
    result.name = String(result.name || '').trim();
    result.password = String(result.password || '');

    return result;
  } finally {
    q.close();
  }
}

function validate(input) {
  if (!input.name) throw new Error('Name is required.');
  if (!input.subdomain) throw new Error('Subdomain is required.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.subdomain)) {
    throw new Error('Subdomain can contain only lowercase letters, numbers, and hyphens.');
  }
  if (!input.username) throw new Error('Username is required.');
  if (input.password.length < 4) throw new Error('Password must be at least 4 characters.');
}

function saveClient(db, input) {
  const hashed = bcrypt.hashSync(input.password, 10);
  const exists = db.prepare('SELECT id FROM clients WHERE subdomain = ?').get(input.subdomain);

  if (exists && !input.force) {
    throw new Error(`Client "${input.subdomain}" already exists. Use --force to update it.`);
  }

  const tx = db.transaction(() => {
    if (exists) {
      db.prepare('UPDATE clients SET name = ? WHERE subdomain = ?').run(input.name, input.subdomain);
      db.prepare(`
        INSERT INTO users (subdomain, username, password)
        VALUES (?, ?, ?)
        ON CONFLICT(subdomain, username)
        DO UPDATE SET password = excluded.password
      `).run(input.subdomain, input.username, hashed);
    } else {
      db.prepare('INSERT INTO clients (subdomain, name) VALUES (?, ?)').run(input.subdomain, input.name);
      db.prepare('INSERT INTO users (subdomain, username, password) VALUES (?, ?, ?)').run(input.subdomain, input.username, hashed);
    }
  });

  tx();
}

function requireClient(db, subdomain) {
  const client = db.prepare('SELECT subdomain, name FROM clients WHERE subdomain = ?').get(subdomain);
  if (!client) throw new Error(`Client "${subdomain}" does not exist.`);
  return client;
}

function listUsers(db, args) {
  const subdomain = slugify(args.subdomain);
  if (!subdomain) throw new Error('Subdomain is required.');
  const client = requireClient(db, subdomain);
  const users = db.prepare('SELECT id, username FROM users WHERE subdomain = ? ORDER BY username ASC').all(subdomain);

  console.log(`Users for ${client.subdomain} (${client.name}):`);
  if (!users.length) {
    console.log('- No users found.');
    return;
  }
  for (const user of users) console.log(`- ${user.username}`);
}

async function addUser(db, args) {
  const q = createQuestioner();
  try {
    const subdomain = slugify(args.subdomain || await q.ask('Client subdomain: '));
    requireClient(db, subdomain);

    const username = String(args.username || await q.ask('Dashboard username: ')).trim();
    const password = String(args.password || await q.ask('Dashboard password (min 4 chars): '));

    if (!username) throw new Error('Username is required.');
    if (password.length < 4) throw new Error('Password must be at least 4 characters.');

    const hashed = bcrypt.hashSync(password, 10);
    db.prepare(`
      INSERT INTO users (subdomain, username, password)
      VALUES (?, ?, ?)
      ON CONFLICT(subdomain, username)
      DO UPDATE SET password = excluded.password
    `).run(subdomain, username, hashed);

    console.log(`User saved: ${username} for ${subdomain}`);
  } finally {
    q.close();
  }
}

async function deleteUser(db, args) {
  const q = createQuestioner();
  try {
    const subdomain = slugify(args.subdomain || await q.ask('Client subdomain: '));
    requireClient(db, subdomain);

    const username = String(args.username || await q.ask('Dashboard username to delete: ')).trim();
    if (!username) throw new Error('Username is required.');

    const user = db.prepare('SELECT id FROM users WHERE subdomain = ? AND username = ?').get(subdomain, username);
    if (!user) throw new Error(`User "${username}" does not exist for "${subdomain}".`);

    if (!args.yes) {
      const answer = await q.ask(`Type ${username} to delete this user: `);
      if (answer !== username) {
        console.log('Delete cancelled.');
        return;
      }
    }

    const info = db.prepare('DELETE FROM users WHERE subdomain = ? AND username = ?').run(subdomain, username);
    console.log(`Deleted user: ${username} for ${subdomain} (${info.changes})`);
  } finally {
    q.close();
  }
}

async function deleteClient(db, args) {
  const q = createQuestioner();
  try {
    const subdomain = slugify(args.subdomain || await q.ask('Subdomain to delete: '));
    if (!subdomain) throw new Error('Subdomain is required.');

    const client = db.prepare('SELECT subdomain, name FROM clients WHERE subdomain = ?').get(subdomain);
    if (!client) throw new Error(`Client "${subdomain}" does not exist.`);

    if (!args.yes) {
      console.log('');
      console.log(`This will permanently delete "${client.subdomain}" (${client.name}) and all dashboard data for that client.`);
      const answer = await q.ask(`Type ${client.subdomain} to confirm: `);
      if (answer !== client.subdomain) {
        console.log('Delete cancelled.');
        return;
      }
    }

    const tables = [
      'users',
      'sales_summary',
      'waiter_summary',
      'department_summary',
      'hourly_summary',
      'tables_status',
      'orders',
      'products_summary',
      'clients'
    ];

    const deleted = {};
    const tx = db.transaction(() => {
      for (const table of tables) {
        const info = db.prepare(`DELETE FROM ${table} WHERE subdomain = ?`).run(subdomain);
        deleted[table] = info.changes;
      }
    });

    tx();

    console.log('');
    console.log(`Deleted client: ${subdomain}`);
    for (const table of tables) console.log(`- ${table}: ${deleted[table]}`);
  } finally {
    q.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const db = openDb();

  if (args.list) {
    listClients(db);
    return;
  }

  if (args.delete) {
    await deleteClient(db, args);
    return;
  }

  if (args['list-users']) {
    listUsers(db, args);
    return;
  }

  if (args['add-user']) {
    await addUser(db, args);
    return;
  }

  if (args['delete-user']) {
    await deleteUser(db, args);
    return;
  }

  const input = await collectInput(args);
  validate(input);
  saveClient(db, input);

  console.log('');
  console.log(args.force ? 'Client saved.' : 'Client created.');
  console.log(`Dashboard URL : https://${input.subdomain}.${ROOT_DOMAIN}`);
  console.log(`Username      : ${input.username}`);
  console.log('');
  console.log('Access/VBA settings:');
  console.log(`Private Const CLIENT_URL As String = "https://${input.subdomain}.${ROOT_DOMAIN}/api/sales"`);
  console.log(`Private Const API_KEY    As String = "${process.env.API_KEY || '<your-api-key>'}"`);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
