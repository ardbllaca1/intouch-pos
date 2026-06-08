# InTouch Dashboard

Live sales dashboard for Access 2003 POS systems, powered by Node.js, Express, and SQLite.

The production setup currently uses:

- Node.js app managed by PM2
- Nginx reverse proxy
- Cloudflare Tunnel and Cloudflare SSL
- Wildcard client subdomains such as `demo.intouch-data.com`
- SQLite database at `data/pos.db`
- Access/VBA sender pushing live data to `/api/sales`
- Progressive Web App support for installable mobile usage

## Environment

Create `.env` from the example:

```bash
cp .env.example .env
```

Recommended production values:

```env
PORT=3001
HOST=0.0.0.0
ROOT_DOMAIN=intouch-data.com
JWT_SECRET=change-this-to-a-long-random-string
API_KEY=change-this-api-key
ADMIN_KEY=change-this-admin-key
```

`ROOT_DOMAIN` is important because the app uses the subdomain to identify the client. For example:

```text
cimazone.intouch-data.com -> cimazone
demo.intouch-data.com     -> demo
```

## Install

```bash
npm install
```

Start locally:

```bash
npm start
```

Production with PM2:

```bash
pm2 start server.js --name intouch
pm2 save
```

Restart after code or `.env` changes:

```bash
pm2 restart intouch --update-env
```

View logs:

```bash
pm2 logs intouch --lines 50
```

## Nginx

Nginx must preserve the original host so the Node app can detect the client subdomain.

Example:

```nginx
server {
    listen 80;
    server_name intouch-data.com *.intouch-data.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Cloudflare Tunnel

Wildcard subdomains should route to the app through the tunnel.

Example `/etc/cloudflared/config.yml`:

```yaml
tunnel: intouch-dashboard
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: "intouch-data.com"
    service: http://localhost:3001
  - hostname: "*.intouch-data.com"
    service: http://localhost:3001
  - service: http_status:404
