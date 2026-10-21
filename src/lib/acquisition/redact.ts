import type { AcquisitionInput, AcquisitionSnapshot } from "./schema";
/** Redacts echoed secrets from free text, not protocol enums or numeric counters. Raw errors are never propagated. */
export function redactSnapshot(snapshot: AcquisitionSnapshot, input: AcquisitionInput): AcquisitionSnapshot {
    const secrets = [input.api?.password, input.snmp?.community, input.ssh?.password, input.ssh?.privateKey, input.ssh?.passphrase].filter((s): s is string => !!s).sort((a, b) => b.length - a.length);
    const fixed = new Set(['schema_version', 'collector', 'collector_version', 'status', 'kind', 'unit', 'sources', 'warnings', 'counters', 'scope', 'configuration_scope', 'vlan_mode']);
    function visit(value: unknown, key = ''): unknown {
        if (fixed.has(key))
            return value;
        if (typeof value === 'string') {
            if (['capacity_bytes','memory_bytes','free_bytes','uncommitted_bytes','size_bytes','used_bytes','available_bytes','logical_used_bytes','physical_size_bytes','usable_size_bytes'].includes(key) && /^\d+$/.test(value)) return value;
            for (const s of secrets)
                value = (value as string).split(s).join('[REDACTED]');
            return value;
        }
        if (Array.isArray(value))
            return value.map(v => visit(v, key));
        if (value && typeof value === 'object')
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, k)]));
        return value;
    }
    return visit(snapshot) as AcquisitionSnapshot;
}
