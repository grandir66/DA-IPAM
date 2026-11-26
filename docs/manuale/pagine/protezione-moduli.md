---
percorso: /protezione/moduli
titolo: Moduli e container — immagini, porte e permessi
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Elenca **i container dei moduli** che girano sulla macchina di DA-IPAM, con l'immagine, le porte e i permessi che
hanno. Serve a controllare che nessun modulo abbia più accesso del necessario.

Si arriva dalla scheda **Moduli e container** di **Sicurezza › Protezione**. Solo amministratori. Nessuna schermata
nel manuale.

## Le voci della pagina

In cima quattro numeri: **Container**, **Con porte pubblicate**, **Sulla rete della macchina**, **Con permessi in
più**.

Il pannello **Immagini e porte, modulo per modulo** ha le colonne:

- **Modulo** e **Container**.
- **Immagine**: l'immagine da cui parte il container.
- **Porte pubblicate**: rispondono alla rete. Sono le stesse che si vedono in
  [Porte presentate](pagine/protezione-porte.md).
- **Solo interne**: le vedono solo gli altri container.
- **Rete**: se il container usa la rete della macchina invece di una sua.
- **Permessi in più**: i poteri aggiunti al container, oppure **privilegiato**.

## Come si usa

1. Guarda la colonna **Permessi in più**: un container privilegiato ha i poteri pieni sulla macchina.
2. Controlla chi usa la rete della macchina: può toccarne le schede di rete.
3. Confronta le porte pubblicate con quelle attese dal modulo.

## Cosa vogliono dire i segni

- ■ privilegiato: ha i poteri pieni.
- ▲ permessi in più, oppure rete della macchina.

## Da dove arrivano i dati

Docker, letto quando si apre la pagina. Le variabili d'ambiente dei container non si leggono mai.

## Se la pagina è vuota

Senza Docker la pagina dice «non letto».
