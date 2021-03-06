const { execFile } = require('child_process');
const path = require('path')
const fs = require('fs')
const crypto = require('crypto');
const mqtt = require('mqtt');
const uuid = require('uuid/v4');
const mustache = require('mustache');
const axios = require('axios');
const checkInternetConnected = require('check-internet-connected');
const Locker = require('async-lock')

var ConcurrentFifo = function(){
  this.id = uuid()
  this.fifo = []
  this.locker = new Locker()
}

ConcurrentFifo.prototype.get = function(){
  return new Promise( (resolve, reject) => {
    this.locker.acquire(this.id, () =>{
      return this.fifo.shift()
    })
    .then( (data) => {
      resolve(data || null)
    })
  })
}

ConcurrentFifo.prototype.add = function(data){
  return new Promise( (resolve, reject) => {
    this.locker.acquire(this.id, () =>{
      this.fifo.push(data)
    })
    .then(() => {
      resolve()
    })
  })
}

var ZOIB = function(interfaces, options = {}) {
  this.server = options.server || 'https://zoib.digitalairways.com:443'
  this.token0 = new ConcurrentFifo()
  this.tokens = new ConcurrentFifo()
  this._login = options.login || null
  this._password = options.password || null
  this.challenge = null
  if(options.token){
    token0.add(options.tokens)
  }
  this.interfaces = interfaces
}

ZOIB.prototype.reachable = function(options = {}){
  return new Promise( (resolve, reject) => {
    var _config = {}
    _config.domain = this.server
    _config.timeout = options.timeout || 10000
    _config.retries = options.retries || 2
    if(options && options.servers){
      _config.servers = options.servers
    }
    checkInternetConnected(_config)
    .then(result => {
      if(result && Array.isArray(result) && result.length > 0){
        resolve(true)
      } else {
        resolve(false)
      }
    })
    .catch(err => {
      resolve(false)
    })
  })
}

ZOIB.prototype.setAccount = function(login, password){
  this._login = login
  this._password = password
}

ZOIB.prototype.getChallenge = function() {
  return new Promise( (resolve, reject) => {
    axios.get(`${this.server}/challenge`, { params: { login: this._login } })
    .then( resp => {
      if(resp.data && resp.data.challenge) {
        const hash = crypto.createHash('sha512')
        hash.update(`${resp.data.challenge}-${this._login}-${this._password}`)
        resolve(hash.digest('hex').toUpperCase())
      } else {
        reject('cannot get a ZOIB challenge')
      }
    })
    .catch(reject)
  })
};

ZOIB.prototype.login = function() {
  return new Promise( (resolve, reject) => {
    this.getChallenge()
    .then(challenge => {
      axios.post(`${this.server}/login`, { login: this._login, challenge: challenge }, { headers: { 'Content-Type' : 'application/json; charset=utf-8' } })
      .then(resp => {
        if(resp.data && resp.data.message.toLowerCase() === "ok" && resp.data.token && resp.data.user){
          resolve({token: resp.data.token, user: resp.data.user})
        } else {
          resolve(null)
        }
      })
      .catch(reject)
    })
    .catch(reject)
  })
};

ZOIB.prototype.fork = function(token = null){
  return new Promise( (resolve, reject) => {
    var _getTokenPromise
    var fromOrigin = false
    if(token === null){
      fromOrigin = true
      _getTokenPromise = this.token0.get()
    } else {
      _getTokenPromise = new Promise((r) => {r(token)})
    }
    _getTokenPromise
    .then(_token => {
      if(_token){
        axios.post(`${this.server}/fork`, { token: _token }, { headers: { 'Content-Type' : 'application/json' } })
        .then((resp) => {
          var data = resp.data
          if(data && data.message.toUpperCase() === "OK" && Array.isArray(data.tokens) && data.tokens.length >= 2) {
            resolve(data.tokens)
          } else {
            reject()
          }
        })
        .catch(reject)
      } else {
        reject()
      }
    })
  })
}

