/**
 * La modifica in blocco e quella del singolo apparato non toccano le credenziali
 * lasciate su «Non modificare» (tappa 2 credenziali, T5, 15/10).
 *
 * Incidente: la finestra «Assegna caratteristiche» partiva con le due tendine
 * delle credenziali a `null` e il corpo del PATCH le mandava come
 * `credential_id: null` e `snmp_credential_id: null`. Cambiare solo la
 * classificazione di dieci apparati ne azzerava colonne, utente e password
 * (`api/devices/bulk/route.ts`): per 6 apparati di H1 e 1 di A erano l'unico
 * accesso. Le tre finestre del singolo (`edit-device-dialog.tsx`,
 * `devices/[id]/page.tsx`, `device-list-by-classification.tsx`) mandavano sempre
 * i due campi, con `null` se la tendina era vuota: oggi innocuo (il PUT riscrive
 * una colonna già NULL), dalla 2e `null` toglie i binding.
 *
 * Regola: «Non modificare» = campo assente; «Nessuna» = `null`; un campo del
 * singolo che non cambia rispetto all'apparato non si manda.
 *
 * Run: node --import tsx --test "src/app/(dashboard)/devices/__tests__/modifica-in-blocco.test.ts"
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  corpoModificaInBlocco,
  corpoHaModifiche,
  corpoModificaApparato,
  inviaConConferma,
  tendineDaApparato,
  type StatoModificaInBlocco,
} from "../modifica-in-blocco";
import { portaAlCambioProtocollo } from "@/lib/devices/porta-protocollo";
import type { UsataAdesso } from "@/lib/devices/usata-adesso";

/**
 * «Usata adesso» di un apparato come la dà GET /api/devices/[id] (tappa 2e,
 * T20): la riga principale e, se c'è, quella SNMP aggiuntiva. Le tendine
 * partono da qui, non dalle colonne `credential_id` e `snmp_credential_id`,
 * che dopo la 2e sono vuote.
 */
function usate(principale: number | null, snmp?: number | null): { usata_adesso: UsataAdesso[] } {
  const riga = (ruolo: UsataAdesso["ruolo"], protocollo: UsataAdesso["protocollo"], id: number | null): UsataAdesso => ({
    ruolo,
    protocollo,
    credential_id: id,
    nome: id != null ? `voce ${id}` : null,
    fonte: id != null ? "device_binding" : null,
    porta: id != null ? 22 : null,
    motivo: id != null ? null : "Nessuna credenziale",
  });
  const righe = [riga("principale", "ssh", principale)];
  if (snmp !== undefined) righe.push(riga("snmp", "snmp", snmp));
  return { usata_adesso: righe };
}

/** Lo stato con cui si apre la finestra in blocco: tutto su «Non modificare». */
const STATO_INIZIALE_BLOCCO: StatoModificaInBlocco = {
  deviceIds: [11, 12, 13],
  hostIds: [],
  classification: "",
  protocol: "",
  vendor: "",
  credentialId: null,
  snmpCredentialId: null,
};

