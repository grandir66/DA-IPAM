/**
 * Le funzioni e i tipi che vivono SOLO in `db-tenant.ts`: la facciata `db.ts`
 * li riesporta e basta (NUC-2). Elenco unico per il cricchetto
 * (`db-facade-ratchet.test.ts`), che vieta di ridichiararli in `db.ts`, e per la
 * prova d'identità (`db-facade-als.test.ts`), che vuole lo stesso oggetto
 * funzione nei due moduli.
 *
 * Il gruppo 1a (T3-05) è stato scelto con il parser di TypeScript, non a mano:
 * funzioni esportate da entrambi i file con testo uguale dopo la
 * normalizzazione (commenti, spazi, virgolette, `getDb()` contro `db()`,
 * `prepare` contro la cache `prep`), con le funzioni e i tipi da cui dipendono
 * uguali allo stesso modo (`getSetting` della facciata è già una delega
 * all'hub, che `db-tenant` importa direttamente), e senza scritture nel
 * database, nemmeno attraverso una funzione chiamata.
 */

/** Gruppo 0 (T3-04): le quattro funzioni che mancavano in `db-tenant.ts`. */
export const SPOSTATE_GRUPPO_0 = [
  "cleanOrphanedForeignKeys",
  "updateScheduledJobInterval",
  "getStatusOverTime",
  "getRecentStatusChanges",
] as const;

/** Gruppo 1a (T3-05): 103 letture uguali nelle due copie. */
export const SPOSTATE_GRUPPO_1A = [
  "getNetworks", "getNetworksPaginated", "getDevicesPaginated", "getNetworkById",
  "getNetworkRouterBinding", "getNetworkContainingIp", "buildNetworkLookup", "getHostsByNetwork",
  "getAllHostsFlat", "getAllHosts", "getKnownHosts", "getHostBasic", "getHostByIp",
  "mergeOpenPortsJson", "getAttributionSignalsForHost", "isIpExcluded", "getExcludedIps",
  "countHostsInNetwork", "getKnownHostsWithNetwork", "getScanHistory",
  "getScanPhaseStatusForNetwork", "getAttributionCompletenessForNetwork", "getNetworkDevices",
  "getRouters", "getDhcpSources", "getArpSourceDevices", "getSwitches",
  "getDevicesByClassification", "getDevicesByClassificationOrLegacy", "getHostsByClassification",
  "getNetworkRouterId", "getAllCredentials", "getCredentialById", "getHostWindowsCredentials",
  "getHostLinuxCredentials", "getCredentialLoginPair", "getSshLinuxCredentialPair",
  "getNetworkHostCredentialIds", "getHostDetectCredentialId", "getHostDetectCredentialsEnriched",
  "getOrderedDetectCredentialIds", "getOrderedSshLinuxCredentialIds",
  "buildSnmpCommunitiesForNetwork", "buildSnmpCommunitiesForHost", "getNetworkCredentials",
  "getNetworksWithCredentials", "getHostCredentials", "getHostValidatedProtocolsByNetwork",
  "getCredentialCommunityString", "getDeviceSnmpV3Credentials", "getEffectiveSnmpPort",
  "getDeviceCommunityString", "getDeviceCredentials", "getNetworkDeviceById",
  "getNetworkDeviceByHost", "getNetworkDeviceByHostId", "getInventoryAssetById",
  "getInventoryAssetByNetworkDevice", "getDeviceIdsWithInventoryAsset", "getInventoryAssetByHost",
  "getHostIdsWithInventoryAsset", "getInventoryAssets", "getAssetAssignees",
  "getAssetAssigneeById", "getLocations", "getLocationById", "getLicenseSeatsByLicense",
  "getLicenseSeatsByAsset", "getInventoryAuditLog", "getArpEntriesByDevice",
  "getMacPortEntriesByDevice", "getSwitchPortsByDevice", "getNeighborsByDevice",
  "getRoutesByDevice", "getDeviceCredentialBindings", "getDeviceCredentialProtocolsSummary",
  "findExistingBinding", "getPrimaryBindingForProtocol", "getScheduledJobs", "getScheduledJobById",
  "getEnabledJobs", "getStatusHistory", "getHostLatencyHistory", "getKnownHostStats",
  "getOfflineKnownHosts", "getDashboardStats", "getRecentActivity", "globalSearch",
  "getOnlineCountsOverTime", "getProxmoxHosts", "getProxmoxHostById", "getAdIntegrations",
  "getAdRealm", "getAdIntegrationById", "getAdComputers", "getMultihomedStatus",
  "getMultihomedStatusByDeviceId", "getAdUsers", "getAdGroups", "getAdGroupsPaginated",
  "getAdDhcpLeasesPaginated", "getDistinctHostVendorHints", "getDhcpLeaseStats",
] as const;

/**
 * Gruppo 1b (T3-06): scritture uguali nelle due copie, le deleghe che la
 * facciata faceva già verso `db-tenant` e le funzioni con differenze solo di
 * forma (nomi di variabili, prefisso dei log, a capo, un valore calcolato in
 * linea invece che in una variabile), una voce per dominio, nell'ordine dei
 * commit. Scelte con lo stesso parser del gruppo 1a; le differenze di forma
 * sono provate col banco di parità (`db-parity/<dominio>.test.ts`) contro la
 * copia congelata della vecchia facciata. Restano fuori le 9 funzioni che
 * cambiano comportamento (T3-07) e le 3 che le chiamano.
 */
