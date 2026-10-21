import type { Identity, DeviceInterface, Vlan, Neighbor, Sensor, Aggregation, SnmpRow, Forwarding, StpPort } from "./schema";
export function cleanConsole(value: string): string { return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b/g, "").replace(/\r/g, "").replace(/\x08/g, "").replace(/--\s*More\s*--/gi, ""); }
export function textValue(v: SnmpRow["value"] | undefined): string | null { return v === undefined ? null : typeof v === 'object' ? Buffer.from(v.hex, "hex").toString("utf8").replace(/\0+$/g, "") : String(v); }
function num(v: SnmpRow["value"] | undefined): number | null {
    const t = textValue(v);
    if (t === null || !t.trim())
        return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}
export function counter64(v: SnmpRow["value"]): string {
    if (typeof v === 'object')
        return BigInt('0x' + (v.hex || '0')).toString();
    if (typeof v === 'number' && !Number.isSafeInteger(v))
        throw Error('UNSAFE_COUNTER');
    if (!/^\d+$/.test(String(v)))
        throw Error('INVALID_COUNTER');
    return String(v);
}
export function bitmapPorts(v: SnmpRow["value"]): number[] {
    if (typeof v !== 'object')
        return [];
    const b = Buffer.from(v.hex, 'hex'), out: number[] = [];
    for (let i = 0; i < b.length * 8; i++)
        if (b[i >> 3] & (128 >> (i % 8)))
            out.push(i + 1);
    return out;
}
export function normalizeMac(v: string): string { return v.toLowerCase().replace(/[.:-]/g, '').replace(/(..)(?=.)/g, '$1:'); }
export function emptyInterface(name: string): DeviceInterface { return { name, if_index: null, description: null, kind: /^po\d+$/i.test(name) ? 'aggregate' : 'other', admin_status: null, oper_status: null, speed_bps: null, reported_speed_bps: null, duplex: null, mtu: null, mac: null, counters: {}, pvid: null }; }
export function parseSystem(raw: string): Identity {
    const fields = new Map(cleanConsole(raw).split('\n').flatMap(l => { const m = l.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/); return m ? [[m[1].trim().toLowerCase(), m[2]] as const] : []; }));
    const up = fields.get('system up time')?.match(/(\d+) Days?,\s*(\d+) Hrs?,\s*(\d+) Mins?,\s*(\d+) Secs?/i);
    return { manufacturer: 'QNAP', model: fields.get('model name') || null, firmware: fields.get('switch firmware') || null, serial_number: fields.get('serial number') || null, hostname: fields.get('switch name') || null, mac: fields.has('mac address') ? normalizeMac(fields.get('mac address')!) : null, sys_object_id: null, uptime_seconds: up ? +up[1] * 86400 + +up[2] * 3600 + +up[3] * 60 + +up[4] : null };
}
export function parseInterfaces(raw: string): DeviceInterface[] {
    const out: DeviceInterface[] = [];
    for (const line of cleanConsole(raw).split('\n')) {
        const m = line.trim().match(/^(Ex\d+\/\d+|po\d+)\s+(not connected|connected|disabled|err-disabled)\s+(Full|Half|Auto|--)\s+([\d.]+)\s*([GMK]?)bps\b/i);
        if (!m)
            continue;
        const d = emptyInterface(m[1]);
        d.kind = /^Ex/i.test(m[1]) ? 'physical' : 'aggregate';
        d.oper_status = m[2].toLowerCase() === 'connected' ? 'up' : 'down';
        d.duplex = m[3].toLowerCase();
        d.reported_speed_bps = +m[4] * ({ G: 1e9, M: 1e6, K: 1e3 }[m[5].toUpperCase()] || 1);
        d.speed_bps = d.oper_status === 'up' ? d.reported_speed_bps : null;
        out.push(d);
    }
    return out;
}
export function parseVlans(raw: string): Vlan[] {
    const out: Vlan[] = [];
    for (const block of cleanConsole(raw).split(/Vlan ID\s*:/i).slice(1)) {
        const id = Number(block.match(/^\s*(\d+)/)?.[1]);
        if (!(id >= 1 && id <= 4094))
            continue;
        const fields = new Map<string, string>();
        let key = '';
        for (const line of block.split('\n').slice(1)) {
            const m = line.match(/^\s*([A-Za-z][A-Za-z ]+?)\s*:\s*(.*?)\s*$/);
            if (m) {
                key = m[1].trim();
                fields.set(key, m[2]);
            }
            else if (key && /^\s+(?:Ex\d|po\d)/i.test(line))
                fields.set(key, fields.get(key) + ' ' + line.trim());
        }
        const ports = (k: string) => Array.from(new Set((fields.get(k) || '').match(/Ex\d+\/\d+|po\d+/gi) || []));
        const members = ports('Member Ports'), untagged = ports('Untagged Ports');
        out.push({ id, name: fields.get('Name') || null, tagged_ports: members.filter(p => !untagged.includes(p)), untagged_ports: untagged, forbidden_ports: ports('Forbidden Ports') });
    }
    return out;
}
export function parseNeighbors(raw: string): Neighbor[] {
    const out: Neighbor[] = [];
    for (const line of cleanConsole(raw).split('\n')) {
        const m = line.trim().match(/^([0-9a-f:]{17})\s+(Ex\d+\/\d+|po\d+)\s+(\d+)\s+([A-Z,]+)\s+(\S+)\s*$/i);
        if (m)
            out.push({ local_port: m[2], remote_chassis: normalizeMac(m[1]), remote_port: m[5], system_name: null, system_description: null, management_addresses: [], capabilities: m[4].split(','), ttl_seconds: +m[3] });
    }
    return out;
}
export function parseAggregation(raw: string): Aggregation[] {
    const out: Aggregation[] = [];
    for (const line of cleanConsole(raw).split('\n')) {
        const m = line.trim().match(/^\d+\s+(Po\d+)\(([^)]+)\)\[([^\]]+)\]\s+(\S+)\s*(.*)$/i);
        if (m)
            out.push({ name: m[1].toLowerCase(), protocol: m[4], admin_status: m[3].includes('AU') ? 'up' : m[3].includes('AD') ? 'down' : null, oper_status: m[2].includes('U') ? 'up' : 'down', members: (m[5].match(/Ex\d+\/\d+(?=\()/gi) || []) });
    }
    return out;
}
export function parseTemperatures(raw: string): Sensor[] { return cleanConsole(raw).split('\n').flatMap(line => { const m = line.trim().match(/^(.*?)\s+Temperature\s*:\s*(-?[\d.]+)\s*C\s*$/i); return m ? [{ name: m[1], kind: 'temperature' as const, value: +m[2], unit: 'celsius' as const, note: +m[2] === 0 ? 'ZERO_READING_NOT_DIAGNOSIS' : null }] : []; }); }
export function parseSystemSensors(raw: string): Sensor[] { return cleanConsole(raw).split('\n').flatMap(line => { const m = line.match(/^\s*(Temperature|Fan \d+ speed)\s*:\s*([\d.]+)\s*$/i); return m ? [{ name: m[1], kind: /^Fan/.test(m[1]) ? 'fan' as const : 'temperature' as const, value: +m[2], unit: /^Fan/.test(m[1]) ? 'rpm' as const : 'celsius' as const, note: null }] : []; }); }
export function snmpColumn(rows: SnmpRow[], prefix: string): Map<string, SnmpRow['value']> { return new Map(rows.filter(r => r.oid.startsWith(prefix + '.')).map(r => [r.oid.slice(prefix.length + 1), r.value])); }
export function parseSnmpInterfaces(rows: SnmpRow[], extended: SnmpRow[]): DeviceInterface[] {
    const base = '1.3.6.1.2.1.2.2.1', ext = '1.3.6.1.2.1.31.1.1.1';
    const col = (n: number) => snmpColumn(rows, base + '.' + n), xc = (n: number) => snmpColumn(extended, ext + '.' + n);
    const indexes = new Set([...col(1).keys(), ...col(2).keys()]);
    return [...indexes].map(id => {
        const desc = textValue(col(2).get(id)), d = emptyInterface(textValue(xc(1).get(id)) || desc || 'ifIndex:' + id);
        d.if_index = +id;
        d.description = textValue(xc(18).get(id));
        const type = num(col(3).get(id));
        d.kind = type === 6 ? 'physical' : type === 161 ? 'aggregate' : 'other';
        d.admin_status = ({ 1: 'up', 2: 'down', 3: 'testing' } as Record<number, string>)[num(col(7).get(id)) || 0] || null;
        d.oper_status = ({ 1: 'up', 2: 'down', 3: 'testing', 4: 'unknown', 5: 'dormant', 6: 'notPresent', 7: 'lowerLayerDown' } as Record<number, string>)[num(col(8).get(id)) || 0] || null;
        const high = num(xc(15).get(id)), low = num(col(5).get(id));
        d.reported_speed_bps = high ? high * 1e6 : low !== 4294967295 ? low : null;
        d.speed_bps = d.oper_status === 'up' ? d.reported_speed_bps : null;
        d.mtu = num(col(4).get(id));
        const mac = col(6).get(id);
        d.mac = typeof mac === 'object' ? normalizeMac(mac.hex) : null;
        for (const [name, old, wide] of [['in_octets', 10, 6], ['out_octets', 16, 10], ['in_unicast_packets', 11, 7], ['out_unicast_packets', 17, 11], ['in_discards', 13, 0], ['in_errors', 14, 0], ['out_discards', 19, 0], ['out_errors', 20, 0]] as const) {
            const value = (wide ? xc(wide).get(id) : undefined) ?? col(old).get(id);
            if (value !== undefined)
                d.counters[name] = counter64(value);
        }
        return d;
    });
}
export function parseBridgeMap(rows: SnmpRow[]): Map<number, number> { return new Map([...snmpColumn(rows, '1.3.6.1.2.1.17.1.4.1.2')].map(([k, v]) => [+k, Number(textValue(v))])); }
export function parseFdb(rows: SnmpRow[], bridge: Map<number, number>, interfaces: DeviceInterface[], qbridge = false): Forwarding[] {
    const root = qbridge ? '1.3.6.1.2.1.17.7.1.2.2.1' : '1.3.6.1.2.1.17.4.3.1', col = (n: number) => snmpColumn(rows, root + '.' + n), indexes = new Set([...col(1).keys(), ...col(2).keys()]);
    return [...indexes].flatMap(k => {
        const parts = k.split('.').map(Number), octets = parts.slice(-6);
        if (octets.length !== 6 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255))
            return [];
        const bp = num(col(2).get(k)), idx = bp === null ? null : bridge.get(bp) ?? null;
        return [{ mac: octets.map(n => n.toString(16).padStart(2, '0')).join(':'), vlan_id: null, fdb_id: qbridge ? parts[0] : null, bridge_port: bp, if_index: idx, port: interfaces.find(i => i.if_index === idx)?.name ?? null, status: ({ 1: 'other', 2: 'invalid', 3: 'learned', 4: 'self', 5: 'management' } as Record<number, string>)[num(col(3).get(k)) || 0] ?? null }];
    });
}
export function parseSnmpVlans(rows: SnmpRow[], bridge: Map<number, number>, interfaces: DeviceInterface[]): Vlan[] {
    const root = '1.3.6.1.2.1.17.7.1.4.3.1', col = (n: number) => snmpColumn(rows, root + '.' + n);
    const names = (v: SnmpRow['value'] | undefined) => v === undefined ? [] : bitmapPorts(v).map(p => { const idx = bridge.get(p); return interfaces.find(i => idx !== undefined && i.if_index === idx)?.name ?? 'bridgePort:' + p; });
    return [...col(1)].flatMap(([id, name]) => {
        if (+id < 1 || +id > 4094)
            return [];
        const e = names(col(2).get(id)), u = names(col(4).get(id));
        return [{ id: +id, name: textValue(name), tagged_ports: e.filter(p => !u.includes(p)), untagged_ports: u, forbidden_ports: names(col(3).get(id)) }];
    });
}
export function parseStp(raw: string): StpPort[] {
    const out: StpPort[] = [];
    for (const l of cleanConsole(raw).split('\n')) {
        const m = l.trim().match(/^(Ex\d+\/\d+|po\d+)\s+(\S+)\s+(Forwarding|Discarding|Blocking|Learning|Disabled|Listening)\s+\S+\s*$/i);
        if (m)
            out.push({ port: m[1], instance: null, state: m[3].toLowerCase(), role: m[2].toLowerCase() });
    }
    return out;
}
export function parseConsoleFdb(raw: string): Forwarding[] { return cleanConsole(raw).split('\n').flatMap(l => { const m = l.trim().match(/^(\d+)\s+([0-9a-f:]{17})\s+(Static|Learnt|Learned|Dynamic)\s+(?:\d+\s+)?(Ex\d+\/\d+|po\d+|CPU)\s*$/i); return m ? [{ mac: normalizeMac(m[2]), vlan_id: +m[1], fdb_id: null, bridge_port: null, if_index: null, port: m[4], status: m[3].toLowerCase() }] : []; }); }
export function parseDdm(raw: string): Sensor[] {
    return cleanConsole(raw).split('\n').flatMap(l => {
        const m = l.trim().match(/^(Ex\d+\/\d+)\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/i);
        if (!m || m.slice(2).every(v => +v === 0))
            return [];
        return [{ name: m[1] + ':temperature', kind: 'temperature' as const, value: +m[2], unit: 'celsius' as const, note: null }, { name: m[1] + ':voltage', kind: 'voltage' as const, value: +m[3], unit: 'volt' as const, note: null }, { name: m[1] + ':bias', kind: 'current' as const, value: +m[4] / 1000, unit: 'ampere' as const, note: null }, { name: m[1] + ':tx', kind: 'optical_tx' as const, value: +m[5], unit: 'milliwatt' as const, note: null }, { name: m[1] + ':rx', kind: 'optical_rx' as const, value: +m[6], unit: 'milliwatt' as const, note: null }];
    });
}
export function enrichInterfaceDetails(interfaces: DeviceInterface[], raw: string): void {
    for (const b of cleanConsole(raw).split(/(?=^\s*(?:Ex\d+\/\d+|po\d+) (?:up|down), line protocol)/mi)) {
        const head = b.match(/^\s*(Ex\d+\/\d+|po\d+) (up|down), line protocol is (up|down)/i);
        if (!head)
            continue;
        const d = interfaces.find(x => x.name.toLowerCase() === head[1].toLowerCase());
        if (!d)
            continue;
        d.admin_status = head[2];
        d.mtu = Number(b.match(/MTU\s+(\d+) bytes/i)?.[1]) || d.mtu;
        const mac = b.match(/Hardware Address is ([0-9a-f:]{17})/i)?.[1];
        if (mac)
            d.mac = normalizeMac(mac);
        const alias = b.match(/Interface Alias:\s*([^\n]*)/i)?.[1]?.trim();
        if (alias)
            d.description = alias;
        let direction = '';
        for (const line of b.split('\n')) {
            if (/Reception Counters/.test(line))
                direction = 'in';
            if (/Transmission Counters/.test(line))
                direction = 'out';
            const m = line.match(/^\s*([A-Za-z][A-Za-z /]+?)\s*:\s*(\d+)\s*$/);
            if (direction && m)
                d.counters[direction + '_' + m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')] = m[2];
        }
    }
}
export function applyPvid(interfaces: DeviceInterface[], rows: SnmpRow[], bridge: Map<number, number>): void {
    for (const [bp, value] of snmpColumn(rows, '1.3.6.1.2.1.17.7.1.4.5.1.1')) {
        const idx = bridge.get(+bp), v = num(value);
        const d = interfaces.find(i => idx !== undefined && i.if_index === idx);
        if (d && v !== null && v >= 1 && v <= 4094)
            d.pvid = v;
    }
}
export function parseIpNetwork(ip: SnmpRow[], arp: SnmpRow[]) { const ipRoot = '1.3.6.1.2.1.4.20.1', arpRoot = '1.3.6.1.2.1.4.22.1'; const c = (rows: SnmpRow[], r: string, n: number) => snmpColumn(rows, r + '.' + n); return { ipv4_addresses: [...c(ip, ipRoot, 1)].map(([key, value]) => ({ address: textValue(value) ?? key, netmask: textValue(c(ip, ipRoot, 3).get(key)), if_index: num(c(ip, ipRoot, 2).get(key)) })), arp: [...c(arp, arpRoot, 3)].map(([key, value]) => { const mac = c(arp, arpRoot, 2).get(key); return { address: textValue(value) ?? key.split('.').slice(1).join('.'), mac: typeof mac === 'object' ? normalizeMac(mac.hex) : null, if_index: num(c(arp, arpRoot, 1).get(key)), type: ({ 1: 'other', 2: 'invalid', 3: 'dynamic', 4: 'static' } as Record<number, string>)[num(c(arp, arpRoot, 4).get(key)) ?? 0] ?? null }; }) }; }
export function parseEntityHardware(rows: import('./schema').SnmpRow[]): NonNullable<import('./schema').AcquisitionSnapshot['hardware']>['data'] {
    const base = '1.3.6.1.2.1.47.1.1.1.1', c = (n: number) => snmpColumn(rows, base + '.' + n), ids = new Set([...c(2).keys(), ...c(5).keys(), ...c(7).keys()]);
    return [...ids].filter(id => /^\d+$/.test(id)).map(id => {
        const str = (n: number) => textValue(c(n).get(id))?.trim() || null;
        const num = (n: number) => { const v = str(n); return v !== null && Number.isFinite(Number(v)) ? Number(v) : null; };
        const pos = num(6), fru = num(16);
        return { entity_index: +id, parent_index: num(3), position: pos !== null && pos >= 0 ? pos : null, class_code: num(5), name: str(7), description: str(2), model: str(13), serial_number: str(11), manufacturer: str(12), hardware_revision: str(8), firmware_revision: str(9), software_revision: str(10), alias: str(14), asset_tag: str(15), replaceable: fru === 1 ? true : fru === 2 ? false : null };
    });
}
