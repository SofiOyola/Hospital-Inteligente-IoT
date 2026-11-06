from datetime import datetime, timezone
from typing import Literal

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sklearn.ensemble import IsolationForest

app = FastAPI(
    title="Hospital IoT Anomaly Analysis",
    version="1.0.0",
    description="Detección académica de anomalías en series sintéticas. No es diagnóstico clínico.",
)


class Sample(BaseModel):
    timestamp: datetime
    value: float


class Series(BaseModel):
    deviceId: str
    metric: str
    samples: list[Sample] = Field(max_length=10000)


class AnalysisRequest(BaseModel):
    series: list[Series] = Field(max_length=500)


METRIC_LABELS = {
    "heartRate": "frecuencia cardíaca",
    "oxygen": "saturación de oxígeno",
    "temperature": "temperatura",
    "co2": "CO₂",
    "humidity": "humedad",
}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze")
def analyze(payload: AnalysisRequest) -> dict:
    anomalies = []
    analyzed_series = 0
    for series in payload.series:
        values = np.asarray([sample.value for sample in series.samples], dtype=float)
        if values.size < 12 or not np.isfinite(values).all() or np.ptp(values) == 0:
            continue
        model = IsolationForest(
            n_estimators=100,
            contamination=0.03,
            random_state=42,
        )
        predictions = model.fit_predict(values.reshape(-1, 1))
        analyzed_series += 1
        outlier_indexes = np.flatnonzero(predictions == -1)
        if not outlier_indexes.size:
            continue
        timestamps = [series.samples[index].timestamp for index in outlier_indexes]
        start = min(timestamps).astimezone(timezone.utc).isoformat()
        end = max(timestamps).astimezone(timezone.utc).isoformat()
        metric_label = METRIC_LABELS.get(series.metric, series.metric)
        anomalies.append({
            "deviceId": series.deviceId,
            "metric": series.metric,
            "anomalyCount": int(outlier_indexes.size),
            "start": start,
            "end": end,
            "values": [float(values[index]) for index in outlier_indexes[:10]],
            "summary": (
                f"Isolation Forest detectó {outlier_indexes.size} posibles valores atípicos "
                f"de {metric_label} en {series.deviceId}, entre {start} y {end}."
            ),
        })
    return {
        "model": "IsolationForest",
        "modelVersion": "scikit-learn-1.6",
        "contamination": 0.03,
        "analyzedAt": datetime.now(timezone.utc).isoformat(),
        "analyzedSeries": analyzed_series,
        "anomalies": anomalies,
        "disclaimer": "Señales sintéticas para fines académicos; revisar contexto y validar sensores. No apoyar decisiones clínicas.",
    }
