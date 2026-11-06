const config = require('./config');

async function getWeather() {
  if (!config.azureMapsKey) {
    const error = new Error('Configure AZURE_MAPS_KEY para consultar Weather Atlas (Azure Maps).');
    error.status = 503;
    throw error;
  }
  const url = new URL('https://atlas.microsoft.com/weather/currentConditions/json');
  url.searchParams.set('api-version', '1.1');
  url.searchParams.set('query', `${config.latitude},${config.longitude}`);
  url.searchParams.set('subscription-key', config.azureMapsKey);
  const response = await fetch(url);
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
