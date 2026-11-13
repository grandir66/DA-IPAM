// La pagina «Apparati» di DatIA Mon (13/11/2026): l'elenco unico, e il client di modelli e agente.
process.env.ENCRYPTION_KEY ||= "chiave-di-prova-del-pannello-zabbix";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HostDelCentro, OggettoDiFamiglia } from "../api";
import { elencoApparati, famigliaDaClassificazione } from "../apparati";
import { cambiaModelli, comandoAgente } from "../scrittura";
import { ErroreLettura, type TrasportoPost } from "../trasporto";

const host = (hostid: string, nome: string, ip: string, tecnico = nome) =>
  HostDelCentro.parse({ hostid, nome, host: tecnico, ip: [ip], disponibilita: { complessiva: "si", interfacce: [] }, dati_affidabili: true });
const ogg = (hostid: string, nome: string, famiglia: string, extra: Record<string, unknown> = {}) =>
  OggettoDiFamiglia.parse({ hostid, nome, famiglia, disponibilita: "si", dati_affidabili: true, ping: "si", misure_configurate: 3, misure_vive: 3, misure: [], ...extra });

test("elenco unico: in Zabbix con modelli e agente, e da aggiungere solo chi Zabbix non ha davvero", () => {
  const e = elencoApparati({
    host: [host("1", "DA-SYN", "192.168.40.22"), host("2", "DA-DC01.domarc.it", "192.168.4.10", "DA-DC01")],
    famiglie: [
      ogg("1", "DA-SYN", "storage", { modelli: ["Synology DiskStation"], agente: "non_serve" }),
      ogg("2", "DA-DC01.domarc.it", "windows", { modelli: ["Windows by Zabbix agent active"], agente: "no" }),
    ],
    problemi: [],
    vecchio: false,
    ipam: [
      // Lo stesso NAS visto da un'altra rete (Domarc, 13/11): non è da aggiungere.
      { id: 6, ip: "192.168.4.22", nome: "drive.domarc.it", classificazione: "nas", altri: "192.168.40.22" },
      { id: 7, ip: "192.168.4.10", nome: "dc01", classificazione: "server_windows", altri: null },
      { id: 8, ip: "192.168.4.77", nome: "PC-CONTAB-02", classificazione: "server_windows", altri: null },
      { id: 9, ip: "192.168.15.154", nome: "QSW-M3216R-8S8T", classificazione: "switch", altri: null },
    ],
  });
  assert.deepEqual(e.map((a) => [a.chiave, a.stato, a.agente, a.sistema, a.famiglia]), [
    ["z:1", "funziona", "non_serve", null, "storage"],
    ["z:2", "funziona", "no", "windows", "windows"],
    ["i:8", "da_aggiungere", "da_installare", "windows", "windows"],
    ["i:9", "da_aggiungere", "non_serve", null, "rete"],
  ]);
  // L'agente deve dichiarare il nome tecnico di Zabbix, non quello visibile.
  assert.equal(e[1]?.hostTecnico, "DA-DC01");
});

test("famiglia dalla classificazione di DA-IPAM", () => {
  assert.deepEqual(
    ["server_windows", "server_linux", "switch", "firewall", "nas", "ups", "hypervisor", "stampante", null].map(famigliaDaClassificazione),
    ["windows", "linux", "rete", "firewall", "storage", "hardware", "proxmox", "altro", "altro"],
  );
});

const BASE = new URL("https://centro.example/wizard");
function centro(status: number, corpo: unknown): { t: TrasportoPost; chiamate: Array<{ percorso: string; corpo: unknown }> } {
  const chiamate: Array<{ percorso: string; corpo: unknown }> = [];
  return { chiamate, t: async (percorso, c) => { chiamate.push({ percorso, corpo: c }); return { status, body: JSON.stringify(corpo), retryAfter: null }; } };
}

test("modelli: corpo con i soli campi pieni, esito letto, errori col testo nostro", async () => {
  const { t, chiamate } = centro(200, { esito: "prova", hostid: "501", nome: "srv", prima: ["A"], dopo: ["A", "B"], aggiunti: ["B"], tolti: [] });
  const r = await cambiaModelli({ base: BASE, trasportoPost: t }, { hostid: "501", aggiungi: ["B"], togli: [], prova: true });
  assert.equal(r.esito, "prova");
  assert.deepEqual(chiamate[0], { percorso: "/wizard/api/scrittura/v1/modelli", corpo: { hostid: "501", aggiungi: ["B"], prova: true } });
  await assert.rejects(
    cambiaModelli({ base: BASE, trasportoPost: centro(409, { errore: "<b>x</b>", codice: "senza_modelli" }).t }, { hostid: "501", togli: ["A"] }),
    (e: unknown) => e instanceof ErroreLettura && /almeno un modello/.test(e.message) && e.dettagli.status === 409,
  );
});

test("agente: senza nome è il comando per tutte le macchine", async () => {
  const { t, chiamate } = centro(200, { sistema: "windows", hostname: "", per_tutte: true, server_active: "192.0.2.1", comando: "msiexec …" });
  const r = await comandoAgente({ base: BASE, trasportoPost: t }, { sistema: "windows", hostname: "  " });
  assert.equal(r.per_tutte, true);
  assert.deepEqual(chiamate[0]?.corpo, { sistema: "windows" });
});
