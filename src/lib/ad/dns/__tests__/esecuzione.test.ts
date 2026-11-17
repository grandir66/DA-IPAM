/**
 * Esecuzione delle correzioni al DNS di AD contro un DC finto (un piccolo DNS in memoria che
 * capisce i tre comandi veri): rilettura prima di scrivere, registro prima del comando, tre
 * esiti, annulla, interruttore spento.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/ad/dns/__tests__/esecuzione.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { withTenant, getTenantDb, deleteTenantDatabase, sostituisciDnsAd, getModificheDnsAd, type AdIntegration } from "@/lib/db-tenant";
import { annullaModifica, eseguiCorrezioni, type DipendenzeEsecuzione } from "../esecuzione";
import type { Correzione, PassoDns } from "../correzioni";
import type { RigaRegistroDns } from "../registro";
import type { VoceDns, ZonaDns } from "../record";

void TEST_DATA_DIR;
const T = "TESTDNSCORR";
const ZONE: ZonaDns[] = [
  { nome: "esempio.local", inversa: false, partizione: "dominio" },
  { nome: "4.168.192.in-addr.arpa", inversa: true, partizione: "dominio" },
];
const VOCE_DC: VoceDns = { zona: "esempio.local", nome: "dc01", fqdn: "dc01.esempio.local", tipo: "A", dato: "192.168.4.2", ip: "192.168.4.2", statica: true, rinnovataIl: null, ttl: 3600 };

/** DC finto: i record per `zona|nome|tipo`, e il conto dei comandi che scrivono. */
class DcFinto {
  record = new Map<string, string[]>();
  scritture: string[] = [];
  /** Se messo, il prossimo comando che scrive fa questo invece di rispondere. */
  guasto: null | { tipo: "tace_ma_esegue" | "tace" | "errore"; messaggio?: string } = null;

  metti(zona: string, nome: string, tipo: string, dato: string) {
    const k = `${zona}|${nome}|${tipo}`;
    this.record.set(k, [...(this.record.get(k) ?? []), dato]);
  }
  ha(zona: string, nome: string, tipo: string, dato: string) {
    return (this.record.get(`${zona}|${nome}|${tipo}`) ?? []).includes(dato);
  }
  lancia = async (comando: string): Promise<string> => {
    const zona = /-ZoneName '([^']+)'/.exec(comando)![1]!;
    const nome = /-Name '([^']+)'/.exec(comando)![1]!;
    if (comando.includes("ESITO_LETTO")) {
      const tipo = /-RRType '([^']+)'/.exec(comando)![1]!;
      const dati = this.record.get(`${zona}|${nome}|${tipo}`) ?? [];
      return `ESITO_LETTO: ${JSON.stringify(dati.map((dato) => ({ tipo, dato: tipo === "A" ? dato : `${dato}.`, ttl: 1200, rinnovo: null })))}\r\n`;
    }
    this.scritture.push(comando);
    const guasto = this.guasto;
    this.guasto = null;
    if (guasto?.tipo === "tace") throw new Error("BRIDGE_TIMEOUT");
    if (guasto?.tipo === "errore") return `ESITO_ERRORE: ${guasto.messaggio ?? "Accesso negato"}`;
    const aggiungi = /Add-DnsServerResourceRecord(A|Ptr|CName) .* -(?:IPv4Address|PtrDomainName|HostNameAlias) '([^']+)'/.exec(comando);
    if (aggiungi) {
      this.metti(zona, nome, aggiungi[1]!.toUpperCase(), aggiungi[2]!);
    } else {
      const tipo = /-RRType '([^']+)'/.exec(comando)![1]!;
      const dato = /-eq '([^']+)' \}\); if/.exec(comando)![1]!;
      const k = `${zona}|${nome}|${tipo}`;
      const dati = this.record.get(k) ?? [];
      if (dati.filter((d) => d === dato).length !== 1) return "ESITO_ERRORE: NON_UNICO: 0";
      this.record.set(k, dati.filter((d) => d !== dato));
    }
    if (guasto?.tipo === "tace_ma_esegue") throw new Error("BRIDGE_TIMEOUT");
    return "ESITO_OK\r\n";
  };
}

const PTR = (azione: PassoDns["azione"], nodo: string, verso: string): PassoDns => ({ azione, zona: "4.168.192.in-addr.arpa", nome: nodo, tipo: "PTR", dato: `${verso}.esempio.local` });
const cor = (id: string, ...passi: PassoDns[]): Correzione => ({ id, chiaveAnomalia: id, titolo: `prova ${id}`, passi, toglieDati: passi.some((p) => p.azione === "togli") });

