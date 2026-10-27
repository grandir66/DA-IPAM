// Calcolo dell'assegnatario proposto (piano 2026-10-23-assegnatari-da-ad, passo 4) e riconoscimento degli account.
// Le soglie sono quelle decise da Riccardo il 23/10: più della metà degli accessi di persone, almeno 5, 30 giorni.
// Trappola della misura sull'hub .8: una postazione con 406.643 accessi di rete di un solo account di applicazione.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eAccountDiServizio, eAccountDiSistema, eNomeAmministrativo, inGruppoPrivilegiato, normalizzaAccount } from "../account";
import { SOGLIE_DI_SERIE, calcolaProposta, type AccessoAggregato, type PersonaAd } from "../proposta";

function persona(account: string, extra: Partial<PersonaAd> = {}): PersonaAd {
  const [nome, cognome] = account.split(".");
  return {
    account, integrationId: 1, guid: `g-${account}`, nome: nome ?? null, cognome: cognome ?? null,
    nomeVisualizzato: null, reparto: "Acquisti", ruolo: null, abilitato: true, amministrativo: false, ...extra,
  };
}
const mappa = (...p: PersonaAd[]) => new Map(p.map((x) => [x.account, x]));
const acc = (account: string, fonte: AccessoAggregato["fonte"], conteggio: number, ultimo = "2026-10-22 17:52:00"): AccessoAggregato =>
  ({ account, fonte, conteggio, ultimo });
const base = { categoria: "Desktop", propostaOff: false, soglie: SOGLIE_DI_SERIE };

test("account: dominio e maiuscole via; sistema, servizio e amministrativi riconosciuti", () => {
  assert.equal(normalizzaAccount("CLIENTE\\S.Colombo"), "s.colombo");
  assert.equal(normalizzaAccount("s.colombo@cliente.local"), "s.colombo");
  assert.equal(normalizzaAccount(" - "), null);
  assert.equal(normalizzaAccount(""), null);
  for (const a of ["pc-acq-03$", "dwm-3", "umfd-12", "system", "anonymous logon"]) assert.equal(eAccountDiSistema(a), true, a);
  assert.equal(eAccountDiSistema("s.colombo"), false);
  for (const a of ["svc_backup", "sql_agent", "healthmailbox0a1b", "erp-svc"]) assert.equal(eAccountDiServizio(a), true, a);
  for (const a of ["s.colombo", "sara", "francesca.russo"]) assert.equal(eAccountDiServizio(a), false, a);
  for (const a of ["admin.domarc", "administrator", "adm-rossi", "rossi-admin", "admin2"]) assert.equal(eNomeAmministrativo(a), true, a);
  for (const a of ["s.colombo", "adamo.rossi", "madmin"]) assert.equal(eNomeAmministrativo(a), false, a);
  assert.equal(inGruppoPrivilegiato(["CN=Domain Admins,CN=Users,DC=cliente,DC=local"]), true);
  assert.equal(inGruppoPrivilegiato("CN=Acquisti,OU=Gruppi,DC=cliente,DC=local"), false);
  assert.equal(inGruppoPrivilegiato(null), false);
});

test("tastiera: 18 su 20 → proposta Sara; amministrativi e servizio fuori dal calcolo ma in tabella", () => {
  const p = calcolaProposta({
    ...base,
    accessi: [
      acc("s.colombo", "wazuh_tastiera", 14), acc("s.colombo", "winrm", 3), acc("s.colombo", "wazuh_rete", 1),
      acc("m.rossi", "wazuh_tastiera", 2),
      acc("admin.domarc", "wazuh_tastiera", 5),
      acc("svc_backup", "wazuh_rete", 30),
    ],
    persone: mappa(persona("s.colombo"), persona("m.rossi"), persona("admin.domarc")),
  });
  assert.equal(p.esito, "proposta");
  assert.equal(p.base, "tastiera");
  assert.equal(p.persona?.account, "s.colombo");
  assert.equal(p.accessiPersona, 17);
  assert.equal(p.totale, 19);
  assert.deepEqual(p.righe.map((r) => [r.account, r.nelCalcolo, r.motivo]), [
    ["s.colombo", true, null], ["m.rossi", true, null], ["svc_backup", false, "servizio"], ["admin.domarc", false, "amministrativo"],
  ]);
  assert.equal(p.righe[0].perFonte.winrm, 3);
});

