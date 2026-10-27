# Censimento di `src/lib/devices/acquisition/` (C0.7, 22/10/2026)

Solo un censimento: nessun codice è stato cambiato. La decisione spetta a Riccardo.

## Cosa c'è

| File | Righe | Contenuto |
| --- | --- | --- |
| `registry.ts` | 129 | Registry di handler per `(vendor, vendor_subtype, classification, protocol)` con punteggio; `findHandler`, `registerHandler`, `buildSwitchClientFromHandler`, `buildRouterClientFromHandler`, `getRegisteredHandlers` |
| `mikrotik.ts` | 142 | Un solo handler (MikroTik via SSH: tabella MAC, ARP, info base) che si registra importando il file |
| `index.ts` | 11 | Esporta il registry e importa `./mikrotik` per registrarlo |

## Chi lo usa

**Nessuno.** Ricerca su `src/`, `scripts/`, `server.ts` e `next.config.ts` (import statici e dinamici,
con apici singoli e doppi, per `devices/acquisition`, `./acquisition`, `acquisition/registry`,
`acquisition/index`, `findHandler`, `registerHandler`, `getRegisteredHandlers`,
`buildSwitchClientFromHandler`, `buildRouterClientFromHandler`): l'unica corrispondenza fuori dalla cartella
è `scripts/acquire-device.ts`, che importa **un'altra cosa** (`src/lib/acquisition/index`, i collector JSON).
Nessuna prova lo copre. Il commento di `index.ts` dice che `switch-client.ts` e `router-client.ts` «possono»
usarlo come facciata: non lo fanno. Quindi `mikrotik.ts` non viene mai caricato e il suo handler non è mai
registrato: è codice morto, non un secondo meccanismo in esercizio.

L'unica altra citazione è nel piano `2026-07-28-attribution-v2-fase-4b-protocolli.md`, come parte di un
elenco di API vendor «che esiste già».

## Proposta

**Ritirarlo** (cancellare i tre file, 282 righe), per tre ragioni:

1. non ha chiamanti, quindi cancellarlo non cambia nessun comportamento;
2. i collector JSON (`src/lib/acquisition/`) sono il meccanismo nuovo e hanno già il catalogo come elenco
   unico: tenere un secondo registry con la stessa ambizione confonde chi aggiunge una famiglia;
3. la parte MikroTik del registry sarà coperta dal collector `mikrotik-routeros` (C3), da coordinare con la
   scheda MikroTik.

Alternativa scartata: tenerlo come facciata. Servirebbe un chiamante e una prova; i collector hanno già
l'adapter `toDeviceInfo`, e la sostituzione dei client storici è il lavoro di C5, famiglia per famiglia.

Se decidi di ritirarlo: un commit solo, `git rm` dei tre file, `tsc` e `build` come prova; nessuna rotta toccata,
quindi nessun problema di compatibilità con gli `update.sh` vecchi.
