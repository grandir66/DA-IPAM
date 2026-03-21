# Piano: toolbar per fasi, azioni bulk, pagina monitoraggio host conosciuti

## Obiettivo

Allineare la **toolbar** della scheda rete (`network-detail-client`) alle **fasi operative** descritte dall’utente, includendo:

- Fase 1 (scoperta) e riferimento alla fase 1.5 (monitoraggio continuo host conosciuti).
- Fasi 2–4 (Nmap profilo, SNMP, rilevamento OS) come gruppi chiari.
- **Gestione selezione**: aggiunta dispositivo (singola/multipla), “spostamento” verso dispositivi, eliminazione host, **applicazione massiva** del flag **host conosciuto** (profilo monitoraggio).
- **Nuova pagina** per l’elenco degli host conosciuti con evidenza degli **irraggiungibili** (offline / non rispondenti).

---

## Stato attuale (codice)

| Esigenza | Oggi |
|----------|------|
| Fasi in toolbar | Gruppi generici: Scoperta, Dati, Rilevamento, Ricalcola — non nominano esplicitamente “Fase 1…2…3…4” |
| Aggiungi dispositivo (bulk) | Solo nella **card** quando ci sono host selezionati in lista — **non** in toolbar |
| Creare dispositivo da host | `POST /api/devices/bulk` con `host_ids` ([devices/bulk/route.ts](src/app/api/devices/bulk/route.ts)) |
| Host conosciuto | Toggle per riga (`known_host`) via `PUT /api/hosts/:id` — **nessun bulk** |
| Eliminazione host | `DELETE /api/hosts/:id` — **nessun bulk** |
| Monitoraggio host conosciuti | Job cron `known_host_check` → `runKnownHostCheck` in [jobs.ts](src/lib/cron/jobs.ts) (ping + TCP su `monitor_ports`); **nessuna pagina UI** dedicata |
| Scoperta 1.1–1.4 | Un solo flusso `network_discovery` in [discovery.ts](src/lib/scanner/discovery.ts) (ICMP → Nmap quick TCP → DNS/vendor → persistenza → ARP router) |

---

## Proposta di struttura toolbar

### Principio

Organizzare i pulsanti in **sezioni numerate/etichettate** (Fase 1 … Fase 4) + sezione **Host selezionati** sempre visibile quando `selectedHostIds.size > 0`, oppure **sempre visibile** con stato disabilitato se nessuna selezione.

Suggerimento etichette (testo in italiano, coerente con [MANUALE-UTENTE.md](MANUALE-UTENTE.md)):

1. **Fase 1 — Scoperta rete**  
   - Pulsante principale: stesso comportamento attuale “Scoperta rete” (ICMP + Nmap quick + DNS + ARP router).  
   - Tooltip lungo: elencare esplicitamente i sottopassi 1.1–1.4 *come oggi implementati* (vedi nota sotto su “senza assegnare nulla”).  
   - Link secondario o icona: **“Monitoraggio host conosciuti”** → nuova pagina (punto 1.5).

2. **Fase 2 — Nmap (profilo)**  
   - Pulsante “Nmap profilo” (comportamento attuale Nmap su selezione).

3. **Fase 3 — SNMP**  
   - Pulsante SNMP (invariato).

4. **Fase 4 — Rilevamento OS**  
   - Raggruppare: Rilevamento avanzato (sequenza WinRM+SSH), opzionalmente pulsanti separati WinRM / SSH se già esposti da API (oggi solo tramite `scan_type` da trigger).

**Dati di rete (non “fase numerata” ma utili):** ARP, DHCP, DNS in sottogruppo “Rete / ARP / DHCP / DNS” oppure sotto Fase 1 se si vuole enfatizzare ARP/DNS anche manuali.

### Sezione **Host selezionati** (toolbar o barra sticky sotto l’header)

Quando `selectedHostIds.size > 0` (vista lista):

