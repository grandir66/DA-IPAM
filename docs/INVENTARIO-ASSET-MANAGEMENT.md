# Inventario asset – Analisi e miglioramenti

Analisi comparativa con [Shelf.nu](https://github.com/Shelf-nu/shelf.nu), [GLPI](https://github.com/glpi-project/glpi) e [Snipe-IT](https://github.com/grokability/snipe-it) per uniformare e migliorare il modulo inventario di DA-IPAM.

## Contesto DA-IPAM

DA-IPAM è un **IP Address Management** con focus su:
- Reti, host, scansioni (ping, nmap, ARP)
- Device di rete (router, switch, hypervisor) con SNMP/SSH
- Mapping MAC-IP, porte switch, ARP

L'inventario è **complementare**: traccia asset collegati a `network_devices` e `hosts`, con dati di ciclo vita, ubicazione e specifiche tecniche.

---

## Shelf.nu – Modello asset

**Stack:** React Router, Prisma, PostgreSQL, Supabase.

### Modello core (semplice)
- `title`, `description`
- `status`: AVAILABLE | IN_CUSTODY | CHECKED_OUT
- `valuation` (valore monetario)
- `sequentialId` (es. SAM-0001) – identificatore leggibile per org
- `category`, `location` (entità separate)
- `tags` (array, flessibile)
- `customFields` (estensibilità)

### Cosa prendere
- **Identificatore sequenziale** – `asset_tag` o `sequentialId` per riferimento umano
- **Status chiaro** – AVAILABLE / IN_USE / IN_REPAIR / RETIRED
- **Categoria e Location** come concetti distinti
- **Note/audit** – Shelf ha Note su ogni asset

---

## GLPI – IT Asset Management

**Stack:** PHP, MySQL, ITIL-oriented.

### Modello SACM (Service Asset and Configuration Management)
- Computer, periferiche, stampanti, componenti
- **Identificatori:** asset tag, serial number, inventory number
- **Ciclo vita:** data acquisto, installazione, dismissione, garanzia, EOL
- **Ubicazione:** entità → sede → edificio → stanza
- **Assegnazione:** utente, reparto
- **Supporto:** contratto, contatto, interventi
- **Economico:** prezzo, fornitore, ordine, fattura, ammortamento
- **Compliance:** (opzionale) GDPR, audit

### Cosa prendere (essenziale per IPAM)
- **Identificazione:** asset_tag, serial_number, hostname
- **Ciclo vita:** stato, fine_garanzia, fine_supporto
- **Ubicazione:** sede, reparto, posizione_fisica (rack, U)
- **Assegnazione:** utente (opzionale)
- **Tecnico:** modello, marca, CPU, RAM, storage, OS, firmware
- **Supporto:** contratto, contatto (semplice)
- **Economico:** prezzo, fornitore (base)

### Cosa omettere (per DA-IPAM)
- Compliance dettagliata (GDPR, NIS2, audit) – troppo enterprise
- Ammortamento, centro di costo – fuori scope

---

## Snipe-IT – IT Asset & License Management

**Stack:** Laravel 11, PHP, MySQL. [13.5k stars](https://github.com/grokability/snipe-it), focalizzato su asset fisici e licenze software.

### Modello asset
- `asset_tag` (obbligatorio, univoco), `name`, `serial`, `model_id`, `status_id`
- `location_id`, `company_id`, `supplier_id`
- `assigned_to` (polimorfico: User, Location, Asset) – chi ha in carico l’asset
- `purchase_date`, `purchase_cost`, `warranty_months`, `order_number`
- `last_checkout`, `expected_checkin` – checkout/checkin
- `last_audit_date`, `next_audit_date` – audit
- `asset_eol_date`, `eol_explicit` – fine vita

### Modello licenze (più semplice di GLPI)
- **Licenza** standalone: `name`, `serial`, `seats` (numero posti), `category_id`
- `purchase_date`, `purchase_cost`, `expiration_date`, `termination_date`
- `license_name` (licensed_to), `license_email`, `manufacturer_id`, `supplier_id`
- `reassignable`, `maintained`, `min_amt` (soglia alert posti disponibili)
- **license_seats**: ogni licenza ha N “posti” (record); ogni posto può essere assegnato a:
  - `assigned_to` (user_id) – licenza assegnata a utente
  - `asset_id` – licenza assegnata a asset (es. laptop con Office)
- Posti liberi = `seats` dove `assigned_to` e `asset_id` sono null

### Differenze rispetto a GLPI
| Aspetto | GLPI | Snipe-IT |
|---------|------|----------|
| Software | Software → Version → License | Licenza standalone (senza Software/Version) |
| Assegnazione | itemtype + items_id (qualsiasi item) | license_seats con user_id o asset_id |
| Installazione | items_softwareversions (versione installata su asset) | Non presente – solo assegnazione licenza |
| Complessità | Alta | Media-bassa |

### Cosa prendere per DA-IPAM
- **Modello licenze** di Snipe-IT è più adatto: licenza senza catena Software/Version
- **license_seats** con assegnazione a asset o user – concetto chiaro
- **expiration_date**, **min_amt** per alert
- **category_id** per categorizzare licenze (Office, Antivirus, ecc.)

---

## Licenze software (GLPI)

**Shelf.nu** non gestisce licenze software: è focalizzato su asset fisici, prenotazioni e custody. Le “subscription” sono per Stripe (fatturazione utenti), non per software.

**GLPI** ha un modello completo per software e licenze:

### Catena gerarchica
```
Software → SoftwareVersion → License → Assegnazione a asset
```

### Tabelle principali

| Tabella | Ruolo |
|---------|-------|
| `glpi_softwares` | Software (nome, categoria, produttore, entity) |
| `glpi_softwarecategories` | Categorie software (gerarchiche) |
| `glpi_softwareversions` | Versione installabile (nome, OS, arch) |
| `glpi_softwarelicenses` | Licenza (software_id, scadenza, numero posti, tipo) |
| `glpi_items_softwareversions` | Installazione: versione su asset (itemtype, items_id, softwareversions_id) |
| `glpi_items_softwarelicenses` | Assegnazione licenza a asset (itemtype, items_id, softwarelicenses_id) |

### Campi licenza (GLPI)
- `number` – numero massimo di utilizzi
- `expire` – data scadenza (per alert rinnovo)
- `softwareversions_id_buy` / `softwareversions_id_use` – versione acquistata vs in uso
- `serial`, `otherserial` – codici licenza
- `softwarelicenses_id` – licenza padre (per pack/group)
- `allow_overquota` – consente superamento posti
- `softwarelicensetypes_id` – tipo (perpetua, subscription, ecc.)

### Flusso
1. Creare Software (es. “Microsoft Office”)
2. Creare SoftwareVersion (es. “2021”, “365”)
3. Creare License (numero posti, scadenza, seriale)
4. Assegnare License a Computer/asset → `glpi_items_softwarelicenses`
5. Installare Version su Computer → `glpi_items_softwareversions` (può essere collegata a una licenza)

---

## Servizi applicabili

### Due interpretazioni

**1. GLPI Service Catalog (ITIL)**  
- Non sono “servizi su un asset”
- È un catalogo di richieste utente (helpdesk)
- Form per “Richiedi installazione software”, “Segnala problema”, ecc.
- Categorie: Hardware, Software, Support
- Ogni form genera un ticket
- **Non rilevante** per DA-IPAM (non abbiamo helpdesk)

**2. Servizi di rete / applicativi su host**  
- DA-IPAM ha già `open_ports` su hosts: JSON `[{port, protocol, service, version}]` da nmap
- Es. porta 22 → ssh, 80 → http, 443 → https, 3306 → mysql
- Sono “servizi rilevati” sull’host, non licenze

### Proposta per DA-IPAM
- **Servizi rilevati**: usare `open_ports` (già presente) e migliorare la visualizzazione (es. tab “Servizi” su host/asset con porta, protocollo, servizio, versione)
- **Licenze software**: nuovo modulo (vedi sotto)

---

## Raccomandazioni per DA-IPAM

### 1. Campi essenziali (da mantenere/semplificare)

| Gruppo | Campi | Note |
|--------|-------|------|
| **Identificazione** | asset_tag, serial_number, hostname, nome_prodotto, categoria, marca, modello | Core |
| **Collegamento** | network_device_id, host_id | Link a device/host |
| **Ubicazione** | sede, reparto, posizione_fisica | Come GLPI |
| **Ciclo vita** | stato, fine_garanzia, fine_supporto, data_acquisto, data_installazione, data_dismissione | Essenziale |
| **Tecnico** | cpu, ram_gb, storage_gb, storage_tipo, sistema_operativo, versione_os, firmware_version, mac_address, ip_address | Da device/host |
| **Economico** | prezzo_acquisto, fornitore | Base |
| **Supporto** | contratto_supporto, contatto_supporto, note_tecniche | Semplice |
| **Archivio** | technical_data (JSON) | Dati raw da SNMP/Proxmox |

### 2. Campi da deprecare/nascondere (opzionali avanzati)

- `part_number`, `numero_ordine`, `numero_fattura`, `valore_attuale`, `metodo_ammortamento`, `centro_di_costo`
- `crittografia_disco`, `antivirus`, `gestito_da_mdr`, `classificazione_dati`, `in_scope_gdpr`, `in_scope_nis2`
- `ultimo_audit`, `tipo_garanzia`, `ultimo_intervento`, `prossima_manutenzione`, `vita_utile_prevista`
- `utente_assegnatario_id`, `data_assegnazione` (se non c’è gestione utenti)

Si possono tenere in DB per retrocompatibilità ma non esporli nella UI principale.

### 3. Funzionalità da aggiungere

- **Sync hosts → inventario** – ✅ implementato
- **Export CSV** – ✅ implementato
- **Licenze software** – vedi schema proposto sotto
- **Servizi rilevati** – migliorare visualizzazione `open_ports` (tab Servizi su host/asset)
- **Filtri salvati** – come Shelf (preset filtri)
- **Note su asset** – campo note con storico (opzionale)

### 6. Schema proposto: Licenze software

**Opzione A – Stile Snipe-IT (consigliata):** licenza standalone, `license_seats` con asset_type/asset_id. **Opzione B – Stile GLPI:** catena Software → License.

Modello minimale per DA-IPAM (Opzione A):

**Opzione A (Snipe-IT):**
```
licenses (name, serial, seats, category_id, expiration_date, min_amt)
  └── license_seats (license_id, asset_type, asset_id)  -- asset_id null = libero
```

**Opzione B (GLPI):**
```
software → software_licenses → license_assignments (asset_type, asset_id)
```

**Tabelle (Opzione A – più semplice):**

| Tabella | Campi principali |
|---------|------------------|
| `licenses` | id, name, serial, seats, category_id, expiration_date, purchase_cost, min_amt |
| `license_seats` | id, license_id, asset_type ('inventory_asset'\|'host'), asset_id (nullable) |

**UI:**
- Lista software con conteggio licenze e posti usati/disponibili
- Dettaglio licenza: assegnazioni a asset/host
- Da scheda asset: tab “Licenze” per vedere/aggiungere licenze assegnate
- Alert scadenza (come GLPI)

### 7. Servizi rilevati (da open_ports)

- `hosts.open_ports` contiene già `[{port, protocol, service, version}]` da nmap
- Aggiungere tab “Servizi” nella scheda host e/o asset collegato
- Mostrare tabella: porta, protocollo, servizio, versione
- Opzionale: filtri per tipo (ssh, http, mysql, ecc.)

### 4. Stati asset (uniformare)

Shelf: AVAILABLE, IN_CUSTODY, CHECKED_OUT  
GLPI: vari stati per tipo  
DA-IPAM attuale: Attivo, In magazzino, In riparazione, Dismesso, Rubato  

**Proposta:** mantenere gli stati attuali (sono chiari in italiano) ma aggiungere eventuale mapping per export.

### 5. Categorie (uniformare)

DA-IPAM: Desktop, Laptop, Server, Switch, Firewall, NAS, Stampante, VM, Licenza, Access Point, Router, Other  

Allineate a GLPI/Shelf. OK.

---

## Implementazione prioritaria

1. **Sync hosts → inventario** – API `POST /api/inventory/sync-hosts` che crea/aggiorna asset per host con model/serial
2. **Semplificare UI dettaglio** – mostrare solo campi essenziali nei tab, spostare avanzati in “Altro”
3. **Export CSV inventario** – estendere `/api/export` o creare `/api/inventory/export`
4. **Ordine campi coerente** – Identificazione → Ubicazione → Ciclo vita → Tecnico → Economico → Supporto
