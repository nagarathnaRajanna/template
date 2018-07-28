"use strict";

var SwaggerExpress = require("swagger-express-mw");
var app = require("express")();
var bp = require("body-parser").json();
app.use(bp);
var config = require("config");
var cuti = require("cuti");
cuti.init("template");
var log4js = cuti.logger.getLogger;
var http=require('http');

var puttu = require("puttu-redis");
puttu.connect();

process.env.INTERFACE = "wlan0";
log4js.configure("log4jsConfig.json",{});
var logger = log4js.getLogger("template");
app.locals.logger = logger;

if (process.env.TEST_ENV) {
    app.locals.test = true;
    logger.warn("Detected Test environment, Cross service validations disabled");
} else {
    app.locals.test = false;
}
 // for testing
var counter = 0;
//app.get("*",cuti.validation.validationGet);
//app.post("*",cuti.validation.validationPost);
//app.put("*",cuti.validation.validationPut);
app.use(function(req,res,next){
    if(req.method == "OPTIONS") next();
    else if(req.headers["authorization"]){
        cuti.request.getUrlandMagicKey("user").then(options => {
            options.path = "/validateUser";
            options.headers = {
                "authorization":req.headers["authorization"],
                "content-type":"application/json"
            };
            http.request(options,response => {
                if(response.statusCode == 200){
                    var data = "";
                    response.on("data",_data => data += _data.toString("utf8"));
                    response.on("end",()=> {req.user = JSON.parse(data);next();});
                }
                else{
                    res.status(401).json("unauthorized");
                    next();
                }
            }).end();
        }).catch(()=>{
            next();
        });        
    }
    else{
        res.status(401).json("unauthorized");
    }
});
var logMiddleware = (req, res, next) => {
    var reqId = counter++;
    if (reqId == Number.MAX_VALUE) {
        reqId = counter = 0;
    }

    logger.info(reqId + " " + req.ip + " " +  req.method + " " + req.originalUrl);
    next();
    logger.trace(reqId + " Sending Response");
};
app.use(logMiddleware);

var Rconfig = {
    appRoot: __dirname // required config
};
var data = {};

SwaggerExpress.create(Rconfig, function(err, swaggerExpress) {
    if (err) { throw err; }
     // install middleware
    swaggerExpress.register(app);
    var port = process.env.PORT ||10049;
    app.listen(port,()=>{
        logger.trace("Template server started on port number "+port);
        data.port = port;
        data.protocol = "http";
        data.api = "/template/v1";
        console.log(data); 
        puttu.register("template",data,process.env.INTERFACE);
    });

});

module.exports = app;


