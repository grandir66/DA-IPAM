# Scansioni: knob del motore per Cursor (10/11/2026)

La pagina «Scansioni interne» (`/scans`) è già sul modello Nety per la **UI** (tipo, profilo, fasi,
scelta rete, levetta «Prove invasive» = `prove_fabbrica`, avanzamento dal vivo con `ScanProgress`,
Storico). Mancano due **knob per-giro** che Nety espone e che dipendono dal motore delle sonde/nmap
(non dall'UI): **Timeout (ms)** e **Concorrenza**. Oggi vengono dai default del profilo
(`PROFILI_GIRO`), non si scelgono per singolo giro.

## Cosa serve (lato motore/API — Cursor)

Far accettare al lanciatore due campi opzionali per-giro e passarli al motore:

- `timeout_ms` (intero, ms): timeout per bersaglio/sonda del giro; se assente, resta il default del profilo.
- `concorrenza` (intero): numero di worker in parallelo del giro; se assente, default del profilo.

Punti da toccare:
- `src/lib/scanner/lancia-giro.ts` — tipo `LancioGiro` e `lanciaGiro`: aggiungere i due campi opzionali,
  validarli (range sensati: timeout 500–60000 ms; concorrenza 1–256) e inoltrarli al motore.
- Il motore del giro (discovery/sonde) che oggi legge timeout/concorrenza dal profilo: farli
  sovrascrivere da questi valori quando presenti. **Non** cambiare il comportamento se assenti
  (compatibilità coi giri automatici e con lo schedulatore).
- La rotta `POST /api/scans/lancia` passa già il corpo a `lanciaGiro`: nessuna modifica se i campi
  sono nel tipo.

Vincoli: valori fuori range → errore chiaro, non un giro selvaggio; i giri automatici e lo
schedulatore restano sui default del profilo; nessun effetto sul freno delle porte di campo/stampa.

## Cosa faccio io (UI) quando il motore li accetta

Aggiungo al profilo «Su misura» due campi: **Timeout (ms)** e **Concorrenza**, con i default del
profilo come segnaposto, e li mando nel corpo di `/api/scans/lancia` (`timeout_ms`, `concorrenza`).
Nessun altro cambio: la pagina è già pronta.

Riferimento UI: `src/app/(dashboard)/scans/scans-client.tsx` (v0.9.1076).