export const SPOSTATE_GRUPPO_1B: Readonly<Record<string, readonly string[]>> = {
  credenziali: [
    "createCredential", "updateCredential", "deleteCredential", "replaceNetworkHostCredentials",
    "setHostDetectCredential", "deleteHostDetectCredential", "replaceNetworkCredentials",
    "addNetworkCredential", "removeNetworkCredential", "reorderNetworkCredentials",
    "copyNetworkCredentials", "addHostCredential", "removeHostCredential", "reorderHostCredentials",
    "setHostCredentialValidated", "setHostCredentialValidatedByKey", "recordCredentialFailure",
    "recordCredentialSuccess", "getCredentialCoverageByCategory", "addDeviceCredentialBinding",
    "updateDeviceCredentialBinding", "deleteDeviceCredentialBinding", "reorderDeviceCredentialBindings",
    "updateBindingTestStatus",
  ],
  ad: [
    "createAdIntegration", "updateAdIntegration", "deleteAdIntegration", "upsertAdComputer",
    "linkAdComputerToHost", "relinkAdComputersForNetwork", "upsertAdUser", "upsertAdGroup",
    "clearAdData", "upsertAdDhcpLease", "clearAdDhcpLeases",
  ],
  dhcp: [
    "upsertDhcpLease", "syncIpAssignmentsForNetwork", "syncIpAssignmentsForAllNetworks",
    "bulkUpsertDhcpLeases", "deleteDhcpLeasesByDevice", "getDhcpLeases", "getDhcpLeasesPaginated",
    "getDhcpLeasesByDevice",
  ],
  inventario: [
    "ensureInventoryAssetForNetworkDevice", "syncInventoryFromDevice", "ensureInventoryAssetForHost",
    "syncInventoryFromHost", "createInventoryAsset", "updateInventoryAsset", "deleteInventoryAsset",
    "createAssetAssignee", "updateAssetAssignee", "deleteAssetAssignee", "createLocation",
    "updateLocation", "deleteLocation", "createLicense", "updateLicense", "deleteLicense",
    "assignLicenseSeat", "assignLicenseSeatToAssignee", "unassignLicenseSeat", "getLicenses",
    "getLicenseById",
  ],
  arp: [
    "upsertMacIpMapping", "getMacIpMappings", "upsertMacPortEntries", "upsertNeighbors", "upsertRoutes",
    "upsertSwitchPorts", "markHostsOffline",
  ],
  dispositivi: [
    "createNetworkDevice", "updateNetworkDevice", "deleteNetworkDevice", "syncDeviceToHost",
    "trackDeviceInfoChanges", "syncNetworkDeviceFromHostScan", "createScheduledJob", "updateJobLastRun",
    "toggleJob", "deleteScheduledJob", "createProxmoxHost", "updateProxmoxHost",
    "updateProxmoxHostScanResult", "deleteProxmoxHost",
  ],
  "reti e host": [
    "createNetwork", "updateNetwork", "deleteNetwork", "setNetworkTargetingMode",
    "setNetworkAssessmentConfig", "refreshHostVendorsFromMac", "updateHost", "deleteHost",
    "addToExcludedIps", "removeFromExcludedIps", "bulkUpdateHostsKnownHost", "bulkDeleteHosts",
    "noteHostsNonResponding", "addScanHistory", "setNetworkRouter", "deleteNetworkRouter",
    "addStatusHistory", "cleanupStaleHosts", "recordHostHeartbeat",
  ],
};

/**
 * Gruppo 2 (T3-07): le funzioni che nelle due copie si comportavano in modo
 * diverso. Passano alla copia tenant una per commit; il comportamento voluto è
 * provato in `db-parity/behaviour-*.test.ts`, la differenza misurata sulla copia
 * del DB DTS.
 */
export const SPOSTATE_GRUPPO_2 = [
  "upsertArpEntries",
  "getHostByMac",
  "getHostById",
  "getHostsByNetworkWithDevices",
  "recomputeMultihomedLinks",
] as const;

/** Funzioni che vivono in `db-tenant.ts`: `db.ts` le riesporta e basta. */
export const SPOSTATE: readonly string[] = [
  ...SPOSTATE_GRUPPO_0,
  ...SPOSTATE_GRUPPO_1A,
  ...Object.values(SPOSTATE_GRUPPO_1B).flat(),
  ...SPOSTATE_GRUPPO_2,
];

/** Tipi uguali nelle due copie (T3-05): `db.ts` li riesporta con `export type`. */
export const TIPI_SPOSTATI: readonly string[] = [
  "AttributionSignals", "ScanPhaseKey", "ScanPhaseStatus", "AttributionCompleteness",
  "CredentialCoverageRow", "NetworkCredentialRole", "HostDetectCredentialRole",
  "NetworkCredentialRow", "HostCredentialRow", "MacIpMappingSource", "DbNeighborEntry",
  "DbRouteEntry", "DeviceCredentialBinding", "AdIntegration", "AdComputer", "AdUser",
  "AdDhcpLease", "AdGroup",
  // Gruppo 1b (T3-06), DHCP: la copia tenant ha in più `last_seen`, che la tabella ha già.
  "DhcpLease", "DhcpLeaseWithRelations",
];
