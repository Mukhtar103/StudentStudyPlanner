export function health(req, res) {
  res.set('Cache-Control', 'no-store').json({ success: true, data: { status: 'ok' }, requestId: req.id });
}
