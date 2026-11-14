# ADR 0038 — Impostazioni e Config: due voci di menu, una fila di schede ciascuna

**Stato:** Accepted
**Data:** 2026-11-14
**Autore:** Riccardo Grandi, con Claude
**Sostituisce in parte:** ADR 0032 (solo «Opzioni è una voce del menu»; il resto di 0032 vale)

## Contesto

Il 22/10 Opzioni e Schedulazioni erano diventate voci del menu sotto «Sistema», accanto a Impostazioni e Cosa esce: quattro voci per la stessa materia. Il 12/11 Riccardo ha chiesto un menu più corto («nel menu resta la prima pagina di ogni sezione; le altre sono schede in cima alla pagina», `lib/menu/sezioni.ts`) e il 13/11 una forma unica per le schede (`forma-scheda.ts`). Impostazioni era rimasta fuori da tutte e due: barra fatta a mano, scheda scelta distinta solo per tinta.

Riccardo, 14/11: «utenti, aggiornamenti, moduli, istanza sono fondamentali»; «inserendo in modo chiaro dentro impostazioni anche le voci di menù opzioni e schedulazioni».

## Decisione

Due sezioni di `sezioni.ts`, due voci di menu, una fila di schede ciascuna:

- **Impostazioni**, per tutti: Utenti, Aggiornamenti, Moduli, Istanza, poi Opzioni e Schedulazioni, poi Notifiche.
- **Config**, solo amministratori: Scansione, Identificazione, Alert sicurezza, HTTPS, Sistema, Cosa esce. Riccardo, 14/11: «un config dove ci sono davvero le cose che solo un admin può conoscere, come porte, config particolari». Prende il posto del segnaposto spento «Config istanza».

Le due sezioni stanno sulla stessa pagina `/settings` e si distinguono dal `?tab=` (non dall'àncora, che lì porta già a un modulo: `#module-wazuh`). Gli indirizzi non cambiano. Scartata nello stesso giorno la via di mezzo, una scheda «Avanzate» con una seconda fila: nascondeva le voci tecniche senza dire per chi sono.

## Conseguenze

- Una scheda può essere riservata (`per`): la fila legge la sessione. È solo vista: i permessi li decidono le API, come prima.
- **Cosa diventa difficile**: ogni scheda nuova va messa di qua o di là, e alcune stanno a metà (Opzioni ha parametri tecnici, Notifiche ha il server SMTP). Il menu non conosce il `tab` senza leggere l'indirizzo completo: la voce accesa si decide con `nomeSezione`.
- Opzioni e Schedulazioni sono a un clic in più dal menu.
