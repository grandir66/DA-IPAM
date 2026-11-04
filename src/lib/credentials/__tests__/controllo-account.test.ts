/**
 * Controllo di cosa può fare un account Windows (piano accesso Windows, Task 8).
 *
 * Riccardo, 04/11/2026: «nell'applicativo deve essere chiaro cosa abilitare per l'utente e cosa abilitare per la sicurezza
 * del dominio». Il controllo confronta il catalogo dei diritti con quello che l'account può fare davvero:
 *  - i gruppi si leggono dal DC col filtro RICORSIVO (LDAP_MATCHING_RULE_IN_CHAIN, 1.2.840.113556.1.4.1941): chi è dentro
 *    un gruppo tramite un altro gruppo è dentro, e col filtro diretto risulterebbe fuori;
 *  - LDAP che non risponde, nessuna integrazione, account che non è del dominio: `non_verificato`, MAI «no»;
 *  - sui PC non si prova niente al clic: lo stato viene dagli esiti già scritti in `host_credentials`.
 *
 * SQLite vero per le voci e gli esiti; finti solo il DC (un piccolo annuario con gruppi annidati che sa rispondere al filtro
 * ricorsivo e a quello diretto) e la verifica della password.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/controllo-account.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "ldapts";
import type Database from "better-sqlite3";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant, type AdIntegration } from "@/lib/db-tenant";
import { RicordoErrate } from "@/lib/scanner/account-windows";
import type { EsitoPassword } from "@/lib/scanner/verifica-password-run";
import { DIRITTI } from "../diritti";
import { controllaAccount, controlloAccount, VoceNonWindows, type DipendenzeControllo, type RigaControllo } from "../controllo-account";

void TEST_DATA_DIR;
const T = "TESTCTRLACC";
const UTENTE = "CLIENTE\\svc-ipam-dc";
const PASSWORD = "S3greta!mai-nel-risultato";
const OID_CATENA = "1.2.840.113556.1.4.1941";
const SID_EVENT_LOG_READERS = "S-1-5-32-573";
const SID_REMOTE_MANAGEMENT = "S-1-5-32-580";

const INTEGRAZIONE = {
  id: 1, name: "Dominio", dc_host: "dc1.cliente.local", domain: "cliente.local", base_dn: "DC=cliente,DC=local",
  use_ssl: 1, port: 636, enabled: 1,
} as AdIntegration;

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
});

/* ------------------------------------------------------------ annuario finto */

interface Utente { sam: string; dn: string; uac?: number }
interface Gruppo { dn: string; cn: string; sid?: string; membri: string[] }
interface Annuario { utenti: Utente[]; gruppi: Gruppo[] }

const dnUtente = "CN=svc-ipam-dc,OU=Servizio,DC=cliente,DC=local";
const gruppo = (cn: string, membri: string[], sid?: string): Gruppo => ({ dn: `CN=${cn},CN=Builtin,DC=cliente,DC=local`, cn, sid, membri });

const GRUPPI_NOMI = { elr: "Event Log Readers", rmu: "Remote Management Users", dhcp: "DHCP Administrators" };

/** Annuario di base: l'account esiste, i gruppi esistono, nessuno è dentro. */
function annuarioVuoto(): Annuario {
  return {
    utenti: [{ sam: "svc-ipam-dc", dn: dnUtente, uac: 512 }],
    gruppi: [
      gruppo(GRUPPI_NOMI.elr, [], SID_EVENT_LOG_READERS),
      gruppo(GRUPPI_NOMI.rmu, [], SID_REMOTE_MANAGEMENT),
      gruppo(GRUPPI_NOMI.dhcp, [], "S-1-5-21-1-2-3-1101"),
    ],
  };
}

function inGruppo(a: Annuario, g: Gruppo, dn: string, ricorsivo: boolean, visti = new Set<string>()): boolean {
  if (visti.has(g.dn)) return false;
  visti.add(g.dn);
  if (g.membri.includes(dn)) return true;
  if (!ricorsivo) return false;
  return g.membri.some((m) => {
    const figlio = a.gruppi.find((x) => x.dn === m);
    return figlio ? inGruppo(a, figlio, dn, true, visti) : false;
  });
}

