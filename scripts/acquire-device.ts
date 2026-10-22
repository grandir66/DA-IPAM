#!/usr/bin/env node
/** CLI read-only: stdout is JSON, no raw exceptions/input/credentials are printed. */
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { collectDevice, acquisitionInputSchema, snapshotSchema, COLLECTORS } from "../src/lib/acquisition/index";
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
function insideRepo(file: string): boolean { const rel = relative(repo, file); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); }
let phase: 'input' | 'collection' = 'input';
async function main(): Promise<void> {
    const { values } = parseArgs({ options: { 'credentials-file': { type: 'string' }, output: { type: 'string' }, schema: { type: 'boolean' }, list: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true, allowPositionals: false });
    if (values.help) {
        process.stdout.write('Uso: node --import tsx scripts/acquire-device.ts --credentials-file /percorso/privato/device.json [--output /percorso/privato/snapshot.json]\nAltre opzioni: --schema, --list\nExit: 0 acquisito; 2 parziale; 1 errore raccolta; 64 input non valido.\n');
        return;
    }
    if (values.schema) {
        process.stdout.write(JSON.stringify(z.toJSONSchema(snapshotSchema), null, 2) + '\n');
        return;
    }
    if (values.list) {
        process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(COLLECTORS).map(([key, v]) => [key, { version: v.version }])), null, 2) + '\n');
        return;
    }
    if (!values['credentials-file'])
        throw Error('INPUT');
    const file = await realpath(values['credentials-file']);
    if (insideRepo(file))
        throw Error('INPUT');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let data: unknown;
    try {
        const st = await handle.stat();
        if (!st.isFile() || st.size > 65536 || (st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid()))
            throw Error('INPUT');
        try {
            data = JSON.parse(await handle.readFile('utf8'));
        }
        catch {
            throw Error('INPUT');
        }
    }
    finally {
        await handle.close();
    }
    const input = acquisitionInputSchema.parse(data);
    // Reserve a new, private destination before networking; never overwrite existing snapshots or credentials.
    let output: Awaited<ReturnType<typeof open>> | undefined;
    if (values.output) {
        const target = resolve(values.output), parent = await realpath(resolve(target, '..'));
        const canonical = resolve(parent, target.split('/').at(-1)!);
        if (insideRepo(canonical))
            throw Error('INPUT');
        output = await open(canonical, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    }
    try {
        phase = 'collection';
        const snapshot = await collectDevice(input);
        const json = JSON.stringify(snapshot, null, 2) + '\n';
        if (output)
            await output.writeFile(json);
        else
            process.stdout.write(json);
        process.exitCode = snapshot.status === 'ok' ? 0 : snapshot.status === 'partial' ? 2 : 1;
    }
    finally {
        await output?.close();
    }
}
main().catch(() => { process.stderr.write(phase === 'input' ? 'Acquisizione non eseguita: verifica input, permessi 0600 e percorso esterno al repository. Dettagli sensibili omessi.\n' : 'Acquisizione fallita per errore interno; dettagli sensibili omessi.\n'); process.exitCode = phase === 'input' ? 64 : 1; });
