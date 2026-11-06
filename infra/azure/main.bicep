targetScope = 'resourceGroup'

@minLength(3)
@maxLength(6)
param namePrefix string
param location string = resourceGroup().location
param registryName string
param imageTag string = 'latest'
@secure()
param postgresAdminPassword string
param postgresAdminLogin string = 'hospitaladmin'
@secure()
param influxToken string
@secure()
param grafanaPassword string
@secure()
param controlToken string
param mqttUsername string = 'hospital-iot'
@secure()
param mqttPassword string
@secure()
param azureMapsKey string = ''
param enableDigitalTwins bool = false
param enableAppService bool = false
param dnsZoneName string = ''

var accountName = toLower('st${namePrefix}${uniqueString(resourceGroup().id)}')
var workspaceName = 'log-${namePrefix}-${uniqueString(resourceGroup().id)}'
var environmentName = 'cae-${namePrefix}'
var pgName = 'pg-${namePrefix}-${uniqueString(resourceGroup().id)}'
var vnetName = 'vnet-${namePrefix}'
var appPrefix = 'app-${namePrefix}'
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var twinsDataOwnerRoleId = 'bcd981a7-7f74-457b-83e1-cceb9e632ffe'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
  tags: { project: 'hospital-inteligente-iot' }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
  }
  tags: { project: 'hospital-inteligente-iot' }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource influxShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'influxdata'
  properties: {
    shareQuota: 100
  }
}

resource grafanaShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'grafanadata'
  properties: {
    shareQuota: 20
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: ['10.30.0.0/16']
    }
    subnets: [
      {
        name: 'aca-infrastructure'
        properties: {
          addressPrefix: '10.30.0.0/23'
          delegations: [
            {
              name: 'aca-delegation'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: '10.30.2.0/28'
          delegations: [
            {
              name: 'postgres-delegation'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
    ]
  }
}

resource acaSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-09-01' existing = {
  parent: vnet
  name: 'aca-infrastructure'
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-09-01' existing = {
  parent: vnet
  name: 'postgres'
}

resource privateDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'private.postgres.database.azure.com'
  location: 'global'
}

resource dnsVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDns
  name: 'pg-vnet-link'
  location: 'global'
  properties: {
    virtualNetwork: {
      id: vnet.id
    }
    registrationEnabled: false
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: pgName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    version: '16'
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: postgresSubnet.id
      privateDnsZoneArmResourceId: privateDns.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [dnsVnetLink]
  tags: { project: 'hospital-inteligente-iot' }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: 'hospital_iot'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource userIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${namePrefix}'
  location: location
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, userIdentity.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: userIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: acaSubnet.id
      internal: false
    }
  }
  dependsOn: [acrPull]
  tags: { project: 'hospital-inteligente-iot' }
}

var storageKey = storage.listKeys().keys[0].value
resource influxStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: containerEnvironment
  name: 'influx-data'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storageKey
      shareName: influxShare.name
      accessMode: 'ReadWrite'
    }
  }
}

resource grafanaStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: containerEnvironment
  name: 'grafana-data'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storageKey
      shareName: grafanaShare.name
      accessMode: 'ReadWrite'
    }
  }
}

resource digitalTwins 'Microsoft.DigitalTwins/digitalTwinsInstances@2023-05-31' = if (enableDigitalTwins) {
  name: 'adt-${namePrefix}-${uniqueString(resourceGroup().id)}'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
  tags: { project: 'hospital-inteligente-iot' }
}

var imageBase = '${registry.properties.loginServer}'
var registrySettings = [
  {
    server: registry.properties.loginServer
    identity: userIdentity.id
  }
]
var appIdentity = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${userIdentity.id}': {}
  }
}
var commonSecrets = concat([
  {
    name: 'influx-token'
    value: influxToken
  }
  {
    name: 'pg-password'
    value: postgresAdminPassword
  }
  {
    name: 'grafana-password'
    value: grafanaPassword
  }
  {
    name: 'control-token'
    value: controlToken
  }
  {
    name: 'mqtt-password'
    value: mqttPassword
  }
  {
    name: 'database-url'
    value: 'postgres://${postgresAdminLogin}:${postgresAdminPassword}@${postgres.name}.postgres.database.azure.com:5432/hospital_iot?sslmode=require'
  }
], empty(azureMapsKey) ? [] : [
  {
    name: 'maps-key'
    value: azureMapsKey
  }
])

