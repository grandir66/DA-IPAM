import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { AcquisitionInput } from './schema';
import { INFOBLOX_OBJECTS, highestWapiVersion, parseInfobloxRecords } from './infoblox-schema';
import type { InfobloxDdi, InfobloxObject } from './infoblox-schema';
export interface InfobloxResponse { status: number; body: unknown; bytes: number }
export type InfobloxGetter = (path: string) => Promise<InfobloxResponse>;
const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const code = (e: unknown) => e instanceof Error && /^INFOBLOX_[A-Z_]+$/.test(e.message) ? e.message : 'INFOBLOX_TRANSPORT_FAILED';
/** Il socket deve verificare la CA o il pin prima che Authorization venga impostato e la richiesta inviata. */
export function createInfobloxGetter(input: AcquisitionInput, request: typeof https.request = https.request): InfobloxGetter {
    const api = input.api; if (!api) throw Error('INFOBLOX_API_REQUIRED');
    const deadline = Date.now() + input.limits.total_timeout_ms;
    return path => new Promise((resolve, reject) => {
        let done = false;
        const timeout = Math.min(input.limits.timeout_ms, deadline - Date.now());
        if (timeout <= 0) { reject(Error('INFOBLOX_TOTAL_TIMEOUT')); return; }
        const finishError = (reason: string) => { if (done) return; done = true; clearTimeout(timer); req.destroy(); reject(Error(reason)); };
        const req = request({ hostname: input.host, port: api.port, path, method: 'GET', agent: false, rejectUnauthorized: !api.tls_sha256, headers: { Accept: 'application/json' } }, res => {
            const chunks: Buffer[] = []; let bytes = 0;
            res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > input.limits.max_output_bytes) { finishError('INFOBLOX_BYTE_LIMIT'); return; } chunks.push(chunk); });
            res.on('aborted', () => finishError('INFOBLOX_RESPONSE_ABORTED'));
            res.on('error', () => finishError('INFOBLOX_RESPONSE_ERROR'));
            res.on('end', () => {
                if (done) return;
                let body: unknown = null;
                if (res.statusCode === 200) { try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { finishError('INFOBLOX_JSON_INVALID'); return; } }
                done = true; clearTimeout(timer); resolve({ status: res.statusCode ?? 0, body, bytes });
            });
        });
        const timer = setTimeout(() => finishError('INFOBLOX_TIMEOUT'), timeout);
        req.on('error', () => finishError('INFOBLOX_CONNECTION_FAILED'));
        req.on('socket', s => (s as TLSSocket).on('secureConnect', () => {
            if (done) return;
            const tls = s as TLSSocket;
            if (api.tls_sha256 ? tls.getPeerCertificate().fingerprint256?.toUpperCase() !== api.tls_sha256.toUpperCase() : !tls.authorized) { finishError('INFOBLOX_TLS_REJECTED'); return; }
            req.setHeader('Authorization', 'Basic ' + Buffer.from(api.username + ':' + api.password).toString('base64')); req.end();
        }));
    });
}
export async function acquireInfoblox(input: AcquisitionInput, get: InfobloxGetter = createInfobloxGetter(input)): Promise<InfobloxDdi> {
    const result: InfobloxDdi = { scope: 'grid-visible-to-account', wapi_version: null, tables: [] };
    let spent = 0, halted: string | null = null;
    const deadline = Date.now() + input.limits.total_timeout_ms;
    async function read(path: string): Promise<InfobloxResponse> {
        if (Date.now() >= deadline) throw Error('INFOBLOX_TOTAL_TIMEOUT');
        if (spent >= input.limits.max_output_bytes) throw Error('INFOBLOX_TOTAL_BYTE_LIMIT');
        const r = await get(path); spent += r.bytes;
        if (spent > input.limits.max_output_bytes) throw Error('INFOBLOX_TOTAL_BYTE_LIMIT');
        if (r.status === 401) { halted = 'INFOBLOX_AUTH_REJECTED'; throw Error(halted); }
        return r;
    }
    let supported: string[] = [];
    try {
        const bootstrap = await read('/wapi/v1.0/?_schema');
        if (bootstrap.status !== 200) throw Error('INFOBLOX_SCHEMA_UNAVAILABLE');
        const version = highestWapiVersion(obj(bootstrap.body)?.supported_versions);
        if (!version) throw Error('INFOBLOX_SCHEMA_INVALID');
        const schema = await read(`/wapi/v${version}/?_schema`), body = obj(schema.body);
        if (schema.status !== 200 || !Array.isArray(body?.supported_objects) || !body.supported_objects.every(v => typeof v === 'string')) throw Error('INFOBLOX_SCHEMA_INVALID');
        result.wapi_version = version; supported = body.supported_objects as string[];
    } catch (e) { halted = code(e); }
    for (const [name, desired] of Object.entries(INFOBLOX_OBJECTS) as [InfobloxObject, readonly string[]][]) {
        const table: InfobloxDdi['tables'][number] = { object: name, status: 'skipped', sources: [`api:WAPI:${name}`], warnings: [], fields_requested: [], records: [] }; result.tables.push(table);
        if (halted) { table.status = 'error'; table.warnings.push(halted); continue; }
        if (!supported.includes(name)) { table.status = 'unsupported'; table.warnings.push('INFOBLOX_OBJECT_UNSUPPORTED'); continue; }
        try {
            const path = `/wapi/v${result.wapi_version}/${name}`;
            const schema = await read(path + '?_schema'), fields = obj(schema.body)?.fields;
            if (schema.status === 403) { table.status = 'error'; table.warnings.push('INFOBLOX_PERMISSION_DENIED'); continue; }
            if (schema.status !== 200 || !Array.isArray(fields)) throw Error('INFOBLOX_OBJECT_SCHEMA_INVALID');
            const readable = fields.flatMap(v => { const f = obj(v); return typeof f?.name === 'string' && typeof f.supports === 'string' && f.supports.includes('r') ? [f.name] : []; });
            table.fields_requested = desired.filter(f => readable.includes(f));
            const missing = desired.filter(f => !readable.includes(f));
            if (missing.length) table.warnings.push('INFOBLOX_FIELDS_UNAVAILABLE');
            if (!table.fields_requested.length) throw Error('INFOBLOX_NO_READABLE_FIELDS');
            table.status = missing.length ? 'partial' : 'ok';
            const seen = new Set<string>(); let page: string | null = null, count = 0;
            do {
                const params = page === null ? new URLSearchParams({ _paging: '1', _return_as_object: '1', _max_results: String(Math.min(250, input.limits.max_rows)), _return_fields: table.fields_requested.join(',') }) : new URLSearchParams({ _page_id: page });
                const response = await read(path + '?' + params);
                if (response.status === 403) throw Error('INFOBLOX_PERMISSION_DENIED');
                if (response.status !== 200) throw Error('INFOBLOX_HTTP_FAILED');
                const body = obj(response.body);
                if (!body || !Array.isArray(body.result)) throw Error('INFOBLOX_PAGE_INVALID');
                const remaining = input.limits.max_rows - count;
                const parsed = parseInfobloxRecords(body.result.slice(0, remaining), table.fields_requested);
                table.records.push(...parsed.records); count += Math.min(body.result.length, remaining);
                if (parsed.invalid) { table.status = 'partial'; table.warnings.push('INFOBLOX_INVALID_RECORDS'); }
                const next = body.next_page_id;
                if (next !== undefined && (typeof next !== 'string' || !next.length || next.length > 4096)) throw Error('INFOBLOX_PAGE_INVALID');
                if (body.result.length > remaining || count >= input.limits.max_rows && next) { table.status = 'partial'; table.warnings.push('INFOBLOX_ROW_LIMIT'); break; }
                page = typeof next === 'string' ? next : null;
                if (page !== null) { if (seen.has(page)) throw Error('INFOBLOX_PAGING_LOOP'); seen.add(page); }
                if (seen.size >= 1000) throw Error('INFOBLOX_PAGE_LIMIT');
            } while (page !== null);
        } catch (e) {
            const why = code(e); table.status = table.records.length ? 'partial' : 'error'; table.warnings.push(why);
            if (/AUTH_REJECTED|TOTAL_|TLS_|CONNECTION_FAILED/.test(why)) halted = why;
        }
        table.warnings = [...new Set(table.warnings)];
    }
    return result;
}
