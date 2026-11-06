const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { getWeather } = require('../src/weather');

test('uses real Open-Meteo conditions when no Azure Maps key is configured', async () => {
  const originalKey = config.azureMapsKey;
  const originalFetch = global.fetch;
  config.azureMapsKey = '';
  global.fetch = async (url) => {
    const requestUrl = new URL(url);
    assert.equal(requestUrl.hostname, 'api.open-meteo.com');
    assert.equal(requestUrl.searchParams.get('current'), 'temperature_2m,relative_humidity_2m');
    return {
      ok: true,
      json: async () => ({
        current: {
          temperature_2m: 22.4,
          relative_humidity_2m: 61,
          time: '2026-11-06T15:00'
        },
        daily: { precipitation_probability_max: [20] }
      })
    };
  };

  try {
    assert.deepEqual(await getWeather(), {
      provider: 'Open-Meteo (fallback; Azure Maps key not configured)',
      temperature: 22.4,
      humidity: 61,
      rainProbability: 20,
      observationTime: '2026-11-06T15:00'
    });
  } finally {
    config.azureMapsKey = originalKey;
    global.fetch = originalFetch;
  }
});

test('uses Azure Maps Weather when its subscription key is configured', async () => {
  const originalKey = config.azureMapsKey;
  const originalFetch = global.fetch;
  config.azureMapsKey = 'test-key';
  global.fetch = async (url) => {
    const requestUrl = new URL(url);
    assert.equal(requestUrl.hostname, 'atlas.microsoft.com');
    assert.equal(requestUrl.searchParams.get('subscription-key'), 'test-key');
    return {
      ok: true,
      json: async () => [{
        temperature: { value: 21.8 },
        relativeHumidity: 58,
        precipitationProbability: 10,
        dateTime: '2026-11-06T15:00:00Z'
      }]
    };
  };

  try {
    assert.deepEqual(await getWeather(), {
      provider: 'Microsoft Azure Maps Weather',
      temperature: 21.8,
      humidity: 58,
      rainProbability: 10,
      observationTime: '2026-11-06T15:00:00Z'
    });
  } finally {
    config.azureMapsKey = originalKey;
    global.fetch = originalFetch;
  }
});
