import type { AcquisitionInput, AcquisitionSnapshot } from "./schema";
/** Redacts echoed secrets from free text, not protocol enums or numeric counters. Raw errors are never propagated. */
export function redactSnapshot(snapshot: AcquisitionSnapshot, input: AcquisitionInput): AcquisitionSnapshot {
    const secrets = [input.snmp?.community, input.ssh?.password, input.ssh?.privateKey, input.ssh?.passphrase].filter((s): s is string => !!s).sort((a, b) => b.length - a.length);
    const fixed = new Set(['schema_version', 'collector', 'collector_version', 'status', 'kind', 'unit', 'sources', 'warnings', 'counters']);
    function visit(value: unknown, key = ''): unknown {
        if (fixed.has(key))
            return value;
        if (typeof value === 'string') {
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
