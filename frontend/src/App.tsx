import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowUpRight, BedDouble, Boxes, ChartNoAxesCombined,
  CircleHelp, Clock3, CloudSun, Gauge, Hospital, RefreshCw, ShieldAlert,
  Thermometer, Wind
} from 'lucide-react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { api } from './api';
import type { Alert, Device, MetricRow, Twin } from './types';

const metrics = [
  { id: 'heartRate', label: 'Frecuencia cardíaca', unit: 'bpm', icon: Activity },
  { id: 'oxygen', label: 'Saturación de oxígeno', unit: '%', icon: Gauge },
  { id: 'bodyTemperature', label: 'Temperatura corporal', unit: '°C', icon: Thermometer },
  { id: 'temperature', label: 'Temperatura', unit: '°C', icon: Thermometer },
  { id: 'humidity', label: 'Humedad', unit: '%', icon: CloudSun },
  { id: 'co2', label: 'CO₂', unit: 'ppm', icon: Wind },
  { id: 'occupancy', label: 'Ocupación', unit: '', icon: BedDouble },
  { id: 'energyKwh', label: 'Energía', unit: 'kWh', icon: Activity },
  { id: 'airQuality', label: 'Calidad del aire', unit: '', icon: Wind },
  { id: 'rainProbability', label: 'Probabilidad de lluvia', unit: '%', icon: CloudSun },
  { id: 'aqi', label: 'Índice de calidad del aire', unit: 'AQI', icon: Wind },
  { id: 'pm25', label: 'PM2.5', unit: 'µg/m³', icon: Wind },
  { id: 'pm10', label: 'PM10', unit: 'µg/m³', icon: Wind },
  { id: 'voltage', label: 'Voltaje', unit: 'V', icon: Activity },
  { id: 'doorOpen', label: 'Puerta', unit: '', icon: Boxes },
  { id: 'availableBeds', label: 'Camas disponibles', unit: '', icon: BedDouble },
  { id: 'connectedPatients', label: 'Pacientes conectados', unit: '', icon: Activity },
  { id: 'operationalEquipment', label: 'Equipos operativos', unit: '', icon: Boxes },
  { id: 'inventory', label: 'Inventario farmacia', unit: '', icon: Boxes },
  { id: 'criticalMedicationCount', label: 'Medicamentos críticos', unit: '', icon: AlertTriangle }
];

const friendly: Record<string, string> = {
  heartRate: 'Frecuencia cardíaca', oxygen: 'Saturación O₂', bodyTemperature: 'Temperatura corporal',
  temperature: 'Temperatura', humidity: 'Humedad', co2: 'CO₂', occupancy: 'Ocupación',
  availableBeds: 'Camas disponibles', connectedPatients: 'Pacientes conectados',
  operationalEquipment: 'Equipos operativos', inventory: 'Inventario',
  criticalMedicationCount: 'Medicamentos críticos', energyKwh: 'Consumo energético',
  aqi: 'AQI', pm25: 'PM2.5', pm10: 'PM10', voltage: 'Voltaje', doorOpen: 'Puerta abierta'
};

