from pathlib import Path
import sqlite3,datetime,json,re,os
assert os.environ.get("GUIDA_DEMO")=="1", "Solo demo esplicita"
r=Path(__file__).resolve().parents[2];d=sqlite3.connect(r/'demo-data/tenants/DEMO.db');h=sqlite3.connect(r/'demo-data/hub.db');now=datetime.datetime.now(datetime.timezone.utc).isoformat();sqlnow=now[:19].replace('T',' ')
def ins(t,**v):
 cols={x[1] for x in d.execute('PRAGMA table_info('+t+')')};v={k:x for k,x in v.items() if k in cols}
 return d.execute('INSERT INTO '+t+' ('+','.join(v)+') VALUES ('+','.join('?' for _ in v)+')',list(v.values())).lastrowid
if d.execute("select value from tenant_settings where key='guida.estesa'").fetchone():print('Fixture già estese');raise SystemExit
for file,const in [('src/lib/patch/schema.ts','PATCH_MODULE_SCHEMA_SQL'),('src/lib/ad/health/persist.ts','AD_HEALTH_SCHEMA_SQL')]:
 s=(r/file).read_text();m=re.search(r'(?:export )?const '+const+r' = `([\s\S]*?)`;',s);assert m,file;d.executescript(m[1])
# Una seconda istanza vuota rende consultabile la selezione riservata dell'hub.
h.execute("INSERT OR IGNORE INTO tenants(codice_cliente,ragione_sociale,active) VALUES ('DEMO2','Seconda istanza dimostrativa',1)")
h.execute("UPDATE users SET role='superadmin',ultima_istanza='DEMO' WHERE username='guida'")
h.execute("INSERT OR REPLACE INTO tenant_features(tenant_code,feature_key,enabled,enabled_at) VALUES ('DEMO','patch_management',1,?)",(now,))
for i in range(1,9):
 ins('switch_ports',device_id=1,port_index=i,port_name='1/'+str(i),status='up' if i<6 else 'down',speed='1 Gbps',duplex='full',vlan=10,is_trunk=int(i==1),mac_count=1 if i<6 else 0,host_id=i+1 if i<5 else None,is_uplink=int(i==1),timestamp=sqlnow)
 ins('mac_port_entries',device_id=1,mac=f'02:00:00:00:01:{i:02x}',port_name='1/'+str(i),vlan=10,port_status='up',timestamp=sqlnow)
for row in d.execute('select id,ip,mac,hostname,network_id from hosts').fetchall():
 ins('mac_ip_mapping',mac_normalized=row[2].replace(':',''),mac_display=row[2],ip=row[1],source='host',network_id=row[4],hostname=row[3],first_seen=sqlnow,last_seen=sqlnow)
 ins('scan_history',host_id=row[0],scan_type='ping',status='online',ports_open='[22,443]',duration_ms=100,timestamp=sqlnow)
for host in (3,4,7):
 scan=ins('software_scans',host_id=host,started_at=now,finished_at=now,status='ok',os_family='windows',probe='guida-demo',apps_count=2)
 for name,version in [('Editor Demo','1.0'),('Browser Demo','2.0')]:
  sid=ins('software_inventory',scan_id=scan,name=name,version=version,publisher='Produttore dimostrativo',source='registry')
  if name=='Editor Demo':
   ins('patch_software_meta',software_id=sid,choco_id='editor-demo',match_confidence=.95)
   ins('patch_cve_target',cve_id='CVE-2099-0001',software_id=sid,match_strategy='manual',confidence=1,fix_package_manager='choco',fix_package_id='editor-demo',fix_version='1.1')
