---
percorso: /protezione/tentativi
titolo: Tentativi e blocchi — chi ha provato a entrare senza riuscirci
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie in un elenco solo **chi ha provato a entrare senza riuscirci**: dalla pagina di accesso di DA-IPAM, da SSH,
dal filtro degli accessi e dalle [Esche](pagine/protezione-esche.md). Da qui si blocca un indirizzo per un periodo o
lo si dichiara come nostro, da non bloccare mai.

Si arriva dalla scheda **Tentativi e blocchi** di **Sicurezza › Protezione**. Solo amministratori. Nessuna schermata
nel manuale.

## Le voci della pagina

In cima tre numeri: **Tentativi (7 giorni)**, **Bloccati adesso**, **Sopra soglia adesso** (chi di recente ha superato
la soglia di avviso).

- **Bloccati adesso**: gli indirizzi bloccati, con quanto manca alla scadenza. Tutto ciò che arriva da loro viene
  scartato fino ad allora. **Sblocca** li libera subito.
- **Mai bloccati**: gli indirizzi dichiarati come nostri (scanner, monitoraggio), oltre al collegamento di gestione,
  alla macchina stessa e agli indirizzi sempre ammessi dal filtro.

Il pannello **Chi ha provato a entrare** ha una riga per strada e indirizzo, negli ultimi 7 giorni. Mai una password:
solo il nome provato. Accanto al titolo si legge se gli avvisi sono accesi o spenti (si accendono in Impostazioni ›
Notifiche). Colonne:

- **Indirizzo**, **In inventario** (il nome, «sì, senza nome», «questa macchina» o «sconosciuto»).
- **Strada**: da dove è arrivato il tentativo: **Pagina web**, **SSH**, **Filtro di rete** o **Esca**.
- **Tentativi**, **Nomi provati**, **Porte**, **Primo**, **Ultimo**.
- **Stato**: vedi i segni.
- **Azioni**: **Blocca** per un periodo (le durate sono nel menu del pulsante), **Sblocca**, **Non bloccare mai**.

## Come si usa

1. Guarda prima le righe con più tentativi e quelle **sconosciuto**.
2. **nostro, non conta** è la macchina stessa o un nostro sistema: non fa scattare avvisi.
3. Per fermare un indirizzo usa **Blocca**; **Sblocca** lo libera subito.
4. **Non bloccare mai** è per i nostri sistemi che provano le porte per mestiere, come scanner e monitoraggio.

## Cosa vogliono dire i segni

- ■ **bloccato**.
- ▲ **sopra soglia**: ha superato la soglia di avviso.
- ○ **sotto soglia**.
- ● **nostro, non conta**.

## Da dove arrivano i dati

I login falliti della pagina, il registro di SSH, gli indirizzi scartati dal filtro e i contatti con le esche, raccolti
ogni pochi minuti. Mai una password.

## Se la pagina è vuota

**Nessun tentativo negli ultimi 7 giorni**: è il caso migliore. Gli avvisi partono solo se le notifiche sono accese
in Impostazioni › Notifiche.
