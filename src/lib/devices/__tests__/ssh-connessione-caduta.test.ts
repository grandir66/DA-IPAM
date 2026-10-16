// Revisione del Task 4 di T2 (zona rossa: letture nuove sui router dei clienti). Una connessione che cade durante un
// comando (riavvio, rete che cade) chiude il canale SENZA codice d'uscita, ed `execConTempo` risolveva con l'uscita
// tagliata: il giro la prendeva per «letto» e scriveva mezza tabella come se fosse intera. Adesso è «non so», col codice
// CONNESSIONE_CADUTA, e quel comando non dà niente da scrivere; i comandi dopo non partono. Lo stesso per MK2 dei router,
// che arriva da `sshExec` (il giro di oggi): l'uscita tagliata resta al giro di oggi com'era, ma non passa alle letture in
// più. In più (B3): un `exec` che lancia subito non lascia acceso il timer del tempo massimo.
//
// Server ssh2 in memoria su 127.0.0.1 (non un apparato, niente rete): un `exec` che scrive mezza uscita e poi chiude la
// connessione, o chiude il canale senza codice d'uscita. Portata dalla prova del revisore (revisione-canale-chiuso).
// Hub isolato importato per primo (il perché sta in support/hub-isolato).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Server, utils, type ServerChannel, type Connection } from "ssh2";
import type { AddressInfo } from "node:net";
import type { Client as SshClient } from "ssh2";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import { createRouterClient } from "@/lib/devices/router-client";
import { CODICE_CONNESSIONE_CADUTA, execConTempo, sshExec } from "@/lib/devices/ssh-transport";
import { COMANDI_MK, eseguiSuSsh, leggiMikrotikTopologia } from "@/lib/devices/mikrotik-letture";
import type { NetworkDevice } from "@/types";

const FX = path.join(__dirname, "fixtures");
const F = (n: string): string => fs.readFileSync(path.join(FX, n), "utf8");
const T = "TESTSSHCADUTA";
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

