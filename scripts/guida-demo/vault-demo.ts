import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { creaArchivio } from '../../src/lib/vault/archivio';
import { impostaChiaveDati } from '../../src/lib/vault/stato';
import { encrypt } from '../../src/lib/crypto';
import { getTenantDb, withTenant } from '../../src/lib/db-tenant';
import { creaCredenzialeDb } from '../../src/lib/credentials/archivio';
async function main(){
 const base=process.env.DA_INVENT_DATA_DIR;
 if(process.env.GUIDA_DEMO!=='1'||!base?.endsWith('/demo-data'))throw Error('Solo demo esplicita');
 const dir=join(base,'vault');if(existsSync(join(dir,'archivio.json')))return;
 const recipient=await identityToRecipient(await generateX25519Identity());
 const {chiave}=await creaArchivio(dir,{passphrase:'Vault solo dimostrativo 2026!',chiaveDomarc:recipient});
 process.env.DA_VAULT_LOCALE='1';impostaChiaveDati(chiave,'passphrase');
 withTenant('DEMO',()=>{creaCredenzialeDb(getTenantDb('DEMO'),{name:'ESEMPIO FITTIZIO — accesso laboratorio',credential_type:'ssh',encrypted_username:encrypt('utente-demo'),encrypted_password:encrypt('Credenziale fittizia inutilizzabile'),port:22});});
 console.log('Archivio esclusivamente dimostrativo creato. Nessuna chiave reale o recupero Domarc configurato.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
