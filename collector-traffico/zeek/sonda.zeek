# Sonda avanzata del collector di traffico (piano 2026-11-23-sonda-avanzata-zeek).
#
# Zeek gira da solo (senza zeekctl): zeek -C -i <scheda> sonda.zeek, nella cartella dei registri.
# Carica un elenco nostro, non `local`. La parte `base` Zeek la carica comunque: per questo in fondo
# si spengono TUTTI i registri che non sono nell'elenco `tenuti` (MySQL, RADIUS, SOCKS, RDP, IRC,
# PostgreSQL scrivono nomi utente; gli altri occupano disco e nessuno li legge).
#
# REGOLA: nessun segreto tocca il disco (password, comunita' SNMP, hash, biglietti Kerberos,
# nomi utente). I campi si tolgono con un filtro per campo (`exclude`) PRIMA della scrittura.
# La prova e' collector-traffico/tests/test_non_fuga.py. Zeek 9.0.1: nomi dei campi letti nel
# sorgente di quella versione (23/11/2026).

@load base/protocols/conn
@load base/protocols/dns
@load base/protocols/ssl
@load base/files/x509
@load base/protocols/http
@load base/protocols/ftp
@load base/protocols/snmp
@load base/protocols/modbus
@load base/protocols/smb
@load base/protocols/ntlm
@load base/protocols/krb
@load base/protocols/ldap
@load base/protocols/ssh
@load base/frameworks/software
# il riconoscimento dei programmi sta in policy: senza, software.log resta vuoto (visto sul banco il 23/11)
@load policy/protocols/http/software
@load policy/protocols/ssh/software
@load policy/protocols/ftp/software
@load policy/protocols/smtp/software
@load base/frameworks/notice
@load policy/protocols/ssh/detect-bruteforcing
# in 9.0.1 si chiama cosi' (il piano diceva detect-sqli, che non esiste piu')
@load policy/protocols/http/detect-sql-injection
@load policy/protocols/ssl/validate-certs
@load misc/stats

redef LogAscii::use_json = T;
redef Log::default_rotation_interval = 300 sec;
redef HTTP::default_capture_password = F;
redef FTP::default_capture_password = F;
redef LDAP::default_capture_password = F;

module Sonda;

export {
	## I registri che si scrivono. Tutto il resto si spegne all'avvio.
	const tenuti: set[string] = {
		"conn", "dns", "ssl", "x509", "http", "ftp", "snmp", "modbus",
		"smb_files", "smb_mapping", "ntlm", "kerberos", "ldap", "ldap_search",
		"ssh", "software", "notice", "stats",
	} &redef;
}

# Le sonde note (SONDE_NOTE in collector.env: IPAM, Zabbix...) scandiscono per mestiere: le loro connessioni non si
# scrivono. Il 24/11/2026 una scansione di tutte le porte da IPAM ha fatto un conn.log da 498 MB in 5 minuti.
# Stessa regola di `sonde.ts` e `piega.rumore_di_sonda`: resta chi apre un servizio della sonda.
global sonde_note: set[addr];

event zeek_init()
	{
	local pezzi = split_string(getenv("SONDE_NOTE"), /,/);
	for ( i in pezzi )
		{
		local p = strip(pezzi[i]);
		if ( is_valid_ip(p) )
			add sonde_note[to_addr(p)];
		}
	}

hook Conn::log_policy(rec: Conn::Info, id: Log::ID, filter: Log::Filter) &priority=10
	{
	if ( rec$id$orig_h in sonde_note )
		break;
	if ( rec$id$resp_h in sonde_note && ( rec$proto == icmp || port_to_count(rec$id$resp_p) >= 32768 ) )
		break;
	}

# Connessioni vive. Zeek scrive una connessione in `conn` solo quando finisce: quelle sempre aperte (telefoni SIP,
# syslog, agenti Wazuh, sessioni 443 di giorni) non comparivano mai (24/11/2026: sul DA-PX-04 51 GB su 76 del traffico
# stabile). A ogni finestra, poco prima che Zeek chiuda il registro, si scrive in `conn` una riga con quello che la
# connessione ha scambiato dall'ultima volta; alla fine, dalla riga normale si toglie quanto gia' scritto.
# `gia_vista` = T sulle righe dopo la prima della stessa connessione: la connessione e' gia' stata contata come riuscita.
redef record Conn::Info += {
	gia_vista: bool &optional &log;
};

type Viva: record {
	id: conn_id;
	orig_b: count &default=0;
	resp_b: count &default=0;
	orig_p: count &default=0;
	resp_p: count &default=0;
	scritta: bool &default=F;
};

const vive_ogni = 300 sec;
const vive_anticipo = 5 sec;     # prima della chiusura del registro (allineata all'orologio)
const vive_dopo = 120 sec;       # una connessione piu' giovane si conta alla fine, o al giro dopo
const vive_massime = 200000;     # oltre, le nuove si contano solo alla fine, come prima
global vive: table[string] of Viva;
global scrivi_vive: event();

function attesa_vive(): interval
	{
	local t = time_to_double(network_time());
	if ( t < 1.0 )
		return 1 sec;  # lettura da file: il tempo parte col primo pacchetto
	local g = interval_to_double(vive_ogni);
	local resto = g - ( t - floor(t / g) * g ) - interval_to_double(vive_anticipo);
	return double_to_interval(resto > 1.0 ? resto : resto + g);
	}

function meno(a: count, b: count): count
	{
	return a > b ? a - b : 0;
	}

event zeek_init()
	{
	schedule attesa_vive() { scrivi_vive() };
	}

event new_connection(c: connection)
	{
	if ( |vive| < vive_massime && c$id$orig_h !in sonde_note )
		vive[c$uid] = Viva($id=c$id);
	}

