/**
 * Terzo tratto della perdita dei CPE (08/11/2026): dopo il parser (07/09) e i giri di discovery
 * (`portaDaSalvare`), anche la fusione delle porte salvate con quelle nuove (`parsePortsJson`
 * dentro `mergeOpenPortsJson`, in db-tenant.ts e nel facade db.ts) ricopiava solo quattro campi.
 * Prova vera sulla VM 533: scansione nmap di LAN Storage alle 13:40, «OpenSSH 10.5» salvato,
 * zero CPE. Le due copie si provano insieme perché devono restare uguali.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeOpenPortsJson as fusioneTenant } from "@/lib/db-tenant";
import { mergeOpenPortsJson as fusioneFacade } from "@/lib/db";

const salvate = JSON.stringify([{ port: 111, protocol: "tcp", service: "rpcbind", version: null }]);
const nuove = JSON.stringify([
  {
    port: 22, protocol: "tcp", service: "ssh", version: "OpenSSH 10.5",
    product: "OpenSSH", product_version: "10.5", cpes: ["cpe:/a:openbsd:openssh:10.5"],
    scripts: [{ id: "ssh-hostkey", output: "…" }],
  },
]);

for (const [nome, fondi] of [["db-tenant", fusioneTenant], ["db (facade)", fusioneFacade]] as const) {
  describe(`mergeOpenPortsJson (${nome}) — i CPE sopravvivono alla fusione`, () => {
    const porte = JSON.parse(fondi(salvate, nuove)) as Array<Record<string, unknown>>;
    const ssh = porte.find((p) => p.port === 22)!;

    it("prodotto, versione separata e CPE restano", () => {
      assert.equal(ssh.product, "OpenSSH");
      assert.equal(ssh.product_version, "10.5");
      assert.deepEqual(ssh.cpes, ["cpe:/a:openbsd:openssh:10.5"]);
    });

    it("gli script dei profili restano fuori, come prima", () => {
      assert.equal("scripts" in ssh, false);
    });

    it("una porta senza dati nuovi non prende chiavi vuote", () => {
      const rpc = porte.find((p) => p.port === 111)!;
      assert.deepEqual(Object.keys(rpc).sort(), ["port", "protocol", "service", "version"]);
    });
  });
}
