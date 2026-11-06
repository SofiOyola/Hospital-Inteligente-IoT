const COMMANDS = new Set(['turn_on', 'turn_off', 'restart', 'calibrate', 'set_interval', 'simulate_failure']);
const DEVICES = new Set(['patient-icu01', 'patient-icu02', 'fridge01', 'room01']);

function validateControl(body) {
  const { deviceId, command } = body || {};
  const parameters = body?.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
    ? body.parameters
    : {};
  if (typeof deviceId !== 'string' || !DEVICES.has(deviceId)) return 'deviceId inválido o dispositivo no controlable.';
  if (!COMMANDS.has(command)) return `Comando inválido. Use: ${Array.from(COMMANDS).join(', ')}.`;
  if (command === 'set_interval' && (!Number.isInteger(parameters.intervalMs) || parameters.intervalMs < 5000 || parameters.intervalMs > 3600000)) {
    return 'intervalMs debe ser entero entre 5000 y 3600000.';
  }
  return null;
}

module.exports = { validateControl, COMMANDS, DEVICES };
