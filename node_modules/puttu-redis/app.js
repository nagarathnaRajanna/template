var redis = require('redis'),
    os = require('os'),
    assert = require('assert')

var client = null
var basePath = null

function getIPAddress(interface) {
    // 1. first check env variable PUTTU_PORT - process.env.PUTTU_INT
    // 2. then check the interface
    // 3. NOne of the above, fall back to eth0
    if (!process.env.PUTTU_IP) {
        if (interface) {
            //console.log(os.networkInterfaces()[interface][0].address)
            return os.networkInterfaces()[interface][0].address
        } else {
            //console.log(os.networkInterfaces()["eth0"][0].address)
            return os.networkInterfaces()['eth0'][0].address
        }
    } else {
        //console.log(os.networkInterfaces()[process.env.PUTTU_INT][0].address)
        return process.env.PUTTU_IP
    }
}

function connect() {
    if (process.env.REDIS_CON)
        client = redis.createClient(process.env.REDIS_CON.split(":")[1], process.env.REDIS_CON.split(":")[0])
    else client = redis.createClient()

    client.on("error", function (err) {
        console.log('Redis Disconnected, stopping service')
        process.exit(0)
    })
}

function addToRedis(_path, _data) {
    try {

        client.ttl("set_" + _path, (e, r) => {
            if (e) {
                console.log(e);
                process.exit(0);
            }
            if (r == -2 || r == -1) {
                setMagicKey(_path).then(() => {
                    client.sadd("set_" + _path , _data);
                    client.pexpire("set_" + _path , 2000)
                });
            }
            setTimeout(function () {
                addToRedis(_path, _data)
            }, 500)
        });
    } catch (e) {
        console.log(e);
    }
}

function setMagicKey(_key) {
    return new Promise((res, rej) => {
        client.hget("magicwords", _key, (_e, _d) => {
            if (_e) rej(_e)
            if (!_d) {
                client.hset("magicwords", _key, new Date().toISOString(), (_e, _d) => {
                    if (_e) rej(_e)
                    res()
                })
            } else res()
        })
    });
}

function getMagicKey(_key) {
    return new Promise((res, resj) => {
        client.hget("magicwords", _key, (_e, _d) => {
            if (_e) rej(_e)
            res(_d)
        })
    });
}

function register(_path, _data, _interface) {
    return new Promise((resolve, reject) => {
        if (!_path) reject('Missing config path.')
        if (!_data) reject('Missing config value')

        var data = _data.protocol.toLowerCase() + '://' + getIPAddress(_interface) + ':' + _data.port + _data.api
        addToRedis(_path, data)
    })
}

function get(_path) {
    var redisSet = "set_" + _path
    return new Promise((resolve, reject) => {
        client.srandmember(redisSet, (_e, _d) => {
            if (_e || !_d) {
                reject(_e)
            }
            resolve(_d)
        })
    })
}

var counter = 1;

function log(s) {
    console.log(counter + " " + s);
    counter += 1;
}


exports.connect = connect
exports.register = register
exports.get = get
exports.getMagicKey = getMagicKey