const { Point } = require('@influxdata/influxdb-client');
const { writeApi, closeInflux } = require('./influx');
const config = require('./config');
const {
  pool,
  initializeDatabase,
  recordHistoricalAlert,
  closeDatabase
} = require('./postgres');

const stepMs = 5 * 60 * 1000;
const pointCount = 6 * 24 * 12;
const end = Math.floor(Date.now() / stepMs) * stepMs;
const start = end - (pointCount - 1) * stepMs;

function point(deviceId, metric, value, timestamp) {
  return new Point('telemetry')
    .tag('deviceId', deviceId)
    .tag('metric', metric)
    .floatField('value', Number(value))
    .timestamp(new Date(timestamp));
}

function rounded(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForDependencies() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${config.influxUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`InfluxDB health check returned ${response.status}.`);
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await sleep(2000);
    }
  }
  throw new Error('InfluxDB or PostgreSQL did not become ready before historical seeding.', { cause: lastError });
}

function readings(index) {
  const day = Math.floor(index / 288);
  const minute = index % 288;
  const daily = Math.sin((minute / 288) * Math.PI * 2);
  const heatWave = day === 3 ? 5 : 0;
  const outage = day === 2 && minute >= 145 && minute <= 150;
  const maintenance = day === 4 && minute >= 100 && minute <= 111;
  const surge = day === 1 && minute >= 144 && minute <= 215;
  const dryAir = day === 3 && minute >= 40 && minute <= 50;
  return {
    'patient-icu01': { heartRate: rounded(82 + 10 * daily + (surge ? 70 : 0)), oxygen: rounded(97 - (surge ? 9 : 0)), bodyTemperature: rounded(36.8 + daily * 0.3) },
    'patient-icu02': { heartRate: rounded(76 + 8 * daily), oxygen: rounded(96 + daily), bodyTemperature: rounded(36.7 + daily * 0.25) },
    fridge01: { temperature: rounded(outage ? 9.5 + (minute % 4) * 0.4 : 4 + 0.8 * daily), doorOpen: maintenance ? 1 : 0, voltage: outage ? 0 : rounded(224 + 2 * daily) },
    room01: { temperature: rounded(21 + heatWave + daily), humidity: dryAir ? 36 : rounded(48 + daily * 8), airQuality: rounded(15 + daily * 4), co2: rounded(600 + (surge ? 550 : 0) + daily * 100) },
    'twin-or01': { temperature: rounded(21 + heatWave + daily), humidity: rounded(49 + daily * 7), occupancy: surge ? 1 : Number(minute > 100 && minute < 220) },
    'twin-icu': { availableBeds: surge ? 2 : 5 + Math.round(2 * daily), connectedPatients: surge ? 11 : 7 + Math.round(daily), operationalEquipment: maintenance ? 20 : 24 },
    'twin-pharmacy': { inventory: 320 - day * 8 + Math.round(10 * daily), criticalMedicationCount: 6 + (day % 3), temperature: rounded(22 + daily) },
    'weather-external': { temperature: rounded(18 + heatWave + daily * 3), humidity: rounded(65 - daily * 10), rainProbability: rounded(Math.max(0, 40 - daily * 30)) },
    'airquality-external': { aqi: rounded(28 + Math.max(0, daily * 20)), pm25: rounded(8 + daily * 4), pm10: rounded(16 + daily * 6) },
    'historical-dataset': { energyKwh: rounded(210 + 45 * daily + (surge ? 40 : 0)), occupancy: rounded(surge ? 0.96 : 0.68 + daily * 0.08, 3), temperature: rounded(22 + heatWave + daily) }
  };
}

async function seed() {
  await waitForDependencies();
  console.info(JSON.stringify({ event: 'history_seed_started', samples: pointCount, intervalMinutes: 5, days: 6 }));
  for (let index = 0; index < pointCount; index += 1) {
    const timestamp = start + index * stepMs;
    const day = Math.floor(index / 288);
    const minute = index % 288;
    for (const [deviceId, metrics] of Object.entries(readings(index))) {
      if (deviceId === 'patient-icu02' && day === 5 && minute >= 190 && minute <= 195) continue;
      for (const [metric, value] of Object.entries(metrics)) {
        writeApi.writePoint(point(deviceId, metric, value, timestamp));
      }
      const triggered = (deviceId.startsWith('patient-') && metrics.oxygen < 90)
        || (deviceId === 'fridge01' && metrics.temperature > 8)
        || (deviceId === 'patient-icu01' && metrics.heartRate > 140)
        || (deviceId === 'room01' && (metrics.co2 > 1000 || metrics.humidity < 40));
      if (triggered) writeApi.writePoint(point(deviceId, 'alert', 1, timestamp));
    }
  }
  await writeApi.flush();
  await closeInflux();
  await initializeDatabase();
  const alertEvents = [
    { index: 288 + 144, deviceId: 'patient-icu01', metric: 'heartRate', severity: 'critical', durationSteps: 72, message: 'Frecuencia cardíaca histórica superior a 140 bpm durante un aumento de ocupación.' },
    { index: 288 + 144, deviceId: 'patient-icu01', metric: 'oxygen', severity: 'critical', durationSteps: 72, message: 'Saturación de oxígeno histórica inferior al 90% durante un evento sintético.' },
    { index: 288 + 144, deviceId: 'room01', metric: 'co2', severity: 'warning', durationSteps: 72, message: 'CO2 histórico superior a 1000 ppm en la sala de cirugía.' },
    { index: 2 * 288 + 145, deviceId: 'fridge01', metric: 'temperature', severity: 'critical', durationSteps: 6, message: 'Temperatura del refrigerador de vacunas superior a 8 °C durante un corte eléctrico.' },
    { index: 3 * 288 + 40, deviceId: 'room01', metric: 'humidity', severity: 'warning', durationSteps: 11, message: 'Humedad histórica inferior al 40% en la sala de cirugía.' }
  ];
  for (const event of alertEvents) {
    const firstSeen = start + event.index * stepMs;
    await recordHistoricalAlert({
      ...event,
      value: readings(event.index)[event.deviceId][event.metric],
      firstSeen: new Date(firstSeen),
      resolvedAt: new Date(firstSeen + event.durationSteps * stepMs)
    });
  }
  await closeDatabase();
  console.info(JSON.stringify({ event: 'history_seed_completed', from: new Date(start).toISOString(), to: new Date(end).toISOString() }));
}

seed().catch(async (error) => {
  console.error('Historical seed failed:', error);
  await closeInflux();
  await closeDatabase();
  process.exitCode = 1;
});
