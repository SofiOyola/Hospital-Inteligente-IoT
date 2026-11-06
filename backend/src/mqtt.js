const mqtt = require('mqtt');
const { randomUUID } = require('node:crypto');
const config = require('./config');
const { writeTelemetry } = require('./influx');
const { evaluateMetrics } = require('./alerts');
const { syncAzureTwin } = require('./azure-digital-twins');

const twins = new Map();
const latest = new Map();
const pendingCommands = new Map();
let mqttClient;

function connectMqtt() {
  mqttClient = mqtt.connect(config.mqttUrl, {
    username: config.mqttUsername,
    password: config.mqttPassword,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true
  });

  mqttClient.on('connect', () => {
    mqttClient.subscribe(['hospital/+/+', 'hospital/command/+/ack'], { qos: 1 }, (error) => {
      if (error) console.error('MQTT subscribe failed:', error.message);
    });
    console.info(JSON.stringify({ event: 'mqtt_connected', url: config.mqttUrl }));
  });
  mqttClient.on('reconnect', () => console.warn('MQTT reconnecting'));
  mqttClient.on('error', (error) => console.error('MQTT error:', error.message));
  mqttClient.on('message', (topic, buffer) => {
    handleMessage(topic, buffer).catch((error) => {
      console.error(JSON.stringify({ event: 'mqtt_message_failed', topic, error: error.message }));
    });
  });
  return mqttClient;
}

async function handleMessage(topic, buffer) {
  let payload;
  try {
    payload = JSON.parse(buffer.toString());
  } catch (error) {
    console.error(`Ignoring invalid JSON on ${topic}:`, error.message);
    return;
  }
  const ackMatch = topic.match(/^hospital\/command\/([^/]+)\/ack$/);
  if (ackMatch) {
    const waiting = payload.commandId && pendingCommands.get(payload.commandId);
    if (waiting?.deviceId !== ackMatch[1]) return;
    if (waiting) {
      clearTimeout(waiting.timeout);
      pendingCommands.delete(payload.commandId);
      waiting.resolve(payload);
    }
    return;
  }
  if (typeof payload.deviceId !== 'string') {
    console.error(`Ignoring invalid telemetry envelope on ${topic}`);
    return;
  }
  const timestamp = new Date(payload.timestamp || Date.now());
  if (Number.isNaN(timestamp.getTime())) {
    console.error(`Ignoring invalid timestamp on ${topic}`);
    return;
  }
  const rawMetrics = payload.metrics && typeof payload.metrics === 'object'
    ? payload.metrics
    : Object.fromEntries(Object.entries(payload).filter(([key]) => !['deviceId', 'timestamp', 'source'].includes(key)));
  const metrics = Object.fromEntries(
    Object.entries(rawMetrics)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
  );
  if (!Object.keys(metrics).length) return;
  const snapshot = {
    deviceId: payload.deviceId,
    timestamp: timestamp.toISOString(),
    metrics,
    source: payload.source || 'simulated',
    status: 'online',
    topic
  };
  latest.set(payload.deviceId, snapshot);
  if (payload.deviceId.startsWith('twin-')) {
    twins.set(payload.deviceId, snapshot);
    syncAzureTwin(payload.deviceId, metrics)
      .catch((error) => console.error(JSON.stringify({ event: 'azure_twin_sync_failed', deviceId: payload.deviceId, error: error.message })));
  }
  await writeTelemetry(payload.deviceId, metrics, timestamp);
  await evaluateMetrics(payload.deviceId, metrics);
}

function publishCommand(deviceId, command, options = {}) {
  if (!mqttClient || !mqttClient.connected) {
    throw new Error('MQTT broker is not connected');
  }
  const timeoutMs = options.timeoutMs || 5000;
  const commandId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCommands.delete(commandId);
      resolve({ status: 'accepted', message: 'Comando publicado; sin confirmación del dispositivo antes del timeout.' });
    }, timeoutMs);
    pendingCommands.set(commandId, { deviceId, resolve, reject, timeout });
    mqttClient.publish(
      `hospital/control/${deviceId}`,
      JSON.stringify({ commandId, deviceId, command, parameters: options.parameters || {}, timestamp: new Date().toISOString() }),
      { qos: 1, retain: false },
      (error) => {
        if (error) {
          clearTimeout(timeout);
          pendingCommands.delete(commandId);
          reject(error);
        }
      }
    );
  });
}

function getLatest(deviceId) {
  return deviceId ? latest.get(deviceId) : Object.fromEntries(latest);
}

function getTwins() {
  return Array.from(twins.values());
}

async function closeMqtt() {
  if (!mqttClient) return;
  await new Promise((resolve) => mqttClient.end(false, {}, resolve));
}

module.exports = { connectMqtt, publishCommand, getLatest, getTwins, closeMqtt };
