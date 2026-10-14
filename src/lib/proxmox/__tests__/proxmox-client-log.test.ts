// Il job hypervisor_sync (fase 2b) gira da solo ogni giorno: nel log non devono
// finire nomi dei nodi né indirizzi. extractAll scriveva il nome del nodo e
// l'errore intero (che può contenere l'IP) a ogni nodo non letto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProxmoxClient, type ProxmoxHostInfo, type ProxmoxNodeInfo, type ProxmoxVM } from "@/lib/proxmox/proxmox-client";

class ClientGiu extends ProxmoxClient {
  async login(): Promise<void> {}
  async getNodes(): Promise<ProxmoxNodeInfo[]> {
    return [{ node: "pve-segreto-a" }, { node: "pve-segreto-b" }] as unknown as ProxmoxNodeInfo[];
  }
  async getHostInfo(): Promise<ProxmoxHostInfo> {
    throw new Error("connect ECONNREFUSED 192.0.2.11:8006");
  }
  async getVMs(): Promise<ProxmoxVM[]> {
    throw new Error("401 su https://192.0.2.11:8006/api2/json/nodes/pve-segreto-a/qemu");
  }
  async getContainers(): Promise<ProxmoxVM[]> {
    throw new Error("timeout 192.0.2.11");
  }
}

test("extractAll: un nodo non letto lascia nel log solo la posizione e il tipo d'errore, mai nome o indirizzo", async () => {
  const righe: string[] = [];
  const orig = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  const prendi = (...a: unknown[]) => righe.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(" "));
  console.info = prendi; console.warn = prendi; console.error = prendi; console.log = prendi;
  try {
    const r = await new ClientGiu({ host: "https://192.0.2.11:8006", username: "root@pam", password: "x", verifySsl: false }).extractAll({ includeContainers: true });
    assert.deepEqual(r, { hosts: [], vms: [] });
  } finally {
    Object.assign(console, orig);
  }
  assert.equal(righe.length, 6);
  for (const r of righe) assert.doesNotMatch(r, /pve-segreto|192\.0\.2\./, r);
  assert.match(righe[0], /nodo 1 di 2/);
});
