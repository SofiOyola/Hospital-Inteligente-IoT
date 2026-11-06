# Azure Deployment Plan

> **Status:** Ready for Validation

Generated: 2026-11-06

## 1. Project Overview

**Goal:** Deploy the existing Hospital Inteligente IoT platform, expose the web UI/API/Grafana, and seed six days of five-minute historical telemetry plus resolved synthetic alert events.

**Path:** Add Components / deploy existing project

**Workspace:** `/run/media/lks/Extra/Programacion/Iot/PARCIAL 2`

## 2. Requirements

| Attribute | Value |
|-----------|-------|
| Classification | Academic POC / development; synthetic, non-clinical data |
| Scale | Small; three continuously running Container Apps, four HTTP/on-demand apps, and one one-off seeding job |
| Budget | Cost-optimized; no hard spend cap is configured. Costs remain subscription-dependent. |
| Subscription | `Azure for Students` (`b0ad7517-a5c8-47f7-bea4-ed44f3a40979`), the only enabled/default Azure CLI subscription |
| Location | `eastus`, selected from the subscription's allowed-region policy and Azure Digital Twins availability |
| Resource group | `rg-hospital-iot-academico` (created; metadata location East US 2, app resources deploy to East US) |
| Name prefix | `hosp01` |

## 3. Components Detected

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| Web dashboard | Frontend | React + TypeScript / Nginx | `frontend/` |
| REST API and MQTT gateway | API | Node.js + Express + MQTT | `backend/` |
| Device and external-source simulation | Worker | Node.js + MQTT | `backend/src/simulator.js` |
| Anomaly analysis | API | Python + FastAPI + Isolation Forest | `analytics-ai/` |
| Historical telemetry | Time-series database | InfluxDB | `influxdb/` |
| Alert and command audit store | Relational database | PostgreSQL | `backend/src/postgres.js` |
| MQTT broker | Messaging | Eclipse Mosquitto | `mqtt/` |
| Dashboards | Observability | Grafana | `grafana/` |
| Six-day sample data loader | One-off job | Azure Container Apps Job / Node.js | `backend/src/seed-history.js` |

## 4. Recipe Selection

**Selected:** Bicep + Azure CLI deployment script.

**Rationale:** Existing, compiled Bicep templates and `infra/azure/deploy.sh` already build/push the six images and provision the project. Changing to AZD or Terraform would add unrelated migration work.

## 5. Architecture

**Stack:** Azure Container Apps, private PostgreSQL Flexible Server, Azure Storage Files, ACR, Log Analytics.

### Service Mapping

| Component | Azure Service | SKU / configuration |
|-----------|---------------|---------------------|
| API, frontend, MQTT, InfluxDB, Grafana, AI | Azure Container Apps | Consumption profile; MQTT, InfluxDB and simulator run one replica; API, frontend, Grafana and AI scale to zero and wake on demand |
| Historical loader | Azure Container Apps Job | Manual, one replica, 0.5 vCPU / 1 GiB; started after deployment |
| Alerts and command audit | PostgreSQL Flexible Server | Burstable `Standard_B1ms`, 32 GiB |
| InfluxDB and Grafana persistence | Storage Account / Azure Files | `Standard_LRS`; 100 GiB and 20 GiB shares |
| Container images | Azure Container Registry | `Basic`, admin account disabled |
| Logs | Log Analytics / Azure Monitor | `PerGB2018`, 30-day workspace retention |
| Networking | VNet, delegated PostgreSQL subnet, private DNS | ACA infrastructure `/23`, PostgreSQL `/28`; database public access disabled |
| Virtual models | Azure Digital Twins | Enabled; requires regional/resource provider availability |
| Alternate web hosting | Azure App Service | `B1`; included as requested, duplicates the frontend hosting path |
| Custom DNS | Azure DNS | Only if the user provides a domain they own; registrar delegation and TLS are separate steps |

**Security:** ACR pulls use managed identity. Database, Influx, MQTT and control credentials are generated for deployment and passed as secure parameters/secrets, not committed. MQTT, InfluxDB and AI have no public ingress. The API control endpoint requires a secret token. Synthetic data only; not for clinical use. DNS uses Azure-managed public FQDNs because no custom domain was provided. The weather endpoint uses Azure Maps when a key is available and real Open-Meteo weather otherwise.

### Six-day data behavior

