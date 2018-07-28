var puttu = require('./app.js')

puttu.connect()

var master = "test"
puttu.register(master, {
    protocol: 'http',
    port: '10001',
    api: '/brand/v1'
}, null).then(
    () => {
        console.log('Registered self')
        puttu.get("set_" + master).then(
            d => console.log(d),
            e => console.log(e)
        );
        puttu.getMagicKey(master).then(
            d => console.log(d),
            e => console.log(e)
        )
    },
    e => console.log(e)
);