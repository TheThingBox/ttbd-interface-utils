const exec = require('ttbd-exec');
const mustache = require('mustache');
const path = require('path')
const fs = require('fs')

module.exports = function (params) {
    return new Interfaces(params);
};

var Interfaces = function(params) {
  if (!(this instanceof Interfaces)){
    return new Interfaces(params)
  }
  this.exec_opt = {hydra_exec_host: "mosquitto"}
  if(params){
    this.exec_opt =  Object.assign(this.exec_opt, params)
  }
  this.exec_bash_opt = Object.assign({}, this.exec_opt, {type: "bash"})
  this.iw = require('ttbd-iwlist')('wlan0', this.exec_opt);
}

Interfaces.prototype.scanWiFi = function(){
  return new Promise( (resolve, reject) => {
    this._scanWiFi().then(data => {
      resolve(data)
    }).catch( err => {
      return this._scanWiFi()
    }).then(data => {
      resolve(data)
    }).catch( err => {
      return this._scanWiFi()
    }).then(data => {
      resolve(data)
    }).catch( err => {
      resolve(Interfaces.emptyWifiList)
    })
  })
}

Interfaces.prototype._scanWiFi = function(){
  return new Promise( (resolve, reject) => {
    this.iw.scan(function(err, networks){
      if(err){
        reject(err)
      } else {
        wifilist = networks.filter(function(e){
          return (e.essid)?true:false;
        }).filter((thing, index, self) => {
          return index === self.findIndex((t) => t.essid === thing.essid)
        });
        resolve({
          wifilist: {
            secured: wifilist.filter(function(d){return d.encrypted}),
            open: wifilist.filter(function(d){return !d.encrypted})
          }
        })
      }
    })
  })
}

Interfaces.prototype.setWiFi = function(params){
  return new Promise( (resolve, reject) => {
    console.log(params)
    var script_set_wifi = Interfaces.getIntefacesScript('set_dhcp', { interface: 'wlan0' })
    var script_set_ssid = Interfaces.getIntefacesScript('set_wpa_supplicant', { ssid: params.ssid, passphrase: params.password || ''})
    exec({file: script_set_ssid}, this.exec_bash_opt, (err, stdout, stderr) => {
      if(err){
        reject(err)
        return
      }
      exec({file: script_set_wifi}, this.exec_bash_opt, (err2, stdout2, stderr2) => {
        if(err2){
          reject(err2)
          return
        }
        resolve()
      });
    });
  })
}

Interfaces.prototype.enableAcessPointOnWlan = function(ssid_id = 'ap'){
  return new Promise( (resolve, reject) => {
    var _interfaces
    this.getInterfaces()
    .then(interfaces => {
      if(!interfaces || !interfaces.hasOwnProperty('wlan0')){
        throw new Error('wlan0 interface is missing')
      }
      _interfaces = interfaces
      return this.getIPs()
    }).then(ips =>{
      if(ips.length === 0){
        this.setAccessPoint(ssid_id).then( () => {
          setTimeout( () => {
            this.setAccessPoint(false)
          }, 60000)
          resolve(true)
        })
      } else if (ips.indexOf('192.168.61.1') !== -1){
        if(ips.length > 1){
          this.setAccessPoint(false).then( () => {
            resolve(false)
            this.rebootDevice()
          })
        } else if(ips.length === 1){
          setTimeout( () => {
            this.setAccessPoint(false)
          }, 60000)
          resolve(false)
        } else {
          resolve(false)
        }
      } else {
        resolve(false)
      }
    }).catch(err =>{
      reject(err)
    })
  })
}

Interfaces.prototype.rebootDevice = function(){
  exec('reboot', this.exec_opt, function(err, stdout, stderr){
    if(err){
      console.log('reboot');
      console.log(err);
      console.log(stdout);
      console.log(stderr);
    }
  });
}