const sfiltra = (v: string): string => v.replace(/\\([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

interface Chiamata { filtro: string }

function clientFinto(a: Annuario, opzioni: { guastoRicerca?: boolean } = {}): { client: Client; chiamate: Chiamata[]; chiuso: () => boolean } {
  const chiamate: Chiamata[] = [];
  let chiuso = false;
  const client = {
    search: async (_base: string, opt: { filter: string }) => {
      chiamate.push({ filtro: opt.filter });
      if (opzioni.guastoRicerca) throw new Error("LDAP: operazione non riuscita");
      const f = opt.filter;
      const sam = /sAMAccountName=([^)]+)\)/.exec(f);
      if (sam) {
        const nome = sfiltra(sam[1]).toLowerCase();
        return { searchEntries: a.utenti.filter((u) => u.sam.toLowerCase() === nome).map((u) => ({ dn: u.dn, userAccountControl: String(u.uac ?? 512) })), searchReferences: [] };
      }
      const sid = /objectSid=(S-[\d-]+)\)/.exec(f)?.[1];
      const cn = /\(cn=([^)]+)\)/.exec(f)?.[1];
      const membro = /\(member(:1\.2\.840\.113556\.1\.4\.1941:)?=([^)]+)\)/.exec(f);
      const trovati = a.gruppi.filter((g) => {
        if (sid !== undefined && g.sid !== sid) return false;
        if (cn !== undefined && g.cn.toLowerCase() !== sfiltra(cn).toLowerCase()) return false;
        if (membro) return inGruppo(a, g, sfiltra(membro[2]), Boolean(membro[1]));
        return true;
      });
      return { searchEntries: trovati.map((g) => ({ dn: g.dn })), searchReferences: [] };
    },
    unbind: async () => {
      chiuso = true;
    },
  } as unknown as Client;
  return { client, chiamate, chiuso: () => chiuso };
}

/* ------------------------------------------------------------------ database */

interface Scena {
  d: Database.Database;
  voce: number;
  host: number[];
}

function voce(d: Database.Database, tipo = "windows"): number {
  return Number(
    d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)")
      .run("Account di prova", tipo, encrypt(UTENTE), encrypt(PASSWORD)).lastInsertRowid,
  );
}

function scena(): Scena {
  deleteTenantDatabase(T);
  return withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.99.0.0/24', 'Clienti')").run().lastInsertRowid);
    const host = [1, 2, 3, 4].map((n) => Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')").run(rete, `10.99.0.${n}`).lastInsertRowid));
    return { d, voce: voce(d), host };
  });
}

function esito(s: Scena, host: number, proto: "winrm" | "wmi", motivo: string): void {
  s.d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, motivo, sort_order) VALUES (?, ?, ?, ?, ?, 0)")
    .run(s.host[host], s.voce, proto, proto === "wmi" ? 135 : 5985, motivo);
}

interface Prove {
  annuario?: Annuario;
  password?: EsitoPassword;
  integrazione?: AdIntegration | undefined | null;
  connessione?: "guasta";
  guastoRicerca?: boolean;
  ricordo?: RicordoErrate;
}

