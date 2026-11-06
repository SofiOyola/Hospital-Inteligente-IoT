# Datasets de ejemplo

El histórico principal no se versiona como un CSV gigante: `docker compose up` ejecuta `backend/src/seed-history.js` y genera 6 días de datos con una muestra cada cinco minutos (1.728 puntos por serie) en InfluxDB `HospitalIoT`.

- `eventos-ejemplo.csv`: pequeña muestra de incidentes didácticos para ilustrar el modelo.
- Los eventos completos reproducibles (corte eléctrico, aumento ocupacional, ola de calor, hueco por falla de sensor y mantenimiento) están codificados en el seed y descritos en [docs/PROYECTO.md](../docs/PROYECTO.md#19-datos-históricos-y-resultados).
- Ningún registro representa a una persona ni un dispositivo médico real.
