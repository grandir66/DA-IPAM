# ADR 0040 — Firma dei rilasci: «blocca» di serie

- Stato: accettato (Riccardo, 16/11/2026: «imposta le cose più sensate»)
- Precisa: [ADR 0039](0039-rilasci-firmati.md), che nasceva con «avvisa» di serie

## Contesto

L'ADR 0039 metteva la guardia della firma in modo «avvisa» per non fermare le appliance in uso finché non
esisteva un rilascio firmato. Il primo rilascio firmato è su `main` dal 16/11 (0.9.1261) e nessuna installazione
segue `main` in questo momento. In «avvisa» un commit non firmato in punta a `main` viene installato lo stesso:
la guardia c'è ma non protegge.

## Decisione

Senza `DA_INVENT_FIRMA_RILASCI` nel file il modo è **«blocca»**. «avvisa» e «spenta» restano, ma vanno scritti
nel file dell'installazione. I rami controllati restano quelli di `DA_INVENT_FIRMA_RAMI` (di serie `main`): hub e
laboratorio, che seguono `dev`, non cambiano.

## Conseguenze

- Un'appliance su `main` non installa più un commit che non porta la firma di chi può rilasciare.
- Cosa diventa difficile: un rilascio d'emergenza senza la chiave di firma non passa; se la chiave si perde, ogni
  appliance va sbloccata a mano (`DA_INVENT_FIRMA_RILASCI=avvisa` nel file, da root). La chiave e la sua
  passphrase vanno custodite in due posti.
- La firma su `dev` per l'hub resta fuori: ogni rilascio di sviluppo dovrebbe essere firmato a mano.
