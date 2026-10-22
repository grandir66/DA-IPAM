// SN1 (spec §13.5.4): la lettura a mano dello spanning tree apriva UNA sessione e la chiudeva alla fine del primo walk:
// gli altri otto, partiti insieme, finivano annullati. Il falso agente fa come net-snmp: chiudere una sessione annulla le
// sue richieste ancora aperte (`Session.close` → `onClose` → `cancelRequests`). Con una sessione per lettura ogni walk
// arriva in fondo.
//
// In più (livello completo): il tempo massimo per lettura è 10 secondi; una sessione che non si apre rifiuta col suo
// errore; la sessione riceve solo `subtree` e `close` (nessuna scrittura sull'apparato).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getSnmpStpInfo } from "@/lib/devices/snmp-stp-info";
import { TEMPO_WALK_MS, getConSessioneSua, walkConSessioneSua, type SessioneGet, type SessioneWalk, type VoceSnmp } from "@/lib/devices/snmp-walk";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";

const B = "1.3.6.1.2.1.17";
const VALORI: Record<string, Array<[string, Buffer | number]>> = {
  [`${B}.1.1`]: [[`${B}.1.1.0`, Buffer.from([2, 0, 0, 0, 0, 0x11])]],
  [`${B}.2.2`]: [[`${B}.2.2.0`, 32768]],
  [`${B}.2.5`]: [[`${B}.2.5.0`, Buffer.from([0x10, 0, 2, 0, 0, 0, 0, 0x01])]],
  [`${B}.2.6`]: [[`${B}.2.6.0`, 4]],
  [`${B}.2.7`]: [[`${B}.2.7.0`, 3]],
  [`${B}.2.8`]: [[`${B}.2.8.0`, 2000]],
  [`${B}.2.9`]: [[`${B}.2.9.0`, 200]],
  [`${B}.2.11`]: [[`${B}.2.11.0`, 1500]],
  [`${B}.2.1`]: [[`${B}.2.1.0`, 3]],
};

function agente(ritardoMs = 5) {
  let sessioni = 0;
  const metodi: string[] = [];
  const apri = (): SessioneWalk => {
    sessioni++;
    let chiusa = false;
    const attese: Array<() => void> = [];
    return {
      subtree(oid, feed, done) {
        metodi.push("subtree");
        let fatto = false;
        const fine = (err?: Error) => { if (!fatto) { fatto = true; done(err); } };
        attese.push(() => fine(new Error("richiesta annullata: sessione chiusa")));
        setTimeout(() => {
          if (chiusa) return fine(new Error("sessione chiusa"));
          feed((VALORI[oid] ?? []).map(([o, v]) => ({ oid: o, value: v })));
          fine();
        }, ritardoMs);
      },
      close() {
        metodi.push("close");
        chiusa = true;
        for (const a of attese.splice(0)) a();
      },
    };
  };
  return { apri, sessioni: () => sessioni, metodi };
}

test("il falso agente riproduce il difetto: una sessione condivisa chiusa dal primo walk annulla gli altri", async () => {
  const a = agente();
  const s = a.apri();
  const condivisa = (oid: string) => new Promise<VoceSnmp[]>((resolve) => {
    const out: VoceSnmp[] = [];
    s.subtree(oid, (vbs) => { for (const vb of vbs) out.push({ oid: vb.oid, value: vb.value as VoceSnmp["value"] }); }, (err) => { s.close(); resolve(err ? [] : out); });
  });
  const info = await getSnmpStpInfo(condivisa);
  assert.ok(info === null || info.priority === null || info.root_cost === null, "con la sessione condivisa si perdono valori");
});

test("SN1: una sessione per lettura, e ogni valore arriva", async () => {
  const a = agente();
  const info = await getSnmpStpInfo(walkConSessioneSua(a.apri, 1000));
  assert.deepEqual([info?.priority, info?.root_cost, info?.root_port, info?.max_age_s, info?.is_root_bridge], [32768, 4, "3", 20, false]);
  assert.equal(a.sessioni(), 9, "nove letture, nove sessioni");
});

test("un walk che non risponde: TEMPO_SCADUTO, e chiude solo la sua sessione", async () => {
  const a = agente(500);
  await assert.rejects(walkConSessioneSua(a.apri, 30)(`${B}.2.2`), (e: unknown) => codiceErrore(e) === "TEMPO_SCADUTO");
});

