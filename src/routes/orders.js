function emitSubdomain(io, subdomain, event, payload) {
  io.of(`/${subdomain}`).emit(event, payload);
}

module.exports = (app, db, getSubdomain, io) => {
  const authMiddleware = app.locals.authMiddleware;

  app.get('/api/orders', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const rows = db.prepare(`
      SELECT o.id, o.table_id, o.waiter_name, o.status, o.created_at, o.closed_at, t.name AS table_name
      FROM live_orders o
      JOIN floor_tables t ON t.id = o.table_id
      WHERE o.subdomain = ? AND o.status = 'open' AND date(o.created_at) = date('now')
      ORDER BY o.created_at DESC
    `).all(subdomain);
    res.json(rows);
  });

  app.get('/api/orders/:id', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const order = db.prepare(`
      SELECT o.id, o.table_id, o.waiter_name, o.status, o.created_at, o.closed_at, t.name AS table_name
      FROM live_orders o
      JOIN floor_tables t ON t.id = o.table_id
      WHERE o.id = ? AND o.subdomain = ?
    `).get(req.params.id, subdomain);
    if (!order) return res.status(404).json({ error: 'not found' });
    const items = db.prepare('SELECT * FROM live_order_items WHERE order_id = ? ORDER BY id ASC').all(order.id);
    res.json({ ...order, items });
  });

  app.get('/api/kitchen/orders', (req, res) => {
    const subdomain = getSubdomain(req);
    const rows = db.prepare(`
      SELECT o.id, o.table_id, o.waiter_name, o.created_at, t.name AS table_name
      FROM live_orders o
      JOIN floor_tables t ON t.id = o.table_id
      WHERE o.subdomain = ? AND o.status = 'open'
      ORDER BY o.created_at ASC
    `).all(subdomain);
    const itemStmt = db.prepare(`
      SELECT i.id, i.product_name, i.qty, i.note
      FROM live_order_items i
      JOIN menu_products p ON p.id = i.product_id
      WHERE i.order_id = ? AND p.department = 'Kuzhina' AND i.sent_kitchen = 1
      ORDER BY i.id ASC
    `);
    const data = rows.map((order) => ({ ...order, items: itemStmt.all(order.id) })).filter((o) => o.items.length > 0);
    res.json(data);
  });

  app.put('/api/kitchen/orders/:id/done', (req, res) => {
    const subdomain = getSubdomain(req);
    const order = db.prepare('SELECT * FROM live_orders WHERE id = ? AND subdomain = ?').get(req.params.id, subdomain);
    if (!order) return res.status(404).json({ error: 'not found' });
    db.prepare(`
      UPDATE live_order_items
      SET sent_kitchen = 2
      WHERE order_id = ? AND sent_kitchen = 1 AND product_id IN (
        SELECT id FROM menu_products WHERE department = 'Kuzhina' AND subdomain = ?
      )
    `).run(order.id, subdomain);
    emitSubdomain(io, subdomain, 'order:update', { id: order.id, kitchenDone: true });
    res.json({ status: 'ok' });
  });

  app.post('/api/orders', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { table_id, waiter_name } = req.body;
    if (!table_id || !waiter_name) return res.status(400).json({ error: 'table_id and waiter_name required' });

    const existing = db.prepare(`
      SELECT * FROM live_orders
      WHERE subdomain = ? AND table_id = ? AND status = 'open'
      ORDER BY id DESC LIMIT 1
    `).get(subdomain, table_id);

    if (existing) return res.json(existing);

    const info = db.prepare(`
      INSERT INTO live_orders (subdomain, table_id, waiter_name, status)
      VALUES (?, ?, ?, 'open')
    `).run(subdomain, table_id, waiter_name);

    db.prepare(`
      UPDATE floor_tables
      SET status = 'occupied', opened_at = datetime('now')
      WHERE id = ? AND subdomain = ?
    `).run(table_id, subdomain);

    const order = db.prepare('SELECT * FROM live_orders WHERE id = ?').get(info.lastInsertRowid);
    const table = db.prepare('SELECT * FROM floor_tables WHERE id = ?').get(table_id);
    emitSubdomain(io, subdomain, 'order:update', order);
    emitSubdomain(io, subdomain, 'table:update', table);
    res.json(order);
  });

  app.post('/api/orders/:id/items', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { product_id, qty, note } = req.body;
    const order = db.prepare('SELECT * FROM live_orders WHERE id = ? AND subdomain = ? AND status = ?').get(req.params.id, subdomain, 'open');
    if (!order) return res.status(404).json({ error: 'order not found' });
    const product = db.prepare('SELECT * FROM menu_products WHERE id = ? AND subdomain = ? AND active = 1').get(product_id, subdomain);
    if (!product) return res.status(404).json({ error: 'product not found' });

    const info = db.prepare(`
      INSERT INTO live_order_items (order_id, product_id, product_name, price, qty, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(order.id, product.id, product.name, product.price, qty || 1, note || null);

    const item = db.prepare('SELECT * FROM live_order_items WHERE id = ?').get(info.lastInsertRowid);
    emitSubdomain(io, subdomain, 'order:update', { id: order.id, itemAdded: item });
    res.json(item);
  });

  app.delete('/api/orders/:id/items/:itemId', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const order = db.prepare('SELECT * FROM live_orders WHERE id = ? AND subdomain = ?').get(req.params.id, subdomain);
    if (!order) return res.status(404).json({ error: 'order not found' });
    const info = db.prepare('DELETE FROM live_order_items WHERE id = ? AND order_id = ?').run(req.params.itemId, order.id);
    if (!info.changes) return res.status(404).json({ error: 'item not found' });
    emitSubdomain(io, subdomain, 'order:update', { id: order.id, itemRemoved: Number(req.params.itemId) });
    res.json({ status: 'ok' });
  });

  app.put('/api/orders/:id/send', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const order = db.prepare('SELECT * FROM live_orders WHERE id = ? AND subdomain = ?').get(req.params.id, subdomain);
    if (!order) return res.status(404).json({ error: 'order not found' });

    const items = db.prepare(`
      SELECT i.*, p.department
      FROM live_order_items i
      JOIN menu_products p ON p.id = i.product_id
      WHERE i.order_id = ? AND p.subdomain = ?
    `).all(order.id, subdomain);

    const kitchenItems = [];
    for (const item of items) {
      if (item.department === 'Kuzhina' && item.sent_kitchen === 0) {
        db.prepare('UPDATE live_order_items SET sent_kitchen = 1 WHERE id = ?').run(item.id);
        kitchenItems.push(item);
      }
      if (item.department === 'Banaku' && item.sent_bar === 0) {
        db.prepare('UPDATE live_order_items SET sent_bar = 1 WHERE id = ?').run(item.id);
      }
    }

    emitSubdomain(io, subdomain, 'order:update', { id: order.id, sent: true });
    if (kitchenItems.length) emitSubdomain(io, subdomain, 'kitchen:new', kitchenItems);
    res.json({ status: 'ok', kitchenItems: kitchenItems.length });
  });

  app.put('/api/orders/:id/close', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const info = db.prepare(`
      UPDATE live_orders
      SET status = 'closed', closed_at = datetime('now')
      WHERE id = ? AND subdomain = ? AND status = 'open'
    `).run(req.params.id, subdomain);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    const order = db.prepare('SELECT * FROM live_orders WHERE id = ?').get(req.params.id);
    emitSubdomain(io, subdomain, 'order:update', order);
    res.json({ status: 'ok' });
  });
};
