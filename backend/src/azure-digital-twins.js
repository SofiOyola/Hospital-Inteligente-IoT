const config = require('./config');
const { DefaultAzureCredential } = require('@azure/identity');
const models = require('../models/hospital-models.json');
const twinStates = {
  'twin-or01': { modelId: 'dtmi:hospital:OperatingRoom;1', properties: ['temperature', 'humidity', 'occupancy'] },
  'twin-icu': { modelId: 'dtmi:hospital:ICU;1', properties: ['availableBeds', 'connectedPatients', 'operationalEquipment'] },
  'twin-pharmacy': { modelId: 'dtmi:hospital:Pharmacy;1', properties: ['inventory', 'criticalMedicationCount', 'temperature'] }
};

const credential = new DefaultAzureCredential();
const modelIds = {
  'twin-or01': 'dtmi:hospital:OperatingRoom;1',
  'twin-icu': 'dtmi:hospital:ICU;1',
  'twin-pharmacy': 'dtmi:hospital:Pharmacy;1'
};

async function syncAzureTwin(deviceId, metrics) {
  const endpoint = process.env.AZURE_DIGITAL_TWINS_URL;
  if (!endpoint) return;
  const token = await credential.getToken('https://digitaltwins.azure.net/.default');
  if (!token) throw new Error('Azure Identity no pudo obtener token para Digital Twins.');
  const baseUrl = endpoint.replace(/\/$/, '');
  const twinUrl = `${baseUrl}/digitaltwins/${encodeURIComponent(deviceId)}?api-version=2023-10-31`;
  const headers = { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' };
  const current = await fetch(twinUrl, { headers });
  if (current.status === 404) {
    const definition = twinStates[deviceId];
    if (!definition) throw new Error(`No hay modelo registrado para ${deviceId}.`);
    const properties = Object.fromEntries(definition.properties.map((name) => [name, metrics[name] ?? 0]));
    const createResponse = await fetch(twinUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ $metadata: { $model: definition.modelId }, ...properties })
    });
    if (!createResponse.ok) throw new Error(`Digital Twins create HTTP ${createResponse.status}: ${await createResponse.text()}`);
    return;
  }
  if (!current.ok) throw new Error(`Digital Twins GET HTTP ${current.status}: ${await current.text()}`);
  const patch = Object.entries(metrics).map(([key, value]) => ({ op: 'add', path: `/${key}`, value }));
  const response = await fetch(twinUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json-patch+json'
    },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error(`Digital Twins PATCH HTTP ${response.status}: ${await response.text()}`);
}

async function provisionAzureModels() {
  const endpoint = process.env.AZURE_DIGITAL_TWINS_URL;
  if (!endpoint) return;
  const token = await credential.getToken('https://digitaltwins.azure.net/.default');
  if (!token) throw new Error('Azure Identity no pudo obtener token para Digital Twins.');
  const headers = { Authorization: `Bearer ${token.token}` };
  const missing = [];
  for (const model of models) {
    const response = await fetch(
      `${endpoint.replace(/\/$/, '')}/models/${encodeURIComponent(model['@id'])}?api-version=2023-10-31`,
      { headers }
    );
    if (response.status === 404) missing.push(model);
    else if (!response.ok) throw new Error(`Digital Twins model lookup HTTP ${response.status}: ${await response.text()}`);
  }
  if (!missing.length) return;
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/models?api-version=2023-10-31`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(missing)
  });
  if (!response.ok) throw new Error(`Digital Twins model upload HTTP ${response.status}: ${await response.text()}`);
}

module.exports = { syncAzureTwin, provisionAzureModels };