test("il tempo massimo di una lettura nuova è 10 secondi (piano di T2, «Scelte» punto 2)", () => {
  assert.equal(TEMPO_WALK_MS, 10_000);
});

test("una sessione che non si apre: il walk rifiuta col suo errore, non con una lista vuota", async () => {
  const walk = walkConSessioneSua(() => { throw Object.assign(new Error("indirizzo non valido"), { code: "SESSIONE_NON_APERTA" }); }, 1000);
  await assert.rejects(walk(`${B}.2.2`), (e: unknown) => codiceErrore(e) === "SESSIONE_NON_APERTA");
});

test("un errore dell'agente («no»): rifiuta col suo stato SNMP come codice, non diventa «vuoto», e la sessione si chiude", async () => {
  let chiusa = 0;
  // Come net-snmp: RequestFailedError porta lo stato della risposta in `status` (5 = genErr) e nessun `code`.
  const walk = walkConSessioneSua(() => ({
    subtree(_oid, _feed, done) { setTimeout(() => done(Object.assign(new Error("genErr"), { status: 5 })), 1); },
    close() { chiusa++; },
  }), 1000);
  await assert.rejects(walk(`${B}.2.2`), (e: unknown) => codiceErrore(e) === "SNMP_STATO_5");
  assert.equal(chiusa, 1);
});

// 70151, 22/10: gli switch Comware IRF rispondono «tooBig» (stato 1) al GETBULK di 20 righe sulle tabelle Q-BRIDGE (liste di
// porte lunghe): VLAN e porte taggate mancavano (2 walk riuscite su 7). Il walk si rifà da capo a blocchi più piccoli.
function agenteTooBig(sopra: number) {
  const blocchi: Array<number | undefined> = [];
  let chiuse = 0;
  const apri = (): SessioneWalk => {
    const s = {
      subtree(oid: string, a: unknown, b: unknown, c?: unknown) {
        const [rip, feed, done] = (typeof a === "number" ? [a, b, c] : [undefined, a, b]) as [number | undefined, (v: Array<{ oid: string; value: unknown }>) => void, (e?: Error) => void];
        blocchi.push(rip);
        setTimeout(() => {
          if ((rip ?? 20) > sopra) return done(Object.assign(new Error("tooBig"), { status: 1 }));
          feed([{ oid: `${oid}.1`, value: Buffer.alloc(64) }]);
          feed([{ oid: `${oid}.2`, value: Buffer.alloc(64) }]);
          done();
        }, 1);
      },
      close() { chiuse++; },
    };
    return s as unknown as SessioneWalk;
  };
  return { apri, blocchi, chiuse: () => chiuse };
}

test("tooBig: il walk riprova a blocchi più piccoli (5, poi 1) e dà la tabella intera, una sessione per tentativo", async () => {
  const a = agenteTooBig(5);
  const voci = await walkConSessioneSua(a.apri, 1000)(`${B}.7.1.4.3.1.2`);
  assert.deepEqual(a.blocchi, [undefined, 5]);
  assert.equal(voci.length, 2);
  assert.equal(a.chiuse(), 2);
  const b = agenteTooBig(1);
  assert.equal((await walkConSessioneSua(b.apri, 1000)(`${B}.7.1.4.3.1.2`)).length, 2);
  assert.deepEqual(b.blocchi, [undefined, 5, 1]);
});

test("tooBig anche a 1 riga per richiesta: rifiuta con SNMP_STATO_1, non dà una tabella vuota", async () => {
  const a = agenteTooBig(0);
  await assert.rejects(walkConSessioneSua(a.apri, 1000)(`${B}.7.1.4.3.1.2`), (e: unknown) => codiceErrore(e) === "SNMP_STATO_1");
  assert.deepEqual(a.blocchi, [undefined, 5, 1]);
  assert.equal(a.chiuse(), 3);
});