lic=ins('licenses',name='Suite dimostrativa',seats=5,category='Abbonamento',expiration_date='2027-12-31',purchase_cost=500,min_amt=1,note='Esempio sintetico')
ins('license_seats',license_id=lic,asset_type='inventory_asset',asset_id=3,asset_assignee_id=1)
service=ins('services',name='Gestionale dimostrativo',description='Servizio sintetico per illustrare dipendenze e impatto',criticita_servizio='alta',in_scope_nis2=1,rto_minutes=120,rpo_minutes=60,business_owner_id=1,technical_owner_id=1)
ins('service_asset_dependencies',service_id=service,asset_id=9,dependency_type='primario',note='Applicazione gestionale dimostrativa')
ins('service_asset_dependencies',service_id=service,asset_id=8,dependency_type='supporto',note='Copia dati dimostrativa')
d.execute("UPDATE inventory_assets SET in_scope_nis2=1,categoria_nis2='workstation',business_owner_id=1,asset_tag=asset_id,prezzo_acquisto=900,fine_garanzia='2027-12-31' WHERE id=3")
ins('inventory_audit_log',asset_id=3,user_id=1,action='update',field_name='asset_assignee_id',old_value='',new_value='1')
ad=ins('ad_integrations',name='Dominio dimostrativo (scollegato)',dc_host='192.0.2.250',domain='demo.invalid',base_dn='DC=demo,DC=invalid',encrypted_username='',encrypted_password='',enabled=0,last_sync_at=sqlnow,last_sync_status='ok',computers_count=2,users_count=2,groups_count=1)
for i,host in enumerate((3,4),1):
 ins('ad_computers',integration_id=ad,object_guid='demo-pc-'+str(i),sam_account_name='PC-DEMO-'+str(i)+'$',dns_host_name='pc-demo-'+str(i)+'.demo.invalid',display_name='PC dimostrativo '+str(i),distinguished_name='CN=PC-DEMO-'+str(i)+',DC=demo,DC=invalid',operating_system='Windows 11',enabled=1,host_id=host,ip_address='192.0.2.'+str(10+i),last_logon_at=now)
 ins('ad_users',integration_id=ad,object_guid='demo-user-'+str(i),sam_account_name='persona'+str(i),display_name='Persona Dimostrativa '+str(i),given_name='Persona',surname='Dimostrativa '+str(i),email='persona'+str(i)+'@example.invalid',department='Ufficio dimostrativo',title='Collaboratore',last_logon_at=now,enabled=1)
ins('ad_groups',integration_id=ad,object_guid='demo-group',sam_account_name='Gruppo-Demo',display_name='Gruppo dimostrativo',distinguished_name='CN=Gruppo-Demo,DC=demo,DC=invalid',member_guids='["demo-user-1","demo-user-2"]')
run=ins('ad_health_runs',integration_id=ad,started_at=now,finished_at=now,status='ok',score_global=10,score_stale=0,score_privileged=10,score_trust=0,score_anomaly=0,engine_version='demo',stats_json='{}')
ins('ad_health_findings',run_id=run,rule_id='DEMO-01',axis='privileged',severity='Medium',points=10,title='Rilievo dimostrativo sui privilegi',description='Dati sintetici, nessuna analisi di dominio eseguita',object_count=1,sample_dns_json='[]',raw_json='{}')
scanner=ins('vuln_scanners',name='Sonda dimostrativa non collegata',base_url='https://127.0.0.1:9',token_encrypted='',enabled=0)
vrun=ins('vuln_scan_runs',scanner_id=scanner,edge_scan_id=1,edge_scan_uid='guida-demo-01',network_id=1,started_at=now,finished_at=now,finding_count=1,status='completed')
ins('vuln_findings',host_id=3,scan_run_id=vrun,ip='192.0.2.11',hostname='PC-AMMINISTRAZIONE',cve_id='CVE-2099-0001',cvss_score=7.5,severity='High',nvt_name='Esempio dimostrativo, CVE fittizia',description='Risultato sintetico: nessuna scansione eseguita',scanned_at=now)
op=ins('patch_operations',host_id=3,user_id=1,cve_id='CVE-2099-0001',package_id='editor-demo',action='upgrade',status='success',package_version_before='1.0',package_version_after='1.1',started_at=now,finished_at=now)
ins('patch_operation_logs',operation_id=op,ts=now,stream='system',line='Esempio di storico sintetico: nessun programma è stato modificato')
ins('credentials',name='Accesso SSH dimostrativo — senza segreti',credential_type='ssh',port=22)
ins('credentials',name='SNMP dimostrativo — senza segreti',credential_type='snmp_v2',port=161)
d.execute("INSERT OR REPLACE INTO tenant_settings(key,value) VALUES ('guida.estesa','1')")
d.commit();h.commit();print('Fixture sintetiche estese, nessun sistema esterno interrogato.')
