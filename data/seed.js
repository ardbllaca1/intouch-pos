const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new Database(path.join(DB_DIR, 'pos.db'));

const PRODUCTS = [
  [1,'Makiato e madhe',1],[2,'Makiato e vogel',1],[3,'Capochino',1],[4,'Expresso',1],[5,'Dopio expresso',1.7],[6,'Caffe amerikane',1],[7,'Nes caffe classic',1.2],[8,'Nes Vanilla',1.5],[9,'Bambi',1.2],[10,'Qaj filter',0.8],
  [11,'Leng pjeshke',1],[12,'Leng vishnje',1],[13,'Leng dredhze',1],[14,'Leng portokalli',1],[15,'Leng molle',1],[16,'Fresh portokall',2],[17,'Fresh molle',2],[18,'Fresh limonade',2],[19,'Limonade shpie',1],[20,'Boronice shpie',1],[21,'Homemade icetea',1.5],[22,'Ice coffe caramel',1.5],[23,'Coffe latte',2],[24,'Strawberry icetea',2],[25,'Watermelon icetea',2],[26,'Peach icetea',2],[27,'Passion fruit icetea',2],
  [28,'Mix coctail',3.5],[29,'Mojito pa alkool',3.5],[30,'Coca cola',1.2],[31,'Fanta',1.2],[32,'Schweppes',1.2],[33,'Sprite',1.2],[34,'Ice Tea',1.2],[35,'Red Bull',2.5],[36,'Uji i thjeshte',0.7],[37,'Uji mineral',0.7],[38,'Birra Peja',1.5],[39,'Peja Crudo',2],[40,'Lasko',2],[41,'Heineken',2.5],
  [42,'Omlet natyral',3],[43,'Omlet me pershut',3.5],[44,'Omlet me suxhuk',3.5],[45,'Omlet me perime',3.3],[46,'Llokuma',3],[47,'Brusketa',3],[48,'Mengjes te shoku',4],[49,'Sandwich pershute',3],[50,'Sandwich pule',3],[51,'Sandwich crunch',3.5],[52,'Sandwich ne pete',3.5],[53,'Sandwich tuna',3],[54,'Sandwich steak',3.8],[55,'Hamburger te SHOKU',3.5],[56,'Hamburger klasik',3],[57,'Chicken burger',3],[58,'Crunch burger',3.3],[59,'Hamburger me veze',3],
  [60,'Makarona Boloneze',4],[61,'Makarona carbonara',4],[62,'Makarona arabiata',4],[63,'Rizoto pule',4],[64,'Rizoto pule me curry',4],[65,'Rizoto vegjetariane',4],[66,'Rizoto me perime',4],[67,'Pizza e shpise V',3.5],[68,'Pizza pershute V',3],[69,'Pizza tuna V',3],[70,'Pizza vegjetariane V',3],[71,'Pizza margarita V',2.7],[72,'Pizza calzone V',3],[73,'Pizza fungi V',3],[74,'Pizza capricoza V',3],[75,'Pizza e shpise M',5],[76,'Pizza pershute M',4.5],[77,'Pizza tuna M',4.5],[78,'Pizza vegjetariane M',4.5],[79,'Pizza margarita M',4],[80,'Pizza calzone M',4],[81,'Pizza fungi M',4.3],[82,'Pizza capricoza M',4.5],
  [83,'File Pule',4.5],[84,'Shnicell pule',4.8],[85,'Pleskavice',4.5],[86,'Pleskavice e mbushur',5],[87,'Suxhuk',4.5],[88,'Kombinim mishi',5],[89,'Qebapa',4.5],[90,'Chicken fingers',4.5],[91,'Kepurdha',3.5],[92,'Sallate pule',4],[93,'Sallate shope',3],[94,'Sallate greke',3],[95,'Sallate tuna',4],[96,'Embelsira',2],[97,'Gullash',3.5],[98,'Pasul',3.5],[99,'Gjyveq',3.5],[100,'Musak',3.5],[101,'Lazanje',3.5],[102,'Makarona',3.5],[103,'Speca te mbushur',3.5],[104,'Sarma',3.5],[105,'Laker',3.5],[106,'Racion Viv',3],[107,'Racion i plote',4],[108,'Racion extra',4]
];

