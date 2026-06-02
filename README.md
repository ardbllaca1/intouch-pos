# InTouch Dashboard

Live sales dashboard for Access 2003 POS systems, powered by Node.js + SQLite.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Create your first client
```bash
node -e "
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const db = new Database('data/pos.db');
const pw = bcrypt.hashSync('yourpassword', 10);
db.prepare('INSERT INTO clients (subdomain,name) VALUES (?,?)').run('demo','Restaurant Demo');
db.prepare('INSERT INTO users (subdomain,username,password) VALUES (?,?,?)').run('demo','admin',pw);
console.log('Done!');
"
```

### 4. Start the server
```bash
npm start
```

### 5. Open dashboard
- Local: `http://localhost:3000`
- With Cloudflare Tunnel: `https://demo.intouch-data.com`

---

## Cloudflare Tunnel Setup (Linux)

```bash
# Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Login & create tunnel
cloudflared tunnel login
cloudflared tunnel create intouch-dashboard

# Route wildcard DNS (covers all clients automatically)
cloudflared tunnel route dns intouch-dashboard "*.intouch-data.com"

# Install as systemd service (auto-start on boot)
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

Config at `/etc/cloudflared/config.yml`:
```yaml
tunnel: intouch-dashboard
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: "*.intouch-data.com"
    service: http://localhost:3000
  - service: http_status:404
```

---

## PM2 (auto-restart on Linux)
```bash
npm install -g pm2
pm2 start server.js --name intouch-dashboard
pm2 startup
pm2 save
```

---

## VBA Push API

From Access/VBA, push data every 30 seconds:

```
POST /api/sales
Headers:
  x-api-key: <your API_KEY>
  x-subdomain: demo
Content-Type: application/json
```

Payload:
```json
{
  "totalSales": 1234.50,
  "byWaiter": [{"name":"Ana","total":600}],
  "byDepartment": [{"name":"Banaku","total":800}],
  "hourly": [{"hour":"10:00","count":5}],
  "tables": [{"name":"T1","active":true}],
  "allOrders": [{"produkti":"Kafe","sasia":2,"vlera":2.0,"tav":"T1","time":"10:30","kam":"Banaku"}],
  "products": [{"produkti":"Kafe","sasia":10,"qmimi":1.0,"vlera":10.0}]
}
```

---

## Admin API

Create a new restaurant client:
```
POST /api/admin/client
Headers: x-admin-key: <ADMIN_KEY>
Body: { "subdomain":"shoku", "name":"Shoku Restaurant", "username":"admin", "password":"secret" }
```

List all clients:
```
GET /api/admin/clients
Headers: x-admin-key: <ADMIN_KEY>
```

---

## Dashboard Features
- 💰 Total sales today
- 🧾 Total orders count
- 🧑‍🍳 Active waiters with bar chart
- 🪑 Table status (free / occupied)
- 📊 Hourly sales chart
- 🏆 Top products by quantity
- 🔄 Auto-refresh every 30 seconds
- 📱 Fully responsive (phone, tablet, desktop)
