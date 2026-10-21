import https from 'node:https';
import { StringDecoder } from 'node:string_decoder';
import type { TLSSocket } from 'node:tls';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { AcquisitionInput } from './schema';
export type XmlObject = Record<string, unknown>;
export const object = (v: unknown): XmlObject => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as XmlObject : {};
export const array = (v: unknown): unknown[] => v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
export function text(v: unknown): string | null {
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    const t = object(v)['#text'];
    return typeof t === 'string' ? t : null;
}
export function escapeXml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
export function parseSoap(raw: string, method: string): XmlObject {
    if (/<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true)
        throw Error('API_XML_INVALID');
    const x: unknown = new XMLParser({ ignoreAttributes: false, transformTagName: (name: string) => name.split(':').at(-1)!, parseTagValue: false, parseAttributeValue: false }).parse(raw);
    const body = object(object(object(x).Envelope).Body);
    if (body.Fault)
        throw Error('API_SOAP_FAULT');
    const response = object(body[method + 'Response']);
    if (!Object.hasOwn(body, method + 'Response'))
        throw Error('API_RESPONSE_MISSING');
    return response;
}
export interface PropertyObject {
    ref: string;
    type: string;
    props: Record<string, unknown>;
    missing: string[];
}
export interface VsphereInventory {
    about: XmlObject;
    host: PropertyObject;
    vms: PropertyObject[];
    datastores: PropertyObject[];
    warnings: string[];
}
export const HOST_PROPERTIES = ['name', 'summary', 'hardware', 'runtime', 'config.network', 'config.storageDevice.scsiLun', 'config.storageDevice.multipathInfo', 'vm', 'datastore'] as const;
export const VM_PROPERTIES = ['name', 'summary', 'config.uuid', 'config.instanceUuid', 'config.hardware.numCPU', 'config.hardware.memoryMB', 'config.hardware.device', 'config.template', 'guest.net', 'guest.hostName', 'guest.toolsStatus', 'guest.toolsRunningStatus', 'runtime', 'datastore', 'network', 'snapshot.rootSnapshotList'] as const;
export const DATASTORE_PROPERTIES = ['name', 'summary', 'info'] as const;
const methods = new Set(['RetrieveServiceContent', 'Login', 'Logout', 'FindByIp', 'RetrievePropertiesEx', 'ContinueRetrievePropertiesEx', 'CancelRetrievePropertiesEx']);
export function parsePropertyObjects(result: XmlObject): PropertyObject[] { return array(result.objects).map(o => { const r = object(o), ref = object(r.obj); return { ref: text(r.obj) ?? '', type: text(ref['@_type']) ?? '', props: Object.fromEntries(array(r.propSet).map(p => { const v = object(p); return [text(v.name) ?? '', v.val]; })), missing: array(r.missingSet).map(m => text(object(m).path) ?? 'UNKNOWN_PROPERTY') }; }); }
export async function acquireVsphere(input: AcquisitionInput, request: typeof https.request = https.request): Promise<VsphereInventory> {
    if (!input.api)
        throw Error('API_CREDENTIAL_REQUIRED');
    const api = input.api, deadline = Date.now() + input.limits.total_timeout_ms;
    let cookie = '', manager = '', collector = '', token: string | null = null, logged = false;
    async function call(method: string, content: string, cleanup = false): Promise<XmlObject> {
        if (!methods.has(method))
            throw Error('API_METHOD_FORBIDDEN');
        const timeout = cleanup ? 3000 : Math.min(input.limits.timeout_ms, deadline - Date.now());
        if (timeout <= 0)
            throw Error('API_TOTAL_TIMEOUT');
        const payload = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><${method} xmlns="urn:vim25">${content}</${method}></soapenv:Body></soapenv:Envelope>`;
        return new Promise((resolve, reject) => {
            let finished = false;
            const fail = (code: string) => {
                if (finished)
                    return;
                finished = true;
                clearTimeout(timer);
                req.destroy();
                reject(Error(code));
            };
            const req = request({ hostname: input.host, port: api.port, path: '/sdk', method: 'POST', agent: false, rejectUnauthorized: !api.tls_sha256, headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"urn:vim25/6.0"', ...(cookie ? { Cookie: cookie } : {}) } }, res => {
                let out = '', bytes = 0;
                const decoder = new StringDecoder('utf8');
                res.on('data', (chunk: Buffer) => {
                    bytes += chunk.length;
                    if (bytes > input.limits.max_output_bytes) {
                        fail('API_OUTPUT_LIMIT');
                        return;
                    }
                    out += decoder.write(chunk);
                });
                res.on('aborted', () => fail('API_RESPONSE_ABORTED'));
                res.on('error', () => fail('API_RESPONSE_ERROR'));
                res.on('end', () => {
                    if (finished)
                        return;
                    try {
                        out += decoder.end();
                        const result = parseSoap(out, method);
                        if (res.statusCode !== 200)
                            throw Error('API_HTTP_STATUS');
                        const session = res.headers['set-cookie']?.find(c => c.startsWith('vmware_soap_session='));
                        if (session)
                            cookie = session.split(';')[0];
                        finished = true;
                        clearTimeout(timer);
                        resolve(result);
                    }
                    catch (e) {
                        fail(e instanceof Error && /^API_[A-Z_]+$/.test(e.message) ? e.message : 'API_RESPONSE_INVALID');
                    }
                });
            });
            const timer = setTimeout(() => fail('API_TIMEOUT'), timeout);
            req.on('error', () => fail('API_CONNECTION_FAILED'));
            req.on('socket', socket => {
                const tls = socket as TLSSocket;
                tls.on('secureConnect', () => {
                    if (api.tls_sha256 && tls.getPeerCertificate().fingerprint256?.toUpperCase() !== api.tls_sha256.toUpperCase()) {
                        fail('API_TLS_FINGERPRINT_MISMATCH');
                        return;
                    }
                    if (!finished)
                        req.end(payload);
                });
            });
        });
    }
    const ref = (type: string, id: string) => `<_this type="${type}">${escapeXml(id)}</_this>`;
    const warnings: string[] = [];
    async function retrieve(type: string, ids: string[], paths: readonly string[]): Promise<PropertyObject[]> {
        if (!ids.length)
            return [];
        if (ids.length > input.limits.max_rows) {
            warnings.push('API_OBJECT_LIMIT');
            ids = ids.slice(0, input.limits.max_rows);
        }
        const result: PropertyObject[] = [];
        // Batches bound request size as well as response pages. Never traverse another host.
        for (let i = 0; i < ids.length; i += 100) {
            const spec = `<specSet><propSet><type>${type}</type><all>false</all>${paths.map(p => `<pathSet>${escapeXml(p)}</pathSet>`).join('')}</propSet>${ids.slice(i, i + 100).map(id => `<objectSet><obj type="${type}">${escapeXml(id)}</obj><skip>false</skip></objectSet>`).join('')}</specSet><options><maxObjects>100</maxObjects></options>`;
            let page = object((await call('RetrievePropertiesEx', ref('PropertyCollector', collector) + spec)).returnval);
            let pages = 0;
            while (true) {
                const rows = parsePropertyObjects(page);
                if (rows.some(r => r.type !== type || !ids.includes(r.ref)))
                    throw Error('API_OBJECT_RESPONSE_MISMATCH');
                for (const row of rows) {
                    row.missing = row.missing.map(path => paths.includes(path) ? path : 'UNKNOWN_PROPERTY');
                    if (result.some(existing => existing.ref === row.ref))
                        throw Error('API_DUPLICATE_OBJECT');
                }
                result.push(...rows);
                token = text(page.token);
                if (result.length > input.limits.max_rows) {
                    warnings.push('API_OBJECT_LIMIT');
                    if (token) {
                        const cancel = token;
                        token = null;
                        try {
                            await call('CancelRetrievePropertiesEx', ref('PropertyCollector', collector) + `<token>${escapeXml(cancel)}</token>`, true);
                        }
                        catch {
                            warnings.push('API_CANCEL_FAILED');
                        }
                    }
                    return result.slice(0, input.limits.max_rows);
                }
                if (!token)
                    break;
                if (++pages > 512)
                    throw Error('API_PAGE_LIMIT');
                const next = token;
                token = null;
                page = object((await call('ContinueRetrievePropertiesEx', ref('PropertyCollector', collector) + `<token>${escapeXml(next)}</token>`)).returnval);
            }
        }
        if (new Set(result.map(r => r.ref)).size !== ids.length)
            warnings.push('API_REFERENCED_OBJECTS_NOT_RETURNED:' + type);
        return result;
    }
    try {
        const service = object((await call('RetrieveServiceContent', ref('ServiceInstance', 'ServiceInstance'))).returnval);
        const about = object(service.about);
        if (text(about.apiType) !== 'HostAgent')
            throw Error('API_TARGET_NOT_ESXI');
        manager = text(service.sessionManager) ?? '';
        collector = text(service.propertyCollector) ?? '';
        if (!manager || !collector)
            throw Error('API_SERVICE_REFERENCE_MISSING');
        await call('Login', ref('SessionManager', manager) + `<userName>${escapeXml(api.username)}</userName><password>${escapeXml(api.password)}</password>`);
        logged = true;
        if (!cookie)
            throw Error('API_SESSION_COOKIE_MISSING');
        const hostRef = text((await call('FindByIp', ref('SearchIndex', text(service.searchIndex) ?? '') + `<ip>${escapeXml(input.host)}</ip><vmSearch>false</vmSearch>`)).returnval);
        if (!hostRef)
            throw Error('API_HOST_NOT_FOUND');
        const hosts = await retrieve('HostSystem', [hostRef], HOST_PROPERTIES);
        if (hosts.length !== 1 || hosts[0].ref !== hostRef || hosts[0].type !== 'HostSystem')
            throw Error('API_HOST_RESPONSE_MISMATCH');
        const host = hosts[0];
        const refs = (key: string, type: string) => array(object(host.props[key]).ManagedObjectReference).filter(v => text(object(v)['@_type']) === type).map(v => text(v)!).filter(Boolean);
        const vms = await retrieve('VirtualMachine', refs('vm', 'VirtualMachine'), VM_PROPERTIES), datastores = await retrieve('Datastore', refs('datastore', 'Datastore'), DATASTORE_PROPERTIES);
        return { about, host, vms, datastores, warnings };
    }
    finally {
        if (token && collector)
            try {
                await call('CancelRetrievePropertiesEx', ref('PropertyCollector', collector) + `<token>${escapeXml(token)}</token>`, true);
            }
            catch {
                warnings.push('API_CANCEL_FAILED');
            }
        if (logged)
            try {
                await call('Logout', ref('SessionManager', manager), true);
            }
            catch {
                warnings.push('API_LOGOUT_FAILED');
            }
        cookie = '';
    }
}
