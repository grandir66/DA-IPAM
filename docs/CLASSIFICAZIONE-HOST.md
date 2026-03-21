# Classificazione host: come funziona

Questo documento riassume **dove** e **in che ordine** viene assegnata la classificazione (`hosts.classification`) e perché a volte non coincide con ciò che vedi come “tipo rilevato” nella colonna **Rilevato** o nel fingerprint.

## 1. Due “mondi” di regole

| Origine | Quando entra in gioco | Cosa usa |
|--------|------------------------|----------|
| **Regole classiche** (`classifyDevice` in `src/lib/device-classifier.ts`) | Sempre come base | OID SNMP, testo sysDescr/os_info, porte, hostname, vendor MAC, contesto SNMP |
| **Fingerprint** (`detection_json`, `final_device`) | Dopo scan con fingerprint abilitato | Firme porte, banner HTTP/SSH, SNMP, ecc. (`src/lib/scanner/device-fingerprint.ts`) |

La classificazione **finale in scansione** (discovery) è:

1. **Regole manuali** (tabella `fingerprint_classification_map` in Impostazioni): match **exact** o **contains** sul valore `final_device`, ordinate per **priorità** (numero più basso = applicata prima).
2. **Mappa integrata** + euristiche in `src/lib/device-fingerprint-classification.ts` (es. `Proxmox VE` → `hypervisor`).
3. Se il fingerprint non propone nulla (confidenza &lt; soglia o tipo sconosciuto): si usa solo **`classifyDevice`** sui dati SNMP/porte/vendor.

La **soglia di confidenza** fingerprint per usare il ramo “rilevato → classificazione” è `0.72` (`FINGERPRINT_CLASSIFICATION_MIN_CONFIDENCE`).

## 2. Perché possono esserci errori

- **`final_device`** è un’etichetta testuale (es. `Linux generico`, `Proxmox VE`): la mappa hardcoded può non coprire tutte le varianti o può essere troppo generica (es. Linux su appliance vs server).
- **Ordine delle regole** in `classifyDevice`: la prima regex/testo che matcha vince (es. “server” prima di un caso più specifico).
- **Porte**: classificazioni deboli (es. solo SNMP) o conflitti tra regole porta.
- **MAC virtuali** (VMware/Proxmox): ramo dedicato che può dare `server_linux` / `vm` invece di `hypervisor` se mancano indizi testuali.
- **Fingerprint disattivato** o probe limitati (troppi host online): meno dati, classificazione meno precisa.
- **Classificazione manuale** (`classification_manual`): non viene sovrascritta da `upsertHost` salvo “Forza” in refresh.

## 3. Regole manuali (Impostazioni)

Nella pagina **Impostazioni**, scheda **Fingerprint**, puoi gestire la tabella **Regole fingerprint → classificazione** (API `/api/fingerprint-classification-map`):

- **Exact**: il testo `final_device` deve coincidere (confronto case-insensitive).
- **Contains**: una sottostringa nel `final_device` (utile per varianti non previste dal codice).

Le regole attive hanno priorità sulla mappa integrata. Così puoi correggere in modo **umano** i casi limite senza modificare il codice.

## 4. Ricalcolo

- **Ricalcola** sulla rete: riapplica `classifyDevice` + eventuale mapping da `detection_json` (vedi `src/app/api/networks/[id]/refresh/route.ts`).

## 5. File principali

| File | Ruolo |
|------|--------|
| `src/lib/device-classifier.ts` | Regex, OID, porte, hostname, vendor |
| `src/lib/device-fingerprint.ts` | Calcolo `final_device` / `final_confidence` |
| `src/lib/device-fingerprint-classification.ts` | Mapping fingerprint → slug + parsing per UI |
| `src/lib/scanner/discovery.ts` | Unione regole in fase di persistenza host |
| `src/lib/db.ts` | Tabella `fingerprint_classification_map` |
