---
percorso: /protezione/moduli
titolo: Moduli e container — immagini, porte e permessi
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Elenca **i container dei moduli** che girano sulla macchina di DA-IPAM, con l'immagine, le porte e i permessi che
hanno. Serve a controllare che nessun modulo abbia più accesso del necessario.

Si arriva dalla scheda **Moduli e container** di **Sicurezza › Protezione** (le schede sono descritte in
[Stato della protezione](pagine/protezione.md)). Solo amministratori. Nessuna schermata nel manuale.

## Le voci della pagina

In cima la riga **Filtro degli accessi** (vedi [Stato della protezione](pagine/protezione.md)) e quattro numeri:
**Container**, **Con porte pubblicate**, **Sulla rete della macchina**, **Con permessi in più**.

Il pannello **Immagini e porte, modulo per modulo**: le porte pubblicate rispondono alla rete, le interne solo agli
altri container.

| Colonna | Che cosa dice |
|---|---|
| **Modulo** | Il modulo di DA-IPAM a cui appartiene il container. |
| **Container** | Il nome del container. |
| **Immagine** | L'immagine da cui parte. |
| **Porte pubblicate** | Rispondono alla rete; sono le stesse di [Porte presentate](pagine/protezione-porte.md). |
| **Solo interne** | Le vedono solo gli altri container. |
| **Rete** | ▲ **della macchina** se il container usa la rete della macchina invece di una sua. |
| **Permessi in più** | ▲ i poteri aggiunti al container, oppure ■ **privilegiato**. |

## Come si fa

- **Trovare i container con troppi poteri**: colonna **Permessi in più**: un container ■ **privilegiato** ha i poteri
  pieni sulla macchina.
- **Vedere chi tocca le schede di rete**: colonna **Rete**: chi usa la rete della macchina può toccarne le schede.
- **Controllare le porte di un modulo**: confronta **Porte pubblicate** con quelle attese dal modulo; per chi le
  raggiunge vai in [Porte presentate](pagine/protezione-porte.md).
- **Spegnere un modulo che non serve**: da **Impostazioni › Moduli**.

## Cosa vogliono dire i segni

- ■ privilegiato: ha i poteri pieni.
- ▲ permessi in più, oppure rete della macchina.

## Da dove arrivano i dati

Docker, letto quando si apre la pagina. Le variabili d'ambiente dei container non si leggono mai.

## Se la pagina è vuota

Senza Docker la pagina dice «Container: non letto».
