targetScope = 'resourceGroup'

@minLength(3)
@maxLength(6)
@description('Prefijo corto, en minúsculas y único dentro del grupo de recursos.')
param namePrefix string

param location string = resourceGroup().location

var registryName = toLower('cr${namePrefix}${uniqueString(resourceGroup().id)}')

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
  tags: { project: 'hospital-inteligente-iot' }
}

output registryName string = registry.name
output loginServer string = registry.properties.loginServer
