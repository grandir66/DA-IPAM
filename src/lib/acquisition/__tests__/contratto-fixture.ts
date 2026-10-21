/**
 * Fixture del contratto comune (C0.5): una per collector, con la forma delle uscite vere e dati inventati
 * (IP di documentazione, MAC 02:00:00, nessun nome di cliente). Una famiglia nuova aggiunge qui la sua voce:
 * `Record<CollectorId, …>` fa fallire `tsc` se manca, e `contratto.test.ts` la esegue.
 */
import type { CollectorId } from "../catalogo";
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports, ReadResult, SnmpRow } from "../schema";
import { collectDevice } from "../index";
import { collectVmwareEsxi } from "../vmware-esxi";
import { collectNetappOntap } from "../netapp-ontap";
import { ONTAP_ENDPOINTS } from "../ontap-transport";
import type { OntapInventory } from "../ontap-transport";
import type { VsphereInventory, PropertyObject } from "../vsphere-transport";

export const SEGRETO = "SEGRETO-FIXTURE-NON-STAMPARE";
const PIN = Array(32).fill("AB").join(":");
const ok = <T>(data: T): ReadResult<T> => ({ status: "ok", data, warnings: [] });
const SYS_DESCR = "1.3.6.1.2.1.1.1.0";

export interface Esito { snapshot: AcquisitionSnapshot; chiamateShell: number }
export interface FixtureCollector {
    richiesta: AcquisitionRequest;
    /** Uscite plausibili. */
    normale(): Promise<Esito>;
    /** Famiglia riconosciuta, ma le altre uscite hanno un formato che il parser non conosce. */
    formatoIgnoto?(): Promise<Esito>;
    /** Stessa richiesta senza credenziale SSH. */
    senzaSsh?(): Promise<Esito>;
    /** Ogni lettura fallisce lanciando un errore che nomina il segreto. */
    trasportoGuasto(): Promise<Esito>;
}

function consola(profilo: { identita: Record<string, string>; snmp?: SnmpRow[] }, altro: (comando: string) => string) {
    return (opzioni: { ssh: boolean; guasto?: boolean }) => {
        let chiamate = 0;
        const t: AcquisitionTransports = {
            get: async () => { if (opzioni.guasto) throw Error(SEGRETO); return ok(profilo.snmp ?? []); },
            walk: async () => { if (opzioni.guasto) throw Error(SEGRETO); return ok([]); },
            shell: async comandi => { chiamate++; if (opzioni.guasto) throw Error(SEGRETO); return Object.fromEntries(comandi.map(c => [c, ok(profilo.identita[c] ?? altro(c))])); },
        };
        return { t, chiamate: () => chiamate };
    };
}
function perShell(richiesta: AcquisitionRequest, fabbrica: ReturnType<typeof consola>): FixtureCollector {
    const esegui = async (req: AcquisitionRequest, o: { ssh: boolean; guasto?: boolean }): Promise<Esito> => { const { t, chiamate } = fabbrica(o); const snapshot = await collectDevice(req, t); return { snapshot, chiamateShell: chiamate() }; };
    return {
        richiesta,
        normale: () => esegui(richiesta, { ssh: true }),
        trasportoGuasto: () => esegui(richiesta, { ssh: true, guasto: true }),
        senzaSsh: () => { const { ssh: _ssh, ...resto } = richiesta as AcquisitionRequest & { ssh?: unknown }; void _ssh; return esegui({ ...resto, snmp: { community: SEGRETO } } as AcquisitionRequest, { ssh: false }); },
    };
}
const GARBAGE = (c: string) => `@@ ${c}: formato mai visto ##\n???`;

const qnapIdent = `Model name : QSW-M3216R-8S8T\nSwitch firmware : 4.5.0.847494 (20260908)\nSerial number : LAB0001\nSwitch name : sw-${SEGRETO}\nTemperature : 42\nFan 1 speed : 4200`;
const qnapNormale = (c: string) => c === "show interfaces status" ? "Ex0/7 connected Full 2.5 Gbps Auto" : c === "show vlan" ? "Vlan ID : 40\nMember Ports : Ex0/7\nUntagged Ports : None\nName : LAB" : c === "show lldp neighbors" ? "Total Entries Displayed : 0" : c === "show mac-address-table" ? "Total Mac Addresses displayed: 0" : c === "show system temperature" ? "CPU Temperature : 48 C" : "";
const qnapReq: AcquisitionRequest = { collector: "qnap-switch", host: "192.0.2.1", ssh: { username: "lab", password: SEGRETO } };

