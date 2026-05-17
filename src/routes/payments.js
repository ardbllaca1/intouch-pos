function emitSubdomain(io, subdomain, event, payload) {
  io.of(`/${subdomain}`).emit(event, payload);
}

module.exports = (app, db, getSubdomain, io) => {
  const authMiddleware = app.locals.authMiddleware;

  app.post('/api/payments', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { order_id, cash_given } = req.body;
    if (!order_id || cash_given == null) return res.status(400).json({ error: 'order_id and cash_given required' });

    const order = db.prepare(`
      SELECT o.*, t.id AS table_pk, t.name AS table_name
      FROM live_orders o
      JOIN floor_tables t ON t.id = o.table_id
      WHERE o.id = ? AND o.subdomain = ?
    `).get(order_id, subdomain);
    if (!order) return res.status(404).json({ error: 'order not found' });

    const totalRow = db.prepare('SELECT COALESCE(SUM(price * qty), 0) AS total FROM live_order_items WHERE order_id = ?').get(order_id);
    const total = Number(totalRow.total || 0);
    const cash = Number(cash_given);
    if (cash < total) return res.status(400).json({ error: 'cash is less than total', total });
    const change_due = Number((cash - total).toFixed(2));

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO live_payments (subdomain, order_id, total, cash_given, change_due, waiter_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(subdomain, order_id, total, cash, change_due, order.waiter_name);

      db.prepare(`
        UPDATE live_orders
        SET status = 'closed', closed_at = datetime('now')
        WHERE id = ? AND subdomain = ?
      `).run(order_id, subdomain);

      db.prepare(`
        UPDATE floor_tables
        SET status = 'free', waiter_id = NULL, opened_at = NULL
        WHERE id = ? AND subdomain = ?
      `).run(order.table_id, subdomain);

      const date = new Date().toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO sales_summary (subdomain, date, total_sales, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(subdomain, date)
        DO UPDATE SET total_sales = total_sales + excluded.total_sales, updated_at = excluded.updated_at
      `).run(subdomain, date, total);

      db.prepare(`
        INSERT INTO waiter_summary (subdomain, date, name, total)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(subdomain, date, name)
        DO UPDATE SET total = total + excluded.total
      `).run(subdomain, date, order.waiter_name, total);

      const deptStmt = db.prepare(`
        SELECT p.department AS name, SUM(i.price * i.qty) AS total
        FROM live_order_items i
        JOIN menu_products p ON p.id = i.product_id
        WHERE i.order_id = ?
        GROUP BY p.department
      `);
      const departments = deptStmt.all(order_id);
      const upsertDept = db.prepare(`
        INSERT INTO department_summary (subdomain, date, name, total)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(subdomain, date, name)
        DO UPDATE SET total = total + excluded.total
      `);
      for (const d of departments) upsertDept.run(subdomain, date, d.name, d.total);
    });

    tx();

    const table = db.prepare('SELECT * FROM floor_tables WHERE id = ?').get(order.table_id);
    emitSubdomain(io, subdomain, 'table:update', table);
    emitSubdomain(io, subdomain, 'order:update', { id: order_id, status: 'closed' });

    res.json({ total, cash_given: cash, change_due });
  });

  app.get('/api/payments/today', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const rows = db.prepare(`
      SELECT id, order_id, total, cash_given, change_due, waiter_name, closed_at
      FROM live_payments
      WHERE subdomain = ? AND date(closed_at) = date('now')
      ORDER BY closed_at DESC
    `).all(subdomain);
    res.json(rows);
  });
};
