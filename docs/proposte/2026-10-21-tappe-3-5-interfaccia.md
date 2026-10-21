# Tappe 3-5 (credenziali, promozione, wizard) — proposta d'interfaccia

**Data:** 2026-10-21 · **Stato:** proposta, da approvare oggetto per oggetto prima di scrivere codice ·
**Specifica:** `docs/superpowers/specs/2026-10-15-credenziali-promozione-wizard-design.md` §3.

Oggi la finestra è `src/components/devices/promote-host-dialog.tsx`: titolo «Promuovi a dispositivo
gestito», Nome + IP, poi **«Tipo dispositivo»** (7 voci fisse) **e** «Classificazione» dentro
`DeviceFormFields` (la classificazione ricalcola il tipo: due campi per la stessa cosa), piattaforma,
protocollo, porta, profilo e credenziali in un unico blocco lungo. La credenziale si sceglie alla cieca:
nessuna prova dentro la finestra.

## Tappa 3 — una finestra sola per trasformare un IP in apparato

Stesso componente nei quattro ingressi: `/objects/[id]`, `/hosts/[id]`, pagina della rete, Discovery (e
lista per classificazione). Larghezza ~720 px, tre blocchi numerati, un solo pulsante finale.

```
┌ Rendi apparato — 192.168.15.20 ───────────────────────────────── ✕ ┐
│ Nome [ sw-core-01            ]   Proposto da: SNMP · 92%            │
│                                                                    │
│ 1 COS'È                                                            │
│   Classificazione [ Switch ▾ ]  Piattaforma [ MikroTik ▾ ]          │
│   Profilo         [ RouterOS ▾ ]   (tipologia dedotta, non chiesta) │
│                                                                    │
│ 2 COME CI ARRIVO                                                   │
│   Protocollo [ SSH ▾ ]  Porta [ 22 ]   ● porta standard            │
│                                                                    │
│ 3 CREDENZIALE                                                      │
│   ( ) dall'archivio [ admin-mikrotik ▾ ]  [Prova]  ✓ Riuscita 09:41 │
│   ( ) nuova nell'archivio  [Nome] [Utente] [Password] [Prova]      │
│   [Trova in automatico]   ← prova le validate sull'host, poi la    │
│                             catena della rete, poi l'archivio      │
│                                                                    │
│                              [Annulla]  [Rendi apparato]           │
└────────────────────────────────────────────────────────────────────┘
```

Oggetto per oggetto (ognuno da approvare):

1. **Titolo «Rendi apparato — IP»** al posto di «Promuovi a dispositivo gestito». Un verbo, il nome che
   l'interfaccia usa altrove («apparato»).
2. **«Proposto da: SNMP · 92%»** su una riga piccola accanto al nome, al posto della descrizione lunga.
   I campi precompilati restano normali (niente evidenziazione).
3. **Via «Tipo dispositivo»**: decide la classificazione (oggi la ricalcola comunque). Tipologia e
   profilo si propongono dalla classificazione; il profilo resta modificabile.
4. **Porta accanto al protocollo**, col segno ● «porta standard» o ▲ «porta non standard» (doppio
   segnale, forma e testo). La porta segue la credenziale validata come oggi.
5. **Credenziale con prova in finestra**: «Prova» sulla voce scelta, esito sulla stessa riga con
   badge a tinta piena: ✓ Riuscita (verde) · ✕ Rifiutata (rosso) · ● Non provata (grigio) · ▲ Fermata
   (giallo, per il tetto dei tentativi). Ora in ora italiana.
6. **«Nuova nell'archivio»**: niente credenziali inline; si crea la voce nell'archivio e si prova
   prima di salvarla. Tipi per esteso (SSH, WinRM, SNMP v2c, SNMP v3, API…).
7. **«Trova in automatico»**: prova in sequenza e si ferma alla prima buona. Sotto il pulsante una riga
   viva («3/7 · admin-win · rifiutata»). **Windows/AD**: tetto di 3 tentativi per host e stop al primo
   blocco/fermo; prima di partire avvisa «ogni tentativo è un accesso fallito vero sul server».
8. **Più host insieme** (dalla Discovery): stessa finestra, i blocchi 1-2 valgono per tutti, il blocco 3
   diventa una tabella **una riga per host** con l'esito della prova di ciascuno (non un totale).
9. **Pulsante finale «Rendi apparato»** attivo anche senza credenziale riuscita, ma con la scritta
   ▲ «senza credenziale provata» accanto. Si può creare e provare dopo.
10. **Scheda dell'apparato**: riquadro «Credenziali assegnate» con quelle davvero usate dal motore e
    l'ultimo esito, non quelle della catena di rete.

## Tappa 4 — wizard

1. **Passo credenziali = la pagina Credenziali** incorporata (stessa tabella, stesso «Aggiungi»), non più
   quattro blocchi fissi SNMP/SSH/Windows/Linux.
2. **Indietro modifica**: un passo già fatto si riapre coi valori salvati; «Avanti» aggiorna invece di
   creare un doppione.
3. **«Esci» conserva il punto raggiunto**: alla riapertura «Riprendi dal passo 3 (Credenziali)» o
   «Ricomincia».
4. **Rete senza valore precompilato** (la `192.168.0.0/24` comparsa da sola): campo vuoto con un
   esempio grigio, proposta dalla rete dell'appliance con un clic «Usa 192.168.x.0/24».

## Tappa 5 — classificazione

Niente oggetti nuovi in pagina, solo comportamento, più un segno:

1. Un solo punto scrive la classificazione su **apparato e host**, nei due versi.
2. **Scelta a mano = 🔒** accanto alla classificazione (scheda, liste): le scansioni non la toccano;
   il lucchetto si toglie con un clic («Torna automatica»).
3. Cambiando classificazione, piattaforma/protocollo/tipologia si **propongono** (non si sovrascrivono
   se già scelti a mano).

## Decisioni di Riccardo (21/10)

- **Windows/AD: tetto fisso di 3 tentativi per host**, poi «▲ Fermata» col motivo (oggetto 7).
- **Credenziale già fallita su quell'host: esclusa e detta** («✕ admin-win esclusa: rifiutata il 20/10»);
  «Prova» a mano la rimette in gioco. Chiude la domanda aperta dalla tappa 2.
- **Senza credenziale provata si crea lo stesso**, con «▲ senza credenziale provata» in finestra e nella
  scheda finché una prova non riesce (oggetto 9).

Resta da approvare la forma della finestra, oggetto per oggetto (gli schemi qui sopra).
