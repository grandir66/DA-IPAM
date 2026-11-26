---
percorso: /settings/snmp-profiles
titolo: Profili SNMP Vendor — come si riconoscono e si leggono gli apparati via SNMP
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Un **profilo SNMP** dice a DA-IPAM come riconoscere un apparato di un certo produttore (per esempio uno switch
Aruba o un firewall Fortinet) dalle risposte SNMP, e quali dati leggergli: modello, numero di serie, firmware. È la
prima fase del riconoscimento (vedi **Config › Identificazione › Pipeline** nella guida
[Impostazioni e Config](pagine/settings.md#identificazione)). Si arriva da **Config › Identificazione › Profili SNMP
dei vendor ›**. In alto a sinistra **Impostazioni** torna indietro.

![La pagina Profili SNMP](/manuale/settings-snmp-profiles/pagina.png)

## Le voci della pagina

1. **Libreria OID (file)**: i file con gli identificativi SNMP che stanno sul server, nella cartella della
   libreria: un file comune per gli identificativi di base, un file per categoria di apparato e un file per profilo
   per gli elenchi lunghi. La tabella dice **Tipo** (comuni, categoria, dispositivo), **File** e **Dettaglio**.
   **Aggiorna elenco** rilegge la cartella: i file nuovi compaiono da soli.
2. **Esporta JSON**: scarica tutti i profili in un file. Accanto: **Esporta in cartelle** (un file per profilo),
   **Importa** (carica profili da un JSON; si può scegliere di **sovrascrivere i profili esistenti**, mai quelli di
   serie) e **Reset Builtin** (rimette i profili di serie come erano).
3. **Nuovo profilo**: crea un profilo. I campi: **ID Profilo** (solo lettere minuscole, numeri, trattino e trattino
   basso), nome, **Categoria**, **Confidenza (0-1)** (quanto è sicuro il riconoscimento), **Prefissi OID Enterprise**
   (gli identificativi del produttore), **Pattern sysDescr** (un'espressione sulla descrizione dell'apparato,
   facoltativa), **Campi OID** (i dati da leggere, ognuno col suo identificativo) e **Abilitato**.
4. **Mostra builtin**: mostra o nasconde i profili di serie. Accanto, **Cerca per ID, nome o OID…** e il menu
   **Tutte le categorie** filtrano l'elenco.

Ogni riga dell'elenco **Profili** ha:

- la freccia a sinistra, che apre il dettaglio: prefissi OID, pattern, campi salvati e campi presi dai file della
  libreria, note;
- la levetta, che accende o spegne il profilo;
- nome, etichetta **builtin** se è di serie, ID;
- a destra la categoria, quanti OID e quanti campi ha, la confidenza in percentuale;
- **Copia JSON**, **Modifica** (matita) ed **Elimina** (solo per i profili non di serie).

## Come si usa

1. Un apparato non viene riconosciuto: cerca il produttore con **Cerca**. Se il profilo c'è, aprilo e controlla
   i prefissi OID; se non c'è, **Nuovo profilo**.
2. Per portare i profili su un'altra installazione: **Esporta JSON** qui, **Importa** là.
3. Dopo aver cambiato un profilo, gli apparati già trovati si aggiornano alla scansione successiva.

## Da dove arrivano i dati

I profili stanno nel database dell'hub e valgono per tutte le istanze; quelli di serie vengono con il programma.
La libreria OID è una cartella di file sul server.

## Se la pagina è vuota

«Nessun profilo trovato» con un filtro scelto: toglilo o accendi **Mostra builtin**.
