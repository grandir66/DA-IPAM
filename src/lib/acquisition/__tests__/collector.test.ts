import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientChannel } from "ssh2";
import { collectDevice, acquisitionInputSchema, snapshotSchema } from "../index";
import { acquireForIpam } from "../adapter";
import { readConsole, assertCommands } from "../transports";
import type { AcquisitionTransports, ReadResult } from "../schema";
const ok = <T>(data: T): ReadResult<T> => ({ status: 'ok', data, warnings: [] });
const system = 'Model name : QSW-M3216R-8S8T\nSwitch firmware : 4.5.0.847494 (20260908)\nSerial number : LAB0001\nSwitch name : lab-switch\nTemperature : 42\nFan 1 speed : 4200';
function io(): AcquisitionTransports { return { get: async () => ok([]), walk: async () => ok([]), shell: async (cmds) => Object.fromEntries(cmds.map(c => [c, ok(c === 'show system-information' ? system : c === 'show interfaces status' ? 'Ex0/7 connected Full 2.5 Gbps Auto' : c === 'show vlan' ? 'Vlan ID : 40\nMember Ports : Ex0/7\nUntagged Ports : None\nName : LAB' : c === 'show spanning-tree ports-summary' ? 'Spanning Tree Global Status : Disabled\nSpanning tree enabled protocol is RSTP\nEx0/7 Disabled Discarding Disabled' : c === 'show etherchannel summary' ? '1 Po1(D)[AU,OD] Disabled' : c === 'show lldp neighbors' ? 'Total Entries Displayed : 0' : c === 'show mac-address-table' ? 'Total Mac Addresses displayed: 0' : c === 'show system temperature' ? 'CPU Temperature : 48 C' : '')])) }; }
const request = { host: '192.0.2.1', ssh: { username: 'lab', password: 'TEST-SECRET-NEVER-PRINT' } };
test('schema input rifiuta zero credenziali, opzioni sconosciute e shell injection', () => {
    assert.equal(acquisitionInputSchema.safeParse({ host: '192.0.2.1' }).success, false);
    assert.equal(acquisitionInputSchema.safeParse({ ...request, host: 'host;reboot' }).success, false);
    assert.throws(() => assertCommands(['configure terminal']));
    assert.throws(() => assertCommands(['show system-information; reboot']));
});
test('adapter senza DB e snapshot validato; STP disabilitato non equivale a cavo bloccato', async () => {
    const r = await acquireForIpam(request, io());
    assert.equal(r.snapshot.status, 'ok');
    assert.equal(r.snapshot.spanning_tree.data.enabled, false);
    assert.equal(r.snapshot.spanning_tree.data.ports[0].state, 'discarding');
    assert.equal(r.deviceInfo?.firmware, '4.5.0.847494 (20260908)');
    assert.equal(r.snapshot.poe.status, 'skipped');
    assert.equal(JSON.stringify(r).includes(request.ssh.password), false);
    assert.equal(snapshotSchema.safeParse(r.snapshot).success, true);
});
test('target diverso: nessuna seconda shell o walk, niente falsi dati QNAP', async () => {
    let calls = 0;
    const t = io();
    t.shell = async (cmds) => { calls++; return Object.fromEntries(cmds.map(c => [c, ok('Model name : OTHER-SWITCH')])); };
    t.walk = async () => { assert.fail('walk non consentito prima di identificare'); };
    const r = await collectDevice(request, t);
    assert.equal(r.status, 'error');
    assert.equal(r.identity.data, null);
    assert.equal(calls, 1);
});
test('trasporto che lancia un errore con segreti: esito esplicito senza eccezione raw', async () => {
    const t = io();
    t.shell = async () => { throw Error(request.ssh.password); };
    const r = await collectDevice(request, t);
    assert.equal(r.status, 'error');
    assert.equal(JSON.stringify(r).includes(request.ssh.password), false);
});
test('fallimento interfacce non diventa elenco vuoto completo', async () => {
    const t = io(), shell = t.shell;
    t.shell = async (cmds) => { const r = await shell(cmds); if (r['show interfaces status'])
        r['show interfaces status'] = { status: 'error', data: '', warnings: ['SSH_TIMEOUT'] }; return r; };
    const r = await collectDevice(request, t);
    assert.equal(r.status, 'partial');
    assert.notEqual(r.interfaces.status, 'ok');
});
class Channel extends EventEmitter {
    writes: string[] = [];
    ended = false;
    write(s: string) { this.writes.push(s); return true; }
    end() { this.ended = true; return this; }
}
const limits = { timeout_ms: 50, max_rows: 100, max_output_bytes: 10000, total_timeout_ms: 5000 };
function read(c: Channel, commands: string[], overrides = {}) { return readConsole(c as unknown as Pick<ClientChannel, 'on' | 'write' | 'end'>, commands, { ...limits, ...overrides }, Date.now() + 2000); }
test('console: paginazione spezzata tra chunk e prompt finale necessario', async () => {
    const c = new Channel(), promise = read(c, ['show vlan']);
    c.emit('data', Buffer.from('\nqss# '));
    assert.deepEqual(c.writes, ['show vlan\n']);
    c.emit('data', Buffer.from('show vlan\nVlan ID : 1\n--Mo'));
    c.emit('data', Buffer.from('re--'));
    assert.equal(c.writes.at(-1), ' ');
    c.emit('data', Buffer.from('\nUntagged Ports : Ex0/1\nqss# '));
    const r = await promise;
    assert.equal(r['show vlan'].status, 'ok');
    assert.equal(c.ended, true);
});
test('console: timeout e chiusura a metà output non sono successo', async () => {
    for (const closed of [false, true]) {
        const c = new Channel(), p = read(c, ['show vlan']);
        c.emit('data', Buffer.from('qss# '));
        c.emit('data', Buffer.from('Vlan ID : 40'));
        if (closed)
            c.emit('close');
        const r = await p;
        assert.equal(r['show vlan'].status, 'error');
        assert.equal(c.ended, true);
    }
});
test('console: rifiuto comando distinto da errore trasporto; output limitato', async () => {
    const c = new Channel(), p = read(c, ['show vlan']);
    c.emit('data', Buffer.from('qss# '));
    c.emit('data', Buffer.from("% Invalid input detected at '^' marker\nqss# "));
    assert.equal((await p)['show vlan'].status, 'unsupported');
    const c2 = new Channel(), p2 = read(c2, ['show vlan'], { max_output_bytes: 10 });
    c2.emit('data', Buffer.from('qss# '));
    c2.emit('data', Buffer.from('01234567890'));
    assert.equal((await p2)['show vlan'].status, 'error');
});
test('console: output lungo avanza oltre timeout iniziale, ma il termine totale resta vincolante', async () => {
    const c = new Channel(), p = read(c, ['show interfaces'], { timeout_ms: 60 });
    c.emit('data', Buffer.from('qss# '));
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 30));
        c.emit('data', Buffer.from('riga di output\n'));
    }
    c.emit('data', Buffer.from('qss# '));
    assert.equal((await p)['show interfaces'].status, 'ok');
    const c2 = new Channel(), p2 = readConsole(c2 as unknown as Pick<ClientChannel, 'on' | 'write' | 'end'>, ['show interfaces'], { ...limits, timeout_ms: 500 }, Date.now() + 60);
    c2.emit('data', Buffer.from('qss# '));
    const id = setInterval(() => c2.emit('data', Buffer.from('dato\n')), 10);
    const result = await p2;
    clearInterval(id);
    assert.equal(result['show interfaces'].status, 'error');
});
test('se lo switch riecheggia un segreto nel nome, il JSON lo oscura', async () => {
    const t = io(), f = t.shell;
    t.shell = async (cmds) => { const r = await f(cmds); if (r['show system-information'])
        r['show system-information'].data = system.replace('lab-switch', request.ssh.password); return r; };
    const s = await collectDevice(request, t);
    assert.equal(s.identity.data?.hostname, '[REDACTED]');
    assert.equal(JSON.stringify(s).includes(request.ssh.password), false);
});

test('un errore nella sezione IP rende parziale anche una raccolta SSH altrimenti completa',async()=>{
 const t=io();t.walk=async()=>({status:'error',data:[],warnings:['SNMP_READ_FAILED']});const s=await collectDevice({...request,snmp:{community:'TEST-COMMUNITY'}},t);assert.equal(s.network.status,'error');assert.equal(s.status,'partial');
});

test('solo SSH non attribuisce dati a fonti SNMP mai interrogate',async()=>{
 const s=await collectDevice(request,io());assert.equal(s.network.status,'skipped');assert.equal(s.network.sources.length,0);assert.equal(s.interfaces.sources.some(x=>x.startsWith('snmp:')),false);
});
