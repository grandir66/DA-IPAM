/** Only static inventory reads. Never export configurations, users, tokens, Wi-Fi keys or guest secrets. */
export const INVENTORY_COMMANDS = {
 'synology-dsm':['uname -s','hostname','cat /etc.defaults/VERSION','cat /proc/meminfo','cat /proc/mdstat','df -P -k','ip -j link show','ip -j address show','lsblk -b -J -o NAME,TYPE,SIZE,MODEL,SERIAL,ROTA'],
 'qnap-nas':['uname -s','hostname','getsysinfo model','getsysinfo serial_num','getcfg System Version -f /etc/config/uLinux.conf','cat /proc/meminfo','cat /proc/mdstat','df -P -k','ip -j link show','ip -j address show','lsblk -b -J -o NAME,TYPE,SIZE,MODEL,SERIAL,ROTA'],
 'mikrotik-routeros':['/system resource print','/system routerboard print','/system identity print','/interface print terse without-paging','/ip address print terse without-paging','/ip arp print terse without-paging','/ip neighbor print terse without-paging','/interface bridge print terse without-paging','/interface bridge port print terse without-paging','/interface bridge vlan print terse without-paging','/interface bonding print terse without-paging','/ip route print terse without-paging','/interface wifi print terse without-paging','/interface wireless print terse without-paging'],
 'ubiquiti-device':['uname -s','hostname','cat /etc/version','mca-status','cat /proc/meminfo','ip -j link show','ip -j address show','ip -j neighbor show'],
 'proxmox-ve':['pveversion','hostname','pvesh get /nodes --output-format json','pvesh get /cluster/status --output-format json','pvesh get /cluster/resources --output-format json','ip -d -j link show','ip -j address show','cat /proc/meminfo','lsblk -b -J -o NAME,TYPE,SIZE,MODEL,SERIAL,ROTA']
} as const;
export type InventoryProfile=keyof typeof INVENTORY_COMMANDS;
export const isInventoryProfile=(name:string):name is InventoryProfile=>Object.hasOwn(INVENTORY_COMMANDS,name);
