# Libreria OID SNMP (file esterni)

Cartella opzionale per **template OID** versionabili e aggiornabili senza toccare il database dall’interfaccia per ogni dettaglio.

## Struttura

| Percorso | Ruolo |
|----------|--------|
| `common.json` | **OID fondamentali** di riferimento (MIB-II, ENTITY-MIB, …). Consultazione e documentazione; non sostituisce i GET standard del motore SNMP. |
| `categories/<classificazione>.json` | OID **condivisi** da tutti i profili con quella *categoria* (es. `storage.json`, `firewall.json`). |
| `devices/<profile_id>.json` | OID **specifici del profilo** (elenchi lunghi, walk mirati). Il nome file deve coincidere con `profile_id` nel DB (es. `synology.json`). |

## Ordine di merge (dal meno al più specifico)

1. Campi salvati nel profilo (database / UI)  
2. `categories/<category>.json` → `fields`  
3. `devices/<profile_id>.json` → `device_specific`  

In caso di stessa chiave, vince il livello più specifico (il file `devices/` vince su tutto).

## Aggiornare l’elenco

Aggiungendo o rimuovendo un file `.json` in `categories/` o `devices/`, l’elenco in **Impostazioni → Profili SNMP** si aggiorna al ricaricamento della pagina (la cache profili considera la revisione dei file).

## Esempi

- `devices/synology.example.json` — modello da copiare in `synology.json`.  
- File che terminano con `.example.json` non vengono usati per il merge.

## Esportazione dal database

Da **Impostazioni → Profili SNMP** usa **«Esporta in cartelle»** (admin): viene creata una cartella sotto `data/snmp-oid-export-<timestamp>/` con:

- `devices/<profile_id>.json` — stesso formato della libreria (`device_specific` = OID salvati nel DB)
- `profiles_complete/` — snapshot completo di ogni profilo (backup)
- `categories/<classificazione>.json` — elenco `profile_id` per categoria
- `manifest.json` e `README.txt`

La cartella `data/` è in `.gitignore`. I file operativi (`common.json`, `categories/*.json`, `devices/<profilo>.json` tranne `*.example.json`) **non vanno committati** nel repository Git: restano sul server o sulla postazione di lavoro. Nel repo ci sono solo questo README e i modelli `*.example.json`.

## Sicurezza

Solo processi sul server leggono questi file. Modificare i JSON richiede accesso al filesystem del deploy. Non inserire in Git elenchi OID o profili legati alla tua rete interna.
