import { acquisitionInputSchema } from './schema';
import type { AcquisitionInput, AcquisitionRequest, AcquisitionSnapshot } from './schema';
import { acquireInfoblox } from './infoblox-transport';
import { versioneCollector } from './catalogo';
import { sez, chiudi, statoGlobale, sezioniDaSwitchNonApplicabili } from './costruzione';
import type { InfobloxDdi } from './infoblox-schema';
/** Inventario del grid visibile all'account, mai importazione automatica nel DB di DA-IPAM. */
export async function collectInfoblox(request: AcquisitionRequest, acquire: (input: AcquisitionInput) => Promise<InfobloxDdi> = acquireInfoblox): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request), start = Date.now();
    if (input.collector !== 'infoblox-nios') throw Error('COLLECTOR_MISMATCH');
    const snapshot: AcquisitionSnapshot = { schema_version: '1.0', collector: 'infoblox-nios', collector_version: versioneCollector('infoblox-nios'), target: input.host, collected_at: new Date(start).toISOString(), duration_ms: 0, status: 'error', identity: sez(null, 'error'), interfaces: sez([], 'skipped', [], ['GRID_PORTS_NOT_TARGET_INTERFACES']), network: sez({ ipv4_addresses: [], arp: [] }, 'skipped', [], ['GRID_ADDRESSES_ARE_NOT_TARGET_ADDRESSES']), ...sezioniDaSwitchNonApplicabili('NOT_APPLICABLE_TO_DDI_GRID') };
    try {
        const ddi = await acquire(input);
        snapshot.ddi = sez(ddi, statoGlobale(ddi.tables), ['api:Infoblox_WAPI'], [...new Set(ddi.tables.flatMap(t => t.warnings))]);
        if (ddi.wapi_version !== null) {
            const member = ddi.tables.find(t => t.object === 'member')?.records.find(r => r.vip_setting?.address === input.host);
            snapshot.identity = sez({ manufacturer: 'Infoblox', model: member?.platform ?? null, hostname: member?.host_name ?? null, firmware: null, serial_number: null, mac: null, sys_object_id: null, uptime_seconds: null }, 'partial', ['api:WAPI:schema', 'api:WAPI:member'], ['FIRMWARE_NOT_COLLECTED', 'WAPI_VERSION_IS_NOT_NIOS_VERSION', ...(member ? [] : ['TARGET_MEMBER_NOT_IDENTIFIED'])]);
            snapshot.status = snapshot.ddi.status === 'error' ? 'error' : 'partial';
        }
    } catch { snapshot.identity.warnings.push('INFOBLOX_COLLECTION_FAILED'); }
    return chiudi(snapshot, input, start);
}