Interfaces.prototype.setAccessPoint = function(ssid){
  return new Promise( (resolve, reject) => {
    const _enable = ssid!==false
    const _mode = (_enable===true)?'enable_ap':'disable_ap'
    exec({file: Interfaces.getIntefacesScript(_mode, { ssid_id: ssid })}, this.exec_bash_opt, function(err, stdout, stderr){
      if(err){
        reject(err)
      } else {
        resolve(stdout)
      }
    })
  })
}

Interfaces.prototype.accessPointIsEnable = function(){
  return new Promise( (resolve, reject) => {
    exec("sed -n '/TTB START DEFINITION ACCESS_POINT/=' /etc/dhcpcd.conf", this.exec_opt, function(err, stdout, stderr){
      var res = false
      if(stdout && stdout.trim() !== ''){
        res = true
      }
      resolve(res)
    });
  })
}

Interfaces.prototype.getIPs = function(){
  return new Promise( (resolve, reject) => {
    var ips = [];
    exec('hostname -I', this.exec_opt, function(err, stdout, stderr){
      if(stdout || stdout === ''){
        stdout = stdout.replace(/\n/g, ' ').trim()
        ips = stdout.split(' ').filter(e => !e.startsWith('169.254') && !e.startsWith('172.17') && !e.startsWith('172.18') && e !== '127.0.0.1')
      }
      resolve(ips)
    })
  })
}

Interfaces.prototype.getInterfaces = function(){
  return new Promise( (resolve, reject) => {
    exec('ip link show', this.exec_opt, function(err, stdout, stderr){
      if(err){
        reject(err)
        return
      }
      var interfaces = stdout.split('\n')
      interfaces = interfaces.filter(e => e && !e.startsWith(' '))
      var result = {}

      for(var i in interfaces){
        let netInterface = interfaces[i].replace(/\s\s+/g, ' ').split(' ')
        let interfaceName = netInterface[1].slice(0, -1)
        result[interfaceName] = {
          state: Interfaces.ipLinkShowParseParam(netInterface, 'state'),
          mode: Interfaces.ipLinkShowParseParam(netInterface, 'mode'),
          mtu: Interfaces.ipLinkShowParseParam(netInterface, 'mtu'),
          group: Interfaces.ipLinkShowParseParam(netInterface, 'group'),
          qdisc: Interfaces.ipLinkShowParseParam(netInterface, 'qdisc'),
          qlen: Interfaces.ipLinkShowParseParam(netInterface, 'qlen')
        }
      }
      resolve(result)
    })
  })
}

Interfaces.getIntefacesScript = function(mode, options = {}){
  var sc = {
    enable_ap: {
      file: 'set_access_point.sh',
      mustache: {
        ssid_id: options.ssid_id
      }
    },
    disable_ap: {
      file: 'unset_access_point.sh',
      mustache: {}
    },
    set_dhcp: {
      file: 'set_dhcp.sh',
      mustache: {
        net_env_interface: options.interface
      }
    },
    set_wpa_supplicant: {
      file: 'set_wpa_supplicant.sh',
      mustache: {
        net_env_ssid: options.ssid,
        net_env_passphrase: options.passphrase
      }
    }
  }
  if(sc.hasOwnProperty(mode)){
    let script_path = path.join(__dirname, 'node_modules', 'ttbd-node-interfaces', 'scripts', sc[mode].file)
    if(fs.existsSync(script_path) === false){
        return null
    }
    return mustache.render(fs.readFileSync(script_path, {encoding: 'utf8'}), sc[mode].mustache)
  } else {
    return null
  }
}

Interfaces.ipLinkShowParseParam = function(line, key){
  let paramIndex = line.indexOf(key)
  if(paramIndex !== -1 && paramIndex < line.length-1){
    return line[paramIndex+1]
  } else {
    return undefined
  }
}

Interfaces.emptyWifiList = { wifilist: { secured: [], open: [] } }