describe("modifica in blocco", () => {
  it("solo la classificazione cambiata: niente credenziali nel corpo", () => {
    const corpo = corpoModificaInBlocco({ ...STATO_INIZIALE_BLOCCO, classification: "switch" });
    assert.deepEqual(corpo, { device_ids: [11, 12, 13], classification: "switch" });
    assert.ok(!("credential_id" in corpo), "credential_id non deve esserci");
    assert.ok(!("snmp_credential_id" in corpo), "snmp_credential_id non deve esserci");
  });

  it("la tendina vuota scritta come stringa vuota vale «Non modificare»", () => {
    const corpo = corpoModificaInBlocco({
      ...STATO_INIZIALE_BLOCCO,
      vendor: "cisco",
      credentialId: "",
      snmpCredentialId: "",
    });
    assert.deepEqual(corpo, { device_ids: [11, 12, 13], vendor: "cisco" });
  });

  it("una voce scelta si manda col suo id", () => {
    const corpo = corpoModificaInBlocco({ ...STATO_INIZIALE_BLOCCO, credentialId: "7" });
    assert.deepEqual(corpo, { device_ids: [11, 12, 13], credential_id: 7 });
  });

  it("«Nessuna» si manda come null, per ognuna delle due tendine", () => {
    assert.deepEqual(corpoModificaInBlocco({ ...STATO_INIZIALE_BLOCCO, credentialId: "none" }), {
      device_ids: [11, 12, 13],
      credential_id: null,
    });
    assert.deepEqual(corpoModificaInBlocco({ ...STATO_INIZIALE_BLOCCO, snmpCredentialId: "none" }), {
      device_ids: [11, 12, 13],
      snmp_credential_id: null,
    });
  });

  it("senza apparati selezionati le credenziali non partono (valgono solo per gli apparati)", () => {
    const corpo = corpoModificaInBlocco({
      ...STATO_INIZIALE_BLOCCO,
      deviceIds: [],
      hostIds: [4],
      classification: "server",
      credentialId: "7",
      snmpCredentialId: "none",
    });
    assert.deepEqual(corpo, { host_ids: [4], classification: "server" });
  });

  it("un id che non è un numero intero positivo è un errore, non un null", () => {
    assert.throws(
      () => corpoModificaInBlocco({ ...STATO_INIZIALE_BLOCCO, credentialId: "abc" }),
      /Credenziale non valida/,
    );
    assert.throws(
      () => corpoModificaInBlocco({ ...STATO_INIZIALE_BLOCCO, snmpCredentialId: "0" }),
      /Credenziale non valida/,
    );
  });

  it("corpoHaModifiche: vero solo con almeno un campo da applicare", () => {
    assert.equal(corpoHaModifiche(corpoModificaInBlocco(STATO_INIZIALE_BLOCCO)), false);
    assert.equal(corpoHaModifiche(corpoModificaInBlocco({ ...STATO_INIZIALE_BLOCCO, protocol: "ssh" })), true);
    assert.equal(corpoHaModifiche(corpoModificaInBlocco({ ...STATO_INIZIALE_BLOCCO, credentialId: "none" })), true);
    // Solo host selezionati e una credenziale scelta: niente da applicare.
    assert.equal(
      corpoHaModifiche(corpoModificaInBlocco({ ...STATO_INIZIALE_BLOCCO, deviceIds: [], hostIds: [4], credentialId: "7" })),
      false,
    );
  });
});