async function controlla(s: Scena, p: Prove = {}): Promise<{ righe: RigaControllo[]; password: EsitoPassword; chiamate: Chiamata[]; connessioni: number; chiamatePassword: number; chiuso: () => boolean; risultato: Awaited<ReturnType<typeof controlloAccount>> }> {
  const finto = clientFinto(p.annuario ?? annuarioVuoto(), { guastoRicerca: p.guastoRicerca });
  let connessioni = 0;
  let chiamatePassword = 0;
  const deps: Partial<DipendenzeControllo> = {
    password: async () => {
      chiamatePassword += 1;
      return p.password ?? "valida";
    },
    integrazione: () => (p.integrazione === null ? undefined : (p.integrazione ?? INTEGRAZIONE)),
    connetti: async () => {
      connessioni += 1;
      if (p.connessione === "guasta") throw new Error("connect ECONNREFUSED 10.99.0.250:636");
      return finto.client;
    },
    ricordo: p.ricordo ?? new RicordoErrate(),
    adesso: () => new Date("2026-11-04T10:00:00.000Z"),
  };
  const risultato = await withTenant(T, () => controlloAccount(s.voce, deps));
  return { righe: risultato.righe, password: risultato.password, chiamate: finto.chiamate, get connessioni() { return connessioni; }, get chiamatePassword() { return chiamatePassword; }, chiuso: finto.chiuso, risultato };
}

const riga = (righe: RigaControllo[], id: string): RigaControllo => {
  const r = righe.find((x) => x.dirittoId === id);
  assert.ok(r, `manca la riga ${id}`);
  return r;
};

/* --------------------------------------------------------------------- prove */

describe("la forma: una riga per diritto del catalogo, nell'ordine del catalogo", () => {
  it("tutti e sei, anche quando non si può verificare niente", async () => {
    const s = scena();
    const c = await controlla(s, { integrazione: null });
    assert.deepEqual(c.righe.map((r) => r.dirittoId), DIRITTI.map((d) => d.id));
    for (const r of c.righe) assert.ok(r.base.length > 0, `${r.dirittoId}: la base dice su che cosa si fonda lo stato`);
  });

  it("controllaAccount dà le sole righe, come nell'interfaccia del piano", async () => {
    const s = scena();
    const righe = await withTenant(T, () => controllaAccount(s.voce, { password: async () => "valida", integrazione: () => undefined, adesso: () => new Date() }));
    assert.equal(righe.length, DIRITTI.length);
  });
});

