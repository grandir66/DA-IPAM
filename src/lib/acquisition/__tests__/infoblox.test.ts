import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type https from 'node:https';
import { highestWapiVersion, parseInfobloxRecords } from '../infoblox-schema';
import { acquisitionInputSchema } from '../schema';
import { acquireInfoblox, createInfobloxGetter } from '../infoblox-transport';
import type { InfobloxGetter } from '../infoblox-transport';
const input = () => acquisitionInputSchema.parse({ collector: 'infoblox-nios', host: '192.0.2.1', api: { username: 'manager', password: 'SECRET', tls_sha256: Array(32).fill('AB').join(':') } });
const response = (body: unknown, status = 200) => ({ body, status, bytes: 100 });
function mocked(read: (path: string) => ReturnType<typeof response>) {
    const calls: string[] = [];
    const get: InfobloxGetter = async path => { calls.push(path); if (path === '/wapi/v1.0/?_schema') return response({ supported_versions: ['2.9', '2.12.3'] }); if (path === '/wapi/v2.12.3/?_schema') return response({ supported_objects: ['network'] }); return read(path); };
    return { calls, get };
}
const schema = response({ fields: ['network', 'network_view', 'comment', 'disable', 'options'].map(name => ({ name, supports: 'r' })) });
test('Infoblox: versioni numeriche e niente percorsi iniettati', () => {
    assert.equal(highestWapiVersion(['2.9', '2.12.3', '2.10', '../secret', 'garbage']), '2.12.3'); assert.equal(highestWapiVersion([]), null);
});
test('Infoblox: dati di viste diverse restano distinti; segreti e proprietà sconosciute scartati', () => {
    const rows = ['default', 'isolata'].map(v => ({ _ref: `network/LAB/${v}`, network: '192.0.2.0/24', network_view: v, secret: 'NON-ESPORTARE', options: [{ name: 'routers', num: 3, value: '192.0.2.1', password: 'NON-ESPORTARE' }] }));
    const parsed = parseInfobloxRecords(rows, ['network', 'network_view', 'options', 'secret']);
    assert.equal(parsed.records.length, 2); assert.notEqual(parsed.records[0].network_view, parsed.records[1].network_view); assert.equal(JSON.stringify(parsed).includes('NON-ESPORTARE'), false);
    assert.equal(parseInfobloxRecords([null, {}, { _ref: 'x', ttl: 'wrong' }], ['ttl']).invalid, 3);
});
test('Infoblox: record host IPv4/IPv6 con MAC e flag, senza appiattire gli indirizzi', () => {
    const p = parseInfobloxRecords([{ _ref: 'record:host/LAB', name: 'lab.example', view: 'default', ipv4addrs: [{ ipv4addr: '192.0.2.4', mac: '02:00:00:00:00:01', configure_for_dhcp: true }], ipv6addrs: [{ ipv6addr: '2001:db8::4' }] }], ['name', 'view', 'ipv4addrs', 'ipv6addrs']);
    assert.equal(p.records[0].ipv4addrs?.[0].configure_for_dhcp, true); assert.equal(p.records[0].ipv6addrs?.[0].ipv6addr, '2001:db8::4');
});
test('Infoblox: tutte le pagine, token opaco codificato e vuoto osservato valido', async () => {
    const m = mocked(p => p.endsWith('?_schema') ? schema : p.includes('_page_id=') ? response({ result: [{ _ref: 'network/B', network: '198.51.100.0/24', network_view: 'seconda' }] }) : response({ result: [{ _ref: 'network/A', network: '192.0.2.0/24', network_view: 'prima' }], next_page_id: 'id&evil=1' }));
    const raw = await acquireInfoblox(input(), m.get); const t = raw.tables.find(t => t.object === 'network')!;
    assert.equal(raw.wapi_version, '2.12.3'); assert.equal(t.status, 'ok'); assert.equal(t.records.length, 2); assert.ok(m.calls.some(p => p.endsWith('_page_id=id%26evil%3D1')));
    const empty = mocked(p => p.endsWith('?_schema') ? schema : response({ result: [] }));
    assert.equal((await acquireInfoblox(input(), empty.get)).tables.find(t => t.object === 'network')?.status, 'ok');
});
test('Infoblox: pagina ripetuta, malformed JSON envelope e limiti mai ok silenziosi', async () => {
    for (const body of [{ result: [], next_page_id: 'same' }, { result: 'wrong' }]) {
        const m = mocked(p => p.endsWith('?_schema') ? schema : response(body));
        assert.notEqual((await acquireInfoblox(input(), m.get)).tables.find(t => t.object === 'network')?.status, 'ok');
    }
    const m = mocked(p => p.endsWith('?_schema') ? schema : response({ result: Array.from({ length: 33 }, (_, i) => ({ _ref: 'network/' + i })), next_page_id: 'more' }));
    const raw = await acquireInfoblox({ ...input(), limits: { ...input().limits, max_rows: 32 } }, m.get);
    assert.equal(raw.tables.find(t => t.object === 'network')?.records.length, 32); assert.ok(raw.tables.find(t => t.object === 'network')?.warnings.includes('INFOBLOX_ROW_LIMIT'));
});
test('Infoblox: 401 ferma il lotto, 403 resta errore e campi non leggibili espliciti', async () => {
    let calls = 0;
    const denied: InfobloxGetter = async () => { calls++; return response(null, 401); };
    const raw = await acquireInfoblox(input(), denied); assert.equal(calls, 1); assert.ok(raw.tables.every(t => t.status === 'error'));
    const forbidden = mocked(() => response(null, 403));
    assert.equal((await acquireInfoblox(input(), forbidden.get)).tables.find(t => t.object === 'network')?.status, 'error');
    const missing = mocked(p => p.endsWith('?_schema') ? response({ fields: [{ name: 'network', supports: 'r' }] }) : response({ result: [] }));
    assert.equal((await acquireInfoblox(input(), missing.get)).tables.find(t => t.object === 'network')?.status, 'partial');
});
test('Infoblox: pin errato prima di inviare credenziali; solo GET senza redirect', async () => {
    let authorized = false, sent = false;
    const req = new EventEmitter() as EventEmitter & { destroy(): void; setHeader(): void; end(): void };
    req.destroy = () => {}; req.setHeader = () => { authorized = true; }; req.end = () => { sent = true; };
    const socket = new EventEmitter() as EventEmitter & { getPeerCertificate(): object };
    socket.getPeerCertificate = () => ({ fingerprint256: Array(32).fill('CD').join(':') });
    const fake = ((options: { method: string }) => { assert.equal(options.method, 'GET'); queueMicrotask(() => { req.emit('socket', socket); socket.emit('secureConnect'); }); return req; }) as unknown as typeof https.request;
    await assert.rejects(createInfobloxGetter(input(), fake)('/wapi/v1.0/?_schema'), /INFOBLOX_TLS_REJECTED/);
    assert.equal(authorized, false); assert.equal(sent, false);
});

test('Infoblox: i lease sono l’ultima tabella, così non antepongono la lettura più pesante a DNS', async () => {
    const { INFOBLOX_OBJECTS } = await import('../infoblox-schema');
    assert.equal(Object.keys(INFOBLOX_OBJECTS).at(-1), 'lease');
});