describe("modifica del singolo apparato", () => {
  const campi = { name: "Switch piano 2", vendor: "cisco", protocol: "ssh", scan_target: null };

  it("le colonne vecchie non contano: tendine dalla scelta del motore, vuote senza (riga della lista)", () => {
    const rigaLista = { credential_id: 5, snmp_credential_id: 9 };
    assert.deepEqual(tendineDaApparato(rigaLista), { credentialId: null, snmpCredentialId: null });
    assert.deepEqual(tendineDaApparato(usate(5, 9)), { credentialId: "5", snmpCredentialId: "9" });
    const conRipiego = { usata_adesso: [{ ...usate(null).usata_adesso[0], fonte: "snmp_ripiego" as const, nome: "«public» di ripiego" }] };
    assert.deepEqual(tendineDaApparato(conRipiego), { credentialId: null, snmpCredentialId: null });
  });

  it("solo il nome cambiato, tendine vuote: niente credenziali nel corpo", () => {
    const iniziale = tendineDaApparato(usate(null, null));
    const corpo = corpoModificaApparato(iniziale, { campi, ...iniziale });
    assert.deepEqual(corpo, campi);
    assert.ok(!("credential_id" in corpo), "credential_id non deve esserci");
    assert.ok(!("snmp_credential_id" in corpo), "snmp_credential_id non deve esserci");
  });

  it("solo il nome cambiato, tendine con una voce: niente credenziali nel corpo", () => {
    const iniziale = tendineDaApparato(usate(5, 9));
    const corpo = corpoModificaApparato(iniziale, { campi, ...iniziale });
    assert.deepEqual(corpo, campi);
  });

  it("«Nessuna» su una tendina già vuota non è una modifica", () => {
    const iniziale = tendineDaApparato(usate(null, undefined));
    const corpo = corpoModificaApparato(iniziale, { campi, credentialId: "none", snmpCredentialId: "none" });
    assert.deepEqual(corpo, campi);
  });

  it("una tendina cambiata si manda, l'altra no", () => {
    const iniziale = tendineDaApparato(usate(null, 9));
    assert.deepEqual(corpoModificaApparato(iniziale, { campi, credentialId: "7", snmpCredentialId: "9" }), {
      ...campi,
      credential_id: 7,
    });
    assert.deepEqual(corpoModificaApparato(iniziale, { campi, credentialId: null, snmpCredentialId: "none" }), {
      ...campi,
      snmp_credential_id: null,
    });
  });

  it("non modifica l'oggetto dei campi che riceve", () => {
    const mieiCampi = { ...campi };
    corpoModificaApparato(tendineDaApparato(usate(null)), { campi: mieiCampi, credentialId: "7", snmpCredentialId: null });
    assert.deepEqual(mieiCampi, campi);
  });

  it("un id non valido è un errore, non un null", () => {
    assert.throws(
      () => corpoModificaApparato(tendineDaApparato({}), { campi, credentialId: "7x", snmpCredentialId: null }),
      /Credenziale non valida/,
    );
  });
});

/**
 * La porta nel PUT della modifica (pilota, 16/10): un MikroTik creato in SNMP
 * (161) e passato a SSH è rimasto con port=161 perché il corpo non portava la
 * porta, e l'acquisizione SSH, che usa device.port, falliva.
 */
describe("modifica del singolo apparato: la porta", () => {
  const campi = { name: "MikroTik 10G", vendor: "mikrotik", protocol: "snmp_v2", scan_target: null };
  const ARCHIVIO = [{ id: 3, name: "Community", credential_type: "snmp", port: 161 }];
  const apparato = { protocol: "snmp_v2", port: 161, ...usate(null, 3) };
  const iniziale = { ...tendineDaApparato(apparato), porta: apparato.port };

  it("il caso del pilota: da protocol=snmp_v2/port=161 a ssh il corpo contiene port: 22", () => {
    const porta = portaAlCambioProtocollo({
      protocollo: "ssh",
      credenziali: [null, "3"],
      archivio: ARCHIVIO,
      portaAttuale: apparato.port,
      salvata: { protocollo: apparato.protocol, porta: apparato.port },
    });
    const corpo = corpoModificaApparato(iniziale, {
      campi: { ...campi, protocol: "ssh" },
      credentialId: null,
      snmpCredentialId: "3",
      porta: String(porta),
    });
    assert.equal(corpo.port, 22);
  });

  it("porta uguale a quella salvata, vuota o non passata: non si manda", () => {
    for (const porta of ["161", "", " ", undefined]) {
      const corpo = corpoModificaApparato(iniziale, { campi, credentialId: null, snmpCredentialId: "3", porta });
      assert.ok(!("port" in corpo), `port non deve esserci con ${JSON.stringify(porta)}`);
    }
  });

  it("una porta non valida è un errore, non un salvataggio", () => {
    for (const porta of ["0", "65536", "22.5", "abc"]) {
      assert.throws(
        () => corpoModificaApparato(iniziale, { campi, credentialId: null, snmpCredentialId: "3", porta }),
        /Porta non valida/,
      );
    }
  });
});

/**
 * Revisione della 2e (16/10): dalla 2e il PUT del singolo risponde 409 con
 * `conferma` quando «Nessuna» toglierebbe dei binding. Le finestre del singolo
 * mostravano la domanda come errore, senza modo di confermare
 * (`conferma_rimozione` non partiva mai), e il resto del salvataggio (il nome)
 * si perdeva con la transazione annullata.
 */