| Azione | Implementazione |
|--------|-----------------|
| Aggiungi dispositivo | Spostare/evidenziare il flusso esistente (dialog bulk) — stesso `POST /api/devices/bulk` |
| Elimina host | Nuovo **bulk**: `DELETE` con body `{ host_ids: number[] }` protetto da `requireAdmin`, validazione che tutti gli host appartengano alla rete corrente |
| Segna come conosciuti (monitoraggio) | Nuovo **bulk**: `PATCH /api/hosts/bulk` con `{ host_ids: number[], known_host: 1 \| 0 }` oppure estensione di un endpoint esistente |
| (Opzionale) Rimuovi da conosciuti | Stesso endpoint con `known_host: 0` |

**Nota UX:** conferma modale per eliminazione bulk e per “segna tutti come conosciuti” se > N host.

---

## Nuova pagina — Monitoraggio host conosciuti (1.5)

### Route suggerita

- `(dashboard)/monitoring/known-hosts/page.tsx` **oppure** `(dashboard)/hosts/known/page.tsx`  
- Voce in **sidebar** sotto Reti / Host (da definire in [app-shell](src/components/shared/app-shell.tsx) o equivalente).

### Contenuto minimo

- Query server: elenco host con `known_host = 1` (tutte le reti o filtro per rete). Funzioni già presenti: `getKnownHosts(networkId?)` in [db.ts](src/lib/db.ts).
- Colonne: IP, nome rete, hostname, **stato** (online/offline/unknown), `last_seen`, `last_response_time_ms`, eventuale nota.
- **Evidenza visiva** per `status === 'offline'` (e opzionalmente unknown) come “irraggiungibile”.
- Link rapido alla scheda host `/hosts/:id`.

### Azione “Verifica ora”

- Opzionale: `POST /api/monitoring/known-hosts/run-check` (admin) che invoca `runKnownHostCheck(null)` o per `network_id` — **solo se** si accetta esecuzione sincrona lunga; in alternativa messaggio “schedulato dal job” se il job cron è attivo.

---

## Note di allineamento con la procedura “ideale”

1. **“1.2 senza assegnare nulla”** — Oggi la scoperta **scrive sempre** host nel DB (porte, classificazione, ecc.). Se si vuole davvero una modalità “solo probe senza persistenza”, servirebbe **nuovo `scan_type` o flag** e modifiche consistenti a [discovery.ts](src/lib/scanner/discovery.ts). Da decidere come requisito separato.

2. **Suddivisione 1.1–1.4 in quattro pulsanti separati** — Richiede **nuovi flussi** API (solo ICMP, solo Nmap quick, solo ARP, solo DNS) o orchestrazione lato client con più chiamate. Maggior costo; la toolbar può comunque **documentare** i quattro passaggi in un unico pulsante Fase 1.

3. **Monitoraggio continuo** — Già coperto dal job `known_host_check`; la **nuova pagina** rende visibile ciò che oggi è solo in DB + cron.

---

## File principali da toccare (implementazione futura)

| Area | File |
|------|------|
| Toolbar rete | [network-detail-client.tsx](src/app/(dashboard)/networks/[id]/network-detail-client.tsx) |
| API bulk host | Nuovo `src/app/api/hosts/bulk/route.ts` (PATCH known_host, DELETE) |
| Validators | [validators.ts](src/lib/validators.ts) — schema bulk |
| Pagina monitoraggio | Nuova pagina + eventuale `page.tsx` server che chiama `getKnownHosts` |
| Sidebar | Componente layout / navigazione |
| Versione | `npm run version:bump` dopo modifiche |

---

## Ordine di implementazione suggerito

1. API `PATCH/DELETE` bulk host + test manuali.
2. Nuova pagina monitoraggio host conosciuti + link sidebar.
3. Ristrutturazione toolbar (etichette fasi + sezione selezione con azioni bulk).
4. (Opzionale) Endpoint “run check” noto host.
5. (Opzionale futuro) Scan parziali Fase 1 o modalità “non persistere”.

---

*Documento di piano — aggiornare in base a decisioni prodotto.*
