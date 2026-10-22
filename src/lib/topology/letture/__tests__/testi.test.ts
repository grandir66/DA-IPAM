// I testi di «Letture in più per la mappa» (spec §13.5.6): il dialogo dice che cosa succede con la cadenza vera di quel
// cliente (sulla rete B il router si legge ogni 15 minuti dalle scansioni veloci; sul cliente A ogni ora); gli orari in ora
// italiana; l'esito in parole («letta in parte: 6 comandi su 8»); ogni lettura dice che cosa legge, su quali apparati e
// che nasce spenta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LETTURE } from "@/lib/topology/letture/interruttori";
import { DESCRIZIONE_LETTURE, NASCE_SPENTA, frequenza, quandoItaliano, righeEsito, testoDialogo, testoEsito, testoStato } from "@/lib/topology/letture/testi";

const HUB = { router: { minuti: 15, daScansioni: true }, switch: 60 };
const CLIENTE_A = { router: { minuti: 60, daScansioni: false }, switch: 60 };

test("il dialogo con la cadenza dell'hub e quella del cliente A, alla lettera della spec", () => {
  assert.equal(testoDialogo("mikrotik", true, HUB),
    "Accendere la lettura dello spanning tree sui MikroTik di questo cliente? Il router si legge ogni 15 minuti dalle scansioni veloci: le letture in più partono al più una volta l'ora, 6 comandi in sola lettura sul router e 8 sugli switch MikroTik (2 in più dove un bridge è in MSTP), su una connessione sola per apparato. Sugli switch MikroTik la scheda «Neighbors» dell'apparato mostra anche le righe lette via SSH. La mappa non cambia finché non si accende la mappa nuova. Si spegne da qui.");
  assert.ok(testoDialogo("mikrotik", true, CLIENTE_A).includes("Il router si legge ogni ora: "));
  assert.ok(testoDialogo("snmp", false, CLIENTE_A).startsWith("Spegnere la lettura"));
});

test("il dialogo di accensione tiene intero il testo della spec e dice dei Neighbors solo per i MikroTik", () => {
  const t = testoDialogo("mikrotik", true, HUB);
  assert.ok(t.startsWith("Accendere la lettura dello spanning tree sui MikroTik di questo cliente? Il router si legge ogni 15 minuti dalle scansioni veloci: le letture in più partono al più una volta l'ora, 6 comandi in sola lettura sul router e 8 sugli switch MikroTik (2 in più dove un bridge è in MSTP), su una connessione sola per apparato. "));
  assert.ok(t.endsWith("La mappa non cambia finché non si accende la mappa nuova. Si spegne da qui."));
  for (const l of ["controller", "snmp", "host"] as const) {
    assert.ok(!testoDialogo(l, true, HUB).includes("Neighbors"), `${l}: la scheda Neighbors è un fatto dei MikroTik`);
    assert.ok(testoDialogo(l, true, HUB).endsWith("La mappa non cambia finché non si accende la mappa nuova. Si spegne da qui."), l);
  }
  assert.ok(testoDialogo("snmp", true, CLIENTE_A).includes("Il giro degli switch parte ogni ora"));
  // Revisione finale di T2 (M2): le letture SNMP sono 16 (colonne e scalari invece delle tabelle intere), non dieci.
  assert.ok(testoDialogo("snmp", true, CLIENTE_A).includes("16 letture in sola lettura"));
  assert.ok(DESCRIZIONE_LETTURE.snmp.comandi.startsWith("16 letture in sola lettura"));
  assert.ok(testoDialogo("snmp", true, { router: CLIENTE_A.router, switch: null }).includes("solo quando lo chiede qualcuno"));
});

