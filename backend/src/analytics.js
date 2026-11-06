const { queryTelemetry } = require('./influx');
const { devices } = require('./devices');

async function analyze() {
  const rows = await queryTelemetry({ range: '24h' });
  const byMetric = new Map();
  const byDeviceAndMetric = new Map();
  for (const row of rows) {
    if (!byMetric.has(row.metric)) byMetric.set(row.metric, []);
    byMetric.get(row.metric).push(row);
    const key = `${row.deviceId}:${row.metric}`;
    if (!byDeviceAndMetric.has(key)) byDeviceAndMetric.set(key, []);
    byDeviceAndMetric.get(key).push(row);
  }

  const insights = [];
  for (const [metric, values] of byMetric) {
    if (values.length < 2) continue;
    const numbers = values.map((entry) => entry.value);
    const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const first = numbers.slice(0, Math.ceil(numbers.length / 2));
    const second = numbers.slice(Math.floor(numbers.length / 2));
    const average = (part) => part.reduce((sum, value) => sum + value, 0) / part.length;
    const trend = average(second) - average(first);
    const spikes = values.filter((entry) => Math.abs(entry.value - mean) > Math.max(Math.abs(mean) * 0.2, 1)).length;
    const unit = metric === 'heartRate' ? ' bpm' : metric === 'oxygen' || metric === 'humidity' ? '%' : '';
    insights.push({
      metric,
      sampleCount: values.length,
      min,
      max,
      mean: Number(mean.toFixed(2)),
      trend: Number(trend.toFixed(2)),
      anomalyCount: spikes,
      summary: `${metric}: promedio ${mean.toFixed(1)}${unit}, mínimo ${min.toFixed(1)}${unit}, máximo ${max.toFixed(1)}${unit}; ${trend >= 0 ? 'tendencia ascendente' : 'tendencia descendente'}${spikes ? ` y ${spikes} posibles picos` : ''}.`
    });
  }

  const hr = byMetric.get('heartRate') || [];
  if (hr.length > 2) {
    const middle = Math.floor(hr.length / 2);
    const firstHalf = hr.slice(0, middle).reduce((sum, row) => sum + row.value, 0) / middle;
    const secondHalfRows = hr.slice(middle);
    const secondHalf = secondHalfRows.reduce((sum, row) => sum + row.value, 0) / secondHalfRows.length;
    if (secondHalf > firstHalf * 1.08) {
      insights.unshift({
        type: 'trend',
        summary: 'Se observó un incremento sostenido de la frecuencia cardíaca en la segunda mitad del período analizado; revisar la telemetría y validar el contexto clínico.'
      });
    }
  }
  const fridge = byMetric.get('temperature') || [];
  const highFridge = fridge.filter((row) => row.deviceId === 'fridge01' && row.value > 8).length;
  if (highFridge) {
    insights.unshift({
      type: 'cold-chain',
      summary: `El refrigerador de vacunas superó 8 °C en ${highFridge} muestras del período analizado.`
    });
  }

  let aiAnalysis = {
    model: 'not-configured',
    analyzedSeries: 0,
    anomalies: [],
    disclaimer: 'Configure AI_SERVICE_URL para habilitar Isolation Forest.'
  };
  if (process.env.AI_SERVICE_URL) {
    let response;
    try {
      response = await fetch(`${process.env.AI_SERVICE_URL.replace(/\/$/, '')}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          series: Array.from(byDeviceAndMetric, ([key, samples]) => {
            const separator = key.indexOf(':');
            return {
              deviceId: key.slice(0, separator),
              metric: key.slice(separator + 1),
              samples: samples.map(({ timestamp, value }) => ({ timestamp, value }))
            };
          })
        }),
        signal: AbortSignal.timeout(15000)
      });
    } catch (cause) {
      const error = new Error('No fue posible consultar el servicio de analítica IA.', { cause });
      error.status = 503;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Servicio de IA respondió HTTP ${response.status}`);
      error.status = 503;
      throw error;
    }
    aiAnalysis = await response.json();
    for (const anomaly of aiAnalysis.anomalies) {
      insights.unshift({ type: 'ml-anomaly', ...anomaly });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    period: '24h',
    method: 'Estadística descriptiva y Isolation Forest no supervisado sobre series temporales; no constituye diagnóstico clínico.',
    deviceCount: devices.length,
    insights,
    aiAnalysis
  };
}

module.exports = { analyze };