event connection_flipped(c: connection)
	{
	if ( c$uid !in vive )
		return;
	local v = vive[c$uid];
	vive[c$uid] = Viva($id=c$id, $orig_b=v$resp_b, $resp_b=v$orig_b, $orig_p=v$resp_p, $resp_p=v$orig_p, $scritta=v$scritta);
	}

event scrivi_vive()
	{
	schedule attesa_vive() { scrivi_vive() };
	for ( uid, v in vive )
		{
		if ( ! connection_exists(v$id) )
			next;
		local c = lookup_connection(v$id);
		if ( c$uid != uid || network_time() - c$start_time < vive_dopo || ! c$orig?$num_pkts || ! c$resp?$num_pkts )
			next;
		local op = meno(c$orig$num_pkts, v$orig_p);
		local rp = meno(c$resp$num_pkts, v$resp_p);
		if ( op + rp == 0 )
			next;
		local info = Conn::Info($ts=c$start_time, $uid=uid, $id=c$id, $proto=get_port_transport_proto(c$id$resp_p));
		info$duration = network_time() - c$start_time;
		info$orig_pkts = op;
		info$resp_pkts = rp;
		info$orig_ip_bytes = meno(c$orig$num_bytes_ip, v$orig_b);
		info$resp_ip_bytes = meno(c$resp$num_bytes_ip, v$resp_b);
		# S1 = aperta e viva; con una direzione sola non si puo' dire niente
		info$conn_state = c$orig$num_pkts > 0 && c$resp$num_pkts > 0 ? "S1" : "OTH";
		info$gia_vista = v$scritta;
		v$orig_p = c$orig$num_pkts;
		v$resp_p = c$resp$num_pkts;
		v$orig_b = c$orig$num_bytes_ip;
		v$resp_b = c$resp$num_bytes_ip;
		v$scritta = T;
		Log::write(Conn::LOG, info);
		}
	}

# dopo che Zeek ha riempito c$conn (priorita' 5), prima che lo scriva (-5)
event connection_state_remove(c: connection) &priority=0
	{
	if ( c$uid !in vive )
		return;
	local v = vive[c$uid];
	if ( v$scritta && c?$conn )
		{
		c$conn$gia_vista = T;
		if ( c$conn?$orig_pkts )
			c$conn$orig_pkts = meno(c$conn$orig_pkts, v$orig_p);
		if ( c$conn?$resp_pkts )
			c$conn$resp_pkts = meno(c$conn$resp_pkts, v$resp_p);
		if ( c$conn?$orig_ip_bytes )
			c$conn$orig_ip_bytes = meno(c$conn$orig_ip_bytes, v$orig_b);
		if ( c$conn?$resp_ip_bytes )
			c$conn$resp_ip_bytes = meno(c$conn$resp_ip_bytes, v$resp_b);
		}
	delete vive[c$uid];
	}

# Del segreto si tiene solo il FATTO, calcolato prima che il campo venga tolto:
# la comunita' SNMP e' una di quelle di fabbrica? c'era un accesso Basic? una password FTP?
redef record SNMP::Info += {
	comunita_nota: bool &optional &log;
};
redef record HTTP::Info += {
	accesso_basic: bool &optional &log;
};
redef record FTP::Info += {
	accesso_chiaro: bool &optional &log;
};
redef record LDAP::MessageInfo += {
	accesso_chiaro: bool &optional &log;
};

hook SNMP::log_policy(rec: SNMP::Info, id: Log::ID, filter: Log::Filter) &priority=10
	{
	if ( rec?$community )
		rec$comunita_nota = ( rec$community == "public" || rec$community == "private" );
	}

hook HTTP::log_policy(rec: HTTP::Info, id: Log::ID, filter: Log::Filter) &priority=10
	{
	if ( rec?$username )
		rec$accesso_basic = T;
	}

hook FTP::log_policy(rec: FTP::Info, id: Log::ID, filter: Log::Filter) &priority=10
	{
	# Zeek mette "<hidden>" in `password` quando ha visto il comando PASS
	if ( rec?$password )
		rec$accesso_chiaro = T;
	}

hook LDAP::log_policy(rec: LDAP::MessageInfo, id: Log::ID, filter: Log::Filter) &priority=10
	{
	# Zeek scrive "REDACTED" in `argument` solo per un bind semplice con password NON vuota (l'anonimo non e' una credenziale)
	if ( rec?$opcode && rec$opcode == "bind simple" && rec?$argument )
		rec$accesso_chiaro = T;
	}

function togli(stream: Log::ID, campi: set[string])
	{
	local f = Log::get_filter(stream, "default");
	if ( f$name == "<not found>" )
		return;
	f$exclude = campi;
	Log::add_filter(stream, f);
	}

event zeek_init() &priority=-5
	{
	togli(SNMP::LOG, set("community"));
	# uri e referrer possono portare una password nella query (?password=...)
	togli(HTTP::LOG, set("username", "password", "uri", "referrer"));
	togli(FTP::LOG, set("user", "password", "arg"));
	togli(NTLM::LOG, set("username", "hostname", "domainname"));
	togli(KRB::LOG, set("client", "service"));
	togli(LDAP::LDAP_LOG, set("object", "argument"));
	togli(LDAP::LDAP_SEARCH_LOG, set("base_object", "filter"));
	}

event zeek_init() &priority=-10
	{
	# disable_stream toglie la voce da active_streams: prima si raccolgono, poi si spengono
	local via: vector of Log::ID = vector();
	for ( id, s in Log::active_streams )
		if ( ! s?$path || s$path !in tenuti )
			via += id;
	for ( i in via )
		Log::disable_stream(via[i]);
	}
