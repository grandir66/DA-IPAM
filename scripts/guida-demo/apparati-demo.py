from pathlib import Path
import os,sqlite3
assert os.environ.get('GUIDA_DEMO')=='1'
r=Path(__file__).resolve().parents[2];c=sqlite3.connect(r/'demo-data/tenants/DEMO.db')
c.execute('UPDATE network_devices SET host_id=2 WHERE id=1');c.execute('UPDATE network_devices SET host_id=1 WHERE id=2')
for hid,vendor,cls,target in [(3,'other','workstation',None),(6,'proxmox','hypervisor','proxmox'),(7,'windows','server','windows'),(8,'synology','nas',None),(9,'linux','server','linux')]:
 if c.execute('select id from network_devices where host_id=?',(hid,)).fetchone():continue
 name,ip=c.execute('select hostname,ip from hosts where id=?',(hid,)).fetchone()
 c.execute('insert into network_devices(name,host,host_id,device_type,vendor,classification,scan_target,protocol,enabled) values(?,?,?,?,?,?,?,?,0)',(name,ip,hid,'switch',vendor,cls,target,'ssh'))
c.commit();print('Apparati sintetici collegati, interrogazioni automatiche disabilitate.')
