# InTouch POS

Web-based POS system (Node.js + Express + SQLite + Socket.io) with waiter PIN flow, tables/floor plan, menu/orders, payments, kitchen display, and thermal print endpoints.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill values
3. `node data/seed.js` to seed demo data
4. `npm start`
5. Open `http://localhost:3000`
6. Login with admin credentials (`admin` / `admin123`), then PIN `1234`

## Pages

- `/index.html` — login + waiter PIN
- `/pos.html?client=demo` — main POS
- `/kitchen.html?client=demo` — kitchen display
- `/admin.html?client=demo` — admin panel

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/login` | Login with username/password |
| GET | `/api/sales/today` | Dashboard sales summary |
| POST | `/api/sales` | VBA sales push endpoint |
| GET | `/api/menu/categories` | List menu categories |
| POST | `/api/menu/categories` | Create category |
| PUT | `/api/menu/categories/:id` | Update category |
| GET | `/api/menu/products` | List active products (`?all=1` for all) |
| POST | `/api/menu/products` | Create product |
| PUT | `/api/menu/products/:id` | Update product |
| DELETE | `/api/menu/products/:id` | Deactivate product |
| GET | `/api/tables` | List floor tables |
| POST | `/api/tables` | Create table |
| PUT | `/api/tables/:id` | Update table |
| PUT | `/api/tables/:id/position` | Update table position |
| DELETE | `/api/tables/:id` | Delete table |
| GET | `/api/orders` | List open orders |
| GET | `/api/orders/:id` | Get order with items |
| POST | `/api/orders` | Create/open order for table |
| POST | `/api/orders/:id/items` | Add item to order |
| DELETE | `/api/orders/:id/items/:itemId` | Remove order item |
| PUT | `/api/orders/:id/send` | Mark items as sent |
| PUT | `/api/orders/:id/close` | Close order |
| GET | `/api/kitchen/orders` | Kitchen pending orders |
| PUT | `/api/kitchen/orders/:id/done` | Mark kitchen items done |
| POST | `/api/payments` | Process cash payment |
| GET | `/api/payments/today` | List today payments |
| POST | `/api/print/receipt` | Print/simulate receipt |
| POST | `/api/print/kitchen` | Print/simulate kitchen ticket |
| GET | `/api/waiters` | List active waiters |
| POST | `/api/waiters/pin` | Verify waiter PIN |
| POST | `/api/waiters` | Create waiter |
| PUT | `/api/waiters/:id` | Update waiter |

## Notes

- Multi-tenant subdomain mode is supported via `?client=` or `x-subdomain` header.
- Socket.io events are emitted per subdomain namespace (`/${subdomain}`).
- Printer errors are caught and fallback to simulation mode.
