const { Pool } = require('pg');
const config = require('./config');

if (!config.databaseUrl) {
  throw new Error('Missing required environment variable: DATABASE_URL');
}

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
      message TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      source TEXT NOT NULL DEFAULT 'live'
    );
    ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'live';
    CREATE INDEX IF NOT EXISTS alerts_status_last_seen_idx ON alerts(status, last_seen DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS alerts_historical_event_unique_idx
      ON alerts(device_id, metric, first_seen) WHERE source = 'historical';
    CREATE TABLE IF NOT EXISTS command_audit (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      command TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      result JSONB
    );
  `);
}

async function recordAlert({ deviceId, metric, severity, message, value }) {
  const result = await pool.query(
    `INSERT INTO alerts(device_id, metric, severity, message, value)
     VALUES($1, $2, $3, $4, $5) RETURNING *`,
    [deviceId, metric, severity, message, value]
  );
  return result.rows[0];
}

async function recordHistoricalAlert({ deviceId, metric, severity, message, value, firstSeen, resolvedAt }) {
  await pool.query(
    `INSERT INTO alerts(device_id, metric, severity, message, value, status, first_seen, last_seen, resolved_at, source)
     VALUES($1, $2, $3, $4, $5, 'resolved', $6, $7, $7, 'historical')
     ON CONFLICT (device_id, metric, first_seen) WHERE source = 'historical' DO NOTHING`,
    [deviceId, metric, severity, message, value, firstSeen, resolvedAt]
  );
}

async function resolveAlerts(deviceId, metric) {
  await pool.query(
    `UPDATE alerts SET status = 'resolved', last_seen = NOW(), resolved_at = NOW()
     WHERE device_id = $1 AND metric = $2 AND status = 'active'`,
    [deviceId, metric]
  );
}

async function getActiveAlertKeys() {
  const result = await pool.query("SELECT device_id, metric FROM alerts WHERE status = 'active'");
  return result.rows.map((row) => `${row.device_id}:${row.metric}`);
}

async function listAlerts(limit = 100) {
  const result = await pool.query(
    'SELECT * FROM alerts ORDER BY last_seen DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}

async function auditCommand(deviceId, command) {
  const result = await pool.query(
    'INSERT INTO command_audit(device_id, command) VALUES($1, $2) RETURNING id',
    [deviceId, command]
  );
  return result.rows[0].id;
}

async function finishCommand(id, result) {
  await pool.query('UPDATE command_audit SET result = $2 WHERE id = $1', [id, JSON.stringify(result)]);
}

async function closeDatabase() {
  await pool.end();
}

module.exports = {
  pool,
  initializeDatabase,
  recordAlert,
  recordHistoricalAlert,
  resolveAlerts,
  getActiveAlertKeys,
  listAlerts,
  auditCommand,
  finishCommand,
  closeDatabase
};