describe("salvataggio con la conferma della rimozione", () => {
  const risposta = (stato: number, dati: unknown) => new Response(JSON.stringify(dati), { status: stato, headers: { "Content-Type": "application/json" } });
  const CONFERMA = { error: "Togli 1 binding SSH da 1 apparato, di cui 1 riuscito?", conferma: { domanda: "Togli 1 binding SSH da 1 apparato, di cui 1 riuscito?" } };

  it("409 con la domanda, l'utente conferma: si rimanda lo stesso corpo con conferma_rimozione", async () => {
    const mandati: Record<string, unknown>[] = [];
    const domande: string[] = [];
    const esito = await inviaConConferma(
      async (corpo) => {
        mandati.push(corpo);
        return mandati.length === 1 ? risposta(409, CONFERMA) : risposta(200, { id: 5, name: "nuovo nome" });
      },
      { name: "nuovo nome", credential_id: null },
      (d) => {
        domande.push(d);
        return true;
      },
    );
    assert.deepEqual(domande, [CONFERMA.conferma.domanda]);
    assert.deepEqual(mandati, [
      { name: "nuovo nome", credential_id: null },
      { name: "nuovo nome", credential_id: null, conferma_rimozione: true },
    ]);
    assert.ok(esito);
    assert.equal(esito.res.status, 200);
    assert.equal(esito.data.name, "nuovo nome");
  });

  it("l'utente annulla: null, e non parte una seconda richiesta", async () => {
    let richieste = 0;
    const esito = await inviaConConferma(
      async () => {
        richieste++;
        return risposta(409, CONFERMA);
      },
      { credential_id: null },
      () => false,
    );
    assert.equal(esito, null);
    assert.equal(richieste, 1);
  });

  it("un 409 senza domanda, o un altro errore: torna com'è, senza chiedere", async () => {
    for (const [stato, dati] of [
      [409, { error: "Conflitto" }],
      [400, { error: "La credenziale non vale" }],
    ] as const) {
      const esito = await inviaConConferma(async () => risposta(stato, dati), {}, () => assert.fail("non doveva chiedere"));
      assert.ok(esito);
      assert.equal(esito.res.status, stato);
      assert.equal(esito.data.error, dati.error);
    }
  });
});

/**
 * Guardia sul collegamento: le finestre non si possono rendere senza le API,
 * quindi si legge il sorgente. Le regole sono provate sopra eseguendo il
 * modulo; qui si controlla solo che le finestre lo usino e che il vecchio
 * corpo «sempre i due campi» non torni.
 */
describe("le finestre usano il modulo", () => {
  const radice = process.cwd();
  const leggi = (rel: string) => fs.readFileSync(path.join(radice, rel), "utf8");
  const VECCHIO_CORPO = /credential_id:\s*edit(?:Snmp)?CredentialId\s*&&/;

  for (const rel of [
    "src/components/devices/edit-device-dialog.tsx",
    "src/app/(dashboard)/devices/[id]/page.tsx",
    "src/app/(dashboard)/devices/device-list-by-classification.tsx",
  ]) {
    it(`${rel}: corpoModificaApparato e niente credenziali sempre nel corpo`, () => {
      const src = leggi(rel);
      assert.match(src, /corpoModificaApparato\(/);
      assert.doesNotMatch(src, VECCHIO_CORPO);
    });
    it(`${rel}: il PUT passa da inviaConConferma (la conferma di «Nessuna» si può dare)`, () => {
      assert.match(leggi(rel), /inviaConConferma\(/);
    });
  }

  it("device-list-by-classification.tsx: la modifica in blocco passa da corpoModificaInBlocco", () => {
    const src = leggi("src/app/(dashboard)/devices/device-list-by-classification.tsx");
    assert.match(src, /corpoModificaInBlocco\(/);
    assert.doesNotMatch(src, /bulkCredentialId === null\) body\.credential_id = null/);
  });
});
