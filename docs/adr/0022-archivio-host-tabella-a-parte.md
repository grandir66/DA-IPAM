# ADR 0022 — Archivio degli host assenti in una tabella a parte

**Stato:** Accepted — su `dev` spento (niente job, niente archiviati al rilascio); primo «Applica» sull'hub con la conferma scritta di Riccardo
**Data:** 2026-10-20
**Autore:** Riccardo Grandi, con Claude

## Contesto

Riccardo il 20/10: gli host offline da oltre 60 giorni si archiviano (spariscono da liste, conteggi e mappa,
recuperabili con un clic) e si cancellano dopo altri 90 giorni d'archivio; il vecchio IP di un MAC che ha cambiato
indirizzo si archivia subito. Spec `specs/2026-10-20-pulizia-host-assenti-design.md`, piano
`plans/2026-10-20-pulizia-host-assenti.md`. Oggi 252 query in 34 file leggono `hosts` e 21 tabelle hanno una chiave
verso `hosts`.

## Decisione

**Scelta A (Riccardo, 20/10): archiviare = istantanea JSON dell'host in `hosts_archivio`, poi `DELETE FROM hosts`
diretto; recuperare = ricreare l'host dall'istantanea.** Nessuna delle 252 query si tocca.

1. L'istantanea è la riga intera di `hosts` (meno le colonne generate) più gli IP precedenti dallo storico MAC; il
   recupero reinserisce solo le colonne che `hosts` ha in quel momento, con `status = 'offline'`.
2. Il `DELETE` è diretto, non `deleteHost`: niente `excluded_ips`, così un oggetto che torna in rete la scansione lo
   ritrova. Un host archiviato che torna non si recupera da solo: l'archivio lo segnala («Di nuovo in rete»).
3. Il recupero si rifiuta (col motivo, senza scrivere) se l'IP è occupato, se la rete non c'è più, se l'IP è fra gli
   esclusi della rete, o se una chiave esterna non `SET NULL` punta a una riga sparita.
4. Un host recuperato a mano non torna candidato finché esiste (la sua riga d'archivio resta come segno).
5. Ogni operazione (archivia, recupera, cancella) scrive una riga nel registro JSONL
   `data/audit/pulizia-host-<giorno>.jsonl` prima del COMMIT; se il registro non si scrive, l'operazione fallisce.
6. Il vecchio job `cleanup` non tocca più gli host (P1 del piano): cancellava dopo 90 giorni senza esclusioni.

## Alternativa scartata

**B, campo `archived_at` su `hosts`**: recupero completo, storico compreso, ma ogni query su `hosts` va filtrata; una
dimenticata fa ricomparire gli archiviati senza che nessuno se ne accorga.

## Cosa diventa difficile in futuro

- **Lo storico non torna**: scansioni, stati online/offline, classificazioni, anomalie, software se ne vanno in
  cascata all'archiviazione; il recupero riporta identità e note, con un **id nuovo** (i link alla vecchia scheda
  non valgono più).
- Le righe con chiave `SET NULL` (ARP, porte switch, DHCP, vulnerabilità, Wazuh, AD, mobile) restano senza host e al
  recupero **non si ricollegano**.
- Una colonna nuova di `hosts` entra nell'istantanea da sola; una colonna con un vincolo nuovo verso un'altra tabella
  va pensata anche per il recupero (punto 3).
- Un'esclusione nuova (un legame nuovo scritto da una persona) va aggiunta al `CASE` di
  `src/lib/hosts/pulizia-candidati.ts` e alle tabelle che quel modulo controlla.
