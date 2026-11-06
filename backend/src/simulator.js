const mqtt = require('mqtt');
const config = require('./config');

const intervalMs = Number(process.env.TELEMETRY_INTERVAL_MS || 300000);
const mqttClient = mqtt.connect(config.mqttUrl, {
  username: config.mqttUsername,
  password: config.mqttPassword,
  reconnectPeriod: 3000
});

const between = (min, max, digits = 1) => Number((min + Math.random() * (max - min)).toFixed(digits));
const round = (value, digits = 1) => Number(value.toFixed(digits));
let cycle = 0;
const disabledDevices = new Set();
const failedDevices = new Set();
let activeInterval;

function publish(topic, deviceId, metrics, source = 'simulated') {
  if (disabledDevices.has(deviceId)) return;
  if (failedDevices.has(deviceId)) {
    metrics = { ...metrics, sensorFailure: 1 };
  }
  const payload = {
    deviceId,
    timestamp: new Date().toISOString(),
    source,
    ...metrics
  };
  mqttClient.publish(topic, JSON.stringify(payload), { qos: 1, retain: true }, (error) => {
    if (error) console.error(`Publish failed for ${topic}:`, error.message);
  });
}

function syntheticReadings() {
  cycle += 1;
  const heatWave = cycle % 20 >= 10 ? 1.8 : 0;
  const powerOutage = cycle % 97 === 0;
  const occupancySurge = cycle % 31 >= 15;
  const heartRateSpike = cycle % 43 === 0;
  const dryAir = cycle % 23 === 0;
  publish('hospital/patient/icu01', 'patient-icu01', {
    heartRate: between(60, 95) + (occupancySurge ? 12 : 0) + (heartRateSpike ? between(50, 70) : 0),
    oxygen: between(93, 100),
    bodyTemperature: between(36.2, 37.5)
  });
  if (cycle % 251 !== 0) publish('hospital/patient/icu02', 'patient-icu02', {
    heartRate: between(58, 105),
    oxygen: between(91, 100),
    bodyTemperature: between(36.1, 37.4)
  });
  publish('hospital/pharmacy/fridge01', 'fridge01', {
    temperature: powerOutage ? between(8.5, 10.5) : between(2.2, 6.5),
    doorOpen: Math.random() > 0.96 ? 1 : 0,
    voltage: powerOutage ? 0 : between(218, 230)
  });
  publish('hospital/operatingroom/room01', 'room01', {
    temperature: between(19, 23) + heatWave,
    humidity: dryAir ? between(32, 38) : between(40, 60),
    airQuality: between(5, 40),
    co2: between(420, occupancySurge ? 1100 : 850, 0)
  });
  publish('hospital/twins/operating-room-01', 'twin-or01', {
    temperature: between(19, 23) + heatWave,
    humidity: between(40, 60),
    occupancy: occupancySurge ? 1 : 0
  });
  publish('hospital/twins/icu', 'twin-icu', {
    availableBeds: occupancySurge ? between(1, 3, 0) : between(3, 8, 0),
    connectedPatients: occupancySurge ? between(8, 12, 0) : between(4, 8, 0),
    operationalEquipment: between(22, 24, 0)
  });
  publish('hospital/twins/pharmacy', 'twin-pharmacy', {
    inventory: between(150, 500, 0),
    criticalMedicationCount: between(4, 12, 0),
    temperature: between(20, 24) + heatWave
  });
}

async function publishWeather() {
  if (!config.azureMapsKey) {
    publish('hospital/external/weather', 'weather-external', {
      temperature: between(12, 28),
      humidity: between(40, 90, 0),
      rainProbability: between(0, 100, 0)
    }, 'simulated-no-api-key');
    return;
  }
  const url = new URL('https://atlas.microsoft.com/weather/currentConditions/json');
  url.searchParams.set('api-version', '1.1');
  url.searchParams.set('query', `${config.latitude},${config.longitude}`);
  url.searchParams.set('subscription-key', config.azureMapsKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Azure Maps Weather HTTP ${response.status}`);
  const [condition] = await response.json();
  publish('hospital/external/weather', 'weather-external', {
    temperature: condition.temperature.value,
    humidity: condition.relativeHumidity,
    rainProbability: condition.precipitationProbability || 0
  }, 'azure-maps-weather');
}

async function publishAirQuality() {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.searchParams.set('latitude', String(config.latitude));
  url.searchParams.set('longitude', String(config.longitude));
  url.searchParams.set('current', 'pm10,pm2_5,us_aqi');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo Air Quality HTTP ${response.status}`);
  const { current } = await response.json();
  publish('hospital/external/airquality', 'airquality-external', {
    aqi: current.us_aqi,
    pm25: current.pm2_5,
    pm10: current.pm10
  }, 'open-meteo-air-quality');
}

async function sendReadings() {
  syntheticReadings();
  for (const fetchExternal of [publishWeather, publishAirQuality]) {
    try {
      await fetchExternal();
    } catch (error) {
      console.error('External telemetry fetch failed:', error.message);
    }
  }
  console.info(JSON.stringify({ event: 'simulation_cycle_complete', intervalMs }));
}

mqttClient.on('connect', () => {
  console.info('Simulator connected to MQTT broker.');
  mqttClient.subscribe('hospital/control/+', { qos: 1 }, (error) => {
    if (error) console.error('Control subscription failed:', error.message);
  });
  sendReadings().catch((error) => console.error('Simulation cycle failed:', error));
  if (!activeInterval) activeInterval = setInterval(() => sendReadings().catch((error) => console.error('Simulation cycle failed:', error)), intervalMs);
});
mqttClient.on('message', (topic, buffer) => {
  let command;
  try {
    command = JSON.parse(buffer.toString());
  } catch (error) {
    console.error('Invalid control message:', error.message);
    return;
  }
  const deviceId = topic.split('/').at(-1);
  const supported = new Set(['turn_on', 'turn_off', 'restart', 'calibrate', 'set_interval', 'simulate_failure']);
  let status = supported.has(command.command) ? 'success' : 'error';
  if (command.command === 'turn_off') disabledDevices.add(deviceId);
  if (command.command === 'turn_on' || command.command === 'restart') disabledDevices.delete(deviceId);
  if (command.command === 'restart') failedDevices.delete(deviceId);
  if (command.command === 'simulate_failure') failedDevices.add(deviceId);
  if (command.command === 'set_interval') {
    const newInterval = command.parameters?.intervalMs;
    if (Number.isInteger(newInterval) && newInterval >= 5000 && newInterval <= 3600000) {
      clearInterval(activeInterval);
      activeInterval = setInterval(() => sendReadings().catch((error) => console.error('Simulation cycle failed:', error)), newInterval);
    } else {
      status = 'error';
    }
  }
  console.info(JSON.stringify({ event: 'device_command', deviceId, command: command.command, status }));
  mqttClient.publish(`hospital/command/${deviceId}/ack`, JSON.stringify({
    commandId: command.commandId,
    deviceId,
    command: command.command,
    status,
    timestamp: new Date().toISOString()
  }), { qos: 1 });
});
mqttClient.on('error', (error) => console.error('Simulator MQTT error:', error.message));
