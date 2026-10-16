# Inventario NIS2 — DA-IPAM

## Scopo nel progetto

Modulo interno (`access: "native"`, chiave `nis2_inventory`) che abilita la
vista **Servizi / asset in ottica NIS2**: anagrafica, criticità e campi
specifici della direttiva, distinti dai campi ITAM generici. È un **toggle
nativo per tenant** (non un servizio a parte): quando spento nasconde la voce
Servizi; quando acceso espone la pagina `/services` e i campi NIS2 sugli asset.

Default **ON** per preservare la visibilità storica di `/services`; disattivabile
per i tenant che non ne hanno bisogno.

## Funzioni principali

- **Catalogo campi NIS2 vs ITAM**: sorgente unica (`inventory/nis2-fields.ts`)
  che distingue lo scope di ogni campo (`nis2` | `itam` | `system`) e la sezione
  (identificazione, ubicazione, ...); usata da export, filtri UI e validazione.
- **Vista servizi/asset**: pagine `/services` e `/services/[id]` con i campi NIS2;
  la modalità di vista inventario tiene conto del toggle
  (`inventory/inventory-view-mode.ts`).
- **Gap analysis NIS2**: evidenzia i campi mancanti/critici richiesti dalla
  direttiva (`inventory/nis2-gaps.ts`).
- **Toggle per tenant**: stato in `tenant_settings` (`nis2_inventory_enabled`),
  letto dal registry (`resolveModules`). Non richiede installazione: è
  abilita/disabilita.

## Come si usa

1. **Abilitazione**: `/settings?tab=moduli#module-nis2_inventory` (toggle). Con
   il modulo spento la voce **Servizi** sparisce dal menu; con acceso ricompare.
2. **Compilazione**: dalle pagine `/services` e dagli asset si popolano i campi
   NIS2 (anagrafica, criticità, ubicazione).
3. **Verifica gap**: la gap analysis segnala i campi NIS2 mancanti sugli asset.

## Architettura e integrazioni

- Toggle nativo via `tenant_settings.nis2_inventory_enabled` (nessun container,
  nessun servizio esterno).
- I campi NIS2 vivono sullo schema inventario del DB tenant; la distinzione
  NIS2/ITAM è centralizzata in `nis2-fields.ts` per non divergere fra UI, export
  e validazione.

## File chiave

- `src/lib/modules/registry.ts` — descrittore + toggle `nis2_inventory`
  (`getTenantSetting("nis2_inventory_enabled")`).
- `src/lib/inventory/nis2-fields.ts` — catalogo campi NIS2 vs ITAM.
- `src/lib/inventory/nis2-gaps.ts` — gap analysis.
- `src/lib/inventory/inventory-view-mode.ts` — modalità vista inventario.
- `src/app/(dashboard)/services/` — UI servizi/asset NIS2.
- `src/app/(dashboard)/inventory/`, `objects/[id]`, `discovery` — campi NIS2 sugli host.