```

## Client Management

Use `add-client.js` from the server:

```bash
cd ~/intouch-pos
```

List clients:

```bash
node add-client.js --list
```

Add a client interactively:

```bash
node add-client.js
```

Add a client non-interactively:

```bash
node add-client.js --subdomain cimazone --name "Cima Zone" --username admin --password secret123
```

Update/reset an existing client user password:

```bash
node add-client.js --subdomain cimazone --name "Cima Zone" --username admin --password newpass123 --force
```

Delete a client with confirmation:

```bash
node add-client.js --delete --subdomain cimazone
```

Delete a client without confirmation:

```bash
node add-client.js --delete --subdomain cimazone --yes
```

Deleting a client removes its rows from:

- `users`
- `sales_summary`
- `waiter_summary`
- `department_summary`
- `hourly_summary`
- `tables_status`
- `orders`
- `products_summary`
- `clients`

## Dashboard Users

List users for a client:

```bash
node add-client.js --list-users --subdomain cimazone
```

Add or update a user:

```bash
node add-client.js --add-user --subdomain cimazone --username manager --password secret123
```

Delete a user with confirmation:

```bash
node add-client.js --delete-user --subdomain cimazone --username manager
```

Delete a user without confirmation:

```bash
node add-client.js --delete-user --subdomain cimazone --username manager --yes
```

## Access/VBA Client Setup

Each client POS database needs the sender module configured with that client's URL and the shared API key:

```vb
Private Const CLIENT_URL As String = "https://cimazone.intouch-data.com/api/sales"
Private Const API_KEY    As String = "your-api-key"
```

The included paste-ready module is:

```text
InTouchData_Modified.bas
```

In Access:

1. Paste/import the module.
2. Set `CLIENT_URL` to the client's subdomain.
3. Set `API_KEY` to the server `.env` API key.
4. Make sure `frmTimer` exists and calls `SendSalesData` every 30 seconds.
5. Call `StartLiveSender` from AutoExec or the startup form.

### Active Table Logic

The Access table `[tbldetalet e faturimit]` uses:

- `Adresa`: table number/name always, whether open or closed
- `Blersi`: table number/name only while the table is open
- `Blersi = "x"`: closed/inactive/old order row

The VBA sender should send:

```json
{
  "tav": "11",
  "isActive": true
}
```

for current open rows, and:

```json
{
  "tav": "11",
  "isActive": false
}
```

for older/closed rows.

This allows the Tavolinat page to mark products from the current table session differently from older products on the same table.

## Push API

Access/VBA posts live data here:

```http
POST /api/sales
Content-Type: application/json
x-api-key: <API_KEY>
```

Example payload:

```json
{
  "date": "2026-06-03",
  "totalSales": 1234.5,
  "byWaiter": [
    { "name": "Ana", "total": 600 }
  ],
  "byDepartment": [
    { "name": "Banaku", "total": 800 },
    { "name": "Kuzhina", "total": 434.5 },
    { "name": "Pizza", "total": 250 },
    { "name": "Sallatat", "total": 120 },
    { "name": "Akulloret", "total": 90 }
  ],
  "hourly": [
    { "hour": "10-11", "count": 5 }
  ],
  "tables": [
    { "name": "1", "active": true },
    { "name": "2", "active": false }
  ],
  "allOrders": [
    {
      "produkti": "Kafe",
      "sasia": 2,
      "vlera": 2.0,
      "tav": "1",
      "time": "10:30",
      "kam": "Ana",
      "isActive": true
    }
  ],
  "products": [
    { "produkti": "Kafe", "sasia": 10, "qmimi": 1.0, "vlera": 10.0 }
  ]
}
```

## Dashboard Behavior

Use the client subdomain URL:

```text
https://cimazone.intouch-data.com
```

Do not use the root domain for a client dashboard:

```text
https://intouch-data.com
```

Client detection is host-first. That means this URL still resolves as `cimazone`, not `demo`:

```text
https://cimazone.intouch-data.com/dashboard.html?client=demo
```

Tokens are also client-scoped. A token created for `demo` cannot access `cimazone`.

## Progressive Web App

The dashboard includes PWA support:

- `public/manifest.webmanifest`
- `public/service-worker.js`
- `public/pwa.js`
- `public/offline.html`
- `public/icons/icon.svg`

After deployment, open the client URL on a phone:

```text
https://cimazone.intouch-data.com/index.html?v=1
```

Then use the browser's install option:

- Android: Add to Home Screen / Install app
- iPhone Safari: Share -> Add to Home Screen

The service worker caches static pages and assets. API requests are not cached, so live dashboard data still comes from the server.

When deploying frontend changes, use a cache-busting query if a phone keeps stale HTML:

```text
https://cimazone.intouch-data.com/dashboard.html?v=10
```

## Deploy From Windows To Ubuntu

From PowerShell:

```powershell
scp "C:\Users\Ard Bllaca\intouch-pos\server.js" oc@192.168.0.50:~/intouch-pos/server.js
scp "C:\Users\Ard Bllaca\intouch-pos\add-client.js" oc@192.168.0.50:~/intouch-pos/add-client.js
scp -r "C:\Users\Ard Bllaca\intouch-pos\public\*" oc@192.168.0.50:~/intouch-pos/public/
```

Then on Ubuntu:

```bash
cd ~/intouch-pos
pm2 restart intouch --update-env
```

Static-only changes under `public/` do not require PM2 restart, but restarting is safe.

## Verify Data

Check logs:

```bash
pm2 logs intouch --lines 50
```

You should see updates like:

```text
Updated: cimazone
```

Inspect SQLite without installing `sqlite3`:

```bash
node -e "const db=require('better-sqlite3')('data/pos.db'); console.log(db.prepare('select subdomain,date,total_sales,updated_at from sales_summary order by updated_at desc limit 20').all())"

node -e "const db=require('better-sqlite3')('data/pos.db'); console.log(db.prepare('select subdomain,date,count(*) as orders from orders group by subdomain,date order by date desc, subdomain').all())"

node -e "const db=require('better-sqlite3')('data/pos.db'); console.log(db.prepare('select subdomain,date,name,active from tables_status order by date desc, subdomain, name limit 50').all())"
```

## Features

- Live total sales
- Full daily order count
- Recent orders
- Waiter breakdown
- Department breakdown
- Hourly chart
- Product ranking
- Table status
- Table details by selected table
- Active-session products marked separately from previous products
- Numeric table sorting
- Client-scoped login tokens
- Installable PWA
