function emitSubdomain(io, subdomain, event, payload) {
  io.of(`/${subdomain}`).emit(event, payload);
}

module.exports = (app, db, getSubdomain, io) => {
  const authMiddleware = app.locals.authMiddleware;

  app.get('/api/tables', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const rows = db.prepare(`
      SELECT id, name, pos_x, pos_y, width, height, shape, status, waiter_id, opened_at
      FROM floor_tables
      WHERE subdomain = ?
      ORDER BY id ASC
    `).all(subdomain);
    res.json(rows);
  });

  app.post('/api/tables', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { name, pos_x, pos_y, width, height, shape, status } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const info = db.prepare(`
      INSERT INTO floor_tables (subdomain, name, pos_x, pos_y, width, height, shape, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(subdomain, name, pos_x || 0, pos_y || 0, width || 80, height || 80, shape || 'square', status || 'free');
    const table = db.prepare('SELECT * FROM floor_tables WHERE id = ?').get(info.lastInsertRowid);
    emitSubdomain(io, subdomain, 'table:update', table);
    res.json(table);
  });

  app.put('/api/tables/:id', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { name, pos_x, pos_y, width, height, shape, status, waiter_id, opened_at } = req.body;
    const info = db.prepare(`
      UPDATE floor_tables
      SET name = COALESCE(?, name),
          pos_x = COALESCE(?, pos_x),
          pos_y = COALESCE(?, pos_y),
          width = COALESCE(?, width),
          height = COALESCE(?, height),
          shape = COALESCE(?, shape),
          status = COALESCE(?, status),
          waiter_id = COALESCE(?, waiter_id),
          opened_at = COALESCE(?, opened_at)
      WHERE id = ? AND subdomain = ?
    `).run(name, pos_x, pos_y, width, height, shape, status, waiter_id, opened_at, req.params.id, subdomain);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    const table = db.prepare('SELECT * FROM floor_tables WHERE id = ?').get(req.params.id);
    emitSubdomain(io, subdomain, 'table:update', table);
    res.json({ status: 'ok', table });
  });

  app.put('/api/tables/:id/position', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { pos_x, pos_y } = req.body;
    const info = db.prepare(`
      UPDATE floor_tables
      SET pos_x = ?, pos_y = ?
      WHERE id = ? AND subdomain = ?
    `).run(Number(pos_x) || 0, Number(pos_y) || 0, req.params.id, subdomain);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    const table = db.prepare('SELECT * FROM floor_tables WHERE id = ?').get(req.params.id);
    emitSubdomain(io, subdomain, 'table:update', table);
    res.json({ status: 'ok' });
  });

  app.delete('/api/tables/:id', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const info = db.prepare('DELETE FROM floor_tables WHERE id = ? AND subdomain = ?').run(req.params.id, subdomain);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    emitSubdomain(io, subdomain, 'table:update', { id: Number(req.params.id), deleted: true });
    res.json({ status: 'ok' });
  });
};