ZOIB.prototype.getToken = function(){
  return new Promise((resolve, reject) => {
    this.tokens.get()
    .then(token => {
      if(token){
        this.fork(token)
        .then(tokens => {
          this.tokens.add(tokens[0])
          .then(() => {
            resolve(tokens[1])
          })
        })
        .catch(reject)
      } else {
        this.fork()
        .then(tokens => {
          this.token0.add(tokens[0])
          .then(() => {
            resolve(tokens[1])
          })
        })
        .catch(e => {
          this.login().then(data => {
            this.fork(data.token)
            .then(tokens => {
              this.token0.add(tokens[0])
              .then(() => {
                resolve(tokens[1])
              })
            })
            .catch(reject)
          })
        })
      }
    })
  })
}

var Coldfacts = function(interfaces, options = {}){
  this.server = options.server || 'http://mythingbox.io:80'

  this.interfaces = interfaces
}

Coldfacts.prototype.reachable = function(options = {}){
  return new Promise( (resolve, reject) => {
    var _config = {}
    _config.domain = this.server
    _config.timeout = options.timeout || 10000
    _config.retries = options.retries || 2
    if(options && options.servers){
      _config.servers = options.servers
    }
    checkInternetConnected(_config)
    .then(result => {
      if(result && Array.isArray(result) && result.length > 0){
        resolve(true)
      } else {
        resolve(false)
      }
    })
    .catch(err => {
      resolve(false)
    })
  })
}

var Interfaces = function(params = {}) {
  this.ttb_crypto = {
    bin: path.join(__dirname, 'bin', 'ttb-crypto'),
    algo: 'aes-256-gcm',
    options:  {
      encoding: 'utf8',
      timeout: 0,
      maxBuffer: 200 * 1024,
      killSignal: 'SIGTERM',
      cwd: null,
      env: null,
      uid: 0,
      gid: 0
    },
    private_key: path.join('/root/certs', params.private_key || 'my-ttb.key.pem'),
    public_key: path.join('/root/certs', params.public_key || 'my-ttb.pub'),
    server_key: path.join('/root/certs', params.server_key || 'serv.pub')
  }

  this.hydra_exec = {
    host: params.hydra_exec_host || 'mosquitto',
    port: params.hydra_exec_port || 1883,
    base_topic: params.hydra_exec_base_topic || 'hydra_exec'
  }

  var zoibOptions = {
    server: params.zoib_server,
    login:  params.zoib_login,
    password:  params.zoib_password,
    token: params.zoib_token
  }

  var coldfactsOptions = {
    server: params.coldfacts_server
  }

  this.ZOIB = new ZOIB(this, zoibOptions)
  this.Coldfacts = new Coldfacts(this, coldfactsOptions)
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

    this.hostExec(`iwlist wlan0 scan`)
    .then( stdout => {
      var ap = []
      var current = null;
      var regex_address = /^\s+Cell \d+ - Address: (\S+)/
      var regex_essid = /^\s+ESSID:"(.+)"/
      var regex_encrypted = /^\s+Encryption key:(.+)/
      var regex_signal = /Signal level=(.+?)\//

      var lines = stdout.split('\n')
      for(var index in lines){
        var m;
        if (m = regex_address.exec(lines[index])) {
            current = { address : m[1] };
            ap.push(current);
            continue;
        }
        if (!current){
          continue
        };

        if (m = regex_essid.exec(lines[index])) {
            current.essid = m[1];
        }
        if (m = regex_encrypted.exec(lines[index])) {
            current.encrypted = m[1] !== 'off';
        }
        if (m = regex_signal.exec(lines[index])) {
          current.signal = +m[1]
        }
      }

      var wifilist = ap.sort((a, b) => {
        if(a.signal < b.signal){
          return 1;
        }
        if(a.signal > b.signal){
          return -1;
        }
        return 0;
      }).filter(function(e){
        return (e.essid)?true:false;
      }).filter((thing, index, self) => {
        return index === self.findIndex((t) => t.essid === thing.essid)
      })

      resolve({
        wifilist: {
          secured: wifilist.filter(function(d){return d.encrypted}),
          open: wifilist.filter(function(d){return !d.encrypted})
        }
      })
    })
    .catch( error => {
      reject(error)
    })
  })
}