resource analyticsAiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appPrefix}-ai'
  location: location
  identity: appIdentity
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      registries: registrySettings
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8000
        transport: 'http'
        allowInsecure: false
      }
    }
    template: {
      containers: [{
        name: 'analytics-ai'
        image: '${imageBase}/hospital-analytics-ai:${imageTag}'
        resources: {
          cpu: json('0.5')
          memory: '1Gi'
        }
      }]
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
  dependsOn: [acrPull, containerEnvironment]
}

resource mqttApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appPrefix}-mqtt'
  location: location
  identity: appIdentity
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      registries: registrySettings
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 1883
        transport: 'tcp'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'mqtt-password'
          value: mqttPassword
        }
      ]
    }
    template: {
      containers: [{
        name: 'mqtt'
        image: '${imageBase}/hospital-mqtt:${imageTag}'
        resources: {
          cpu: json('0.25')
          memory: '0.5Gi'
        }
        env: [
          {
            name: 'MOSQUITTO_USERNAME'
            value: mqttUsername
          }
          {
            name: 'MOSQUITTO_PASSWORD'
            secretRef: 'mqtt-password'
          }
        ]
      }]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [acrPull, containerEnvironment]
}

resource influxApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appPrefix}-influx'
  location: location
  identity: appIdentity
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      registries: registrySettings
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8086
        transport: 'http'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'influx-token'
          value: influxToken
        }
        {
          name: 'pg-password'
          value: postgresAdminPassword
        }
      ]
    }
    template: {
      containers: [{
        name: 'influxdb'
        image: '${imageBase}/hospital-influxdb:${imageTag}'
        resources: {
          cpu: json('1')
          memory: '2Gi'
        }
        env: [
          {
            name: 'DOCKER_INFLUXDB_INIT_MODE'
            value: 'setup'
          }
          {
            name: 'DOCKER_INFLUXDB_INIT_USERNAME'
            value: postgresAdminLogin
          }
          {
            name: 'DOCKER_INFLUXDB_INIT_PASSWORD'
            secretRef: 'pg-password'
          }
          {
            name: 'DOCKER_INFLUXDB_INIT_ORG'
            value: 'hospital'
          }
          {
            name: 'DOCKER_INFLUXDB_INIT_BUCKET'
            value: 'HospitalIoT'
          }
          {
            name: 'DOCKER_INFLUXDB_INIT_RETENTION'
            value: '6d'
          }
          {
            name: 'DOCKER_INFLUXDB_INIT_ADMIN_TOKEN'
            secretRef: 'influx-token'
          }
        ]
        volumeMounts: [
          {
            volumeName: 'influx-data'
            mountPath: '/var/lib/influxdb2'
          }
        ]
      }]
      volumes: [
        {
          name: 'influx-data'
          storageType: 'AzureFile'
          storageName: influxStorage.name
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [influxStorage, acrPull]
}

resource backendApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appPrefix}-backend'
  location: location
  identity: appIdentity
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      registries: registrySettings
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
      }
      secrets: commonSecrets
    }
    template: {
      containers: [{
        name: 'backend'
        image: '${imageBase}/hospital-backend:${imageTag}'
        resources: {
          cpu: json('0.5')
          memory: '1Gi'
        }
        env: concat([
          {
            name: 'PORT'
            value: '3000'
          }
          {
            name: 'MQTT_URL'
            value: 'mqtt://${mqttApp.properties.configuration.ingress.fqdn}:1883'
          }
          {
            name: 'INFLUX_URL'
            value: 'http://${influxApp.properties.configuration.ingress.fqdn}:8086'
          }
          {
            name: 'INFLUX_ORG'
            value: 'hospital'
          }
          {
            name: 'INFLUX_BUCKET'
            value: 'HospitalIoT'
          }
          {
            name: 'INFLUX_TOKEN'
            secretRef: 'influx-token'
          }
          {
            name: 'DATABASE_URL'
            secretRef: 'database-url'
          }
          {
            name: 'CONTROL_TOKEN'
            secretRef: 'control-token'
          }
          {
            name: 'AI_SERVICE_URL'
            value: 'http://${analyticsAiApp.properties.configuration.ingress.fqdn}:8000'
          }
          {
            name: 'MQTT_USERNAME'
            value: mqttUsername
          }
          {
            name: 'MQTT_PASSWORD'
            secretRef: 'mqtt-password'
          }
          {
            name: 'CORS_ORIGIN'
            value: '*'
          }
        ], empty(azureMapsKey) ? [] : [
          {
            name: 'AZURE_MAPS_KEY'
            secretRef: 'maps-key'
          }
        ], enableDigitalTwins ? [
          {
            name: 'AZURE_DIGITAL_TWINS_URL'
            value: 'https://${digitalTwins.name}.api.${location}.digitaltwins.azure.net'
          }
        ] : [])
      }]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
  dependsOn: [database, mqttApp, influxApp, analyticsAiApp, acrPull, adtWriter]
}

