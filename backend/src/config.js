const config = {
  port: Number(process.env.PORT || 3000),
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  mqttUsername: process.env.MQTT_USERNAME || undefined,
  mqttPassword: process.env.MQTT_PASSWORD || undefined,
  influxUrl: process.env.INFLUX_URL || 'http://localhost:8086',
  influxOrg: process.env.INFLUX_ORG || 'hospital',
  influxBucket: process.env.INFLUX_BUCKET || 'HospitalIoT',
  influxToken: process.env.INFLUX_TOKEN || '',
  databaseUrl: process.env.DATABASE_URL || '',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  controlToken: process.env.CONTROL_TOKEN || '',
  latitude: Number(process.env.HOSPITAL_LATITUDE || 4.711),
  longitude: Number(process.env.HOSPITAL_LONGITUDE || -74.0721),
  azureMapsKey: process.env.AZURE_MAPS_KEY || ''
};

module.exports = config;