describe("gruppi: il filtro ricorsivo", () => {
  it("gruppo diretto: l'account è in Event Log Readers e Remote Management Users → «eventi dei DC» sì", async () => {
    const s = scena();
    const a = annuarioVuoto();
    a.gruppi[0].membri.push(dnUtente);
    a.gruppi[1].membri.push(dnUtente);
    const c = await controlla(s, { annuario: a });
    assert.equal(riga(c.righe, "eventi_dc").stato, "si");
    assert.ok(c.chiamate.some((x) => x.filtro.includes(OID_CATENA)), "il filtro è quello ricorsivo");
  });

  it("gruppo annidato: l'account è nel gruppo «IT-Letture», che sta dentro Event Log Readers → sì (col filtro diretto sarebbe no)", async () => {
    const s = scena();
    const a = annuarioVuoto();
    const it = gruppo("IT-Letture", [dnUtente]);
    a.gruppi.push(it);
    a.gruppi[0].membri.push(it.dn);
    a.gruppi[1].membri.push(dnUtente);
    const c = await controlla(s, { annuario: a });
    assert.equal(riga(c.righe, "eventi_dc").stato, "si", JSON.stringify(c.chiamate));
  });

  it("solo uno dei due gruppi: «eventi dei DC» è no, e la base dice quale manca", async () => {
    const s = scena();
    const a = annuarioVuoto();
    a.gruppi[0].membri.push(dnUtente);
    const c = await controlla(s, { annuario: a });
    const r = riga(c.righe, "eventi_dc");
    assert.equal(r.stato, "no");
    assert.match(r.base, /Remote Management Users/);
  });

  it("utente senza gruppi: eventi e DHCP no; ma l'utente di dominio c'è, quindi «computer, utenti, gruppi» sì", async () => {
    const s = scena();
    const c = await controlla(s);
    assert.equal(riga(c.righe, "eventi_dc").stato, "no");
    assert.equal(riga(c.righe, "dhcp").stato, "no");
    assert.equal(riga(c.righe, "account_dominio").stato, "si");
  });

  it("DHCP: l'account nel gruppo DHCP Administrators e in Remote Management Users → sì", async () => {
    const s = scena();
    const a = annuarioVuoto();
    a.gruppi[2].membri.push(dnUtente);
    a.gruppi[1].membri.push(dnUtente);
    assert.equal(riga((await controlla(s, { annuario: a })).righe, "dhcp").stato, "si");
  });

  it("i gruppi di sistema si riconoscono dal SID, non dal nome: un DC in italiano li chiama diversamente", async () => {
    const s = scena();
    const a = annuarioVuoto();
    a.gruppi[0].cn = "Lettori del log eventi";
    a.gruppi[1].cn = "Utenti gestione remota";
    a.gruppi[0].membri.push(dnUtente);
    a.gruppi[1].membri.push(dnUtente);
    assert.equal(riga((await controlla(s, { annuario: a })).righe, "eventi_dc").stato, "si");
  });

  it("DHCP con un nome che sul DC non esiste (altra lingua): non_verificato, mai «no»", async () => {
    const s = scena();
    const a = annuarioVuoto();
    a.gruppi = a.gruppi.filter((g) => g.cn !== GRUPPI_NOMI.dhcp);
    a.gruppi[1].membri.push(dnUtente);
    assert.equal(riga((await controlla(s, { annuario: a })).righe, "dhcp").stato, "non_verificato");
  });

  it("il valore del filtro si scrive con le sequenze di sfuggita: un DN con parentesi non rompe il filtro", async () => {
    const s = scena();
    const a = annuarioVuoto();
    const dn = "CN=svc (ipam),OU=Servizio,DC=cliente,DC=local";
    a.utenti[0].dn = dn;
    a.gruppi[0].membri.push(dn);
    a.gruppi[1].membri.push(dn);
    const c = await controlla(s, { annuario: a });
    assert.equal(riga(c.righe, "eventi_dc").stato, "si");
    assert.ok(c.chiamate.every((x) => !x.filtro.includes("svc (ipam)")), "la parentesi non resta nuda nel filtro");
  });

  it("account disabilitato nel dominio: «computer, utenti, gruppi» è no", async () => {
    const s = scena();
    const a = annuarioVuoto();
    a.utenti[0].uac = 514;
    assert.equal(riga((await controlla(s, { annuario: a })).righe, "account_dominio").stato, "no");
  });

  it("l'account non c'è nell'annuario: nessun «no» sui gruppi, non lo si sa; l'account di dominio è no", async () => {
    const s = scena();
    const a = annuarioVuoto();
    a.utenti = [];
    const c = await controlla(s, { annuario: a });
    assert.equal(riga(c.righe, "account_dominio").stato, "no");
    assert.equal(riga(c.righe, "eventi_dc").stato, "non_verificato");
    assert.equal(riga(c.righe, "dhcp").stato, "non_verificato");
  });

  it("il client LDAP si chiude sempre", async () => {
    const s = scena();
    const c = await controlla(s);
    assert.equal(c.chiuso(), true);
  });
});

describe("non_verificato, mai «no», quando non si può sapere", () => {
  const dalDominio = ["eventi_dc", "dhcp", "account_dominio"];

  it("LDAP che non risponde (connessione rifiutata)", async () => {
    const s = scena();
    const c = await controlla(s, { connessione: "guasta" });
    for (const id of dalDominio) assert.equal(riga(c.righe, id).stato, "non_verificato", id);
  });

  it("una ricerca che fallisce a metà", async () => {
    const s = scena();
    const c = await controlla(s, { guastoRicerca: true });
    for (const id of dalDominio) assert.equal(riga(c.righe, id).stato, "non_verificato", id);
    assert.equal(c.chiuso(), true, "anche dopo l'errore il client si chiude");
  });

  it("nessuna integrazione Active Directory: non si apre nessuna connessione", async () => {
    const s = scena();
    const c = await controlla(s, { integrazione: null });
    for (const id of dalDominio) assert.equal(riga(c.righe, id).stato, "non_verificato", id);
    assert.equal(c.connessioni, 0);
  });

  it("l'account non è del dominio dell'integrazione (account locale): niente da chiedere al DC", async () => {
    const s = scena();
    withTenant(T, () => s.d.prepare("UPDATE credentials SET encrypted_username = ? WHERE id = ?").run(encrypt("PC-CONTAB\\admin"), s.voce));
    const c = await controlla(s);
    for (const id of dalDominio) assert.equal(riga(c.righe, id).stato, "non_verificato", id);
    assert.equal(c.connessioni, 0);
    assert.match(riga(c.righe, "eventi_dc").base, /dominio/i);
  });

  it("«Registrazione degli eventi» non si verifica da qui, qualunque cosa risponda il DC", async () => {
    const s = scena();
    const c = await controlla(s);
    assert.equal(riga(c.righe, "audit_gpo").stato, "non_verificato");
  });
});

