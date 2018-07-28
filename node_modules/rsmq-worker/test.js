var RSMQWorker = require( "./" );
var RedisSMQ = require("rsmq");
var WORKERCOUNT = 12;

var rsmq = new RedisSMQ( {host: "127.0.0.1", port: 6379, ns: "rsmq"} );
rsmq.setMaxListeners(WORKERCOUNT)

// count the event listener per event
var countListener = function(){
	var _ret = {};
	for (var evnt in rsmq._events) {
		_ret[evnt] = rsmq._events[ evnt ].length;
	}
	return _ret
}
var workers=[];

console.log("Pre:", countListener() );

// wait a secont for rsmq connect
setTimeout( function(){
	
	console.log("Start:", countListener() );
	
	// generate workers
	for (var i=0; i<WORKERCOUNT; i++) {
	    var name="worker_"+i.toString();
	    workers.push(new RSMQWorker(name,{
	        rsmq:       rsmq,
	        autostart:  true,
	    }))
	}
	setTimeout( function(){
		console.log("Started all:", countListener() );
	}, 1000 )
	
	// stop some workers and check the event listeners
	setTimeout( function(){
		console.log("Stop ...");
		for (var j=0; j<WORKERCOUNT; j += 2) {
			workers[ j ].stop()
		}
		console.log("Stopped some", countListener() );
	}, 2000 );

	// restart the stopped workers
	setTimeout( function(){
		console.log("ReStart");
		for (var j=0; j<WORKERCOUNT; j += 2) {
			workers[ j ].start()
		}
		console.log("Restarted stopped:", countListener() );
	}, 3000 );
	
	// add more workers
	setTimeout( function(){
		console.log("Start more ... ");
		rsmq.setMaxListeners(WORKERCOUNT*2)
		for (var i=0; i<WORKERCOUNT; i++) {
		    var name="worker_"+i.toString();
		    workers.push(new RSMQWorker(name,{
		        rsmq:       rsmq,
		        autostart:  true,
		    }))
		}
		setTimeout( function(){
			console.log("Started more workers:", countListener() );
		}, 1000 )
	}, 4000 );
	
}, 1000 );