Interfaces.prototype.setWiFi = function(params){
  return new Promise( (resolve, reject) => {
    var script_set_ssid
    var script_set_wifi
    try {
      script_set_ssid = Interfaces.getIntefacesScript('set_wpa_supplicant', { ssid: params.ssid, passphrase: params.password || ''})
      script_set_wifi = Interfaces.getIntefacesScript('set_dhcp', { interface: 'wlan0' })
    }catch(e){
      reject(e)
    }

    this.hostExec(script_set_ssid, 'bash')
    .then( stdout => {
      return this.hostExec(script_set_wifi, 'bash')
    })
    .then( stdout => {
      resolve()
    })
    .catch( error => {
      reject(error)
    })
  })
}

Interfaces.prototype.enableAcessPointOnWlan = function(ssid_id = 'ap'){
  return new Promise( (resolve, reject) => {
    var _interfaces
    this.getInterfaces()
    .then(interfaces => {
      if(!interfaces || interfaces.findIndex(item => item.name === 'wlan0') == -1){
        throw new Error('wlan0 interface is missing')
      }
      _interfaces = interfaces
      return this.getIPs()
    }).then(ips =>{
      if(ips.length === 0){
        this.setAccessPoint(ssid_id).then( () => {
          setTimeout( () => {
            this.setAccessPoint(false)
          }, 1200000)
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
          }, 1200000)
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

Interfaces.prototype.localCipher = function(plaintext){
  payload = JSON.stringify(plaintext).replace(/"/g, '\"')
  var cmdEncrypt = ['-action=encrypt', `-algo=${this.ttb_crypto.algo}`, `-private_key=${this.ttb_crypto.private_key}`, `-public_key=${this.ttb_crypto.public_key}`, `-text=${payload}`]
  return new Promise( (resolve, reject) => {
    execFile(this.ttb_crypto.bin, cmdEncrypt, this.ttb_crypto.options, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else if(!stdout && stderr){
        reject(stderr)
      } else {
        resolve(stdout)
      }
    })
  })
}

Interfaces.prototype.localDecipher = function(ciphertext){
  var cmdDecrypt = ['-action=decrypt', `-algo=${this.ttb_crypto.algo}`, `-private_key=${this.ttb_crypto.private_key}`, `-public_key=${this.ttb_crypto.public_key}`, `-text=${ciphertext}`]
  return new Promise( (resolve, reject) => {
    execFile(this.ttb_crypto.bin, cmdDecrypt, this.ttb_crypto.options, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else if(!stdout && stderr){
        reject(stderr)
      } else {
        resolve(stdout)
      }
    })
  })
}

Interfaces.prototype.hostExec = function(command, type = 'cmd'){
  return new Promise( (resolve, reject) => {
    var payload = {}

    if(type === 'cmd'){
      payload.cmd = command
    } else if(type === 'bash') {
      payload.file = command
    } else {
      reject(`Unsupported command type: ${type}`)
      return
    }

    this.localCipher(payload)
    .then( ciphertext => {
      var client = mqtt.connect(`mqtt://${this.hydra_exec.host}:${this.hydra_exec.port}`)
      var id = uuid()
      var keyname = this.ttb_crypto.public_key.split('/')
      keyname = keyname[keyname.length-1]
      client.on('connect', () => {
        client.subscribe(`${this.hydra_exec.base_topic}/out`)
        client.publish(`${this.hydra_exec.base_topic}/in`, JSON.stringify({
          id,
          type: type,
          keyname: keyname,
          payload: ciphertext
        }))
      })

      client.on('message', (topic, message) => {
        try{
          message = JSON.parse(message.toString())
        } catch(e) {
          message = {}
        }
        if(message.id && message.id === id){
          client.end()
          if(message.error){
            reject(message.error)
          } else {
            this.localDecipher(message.payload)
            .then( plaintext => {
              try{
                plaintext = JSON.parse(plaintext)
              } catch(e){}
              if(plaintext.stderr){
                plaintext.stderr = plaintext.stderr.split('\n').filter(e => e && e.indexOf(' warning: command substitution: ignored null byte in input') === -1).join('\n')
              }

              if(plaintext.error){
                reject(plaintext.error)
              } else if(!plaintext.stdout && plaintext.stderr){
                reject(plaintext.stderr)
              } else {
                resolve(plaintext.stdout)
              }
            })
            .catch( err => {
              reject(err)
            })
          }
        }
      })
    })
    .catch( err => {
      reject(err)
    })
  })
}

Interfaces.prototype.rebootDevice = function(){
  this.hostExec('reboot').catch(console.log)
}

Interfaces.prototype.restartNodered = function(){
  this.hostExec('docker restart thethingbox').catch(console.log)
}

Interfaces.prototype.shutdownDevice = function(){
  this.hostExec('poweroff').catch(console.log)
}

Interfaces.prototype.setAccessPoint = function(ssid){
  return new Promise( (resolve, reject) => {
    const _enable = ssid!==false
    const _mode = (_enable===true)?'enable_ap':'disable_ap'
    this.hostExec(Interfaces.getIntefacesScript(_mode, { ssid_id: ssid }), 'bash')
    .then( stdout => {
      resolve(stdout)
    })
    .catch( error => {
      reject(error)
    })
  })
}

Interfaces.prototype.accessPointIsEnable = function(){
  return new Promise( (resolve, reject) => {
    this.hostExec("sed -n '/TTB START DEFINITION ACCESS_POINT/=' /etc/dhcpcd.conf")
    .then( stdout => {
      var res = false
      if(stdout && stdout.trim() !== ''){
        res = true
      }
      resolve(res)
    })
    .catch( error => {
      resolve(false)
    })
  })
}

Interfaces.prototype.getIPs = function(ip_filtre){
  return new Promise( (resolve, reject) => {
    var ips = [];
    var _ip_filtre = ip_filtre || [
      '169.254',
      '172.17',
      '172.18',
      '127.0.0.1'
    ]
    this.hostExec('hostname -I')
    .then( stdout => {
      if(stdout || stdout === ''){
        stdout = stdout.replace(/\n/g, ' ').trim()
        ips = stdout.split(' ').filter(e => _ip_filtre.filter(f => e.startsWith(f)).length === 0 )
      }
      resolve(ips)
    })
    .catch( error => {
      reject(error)
    })
  })
}

Interfaces.prototype.getInterfaces = function(){
  return new Promise( (resolve, reject) => {
    this.hostExec('ip link show')
    .then( stdout => {
      var interfaces = stdout
      .split('\n')
      .filter(item => item && !item.startsWith(' '))
      .map(item => {
        let netInterface = item.replace(/\s\s+/g, ' ').split(' ')
        if(netInterface.length < 2){
          return null
        }
        let interfaceName = netInterface[1].slice(0, -1)
        return {
          name: interfaceName,
          state: Interfaces.ipLinkShowParseParam(netInterface, 'state'),
          mode: Interfaces.ipLinkShowParseParam(netInterface, 'mode'),
          mtu: Interfaces.ipLinkShowParseParam(netInterface, 'mtu'),
          group: Interfaces.ipLinkShowParseParam(netInterface, 'group'),
          qdisc: Interfaces.ipLinkShowParseParam(netInterface, 'qdisc'),
          qlen: Interfaces.ipLinkShowParseParam(netInterface, 'qlen')
        }
      })
      .filter(item => item && item.name.indexOf('docker') !== 0 && item.name.indexOf('veth') && item.name.indexOf('br-'))

      resolve(interfaces)
    })
    .catch( error => {
      reject(error)
    })
  })
}

Interfaces.prototype.getHostname = function(){
  return new Promise( (resolve, reject) => {
    this.hostExec('cat /etc/hostname')
    .then( stdout => {
      resolve(Interfaces.formatHostname(stdout))
    })
    .catch( error => {
      reject(error)
    })
  })
}

Interfaces.prototype.setHostname = function(hostname){
  return new Promise( (resolve, reject) => {
    hostname = Interfaces.formatHostname(hostname)
    this.hostExec(`echo ${hostname} > /etc/hostname`)
    .then( stdout => {
      resolve(hostname)
    })
    .catch( error => {
      reject(error)
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
    let script_path = path.join(__dirname, 'scripts', sc[mode].file)
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

Interfaces.formatHostname = function(hostname){
  return hostname.replace(/[\r\n\t\f\v]/g, "").trim().replace(/[ ]+/g,"_")
}

Interfaces.emptyWifiList = { wifilist: { secured: [], open: [] } }

module.exports = Interfaces
