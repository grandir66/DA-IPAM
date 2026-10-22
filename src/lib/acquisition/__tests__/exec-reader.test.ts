import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Client, ClientChannel } from 'ssh2';
import { readExec } from '../exec-reader';
class Channel extends EventEmitter {
    stderr = new EventEmitter();
    closed = false;
    writes: string[] = [];
    close() { this.closed = true; }
    write(s: string) { this.writes.push(s); }
}
const limits = { timeout_ms: 40, total_timeout_ms: 1000, max_output_bytes: 4096, max_rows: 32 };
function run(channel: Channel, overrides = {}) { const conn = { exec: (_command: string, cb: (e: Error | null, c: ClientChannel) => void) => cb(null, channel as unknown as ClientChannel) } as unknown as Pick<Client, 'exec'>; return readExec(conn, 'display version', { ...limits, ...overrides }, Date.now() + 1000); }
test('exec: stato uscita esplicito, assente o nonzero; sempre chiusura', async () => { for (const [code, status] of [[0, 'ok'], [undefined, 'partial'], [1, 'error']] as const) {
    const c = new Channel(), r = run(c);
    c.emit('data', Buffer.from('output'));
    c.emit('close', code);
    assert.equal((await r).status, status);
    assert.equal(c.closed, true);
} });
test('exec: pager spezzato e comando non supportato', async () => { const c = new Channel(), r = run(c); c.emit('data', Buffer.from('--Mo')); c.emit('data', Buffer.from('re--')); assert.deepEqual(c.writes, [' ']); c.emit('data', Buffer.from('% Unrecognized command')); c.emit('close', 0); assert.equal((await r).status, 'unsupported'); });
test('exec: byte cap e timeout non attestano raccolta completa', async () => { const c = new Channel(), r = run(c, { max_output_bytes: 4 }); c.emit('data', Buffer.from('12345')); assert.equal((await r).status, 'partial'); assert.equal(c.closed, true); const d = new Channel(); assert.equal((await run(d)).warnings[0], 'SSH_EXEC_TIMEOUT'); assert.equal(d.closed, true); });
test('exec: callback tardiva chiude canale e scadenza totale già raggiunta', async () => { let callback: ((e: Error | null, c: ClientChannel) => void) | undefined; const conn = { exec: (_cmd: string, cb: typeof callback) => { callback = cb; } } as unknown as Pick<Client, 'exec'>; const r = readExec(conn, 'display version', limits, Date.now() + 10); assert.equal((await r).status, 'error'); const c = new Channel(); callback!(null, c as unknown as ClientChannel); assert.equal(c.closed, true); assert.deepEqual((await readExec(conn, 'display version', limits, Date.now() - 1)).warnings, ['TOTAL_TIMEOUT']); });
test('exec: uscita 127 di una shell Unix (comando assente) è «non supportato», non un errore', async () => { const c = new Channel(), r = run(c); c.emit('data', Buffer.from('sh: getsysinfo: not found')); c.emit('close', 127); const v = await r; assert.equal(v.status, 'unsupported'); assert.deepEqual(v.warnings, ['COMMAND_UNSUPPORTED']); });
