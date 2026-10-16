# NOTICE — KB vendorizzata attribuzione (`attribution-kb.sqlite`)

Questo artefatto SQLite raccoglie, normalizza e vendorizza due dataset di terze parti
usati dal motore di attribuzione dispositivi (Attribution v2) per risolvere vendor,
modello e tipo di dispositivo da prefisso MAC e sysObjectID SNMP — **offline**, senza
che l'appliance debba mai contattare internet a runtime.

## Fonti

### 1. Wireshark `manuf`

- **URL:** https://www.wireshark.org/download/automated/data/manuf
- **Licenza:** GPL-2.0 (Wireshark Foundation / contributori)
- **Contenuto:** mapping prefisso MAC → vendor. Include i blocchi IEEE MA-L (24 bit),
  MA-M (28 bit) e MA-S (36 bit).
- **Tabella risultante:** `oui`

### 2. GLPI `sysobject.ids`

- **URL:** https://raw.githubusercontent.com/glpi-project/sysobject.ids/master/sysobject.ids
- **Licenza:** GPL-2.0 (progetto GLPI / FusionInventory, contributori)
- **Contenuto:** mapping sysObjectID SNMP → vendor, tipo (`NETWORKING`, `PRINTER`,
  `POWER`, `STORAGE`, `COMPUTER`, `PHONE`, `KVM`, `VIDEO`), modello.
- **Tabella risultante:** `sysobj`

Entrambi i dataset sono distribuiti **come dati** (non come codice) in questo artefatto,
con attribuzione esplicita in `kb_meta` (chiavi `source_manuf_url`, `source_manuf_license`,
`source_sysobject_url`, `source_sysobject_license`) e in questo file. Nessun codice GPL-2
è stato incorporato nel prodotto: solo dati tabellari ridistribuiti con licenza compatibile.

## Versione e data di generazione

La versione della KB (`kb_meta.version` / `kb_meta.generated_at`) è la data ISO di
generazione dell'artefatto, mostrata in UI per rendere visibile il drift rispetto alle
fonti upstream (che continuano ad aggiornarsi indipendentemente da questo repo).

## Normalizzazione sysObjectID — nota di trasparenza

`sysobject.ids` esprime l'`id` per lo più come intero **relativo** all'arco enterprise
(`14988` → `1.3.6.1.4.1.14988`), ma alcune righe portano già un OID **assoluto**
(es. `1.2.826.0.1.4616240.1.1.4500`). Lo script (`scripts/build-attribution-kb.ts`,
funzione `normalizeSysObjId`) applica questa regola:

1. id che inizia per `1.3.6.1` → già assoluto, invariato;
2. id che inizia per `1.2.` (arco iso.member-body, riconoscibile) → già assoluto, invariato;
3. altrimenti → relativo, si antepone `1.3.6.1.4.1.`.

È un'euristica sui pattern osservati nel dataset verificato il 2026-07-28, non una
regola RFC completa: un id come `1.1.1.55` (arco iso.registration-authority, in teoria
anch'esso assoluto) viene comunque trattato come relativo. Lo script stampa a ogni
build il conteggio di righe per ciascun ramo, così un cambiamento nella distribuzione
upstream è immediatamente visibile nel riepilogo di build.

## Come rigenerare l'artefatto

L'artefatto va rigenerato solo in sviluppo (mai in produzione/appliance):

```bash
# Modalità offline — usa file già scaricati in una cartella locale
# (deve contenere manuf.txt e sysobject.ids con questi nomi esatti)
tsx scripts/build-attribution-kb.ts --offline /percorso/cartella/kb

# Modalità online — scarica direttamente dai due URL sorgente sopra
tsx scripts/build-attribution-kb.ts

# Percorso di output non standard (default: data/attribution-kb.sqlite)
tsx scripts/build-attribution-kb.ts --offline /percorso/cartella/kb --out data/attribution-kb.sqlite
```

Lo script stampa un riepilogo (righe lette/scartate per fonte, righe inserite per
tabella, ramo di normalizzazione sysObjectID, dimensione finale del file) da includere
nel changelog/report della modifica quando l'artefatto viene rigenerato.

Dopo la rigenerazione: ricommittare `data/attribution-kb.sqlite` (binario, committato
volutamente — vedi Global Constraints del piano Attribution v2 Fase 2) e questo file se
è cambiata l'attribuzione.