test("sola lettura: la sessione riceve solo subtree e close, una chiusura per lettura", async () => {
  const a = agente();
  const walk = walkConSessioneSua(a.apri, 1000);
  await walk(`${B}.2.2`);
  await walk(`${B}.2.6`);
  assert.deepEqual(a.metodi, ["subtree", "close", "subtree", "close"]);
  const testo = fs.readFileSync(path.join(__dirname, "..", "snmp-walk.ts"), "utf8");
  assert.doesNotMatch(testo, /\.set\s*\(|createSession\s*\(/, "niente set SNMP, niente sessioni aperte qui (snmp-sessione.ts, ADR 0016)");
});

// Revisione del Task 6 di T2 (C7): una lettura che riceve una parte delle voci e poi un errore (la sessione cade a metà del
// walk) rifiuta: mezza tabella non è «letta».
test("dati parziali poi errore: il walk rifiuta, non dà la metà arrivata", async () => {
  const walk = walkConSessioneSua(() => ({
    subtree(_oid, feed, done) {
      feed([{ oid: `${B}.2.15.1.3.1`, value: 5 }]);
      setTimeout(() => done(Object.assign(new Error("socket chiuso"), { code: "ECONNRESET" })), 1);
    },
    close() { /* niente */ },
  }), 1000);
  await assert.rejects(walk(`${B}.2.15.1.3`), (e: unknown) => codiceErrore(e) === "ECONNRESET");
});

// Revisione del Task 6 di T2 (C3, piano «Scelte» 10): gli scalari dello spanning tree con un GET solo. In v2c chi non c'è lo
// dice il varbind (noSuchObject/noSuchInstance); in v1 lo stato «noSuchName» vale per tutta la richiesta, e allora si
// chiede un OID alla volta. Ogni altro stato è un «no»; nessuna risposta, «non so».
function sessioneGet(risposte: Array<(oids: string[]) => { err?: Error; vbs?: Array<{ oid: string; value: unknown; type?: number }> } | null>) {
  const chieste: string[][] = [];
  let chiusa = 0;
  const apri = (): SessioneGet => ({
    get(oids, cb) {
      chieste.push(oids);
      const r = risposte[chieste.length - 1]?.(oids) ?? null;
      if (r) setTimeout(() => cb(r.err ?? null, r.vbs), 1);
    },
    close() { chiusa++; },
  });
  return { apri, chieste, chiuse: () => chiusa };
}
const SC = [`${B}.2.2.0`, `${B}.2.5.0`, `${B}.2.16.0`];

test("GET degli scalari, v2c: le voci presenti; chi non c'è (noSuchObject) manca; una sessione, chiusa una volta", async () => {
  const s = sessioneGet([(oids) => ({ vbs: oids.map((oid, i) => (i === 2 ? { oid, value: null, type: 128 } : { oid, value: i + 1, type: 2 })) })]);
  const out = await getConSessioneSua(s.apri, 1000)(SC);
  assert.deepEqual(out, [{ oid: SC[0], value: 1 }, { oid: SC[1], value: 2 }]);
  assert.deepEqual([s.chieste.length, s.chiuse()], [1, 1]);
});

test("GET degli scalari, v1: «noSuchName» per la richiesta intera → un OID alla volta, chi non c'è manca", async () => {
  const noSuchName = () => ({ err: Object.assign(new Error("NoSuchName"), { status: 2 }) });
  const s = sessioneGet([noSuchName, (o) => ({ vbs: [{ oid: o[0], value: 32768 }] }), (o) => ({ vbs: [{ oid: o[0], value: Buffer.from([1]) }] }), noSuchName]);
  const out = await getConSessioneSua(s.apri, 1000)(SC);
  assert.deepEqual(out.map((v) => v.oid), [SC[0], SC[1]]);
  assert.deepEqual(s.chieste, [SC, [SC[0]], [SC[1]], [SC[2]]]);
  assert.equal(s.chiuse(), 1);
});

test("GET degli scalari: un altro stato è un «no» col suo codice; nessuna risposta è TEMPO_SCADUTO", async () => {
  const genErr = sessioneGet([() => ({ err: Object.assign(new Error("genErr"), { status: 5 }) })]);
  await assert.rejects(getConSessioneSua(genErr.apri, 1000)(SC), (e: unknown) => codiceErrore(e) === "SNMP_STATO_5");
  const muto = sessioneGet([() => null]);
  await assert.rejects(getConSessioneSua(muto.apri, 30)(SC), (e: unknown) => codiceErrore(e) === "TEMPO_SCADUTO");
  assert.equal(muto.chiuse(), 1);
});
