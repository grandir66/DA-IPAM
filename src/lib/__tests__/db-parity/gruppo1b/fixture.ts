/**
 * Dati di partenza comuni ai banchi di parità del gruppo 1b (T3-06): la forma
 * è quella che scrivono discovery, scansioni e pagine (reti, host con la
 * categoria di attribuzione, credenziali dei quattro tipi, un apparato legato
 * a un host con le sue associazioni di credenziali). Valori inventati.
 *
 * Gli id coincidono sui due tenant del banco, che partono vuoti.
 */
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { eseguiParita, type CasoParita, type EsitoParita } from "../harness";

export const RETE_UFFICI = 1;
export const RETE_SERVER = 2;
/** Host 1-4 nella rete uffici, 5-6 nella rete server. */
export const HOST = { switchCore: 1, pcAmmin: 2, server: 3, nas: 4, srvDb: 5, srvWeb: 6 } as const;
/** Credenziali 1-5. */
export const CRED = { ssh: 1, snmp: 2, windows: 3, linux: 4, sshBis: 5 } as const;
/** Apparato 1 = switch core (host 1), apparato 2 = router (nessun host). */
export const APPARATO = { switchCore: 1, router: 2 } as const;

export function retiHostCredenziali(db: Database.Database): void {
  const rete = db.prepare("INSERT INTO networks (cidr, name, gateway, vlan_id) VALUES (?, ?, ?, ?)");
  rete.run("10.40.0.0/24", "Uffici", "10.40.0.1", 10);
  rete.run("10.41.0.0/24", "Server", "10.41.0.1", 20);
  const host = db.prepare(
    "INSERT INTO hosts (network_id, ip, mac, hostname, vendor, status, attr_category, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  host.run(RETE_UFFICI, "10.40.0.2", "00:1A:2B:3C:4D:01", "sw-core", "HP", "online", "network.switch", null);
  host.run(RETE_UFFICI, "10.40.0.20", "00:1A:2B:3C:4D:02", "pc-ammin", "Dell", "online", "compute.workstation", "");
  host.run(RETE_UFFICI, "10.40.0.30", null, "srv-file", null, "offline", "compute.server", "[2026-01-02] nota vecchia");
  host.run(RETE_UFFICI, "10.40.0.40", "00:1A:2B:3C:4D:04", "nas-01", "Synology", "online", "storage.nas", null);
  host.run(RETE_SERVER, "10.41.0.10", "00:1A:2B:3C:4D:05", "srv-db", "Dell", "online", "compute.server", null);
  host.run(RETE_SERVER, "10.41.0.11", "00:1A:2B:3C:4D:06", "srv-web", "Dell", "unknown", "unknown", null);
  const cred = db.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)");
  cred.run("SSH amministrazione", "ssh", "u-cifrato", "p-cifrata");
  cred.run("SNMP lettura", "snmp", null, "c-cifrata");
  cred.run("Dominio Windows", "windows", "u-cifrato", "p-cifrata");
  cred.run("Linux root", "linux", "u-cifrato", "p-cifrata");
  cred.run("SSH backup", "ssh", "u-cifrato", "p-cifrata");
  // Id espliciti: le migrazioni all'apertura del tenant lasciano il contatore di
  // network_devices già avanzato, e i casi del banco nominano gli apparati per id.
  const app = db.prepare(
    "INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, host_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  app.run(APPARATO.switchCore, "sw-core", "10.40.0.2", "switch", "hp", "snmp_v2", HOST.switchCore);
  app.run(APPARATO.router, "gw-sede", "10.40.0.1", "router", "mikrotik", "ssh", null);
  const lega = db.prepare(
    "INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (?, ?, ?, ?, ?)",
  );
  lega.run(APPARATO.switchCore, CRED.snmp, "snmp", 161, 0);
  lega.run(APPARATO.switchCore, CRED.ssh, "ssh", 22, 1);
  lega.run(APPARATO.router, CRED.ssh, "ssh", 22, 0);
  const nc = db.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)");
  nc.run(RETE_UFFICI, CRED.ssh, 0);
  nc.run(RETE_UFFICI, CRED.snmp, 1);
  nc.run(RETE_SERVER, CRED.snmp, 0);
  const hc = db.prepare(
    "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
  );
  hc.run(HOST.switchCore, CRED.snmp, "snmp", 161, 1, 0);
  hc.run(HOST.pcAmmin, CRED.windows, "winrm", 5985, 0, 0);
  hc.run(HOST.server, CRED.ssh, "ssh", 22, 1, 0);
}

/** Il caso deve dare lo stesso valore e le stesse tabelle sulle due copie. */
export function stessoEsito<R>(caso: CasoParita<R>): EsitoParita<R> {
  const e = eseguiParita(caso);
  assert.deepEqual(e.valoreTenant, e.valoreFacciata, `${caso.nome}: valore restituito diverso`);
  assert.deepEqual(e.tabelleTenant, e.tabelleFacciata, `${caso.nome}: tabelle diverse dopo la chiamata`);
  return e;
}

/** Il caso deve fallire con lo stesso messaggio sulle due copie. */
export function stessoErrore(caso: CasoParita<unknown>): string {
  const msg = (f: () => unknown) => {
    try {
      f();
    } catch (err) {
      return (err as Error).message;
    }
    return "nessun errore";
  };
  let mFacciata = "";
  let mTenant = "";
  eseguiParita({
    ...caso,
    facciata: () => (mFacciata = msg(caso.facciata)),
    tenant: () => (mTenant = msg(caso.tenant)),
  });
  assert.notEqual(mFacciata, "nessun errore", `${caso.nome}: la copia della facciata non ha lanciato`);
  assert.equal(mTenant, mFacciata, `${caso.nome}: messaggi d'errore diversi`);
  return mTenant;
}
