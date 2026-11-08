/**
 * Freno della cifratura per l'installazione «tecnico» (ADR 0037, piano 2026-11-08, Task 2).
 *
 * Sul PC del tecnico stanno i dati di più clienti: se il PC si perde devono restare chiusi.
 * La scelta è il disco cifrato (LUKS, o contenitore LUKS a file sulla cartella dati; FileVault
 * su macOS), non il DB cifrato. Con `DA_PROFILO=tecnico` l'app non parte se la cartella dati
 * non sta su un volume cifrato, e nemmeno se il controllo non sa rispondere (freno chiuso).
 *
 * Le uscite finte hanno la forma vera di `findmnt -no SOURCE --target` e di
 * `lsblk -s -r -n -o TYPE` (Debian 13, util-linux 2.41): una riga per dispositivo, dal
 * volume scelto verso il disco fisico.
 *
 * Run: node --import tsx --test src/lib/__tests__/profilo-cifratura.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { cifraturaCartella } from "@/lib/profilo-cifratura";

type Risposte = Record<string, string | Error>;
function finto(r: Risposte) {
  const chiamate: string[] = [];
  const esegui = (cmd: string, args: string[]): string => {
    const k = [cmd, ...args].join(" ");
    chiamate.push(k);
    const v = r[cmd];
    if (v === undefined) throw new Error(`comando non previsto: ${k}`);
    if (v instanceof Error) throw v;
    return v;
  };
  return { esegui, chiamate };
}

const DIR = os.tmpdir();

test("Linux, radice LUKS: cifrato", () => {
  const { esegui } = finto({ findmnt: "/dev/mapper/sda3_crypt\n", lsblk: "crypt\npart\ndisk\n" });
  const e = cifraturaCartella(DIR, { piattaforma: "linux", esegui });
  assert.equal(e.stato, "cifrato");
});

test("Linux, contenitore LUKS a file montato sulla cartella dati: cifrato", () => {
  const { esegui, chiamate } = finto({ findmnt: "/dev/mapper/daipam-dati\n", lsblk: "crypt\nloop\n" });
  assert.equal(cifraturaCartella(DIR, { piattaforma: "linux", esegui }).stato, "cifrato");
  assert.ok(chiamate.some((c) => c === "lsblk -s -r -n -o TYPE /dev/mapper/daipam-dati"), chiamate.join(" | "));
});

test("Linux, sottovolume btrfs (SOURCE con [/@]): si guarda il dispositivo", () => {
  const { esegui, chiamate } = finto({ findmnt: "/dev/mapper/root[/@]\n", lsblk: "crypt\npart\ndisk\n" });
  assert.equal(cifraturaCartella(DIR, { piattaforma: "linux", esegui }).stato, "cifrato");
  assert.ok(chiamate.includes("lsblk -s -r -n -o TYPE /dev/mapper/root"));
});

test("Linux, disco in chiaro (come la VM 533): in chiaro", () => {
  const { esegui } = finto({ findmnt: "/dev/sda1\n", lsblk: "part\ndisk\n" });
  assert.equal(cifraturaCartella(DIR, { piattaforma: "linux", esegui }).stato, "in_chiaro");
});

test("Linux, LVM in chiaro: in chiaro (lvm non è crypt)", () => {
  const { esegui } = finto({ findmnt: "/dev/mapper/vg-root\n", lsblk: "lvm\npart\ndisk\n" });
  assert.equal(cifraturaCartella(DIR, { piattaforma: "linux", esegui }).stato, "in_chiaro");
});

test("Linux, comandi che falliscono o sorgente non da blocco: non so", () => {
  assert.equal(cifraturaCartella(DIR, { piattaforma: "linux", esegui: finto({ findmnt: new Error("ENOENT") }).esegui }).stato, "non_so");
  assert.equal(cifraturaCartella(DIR, { piattaforma: "linux", esegui: finto({ findmnt: "\n" }).esegui }).stato, "non_so");
  assert.equal(cifraturaCartella(DIR, { piattaforma: "linux", esegui: finto({ findmnt: "tmpfs\n" }).esegui }).stato, "non_so");
  assert.equal(
    cifraturaCartella(DIR, { piattaforma: "linux", esegui: finto({ findmnt: "/dev/sda1\n", lsblk: new Error("exit 32") }).esegui }).stato,
    "non_so",
  );
  assert.equal(cifraturaCartella(DIR, { piattaforma: "linux", esegui: finto({ findmnt: "/dev/sda1\n", lsblk: "" }).esegui }).stato, "non_so");
});

test("cartella che non esiste ancora: si guarda la prima cartella che c'è sopra", () => {
  const { esegui, chiamate } = finto({ findmnt: "/dev/mapper/x\n", lsblk: "crypt\n" });
  cifraturaCartella(`${DIR}/non-esiste-${process.pid}/dati`, { piattaforma: "linux", esegui });
  assert.ok(chiamate[0].endsWith(`--target ${DIR}`), chiamate[0]);
});

test("macOS: FileVault acceso, spento, risposta strana", () => {
  assert.equal(cifraturaCartella(DIR, { piattaforma: "darwin", esegui: finto({ fdesetup: "FileVault is On.\n" }).esegui }).stato, "cifrato");
  assert.equal(cifraturaCartella(DIR, { piattaforma: "darwin", esegui: finto({ fdesetup: "FileVault is Off.\n" }).esegui }).stato, "in_chiaro");
  assert.equal(cifraturaCartella(DIR, { piattaforma: "darwin", esegui: finto({ fdesetup: "Encryption in progress\n" }).esegui }).stato, "non_so");
  assert.equal(cifraturaCartella(DIR, { piattaforma: "darwin", esegui: finto({ fdesetup: new Error("x") }).esegui }).stato, "non_so");
});

test("altro sistema: non so", () => {
  assert.equal(cifraturaCartella(DIR, { piattaforma: "win32", esegui: finto({}).esegui }).stato, "non_so");
});
