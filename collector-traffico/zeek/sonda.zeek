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
