module.exports = (app, db, getSubdomain) => {
  const authMiddleware = app.locals.authMiddleware;

  app.get('/api/menu/categories', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const rows = db.prepare(`
      SELECT id, name, icon, color, sort_order
      FROM menu_categories
      WHERE subdomain = ?
      ORDER BY sort_order ASC, id ASC
    `).all(subdomain);
    res.json(rows);
  });

  app.post('/api/menu/categories', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { name, icon, color, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const info = db.prepare(`
      INSERT INTO menu_categories (subdomain, name, icon, color, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(subdomain, name, icon || '🍽️', color || '#6366f1', sort_order || 0);
    const row = db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(info.lastInsertRowid);
    res.json(row);
  });

  app.put('/api/menu/categories/:id', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { name, icon, color, sort_order } = req.body;
    const info = db.prepare(`
      UPDATE menu_categories
      SET name = COALESCE(?, name),
          icon = COALESCE(?, icon),
          color = COALESCE(?, color),
          sort_order = COALESCE(?, sort_order)
      WHERE id = ? AND subdomain = ?
    `).run(name, icon, color, sort_order, req.params.id, subdomain);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    res.json({ status: 'ok' });
  });

  app.get('/api/menu/products', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const activeOnly = req.query.all === '1' ? '' : 'AND p.active = 1';
    const rows = db.prepare(`
      SELECT p.id, p.code, p.name, p.price, p.category_id, p.department, p.active, p.sort_order,
             c.name as category_name, c.icon as category_icon, c.color as category_color
      FROM menu_products p
      LEFT JOIN menu_categories c ON c.id = p.category_id
      WHERE p.subdomain = ? ${activeOnly}
      ORDER BY p.sort_order ASC, p.code ASC, p.id ASC
    `).all(subdomain);
    res.json(rows);
  });

  app.post('/api/menu/products', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { code, name, price, category_id, department, sort_order } = req.body;
    if (!name || price == null) return res.status(400).json({ error: 'name and price required' });
    const info = db.prepare(`
      INSERT INTO menu_products (subdomain, code, name, price, category_id, department, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subdomain, code || null, name, Number(price), category_id || null, department || 'Banaku', sort_order || 0);
    const row = db.prepare('SELECT * FROM menu_products WHERE id = ?').get(info.lastInsertRowid);
    res.json(row);
  });

  app.put('/api/menu/products/:id', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { code, name, price, category_id, department, active, sort_order } = req.body;
    const info = db.prepare(`
      UPDATE menu_products
      SET code = COALESCE(?, code),
          name = COALESCE(?, name),
          price = COALESCE(?, price),
          category_id = COALESCE(?, category_id),
          department = COALESCE(?, department),
          active = COALESCE(?, active),
          sort_order = COALESCE(?, sort_order)
      WHERE id = ? AND subdomain = ?
    `).run(code, name, price, category_id, department, active, sort_order, req.params.id, subdomain);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    res.json({ status: 'ok' });
  });

  app.delete('/api/menu/products/:id', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const info = db.prepare('UPDATE menu_products SET active = 0 WHERE id = ? AND subdomain = ?').run(req.params.id, subdomain);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    res.json({ status: 'ok' });
  });
};
