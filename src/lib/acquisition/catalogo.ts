/**
 * Catalogo dei collector: l'unico elenco. Enum dell'input, enum dello snapshot, versione di ogni collector e
 * descrittore (cosa riconosce, quali credenziali chiede, quali comandi può lanciare, cosa è collaudato) derivano da qui.
 * Foglia del modulo: non importa i collector né lo schema, così lo schema può importarlo senza cicli.
 * Una famiglia nuova si aggiunge qui, in `index.ts` (la funzione `collect`) e in `__tests__/contratto-fixture.ts`
 * (la fixture): la prova di contratto fallisce se manca uno dei tre. Guida: docs/modules/acquisition.md.
 */
import { SCRIPT_WINDOWS } from "./windows-script";
import { QSS_COMMANDS, PROCURVE_COMMANDS, COMWARE_COMMANDS, QNAP_NAS_COMMANDS, MIKROTIK_ROUTEROS_COMMANDS, LINUX_COMMANDS, SYNOLOGY_DSM_COMMANDS, UBIQUITI_DEVICE_COMMANDS, PROXMOX_VE_COMMANDS } from "./comandi";

/** Le credenziali che l'archivio dell'app sa assegnare a un apparato. */
export type ProtocolloCollector = "snmp" | "ssh" | "api" | "winrm";
/** Più `unifi` (API key della console), che l'app non assegna agli apparati: solo CLI e controller. */
export type ProtocolloDescrittore = ProtocolloCollector | "unifi";
export type StatoCollaudo = "collaudato" | "non_collaudato";

