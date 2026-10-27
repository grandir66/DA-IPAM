import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { AcquisitionInput, ReadResult } from './schema';
import { object, text, array } from './vsphere-transport';
export const ONTAP_ENDPOINTS = { cluster: '/api/cluster?fields=uuid,name,version,management_interfaces', nodes: '/api/cluster/nodes?fields=uuid,name,model,serial_number,system_id,state,version,uptime,ha,metrocluster', metrocluster: '/api/cluster/metrocluster', metro_nodes: '/api/cluster/metrocluster/nodes?fields=*', metro_connections: '/api/cluster/metrocluster/interconnects?fields=*', aggregates: '/api/storage/aggregates?fields=*', volumes: '/api/storage/volumes?fields=uuid,name,svm,state,type,style,aggregates,nas,space', luns: '/api/storage/luns?fields=*', svms: '/api/svm/svms?fields=uuid,name,state,subtype,ipspace', disks: '/api/storage/disks?fields=*', shelves: '/api/storage/shelves?fields=*', ethernet: '/api/network/ethernet/ports?fields=*', ip: '/api/network/ip/interfaces?fields=*', fc: '/api/network/fc/ports?fields=*', snapmirror: '/api/snapmirror/relationships?fields=uuid,source,destination,state,healthy,lag_time', lun_maps: '/api/protocols/san/lun-maps?fields=*' } as const;
export type OntapRead = ReadResult<Record<string, unknown>[]>;
export type OntapInventory = Record<keyof typeof ONTAP_ENDPOINTS, OntapRead>;
/** Node 22 reviver source preserves JSON integer tokens before IEEE754 rounding. */
export function parseOntapJson(raw: string): Record<string, unknown> {
    return object(JSON.parse(raw, (_key: string, value: unknown, context?: {
        source?: string;
    }) => {
        if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
            if (!context?.source || !/^-?\d+$/.test(context.source))
                throw Error('REST_INTEGER_PRECISION');
            return context.source;
        }
        return value;
    }));
}
export function ontapNextPath(href: string, base: string, initial: string): string {
    const next = new URL(href, base), root = new URL(initial, base);
    if (next.origin !== root.origin || next.pathname !== root.pathname || next.username || next.password || next.hash)
        throw Error('REST_NEXT_LINK_REJECTED');
    return next.pathname + next.search;
}
export async function acquireOntap(input: AcquisitionInput, request: typeof https.request = https.request): Promise<OntapInventory> {
    if (!input.api)
        throw Error('REST_CREDENTIAL_REQUIRED');
    const api = input.api, deadline = Date.now() + input.limits.total_timeout_ms, base = `https://${input.host.includes(':') ? '[' + input.host + ']' : input.host}:${api.port}`;
    const all = {} as OntapInventory;
    async function get(path: string): Promise<{
        status: number;
        body: Record<string, unknown>;
        bytes: number;
    }> {
        const timeout = Math.min(input.limits.timeout_ms, deadline - Date.now());
        if (timeout <= 0)
            throw Error('REST_TOTAL_TIMEOUT');
        return new Promise((resolve, reject) => {
            let done = false;
            const fail = (code: string) => {
                if (done)
                    return;
                done = true;
                clearTimeout(timer);
                req.destroy();
                reject(Error(code));
            };
            const req = request({ hostname: input.host, port: api.port, path, method: 'GET', agent: false, rejectUnauthorized: !api.tls_sha256, headers: { Accept: 'application/json' } }, res => {
                const chunks: Buffer[] = [];
                let bytes = 0;
                res.on('data', (c: Buffer) => {
                    bytes += c.length;
                    if (bytes > input.limits.max_output_bytes) {
                        fail('REST_BYTE_LIMIT');
                        return;
                    }
                    chunks.push(c);
                });
                res.on('aborted', () => fail('REST_RESPONSE_ABORTED'));
                res.on('error', () => fail('REST_RESPONSE_ERROR'));
                res.on('end', () => {
                    if (done)
                        return;
                    try {
                        const body = res.statusCode === 200 ? parseOntapJson(Buffer.concat(chunks).toString('utf8')) : {};
                        done = true;
                        clearTimeout(timer);
                        resolve({ status: res.statusCode ?? 0, body, bytes });
                    }
                    catch {
                        fail('REST_JSON_INVALID');
                    }
                });
            });
            const timer = setTimeout(() => fail('REST_TIMEOUT'), timeout);
            req.on('error', () => fail('REST_CONNECTION_FAILED'));
            req.on('socket', s => (s as TLSSocket).on('secureConnect', () => {
                if (api.tls_sha256 && (s as TLSSocket).getPeerCertificate().fingerprint256?.toUpperCase() !== api.tls_sha256.toUpperCase()) {
                    fail('REST_TLS_FINGERPRINT_MISMATCH');
                    return;
                }
                if (!done) {
                    req.setHeader('Authorization', 'Basic ' + Buffer.from(api.username + ':' + api.password).toString('base64'));
                    req.end();
                }
            }));
        });
    }
    let aborted = false;
    for (const [key, path] of Object.entries(ONTAP_ENDPOINTS) as [
        keyof OntapInventory,
        string
    ][]) {
        if (aborted) {
            all[key] = { status: 'error', data: [], warnings: ['REST_BATCH_ABORTED'] };
            continue;
        }
        const result: OntapRead = { status: 'ok', data: [], warnings: [] };
        all[key] = result;
        let next: string | null = path, bytes = 0, pages = 0;
        const visited = new Set<string>();
        try {
            while (next) {
                if (visited.has(next) || ++pages > 512)
                    throw Error('REST_PAGINATION_LOOP');
                visited.add(next);
                const response = await get(next);
                if (response.status !== 200) {
                    result.status = response.status === 404 ? 'unsupported' : 'error';
                    result.warnings.push('REST_HTTP_' + response.status);
                    if (response.status === 401)
                        aborted = true;
                    break;
                }
                bytes += response.bytes;
                if (bytes > input.limits.max_output_bytes) {
                    result.status = 'partial';
                    result.warnings.push('REST_BYTE_LIMIT');
                    break;
                }
                const body = response.body;
                if (body.error)
                    throw Error('REST_ERROR_OBJECT');
                if (key === 'cluster' && !/NetApp|ONTAP/i.test(text(object(body.version).full) ?? ''))
                    throw Error('REST_TARGET_NOT_ONTAP');
                if (Object.hasOwn(body, 'records')) {
                    if (!Array.isArray(body.records) || number(body.num_records) !== body.records.length)
                        throw Error('REST_RECORD_COUNT_MISMATCH');
                    result.data.push(...array(body.records).map(object));
                }
                else if (key === 'cluster' || key === 'metrocluster')
                    result.data.push(body);
                else
                    throw Error('REST_RECORDS_MISSING');
                const href = text(object(object(body._links).next).href);
                if (result.data.length > input.limits.max_rows) {
                    result.data = result.data.slice(0, input.limits.max_rows);
                    result.status = 'partial';
                    result.warnings.push('REST_ROW_LIMIT');
                    break;
                }
                next = href ? ontapNextPath(href, base, path) : null;
            }
        }
        catch (e) {
            const code = e instanceof Error && /^REST_[A-Z_]+$/.test(e.message) ? e.message : 'REST_READ_FAILED';
            result.status = result.data.length ? 'partial' : 'error';
            result.warnings.push(code);
            if (['REST_TIMEOUT', 'REST_TOTAL_TIMEOUT', 'REST_CONNECTION_FAILED', 'REST_TLS_FINGERPRINT_MISMATCH', 'REST_TARGET_NOT_ONTAP'].includes(code))
                aborted = true;
        }
        if (key === 'cluster' && result.status !== 'ok')
            aborted = true;
    }
    return all;
}
const number = (value: unknown) => { const v = text(value); return v !== null && /^\d+$/.test(v) ? Number(v) : null; };
