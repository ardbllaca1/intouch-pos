const bcrypt = require('bcrypt');

module.exports = (app, db, getSubdomain) => {
  const authMiddleware = app.locals.authMiddleware;

  app.get('/api/waiters', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const rows = db.prepare(`
      SELECT id, name, role, active
      FROM waiters
      WHERE subdomain = ? AND active = 1
      ORDER BY name ASC
    `).all(subdomain);
    res.json(rows);
  });

  app.post('/api/waiters/pin', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { name, pin } = req.body;
    if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });
    const waiter = db.prepare('SELECT * FROM waiters WHERE subdomain = ? AND name = ? AND active = 1').get(subdomain, name);
    if (!waiter) return res.status(401).json({ error: 'Kredenciale të gabuara' });

    let ok = false;
    const isBcryptHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(waiter.pin));
    if (isBcryptHash) {
      try {
        ok = bcrypt.compareSync(String(pin), waiter.pin);
      } catch {
        ok = false;
      }
    } else {
      ok = String(pin) === String(waiter.pin);
    }

    if (!ok) return res.status(401).json({ error: 'Kredenciale të gabuara' });
    res.json({ id: waiter.id, name: waiter.name, role: waiter.role, active: waiter.active });
  });

  app.post('/api/waiters', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { name, pin, role, active } = req.body;
    if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });
    const hashed = bcrypt.hashSync(String(pin), 10);
    const info = db.prepare(`
      INSERT INTO waiters (subdomain, name, pin, role, active)
      VALUES (?, ?, ?, ?, ?)
    `).run(subdomain, name, hashed, role || 'waiter', active == null ? 1 : active);
    const row = db.prepare('SELECT id, name, role, active FROM waiters WHERE id = ?').get(info.lastInsertRowid);
    res.json(row);
  });

  app.put('/api/waiters/:id', authMiddleware, (req, res) => {
    const subdomain = getSubdomain(req);
    const { name, pin, role, active } = req.body;
    const current = db.prepare('SELECT * FROM waiters WHERE id = ? AND subdomain = ?').get(req.params.id, subdomain);
    if (!current) return res.status(404).json({ error: 'not found' });
    const hashed = pin ? bcrypt.hashSync(String(pin), 10) : current.pin;

    db.prepare(`
      UPDATE waiters
      SET name = COALESCE(?, name),
          pin = ?,
          role = COALESCE(?, role),
          active = COALESCE(?, active)
      WHERE id = ? AND subdomain = ?
    `).run(name, hashed, role, active, req.params.id, subdomain);

    const row = db.prepare('SELECT id, name, role, active FROM waiters WHERE id = ?').get(req.params.id);
    res.json(row);
  });
};
