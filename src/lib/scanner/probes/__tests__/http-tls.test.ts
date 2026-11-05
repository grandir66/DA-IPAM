import { describe, it } from "node:test";
import assert from "node:assert";
import net from "net";
import { probeHttpTls } from "../http-tls";

/**
 * La 9100 è JetDirect raw: ogni byte che le arriva finisce stampato su carta — il
 * 04/11/2026 le otto stampanti del 72729 hanno stampato la riga di richiesta del
 * probe. Qui si misura il comportamento vero, con due socket in ascolto: sulla 9100
 * non deve arrivare niente, sulla 7080 (porta web legittima dell'elenco) la GET deve
 * arrivare, altrimenti la prova passerebbe anche con il probe morto.
 */
interface Spia {
  server: net.Server;
  ricevuto: Buffer[];
}

function ascolta(port: number): Promise<Spia> {
  return new Promise((resolve, reject) => {
    const ricevuto: Buffer[] = [];
    const server = net.createServer((sock) => {
      sock.on("data", (c: Buffer) => ricevuto.push(c));
      sock.on("error", () => {});
    });
    server.once("error", (e: Error) =>
      reject(new Error(`impossibile mettersi in ascolto su 127.0.0.1:${port}: ${e.message}`))
    );
    server.listen(port, "127.0.0.1", () => resolve({ server, ricevuto }));
  });
}

describe("probeHttpTls — porte di stampa", () => {
  it("non scrive un byte sulla 9100, e intanto interroga davvero la 7080", async () => {
    const stampante = await ascolta(9100);
    const web = await ascolta(7080);
    try {
      await probeHttpTls("127.0.0.1", [9100, 7080], { timeoutMs: 500 });
      assert.equal(
        Buffer.concat(stampante.ricevuto).length,
        0,
        "il probe ha scritto sulla 9100: le stampanti del cliente stamperanno la richiesta"
      );
      assert.match(
        Buffer.concat(web.ricevuto).toString("utf8"),
        /^GET \/ HTTP\/1\.1/,
        "sulla 7080 la GET deve partire, altrimenti questa prova non dimostra niente"
      );
    } finally {
      stampante.server.close();
      web.server.close();
    }
  });
});
