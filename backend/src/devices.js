const devices = [
  { id: 'patient-icu01', name: 'Monitor de Paciente UCI-01', type: 'patient-monitor', topic: 'hospital/patient/icu01', variables: ['heartRate', 'oxygen', 'bodyTemperature'], protocol: 'MQTT' },
  { id: 'patient-icu02', name: 'Monitor de Paciente UCI-02', type: 'patient-monitor', topic: 'hospital/patient/icu02', variables: ['heartRate', 'oxygen', 'bodyTemperature'], protocol: 'MQTT' },
  { id: 'fridge01', name: 'Refrigerador de Vacunas', type: 'medical-refrigerator', topic: 'hospital/pharmacy/fridge01', variables: ['temperature', 'doorOpen', 'voltage'], protocol: 'MQTT' },
  { id: 'room01', name: 'Sala de Cirugía', type: 'operating-room-sensors', topic: 'hospital/operatingroom/room01', variables: ['temperature', 'humidity', 'airQuality', 'co2'], protocol: 'MQTT' },
  { id: 'twin-or01', name: 'Digital Twin Quirófano 1', type: 'digital-twin', topic: 'hospital/twins/operating-room-01', variables: ['temperature', 'humidity', 'occupancy'], protocol: 'MQTT' },
  { id: 'twin-icu', name: 'Digital Twin UCI', type: 'digital-twin', topic: 'hospital/twins/icu', variables: ['availableBeds', 'connectedPatients', 'operationalEquipment'], protocol: 'MQTT' },
  { id: 'twin-pharmacy', name: 'Digital Twin Farmacia', type: 'digital-twin', topic: 'hospital/twins/pharmacy', variables: ['inventory', 'criticalMedicationCount', 'temperature'], protocol: 'MQTT' },
  { id: 'weather-external', name: 'Weather Atlas (Azure Maps)', type: 'external-api', topic: 'hospital/external/weather', variables: ['temperature', 'humidity', 'rainProbability'], protocol: 'HTTP REST → MQTT' },
  { id: 'airquality-external', name: 'Open-Meteo Air Quality', type: 'external-api', topic: 'hospital/external/airquality', variables: ['aqi', 'pm25', 'pm10'], protocol: 'HTTP REST → MQTT' },
  { id: 'historical-dataset', name: 'Dataset Histórico Hospitalario', type: 'historical-dataset', topic: null, variables: ['energyKwh', 'occupancy', 'temperature'], protocol: 'InfluxDB seed' }
];

module.exports = { devices };
