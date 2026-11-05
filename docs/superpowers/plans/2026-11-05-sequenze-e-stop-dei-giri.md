# Sequenze sul server e stop dei giri

Riccardo (05/11): «Sì, passi 3 e 4», dopo i passi 1 e 2 (v0.9.977). Livello **completo**: tocca il cuore delle
scansioni. Niente live: si pubblica su `dev`; il push su `main` di DA-IPAM resta da confermare.

| Passo | Cosa | File | Dipende da | Stato |
| --- | --- | --- | --- | --- |
| A | Registro dei giri fermabili: segnale per giro, `controllaFermo` | `scanner/ferma-giro.ts` | — | [x] |
| B | Stop nella scansione: processi uccisi, controlli fra i lotti, niente offline da un giro fermato | `discovery.ts`, `ping.ts`, `nmap.ts`, `naabu.ts`, `profili/motore.ts` | A | [x] |
| C | Rotta `POST /api/scans/progress/[jobId]/ferma`, pulsante in pannello e bacheca | rotta, `scan-progress.tsx`, `pagina-in-esecuzione.tsx` | A, B | [x] |
| D | Sequenze sul server, rotta `POST /api/scans/sequenza` | `scanner/sequenze.ts`, rotta, pagina rete | A, B | [x] |
| E | Prove viste fallire, verifica con scansioni vere, revisione | prove | tutti | [x] |

## Vincoli

- **Un giro fermato non manda offline nessuno.** Il controllo sta prima della fase 4. Un ping ucciso dallo stop è
  «sconosciuto», non «nessuna risposta»: `classifyPingError` tratta `killed` come timeout, e con `signal` è `killed` anche lo stop.
- Il controllo si fa **fra un lotto e l'altro**, mai dentro un `Promise.all`: un lancio lì rilascerebbe il lucchetto con
  gli altri host del lotto ancora in scrittura.
- Il segnale viaggia in un `AsyncLocalStorage` su `globalThis`: il modulo può essere caricato due volte (NUC-5).
- Sequenza = un giro padre in bacheca, le fasi nascoste. Fra una fase e l'altra si aspetta la rete libera (anche un job può
  infilarsi), lo stop interrompe anche l'attesa.
- Stop di un job programmato: quel giro si ferma, il job non conta come guasto, un job su tutte le reti prosegue con la rete dopo.
- Le interrogazioni di un apparato non si fermano (ssh, winrm, collector): non hanno il pulsante.

## Consuntivo

- **Fatto**: passi A-E. Prove in `scanner/__tests__/ferma-giri.test.ts` (15), viste fallire con mutazioni; tolti insieme, i
  controlli di stop lasciano spegnere gli host. Cancello: lint, tsc, build, 7301 prove (0 fallite).
- **Verificato con processi veri**: su `next start`, a 1280, prima delle correzioni della revisione. Le correzioni della revisione
  sono coperte dalle prove, non da un altro giro vero.
- **Mancante**: lo stop delle interrogazioni di un apparato (ssh, winrm, collector) resta fuori. Non provati con host veri:
  «Avanzata» e «Accesso agli host» (in locale non c'erano host), e lo stop di un profilo.
- **Scostamenti**: niente riga in `scan_history` per un giro fermato. Sul server di sviluppo `next dev` da `127.0.0.1` la pagina si
  ricarica in cerchio (HMR bloccato, `allowedDevOrigins`): per le prove nel browser si usa `next start`.
- **Decisione**: lo stop ferma il giro, non il job (Riccardo, 05/11).