export interface DescrittoreCollector {
    id: string;
    /** semver del collector: sale quando cambia ciò che produce, indipendente da `schema_version`. */
    versione: string;
    /** Famiglia di oggetti (switch, router, nas, server, hypervisor, storage, ap, controller). Decide anche dove l'app proietta le porte: `FAMIGLIE_CON_PORTE`. */
    famiglia: string;
    /** `inventario` = lo legge il motore d'inventario (`inventory-collector.ts`); assente = collector proprio. */
    motore?: "inventario";
    /** Prodotti riconosciuti, in parole (non è un elenco di modelli collaudati). */
    prodotti: readonly string[];
    /** Credenziali accettate; `una_di` = almeno una di queste è obbligatoria; le altre sono rifiutate. */
    credenziali: { ammesse: readonly ProtocolloDescrittore[]; una_di: readonly ProtocolloDescrittore[] };
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
        // Base collaudata in locale (22/10): SSH e SNMP su QNAP veri. Dal giro 3: firmware vero (S2), condivisioni e pacchetti QPKG, non ancora provati su un apparato.
        id: "qnap-nas", versione: "1.1.0", famiglia: "nas", motore: "inventario", prodotti: ["QNAP NAS (QTS, QuTS hero)"],
        credenziali: { ammesse: ["snmp", "ssh"], una_di: ["snmp", "ssh"] },
        sezioni: ["identity", "interfaces", "network", "resources", "shares", "software", "inventory"], comandi: QNAP_NAS_COMMANDS, ssh_modo: "exec",
        collaudo: "collaudato", collaudati: [{ modello: "QNAP NAS (via SNMP: 4 dischi, 2 volumi, 19 interfacce; altro via SSH: 9 interfacce)", firmware: "non registrato nel repo", nota: "condivisioni, pacchetti e firmware da getsysinfo/etc-version non ancora provati su un apparato" }],
    },
    {
        // Base collaudata in locale (22/10): router e switch veri. Dal giro 3: velocità e duplex, PoE, FDB, STP per porta, non ancora provati su un apparato.
        id: "mikrotik-routeros", versione: "1.1.0", famiglia: "router", motore: "inventario", prodotti: ["MikroTik RouterOS 7 (router e switch CRS)"],
        credenziali: { ammesse: ["snmp", "ssh"], una_di: ["snmp", "ssh"] },
        sezioni: ["identity", "interfaces", "vlans", "forwarding", "neighbors", "spanning_tree", "aggregation", "poe", "network", "resources", "inventory"], comandi: MIKROTIK_ROUTEROS_COMMANDS, ssh_modo: "exec",
        collaudo: "collaudato", collaudati: [{ modello: "MikroTik router (12 interfacce) e switch (7 interfacce)", firmware: "RouterOS 7, versione non registrata nel repo", nota: "SwOS e access point radio non collaudati; PoE, FDB e STP per porta non ancora provati" }],
    },
    {
        // Non collaudato: script PowerShell fissi (allowlist WinRM), busta JSON dalla forma documentata dei cmdlet.
        id: "windows", versione: "0.1.0", famiglia: "server", prodotti: ["Microsoft Windows e Windows Server (WinRM), anche Hyper-V"],
        credenziali: { ammesse: ["winrm"], una_di: ["winrm"] },
        sezioni: ["identity", "system", "interfaces", "network", "resources", "host_storage", "software", "services", "security", "guests"], comandi: null, script_winrm: SCRIPT_WINDOWS,
        collaudo: "non_collaudato", collaudati: [],
    },
    {
        // Non collaudato: comandi dal repertorio DADude3 linux.py, uscite dalla documentazione (util-linux, LVM, systemd).
        id: "linux", versione: "0.1.0", famiglia: "server", prodotti: ["Linux (Debian, Ubuntu, RHEL e derivate; utente senza sudo)"],
        credenziali: { ammesse: ["ssh"], una_di: ["ssh"] },
        sezioni: ["identity", "system", "interfaces", "network", "resources", "host_storage", "software", "services"], comandi: LINUX_COMMANDS, ssh_modo: "exec",
        collaudo: "non_collaudato", collaudati: [],
    },
    {
        // Base collaudata in locale (22/10): un Synology vero via SSH/SNMP. Dal giro 3: condivisioni e pacchetti, non ancora provati su un apparato.
        id: "synology-dsm", versione: "1.1.0", famiglia: "nas", motore: "inventario", prodotti: ["Synology NAS (DSM)"],
        credenziali: { ammesse: ["snmp", "ssh"], una_di: ["snmp", "ssh"] },
        sezioni: ["identity", "interfaces", "network", "resources", "shares", "software", "inventory"], comandi: SYNOLOGY_DSM_COMMANDS, ssh_modo: "exec",
        collaudo: "collaudato", collaudati: [{ modello: "Synology NAS (4 dischi, 4 volumi RAID, 8 interfacce)", firmware: "DSM, versione non registrata nel repo", nota: "un secondo Synology era irraggiungibile; condivisioni e pacchetti non ancora provati; `synoshare --enum` o `-enum` da verificare" }],
    },
    {
        // Collaudato in locale (22/10): SNMP su un access point (13 interfacce). SSH rifiutata (autenticazione): nessuna lettura SSH provata.
        id: "ubiquiti-device", versione: "1.0.0", famiglia: "ap", motore: "inventario", prodotti: ["Ubiquiti UniFi (access point e switch, lettura diretta)"],
        credenziali: { ammesse: ["snmp", "ssh"], una_di: ["snmp", "ssh"] },
        sezioni: ["identity", "interfaces", "network", "resources", "inventory"], comandi: UBIQUITI_DEVICE_COMMANDS, ssh_modo: "exec",
        collaudo: "collaudato", collaudati: [{ modello: "Ubiquiti UniFi access point (13 interfacce)", firmware: "non registrato nel repo", nota: "solo SNMP; SSH non collaudata, un secondo apparato non ha risposto" }],
    },
    {
        // Collaudato in locale (22/10): un cluster Proxmox VE di 4 nodi (88 risorse). Nell'app solo credenziali `ssh` dell'archivio; `local_ssh` è per la CLI.
        id: "proxmox-ve", versione: "1.0.0", famiglia: "hypervisor", motore: "inventario", prodotti: ["Proxmox VE (nodo e cluster visibile)"],
        credenziali: { ammesse: ["ssh"], una_di: ["ssh"] },
        sezioni: ["identity", "interfaces", "network", "resources", "inventory"], comandi: PROXMOX_VE_COMMANDS, ssh_modo: "exec",
        collaudo: "collaudato", collaudati: [{ modello: "Proxmox VE, cluster di 4 nodi visibili e 88 risorse", firmware: "versione non registrata nel repo" }],
    },
    {
        // Collaudato in locale (22/10): due console UniFi OS con API key (17 e 11 apparati). Resta separato dai device diretti.
        id: "unifi-controller", versione: "1.0.0", famiglia: "controller", prodotti: ["UniFi OS console (inventario per sito, sola lettura)"],
        credenziali: { ammesse: ["unifi"], una_di: ["unifi"] },
        sezioni: ["controller_inventory"], comandi: null,
        collaudo: "collaudato", collaudati: [{ modello: "UniFi OS console (17 apparati) e UniFi OS console (11 apparati)", firmware: "non registrato nel repo", nota: "radio e client non raccolti" }],
    },
] as const satisfies readonly DescrittoreCollector[];

/** Famiglie con porte da switch: solo loro ricevono la proiezione su `switch_ports` (NAS, server, hypervisor, controller e AP no). */
export const FAMIGLIE_CON_PORTE: ReadonlySet<string> = new Set(["switch", "router"]);
export function ricevePorteDaSwitch(id: CollectorId): boolean { return FAMIGLIE_CON_PORTE.has(descrittore(id).famiglia); }

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
