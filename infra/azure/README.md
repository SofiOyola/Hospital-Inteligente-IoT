# Despliegue en Azure

La infraestructura se define en Bicep. No se ha ejecutado y no existe una URL pública hasta que el propietario autorice el despliegue. Antes de continuar, valida suscripción/tenant, cuota regional, costos, políticas de red y tratamiento de secretos.

## Recursos incluidos

| Servicio | Uso | Exposición |
|---|---|---|
| Azure Container Apps | Backend, frontend, Mosquitto, InfluxDB, Grafana y servicio IA | HTTPS público para UI/API/Grafana; MQTT/Influx/IA privados |
| Azure Database for PostgreSQL Flexible Server | Alertas y auditoría | Subnet delegada privada; puerto no público |
| Azure Storage / Azure Files | Datos persistentes InfluxDB y Grafana | Sin acceso anónimo |
| Azure Container Registry | Imágenes de servicios | Pull mediante User Assigned Managed Identity + AcrPull |
| Azure Monitor / Log Analytics | Logs de consola | Workspace en el resource group |
| Azure Digital Twins | Espejos virtuales DTDL | Habilitado por defecto; puede deshabilitarse |
| Azure Maps Weather | Proveedor de clima | Opcional; Azure Maps key como secreto; Open-Meteo es fallback |
| Azure DNS | Zona para un dominio que ya poseas | Opcional; requiere delegar nameservers |
| Azure App Service | Variante adicional para alojar el frontend | SKU B1 habilitado por defecto; Container Apps sigue siendo el camino principal |

El servidor PostgreSQL usa una contraseña en la URL de conexión almacenada como secreto de Container Apps. Escoge una contraseña fuerte compatible con URL (evita `@`, `/`, `?`, `#`, `%` para esta plantilla), o aplica codificación URL y actualiza `dbUrl` antes de desplegar. No guardes parámetros secretos en Git.

## Pre-requisitos

- Suscripción Azure con permisos para crear Container Apps, VNet/subnets, PostgreSQL Flexible Server, ACR, Storage, Log Analytics y asignaciones RBAC.
- Azure CLI, extensión Bicep incluida en `az`, y `jq`.
- Región compatible con los SKUs y servicios habilitados.
- Secretos fuertes administrados fuera del repositorio.
- Cuenta con cuota para PostgreSQL y Container Apps.

1. Inicia sesión con `az login` y confirma el tenant y la suscripción.
2. Lee el template [main.bicep](./main.bicep) y comprueba el costo estimado.
3. Define las variables secretas en tu terminal o en un gestor seguro:

```bash
export AZURE_SUBSCRIPTION_ID='00000000-0000-0000-0000-000000000000'
export RESOURCE_GROUP='rg-hospital-iot-academico'
export NAME_PREFIX='hosp01' # 3-6 caracteres en minúsculas/números
export LOCATION='eastus'
export POSTGRES_ADMIN_PASSWORD='HospIoT_2026_ReplaceMe'
export INFLUX_TOKEN='replace-with-long-random-influx-token'
export GRAFANA_PASSWORD='replace-with-strong-grafana-password'
export CONTROL_TOKEN='replace-with-long-random-control-token'
export MQTT_PASSWORD='replace-with-strong-broker-password'
export MQTT_USERNAME='hospital-iot'
export AZURE_MAPS_KEY='' # opcional, generar Azure Maps key en Key Vault/portal
export ENABLE_DIGITAL_TWINS=true
export ENABLE_APP_SERVICE=true
export DNS_ZONE_NAME='' # dominio propio, por ejemplo example.edu
```

No uses los valores de ejemplo en un entorno accesible públicamente. Para producir tokens aleatorios utiliza un gestor de secretos o generador aprobado de tu plataforma, sin copiarlos a archivos versionados.

4. Ejecuta desde la raíz del proyecto:

```bash
./infra/azure/deploy.sh
```

El script crea ACR, construye y publica seis imágenes sin habilitar el usuario admin del registry y luego aplica Bicep. Al final inicia el job `history-seed` para poblar seis días de datos y alertas sintéticas; su ejecución puede tardar varios minutos. Los parámetros sensibles se escriben en un archivo temporal con permisos restringidos y se eliminan al terminar. No habilites tracing de shell ni guardes la salida de depuración de Azure CLI donde otros usuarios puedan leerla.

Las URLs emitidas pueden consultarse con:

```bash
az deployment group show \
  --resource-group "$RESOURCE_GROUP" \
  --name hospital-iot-platform \
  --query properties.outputs \
  --output json
```

Las salidas `frontendUrl`, `backendUrl` y `grafanaUrl` son los FQDN HTTPS que Azure asigna en el despliegue. La API de control requiere `CONTROL_TOKEN`; introdúcelo en el panel para usar comandos. Grafana requiere usuario `admin` y la contraseña de despliegue.

## DNS propio

Al usar `DNS_ZONE_NAME`, el template crea una zona DNS pública y devuelve nameservers. Actualiza el registrar del dominio para delegarla, crea records para la app y configura/verifica certificado TLS y dominio personalizado según las instrucciones de Azure Container Apps/App Service. La plantilla **no** puede demostrar propiedad del dominio ni emitir un certificado para un dominio arbitrario; no compartas HTTP sin TLS.

## Azure Digital Twins

Digital Twins se crea por defecto. El backend sube modelos DTDL de quirófano/UCI/farmacia con managed identity y crea/actualiza los twins cuando recibe su primera muestra. `AZURE_DIGITAL_TWINS_URL` se inyecta como endpoint de la instancia. El rol `Azure Digital Twins Data Owner` se asigna a una identidad administrada del entorno. Comprueba en Azure Portal que la región seleccionada tenga soporte y que la propagación RBAC haya terminado.

## Azure App Service opcional

App Service B1 se despliega por defecto como variante del frontend desde la misma imagen, con reverse proxy hacia el backend Container Apps. Se conserva Container Apps como endpoint principal. La URL de App Service se muestra en `appServiceUrl`; no se crea un dominio personalizado automáticamente. La API meteorológica usa Azure Maps si existe `AZURE_MAPS_KEY`; si no, usa condiciones reales de Open-Meteo. Azure DNS personalizado requiere un dominio propio; sin dominio se usan los FQDN HTTPS de Azure.

## Validación y limpieza

- API: `https://<backend>/api/health`, Swagger: `https://<backend>/docs`.
- Frontend: `frontendUrl`.
- Grafana: `grafanaUrl`.
- Revisa `ContainerAppConsoleLogs_CL` y los logs de PostgreSQL antes de evaluar métricas.
- Verifica que broker, InfluxDB y PostgreSQL no queden expuestos públicamente.
- Elimina el resource group solo cuando hayas confirmado que no contiene recursos o datos que deban preservarse; la eliminación borra DB, histórico, dashboards persistidos y configuración.

El flujo de almacenamiento de InfluxDB en Azure Files es para validación académica de baja carga. Para uso productivo evalúa Azure Managed Grafana, una oferta InfluxDB administrada, estrategia de backup/restore, alta disponibilidad, redundancia zonal, alarmas cloud, retención y control de cambios.
