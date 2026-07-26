# AD Health — ACL human risk summary (UX)

> Approvato: **opzione A** · Branch `feat/ad-health-native`

## Obiettivo

Sostituire l’elenco grezzo di ACE con una **sintesi a rischio**: categorie con “perché conta”, conteggi attori/oggetti, dettaglio raggruppato per trustee. Elenco grezzo solo opzionale.

## Categorie (primary bucket per ACE)

1. DCSync / replica  
2. Controllo totale (GenericAll)  
3. Modifica ACL / owner  
4. Reset password  
5. Aggiunta membri  
6. AdminSDHolder non standard  
7. Diritti estesi ampi  

## Implementazione

- Pure analyzer: `src/lib/ad/health/acl/risk-summary.ts`
- UI Health: card “Analisi permessi ACL”
