# Dati di sicurezza AD da DA-IPAM a DA-Vul-can — valutazione

**Data:** 2026-10-21 · **Stato:** valutazione da discutere con Riccardo, niente da costruire ·
**Richiesta:** idea di Riccardo del 20/10 (`DA-Vul-can/TASKS.md`).

## Cosa c'è già (verificato il 21/10)

- **DA-IPAM ha il motore AD Health** (specifica DA-Vul-can `2026-07-25-ad-health-edge-design.md`,
  «home MVP = DA-IPAM», più le spec DA-IPAM del 25-26/07: nativo, ACL, LDAP+WinRM). Codice in
  `src/lib/ad/health/`; tabelle `ad_health_runs`/`ad_health_findings` nel DB del cliente.
  Sull'hub 70791: 8 esecuzioni (l'ultima il 20/10 alle 10:17 italiane, «ok»), 161 rilievi.
- **L'export esiste già**: `src/lib/ad/health/export.ts` → JSON `source: "domarc-ad-health"` (punteggi
  sui 4 assi + rilievi con severità, CVSS convenzionale, id della regola), servito da
  `GET /api/ad/healthcheck/export`. È un **download**: nessuno lo spinge verso l'hub.
- **DA-Vul-can sa leggere PingCastle** (`src/lib/parser/pingcastle.ts`, caricamento a mano), ma
  **non ha un lettore per `domarc-ad-health`**.
- Il ramo `feat/ad-health-ingest` **non esiste più**, né in DA-IPAM né in DA-Vul-can: se c'era
  codice, non è su nessun remote.

## Cosa manca

1. In DA-Vul-can un lettore `domarc-ad-health` (come quello di PingCastle: rilievi → righe del report,
   «host» = dominio).
2. Una strada di consegna automatica. Tre possibilità:
   - **A. Caricamento a mano** (export da DA-IPAM, upload in DA-Vul-can). Zero lavoro di rete, serve solo
     il lettore. Buono per provare il valore nei documenti.
   - **B. DA-IPAM spinge all'hub DA-Vul-can** dopo ogni esecuzione. Serve una credenziale per istanza e
     una porta in più verso l'hub: con NetBird va dichiarata una policy nuova (`remoto-ipam` →
     hub VA) e passa da DA-Link.
   - **C. Passa dall'edge**, che già spinge ZIP cifrati all'hub con coda e backoff. DA-IPAM deposita
     l'export sulla sonda locale, l'edge lo manda insieme alle scansioni. Nessuna policy nuova; la
     specifica di luglio lo prevedeva come «fase 2».

## Consiglio

Prima **A**: solo il lettore in DA-Vul-can, poche ore, e si vede subito se i rilievi AD servono nel
documento per la Direzione (che Riccardo vuole unire ai rilievi dell'edge e all'OSINT). Se servono,
poi **C**, perché riusa una strada già sicura e già sorvegliata. B aggiunge un flusso di rete e una
credenziale per cliente senza un vantaggio chiaro.

## Da decidere con Riccardo

- Si parte da A (lettore + caricamento a mano) su un cliente pilota? Quale (hub 70791 ha già i dati)?
- Nei documenti delle analisi periodiche i rilievi AD vanno in una sezione a sé o mescolati per gravità?
- I rilievi «diagnostici» (qualità della raccolta, CVSS 0) vanno esclusi dal documento?