resource simulatorApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appPrefix}-simulator'
  location: location
  identity: appIdentity
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      registries: registrySettings
      activeRevisionsMode: 'Single'
      secrets: concat([
        {
          name: 'mqtt-password'
          value: mqttPassword
        }
      ], empty(azureMapsKey) ? [] : [
        {
          name: 'maps-key'
          value: azureMapsKey
        }
      ])
    }
    template: {
      containers: [{
        name: 'simulator'
        image: '${imageBase}/hospital-backend:${imageTag}'
        command: ['npm', 'run', 'simulate']
        resources: {
          cpu: json('0.25')
          memory: '0.5Gi'
        }
        env: concat([
          {
            name: 'MQTT_URL'
            value: 'mqtt://${mqttApp.properties.configuration.ingress.fqdn}:1883'
          }
          {
            name: 'TELEMETRY_INTERVAL_MS'
            value: '300000'
          }
          {
            name: 'HOSPITAL_LATITUDE'
            value: '4.7110'
          }
          {
            name: 'HOSPITAL_LONGITUDE'
            value: '-74.0721'
          }
          {
            name: 'MQTT_USERNAME'
            value: mqttUsername
          }
          {
            name: 'MQTT_PASSWORD'
            secretRef: 'mqtt-password'
          }
        ], empty(azureMapsKey) ? [] : [
          {
            name: 'AZURE_MAPS_KEY'
            secretRef: 'maps-key'
          }
        ])
      }]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [mqttApp, acrPull]
}

resource historySeedJob 'Microsoft.App/jobs@2025-01-01' = {
  name: '${appPrefix}-history-seed'
  location: location
  identity: appIdentity
  properties: {
    environmentId: containerEnvironment.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 3600
      replicaRetryLimit: 2
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: registrySettings
      secrets: commonSecrets
    }
    template: {
      containers: [{
        name: 'history-seed'
        image: '${imageBase}/hospital-backend:${imageTag}'
        command: ['npm', 'run', 'seed']
        resources: {
          cpu: json('0.5')
          memory: '1Gi'
        }
        env: [
          {
            name: 'INFLUX_URL'
            value: 'http://${influxApp.properties.configuration.ingress.fqdn}:8086'
          }
          {
            name: 'INFLUX_ORG'
            value: 'hospital'
          }
          {
            name: 'INFLUX_BUCKET'
            value: 'HospitalIoT'
          }
          {
            name: 'INFLUX_TOKEN'
            secretRef: 'influx-token'
          }
          {
            name: 'DATABASE_URL'
            secretRef: 'database-url'
          }
        ]
      }]
    }
  }
  dependsOn: [database, acrPull]
}

