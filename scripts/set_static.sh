#!/bin/bash

NET_ENV_INTERFACE="{{{net_env_interface}}}"
NET_ENV_STATIC_IP="{{{net_env_static_ip}}}"
NET_ENV_SUBNET_MASK="{{{net_env_subnet_mask}}}"
NET_ENV_GATEWAY="{{{net_env_gateway}}}"

NET_ENV_INTERFACE_LOWER=`echo "$NET_ENV_INTERFACE" | tr '[:upper:]' '[:lower:]'`
NET_ENV_INTERFACE_UPPER=`echo "$NET_ENV_INTERFACE" | tr '[:lower:]' '[:upper:]'`

function valid_ip(){
  local  ip=$1
  local  stat=1

  if [[ $ip =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
  then
    OIFS=$IFS
    IFS='.'
    ip=($ip)
    IFS=$OIFS
    [[ ${ip[0]} -le 255 && ${ip[1]} -le 255 && ${ip[2]} -le 255 && ${ip[3]} -le 255 ]]
    stat=$?
  fi
  return $stat
}

function checkEnv(){
  local badConf=""

  local leftWrap="{""{""{"
  local rigthWrap="}""}""}"
  local test1="net_env_interface"

  if [ "$leftWrap$test1$rigthWrap" = "$NET_ENV_INTERFACE" ] || [ "" = "$NET_ENV_INTERFACE" ]
  then
    badConf="$badConf NET_ENV_INTERFACE not set\n"
  fi
  if ! valid_ip $NET_ENV_STATIC_IP
  then
    badConf="$badConf NET_ENV_STATIC_IP not set or invalid IP\n"
  fi
  if [[ ! $NET_ENV_SUBNET_MASK =~ ^[0-9]+$ ]]
  then
    badConf="$badConf NET_ENV_SUBNET_MASK not set or invalid : must be an integer between 0 and 32 \n"
  fi
  if ! valid_ip $NET_ENV_GATEWAY
  then
    badConf="$badConf NET_ENV_GATEWAY not set or invalid IP\n"
  fi

  if test ! "" = "$badConf"
  then
    echo -e "$badConf"
    exit
  fi
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

  if test ! -f /etc/network/default/eth0
  then
    touch /etc/network/default/eth0
    cat <<EOF > /etc/network/default/eth0 &
###eth0:
auto eth0
allow-hotplug eth0
iface eth0 inet dhcp
###:eth0

EOF
  fi

  if test ! -f /etc/network/default/wlan0
  then
    touch /etc/network/default/wlan0
    cat <<EOF > /etc/network/default/wlan0 &
###wlan0:
allow-hotplug wlan0
iface wlan0 inet dhcp
wpa-conf /etc/wpa_supplicant/wpa_supplicant.conf
iface default inet dhcp
###:wlan0

EOF
  fi

  if test ! -L /etc/network/interfaces.d/auto
  then
    ln -s /etc/network/default/auto /etc/network/interfaces.d/auto
  fi
}

function setStatic(){
  ensureDefaultInterfaceConf
  if test -L /etc/network/interfaces.d/$NET_ENV_INTERFACE_LOWER
  then
    unlink /etc/network/interfaces.d/$NET_ENV_INTERFACE_LOWER
  fi

  PREVIOUS_CONF=`grep -Pzo '# TTB START DEFINITION (?!'"$NET_ENV_INTERFACE_UPPER"')[\s\S]*?\n[\s\S]*?\n# TTB END DEFINITION (?!'"$NET_ENV_INTERFACE_UPPER"')[\s\S]*?\n' /etc/dhcpcd.conf`
  ensureDefaultDhcpcdConf
  cp /etc/dhcpcd.base.conf /etc/dhcpcd.conf
  echo "$PREVIOUS_CONF" >> /etc/dhcpcd.conf
  echo "# TTB START DEFINITION $NET_ENV_INTERFACE_UPPER" >> /etc/dhcpcd.conf
  echo "interface $NET_ENV_INTERFACE_LOWER" >> /etc/dhcpcd.conf
  echo "static ip_address=$NET_ENV_STATIC_IP/$NET_ENV_SUBNET_MASK" >> /etc/dhcpcd.conf
  echo "static routers=$NET_ENV_GATEWAY" >> /etc/dhcpcd.conf
  echo "static domain_name_servers=$NET_ENV_GATEWAY 8.8.8.8" >> /etc/dhcpcd.conf
  echo "# TTB END DEFINITION $NET_ENV_INTERFACE_UPPER" >> /etc/dhcpcd.conf
  echo "" >> /etc/dhcpcd.conf
}

checkEnv
setStatic
