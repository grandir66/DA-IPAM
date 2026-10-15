// La porta SSH di un hypervisor Proxmox (lettura via SSH e schede vive). `network_devices.port` è la porta
// dell'API (443/8006): usata per l'SSH, la connessione veniva rifiutata e le schede vive non si leggevano mai.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxmoxSshPort } from "@/lib/proxmox/proxmox-targets";

const b = (protocol_type: string, port: number | null, test_status = "untested") => ({ protocol_type, port, test_status });

test("senza credenziali SSH legate: 22, mai la porta dell'API", () => {
  assert.equal(proxmoxSshPort([]), 22);
  assert.equal(proxmoxSshPort([b("api", 8006, "success"), b("api", 443)]), 22);
});

test("la porta della credenziale SSH legata all'apparato; quella provata con successo prima delle altre", () => {
  assert.equal(proxmoxSshPort([b("api", 8006), b("ssh", 2222)]), 2222);
  assert.equal(proxmoxSshPort([b("ssh", 2201, "failed"), b("ssh", 2202, "success")]), 2202);
  assert.equal(proxmoxSshPort([b("ssh", 2201), b("ssh", 2202)]), 2201, "a pari esito, l'ordine delle credenziali");
});

test("una porta non valida nella riga non si usa: 22", () => {
  for (const p of [0, -1, 70000, null, 22.5]) assert.equal(proxmoxSshPort([b("ssh", p)]), 22, String(p));
});
