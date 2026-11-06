const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const config = require('./config');

const client = new InfluxDB({ url: config.influxUrl, token: config.influxToken });
const writeApi = client.getWriteApi(config.influxOrg, config.influxBucket, 'ms', {
  batchSize: 500,
  flushInterval: 1000
});
const queryApi = client.getQueryApi(config.influxOrg);

function telemetryPoint(deviceId, metric, value, timestamp = new Date()) {
  return new Point('telemetry')
    .tag('deviceId', deviceId)
    .tag('metric', metric)
    .floatField('value', Number(value))
    .timestamp(timestamp);
}

async function writeTelemetry(deviceId, metrics, timestamp) {
  for (const [metric, value] of Object.entries(metrics)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    writeApi.writePoint(telemetryPoint(deviceId, metric, value, timestamp));
  }
  await writeApi.flush();
}

async function queryTelemetry({ deviceId, metric, range = '24h' } = {}) {
  const allowedRanges = new Set(['1h', '6h', '24h', '7d']);
  const safeRange = allowedRanges.has(range) ? range : '24h';
  const filters = [];
  if (deviceId) filters.push(`|> filter(fn: (r) => r.deviceId == "${deviceId.replaceAll('"', '')}")`);
  if (metric) filters.push(`|> filter(fn: (r) => r.metric == "${metric.replaceAll('"', '')}")`);
  const flux = `from(bucket: "${config.influxBucket}")\n  |> range(start: -${safeRange})\n  |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "value")\n  ${filters.join('\n  ')}\n  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)\n  |> keep(columns: ["_time", "_value", "deviceId", "metric"])\n  |> sort(columns: ["_time"])`;
  const rows = [];
  await new Promise((resolve, reject) => {
    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        const record = tableMeta.toObject(row);
        rows.push({
          timestamp: record._time,
          value: Number(record._value),
          deviceId: record.deviceId,
          metric: record.metric
        });
      },
      error: reject,
      complete: resolve
    });
  });
  return rows;
}

async function closeInflux() {
  await writeApi.close();
}

module.exports = { client, writeApi, telemetryPoint, writeTelemetry, queryTelemetry, closeInflux };
