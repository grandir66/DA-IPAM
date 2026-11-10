/**
 * Confronto con Nety su 192.168.4.1 e 192.168.4.4 (10/11/2026): sull'UDP loro leggevano nome,
 * dominio, controller di dominio, MAC e istanza SQL; noi niente. Risposte costruite come quelle vere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { domandaNetbios, leggiDns, leggiNetbios, leggiNtp, leggiSqlBrowser } from "../sonde-udp";

function nome(testo: string, suffisso: number, gruppo: boolean): Buffer {
  return Buffer.concat([Buffer.from(testo.padEnd(15, " "), "latin1"), Buffer.from([suffisso, gruppo ? 0x84 : 0x04, 0x00])]);
}

function rispostaNetbios(nomi: Buffer[], mac: number[]): Buffer {
  return Buffer.concat([Buffer.alloc(12 + 34 + 4 + 4 + 2), Buffer.from([nomi.length]), ...nomi, Buffer.from(mac), Buffer.alloc(40)]);
}

test("NetBIOS: computer, dominio, controller di dominio e MAC", () => {
  const r = rispostaNetbios(
    [nome("DA-DC01", 0x00, false), nome("DOMARC", 0x00, true), nome("DOMARC", 0x1c, true), nome("DA-DC01", 0x20, false)],
    [0x00, 0x50, 0x56, 0xa5, 0x4b, 0xab],
  );
  const e = leggiNetbios(r);
  assert.equal(e?.banner, "DOMARC\\DA-DC01 · controller di dominio · MAC 00:50:56:a5:4b:ab");
  assert.equal(e?.mac, "00:50:56:a5:4b:ab");
  assert.equal(domandaNetbios().length, 50);
});

test("NetBIOS: risposta corta o senza nomi leggibili non diventa una riga", () => {
  assert.equal(leggiNetbios(Buffer.alloc(20)), null);
  assert.equal(leggiNetbios(rispostaNetbios([nome("\x01\x02", 0x00, false)], [0, 0, 0, 0, 0, 0])), null);
});

test("NTP, DNS e SQL Browser", () => {
  const ntp = Buffer.alloc(48);
  ntp[0] = 0x1c;
  ntp[1] = 2;
  assert.equal(leggiNtp(ntp)?.banner, "server NTP, strato 2");
  assert.equal(leggiNtp(Buffer.alloc(48)), null);
  assert.equal(leggiDns(Buffer.from([0x4e, 0x02, 0x81, 0x80, 0, 1, 0, 13, 0, 0, 0, 0]))?.banner, "DNS: 13 risposte, ricorsione offerta");
  assert.equal(leggiDns(Buffer.from([0x4e, 0x02, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0])), null);
  const corpo = "ServerName;DA-SEVEN;InstanceName;MSSQLSERVER;IsClustered;No;Version;14.0.1000.169;tcp;1433;;";
  const sql = Buffer.concat([Buffer.from([0x05, corpo.length, 0]), Buffer.from(corpo, "latin1")]);
  assert.equal(leggiSqlBrowser(sql)?.banner, "istanza MSSQLSERVER · versione 14.0.1000.169 · TCP 1433");
  assert.equal(leggiSqlBrowser(Buffer.from([0x04, 0, 0, 0])), null);
});
