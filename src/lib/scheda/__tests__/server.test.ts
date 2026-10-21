/**
 * Pezzi puri della scheda dei server Windows e Linux: servizi del ruolo e «da guardare», dischi normalizzati,
 * porte in ascolto, hotfix e caselle. Incidenti evitati: un volume virtuale (efivarfs, 56K) o un disco da 1 GB
 * con 0 libero non deve diventare «disco peggiore al 100%»; un servizio manuale fermo non è un guasto.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/server.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  caricoUnMinuto, caselleLinux, caselleWindows, discoPeggiore, eAutomatico, esitoServizio, gravitaAd, normalizzaDischi,
  ordinaRilievi, raggruppaPorte, uptimeBreve, ramUsata, ruoliEffettivi, serviziDaGuardare, serviziDelRuolo, serviziInAscolto, ultimoHotfix,
} from "../server";

const ADESSO = new Date("2026-10-21T10:00:00Z");

describe("esitoServizio / serviziDaGuardare", () => {
  it("Running = attivo; Stopped automatico = fermo ✕; Stopped manuale = neutro", () => {
    assert.deepEqual(esitoServizio({ name: "a", state: "Running", start_mode: "Auto" }), { segno: "✓", testo: "attivo", livello: "ok" });
    assert.equal(esitoServizio({ name: "gpsvc", state: "Stopped", start_mode: "Auto" }).livello, "guasto");
    assert.equal(esitoServizio({ name: "x", state: "Stopped", start_mode: "Manual" }).livello, "neutro");
    assert.equal(esitoServizio({ name: "ssh", state: "failed", start_mode: "" }).testo, "fallito");
    assert.equal(esitoServizio({ name: "y", state: "Start Pending", start_mode: "Auto" }).livello, "attenzione");
    assert.equal(esitoServizio({ name: "z" }).testo, "stato non letto");
  });
  it("eAutomatico: Auto e «Automatic (Delayed Start)», non Manual né vuoto", () => {
    assert.equal(eAutomatico({ start_mode: "Auto" }), true);
    assert.equal(eAutomatico({ start_mode: "Automatic (Delayed Start)" }), true);
    assert.equal(eAutomatico({ start_mode: "Manual" }), false);
    assert.equal(eAutomatico({}), false);
  });
  it("da guardare: solo gli automatici non attivi e i falliti; i manuali fermi no; guasti prima", () => {
    const r = serviziDaGuardare([
      { name: "sppsvc", state: "Start Pending", start_mode: "Auto" },
      { name: "wuauserv", state: "Stopped", start_mode: "Manual" },
      { name: "gpsvc", state: "Stopped", start_mode: "Auto" },
      { name: "Dhcp", state: "Running", start_mode: "Auto" },
      { name: "nginx", state: "failed", start_mode: "" },
      { name: "cron", state: "inactive", start_mode: "" },
    ]);
    assert.deepEqual(r.map((s) => s.name), ["gpsvc", "nginx", "sppsvc"]);
  });
  it("nessun servizio da guardare = lista vuota", () => {
    assert.deepEqual(serviziDaGuardare([{ name: "a", state: "Running", start_mode: "Auto" }]), []);
    assert.deepEqual(serviziDaGuardare([]), []);
  });
});

describe("servizi del ruolo", () => {
  const dc = [
    { name: "NTDS", state: "Running", start_mode: "Auto" }, { name: "DNS", state: "Running", start_mode: "Auto" },
    { name: "DHCPServer", state: "Running", start_mode: "Auto" }, { name: "Netlogon", state: "Running", start_mode: "Auto" },
    { name: "Spooler", state: "Running", start_mode: "Auto" },
  ];
  it("DC: NTDS, DNS, Netlogon (e DHCPServer solo col ruolo dhcp)", () => {
    assert.deepEqual(serviziDelRuolo(dc, ["dc"]).map((s) => s.name), ["DNS", "Netlogon", "NTDS"]);
    assert.deepEqual(serviziDelRuolo(dc, ["dc", "dhcp"]).map((s) => s.name), ["DHCPServer", "DNS", "Netlogon", "NTDS"]);
  });
  it("senza ruoli e senza servizi riconoscibili: nessuno (Spooler non è un servizio di ruolo)", () => {
    assert.deepEqual(serviziDelRuolo(dc, []), []);
  });
  it("SQL: MSSQL*, SQLSERVERAGENT, SQLBrowser anche senza il ruolo dichiarato (MSSQL esiste solo con SQL Server)", () => {
    const sql = [{ name: "MSSQL$SRVINTERVENTI" }, { name: "SQLSERVERAGENT" }, { name: "SQLBrowser" }, { name: "Spooler" }];
    assert.deepEqual(ruoliEffettivi([], sql), ["database"]);
    assert.deepEqual(serviziDelRuolo(sql, []).map((s) => s.name), ["MSSQL$SRVINTERVENTI", "SQLBrowser", "SQLSERVERAGENT"]);
  });
  it("Linux: i servizi che hanno un processo in ascolto (ssh ↔ sshd), non quelli senza", () => {
    const servizi = [{ name: "ssh.service" }, { name: "cron" }, { name: "wazuh-manager" }];
    const porte = [{ port: 22, process: "sshd" }, { port: 1514, process: "wazuh-manager" }];
    assert.deepEqual(serviziInAscolto(servizi, porte).map((s) => s.name), ["ssh.service", "wazuh-manager"]);
    assert.deepEqual(serviziInAscolto(servizi, [{ port: 22 }]), [], "senza il nome del processo non si indovina");
  });
});

describe("raggruppaPorte", () => {
  it("la stessa porta su IPv4 e IPv6 è una; più porte dello stesso processo si raggruppano", () => {
    const g = raggruppaPorte([
      { port: 22, process: "sshd", bind_address: "0.0.0.0", protocol: "tcp" },
      { port: 22, process: "sshd", bind_address: "::", protocol: "tcp" },
      { port: 1514, process: "wazuh-manager", bind_address: "0.0.0.0" },
      { port: 1515, process: "wazuh-manager", bind_address: "0.0.0.0" },
      { port: 9200, process: "wazuh-indexer", bind_address: "127.0.0.1" },
    ]);
    assert.deepEqual(g, [
      { porte: [22], processo: "sshd", raggio: "tutte le interfacce" },
      { porte: [1514, 1515], processo: "wazuh-manager", raggio: "tutte le interfacce" },
      { porte: [9200], processo: "wazuh-indexer", raggio: "solo locale" },
    ]);
  });
  it("senza processo ogni porta sta da sola; porta locale + esposta = esposta", () => {
    const g = raggruppaPorte([{ port: 443, bind_address: "0.0.0.0" }, { port: 80, bind_address: "127.0.0.1" }, { port: 80, bind_address: "*" }]);
    assert.deepEqual(g.map((x) => [x.porte, x.processo, x.raggio]), [[[80], null, "tutte le interfacce"], [[443], null, "tutte le interfacce"]]);
  });
});

describe("normalizzaDischi / discoPeggiore", () => {
  it("Windows: device, size_gb, free_gb e etichetta", () => {
    const d = normalizzaDischi([{ device: "C:", size_gb: 120, free_gb: 35, filesystem: "NTFS" }, { device: "E:", size_gb: 20, free_gb: 18, filesystem: "NTFS", label: "SQL" }]);
    assert.deepEqual(d.map((x) => [x.nome, x.usatoPct, x.etichetta]), [["C:", 71, null], ["E:", 10, "SQL"]]);
  });
  it("Linux: mount in label, dimensione in testo («292G»); i volumi virtuali (56K) spariscono", () => {
    const d = normalizzaDischi([
      { device: "efivarfs", free_gb: 39, filesystem: "56K", label: "/sys/firmware/efi/efivars" },
      { device: "/dev/mapper/ubuntu--vg-ubuntu--lv", free_gb: 225, filesystem: "292G", label: "/" },
      { device: "192.168.16.26:/wazuh-archive", free_gb: 63, filesystem: "1.0T", label: "/mnt/qnap-wazuh" },
    ]);
    assert.deepEqual(d.map((x) => [x.nome, x.totaleGb, x.usatoPct, x.rete]), [["/", 292, 23, false], ["/mnt/qnap-wazuh", 1024, 94, true]]);
  });
  it("il peggiore ignora le condivisioni di rete e i volumi sotto 5 GB (libero arrotondato)", () => {
    const d = normalizzaDischi([
      { device: "/dev/sda1", free_gb: 0, filesystem: "1.1G", label: "/boot/efi" },
      { device: "/dev/sdb", free_gb: 44, filesystem: "400G", label: "/var" },
      { device: "10.0.0.2:/arch", free_gb: 1, filesystem: "1.0T", label: "/mnt/arch" },
      { device: "/dev/sdc", free_gb: 30, filesystem: "50G", label: "/" },
    ]);
    assert.equal(discoPeggiore(d)?.nome, "/var");
    assert.equal(discoPeggiore(d)?.usatoPct, 89);
  });
  it("sotto 5 GB il disco è «piccolo»: la percentuale è indicativa", () => {
    const d = normalizzaDischi([{ device: "/dev/sda1", free_gb: 0, filesystem: "1.1G", label: "/boot/efi" }, { device: "/dev/sdb", free_gb: 10, filesystem: "40G", label: "/" }]);
    assert.deepEqual(d.map((x) => x.piccolo), [true, false]);
  });
  it("nessun disco con la misura = null; input nullo = lista vuota", () => {
    assert.equal(discoPeggiore(normalizzaDischi([{ device: "X:" }])), null);
    assert.deepEqual(normalizzaDischi(undefined), []);
  });
});

describe("ramUsata / caricoUnMinuto / ultimoHotfix", () => {
  it("RAM usata da totale e libera; senza la libera = null (non si inventa)", () => {
    assert.deepEqual(ramUsata({ ram_total_gb: 16, ram_free_mb: 4096 }), { pct: 75, usataGb: 12, totaleGb: 16 });
    assert.equal(ramUsata({ ram_total_gb: 8 }), null);
    assert.equal(ramUsata(null), null);
  });
  it("carico a un minuto", () => {
    assert.equal(caricoUnMinuto("1.80, 1.20, 0.90"), 1.8);
    assert.equal(caricoUnMinuto(""), null);
    assert.equal(caricoUnMinuto(null), null);
  });
  it("ultimo hotfix: il più recente, con i giorni; date illeggibili ignorate", () => {
    const r = ultimoHotfix([{ id: "KB1", installed_on: "2026-09-01" }, { id: "KB2", installed_on: "2026-09-17" }, { id: "KB3", installed_on: "boh" }, { installed_on: "2026-10-01" }], ADESSO);
    assert.deepEqual(r, { id: "KB2", quando: "2026-09-17", giorni: 34 });
    assert.equal(ultimoHotfix([], ADESSO), null);
  });
});

describe("uptimeBreve", () => {
  it("giorni dalla scansione; testo di uptime -p ridotto a giorni, ore o minuti", () => {
    assert.equal(uptimeBreve({ uptime_days: 19 }), "19 g");
    assert.equal(uptimeBreve({ uptime: "up 2 weeks, 7 hours, 58 minutes" }), "14 g");
    assert.equal(uptimeBreve({ uptime: "up 1 week, 3 days, 2 hours" }), "10 g");
    assert.equal(uptimeBreve({ uptime: "up 7 hours, 58 minutes" }), "7 h");
    assert.equal(uptimeBreve({ uptime: "up 12 minutes" }), "12 min");
    assert.equal(uptimeBreve({ uptime: "da ieri" }), "da ieri");
    assert.equal(uptimeBreve({}), null);
    assert.equal(uptimeBreve(null), null);
  });
});

describe("gravità AD", () => {
  it("segno e parola per gravità, ordinate dalla più alta", () => {
    assert.deepEqual(gravitaAd("High"), { segno: "✕", testo: "alto", peso: 1 });
    assert.equal(gravitaAd("Medium").segno, "▲");
    assert.equal(gravitaAd("Low").segno, "●");
    const o = ordinaRilievi([{ gravita: "Medium", titolo: "b" }, { gravita: "Critical", titolo: "z" }, { gravita: "Medium", titolo: "a" }]);
    assert.deepEqual(o.map((x) => x.titolo), ["z", "a", "b"]);
  });
});

describe("caselle", () => {
  it("Windows: aggiornamenti in attenzione, disco, RAM, protezione, AD, acceso da", () => {
    const c = caselleWindows({
      di: {
        pending_updates_count: 3, installed_hotfixes: [{ id: "KB5041160", installed_on: "2026-09-17" }],
        disks: [{ device: "C:", size_gb: 120, free_gb: 35, filesystem: "NTFS" }], cpu_cores: 4, ram_total_gb: 8, ram_free_mb: 3000,
        antivirus: [{ name: "Defender", status: "ok" }], firewall_active: true, uptime_days: 34, last_boot: "2026-09-17T08:00:00Z",
      },
      ad: { n: 2, alti: 1, controllo: "20/10" }, adesso: ADESSO,
    });
    assert.deepEqual(c.map((x) => x.etichetta), ["Aggiornamenti", "Disco peggiore", "RAM", "Protezione", "Active Directory", "Acceso da"]);
    assert.deepEqual(c[0], { etichetta: "Aggiornamenti", valore: "3", sotto: "mancanti · ultimo 34 g fa", attenzione: true, tab: "aggiornamenti" });
    assert.equal(c[1].valore, "C: 71%");
    assert.equal(c[1].attenzione, undefined);
    assert.equal(c[3].valore, "Defender");
    assert.equal(c[4].attenzione, true);
    assert.equal(c[5].valore, "34 g");
  });
  it("Windows: 0 aggiornamenti non è attenzione; senza RAM libera la casella dice vCPU · GB; senza AD niente casella AD", () => {
    const c = caselleWindows({ di: { pending_updates_count: 0, cpu_cores: 4, ram_total_gb: 8 }, ad: null, adesso: ADESSO });
    assert.equal(c[0].attenzione, undefined);
    assert.deepEqual(c.map((x) => x.etichetta), ["Aggiornamenti", "CPU · RAM"]);
    assert.equal(c[1].valore, "4 vCPU · 8 GB");
  });
  it("Windows: nessun dato = nessuna casella; antivirus assente con firewall spento = attenzione", () => {
    assert.deepEqual(caselleWindows({ di: null, ad: null, adesso: ADESSO }), []);
    const c = caselleWindows({ di: { antivirus: [], firewall_active: false }, ad: null, adesso: ADESSO });
    assert.equal(c[0].valore, "nessun antivirus");
    assert.equal(c[0].attenzione, true);
  });
  it("Linux: carico, RAM, filesystem peggiore, pacchetti, servizi falliti, acceso da", () => {
    const c = caselleLinux({
      di: {
        load_average: "1.80, 1.2, 1", cpu_cores: 8, ram_total_gb: 16, ram_free_mb: 4096,
        disks: [{ device: "/dev/sdb", free_gb: 44, filesystem: "400G", label: "/var" }], pending_updates_count: 17,
        important_services: [{ name: "a", state: "active" }, { name: "b", state: "failed" }], uptime_days: 12,
      },
    });
    assert.deepEqual(c.map((x) => x.etichetta), ["Carico", "RAM", "Filesystem peggiore", "Pacchetti", "Servizi falliti", "Acceso da"]);
    assert.equal(c[0].valore, "1,80");
    assert.equal(c[2].valore, "/var 89%");
    assert.equal(c[2].attenzione, true);
    assert.equal(c[4].valore, "1");
    assert.equal(c[4].attenzione, true);
  });
  it("Linux: i pacchetti da aggiornare non letti non diventano «0»: si dice quanti sono installati", () => {
    const c = caselleLinux({ di: { packages_count: 793 } });
    assert.deepEqual(c, [{ etichetta: "Pacchetti", valore: "793", sotto: "installati", tab: "aggiornamenti" }]);
  });
});