function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [twins, setTwins] = useState<Twin[]>([]);
  const [insights, setInsights] = useState<Array<{ summary: string }>>([]);
  const [selectedMetric, setSelectedMetric] = useState('heartRate');
  const [selectedDevice, setSelectedDevice] = useState('patient-icu01');
  const [range, setRange] = useState('24h');
  const [series, setSeries] = useState<MetricRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [controlToken, setControlToken] = useState(() => sessionStorage.getItem('control-token') || '');

  const refresh = useCallback(async () => {
    try {
      const [deviceRows, alertRows, twinRows, analytics] = await Promise.all([
        api.devices(), api.alerts(), api.twins(), api.analytics()
      ]);
      setDevices(deviceRows);
      setAlerts(alertRows);
      setTwins(twinRows);
      setInsights(analytics.insights);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible consultar el backend.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    api.metrics(selectedDevice, selectedMetric, range)
      .then((result) => { if (active) setSeries(result.series); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Error consultando métricas.'); });
    return () => { active = false; };
  }, [range, selectedDevice, selectedMetric]);

  const activeAlerts = useMemo(() => alerts.filter((alert) => alert.status === 'active'), [alerts]);
  const onlineCount = devices.filter((device) => device.status === 'online').length;
  const selected = devices.find((device) => device.id === selectedDevice);
  const currentValue = selected?.latestMetrics[selectedMetric];
  const chartData = series.map((row) => ({
    ...row,
    time: new Date(row.timestamp).toLocaleString('es-CO', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }));
  const label = metrics.find((item) => item.id === selectedMetric);

  async function sendCommand(command: string, parameters: Record<string, number> = {}) {
    setBusy(true);
    setNotice('');
    try {
      const response = await api.control(selectedDevice, command, controlToken, parameters);
      setNotice(`Comando ${command} enviado a ${selectedDevice}: ${response.acknowledgement.status}`);
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'No se pudo enviar el comando.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark"><Hospital size={21} /></span><span>HOSPITAL<span className="brand-light">.IOT</span></span></a>
        <div className="top-actions"><span className="live"><i /> Sistema en línea</span><button className="icon-button" onClick={() => void refresh()} aria-label="Actualizar"><RefreshCw size={17} /></button></div>
      </header>
      <section className="intro">
        <div><p className="eyebrow">CENTRO DE OPERACIONES · BOGOTÁ</p><h1>Monitoreo hospitalario</h1><p className="subheading">Telemetría, activos clínicos y gemelos digitales en un solo lugar.</p></div>
        <div className="date-chip"><Clock3 size={15} /> Actualizado {new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
      </section>
      {error && <div className="banner error"><CircleHelp size={17} /> {error} <button onClick={() => void refresh()}>Reintentar</button></div>}
      {notice && <div className="banner notice">{notice}<button onClick={() => setNotice('')}>Cerrar</button></div>}

      <section className="summary-grid">
        <article className="summary-card"><span className="summary-icon blue"><Boxes size={19} /></span><div><span className="summary-label">Dispositivos conectados</span><strong>{onlineCount}<small> / {devices.length}</small></strong></div><span className="summary-foot">Señal MQTT reciente</span></article>
        <article className="summary-card"><span className="summary-icon red"><ShieldAlert size={19} /></span><div><span className="summary-label">Alertas activas</span><strong>{activeAlerts.length}</strong></div><span className="summary-foot">Reglas de umbral IoT</span></article>
        <article className="summary-card"><span className="summary-icon green"><BedDouble size={19} /></span><div><span className="summary-label">Gemelos digitales</span><strong>{twins.length}<small> / 3</small></strong></div><span className="summary-foot">Quirófano · UCI · Farmacia</span></article>
        <article className="summary-card"><span className="summary-icon violet"><ChartNoAxesCombined size={19} /></span><div><span className="summary-label">Ventana histórica</span><strong>6<small> días</small></strong></div><span className="summary-foot">Muestras cada 5 minutos</span></article>
      </section>

      <section className="content-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><p className="eyebrow">SERIES TEMPORALES</p><h2>Explorador de métricas</h2></div><span className="soft-chip"><Activity size={14} /> Histórico</span></div>
          <div className="filters">
            <label>Dispositivo<select value={selectedDevice} onChange={(event) => setSelectedDevice(event.target.value)}>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
            <label>Variable<select value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)}>{metrics.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>Período<select value={range} onChange={(event) => setRange(event.target.value)}><option value="1h">Última hora</option><option value="6h">6 horas</option><option value="24h">24 horas</option><option value="7d">7 días</option></select></label>
          </div>
          <div className="chart-stat"><div><span>Último valor</span><strong>{currentValue == null ? '—' : `${currentValue} ${label?.unit || ''}`}</strong></div><div><span>Muestras consultadas</span><strong>{series.length}</strong></div><div><span>Agregación</span><strong>Media / 5 min</strong></div></div>
          <div className="chart-wrap">
            {chartData.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 4 }}><CartesianGrid stroke="#253249" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="time" minTickGap={45} tick={{ fill: '#8896aa', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#8896aa', fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: '#121e32', border: '1px solid #293750', borderRadius: 9, color: '#edf4ff' }} /><Line type="monotone" dataKey="value" name={label?.label} stroke="#58b9f4" strokeWidth={2} dot={false} activeDot={{ r: 4 }} /></LineChart></ResponsiveContainer> : <div className="empty-chart">Aún no hay puntos para este dispositivo y variable.<br />Espera al siguiente ciclo de telemetría.</div>}
          </div>
          <a className="grafana-link" href={window.APP_CONFIG?.grafanaUrl || 'http://localhost:3001'} target="_blank" rel="noreferrer">Abrir dashboards de Grafana <ArrowUpRight size={15} /></a>
        </article>

        <article className="panel device-panel">
          <div className="panel-heading"><div><p className="eyebrow">INVENTARIO IoT</p><h2>Dispositivos</h2></div><span className="count-chip">{devices.length} fuentes</span></div>
          <div className="device-list">{devices.map((device) => <button className={`device-row ${selectedDevice === device.id ? 'selected' : ''}`} key={device.id} onClick={() => setSelectedDevice(device.id)}><span className={`device-dot ${device.status}`} /><span className="device-info"><strong>{device.name}</strong><small>{device.type.replaceAll('-', ' ')} · {device.protocol}</small></span><span className={`status-tag ${device.status}`}>{device.status === 'online' ? 'En línea' : 'Sin señal'}</span></button>)}</div>
          <div className="device-meta"><span><i className="legend-dot online" /> En línea</span><span><i className="legend-dot offline" /> Sin señal (&gt;15 min)</span></div>
        </article>
      </section>

      <section className="lower-grid">
        <article className="panel control-panel">
          <div className="panel-heading"><div><p className="eyebrow">CANAL DE RETORNO · MQTT QoS 1</p><h2>Control remoto</h2></div><span className="soft-chip">Seleccionado: {selected?.name || '—'}</span></div>
          <p className="panel-description">Comandos auditados por API y publicados en <code>hospital/control/{selectedDevice}</code>.</p>
          <label className="token-field">Token de control (si la instalación lo requiere)<input type="password" autoComplete="off" value={controlToken} onChange={(event) => { setControlToken(event.target.value); sessionStorage.setItem('control-token', event.target.value); }} placeholder="Token configurado en CONTROL_TOKEN" /></label>
          <div className="command-buttons">{[['turn_on', 'Encender'], ['turn_off', 'Apagar'], ['restart', 'Reiniciar'], ['calibrate', 'Calibrar'], ['set_interval', 'Frecuencia: 5 min'], ['simulate_failure', 'Simular falla']].map(([value, title]) => <button key={value} disabled={busy || selectedDevice === 'historical-dataset' || selectedDevice.endsWith('-external') || selectedDevice.startsWith('twin-')} onClick={() => void sendCommand(value, value === 'set_interval' ? { intervalMs: 300000 } : {})}>{title}</button>)}</div>
          <p className="safety-note"><AlertTriangle size={15} /> Demo académica: el control actúa sobre simuladores, nunca sobre equipamiento clínico.</p>
        </article>
        <article className="panel alerts-panel">
          <div className="panel-heading"><div><p className="eyebrow">REGLAS DE UMBRAL</p><h2>Alertas recientes</h2></div><span className="count-chip">{activeAlerts.length} activas</span></div>
          <div className="alert-list">{alerts.slice(0, 6).map((alert) => <div className="alert-row" key={alert.id}><span className={`alert-icon ${alert.severity}`}><AlertTriangle size={15} /></span><div><strong>{alert.message}</strong><small>{alert.device_id} · {new Date(alert.first_seen).toLocaleString('es-CO')}</small></div><span className={`alert-status ${alert.status}`}>{alert.status === 'active' ? 'Activa' : 'Resuelta'}</span></div>)}{alerts.length === 0 && <p className="muted">Sin alertas registradas. Las reglas se activan al superar los umbrales configurados.</p>}</div>
        </article>
      </section>

      <section className="lower-grid">
        <article className="panel twins-panel">
          <div className="panel-heading"><div><p className="eyebrow">ESTADO OPERACIONAL</p><h2>Gemelos digitales</h2></div><span className="soft-chip">Snapshot MQTT</span></div>
          <div className="twin-grid">{twins.map((twin) => <div className="twin-card" key={twin.deviceId}><span className="twin-label">{devices.find((device) => device.id === twin.deviceId)?.name || twin.deviceId}</span><div>{Object.entries(twin.metrics).map(([key, value]) => <span className="twin-metric" key={key}><b>{friendly[key] || key}</b><em>{value}</em></span>)}</div><small>Actualizado {new Date(twin.timestamp).toLocaleTimeString('es-CO')}</small></div>)}{twins.length === 0 && <p className="muted">Esperando snapshots de los gemelos digitales.</p>}</div>
        </article>
        <article className="panel analytics-panel">
          <div className="panel-heading"><div><p className="eyebrow">ANALÍTICA EXPLICABLE</p><h2>Observaciones automáticas</h2></div><span className="soft-chip"><ChartNoAxesCombined size={14} /> 24 horas</span></div>
          <div className="insight-list">{insights.slice(0, 5).map((insight, index) => <div className="insight" key={`${index}-${insight.summary}`}><span><Activity size={15} /></span><p>{insight.summary}</p></div>)}{insights.length === 0 && <p className="muted">Se requieren más muestras para estimar tendencias.</p>}</div>
          <p className="safety-note"><CircleHelp size={15} /> Estadística descriptiva: no es diagnóstico ni recomendación clínica.</p>
        </article>
      </section>

      <footer><span>Hospital Inteligente IoT · Proyecto académico · Datos sintéticos</span><span><Thermometer size={14} /> No usar para atención clínica</span></footer>
    </main>
  );
}

export default App;