resource frontendApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appPrefix}-frontend'
  location: location
  identity: appIdentity
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      registries: registrySettings
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 80
        transport: 'http'
        allowInsecure: false
      }
    }
    template: {
      containers: [{
        name: 'frontend'
        image: '${imageBase}/hospital-frontend:${imageTag}'
        resources: {
          cpu: json('0.25')
          memory: '0.5Gi'
        }
        env: [
          {
            name: 'API_PROXY_URL'
            value: 'https://${backendApp.properties.configuration.ingress.fqdn}'
          }
          {
            name: 'GRAFANA_URL'
            value: 'https://${grafanaApp.properties.configuration.ingress.fqdn}'
          }
        ]
      }]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
  dependsOn: [backendApp, acrPull]
}

resource grafanaApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appPrefix}-grafana'
  location: location
  identity: appIdentity
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      registries: registrySettings
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'grafana-password'
          value: grafanaPassword
        }
        {
          name: 'influx-token'
          value: influxToken
        }
      ]
    }
    template: {
      containers: [{
        name: 'grafana'
        image: '${imageBase}/hospital-grafana:${imageTag}'
        resources: {
          cpu: json('0.25')
          memory: '0.5Gi'
        }
        env: [
          {
            name: 'GF_SECURITY_ADMIN_USER'
            value: 'admin'
          }
          {
            name: 'GF_SECURITY_ADMIN_PASSWORD'
            secretRef: 'grafana-password'
          }
          {
            name: 'GF_USERS_ALLOW_SIGN_UP'
            value: 'false'
          }
          {
            name: 'INFLUX_ORG'
            value: 'hospital'
          }
          {
            name: 'INFLUX_BUCKET'
            value: 'HospitalIoT'
          }
          {
            name: 'INFLUX_TOKEN'
            secretRef: 'influx-token'
          }
        ]
        volumeMounts: [
          {
            volumeName: 'grafana-data'
            mountPath: '/var/lib/grafana'
          }
        ]
      }]
      volumes: [
        {
          name: 'grafana-data'
          storageType: 'AzureFile'
          storageName: grafanaStorage.name
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [grafanaStorage, influxApp, acrPull]
}

resource adtWriter 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (enableDigitalTwins) {
  name: guid(digitalTwins.id, userIdentity.id, twinsDataOwnerRoleId)
  scope: digitalTwins
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', twinsDataOwnerRoleId)
    principalId: userIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource dnsZone 'Microsoft.Network/dnsZones@2018-05-01' = if (!empty(dnsZoneName)) {
  name: dnsZoneName
  location: 'global'
  properties: {}
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = if (enableAppService) {
  name: 'asp-${namePrefix}'
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    size: 'B1'
    family: 'B'
    capacity: 1
  }
  properties: { reserved: true }
}

resource appService 'Microsoft.Web/sites@2023-12-01' = if (enableAppService) {
  name: 'app-${namePrefix}-web-${uniqueString(resourceGroup().id)}'
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${registry.properties.loginServer}/hospital-frontend:${imageTag}'
      acrUseManagedIdentityCreds: true
      appSettings: [
        {
          name: 'API_PROXY_URL'
          value: 'https://${backendApp.properties.configuration.ingress.fqdn}'
        }
        {
          name: 'GRAFANA_URL'
          value: 'https://${grafanaApp.properties.configuration.ingress.fqdn}'
        }
        {
          name: 'WEBSITES_PORT'
          value: '80'
        }
      ]
    }
  }
  dependsOn: [appServicePlan, backendApp]
}

resource appServiceAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (enableAppService) {
  name: guid(registry.id, appService.id, 'app-service-acr-pull')
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: appService.?identity.?principalId ?? ''
    principalType: 'ServicePrincipal'
  }
}

output frontendUrl string = 'https://${frontendApp.properties.configuration.ingress.fqdn}'
output backendUrl string = 'https://${backendApp.properties.configuration.ingress.fqdn}'
output grafanaUrl string = 'https://${grafanaApp.properties.configuration.ingress.fqdn}'
output postgresHost string = '${postgres.name}.postgres.database.azure.com'
output containerRegistry string = registry.properties.loginServer
output appServiceUrl string = appService.?properties.?defaultHostName ?? 'Not deployed (set enableAppService=true)'
output dnsNameServers array = dnsZone.?properties.?nameServers ?? []
output digitalTwinsHost string = digitalTwins.?properties.?hostName ?? 'Not deployed (set enableDigitalTwins=true)'
