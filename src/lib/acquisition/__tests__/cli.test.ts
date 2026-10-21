import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { avviaAgenteFinto } from '../../protocols/__tests__/support/agente-snmp-finto';
function cli(args: string[]) { return new Promise<{
    code: number | null;
    out: string;
    err: string;
}>((resolveResult, reject) => { const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/acquire-device.ts', ...args], { cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'), timeout: 12000 }); let out = '', err = ''; p.stdout.on('data', b => out += b); p.stderr.on('data', b => err += b); p.on('error', reject); p.on('close', code => resolveResult({ code, out, err })); }); }
test('CLI eseguibile senza Next/DB, espone schema e registry', async () => {
    for (const flag of ['--schema', '--list']) {
        const r = await cli([flag]);
        assert.equal(r.code, 0, r.err);
        assert.doesNotThrow(() => JSON.parse(r.out));
        assert.equal(r.err, '');
    }
});
test('CLI rifiuta file leggibile da altri senza stampare valori', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'collector-cli-'));
    try {
        const file = join(dir, 'input.json');
        await writeFile(file, JSON.stringify({ host: '192.0.2.1', snmp: { community: 'TEST-PRIVATE' } }));
        await chmod(file, 0o644);
        const r = await cli(['--credentials-file', file]);
        assert.equal(r.code, 64);
        assert.equal(r.out, '');
        assert.equal(r.err.includes('TEST-PRIVATE'), false);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('CLI interroga davvero SNMP locale e distingue acquisizione parziale', async () => {
    const agent = await avviaAgenteFinto({ versioni: ['2c'], valori: { '1.3.6.1.2.1.1.1.0': 'SNMPV2', '1.3.6.1.2.1.1.2.0': '1.3.6.1.4.1.55062.31', '1.3.6.1.2.1.1.3.0': '100', '1.3.6.1.2.1.1.5.0': 'lab' } });
    const dir = await mkdtemp(join(tmpdir(), 'collector-cli-'));
    try {
        const file = join(dir, 'input.json');
        await writeFile(file, JSON.stringify({ host: '127.0.0.1', snmp: { community: 'TEST-PRIVATE', port: agent.porta }, limits: { timeout_ms: 500 } }), { mode: 0o600 });
        const r = await cli(['--credentials-file', file]);
        assert.equal(r.code, 2, r.err);
        const s = JSON.parse(r.out);
        assert.equal(s.status, 'partial');
        assert.equal(s.identity.data.model, null);
        assert.equal(r.out.includes('TEST-PRIVATE'), false);
        assert.equal(agent.richieste.some(r => r.tipo === 'get'), true);
    }
    finally {
        await agent.chiudi();
        await rm(dir, { recursive: true, force: true });
    }
});
