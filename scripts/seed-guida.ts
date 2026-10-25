import { getHubDb, createTenant, createUser, setUserTenantAccess } from '../src/lib/db-hub';
import { getTenantDb, withTenant } from '../src/lib/db-tenant';
import bcrypt from 'bcrypt';

async function main() {
 if(process.env.GUIDA_DEMO !== '1' || !process.env.DA_INVENT_DATA_DIR?.endsWith('/demo-data')) throw new Error('Solo demo esplicita in demo-data');
 const hub=getHubDb();
 const t=createTenant({codice_cliente:'DEMO',ragione_sociale:'Azienda dimostrativa',active:1} as Parameters<typeof createTenant>[0]);
 const u=createUser('guida',await bcrypt.hash('DimostrazioneLocale2026!',12),'admin',t.id,'tecnico@example.invalid');
 setUserTenantAccess(u.id,t.id,'admin');
 hub.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)").run('onboarding_completed','1');
 const d=getTenantDb('DEMO');
 const now=new Date().toISOString().replace('T',' ').slice(0,19);
 function ins(table:string,values:Record<string,unknown>){ const keys=Object.keys(values); return Number(d.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(values)).lastInsertRowid); }
 const sede=ins('locations',{name:'Sede dimostrativa'}); const ced=ins('locations',{name:'CED · Rack A',parent_id:sede});
 const ass=ins('asset_assignees',{name:'Tecnico dimostrativo',email:'tecnico@example.invalid',note:'Dati sintetici per la guida'});
 const networks=[['192.0.2.0/24','Uffici',10,'192.0.2.1'],['198.51.100.0/24','Server e servizi',20,'198.51.100.1'],['203.0.113.0/24','Ospiti e dispositivi',30,'203.0.113.1']];
 const ids=networks.map(n=>ins('networks',{cidr:n[0],name:n[1],vlan_id:n[2],gateway:n[3],location:'Sede dimostrativa',location_id:sede}));
 const samples=[['192.0.2.1','GW-UFFICI','router','MikroTik','RouterOS 7',0],['192.0.2.2','SW-ACCESSO','switch','HPE Aruba','ArubaOS-Switch',0],['192.0.2.11','PC-AMMINISTRAZIONE','workstation','Lenovo','Windows 11 Pro',0],['192.0.2.12','NB-COMMERCIALE','notebook','Dell','Windows 11 Pro',0],['192.0.2.30','PRINT-UFFICI','stampante','HP','Firmware stampante',0],['198.51.100.10','HV-DEMO','hypervisor','Proxmox','Proxmox VE 8',1],['198.51.100.20','SRV-DOMINIO','server','Microsoft','Windows Server 2022',1],['198.51.100.25','NAS-BACKUP','nas','Synology','DSM 7',1],['198.51.100.40','VM-GESTIONALE','vm','Ubuntu','Ubuntu 24.04 LTS',1],['203.0.113.12','AP-OSPITI','access_point','Ubiquiti','UniFi',2],['203.0.113.45','CAM-INGRESSO','telecamera','Generic','Embedded Linux',2],['203.0.113.88','OGGETTO-DA-IDENTIFICARE','unknown','Sconosciuto','Non rilevato',2]];
 samples.forEach((x,i)=>{const id=ins('hosts',{network_id:ids[Number(x[5])],ip:x[0],hostname:x[1],classification:x[2],vendor:x[3],os_info:x[4],mac:`02:00:00:00:01:${(i+1).toString(16).padStart(2,'0')}`,status:i===10?'offline':'online',first_seen:now,last_seen:now,last_response_time_ms:2+i,known_host:i===0||i===6?1:0,open_ports:JSON.stringify(i===6?[53,88,389,445,5985]:[22,443]),classification_manual:1});
 if(i<10)ins('inventory_assets',{asset_id:`DEMO-${String(i+1).padStart(3,'0')}`,host_id:id,hostname:x[1],nome_prodotto:x[1],categoria:({router:'Router',switch:'Switch',workstation:'Desktop',notebook:'Laptop',stampante:'Stampante',hypervisor:'Server',server:'Server',nas:'NAS',vm:'VM',access_point:'Access Point'} as Record<string,string>)[String(x[2])],marca:x[3],modello:'Modello dimostrativo',serial_number:`DEMO-SN-${i+1}`,stato:'Attivo',location_id:i>=5?ced:sede,asset_assignee_id:i===2?ass:null,ip_address:x[0],classificazione_dati:'Interno',sistema_operativo:x[4]});
 ins('status_history',{host_id:id,status:i===10?'offline':'online',response_time_ms:2+i,checked_at:now});
 });
 ins('network_devices',{name:'SW-ACCESSO',host:'192.0.2.2',device_type:'switch',vendor:'hp',protocol:'snmp_v2',classification:'switch',model:'Aruba 2540',firmware:'Versione dimostrativa',enabled:0});
 ins('network_devices',{name:'GW-UFFICI',host:'192.0.2.1',device_type:'router',vendor:'mikrotik',protocol:'ssh',classification:'router',model:'CCR · Demo',enabled:0});
 for(let i=0;i<3;i++){
  const vid=Number(networks[i][2]);
  ins('trunk_vlan',{vid,vista:1,dichiarata:1,mac:4,reti:JSON.stringify([{vid,cidr:networks[i][0],gateway_ip:networks[i][3],fonte:'dhcp'}]),server_dhcp:JSON.stringify([{mac:'02:00:00:00:02:01',ip:networks[i][3],ultima_vista:now}]),ultima_vista:now,aggiornato:now});
 }
 samples.forEach((x,i)=>ins('trunk_osservazioni',{vid:networks[Number(x[5])][2],mac_normalized:`0200000001${(i+1).toString(16).padStart(2,'0')}`,mac_display:`02:00:00:00:01:${(i+1).toString(16).padStart(2,'0')}`,ip:x[0],nome:x[1],fonte_nome:'dhcp',protocolli:i===2?'dhcp,llmnr':'arp,dhcp',passivo:1,attivo:i===4?1:0,prima_vista:new Date(Date.now()-3*86400000).toISOString(),ultima_vista:new Date().toISOString()}));
 [['dhcp_non_previsto','allarme','alta','Server DHCP non previsto nella VLAN ospiti','203.0.113.99',30],['nomi_insicuri','esposizione','media','PC-AMMINISTRAZIONE usa LLMNR per risolvere i nomi','192.0.2.11',10],['non_in_inventario','novita','bassa','Oggetto da identificare osservato sulla rete ospiti','203.0.113.88',30]].forEach((x,i)=>ins('rete_rilievi',{chiave:'demo-'+i,tipo:x[0],categoria:x[1],gravita:x[2],descrizione:x[3],ip:x[4],vid:x[5],dettaglio:'{}',rilevato_il:now,aggiornato_il:now,ultima_vista:now}));
 d.prepare('INSERT OR REPLACE INTO tenant_settings(key,value) VALUES (?,?)').run('trunk_ultimo_esito',JSON.stringify({quando:new Date().toISOString(),esito:'assente',nota:'Laboratorio dimostrativo: archivio sintetico, nessuna sonda collegata'}));
 console.log('Database dimostrativi creati; nessuna scansione o integrazione configurata.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