const CATEGORIES = [
  [1,10,'Kafe','☕','#8b5cf6'],
  [11,27,'Pije joalkoolike','🥤','#06b6d4'],
  [28,29,'Kokteje','🍸','#ec4899'],
  [30,37,'Pije te gazuara','🫧','#22c55e'],
  [38,41,'Birra','🍺','#f59e0b'],
  [42,48,'Mengjes','🍳','#f97316'],
  [49,54,'Sandwiche','🥪','#eab308'],
  [55,59,'Burgera','🍔','#ef4444'],
  [60,66,'Makarona & Rizoto','🍝','#a855f7'],
  [67,82,'Pizza','🍕','#fb7185'],
  [83,91,'Mish','🥩','#dc2626'],
  [92,95,'Sallata','🥗','#10b981'],
  [96,108,'Pjata dite','🍲','#14b8a6']
];

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, subdomain TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, subdomain TEXT NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, UNIQUE(subdomain, username));
  CREATE TABLE IF NOT EXISTS menu_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, subdomain TEXT NOT NULL, name TEXT NOT NULL, icon TEXT DEFAULT '🍽️', color TEXT DEFAULT '#6366f1', sort_order INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS menu_products (id INTEGER PRIMARY KEY AUTOINCREMENT, subdomain TEXT NOT NULL, code INTEGER, name TEXT NOT NULL, price REAL NOT NULL, category_id INTEGER, department TEXT NOT NULL DEFAULT 'Banaku', active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS floor_tables (id INTEGER PRIMARY KEY AUTOINCREMENT, subdomain TEXT NOT NULL, name TEXT NOT NULL, pos_x INTEGER DEFAULT 0, pos_y INTEGER DEFAULT 0, width INTEGER DEFAULT 80, height INTEGER DEFAULT 80, shape TEXT DEFAULT 'square', status TEXT DEFAULT 'free', waiter_id INTEGER, opened_at TEXT, UNIQUE(subdomain, name));
  CREATE TABLE IF NOT EXISTS waiters (id INTEGER PRIMARY KEY AUTOINCREMENT, subdomain TEXT NOT NULL, name TEXT NOT NULL, pin TEXT NOT NULL, role TEXT DEFAULT 'waiter', active INTEGER DEFAULT 1, UNIQUE(subdomain, name));
`);

const subdomain = 'demo';

db.prepare(`INSERT INTO clients (subdomain, name) VALUES (?, ?) ON CONFLICT(subdomain) DO UPDATE SET name = excluded.name`).run(subdomain, 'Demo Restaurant');

const initialPassword = process.env.DEMO_ADMIN_PASSWORD || 'admin123';
const adminPassword = bcrypt.hashSync(initialPassword, 10);
db.prepare(`INSERT INTO users (subdomain, username, password) VALUES (?, ?, ?) ON CONFLICT(subdomain, username) DO UPDATE SET password = excluded.password`).run(subdomain, 'admin', adminPassword);

db.prepare('DELETE FROM menu_products WHERE subdomain = ?').run(subdomain);
db.prepare('DELETE FROM menu_categories WHERE subdomain = ?').run(subdomain);

const catInsert = db.prepare('INSERT INTO menu_categories (subdomain, name, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)');
const categoryMap = new Map();
for (let i = 0; i < CATEGORIES.length; i += 1) {
  const category = CATEGORIES[i];
  const info = catInsert.run(subdomain, category[2], category[3], category[4], i + 1);
  for (let code = category[0]; code <= category[1]; code += 1) categoryMap.set(code, info.lastInsertRowid);
}

const productInsert = db.prepare(`
  INSERT INTO menu_products (subdomain, code, name, price, category_id, department, active, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?)
`);

for (const [code, name, price] of PRODUCTS) {
  const department = code <= 41 ? 'Banaku' : 'Kuzhina';
  const categoryId = categoryMap.get(code) || null;
  productInsert.run(subdomain, code, name, price, categoryId, department, code);
}

db.prepare('DELETE FROM waiters WHERE subdomain = ?').run(subdomain);
db.prepare('INSERT INTO waiters (subdomain, name, pin, role, active) VALUES (?, ?, ?, ?, 1)').run(subdomain, 'Admin', bcrypt.hashSync('1234', 10), 'admin');

db.prepare('DELETE FROM floor_tables WHERE subdomain = ?').run(subdomain);
const tableInsert = db.prepare('INSERT INTO floor_tables (subdomain, name, pos_x, pos_y, width, height, shape, status) VALUES (?, ?, ?, ?, 90, 90, ?, ?)');
for (let i = 1; i <= 10; i += 1) {
  const col = (i - 1) % 5;
  const row = Math.floor((i - 1) / 5);
  tableInsert.run(subdomain, `T${i}`, 40 + col * 110, 40 + row * 120, i % 2 ? 'square' : 'round', 'free');
}

console.log('✅ Demo data seeded for subdomain: demo');
