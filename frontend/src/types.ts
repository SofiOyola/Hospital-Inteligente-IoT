export interface Device {
  id: string;
  name: string;
  type: string;
  topic: string | null;
  variables: string[];
  protocol: string;
  status: 'online' | 'offline';
  lastSeen: string | null;
  latestMetrics: Record<string, number>;
}

export interface MetricRow {
  timestamp: string;
  value: number;
  deviceId: string;
  metric: string;
}

export interface Alert {
  id: number;
  device_id: string;
  metric: string;
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  status: 'active' | 'resolved';
  first_seen: string;
}

export interface Twin {
  deviceId: string;
  timestamp: string;
  metrics: Record<string, number>;
}

declare global {
  interface Window {
    APP_CONFIG?: { grafanaUrl?: string };
  }
}