type Risposta = (comando: string, canale: ServerChannel, client: Connection) => void;
/** Un server ssh2 in memoria: ogni `exec` lo decide `risposta`. */
async function serverSsh(risposta: Risposta): Promise<{ porta: number; chiudi: () => void }> {
  const chiave = utils.generateKeyPairSync("ed25519");
  const srv = new Server({ hostKeys: [chiave.private] }, (client) => {
    client.on("authentication", (ctx) => ctx.accept());
    client.on("ready", () => {
      client.on("session", (accetta) => {
        const s = accetta();
        s.on("exec", (acc, _rif, info) => risposta(info.command, acc(), client));
      });
    });
    client.on("error", () => { /* la connessione chiusa dal server stesso */ });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { porta: (srv.address() as AddressInfo).port, chiudi: () => srv.close() };
}
const finisce = (canale: ServerChannel, out: string): void => { canale.write(out); canale.exit(0); canale.end(); };
const opz = (porta: number) => ({ host: "127.0.0.1", port: porta, username: "u", password: "p" });

test("la connessione cade a metà di un comando: «non so» col codice CONNESSIONE_CADUTA, mai l'uscita tagliata; i comandi dopo non partono", async () => {
  const visti: string[] = [];
  const srv = await serverSsh((cmd, canale, client) => {
    visti.push(cmd);
    if (cmd === COMANDI_MK.porteBridge) {
      // Mezza riga di MK4, poi la connessione cade: nessun codice d'uscita.
      canale.write(" 0   interface=ether1 bridge=BR_RP pvid=1\r\n 1 I interface=eth");
      setTimeout(() => client.end(), 50);
      return;
    }
    finisce(canale, cmd === COMANDI_MK.interfacce ? F("mikrotik-mk2-testa.txt") : "");
  });
  try {
    const r = await eseguiSuSsh(opz(srv.porta), (esegui) => leggiMikrotikTopologia(esegui, { uscitaInterfacce: null, conVicini: false }));
    assert.ok(r.lettura.interfacce && r.lettura.interfacce.length > 0, "il comando finito prima resta letto");
    assert.equal(r.lettura.porteBridge, null, "l'uscita tagliata non è «letto»");
    assert.deepEqual([r.lettura.monitorBridge, r.lettura.monitorPorte, r.lettura.fasci, r.lettura.monitorFasci], [null, null, null, null]);
    assert.equal(r.codice, CODICE_CONNESSIONE_CADUTA);
    assert.deepEqual(visti, [COMANDI_MK.interfacce, COMANDI_MK.bridge, COMANDI_MK.porteBridge], "dopo la caduta nessun comando parte");
  } finally {
    srv.chiudi();
  }
});

test("un canale chiuso senza codice d'uscita, con la connessione ancora su: «non so» anche lui", async () => {
  const srv = await serverSsh((_cmd, canale) => { canale.write(" 0   name=bridge"); canale.end(); });
  try {
    await assert.rejects(eseguiSuSsh(opz(srv.porta), (esegui) => esegui(COMANDI_MK.bridge, 5_000)),
      (e: unknown) => (e as { code?: unknown }).code === CODICE_CONNESSIONE_CADUTA);
  } finally {
    srv.chiudi();
  }
});

test("MK2 dei router (sshExec, giro di oggi): l'uscita tagliata resta al giro di oggi, ma non passa alle letture in più", async () => {
  const mk2 = F("mikrotik-mk2-testa.txt");
  let tagliata = true;
  const srv = await serverSsh((cmd, canale, client) => {
    if (tagliata) {
      canale.write(mk2.slice(0, Math.floor(mk2.length / 2)));
      setTimeout(() => client.end(), 50);
      return;
    }
    finisce(canale, mk2);
  });
  try {
    const caduto = await sshExec(opz(srv.porta), COMANDI_MK.interfacce);
    assert.equal(caduto.code, undefined, "sshExec risolve senza codice: chi la usa deve guardarlo");
    const device = withTenant(T, () => {
      getTenantDb(T).exec("DELETE FROM network_devices");
      // La credenziale nel binding d'archivio: dalla 2g (T26) le colonne dell'apparato non si leggono più.
      getTenantDb(T).prepare("INSERT INTO network_devices (id, name, host, port, device_type, vendor, protocol, enabled) "
        + "VALUES (1, 'RTR-1', '127.0.0.1', ?, 'router', 'mikrotik', 'ssh', 1)").run(srv.porta);
      const voce = Number(getTenantDb(T).prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('RTR-1 · SSH', 'ssh', ?, ?)")
        .run(encrypt("u"), encrypt("p")).lastInsertRowid);
      getTenantDb(T).prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (1, ?, 'ssh', ?, 0)")
        .run(voce, srv.porta);
      return getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = 1").get() as NetworkDevice;
    });
    const client = await withTenant(T, () => createRouterClient(device));
    assert.ok((await client.getInterfaceTypes!()).size > 0, "il giro di oggi legge quel che è arrivato, come prima");
    assert.equal(client.ultimaUscitaInterfacce!(), null, "l'uscita tagliata non diventa MK2 «letto»");
    tagliata = false;
    await client.getInterfaceTypes!();
    assert.equal(client.ultimaUscitaInterfacce!(), mk2, "finita col suo codice d'uscita: passa");
  } finally {
    srv.chiudi();
  }
});

test("B3: un exec che lancia subito non lascia acceso il timer del tempo massimo", async () => {
  const timer = (): number => process.getActiveResourcesInfo().filter((x) => x === "Timeout").length;
  const prima = timer();
  const conn = { exec() { throw new Error("Not connected"); } } as unknown as Pick<SshClient, "exec">;
  await assert.rejects(execConTempo(conn, COMANDI_MK.bridge, 60_000), /Not connected/);
  assert.equal(timer(), prima, "nessun timer da 60 s acceso dopo il rifiuto");
});
