/**
 * Catalogo dei collector: l'unico elenco. Enum dell'input, enum dello snapshot, versione di ogni collector e
 * descrittore (cosa riconosce, quali credenziali chiede, quali comandi può lanciare, cosa è collaudato) derivano da qui.
 * Foglia del modulo: non importa i collector né lo schema, così lo schema può importarlo senza cicli.
 * Una famiglia nuova si aggiunge qui, in `index.ts` (la funzione `collect`) e in `__tests__/contratto-fixture.ts`
 * (la fixture): la prova di contratto fallisce se manca uno dei tre. Guida: docs/modules/acquisition.md.
 */
import { QSS_COMMANDS, PROCURVE_COMMANDS, COMWARE_COMMANDS, QNAP_NAS_COMMANDS } from "./comandi";

export type ProtocolloCollector = "snmp" | "ssh" | "api" | "winrm";
export type StatoCollaudo = "collaudato" | "non_collaudato";

export interface DescrittoreCollector {
    id: string;
    /** semver del collector: sale quando cambia ciò che produce, indipendente da `schema_version`. */
    versione: string;
    /** Famiglia di oggetti (switch, nas, hypervisor, storage...). */
    famiglia: string;
    /** Prodotti riconosciuti, in parole (non è un elenco di modelli collaudati). */
    prodotti: readonly string[];
    /** Credenziali accettate; `una_di` = almeno una di queste è obbligatoria; le altre sono rifiutate. */
    credenziali: { ammesse: readonly ProtocolloCollector[]; una_di: readonly ProtocolloCollector[] };
    /** Sezioni dello snapshot che questo collector popola davvero (le altre restano `skipped`/`unsupported`). */
    sezioni: readonly string[];
    /** Allowlist dei comandi di console; `null` se il collector non usa comandi liberi (API, script fissi). */
    comandi: readonly string[] | null;
    /**
     * Come si leggono i comandi via SSH: `console` (shell interattiva col prompt, il default), `exec` (un canale exec per
     * comando sulla stessa connessione: shell Unix), `exec_per_comando` (una connessione per comando: Comware, RouterOS,
     * come fa l'app di sempre). Assente = `console`.
     */
    ssh_modo?: "console" | "exec" | "exec_per_comando";
    /** Script PowerShell fissi per WinRM, per id (mai testo dall'input). Assente = il collector non usa WinRM. */
    script_winrm?: Readonly<Record<string, string>>;
    collaudo: StatoCollaudo;
    /** Modelli e firmware visti su un apparato vero; vuoto finché `collaudo` è `non_collaudato`. */
    collaudati: readonly { modello: string; firmware: string; nota?: string }[];
}

const switchSezioni = ["identity", "interfaces", "vlans", "forwarding", "neighbors", "spanning_tree", "aggregation", "poe", "sensors", "network"] as const;

