# Drift `db.ts` ↔ `db-tenant.ts`

> Generato da `scripts/audit-db-drift.ts` · funzioni omonime: **211** · DRIFTATE: **41**
> Le driftate hanno corpo diverso (oltre a getDb/db, commenti, spazi) → candidate a bug latenti.

## Funzioni DRIFTATE (da riconciliare / verificare)

| Funzione | righe db.ts | righe db-tenant.ts | Δ righe |
|---|---|---|---|
| `createInventoryAsset` | 84 | 38 | 46 |
| `upsertSwitchPorts` | 7 | 45 | 38 |
| `syncInventoryFromDevice` | 46 | 25 | 21 |
| `upsertDhcpLease` | 19 | 1 | 18 |
| `updateAdIntegration` | 18 | 1 | 17 |
| `recordHostHeartbeat` | 8 | 23 | 15 |
| `upsertAdComputer` | 15 | 1 | 14 |
| `upsertAdUser` | 15 | 1 | 14 |
| `getHostById` | 80 | 93 | 13 |
| `getDhcpLeases` | 16 | 3 | 13 |
| `bulkUpsertDhcpLeases` | 14 | 1 | 13 |
| `createAdIntegration` | 12 | 1 | 11 |
| `getHostByMac` | 5 | 15 | 10 |
| `upsertAdDhcpLease` | 11 | 1 | 10 |
| `syncIpAssignmentsForNetwork` | 34 | 24 | 10 |
| `syncInventoryFromHost` | 21 | 13 | 8 |
| `upsertAdGroup` | 9 | 1 | 8 |
| `resetConfiguration` | 35 | 41 | 6 |
| `updateProxmoxHost` | 7 | 1 | 6 |
| `createProxmoxHost` | 6 | 1 | 5 |
| `createNetwork` | 43 | 39 | 4 |
| `getDhcpLeaseStats` | 5 | 1 | 4 |
| `getHostsByNetwork` | 7 | 5 | 2 |
| `noteHostsNonResponding` | 26 | 25 | 1 |
| `getOrderedDetectCredentialIds` | 9 | 10 | 1 |
| `getOrderedSshLinuxCredentialIds` | 15 | 16 | 1 |
| `getScheduledJobs` | 3 | 4 | 1 |
| `deleteAdIntegration` | 4 | 3 | 1 |
| `deleteDhcpLeasesByDevice` | 4 | 3 | 1 |
| `getHostsByNetworkWithDevices` | 6 | 6 | 0 |
| `replaceNetworkHostCredentials` | 25 | 25 | 0 |
| `replaceNetworkCredentials` | 17 | 17 | 0 |
| `addNetworkCredential` | 9 | 9 | 0 |
| `reorderNetworkCredentials` | 9 | 9 | 0 |
| `copyNetworkCredentials` | 23 | 23 | 0 |
| `getMacIpMappings` | 6 | 6 | 0 |
| `reorderDeviceCredentialBindings` | 9 | 9 | 0 |
| `getScheduledJobById` | 3 | 3 | 0 |
| `getEnabledJobs` | 3 | 3 | 0 |
| `addStatusHistory` | 5 | 5 | 0 |
| `recomputeMultihomedLinks` | 1 | 1 | 0 |
