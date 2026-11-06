import type { Alert, Device, MetricRow, Twin } from './types';

const API_URL = import.meta.env.VITE_API_URL || '';

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `API HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  devices: () => get<Device[]>('/devices'),
  alerts: () => get<Alert[]>('/alerts?limit=50'),
  twins: () => get<Twin[]>('/twins'),
  analytics: () => get<{ insights: Array<{ summary: string; metric?: string }> }>('/analytics'),
  metrics: (deviceId: string, metric: string, range: string) =>
    get<{ series: MetricRow[] }>(`/metrics?deviceId=${encodeURIComponent(deviceId)}&metric=${encodeURIComponent(metric)}&range=${range}`),
  control: async (deviceId: string, command: string, token: string, parameters: Record<string, number> = {}) => {
    const response = await fetch(`${API_URL}/api/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ deviceId, command, parameters })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `API HTTP ${response.status}`);
    return body;
  }
};
