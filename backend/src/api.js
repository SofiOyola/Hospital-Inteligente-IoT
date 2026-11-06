const express = require('express');
const { devices } = require('./devices');
const { getLatest, getTwins, publishCommand } = require('./mqtt');
const { queryTelemetry } = require('./influx');
const { listAlerts, auditCommand, finishCommand } = require('./postgres');
const { analyze } = require('./analytics');
const { getWeather } = require('./weather');
const { validateControl } = require('./validation');
const { timingSafeEqual } = require('node:crypto');
const config = require('./config');

const router = express.Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

router.get('/devices', (_req, res) => {
  const latest = getLatest();
  res.json(devices.map((device) => ({
    ...device,
    status: latest[device.id] && Date.now() - Date.parse(latest[device.id].timestamp) < 15 * 60 * 1000 ? 'online' : 'offline',
    lastSeen: latest[device.id]?.timestamp || null,
    latestMetrics: latest[device.id]?.metrics || {}
  })));
});

router.get('/devices/:id', (req, res) => {
  const device = devices.find((candidate) => candidate.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Dispositivo no encontrado.' });
  const snapshot = getLatest(device.id);
  return res.json({
    ...device,
    status: snapshot && Date.now() - Date.parse(snapshot.timestamp) < 15 * 60 * 1000 ? 'online' : 'offline',
    lastSeen: snapshot?.timestamp || null,
    latestMetrics: snapshot?.metrics || {}
  });
});

router.get('/metrics', async (req, res, next) => {
  try {
    const { deviceId, metric, range } = req.query;
    if (deviceId && !devices.some((device) => device.id === deviceId)) {
      return res.status(400).json({ error: 'deviceId no pertenece al catálogo de dispositivos.' });
    }
    if (metric && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(metric)) {
      return res.status(400).json({ error: 'metric solo puede contener letras, números y guion bajo.' });
    }
    const rows = await queryTelemetry({ deviceId, metric, range });
    return res.json({
      range: ['1h', '6h', '24h', '7d'].includes(range) ? range : '24h',
      count: rows.length,
      series: rows
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/alerts', async (req, res, next) => {
  try {
    res.json(await listAlerts(Math.max(1, Math.min(Number(req.query.limit) || 100, 500))));
  } catch (error) {
    next(error);
  }
});

router.get('/analytics', async (_req, res, next) => {
  try {
    res.json(await analyze());
  } catch (error) {
    next(error);
  }
});

router.post('/control', async (req, res, next) => {
  try {
    if (config.controlToken) {
      const expected = Buffer.from(config.controlToken);
      const supplied = Buffer.from((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        return res.status(401).json({ error: 'Se requiere un token de autorización válido para controlar dispositivos.' });
      }
    }
    const { deviceId, command, parameters = {} } = req.body || {};
    const validationError = validateControl(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const auditId = await auditCommand(deviceId, command);
    try {
      const acknowledgement = await publishCommand(deviceId, command, { parameters });
      await finishCommand(auditId, acknowledgement);
      return res.status(202).json({ auditId, deviceId, command, acknowledgement });
    } catch (error) {
      await finishCommand(auditId, { status: 'failed', message: error.message });
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

router.get('/twins', (_req, res) => res.json(getTwins()));

router.get('/weather', async (_req, res, next) => {
  try {
    res.json(await getWeather());
  } catch (error) {
    next(error);
  }
});

module.exports = router;