test("la soglia è «più della metà»: 5 su 10 è condiviso, 6 su 10 è proposta", () => {
  const persone = mappa(persona("a.uno"), persona("b.due"));
  const con = (x: number, y: number) => calcolaProposta({ ...base, persone, accessi: [acc("a.uno", "wazuh_tastiera", x), acc("b.due", "wazuh_tastiera", y)] });
  assert.equal(con(5, 5).esito, "condiviso");
  assert.equal(con(6, 4).esito, "proposta");
});

test("pochi accessi alla tastiera: decide la rete; sotto 5 accessi di persone → pochi dati", () => {
  const persone = mappa(persona("a.uno"), persona("b.due"));
  const p = calcolaProposta({ ...base, persone, accessi: [acc("a.uno", "wazuh_tastiera", 2), acc("a.uno", "wazuh_rete", 40), acc("b.due", "wazuh_rete", 3)] });
  assert.equal(p.base, "rete");
  assert.equal(p.esito, "proposta");
  assert.equal(p.accessiPersona, 40);
  const pochi = calcolaProposta({ ...base, persone, accessi: [acc("a.uno", "wazuh_rete", 3), acc("b.due", "wazuh_rete", 1)] });
  assert.equal(pochi.esito, "pochi_dati");
});

test("l'account di applicazione con 406.643 accessi non è una persona: non vince", () => {
  const p = calcolaProposta({
    ...base,
    persone: mappa(persona("a.uno")),
    accessi: [acc("erpuser", "wazuh_rete", 406_643), acc("a.uno", "wazuh_rete", 12)],
  });
  assert.equal(p.esito, "proposta");
  assert.equal(p.persona?.account, "a.uno");
  assert.equal(p.righe.find((r) => r.account === "erpuser")?.motivo, "non_in_ad");
});

test("disattivati e senza nome non contano; il nome visualizzato in due parole basta", () => {
  const persone = mappa(
    persona("uscito", { nome: "Luca", cognome: "Verdi", abilitato: false }),
    persona("elena", { nome: "Elena", cognome: null }),
    persona("mrossi", { nome: null, cognome: null, nomeVisualizzato: "Marco Rossi" }),
  );
  const p = calcolaProposta({ ...base, persone, accessi: [acc("uscito", "wazuh_tastiera", 50), acc("elena", "wazuh_tastiera", 50), acc("mrossi", "wazuh_tastiera", 6)] });
  assert.equal(p.persona?.account, "mrossi");
  assert.deepEqual(p.righe.filter((r) => !r.nelCalcolo).map((r) => r.motivo).sort(), ["disattivato", "senza_nome"]);
});

test("nessuna riga → nessuna fonte; server e PC segnati condivisi → esclusa, con la persona che sarebbe stata proposta", () => {
  assert.equal(calcolaProposta({ ...base, persone: new Map(), accessi: [] }).esito, "nessuna_fonte");
  const accessi = [acc("a.uno", "wazuh_tastiera", 9)];
  const persone = mappa(persona("a.uno"));
  const server = calcolaProposta({ ...base, categoria: "Server", persone, accessi });
  assert.deepEqual([server.esito, server.perche, server.persona?.account], ["esclusa", "categoria", "a.uno"]);
  const off = calcolaProposta({ ...base, propostaOff: true, persone, accessi });
  assert.deepEqual([off.esito, off.perche], ["esclusa", "segnato_condiviso"]);
  assert.equal(calcolaProposta({ ...base, categoria: "Server", persone, accessi: [] }).esito, "esclusa");
});

test("le soglie si cambiano: al 70% e minimo 10 la stessa misura cambia esito", () => {
  const persone = mappa(persona("a.uno"), persona("b.due"));
  const accessi = [acc("a.uno", "wazuh_tastiera", 6), acc("b.due", "wazuh_tastiera", 3)];
  assert.equal(calcolaProposta({ ...base, persone, accessi }).esito, "proposta");
  assert.equal(calcolaProposta({ ...base, persone, accessi, soglie: { percentuale: 70, minimo: 5, giorni: 30 } }).esito, "condiviso");
  assert.equal(calcolaProposta({ ...base, persone, accessi, soglie: { percentuale: 50, minimo: 10, giorni: 30 } }).esito, "pochi_dati");
});
