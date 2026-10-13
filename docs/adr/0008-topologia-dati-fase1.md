# ADR 0008 — Dati della mappa: i vicini invecchiano, non si cancellano

**Stato:** Accepted (supera in parte l'ADR 0003 e due limiti dell'ADR 0005)
**Data:** 2026-10-13
**Autore:** Riccardo Grandi, con Claude

## Contesto

La spec v2 della mappa (`docs/superpowers/specs/2026-10-12-topology-map-design.md`, §2) parte da una
misura sul dato vero di DTS: su 88 vicini letti dagli apparati, la mappa vecchia ne disegnava 16
come collegamento fra apparati. Gli altri erano doppi (lo stesso collegamento visto da due lati e
da due fonti), vicini che non si abbinavano a nessun apparato, oppure scomparivano perché ogni
lettura cancellava le righe della precedente. In più la lettura UniFi sa a chi è attaccato ogni
apparato (`uplink`), e quel dato veniva buttato.

La spec chiede linee che non spariscono ma diventano «non visto da N giorni», e un modello
calcolato dai dati, non disegnato a mano.

Misura sulle copie del 13/10 (`scripts/misura-topologia.ts`):

| | hub | DTS |
|---|---|---|
| collegamenti fra apparati, mappa vecchia | 14 | 75 |
| collegamenti fra apparati, modello nuovo | 20 | 78 |
| apparati isolati | 28 → 22 | 10 |
| host fusi con l'apparato | 58 | 77 |
| uplink UniFi salvati dalla lettura | 14 | 70 |
| collegamenti «non visti» | n.d. | 28 |
| tempo per calcolare il modello | ~10 ms | ~10 ms |

La migrazione dello schema è durata ~50-60 ms su entrambe, `integrity_check` ok.

## Decisione

**I vicini non si cancellano più: si aggiornano, invecchiano e dopo 90 giorni si tolgono. L'uplink
UniFi si salva. Sede, testa e subnet sono scelte confermate da una persona. Tutto il resto il
modello lo calcola a ogni richiesta e non lo salva.**

- `device_neighbors` tiene `last_seen_at`: una lettura aggiorna la riga se c'è, la crea se manca, e
  non tocca le altre. La pulizia a 90 giorni avviene quando lo stesso apparato viene riscritto.
- L'uplink UniFi va sull'apparato (`uplink_mac`, `uplink_seen_at`), non fra i vicini.
- La soglia «non visto» è un'impostazione dell'hub, modificabile da un amministratore.
- Il modello (`src/lib/topology/model.ts`) è una funzione dei dati: niente seconda copia da
  tenere coerente.

## Alternative scartate

- **Tabella storica dei collegamenti, a parte** — scartata: un secondo scrittore e un secondo posto
  da tenere coerente con `device_neighbors`; ogni divergenza sarebbe un collegamento fantasma.
- **Uplink come riga di `device_neighbors`** — scartata: il CHECK su `protocol` obbligherebbe a
  ricostruire la tabella, vietato sulle tabelle con chiavi esterne (regola 9 del CLAUDE.md).

## Conseguenze

### Positive

- Una linea che non si vede più resta sulla mappa con la scritta «non visto», invece di sparire.
- Due fonti sullo stesso apparato non si cancellano a vicenda.
- I vicini si abbinano anche per MAC (prima il MAC si leggeva e si ignorava).
- Quattordici collegamenti in più sull'hub e tre su DTS, dai dati che già c'erano.

### Negative

- `device_neighbors` cresce fino alla pulizia a 90 giorni.
- La pagina «Dati della mappa» è un lavoro in più per chi gestisce le sedi.

### Cosa diventa difficile in futuro

1. La mappa vecchia (`getTopologyData`) e l'attribuzione ora vedono anche i vicini non visti di
   recente (fino a 90 giorni), i più recenti per primi: il loro risultato cambia.
2. La pulizia a 90 giorni gira solo quando l'apparato viene riscritto: uno che perde tutti i
   vicini, o che non viene più interrogato, tiene le sue righe (si vedono «non visto»).
3. Quando poll (SNMP/SSH) e UniFi riportano la stessa chiave di vicino, `source` è di chi ha
   scritto per ultimo.
4. Un poll SNMP o una query manuale riscrive `switch_ports` con `is_uplink = 0` fino alla prossima
   lettura UniFi (due scrittori sulle porte). `uplink_mac`/`uplink_seen_at` dell'apparato restano:
   la fase 2 non deve leggere `is_uplink = 0` come «non è un uplink».
5. Dove un controller non si legge da solo (DTS oggi) tutto diventa «non visto» dopo 2 giorni. Sulla
   copia di DTS 28 collegamenti sono già vecchi, da poll SNMP/MNDP antichi, anche dopo una lettura
   UniFi.
6. La migrazione gira in fondo a `getTenantDb`, perché due ricostruzioni di `network_devices`
   (CHECK `firewall` e `access_point`) copiano solo le colonne che conoscono. Ogni colonna futura di
   `network_devices` aggiunta all'apertura deve stare dopo di loro.
7. La soglia è un'impostazione dell'hub, cambiata con `requireAdmin`: su un hub con più tenant vale
   per tutti. Punto aperto.
8. Il ramo `tappa3b/nucleo` toglie `upsertNeighbors` dal facade `db.ts`: nel rebase vince il nucleo.

## Riferimenti

- Spec: `docs/superpowers/specs/2026-10-12-topology-map-design.md` (v2, 13/10)
- Piano: `docs/superpowers/plans/2026-10-13-topologia-fase1-dati.md`
- ADR 0003 (mappa), ADR 0005 (UniFi), ADR 0007 (controller di rete)
