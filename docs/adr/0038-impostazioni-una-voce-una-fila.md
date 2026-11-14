# ADR 0038 — Impostazioni: una voce di menu, una fila di schede

**Stato:** Accepted
**Data:** 2026-11-14
**Autore:** Riccardo Grandi, con Claude
**Sostituisce in parte:** ADR 0032 (solo «Opzioni è una voce del menu»; il resto di 0032 vale)

## Contesto

Il 22/10 Opzioni e Schedulazioni erano diventate voci del menu sotto «Sistema», accanto a Impostazioni e Cosa esce: quattro voci per la stessa materia. Il 12/11 Riccardo ha chiesto un menu più corto («nel menu resta la prima pagina di ogni sezione; le altre sono schede in cima alla pagina», `lib/menu/sezioni.ts`) e il 13/11 una forma unica per le schede (`forma-scheda.ts`). Impostazioni era rimasta fuori da tutte e due: barra fatta a mano, scheda scelta distinta solo per tinta.

Riccardo, 14/11: «utenti, aggiornamenti, moduli, istanza sono fondamentali»; «inserendo in modo chiaro dentro impostazioni anche le voci di menù opzioni e schedulazioni».

## Decisione

Impostazioni è una sezione di `sezioni.ts` con una fila sola: le quattro fondamentali, poi Opzioni e Schedulazioni, poi i gruppi rete, avvisi, appliance, con Cosa esce in fondo. Nel menu resta la sola voce «Impostazioni». Le schede della pagina `/settings` si scelgono con `?tab=`, non con l'àncora, perché l'àncora lì porta già a un modulo (`#module-wazuh`). Gli indirizzi non cambiano.

## Conseguenze

- Una scheda può essere riservata (`per`): la fila legge la sessione. È solo vista: i permessi li decidono le API, come prima.
- **Cosa diventa difficile**: la fila è lunga (13 schede per un admin con più istanze). Una scheda in più va pesata; se non sta a 1920 si passa a due livelli, come scritto in `docs/STILE-UI.md`.
- Opzioni e Schedulazioni sono a un clic in più dal menu.