describe("sui PC non si prova niente: lo stato viene dagli esiti scritti", () => {
  it("«2 su 3» con diritti mancanti sul terzo: in parte. Prima diceva Sì e «nessun diritto mancante», ed era falso", async () => {
    const s = scena();
    esito(s, 0, "winrm", "ok");
    esito(s, 1, "winrm", "ok");
    esito(s, 2, "winrm", "diritti_mancanti");
    const c = await controlla(s);
    assert.equal(riga(c.righe, "inventario_winrm").stato, "in_parte");
    assert.match(riga(c.righe, "inventario_winrm").base, /2 su 3/);
    assert.equal(riga(c.righe, "software_patch").stato, "in_parte");
  });

  it("entrato dove ha risposto, il resto muto: sì, nessun host ha detto che manca un diritto", async () => {
    const s = scena();
    esito(s, 0, "winrm", "ok");
    esito(s, 1, "winrm", "firewall");
    const c = await controlla(s);
    assert.equal(riga(c.righe, "inventario_winrm").stato, "si");
    assert.match(riga(c.righe, "inventario_winrm").base, /1 su 2/);
  });

  for (const motivo of ["firewall", "errore", "password_errata"] as const) {
    it(`solo ${motivo}: non si sa se il diritto c'è, non_verificato col motivo, mai «no»`, async () => {
      const s = scena();
      esito(s, 0, "wmi", motivo);
      esito(s, 1, "wmi", motivo);
      const c = await controlla(s);
      const r = riga(c.righe, "inventario_wmi");
      assert.equal(r.stato, "non_verificato");
      assert.match(r.base, { firewall: /2 firewall/, errore: /2 con errore/, password_errata: /2 con password errata/ }[motivo]);
      assert.match(r.base, /WMI/);
    });
  }

  it("«0 su N»: provato su host e mai entrato → no; conta gli host provati, non quelli con la porta chiusa", async () => {
    const s = scena();
    esito(s, 0, "wmi", "diritti_mancanti");
    esito(s, 1, "wmi", "firewall");
    esito(s, 2, "wmi", "porte_chiuse");
    esito(s, 3, "wmi", "budget_esaurito");
    const c = await controlla(s);
    assert.equal(riga(c.righe, "inventario_wmi").stato, "no");
    assert.match(riga(c.righe, "inventario_wmi").base, /0 su 2/);
  });

  it("WinRM e WMI sono due strade: la stessa voce può entrare da una e mancare dei diritti sull'altra", async () => {
    const s = scena();
    esito(s, 0, "winrm", "ok");
    esito(s, 0, "wmi", "diritti_mancanti");
    const c = await controlla(s);
    assert.equal(riga(c.righe, "inventario_winrm").stato, "si");
    assert.equal(riga(c.righe, "inventario_wmi").stato, "no");
  });

  it("«Software e patch» segue WinRM: serve quello", async () => {
    const s = scena();
    esito(s, 0, "winrm", "diritti_mancanti");
    const c = await controlla(s);
    assert.equal(riga(c.righe, "software_patch").stato, "no");
  });

  it("nessun esito (mai scansionato, o solo porte chiuse): non_verificato, mai «no»", async () => {
    const s = scena();
    esito(s, 0, "winrm", "porte_chiuse");
    const c = await controlla(s);
    assert.equal(riga(c.righe, "inventario_winrm").stato, "non_verificato");
    assert.equal(riga(c.righe, "inventario_wmi").stato, "non_verificato");
    assert.equal(riga(c.righe, "software_patch").stato, "non_verificato");
  });

  it("gli esiti di un'altra voce non contano", async () => {
    const s = scena();
    const altra = withTenant(T, () => voce(s.d));
    s.d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, motivo, sort_order) VALUES (?, ?, 'winrm', 5985, 'ok', 0)").run(s.host[0], altra);
    const c = await controlla(s);
    assert.equal(riga(c.righe, "inventario_winrm").stato, "non_verificato");
  });
});