The Azure deployment starts a manual ACA Job after infrastructure and images are ready. It writes 1,728 five-minute samples per modeled series across six days to the `HospitalIoT` bucket, which has six-day retention, and inserts five resolved historical incidents into PostgreSQL idempotently. The simulator then continues publishing live synthetic samples every five minutes. The history seed needs network access to InfluxDB and PostgreSQL and can take several minutes.

## 6. Provisioning Limit Checklist

Quota checks use the default subscription above and selected region `eastus`. Subscription policy allows `centralus`, `canadacentral`, `eastus`, `mexicocentral`, and `brazilsouth`; East US 2 is denied. Azure Digital Twins is available in East US; it is not available in Central US. `az resource list` found no existing planned app/database/storage resources in East US.

| Resource Type | Number to Deploy | Total After Deployment | Limit/Quota | Notes |
|---------------|-----------------|------------------------|-------------|-------|
| `Microsoft.App/managedEnvironments` | 1 | 1 in East US | 1 in East US; usage 0 | `az quota` CLI after registration; available capacity 1. |
| `Microsoft.App/containerApps` | 7 | 7 in East US | Per-environment quota | Three core replicas require 1 vCPU total; four HTTP/on-demand apps scale to zero. `az quota` does not expose the per-environment limit; inspect before activation. |
| `Microsoft.App/jobs` | 1 | 1 in East US | Per-environment quota | One short-lived 0.5-vCPU job; no numeric job quota returned by `az quota`. |
| `Microsoft.DBforPostgreSQL/flexibleServers` | 1 | 1 in East US | SKU available; numeric quota not returned | `Standard_B1ms` is in the regional SKU list; provider registered. ARM validation must confirm deploy permission/capacity. |
| `Microsoft.Network/virtualNetworks` | 1 | 1 in East US | 1,000 in East US; usage 0 | `az quota` CLI; available capacity 1,000. |
| `Microsoft.Storage/storageAccounts` | 1 | 1 in East US | 250 per region/subscription | `az quota` returned no entries. Microsoft Learn standard-account limit; current East US count is 0. |
| `Microsoft.ContainerRegistry/registries` | 1 | 1 in East US | Not returned | `az quota` has no usable entry; Basic SKU. |
| `Microsoft.OperationalInsights/workspaces` | 1 | 1 in East US | Not returned | `az quota` has no usable entry. |
| `Microsoft.Network/privateDnsZones` | 1 | 1 in East US | Not returned | `az quota` has no usable entry. |

**Status:** Container Apps environment count and VNet quota are available in East US; PostgreSQL `Standard_B1ms` is supported in the service. Subscription policy denied East US 2 and Azure Digital Twins is unavailable in Central US, so app resources are selected for East US. Required provider registration completed. The registry ARM validate/what-if passed; full deployment validation must be repeated after this regional adjustment.

**Quota references:** `az quota list`/`usage list` for Microsoft.App and Microsoft.Network; Microsoft Learn [Container Apps quotas](https://learn.microsoft.com/azure/container-apps/quotas) and [Storage account scale targets](https://learn.microsoft.com/azure/storage/common/scalability-targets-standard-account). Azure retail-pricing tool returned no prices for the exact template SKUs; do not treat this plan as a cost quote. Three Container Apps, PostgreSQL B1ms, and App Service B1 remain continuously active. No budget alert or automatic shutdown is configured.

### All validation checks pass
- [ ] Core validation: Azure CLI/authentication, Bicep build, ARM validation, and what-if
- [ ] Bicep lint review
- [ ] Azure policy validation

## 7. Execution Checklist

### Planning
- [x] Analyze existing project and IaC
- [x] Scan containers, ports, dependencies, and seed path
- [x] Compile both Bicep templates; only warnings remain
- [x] Run backend tests, Compose validation, and local end-to-end checks
- [x] Verify local seed is repeatable and inserts six-day telemetry plus five resolved synthetic events
- [x] Use the only enabled/default subscription, template region, proposed resource group and prefix; omit custom DNS because no domain was provided
- [x] Proceed under the explicit request to make the platform functional in Azure; defaults and cost/quota caveats are recorded here

### After approval
- [ ] Register required Azure resource providers and verify deployment permissions/region/SKUs/quotas
- [ ] Run ARM validation and `what-if` before provisioning
- [ ] Build and publish the six project images to ACR
- [ ] Provision the approved Bicep resources
- [ ] Start and monitor the historical-seed job until successful
- [ ] Verify six-day data, running simulator, API, public frontend, Grafana, PostgreSQL audit, and Azure Monitor
- [ ] Report deployed public URLs and any missing custom-domain/DNS work
