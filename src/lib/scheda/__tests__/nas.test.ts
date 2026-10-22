/**
 * Pezzi puri della scheda storage e NAS (21/10) sulla fixture con la forma vera di nas_inventory: ordine degli
 * alloggiamenti, stato dei dischi (codici Synology, testo QNAP), volumi e pool, totale dello spazio, RAID, striscia.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/nas.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alloggiamenti, statoDisco, riepilogoDischi, spazioTotale, volumiNas, poolNas, livelloRaid, statoRaid, caselleStorage,
  formattaGb, formattaBps, statoServizio, numeroSlot, temperaturaMassimaDischi,
} from "../nas";
import { NAS_QNAP, NAS_SYNOLOGY } from "./fixture-nas";

describe("alloggiamenti", () => {
  it("Synology: nell'ordine dello slot anche se i dischi arrivano mescolati, con il buco come vuoto", () => {
    const a = alloggiamenti(NAS_SYNOLOGY.snmp!.disks, "synology");
    assert.deepEqual(a.map((x) => x.numero), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(a[6].stato.stato, "vuoto");
    assert.equal(a[6].disco, null);
    assert.equal(a[4].stato.stato, "attenzione");
    assert.deepEqual(a[4].stato.motivi, ["SMART: avviso"]);
  });
  it("QNAP: la baia con status -5 è vuota, SMART Warning è attenzione col motivo", () => {
    const a = alloggiamenti(NAS_QNAP.snmp!.disks, "qnap");
    assert.equal(a.length, 8);
    assert.equal(a[6].stato.stato, "vuoto");
    assert.equal(a[4].stato.stato, "attenzione");
    assert.deepEqual(a[4].stato.motivi, ["SMART: warning"]);
    assert.equal(a[0].stato.stato, "buono");
  });
  it("senza dischi nessun alloggiamento; dischi senza numero in coda", () => {
    assert.deepEqual(alloggiamenti(undefined, "qnap"), []);
    const a = alloggiamenti([{ model: "x", status: "1" }, { id: "Disk 2", status: "1" }], "synology");
    assert.deepEqual(a.map((x) => x.numero), [1, 2, 3]);
    assert.equal(a[0].disco, null);
    assert.equal(a[2].disco?.model, "x");
  });
  it("numeroSlot: id, poi indice, poi slot numerico; uno slot «data» non è un numero", () => {
    assert.equal(numeroSlot({ id: "Disk 12" }), 12);
    assert.equal(numeroSlot({ index: "3" }), 3);
    assert.equal(numeroSlot({ slot: "4" }), 4);
    assert.equal(numeroSlot({ slot: "data" }), null);
  });
});

describe("stato del disco", () => {
  it("Synology: 1 e 2 normali, 5 guasto, 3 non inizializzato", () => {
    assert.equal(statoDisco({ status: "1", smart_health: "1" }, "synology").stato, "buono");
    assert.equal(statoDisco({ status: "2" }, "synology").stato, "buono");
    assert.deepEqual(statoDisco({ status: "5" }, "synology").motivi, ["guasto (crashed)"]);
    assert.deepEqual(statoDisco({ status: "3" }, "synology").motivi, ["non inizializzato"]);
  });
  it("più motivi si sommano; uno stato sconosciuto non passa per buono", () => {
    assert.deepEqual(statoDisco({ status: "5", smart_health: "3" }, "synology").motivi, ["guasto (crashed)", "SMART: critico"]);
    assert.equal(statoDisco({ status: "9" }, "synology").stato, "attenzione");
  });
  it("QNAP: 0 pronto, -9 errore, SMART GOOD ok", () => {
    assert.equal(statoDisco({ status: "0", smart_health: "GOOD" }, "qnap").stato, "buono");
    assert.deepEqual(statoDisco({ status: "-9", smart_health: "GOOD" }, "qnap").motivi, ["errore di lettura/scrittura"]);
  });
  it("riepilogo: presenti, buoni, attenzione e il primo motivo", () => {
    const r = riepilogoDischi(alloggiamenti(NAS_QNAP.snmp!.disks, "qnap"));
    assert.deepEqual(r, { presenti: 7, buoni: 6, attenzione: 1, primoMotivo: "disco 5: SMART: warning" });
  });
  it("temperatura massima dei dischi", () => {
    assert.equal(temperaturaMassimaDischi(NAS_QNAP.snmp!.disks), 44);
    assert.equal(temperaturaMassimaDischi(undefined), null);
  });
});

describe("volumi, pool e totale", () => {
  it("QNAP: volumi con percentuale dall'usato (size - free)", () => {
    const v = volumiNas(NAS_QNAP);
    assert.equal(v[0].nome, "Backup");
    assert.equal(Math.round(v[0].percento ?? -1), 91);
    assert.equal(v[0].raid, "RAID 6");
    assert.equal(v[0].stato?.ok, true);
  });
  it("Synology: i pool danno il totale (non si somma anche il RAID)", () => {
    assert.equal(poolNas(NAS_SYNOLOGY).length, 1);
    const t = spazioTotale(NAS_SYNOLOGY)!;
    assert.equal(t.fonte, "pool");
    assert.equal(Math.round(t.totaleGb), 21801);
    assert.equal(Math.round(t.percento), 72);
  });
  it("senza pool: dai volumi; senza niente: null", () => {
    assert.equal(spazioTotale(NAS_QNAP)!.fonte, "volumi");
    assert.equal(spazioTotale({ vendor: "qnap", sources: ["snmp"], snmp: {} }), null);
    assert.equal(spazioTotale({ vendor: "qnap", sources: ["snmp"] }), null);
  });
  it("formati", () => {
    assert.equal(formattaGb(51200), "50 TB");
    assert.equal(formattaGb(500), "500 GB");
    assert.equal(formattaBps("48234496"), "46 MB/s");
    assert.equal(formattaBps(null), "—");
    assert.equal(formattaBps("n/d"), "n/d");
  });
});

describe("RAID", () => {
  it("livello: dal tipo dei volumi (QNAP), dal mdstat di dati senza i md di sistema (Synology)", () => {
    assert.equal(livelloRaid(NAS_QNAP), "RAID 6");
    assert.equal(livelloRaid(NAS_SYNOLOGY), "RAID 6");
    assert.equal(livelloRaid({ vendor: "synology", sources: ["snmp"], snmp: {} }), null);
  });
  it("stato: normale; un gruppo degradato porta tutto in attenzione", () => {
    assert.deepEqual(statoRaid(NAS_SYNOLOGY), { ok: true, testo: "normale" });
    const male = { ...NAS_SYNOLOGY, snmp: { ...NAS_SYNOLOGY.snmp, raids: [{ name: "Storage Pool 1", status: "11" }] } };
    assert.deepEqual(statoRaid(male), { ok: false, testo: "degradato" });
    assert.equal(statoRaid({ vendor: "qnap", sources: ["snmp"], snmp: {} }), null);
  });
});

describe("striscia e servizi", () => {
  it("QNAP: sei caselle con i dischi in attenzione e il motivo", () => {
    const c = caselleStorage(NAS_QNAP, "63 g");
    assert.deepEqual(c.map((x) => x.etichetta), ["Spazio usato", "Dischi", "RAID", "Volumi", "Temperatura", "Acceso da"]);
    const d = c.find((x) => x.etichetta === "Dischi")!;
    assert.equal(d.valore, "6 ✓ · 1");
    assert.equal(d.sotto, "▲ disco 5: SMART: warning");
    assert.equal(d.attenzione, true);
    assert.equal(c.find((x) => x.etichetta === "Spazio usato")!.attenzione, undefined);
  });
  it("senza dati nessuna casella", () => {
    assert.deepEqual(caselleStorage({ vendor: "synology", sources: ["snmp"], snmp: {} }, null), []);
  });
  it("stato servizio", () => {
    assert.deepEqual(statoServizio("running"), { segno: "✓", testo: "attivo" });
    assert.deepEqual(statoServizio("stopped"), { segno: "●", testo: "spento" });
    assert.deepEqual(statoServizio("12"), { segno: "●", testo: "12" });
  });
});
