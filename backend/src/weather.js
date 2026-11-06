const config = require('./config');

async function getOpenMeteoWeather() {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(config.latitude));
  url.searchParams.set('longitude', String(config.longitude));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m');
  url.searchParams.set('daily', 'precipitation_probability_max');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timezone', 'UTC');
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Open-Meteo Weather respondió HTTP ${response.status}`);
  const weather = await response.json();
  const current = weather.current;
  if (!current) throw new Error('Open-Meteo no devolvió condiciones actuales.');
  return {
    provider: 'Open-Meteo (fallback; Azure Maps key not configured)',
    temperature: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    rainProbability: weather.daily?.precipitation_probability_max?.[0] ?? null,
    observationTime: current.time || new Date().toISOString()
  };
}

async function getWeather() {
  if (!config.azureMapsKey) return getOpenMeteoWeather();
  const url = new URL('https://atlas.microsoft.com/weather/currentConditions/json');
  url.searchParams.set('api-version', '1.1');
  url.searchParams.set('query', `${config.latitude},${config.longitude}`);
  url.searchParams.set('subscription-key', config.azureMapsKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    throw new Error(`Azure Maps Weather respondió HTTP ${response.status}`);
  }
  const [condition] = await response.json();
  if (!condition) throw new Error('Azure Maps Weather no devolvió condiciones actuales.');
  return {
    provider: 'Microsoft Azure Maps Weather',
    temperature: condition.temperature?.value ?? null,
    humidity: condition.relativeHumidity ?? null,
    rainProbability: condition.precipitationProbability ?? null,
    observationTime: condition.dateTime || new Date().toISOString()
  };
}

module.exports = { getWeather };