describe("la password", () => {
  it("valida, errata, non verificabile: l'esito si riporta, e con non_so il controllo continua", async () => {
    for (const esitoPassword of ["valida", "errata", "non_so"] as const) {
      const s = scena();
      const c = await controlla(s, { password: esitoPassword });
      assert.equal(c.password, esitoPassword);
      assert.equal(c.righe.length, DIRITTI.length, `con ${esitoPassword} le righe ci sono tutte`);
      assert.equal(riga(c.righe, "account_dominio").stato, "si");
    }
  });

  it("un errore della verifica è non_so, non un guasto del controllo", async () => {
    const s = scena();
    const risultato = await withTenant(T, () =>
      controlloAccount(s.voce, {
        password: async () => { throw new Error("boom"); },
        integrazione: () => undefined,
        ricordo: new RicordoErrate(),
        adesso: () => new Date(),
      }),
    );
    assert.equal(risultato.password, "non_so");
  });

  it("la data è quella del controllo", async () => {
    const s = scena();
    const c = await controlla(s);
    assert.equal(c.risultato.controllatoIl, "2026-11-04T10:00:00.000Z");
  });

  it("errata ricordata: un secondo clic non rifà il bind sbagliato sul DC (un bind errato per clic blocca l'account)", async () => {
    const s = scena();
    const ricordo = new RicordoErrate();
    const primo = await controlla(s, { password: "errata", ricordo });
    assert.equal(primo.chiamatePassword, 1);
    const secondo = await controlla(s, { password: "valida", ricordo });
    assert.equal(secondo.chiamatePassword, 0);
    assert.equal(secondo.password, "errata");
  });

  it("valida e non_so non si ricordano", async () => {
    const s = scena();
    const ricordo = new RicordoErrate();
    await controlla(s, { password: "non_so", ricordo });
    const secondo = await controlla(s, { password: "valida", ricordo });
    assert.equal(secondo.chiamatePassword, 1);
    assert.equal(secondo.password, "valida");
  });
});

describe("la voce", () => {
  it("una voce che non è Windows non si controlla: VoceNonWindows", async () => {
    const s = scena();
    const ssh = withTenant(T, () => voce(s.d, "ssh"));
    await assert.rejects(withTenant(T, () => controlloAccount(ssh, {})), VoceNonWindows);
  });

  it("una voce che non esiste: VoceNonWindows, con parole sue", async () => {
    scena();
    await assert.rejects(withTenant(T, () => controlloAccount(99999, {})), (e: unknown) => e instanceof VoceNonWindows && /non trovata/i.test(e.message));
  });

  it("nel risultato non ci sono né la password né il nome utente", async () => {
    const s = scena();
    const a = annuarioVuoto();
    a.gruppi[0].membri.push(dnUtente);
    esito(s, 0, "winrm", "ok");
    const c = await controlla(s, { annuario: a, password: "valida" });
    const testo = JSON.stringify(c.risultato);
    assert.ok(!testo.includes(PASSWORD), "password nel risultato");
    assert.ok(!testo.toLowerCase().includes("svc-ipam-dc"), "nome utente nel risultato");
  });
});
