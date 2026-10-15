/**
 * Tappa C1, Task 5: le porte aperte sull'interfaccia NetBird, lette dal sistema vivo.
 *
 * Servono a R5 (spec NetBird §4.3): l'istanza dice nel segnale quali porte apre su
 * `wt0`, e DA-Link le confronta con l'elenco atteso (Wazuh mai). Si legge la tabella
 * `inet dalink` caricata (`nft -j`), non il file di configurazione: «scritto non vuol
 * dire applicato». Se la tabella non c'è si contano le porte in ascolto raggiungibili
 * da `wt0`: il caso peggiore, che sbaglia per eccesso e mai per difetto.
 *
 * I JSON in `dati/` sono l'uscita VERA di `nft -j list table inet dalink` (nftables
 * 1.0.9, Ubuntu 24.04), presa in uno spazio di rete usa e getta da
 * `scripts/dalink/prova-firewall-netns.sh` il 15/10. Le righe di /proc hanno la forma
 * vera del kernel con indirizzi inventati.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { leggiPorteWt0, porteDaNftJson, porteInAscolto } from "../porte-wt0";

const DATI = path.join(__dirname, "dati");
const NFT_SORGENTI = fs.readFileSync(path.join(DATI, "nft-dalink-sorgenti.json"), "utf8");
const NFT_EDGE = fs.readFileSync(path.join(DATI, "nft-dalink-edge.json"), "utf8");

const INTESTAZIONE4 =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const coda = "00000000:00000000 00:00000000 00000000     0        0 599964704 1 0000000000000000 100 0 0 10 0";
// 0.0.0.0:22 in ascolto; 127.0.0.1:3306; 192.168.1.1:3001 (LAN); 100.90.1.5:1514 (indirizzo di wt0);
// 192.168.1.1:443 connessione stabilita (01), non in ascolto.
const TCP4 = [
  INTESTAZIONE4,
  `   0: 00000000:0016 00000000:0000 0A ${coda}`,
  `   1: 0100007F:0CEA 00000000:0000 0A ${coda}`,
  `   2: 0101A8C0:0BB9 00000000:0000 0A ${coda}`,
  `   3: 05015A64:05EA 00000000:0000 0A ${coda}`,
  `   4: 0101A8C0:01BB 0201A8C0:C350 01 ${coda}`,
].join("\n");
const INTESTAZIONE6 =
  "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
// [::]:80 in ascolto; [::1]:8080 no.
const TCP6 = [
  INTESTAZIONE6,
  `   0: 00000000000000000000000000000000:0050 00000000000000000000000000000000:0000 0A ${coda}`,
  `   1: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A ${coda}`,
].join("\n");

test("nft vero, con sorgente: 22 e 443, sorgenti ristrette", () => {
  assert.deepEqual(porteDaNftJson(NFT_SORGENTI), { porte: [22, 443], sorgentiRistrette: true });
});

test("nft vero, con l'edge e senza sorgenti: 22, 443 e 6443", () => {
  assert.deepEqual(porteDaNftJson(NFT_EDGE), { porte: [22, 443, 6443], sorgentiRistrette: false });
});

test("una tabella senza lo scarto finale non vale come firewall", () => {
  const d = JSON.parse(NFT_EDGE) as { nftables: Array<Record<string, { expr?: unknown[] }>> };
  d.nftables = d.nftables.filter((x) => !(x.rule && JSON.stringify(x.rule.expr).includes('"drop"') && JSON.stringify(x.rule.expr).includes("counter")));
  assert.equal(porteDaNftJson(JSON.stringify(d)), null);
});

test("JSON malformato o di un'altra tabella → null, mai un'eccezione", () => {
  assert.equal(porteDaNftJson("non json"), null);
  assert.equal(porteDaNftJson('{"nftables":[]}'), null);
  assert.equal(porteDaNftJson(NFT_EDGE.replaceAll('"dalink"', '"altra"')), null);
});

test("in ascolto: jolly e indirizzo di wt0 sì; loopback, LAN e connessioni no", () => {
  assert.deepEqual(porteInAscolto(TCP4, TCP6, ["100.90.1.5"]), [22, 80, 1514]);
  assert.deepEqual(porteInAscolto(TCP4, TCP6, []), [22, 80]);
});

test("leggiPorteWt0: tabella caricata → fonte firewall", async () => {
  const r = await leggiPorteWt0({
    nftJson: async () => NFT_EDGE,
    leggiFile: () => {
      throw new Error("non serve");
    },
    indirizziWt0: () => ["100.90.1.5"],
  });
  assert.deepEqual(r, { fonte: "firewall", porte: [22, 443, 6443], sorgentiRistrette: false, wt0Presente: true });
});

test("leggiPorteWt0: nft fallisce → porte in ascolto", async () => {
  const r = await leggiPorteWt0({
    nftJson: async () => {
      throw new Error("Error: No such file or directory; did you mean table 'filter' in family ip?");
    },
    leggiFile: (p) => (p.endsWith("tcp6") ? TCP6 : TCP4),
    indirizziWt0: () => ["100.90.1.5"],
  });
  assert.deepEqual(r, { fonte: "ascolto", porte: [22, 80, 1514], sorgentiRistrette: false, wt0Presente: true });
});

test("leggiPorteWt0: IPv6 spento (manca solo tcp6) → ascolto sulle sole porte IPv4", async () => {
  const r = await leggiPorteWt0({
    nftJson: async () => {
      throw new Error("tabella assente");
    },
    leggiFile: (p) => {
      if (p.endsWith("tcp6")) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return TCP4;
    },
    indirizziWt0: () => [],
  });
  assert.deepEqual(r, { fonte: "ascolto", porte: [22], sorgentiRistrette: false, wt0Presente: false });
});

test("leggiPorteWt0: niente /proc (non Linux) → non so, lista vuota", async () => {
  const r = await leggiPorteWt0({
    nftJson: async () => {
      throw new Error("nft: comando non trovato");
    },
    leggiFile: () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    indirizziWt0: () => [],
  });
  assert.deepEqual(r, { fonte: "non_so", porte: [], sorgentiRistrette: false, wt0Presente: false });
});