test("ogni lettura dice che cosa legge, su quali apparati, con quali comandi, e che nasce spenta", () => {
  for (const l of LETTURE) {
    const d = DESCRIZIONE_LETTURE[l];
    assert.ok(d.titolo.length > 0 && d.legge.length > 0 && d.comandi.length > 0 && d.apparati.length > 0, l);
  }
  assert.ok(NASCE_SPENTA.toLowerCase().includes("nasce spenta"), "ogni riga dice che nasce spenta");
});

test("VLAN, DNS e utenti dei MikroTik: titolo, che cosa legge (nessuna password), apparati, comandi; il dialogo dice quattro comandi e l'ora", () => {
  const d = DESCRIZIONE_LETTURE.mikrotik_scheda;
  assert.equal(d.titolo, "VLAN, DNS e utenti dei MikroTik");
  assert.equal(d.legge, "Le VLAN dei bridge (tagged e untagged per porta), le interfacce VLAN col loro id e la loro interfaccia madre, la configurazione DNS, gli utenti del router (nome, gruppo, ultimo accesso; nessuna password).");
  assert.equal(d.apparati, "router MikroTik letti via SSH");
  assert.equal(d.comandi, "/interface bridge vlan print · /interface vlan print · /ip dns print · /user print (sola lettura, una connessione per apparato, al più una volta l'ora)");
  const t = testoDialogo("mikrotik_scheda", true, HUB);
  assert.ok(t.includes("4 comandi in sola lettura") && t.includes("al più una volta l'ora") && t.includes("Il router si legge ogni 15 minuti dalle scansioni veloci"), t);
  assert.ok(t.includes("solo un amministratore"), "gli utenti del router si vedono solo da admin");
  assert.ok(!t.includes("La mappa non cambia"), "questa lettura non serve alla mappa: riempie la scheda");
  assert.ok(testoDialogo("mikrotik_scheda", false, HUB).startsWith("Spegnere la lettura «VLAN, DNS e utenti dei MikroTik»?"));
});

test("frequenza in parole", () => {
  assert.equal(frequenza(15, true), "ogni 15 minuti dalle scansioni veloci");
  assert.equal(frequenza(60, false), "ogni ora");
  assert.equal(frequenza(180, false), "ogni 3 ore");
  assert.equal(frequenza(null, false), "solo quando lo chiede qualcuno (nessun giro programmato)");
});

test("stato e orari in ora italiana (UTC+2 fino al 25/10)", () => {
  assert.ok(quandoItaliano("2026-10-15 08:30:00").includes("10:30"));
  assert.equal(quandoItaliano(null), "—");
  assert.equal(quandoItaliano("non una data"), "—");
  assert.equal(testoStato({ acceso: false, da: "admin", il: "2026-10-15 08:30:00" }), "spenta");
  assert.ok(testoStato({ acceso: true, da: "admin", il: "2026-10-15 08:30:00" }).startsWith("accesa da admin il "));
  assert.ok(testoStato({ acceso: true, da: null, il: null }).startsWith("accesa da utente non noto il "));
});

test("l'esito in parole, e un limite con «+ altri N»", () => {
  assert.equal(testoEsito({ il: "x", comandi: 6, riusciti: 6, codice: null }), "tutti i 6 comandi");
  assert.equal(testoEsito({ il: "x", comandi: 8, riusciti: 6, codice: "TEMPO_SCADUTO" }), "letta in parte: 6 comandi su 8 (TEMPO_SCADUTO)");
  assert.equal(testoEsito({ il: "x", comandi: 0, riusciti: 0, codice: "SENZA_CREDENZIALI" }), "non letta (SENZA_CREDENZIALI)");
  const esiti = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), { il: `2026-10-15 08:${String(i).padStart(2, "0")}:00`, comandi: 6, riusciti: 6, codice: null }]));
  const r = righeEsito(esiti, (id) => `SW-${id}`, 10);
  assert.equal(r.righe.length, 10);
  assert.equal(r.altri, 2);
  assert.ok(r.righe[0].startsWith("SW-12: letta il "), "le più recenti per prime");
});