export const CATALOGO = [
    {
        id: "qnap-switch", versione: "1.0.0", famiglia: "switch", prodotti: ["QNAP QSS (switch gestiti)"],
        credenziali: { ammesse: ["snmp", "ssh"], una_di: ["snmp", "ssh"] },
        sezioni: switchSezioni, comandi: QSS_COMMANDS, collaudo: "collaudato", collaudati: [{ modello: "QSW-M3216R-8S8T", firmware: "QSS 4.5.0.847494 (20260908)" }],
    },
    {
        id: "hp-procurve", versione: "1.0.0", famiglia: "switch", prodotti: ["HPE/Aruba ProCurve", "ArubaOS-Switch"],
        credenziali: { ammesse: ["snmp", "ssh"], una_di: ["snmp", "ssh"] },
        sezioni: [...switchSezioni, "hardware", "modules", "environment"], comandi: PROCURVE_COMMANDS, collaudo: "collaudato",
        collaudati: [{ modello: "Aruba JL357A 2540-48G-PoE+-4SFP+", firmware: "YC.16.11.0020" }, { modello: "HP J9850A 5406R zl2", firmware: "KB.16.09.0003" }],
    },
    {
        id: "hp-comware", versione: "1.0.0", famiglia: "switch", prodotti: ["HPE FlexFabric (Comware)"],
        credenziali: { ammesse: ["snmp", "ssh"], una_di: ["snmp", "ssh"] },
        sezioni: [...switchSezioni, "hardware", "modules", "resources", "environment"], comandi: COMWARE_COMMANDS, ssh_modo: "exec_per_comando", collaudo: "collaudato",
        collaudati: [{ modello: "HPE FlexFabric 5700", firmware: "Comware 7.1.045 Release 2432P06", nota: "IRF a quattro membri; alcune tabelle SNMP parziali" }],
    },
    {
        id: "vmware-esxi", versione: "1.0.0", famiglia: "hypervisor", prodotti: ["VMware ESXi (API diretta dell'host)"],
        credenziali: { ammesse: ["api"], una_di: ["api"] },
        sezioni: ["identity", "interfaces", "vlans", "network", "virtualization", "sensors"], comandi: null, collaudo: "collaudato", collaudati: [{ modello: "HPE ProLiant DL380 Gen11", firmware: "ESXi 8.0.3 build 24677879" }],
    },
    {
        id: "netapp-ontap", versione: "1.0.0", famiglia: "storage", prodotti: ["NetApp ONTAP (REST, anche MetroCluster)"],
        credenziali: { ammesse: ["api"], una_di: ["api"] },
        sezioni: ["identity", "interfaces", "vlans", "network", "storage"], comandi: null, collaudo: "collaudato", collaudati: [{ modello: "NetApp AFF A70", firmware: "ONTAP 9.16.1P11", nota: "MetroCluster IP" }],
    },
    {
        // Non collaudato: parser e fixture dalla forma documentata (DADude3 qnap.py), nessun QNAP NAS vero letto.
        id: "qnap-nas", versione: "0.1.0", famiglia: "nas", prodotti: ["QNAP NAS (QTS, QuTS hero)"],
        credenziali: { ammesse: ["ssh"], una_di: ["ssh"] },
        sezioni: ["identity", "system", "interfaces", "network", "resources", "host_storage", "shares", "software"], comandi: QNAP_NAS_COMMANDS, ssh_modo: "exec",
        collaudo: "non_collaudato", collaudati: [],
    },
] as const satisfies readonly DescrittoreCollector[];

export type CollectorId = (typeof CATALOGO)[number]["id"];

/** Tupla non vuota per `z.enum`. */
export const COLLECTOR_IDS = CATALOGO.map(d => d.id) as unknown as readonly [CollectorId, ...CollectorId[]];

export function descrittore(id: CollectorId): DescrittoreCollector {
    const d = CATALOGO.find(c => c.id === id);
    if (!d) throw Error("COLLECTOR_NOT_IN_CATALOG");
    return d;
}

export function versioneCollector(id: CollectorId): string { return descrittore(id).versione; }

/** Controlla un catalogo: id unici, semver, collaudati solo se collaudato. Restituisce i problemi (vuoto = ok). */
export function verificaCatalogo(catalogo: readonly DescrittoreCollector[]): string[] {
    const problemi: string[] = [];
    const visti = new Set<string>();
    for (const d of catalogo) {
        if (visti.has(d.id)) problemi.push(`${d.id}: id duplicato`);
        visti.add(d.id);
        if (!/^\d+\.\d+\.\d+$/.test(d.versione)) problemi.push(`${d.id}: versione non semver`);
        if (!d.prodotti.length) problemi.push(`${d.id}: nessun prodotto dichiarato`);
        if (!d.sezioni.length) problemi.push(`${d.id}: nessuna sezione dichiarata`);
        if (!d.credenziali.una_di.length || d.credenziali.una_di.some(p => !d.credenziali.ammesse.includes(p))) problemi.push(`${d.id}: credenziali incoerenti`);
        if (d.collaudo === "non_collaudato" && d.collaudati.length) problemi.push(`${d.id}: collaudati dichiarati su un collector non collaudato`);
    }
    return problemi;
}
