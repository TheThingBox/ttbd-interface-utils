#!/bin/bash

NET_ENV_SSID="{{{net_env_ssid}}}"
NET_ENV_PASSPHRASE="{{{net_env_passphrase}}}"

function checkEnv(){
  local badConf=""
  local leftWrap="{""{""{"
  local rigthWrap="}""}""}"
  local test1="net_env_ssid"
  local test2="net_env_passphrase"
  if [ "$leftWrap$test1$rigthWrap" = "$NET_ENV_SSID" ] || [ "" = "$NET_ENV_SSID" ]
  then
    badConf="$badConf NET_ENV_SSID not set\n"
  fi

  if [ "$leftWrap$test2$rigthWrap" = "$NET_ENV_PASSPHRASE" ]
  then
    badConf="$badConf NET_ENV_PASSPHRASE not set\n"
  fi

  if test ! "" = "$badConf"
  then
    echo -e "$badConf"
    exit
  fi
}

function setWpa(){

  if [ "" = "$NET_ENV_PASSPHRASE" ]
  then
    cat <<EOF > /etc/wpa_supplicant/wpa_supplicant.conf &
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
  ssid="$NET_ENV_SSID"
  key_mgmt=NONE
}

EOF
  else
    cat <<EOF > /etc/wpa_supplicant/wpa_supplicant.conf &
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
  ssid="$NET_ENV_SSID"
  psk=$NET_ENV_PASSPHRASE
  key_mgmt=WPA-PSK
}

EOF
  fi

}

checkEnv
setWpa
