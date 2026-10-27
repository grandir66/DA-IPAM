# ADR 0032 — Una pagina sola per le opzioni, e quattro job che nascono da soli

**Stato:** Accepted
**Data:** 2026-10-22
**Autore:** Riccardo Grandi, con Claude
**Spec:** `docs/superpowers/specs/2026-10-22-pagina-opzioni-design.md` · **Piano:** `docs/superpowers/plans/2026-10-22-pagina-opzioni.md`
**Completa:** ADR 0031 (letture accese di serie).

## Contesto

Il 22/10, sull'appliance appena installata di 70151, il router MikroTik era leggibile ma la sua scheda non aveva le VLAN:
la lettura nasceva spenta (corretto con l'ADR 0031) e **nessun job leggeva gli apparati**, perché il giro ARP, le scansioni
e la lettura degli hypervisor si creano a mano. Il censimento dello stesso giorno ha contato 34 interruttori in 13 pagine,
11 voci che si cambiano solo da file e 4 automatismi sempre accesi, con valori di serie opposti e quattro forme di valore.
Riccardo: «deve esserci una pagina sola in cui si attivano le opzioni per ogni singola funzionalità che non parte in
automatico ed eventualmente da disabilitare».

## Decisione

1. **Un catalogo unico** (`src/lib/opzioni/catalogo.ts`) dichiara ogni opzione una volta, con `leggi` dal sistema vivo e
   `cambia` che chiama le funzioni che esistono già. È l'unica fonte di `/settings/opzioni` e di `GET`/`PUT /api/opzioni`.
   Una prova di completezza (`__tests__/catalogo.test.ts`) fallisce se una lettura, un tipo di job, un modulo del registry o
   una voce del censimento non sono nel catalogo o in `fuori-catalogo.ts` col motivo.
2. **Le levette si spostano tutte in Opzioni.** Nelle pagine vecchie resta lo stato in una riga con «cambia da Opzioni ›»
   (`components/opzioni/riga-rimando.tsx`); nelle schede restano i dati da inserire (URL, credenziali, intervallo della
   singola rete, assistente di MeshCentral, cancellazione dei dati di un modulo).
3. **Quattro job di serie** (`src/lib/opzioni/job-di-serie.ts`): giro ARP ogni 30 minuti, lettura degli hypervisor ogni notte
   (03:00), nomi DNS ogni giorno, scansione veloce di ogni rete ogni 12 ore. Il seme gira a ogni avvio per ogni cliente
   (`applySchedulerBootMigration`) e crea solo quelli che mancano.
4. **La lapide**: chi spegne un job di serie da Opzioni, o lo cancella dalla pagina dei job, scrive
   `opzioni.job_di_serie.<tipo>` = `{"acceso":false,"da","il"}` in `tenant_settings`; con la lapide il seme non lo ricrea.
   Una lapide illeggibile vale come lapide. Riaccendere da Opzioni la toglie e ricrea.
5. Le opzioni dell'hub (valgono per tutti i clienti) le cambia chi può scrivere le impostazioni dell'hub, con la regola di
   `PUT /api/settings`. Le voci da file si leggono e basta (405 col posto dove si cambiano).

## Conseguenze

- Al primo avvio con questa versione ogni appliance e l'hub creano i job di serie che mancano: più traffico verso gli
  apparati dei clienti (scansione veloce di ogni rete due volte al giorno, che manda offline chi non risponde).
- 720 minuti è la soglia che il freno sulle reti /22 di `applyTenantSchedulerDefaults` già tollera: il freno non li spegne.
- Una rete creata dopo l'avvio riceve la sua scansione veloce al riavvio successivo (gli aggiornamenti riavviano).

**Cosa diventa difficile in futuro:** ogni interruttore nuovo deve entrare nel catalogo, o la prova fallisce: costa una
voce in più a chi aggiunge una funzione, ed è voluto. Togliere un job di serie dall'elenco non basta a toglierlo dalle
appliance: i job già creati restano, servono una migrazione e la lapide. Cambiare il ritmo di serie non tocca i job che
esistono già.