describe("esecuzione delle correzioni al DNS di AD", () => {
  let accesa: AdIntegration;
  let dc: DcFinto;
  let file: RigaRegistroDns[];
  let deps: DipendenzeEsecuzione;
  const esegui = (c: Correzione[], d: DipendenzeEsecuzione = deps, integ: AdIntegration = accesa) => withTenant(T, () => eseguiCorrezioni(integ, c, "riccardo", d));
  const registro = () => withTenant(T, () => getModificheDnsAd(1, 1, 100).rows);

  before(() => {
    const d = getTenantDb(T);
    d.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password, dns_scrittura) VALUES (1, 'Dominio', 'dc01.esempio.local', 'esempio.local', 'DC=esempio,DC=local', '', '', 1)").run();
    d.prepare("INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, dns_host_name, distinguished_name, ip_address) VALUES (1, 'g1', 'DC02$', 'dc02.esempio.local', 'CN=DC02,OU=Domain Controllers,DC=esempio,DC=local', '192.168.4.3')").run();
    accesa = d.prepare("SELECT * FROM ad_integrations WHERE id = 1").get() as AdIntegration;
    withTenant(T, () => sostituisciDnsAd(1, ZONE, [VOCE_DC]));
  });
  after(() => deleteTenantDatabase(T));
  beforeEach(() => {
    dc = new DcFinto();
    file = [];
    deps = { lancia: dc.lancia, rileggi: async () => undefined, registra: (r) => { file.push(r); } };
  });

  it("aggiungi riuscito: record sul DC, riga nel registro, due righe nel file (prima e dopo)", async () => {
    const r = await esegui([cor("c1", PTR("aggiungi", "10", "pc-01"))]);
    assert.deepEqual(r.esiti.map((e) => e.esito), ["riuscito"]);
    assert.equal(dc.ha("4.168.192.in-addr.arpa", "10", "PTR", "pc-01.esempio.local"), true);
    assert.equal(r.riletto, true);
    const riga = registro().find((x) => x.id === r.esiti[0]!.modificaId)!;
    assert.deepEqual([riga.esito, riga.azione, riga.dato, riga.prima, riga.da, riga.gruppo], ["riuscito", "aggiungi", "pc-01.esempio.local", null, "riccardo", r.gruppo]);
    assert.deepEqual(file.map((f) => [f.fase, f.esito]), [["prima", "in_corso"], ["dopo", "riuscito"]]);
  });

  it("togli riuscito: nel registro resta il record com'era", async () => {
    dc.metti("4.168.192.in-addr.arpa", "50", "PTR", "sparito.esempio.local");
    const r = await esegui([cor("c2", PTR("togli", "50", "sparito"))]);
    assert.equal(r.esiti[0]!.esito, "riuscito");
    assert.equal(dc.ha("4.168.192.in-addr.arpa", "50", "PTR", "sparito.esempio.local"), false);
    assert.deepEqual(JSON.parse(registro().find((x) => x.id === r.esiti[0]!.modificaId)!.prima!), { tipo: "PTR", dato: "sparito.esempio.local", ttl: 1200, statica: true, rinnovataIl: null });
  });

  it("il record è cambiato da quando è stato mostrato: niente comando, niente riga", async () => {
    const quante = registro().length;
    const via = await esegui([cor("c3", PTR("togli", "51", "non-c-e-piu"))]);
    assert.deepEqual([via.esiti[0]!.esito, via.esiti[0]!.modificaId], ["cambiato", null]);
    dc.metti("4.168.192.in-addr.arpa", "52", "PTR", "pc-02.esempio.local");
    const doppio = await esegui([cor("c4", PTR("aggiungi", "52", "pc-02"))]);
    assert.equal(doppio.esiti[0]!.esito, "cambiato");
    assert.equal(dc.scritture.length, 0);
    assert.equal(registro().length, quante);
  });

  it("la risposta non arriva: vale quello che si rilegge", async () => {
    dc.guasto = { tipo: "tace_ma_esegue" };
    const fatto = await esegui([cor("c5", PTR("aggiungi", "60", "pc-60"))]);
    assert.equal(fatto.esiti[0]!.esito, "riuscito");
    assert.match(fatto.esiti[0]!.messaggio ?? "", /non arrivata.*come atteso/);
    dc.guasto = { tipo: "tace" };
    const nonSo = await esegui([cor("c6", PTR("aggiungi", "61", "pc-61"))]);
    assert.equal(nonSo.esiti[0]!.esito, "non_so");
    assert.equal(registro().find((x) => x.id === nonSo.esiti[0]!.modificaId)!.esito, "non_so");
  });

  it("il DC rifiuta: esito rifiutato col suo messaggio", async () => {
    dc.guasto = { tipo: "errore", messaggio: "Accesso negato" };
    const r = await esegui([cor("c7", PTR("aggiungi", "62", "pc-62"))]);
    assert.deepEqual([r.esiti[0]!.esito, r.esiti[0]!.messaggio], ["rifiutato", "Accesso negato"]);
  });

  it("un cambio che si ferma all'aggiunta non toglie il vecchio; le altre correzioni proseguono", async () => {
    dc.metti("4.168.192.in-addr.arpa", "70", "PTR", "vecchio.esempio.local");
    dc.guasto = { tipo: "errore" };
    const r = await esegui([cor("cambio", PTR("aggiungi", "70", "nuovo"), PTR("togli", "70", "vecchio")), cor("altra", PTR("aggiungi", "71", "pc-71"))]);
    assert.deepEqual(r.esiti.map((e) => e.esito), ["rifiutato", "saltato", "riuscito"]);
    assert.equal(dc.ha("4.168.192.in-addr.arpa", "70", "PTR", "vecchio.esempio.local"), true, "nessun buco");
  });

  it("registro su file non scrivibile: lancia e nessun comando parte", async () => {
    await assert.rejects(esegui([cor("c8", PTR("aggiungi", "80", "pc-80"))], { ...deps, registra: () => { throw new Error("disco pieno"); } }), /nessun comando lanciato/);
    assert.equal(dc.scritture.length, 0);
    assert.equal(dc.ha("4.168.192.in-addr.arpa", "80", "PTR", "pc-80.esempio.local"), false);
  });

  it("record di un controller di dominio, o fuori dalle zone lette: rifiutato senza toccare il DC", async () => {
    const r = await esegui([
      cor("dc-nome", { azione: "togli", zona: "esempio.local", nome: "dc01", tipo: "A", dato: "192.168.4.2" }),
      cor("dc-ip-da-ad", PTR("aggiungi", "3", "qualcosa")),
      cor("dc-ip-dal-dns", PTR("aggiungi", "2", "qualcosa")),
      cor("zona", { azione: "aggiungi", zona: "altra.local", nome: "pc", tipo: "A", dato: "192.168.4.90" }),
    ]);
    assert.deepEqual(r.esiti.map((e) => e.esito), ["rifiutato", "rifiutato", "rifiutato", "rifiutato"]);
    assert.equal(dc.scritture.length, 0);
  });

  it("scrittura spenta: lancia, e il DC non viene nemmeno letto", async () => {
    let chiamate = 0;
    const spenta = { ...accesa, dns_scrittura: 0 };
    await assert.rejects(esegui([cor("c9", PTR("aggiungi", "90", "pc-90"))], { ...deps, lancia: async () => { chiamate++; return ""; } }, spenta), /spente/);
    assert.equal(chiamate, 0);
  });

  it("annulla: un «togli» riuscito si rimette, e non si annulla due volte", async () => {
    dc.metti("4.168.192.in-addr.arpa", "95", "PTR", "tolto.esempio.local");
    const r = await esegui([cor("c10", PTR("togli", "95", "tolto"))]);
    const id = r.esiti[0]!.modificaId!;
    const a = await withTenant(T, () => annullaModifica(accesa, id, "riccardo", deps));
    assert.equal(a.esiti[0]!.esito, "riuscito");
    assert.equal(dc.ha("4.168.192.in-addr.arpa", "95", "PTR", "tolto.esempio.local"), true);
    const righe = registro();
    assert.equal(righe.find((x) => x.id === a.esiti[0]!.modificaId)!.annulla_di, id);
    assert.equal(righe.find((x) => x.id === id)!.annullata, 1);
    await assert.rejects(withTenant(T, () => annullaModifica(accesa, id, "riccardo", deps)), /già stata annullata/);
  });

  it("il registro non si cancella e, chiuso, non si cambia", () => {
    const d = getTenantDb(T);
    const id = registro().find((x) => x.esito === "riuscito")!.id;
    assert.throws(() => d.prepare("DELETE FROM ad_dns_modifiche WHERE id = ?").run(id), /non si cancella/);
    assert.throws(() => d.prepare("UPDATE ad_dns_modifiche SET esito = 'rifiutato' WHERE id = ?").run(id), /non si cambia/);
  });
});
