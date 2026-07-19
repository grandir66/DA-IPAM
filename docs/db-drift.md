# Drift `db.ts` ↔ `db-tenant.ts`

> Generato da `scripts/audit-db-drift.ts` · funzioni omonime: **211** · DRIFTATE: **75**
> Le driftate hanno corpo diverso (oltre a getDb/db, commenti, spazi) → candidate a bug latenti.

## Funzioni DRIFTATE (da riconciliare / verificare)

| Funzione | righe db.ts | righe db-tenant.ts | Δ righe |
|---|---|---|---|
| `getDeviceIdsWithInventoryAsset` | 7 | 115 | 108 |
| `syncNetworkDeviceFromHostScan` | 152 | 63 | 89 |
| `syncInventoryFromDevice` | 109 | 27 | 82 |
| `ensureInventoryAssetForNetworkDevice` | 87 | 13 | 74 |
| `relinkAdComputersForNetwork` | 147 | 86 | 61 |
| `upsertDhcpLease` | 66 | 9 | 57 |
| `upsertAdUser` | 52 | 5 | 47 |
| `getDhcpLeaseStats` | 62 | 15 | 47 |
| `createInventoryAsset` | 86 | 40 | 46 |
| `upsertAdComputer` | 51 | 5 | 46 |
| `recomputeMultihomedLinks` | 168 | 125 | 43 |
| `upsertArpEntries` | 43 | 81 | 38 |
| `upsertAdDhcpLease` | 41 | 7 | 34 |
| `getDhcpLeasesPaginated` | 59 | 27 | 32 |
| `upsertAdGroup` | 33 | 5 | 28 |
| `mergeOpenPortsJson` | 43 | 18 | 25 |
| `createAdIntegration` | 31 | 6 | 25 |
| `bulkUpsertDhcpLeases` | 40 | 18 | 22 |
| `upsertSwitchPorts` | 26 | 47 | 21 |
| `updateAdIntegration` | 34 | 14 | 20 |
| `getHostIdsWithInventoryAsset` | 24 | 6 | 18 |
| `getHostsByNetworkWithDevices` | 61 | 77 | 16 |
| `getCredentialLoginPair` | 31 | 15 | 16 |
| `getMacIpMappings` | 53 | 37 | 16 |
| `createLicense` | 28 | 12 | 16 |
| `recordHostHeartbeat` | 10 | 25 | 15 |
| `getSshLinuxCredentialPair` | 13 | 26 | 13 |
| `clearAdDhcpLeases` | 25 | 12 | 13 |
| `getDhcpLeases` | 18 | 5 | 13 |
| `syncIpAssignmentsForNetwork` | 37 | 26 | 11 |
| `createProxmoxHost` | 18 | 8 | 10 |
| `getHostByMac` | 8 | 17 | 9 |
| `upsertHost` | 224 | 233 | 9 |
| `upsertMacPortEntries` | 19 | 28 | 9 |
| `deleteNetworkDevice` | 12 | 5 | 7 |
| `getScheduledJobs` | 6 | 12 | 6 |
| `addStatusHistory` | 9 | 15 | 6 |
| `updateProxmoxHost` | 22 | 16 | 6 |
| `getAdComputersPaginated` | 18 | 12 | 6 |
| `getAdUsersPaginated` | 18 | 12 | 6 |
| `deleteProxmoxHost` | 10 | 15 | 5 |
| `createNetwork` | 45 | 41 | 4 |
| `getHostsByNetwork` | 10 | 7 | 3 |
| `getKnownHosts` | 11 | 8 | 3 |
| `getOrderedDetectCredentialIds` | 15 | 12 | 3 |
| `getOrderedSshLinuxCredentialIds` | 21 | 18 | 3 |
| `getLicenses` | 15 | 12 | 3 |
| `getOnlineCountsOverTime` | 29 | 32 | 3 |
| `deleteHost` | 21 | 19 | 2 |
| `replaceNetworkHostCredentials` | 31 | 29 | 2 |
| `upsertNeighbors` | 29 | 31 | 2 |
| `resetConfiguration` | 41 | 43 | 2 |
| `getAdRealm` | 9 | 7 | 2 |
| `deleteAdIntegration` | 7 | 5 | 2 |
| `getHostById` | 96 | 95 | 1 |
| `bulkDeleteHosts` | 26 | 25 | 1 |
| `noteHostsNonResponding` | 32 | 31 | 1 |
| `getHostWindowsCredentials` | 15 | 16 | 1 |
| `replaceNetworkCredentials` | 20 | 19 | 1 |
| `addNetworkCredential` | 12 | 11 | 1 |
| `reorderNetworkCredentials` | 12 | 11 | 1 |
| `copyNetworkCredentials` | 26 | 25 | 1 |
| `addHostCredential` | 27 | 26 | 1 |
| `setHostCredentialValidatedByKey` | 29 | 28 | 1 |
| `syncInventoryFromHost` | 23 | 24 | 1 |
| `getLicenseById` | 14 | 13 | 1 |
| `addDeviceCredentialBinding` | 41 | 40 | 1 |
| `deleteDhcpLeasesByDevice` | 6 | 5 | 1 |
| `getHostLinuxCredentials` | 15 | 15 | 0 |
| `getNetworkDeviceByHostId` | 14 | 14 | 0 |
| `upsertMacIpMapping` | 72 | 72 | 0 |
| `upsertRoutes` | 27 | 27 | 0 |
| `reorderDeviceCredentialBindings` | 11 | 11 | 0 |
| `getScheduledJobById` | 5 | 5 | 0 |
| `getEnabledJobs` | 5 | 5 | 0 |
