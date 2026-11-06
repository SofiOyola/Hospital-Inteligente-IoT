const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const api = require('./api');
const openapi = require('../openapi.json');
const { connectMqtt, closeMqtt } = require('./mqtt');
const { initializeDatabase, closeDatabase } = require('./postgres');
const { closeInflux } = require('./influx');
const { provisionAzureModels } = require('./azure-digital-twins');
const { restoreActiveRules } = require('./alerts');

async function start() {
  if (!config.influxToken) throw new Error('Missing required environment variable: INFLUX_TOKEN');
  await initializeDatabase();
  await restoreActiveRules();
  await provisionAzureModels();
  connectMqtt();

  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.split(',').map((origin) => origin.trim()) }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.use('/api', api);
  app.use((error, _req, res, _next) => {
    console.error(JSON.stringify({ event: 'request_failed', error: error.message }));
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Error interno del servidor.' });
  });

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.info(`Hospital IoT API listening on port ${config.port}`);
  });
  const shutdown = async () => {
    server.close();
    await Promise.all([closeMqtt(), closeInflux(), closeDatabase()]);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error('Could not start Hospital IoT API:', error);
  process.exitCode = 1;
});
