// SNMPv1: un GET con più OID è tutto o niente. Se l'agente non ha anche uno
// solo degli OID risponde NoSuchName e non restituisce nemmeno gli altri.
// DTS, 2026-10-15: gli access point Ubiquiti 172.16.3.4-6 parlano solo v1 e
// non hanno ENTITY-MIB, quindi la lettura dati (sysDescr, sysName, seriale…)
// non salvava niente. Forma dell'errore presa da net-snmp 3.26.1
// (RequestFailedError con status 2 = NoSuchName).
import { test } from "node:test";
import assert from "node:assert/strict";
import { snmpGetTollerante, type SnmpGetSession, type SnmpVarbind } from "@/lib/devices/snmp-get-tollerante";

const SYSDESCR = "1.3.6.1.2.1.1.1.0";
const SYSNAME = "1.3.6.1.2.1.1.5.0";
const SERIALE = "1.3.6.1.2.1.47.1.1.1.1.11.1";

function noSuchName(oid: string): Error {
  return Object.assign(new Error(`NoSuchName: ${oid}`), { name: "RequestFailedError", status: 2 });
}

/** Agente v1 finto: ha solo gli OID in `valori`, risponde tutto o niente. */
function agenteV1(valori: Record<string, string>, richieste: string[][] = []): SnmpGetSession {
  return {
    get(oids, cb) {
      richieste.push(oids);
      const mancante = oids.find((o) => !(o in valori));
      if (mancante) return cb(noSuchName(mancante), []);
      cb(null, oids.map((oid) => ({ oid, value: Buffer.from(valori[oid]) })));
    },
  };
}

const comeTesto = (vbs: SnmpVarbind[]) => vbs.map((v) => [v.oid, String(v.value)]);

test("v1 con un OID mancante: rifà le richieste una per una e tiene quelli presenti", async () => {
  const richieste: string[][] = [];
  const s = agenteV1({ [SYSDESCR]: "Linux 2.6.33 armv5", [SYSNAME]: "ap-1" }, richieste);
  const vbs = await snmpGetTollerante(s, [SYSDESCR, SYSNAME, SERIALE]);
  assert.deepEqual(comeTesto(vbs), [[SYSDESCR, "Linux 2.6.33 armv5"], [SYSNAME, "ap-1"]]);
  assert.equal(richieste.length, 4, "una di gruppo + tre singole");
});

test("tutti gli OID presenti: una sola richiesta", async () => {
  const richieste: string[][] = [];
  const s = agenteV1({ [SYSDESCR]: "d", [SYSNAME]: "n" }, richieste);
  const vbs = await snmpGetTollerante(s, [SYSDESCR, SYSNAME]);
  assert.equal(vbs.length, 2);
  assert.equal(richieste.length, 1);
});

test("un errore che non è NoSuchName passa com'è: non lo si trasforma in «nessun dato»", async () => {
  const s: SnmpGetSession = {
    get(_oids, cb) {
      cb(Object.assign(new Error("Request timed out"), { name: "RequestTimedOutError" }), []);
    },
  };
  await assert.rejects(snmpGetTollerante(s, [SYSDESCR, SYSNAME]), /timed out/);
});

test("nel giro singolo un errore diverso da NoSuchName ferma tutto", async () => {
  let n = 0;
  const s: SnmpGetSession = {
    get(oids, cb) {
      n++;
      if (n === 1) return cb(noSuchName(SERIALE), []);
      if (oids[0] === SYSNAME) return cb(Object.assign(new Error("Request timed out"), { name: "RequestTimedOutError" }), []);
      cb(null, oids.map((oid) => ({ oid, value: "x" })));
    },
  };
  await assert.rejects(snmpGetTollerante(s, [SYSDESCR, SYSNAME, SERIALE]), /timed out/);
});

test("v2c: i varbind noSuchObject restano nella risposta, nessun giro singolo", async () => {
  const richieste: string[][] = [];
  const s: SnmpGetSession = {
    get(oids, cb) {
      richieste.push(oids);
      cb(null, [{ oid: SYSDESCR, value: "d" }, { oid: SERIALE, value: null, type: 128 }]);
    },
  };
  const vbs = await snmpGetTollerante(s, [SYSDESCR, SERIALE]);
  assert.equal(vbs.length, 2);
  assert.equal(richieste.length, 1);
});
