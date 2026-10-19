/**
 * stati_componenti del segnale quando trasmette DA-IPAM su una base modulare (19/10).
 *
 * Collaudo M5.1 sulla VM 900: con IPAM acceso DA-Link mostrava ancora l'ultima
 * fotografia della base («ipam disattivato»), perché DA-IPAM non mandava il campo.
 * Le regole sono quelle di Deploy-Appliance `scripts/segnale-base.py`.
 * Dipendenze sempre finte: la prova non legge /etc della macchina che la esegue.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { statiComponentiBase, statoEdge, type DipendenzeStati, type EsitoComando } from "../stati-componenti";
import { costruisciSegnale, type FattiIstanza } from "../segnale";

function dip(file: Record<string, string>, docker: EsitoComando | Error): DipendenzeStati {
  return {
    esiste: (p) => p in file,
    leggi: (p) => {
      if (p in file) return file[p];
      throw new Error("ENOENT");
    },
    docker: async () => {
      if (docker instanceof Error) throw docker;
      return docker;
    },
  };
}

const MODULARE = "/etc/da-appliance/modules/modular-v1";
const FASE = "/etc/da-appliance/modules/edge.state";
const ASSENTE: EsitoComando = { codice: 1, stdout: "", stderr: "Error: No such object: appliance-edge" };
const acceso = (s: string): EsitoComando => ({ codice: 0, stdout: `${s}\n`, stderr: "" });

test("fuori dalle basi modulari il campo non si manda", async () => {
  assert.equal(await statiComponentiBase(dip({}, acceso("running|healthy"))), null);
});

test("operativo solo da container healthy, mai dal file-segno", async () => {
  const casi: Array<[string | null, EsitoComando, string | null]> = [
    ["operativo", ASSENTE, "errore"],
    ["inizializzazione", ASSENTE, "inizializzazione"], // build/pull in corso
    ["inizializzazione", acceso("exited|"), "errore"],
    ["inizializzazione", acceso("running|healthy"), "operativo"],
    ["inizializzazione", acceso("running|starting"), "inizializzazione"],
    ["operativo", acceso("running|unhealthy"), "errore"],
    ["operativo", acceso("restarting|starting"), "errore"], // crash-loop
    ["dati_da_scaricare", ASSENTE, "dati_da_scaricare"],
    ["disattivato", acceso("exited|"), "disattivato"],
    [null, ASSENTE, null],
  ];
  for (const [fase, docker, atteso] of casi) {
    const file: Record<string, string> = fase ? { [FASE]: `${fase}\n` } : {};
    assert.equal(await statoEdge(dip(file, docker)), atteso, `${fase} + ${docker.stdout || docker.stderr}`);
  }
});

test("Docker che non risponde: edge omesso (non so), IPAM resta operativo", async () => {
  const muto: EsitoComando = { codice: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
  const file = { [MODULARE]: "", [FASE]: "operativo\n" };
  assert.deepEqual(await statiComponentiBase(dip(file, muto)), { ipam: { stato: "operativo" } });
  assert.deepEqual(await statiComponentiBase(dip(file, new Error("spawn docker ENOENT"))), {
    ipam: { stato: "operativo" },
  });
});

test("base modulare con Edge sano: ipam ed edge operativi nel corpo del segnale", async () => {
  const stati = await statiComponentiBase(dip({ [MODULARE]: "", [FASE]: "inizializzazione\n" }, acceso("running|healthy")));
  assert.deepEqual(stati, { ipam: { stato: "operativo" }, edge: { stato: "operativo" } });
  const fatti: FattiIstanza = {
    versione: "0.3.999",
    moduli: {},
    salute: {},
    ultimoErrore: null,
    porte: [],
    statiComponenti: stati,
  };
  const corpo = costruisciSegnale({ codcli: "70791", nodo: "70791-ipam" }, "solo_stato", fatti, () => null);
  assert.deepEqual(corpo.stati_componenti, stati);
  const senza = costruisciSegnale({ codcli: "70791", nodo: "70791-ipam" }, "solo_stato", { ...fatti, statiComponenti: null }, () => null);
  assert.equal("stati_componenti" in senza, false, "fuori dalle basi modulari il campo è assente, non null");
});