const procurveIdent: Record<string, string> = { "show system": "Software revision : YC.16.11.0020 Base MAC Addr : 020000-000001\nSerial Number : LAB001\nCPU Util (%) : 0 Free : 1000\nMemory - Total : 2000", "show version": "YC.16.11.0020" };
const procurveSnmp: SnmpRow[] = [{ oid: SYS_DESCR, value: "Aruba JL357A 2540-48G-PoE+-4SFP+ Switch, revision YC.16.11.0020, ROM YC.16.01.0003" }];
const procurveNormale = (c: string) => c === "show interfaces brief" ? "49-Trk3 SFP+SR | No Yes Up 10GigFD NA off 0" : c === "show vlans" ? "40 LAB | Port-based No No" : "";
const procurveReq: AcquisitionRequest = { collector: "hp-procurve", host: "192.0.2.2", ssh: { username: "lab", password: SEGRETO }, snmp: { community: SEGRETO } };

const comwareIdent: Record<string, string> = { "display version": "HPE Comware Software, Version 7.1.045, Release 2432P06\nHPE FF 5700-40XG-2QSFP+ Switch with 2 Processors uptime is 0 weeks, 1 day, 0 hours, 0 minutes" };
const comwareSnmp: SnmpRow[] = [{ oid: SYS_DESCR, value: "HPE Comware Software Version 7.1.045" }];
const comwareNormale = (c: string) => c === "display interface brief" ? "XGE1/0/1 UP 10G(a) F(a) A 17 lab" : "";
const comwareReq: AcquisitionRequest = { collector: "hp-comware", host: "192.0.2.3", ssh: { username: "lab", password: SEGRETO }, snmp: { community: SEGRETO } };

function conGarbage(base: FixtureCollector, ident: Record<string, string>, snmp: SnmpRow[] | undefined): FixtureCollector {
    return {
        ...base,
        formatoIgnoto: async () => { let chiamate = 0; const t: AcquisitionTransports = { get: async () => ok(snmp ?? []), walk: async () => ok([]), shell: async comandi => { chiamate++; return Object.fromEntries(comandi.map(c => [c, ok(ident[c] ?? GARBAGE(c))])); } }; const snapshot = await collectDevice(base.richiesta, t); return { snapshot, chiamateShell: chiamate }; },
    };
}

const prop = (ref: string, type: string, props: Record<string, unknown>): PropertyObject => ({ ref, type, props, missing: [] });
const esxiRaw = (): VsphereInventory => ({ about: { apiType: "HostAgent", apiVersion: "8.0.3.0", fullName: "VMware ESXi 8.0.3", build: "LAB" }, host: prop("ha-host", "HostSystem", { name: `host-${SEGRETO}`, summary: { hardware: { cpuMhz: "2000" }, quickStats: { overallCpuUsage: "0", overallMemoryUsage: "0", uptime: "0" } }, hardware: { systemInfo: { vendor: "Lab", model: "LabServer", uuid: "LABUUID" }, memorySize: "9007199254740993", cpuInfo: { numCpuPackages: "1", numCpuCores: "8", numCpuThreads: "16" } }, runtime: { inMaintenanceMode: "false" } }), vms: [], datastores: [], warnings: [] }) as unknown as VsphereInventory;
const esxiReq: AcquisitionRequest = { collector: "vmware-esxi", host: "192.0.2.4", api: { username: "lab", password: SEGRETO, tls_sha256: PIN } };
const ontapRaw = (): OntapInventory => { const raw = Object.fromEntries(Object.keys(ONTAP_ENDPOINTS).map(k => [k, { status: "ok", data: [], warnings: [] }])) as unknown as OntapInventory; raw.cluster.data = [{ uuid: "cluster-1", name: `cl-${SEGRETO}`, version: { full: "NetApp Release 9.16.1" } }]; return raw; };
const ontapReq: AcquisitionRequest = { collector: "netapp-ontap", host: "192.0.2.5", api: { username: "lab", password: SEGRETO, tls_sha256: PIN } };

export const FIXTURE: Record<CollectorId, FixtureCollector> = {
    "qnap-switch": conGarbage(perShell(qnapReq, consola({ identita: { "show system-information": qnapIdent } }, qnapNormale)), { "show system-information": qnapIdent }, undefined),
    "hp-procurve": conGarbage(perShell(procurveReq, consola({ identita: procurveIdent, snmp: procurveSnmp }, procurveNormale)), procurveIdent, procurveSnmp),
    "hp-comware": conGarbage(perShell(comwareReq, consola({ identita: comwareIdent, snmp: comwareSnmp }, comwareNormale)), comwareIdent, comwareSnmp),
    "vmware-esxi": {
        richiesta: esxiReq,
        normale: async () => ({ snapshot: await collectVmwareEsxi(esxiReq, async () => esxiRaw()), chiamateShell: 0 }),
        trasportoGuasto: async () => ({ snapshot: await collectVmwareEsxi(esxiReq, async () => { throw Error(SEGRETO); }), chiamateShell: 0 }),
    },
    "netapp-ontap": {
        richiesta: ontapReq,
        normale: async () => ({ snapshot: await collectNetappOntap(ontapReq, async () => ontapRaw()), chiamateShell: 0 }),
        trasportoGuasto: async () => ({ snapshot: await collectNetappOntap(ontapReq, async () => { throw Error(SEGRETO); }), chiamateShell: 0 }),
    },
};
