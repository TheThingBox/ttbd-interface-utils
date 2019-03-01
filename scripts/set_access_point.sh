#!/bin/bash

NET_ENV_INTERFACE="wlan0"
SSID_ID="{{{ssid_id}}}"

NET_ENV_INTERFACE_LOWER=`echo "$NET_ENV_INTERFACE" | tr '[:upper:]' '[:lower:]'`
NET_ENV_INTERFACE_UPPER=`echo "$NET_ENV_INTERFACE" | tr '[:lower:]' '[:upper:]'`

function checkEnv(){
  local badConf=""
  local leftWrap="{""{""{"
  local rigthWrap="}""}""}"
  local test1="ssid_id"
  if [ "$leftWrap$test1$rigthWrap" = "$SSID_ID" ] || [ "" = "$SSID_ID" ]
  then
    SSID_ID='AP'
  fi

  if test ! "" = "$badConf"
  then
    echo -e "$badConf"
    exit
  fi
}

function init(){
  systemctl enable hostapd > /dev/null 2>&1
  systemctl enable dnsmasq > /dev/null 2>&1
  service hostapd stop > /dev/null 2>&1
  service dnsmasq stop > /dev/null 2>&1
}

function restart_services(){
  service hostapd restart
  service dnsmasq restart
}

function ensureDefaultDhcpcdConf(){
  if test ! -f /etc/dhcpcd.base.conf
  then
    touch /etc/dhcpcd.base.conf
    cat <<EOF > /etc/dhcpcd.base.conf &
# A sample configuration for dhcpcd.
# See dhcpcd.conf(5) for details.
# Allow users of this group to interact with dhcpcd via the control socket.
#controlgroup wheel
# Inform the DHCP server of our hostname for DDNS.
hostname
# Use the hardware address of the interface for the Client ID.
clientid
# or
# Use the same DUID + IAID as set in DHCPv6 for DHCPv4 ClientID as per RFC4361.
# Some non-RFC compliant DHCP servers do not reply with this set.
# In this case, comment out duid and enable clientid above.
#duid
# Persist interface configuration when dhcpcd exits.
persistent
# Rapid commit support.
# Safe to enable by default because it requires the equivalent option set
# on the server to actually work.
option rapid_commit
# A list of options to request from the DHCP server.
option domain_name_servers, domain_name, domain_search, host_name
option classless_static_routes
# Most distributions have NTP support.
option ntp_servers
# Respect the network MTU. This is applied to DHCP routes.
option interface_mtu
# A ServerID is required by RFC2131.
require dhcp_server_identifier
# Generate Stable Private IPv6 Addresses instead of hardware based ones
slaac private
nohook wpa_supplicant

EOF
  fi
}

function ensureDefaultInterfaceConf(){
  cat <<EOF > /etc/network/interfaces &
# interfaces(5) file used by ifup(8) and ifdown(8)
# Please note that this file is written to be used with dhcpcd
# For static IP, consult /etc/dhcpcd.conf and 'man dhcpcd.conf'
# Include files from /etc/network/interfaces.d:
source-directory /etc/network/interfaces.d
EOF

  mkdir -p /etc/network/default
  if test ! -f /etc/network/default/auto
  then
    touch /etc/network/default/auto
    cat <<EOF > /etc/network/default/auto &
auto lo
iface lo inet loopback
EOF
  fi

  if test ! -L /etc/network/interfaces.d/auto
  then
    ln -s /etc/network/default/auto /etc/network/interfaces.d/auto
  fi
}

function setAccesPoint(){
  ensureDefaultInterfaceConf

  PREVIOUS_CONF=`grep -Pzo '# TTB START DEFINITION (?!ACCESS_POINT)[\s\S]*?\n[\s\S]*?\n# TTB END DEFINITION (?!ACCESS_POINT)[\s\S]*?\n' /etc/dhcpcd.conf`
  ensureDefaultDhcpcdConf
  cp /etc/dhcpcd.base.conf /etc/dhcpcd.conf
  echo "$PREVIOUS_CONF" >> /etc/dhcpcd.conf
  echo "# TTB START DEFINITION ACCESS_POINT" >> /etc/dhcpcd.conf
  echo "interface $NET_ENV_INTERFACE_LOWER" >> /etc/dhcpcd.conf
  echo "static ip_address=192.168.61.1/24" >> /etc/dhcpcd.conf
  echo "static routers=192.168.61.0" >> /etc/dhcpcd.conf
  echo "static domain_name_servers=192.168.61.0 8.8.8.8" >> /etc/dhcpcd.conf
  echo "denyinterfaces wlan0" >> /etc/dhcpcd.conf
  echo "# TTB END DEFINITION ACCESS_POINT" >> /etc/dhcpcd.conf
  echo "" >> /etc/dhcpcd.conf

  ip addr flush dev wlan0
}

function configure_hostapd(){
  echo "" > /etc/hostapd/hostapd.conf
  cat <<EOF > /etc/hostapd/hostapd.conf &
interface=wlan0
ssid=digitalairways_$SSID_ID
# mode Wi-Fi (a = IEEE 802.11a, b = IEEE 802.11b, g = IEEE 802.11g)
hw_mode=g
channel=6
# open Wi-Fi, no auth !
auth_algs=1
# Beacon interval in kus (1.024 ms)
beacon_int=100
# DTIM (delivery trafic information message)
dtim_period=2
# Maximum number of stations allowed in station table
max_num_sta=255
# RTS/CTS threshold; 2347 = disabled (default)
rts_threshold=2347
# Fragmentation threshold; 2346 = disabled (default)
fragm_threshold=2346

EOF

  DEMONCONF_COMMENT=`sed -n '/^#[ ]*DAEMON_CONF\=\"[\/a-zA-Z0-9\.]*\"/=' /etc/default/hostapd`

  if test "" != "$DEMONCONF_COMMENT"
  then
    sed -i 's/^#[ ]*DAEMON_CONF\=\"[\/a-zA-Z0-9\.]*\"/DAEMON_CONF\=\"\"/' /etc/default/hostapd
  fi
  sed -i 's/^DAEMON_CONF\=\"[\/a-zA-Z0-9\.]*\"/DAEMON_CONF\=\"\/etc\/hostapd\/hostapd\.conf\"/' /etc/default/hostapd
}

function configure_dnsmasq(){
  if [ ! -e /etc/dnsmasq.base.conf ]
  then
    cp /etc/dnsmasq.conf /etc/dnsmasq.base.conf
  fi

  echo "" > /etc/dnsmasq.conf
  cat <<EOF > /etc/dnsmasq.conf &
# Never forward addresses in the non-routed address spaces.
bogus-priv
# Add other name servers here, with domain specs if they are for non-public domains.
server=/local/192.168.61.1
# Add local-only domains here, queries in these domains are answered from /etc/hosts or DHCP only.
local=/local/
# Make all host names resolve to the Raspberry Pi's IP address
address=/#/192.168.61.1
# Specify the interface that will listen for DHCP and DNS requests
interface=wlan0
# Set the domain for dnsmasq
domain=local
# Specify the range of IP addresses the DHCP server will lease out to devices, and the duration of the lease
dhcp-range=192.168.61.10,192.168.61.254,1h
# Specify the default route
dhcp-option=3,192.168.61.1
# Specify the DNS server address
dhcp-option=6,192.168.61.1
# Set the DHCP server to authoritative mode.
dhcp-authoritative

EOF
}

checkEnv
init
setAccesPoint
configure_hostapd
configure_dnsmasq
restart_services
