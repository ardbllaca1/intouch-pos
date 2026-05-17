let escpos = null;
let USB = null;

try {
  escpos = require('escpos');
  USB = require('escpos-usb');
  escpos.USB = USB;
} catch (err) {
  console.warn('Printer modules unavailable, using simulation mode:', err.message);
}

function parseHex(value, fallback) {
  if (!value) return fallback;
  if (String(value).startsWith('0x')) return parseInt(value, 16);
  return parseInt(value, 10);
}

function printLines({ vid, pid, lines }) {
  if (!escpos || !USB) return Promise.resolve({ simulated: true });
  return new Promise((resolve) => {
    try {
      const device = new escpos.USB(vid, pid);
      const printer = new escpos.Printer(device);
      device.open((error) => {
        if (error) {
          console.warn('Printer open failed, simulation fallback:', error.message);
          resolve({ simulated: true, error: error.message });
          return;
        }
        printer
          .align('ct')
          .style('b')
          .size(1, 1)
          .text(lines.join('\n'))
          .text('------------------------------')
          .cut()
          .close(() => resolve({ simulated: false }));
      });
    } catch (err) {
      console.warn('Printer fallback simulation:', err.message);
      resolve({ simulated: true, error: err.message });
    }
  });
}

module.exports = (app, db, getSubdomain) => {
  const authMiddleware = app.locals.authMiddleware;

  app.post('/api/print/receipt', authMiddleware, async (req, res) => {
    const subdomain = getSubdomain(req);
    const { order_id, cash_given, change_due } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id required' });

    const order = db.prepare(`
      SELECT o.*, t.name AS table_name
      FROM live_orders o
      JOIN floor_tables t ON t.id = o.table_id
      WHERE o.id = ? AND o.subdomain = ?
    `).get(order_id, subdomain);
    if (!order) return res.status(404).json({ error: 'order not found' });

    const items = db.prepare('SELECT product_name, qty, price FROM live_order_items WHERE order_id = ? ORDER BY id ASC').all(order_id);
    const total = items.reduce((sum, i) => sum + (Number(i.price) * Number(i.qty)), 0);
    const now = new Date().toLocaleString('sq-AL');
    const lines = [
      'InTouch POS',
      `Tavolina: ${order.table_name}`,
      `Kamarieri: ${order.waiter_name}`,
      '------------------------------',
      ...items.map(i => `${i.qty}x ${i.product_name}  ${Number(i.price * i.qty).toFixed(2)}€`),
      '------------------------------',
      `TOTAL: ${total.toFixed(2)}€`,
      `Cash: ${Number(cash_given ?? total).toFixed(2)}€`,
      `Kusuri: ${Number(change_due ?? 0).toFixed(2)}€`,
      now
    ];

    const result = await printLines({
      vid: parseHex(process.env.BAR_PRINTER_VID, 0x04b8),
      pid: parseHex(process.env.BAR_PRINTER_PID, 0x0202),
      lines
    });

    if (result.simulated) console.log('Simulated receipt print:\n' + lines.join('\n'));
    res.json({ status: 'ok', simulated: !!result.simulated });
  });

  app.post('/api/print/kitchen', authMiddleware, async (req, res) => {
    const subdomain = getSubdomain(req);
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id required' });

    const order = db.prepare(`
      SELECT o.*, t.name AS table_name
      FROM live_orders o
      JOIN floor_tables t ON t.id = o.table_id
      WHERE o.id = ? AND o.subdomain = ?
    `).get(order_id, subdomain);
    if (!order) return res.status(404).json({ error: 'order not found' });

    const items = db.prepare(`
      SELECT i.product_name, i.qty, i.note
      FROM live_order_items i
      JOIN menu_products p ON p.id = i.product_id
      WHERE i.order_id = ? AND p.department = 'Kuzhina'
      ORDER BY i.id ASC
    `).all(order_id);

    const lines = [
      'KUZHINA',
      `Tavolina: ${order.table_name}`,
      `Kamarieri: ${order.waiter_name}`,
      `Koha: ${new Date().toLocaleTimeString('sq-AL')}`,
      '------------------------------',
      ...items.map(i => `${i.qty}x ${i.product_name}${i.note ? ` (${i.note})` : ''}`)
    ];

    const result = await printLines({
      vid: parseHex(process.env.KITCHEN_PRINTER_VID, 0x04b8),
      pid: parseHex(process.env.KITCHEN_PRINTER_PID, 0x0202),
      lines
    });

    if (result.simulated) console.log('Simulated kitchen print:\n' + lines.join('\n'));
    res.json({ status: 'ok', simulated: !!result.simulated });
  });
};
