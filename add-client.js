#!/usr/bin/env node
/**
 * InTouch — Add Client Script
 * Usage: node add-client.js
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const readline = require('readline');

const db = new Database(path.join(__dirname, 'data', 'pos.db'));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function askHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let password = '';
    stdin.on('data', function handler(ch) {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(password);
      } else if (ch === '\u0003') {
        process.exit();
      } else if (ch === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += ch;
        process.stdout.write('*');
      }
    });
  });
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function listClients() {
  const clients = db.prepare('SELECT subdomain, name, created_at FROM clients ORDER BY created_at DESC').all();
  if (!clients.length) {
    console.log('\n  (No clients yet)\n');
    return;
  }
  console.log('\n┌─────────────────────────────────────────────────────┐');
  console.log('│  Existing Clients                                   │');
  console.log('├──────────────────┬──────────────────┬───────────────┤');
  console.log('│ Subdomain        │ Name             │ Created       │');
  console.log('├──────────────────┼──────────────────┼───────────────┤');
  for (const c of clients) {
    const sub  = c.subdomain.padEnd(16).slice(0, 16);
    const name = c.name.padEnd(16).slice(0, 16);
    const date = (c.created_at || '').slice(0, 10).padEnd(13);
    console.log(`│ ${sub} │ ${name} │ ${date} │`);
  }
  console.log('└──────────────────┴──────────────────┴───────────────┘\n');
}

async function addClient() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ⚡ InTouch — Add New Client');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  listClients();

  // Restaurant name
  let name = '';
  while (!name.trim()) {
    name = await ask('  Restaurant name (e.g. Shoku Bar): ');
    if (!name.trim()) console.log('  ⚠️  Name cannot be empty.');
  }

  // Subdomain — auto-suggest from name
  const suggested = slugify(name);
  const subInput = await ask(`  Subdomain [${suggested}]: `);
  const subdomain = slugify(subInput.trim() || suggested);

  if (!subdomain) {
    console.log('  ❌ Invalid subdomain. Exiting.');
    rl.close(); process.exit(1);
  }

  // Check if already exists
  const existing = db.prepare('SELECT id FROM clients WHERE subdomain = ?').get(subdomain);
  if (existing) {
    console.log(`\n  ❌ Client "${subdomain}" already exists!\n`);
    rl.close(); process.exit(1);
  }

  // Dashboard username
  let username = '';
  while (!username.trim()) {
    username = await ask('  Dashboard username [admin]: ');
    username = username.trim() || 'admin';
  }

  // Password
  let password = '';
  while (password.length < 4) {
    try {
      password = await askHidden('  Dashboard password (min 4 chars): ');
    } catch {
      password = await ask('  Dashboard password (min 4 chars): ');
    }
    if (password.length < 4) console.log('  ⚠️  Password too short.');
  }

  // Confirm
  console.log('\n  ┌─────────────────────────────────┐');
  console.log('  │  Summary                        │');
  console.log('  ├─────────────────────────────────┤');
  console.log(`  │  Name      : ${name.slice(0,21).padEnd(21)}│`);
  console.log(`  │  Subdomain : ${subdomain.slice(0,21).padEnd(21)}│`);
  console.log(`  │  Username  : ${username.slice(0,21).padEnd(21)}│`);
  console.log(`  │  URL       : https://${subdomain}.intouch-data.com`.slice(0,47).padEnd(47) + '│');
  console.log('  └─────────────────────────────────┘');

  const confirm = await ask('\n  Create this client? (y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('\n  Cancelled.\n');
    rl.close(); process.exit(0);
  }

  // Insert into DB
  try {
    const hashedPw = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO clients (subdomain, name) VALUES (?, ?)').run(subdomain, name);
    db.prepare('INSERT INTO users (subdomain, username, password) VALUES (?, ?, ?)').run(subdomain, username, hashedPw);

    console.log('\n  ✅ Client created successfully!\n');
    console.log('  ─────────────────────────────────────────────────');
    console.log(`  Dashboard URL : https://${subdomain}.intouch-data.com`);
    console.log(`  Username      : ${username}`);
    console.log('  ─────────────────────────────────────────────────');
    console.log('\n  Next steps:');
    console.log(`  1. If no wildcard DNS: run →  cloudflared tunnel route dns intouch-dashboard ${subdomain}.intouch-data.com`);
    console.log(`  2. In Access VBA, set  →  API_URL = "https://${subdomain}.intouch-data.com/api/sales"`);
    console.log('  3. Run StartLiveSender to test the connection');
    console.log('  ─────────────────────────────────────────────────\n');
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      console.log(`\n  ❌ Client "${subdomain}" already exists!\n`);
    } else {
      console.log('\n  ❌ Error:', err.message, '\n');
    }
    process.exit(1);
  }

  rl.close();
}

addClient();
