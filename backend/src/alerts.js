const { recordAlert, resolveAlerts } = require('./postgres');
const { writeTelemetry } = require('./influx');
const { getActiveAlertKeys } = require('./postgres');

const rules = {
  heartRate: { test: (value) => value > 140, severity: 'critical', description: 'frecuencia cardíaca > 140 bpm' },
  oxygen: { test: (value) => value < 90, severity: 'critical', description: 'saturación de oxígeno < 90%' },
  temperature: { test: (value, deviceId) => deviceId === 'fridge01' && value > 8, severity: 'critical', description: 'temperatura del refrigerador > 8 °C' },
  co2: { test: (value) => value > 1000, severity: 'warning', description: 'CO₂ > 1000 ppm' },
  humidity: { test: (value) => value < 40, severity: 'warning', description: 'humedad < 40%' },
  sensorFailure: { test: (value) => value > 0, severity: 'warning', description: 'falla de sensor reportada' }
};

const activeRules = new Set();

async function restoreActiveRules() {
  for (const key of await getActiveAlertKeys()) activeRules.add(key);
}

async function evaluateMetrics(deviceId, metrics) {
  for (const [metric, value] of Object.entries(metrics)) {
    const rule = rules[metric];
    if (!rule || typeof value !== 'number') continue;
    const key = `${deviceId}:${metric}`;
    const triggered = rule.test(value, deviceId);
    if (triggered && !activeRules.has(key)) {
      activeRules.add(key);
      const alert = await recordAlert({
        deviceId,
        metric,
        severity: rule.severity,
        message: `${deviceId}: ${rule.description} (valor: ${value})`,
        value
      });
      await writeTelemetry(deviceId, { alert: 1 });
      console.warn(JSON.stringify({ event: 'iot_alert', severity: rule.severity, alertId: alert.id, deviceId, metric, value }));
    } else if (!triggered && activeRules.has(key)) {
      activeRules.delete(key);
      await resolveAlerts(deviceId, metric);
      await writeTelemetry(deviceId, { alert: 0 });
    }
  }
}

module.exports = { evaluateMetrics, restoreActiveRules, rules };
