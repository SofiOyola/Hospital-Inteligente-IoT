const test = require('node:test');
const assert = require('node:assert/strict');
const { validateControl } = require('../src/validation');

test('accepts a supported device command', () => {
  assert.equal(validateControl({ deviceId: 'fridge01', command: 'calibrate' }), null);
});

test('rejects unknown devices and commands', () => {
  assert.match(validateControl({ deviceId: 'unknown', command: 'turn_on' }), /deviceId inválido/);
  assert.match(validateControl({ deviceId: 'fridge01', command: 'delete' }), /Comando inválido/);
});

test('validates remote telemetry interval bounds', () => {
  assert.equal(validateControl({ deviceId: 'room01', command: 'set_interval', parameters: { intervalMs: 30000 } }), null);
  assert.match(validateControl({ deviceId: 'room01', command: 'set_interval', parameters: { intervalMs: 1 } }), /intervalMs/);
  assert.match(validateControl({ deviceId: 'room01', command: 'set_interval', parameters: { intervalMs: 3600001 } }), /intervalMs/);
});

test('rejects malformed control parameters and non-device data sources', () => {
  assert.match(validateControl({ deviceId: 'room01', command: 'set_interval', parameters: null }), /intervalMs/);
  assert.match(validateControl({ deviceId: 'twin-icu', command: 'simulate_failure' }), /no controlable/);
});
