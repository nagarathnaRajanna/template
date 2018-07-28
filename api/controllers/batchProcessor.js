/*globals  module , require , process*/
var crudder, logger, templateCrudder,
	    Mongoose = require("mongoose"),
	    _ = require("lodash"),
	    http = require("http"),
	    cuti = require("cuti"),
	    async = require("async"),
	    request = require("request"),
	    json2csv = require("json2csv"),
	    moment = require("moment"),
	    fs = require("fs"),
	    log4js = cuti.logger.getLogger,
	// log4js.configure("log4jsConfig.json",{});
	// logger = log4js.getLogger("template"),
	    host = process.env.REDIS_CON.split(":")[0],
	    port = process.env.REDIS_CON.split(":")[1],
	    RSMQWorker = require("rsmq-worker"),
	    worker = new RSMQWorker("templateRequests", {
		    autostart: true,
		    host: host,
		    port: port,
		    maxReceiveCount: 1,
		    interval: [0.2, 1, 3],
		    timeout: 0
	});
log4js.configure("log4jsConfig.json", {});
logger = log4js.getLogger("template");
var mailer = require("nodemailer"),
	    SHOULDSENDMAIL = true,
	    MAILCREDENTIALS = {
		    "USERNAME":/*"emailalerts@storeking.in"*/process.env.EMAILUSERNAME,
		    "PASSWORD":/*"storeking@123"*/process.env.EMAILPASSWORD
	};


function pushToQueue(data) {
	    return new Promise((resolve, reject) => {
		    worker.send(JSON.stringify(data), function (err, message) {
			    if (err) {
				    logger.error("LIENEXECUTOR:PUSHTOQUEUE:Error Occured while pushing the Data to Queue " + data._id);
				    reject(err);
			} else {
				    logger.info("LIENEXECUTOR:PUSHTOQUEUE:Data is pushed to Queue " + data._id);
				    resolve(message);
			}
		});
	});
}

worker.on("message", function (message, next, id) {
	    worker.size(false, (err, count) => logger.trace(`REDIS PENDING IN QUEUE : [${count}]`));
	    let data = JSON.parse(message);
	    processBatch(data._id).then(updatedBatchInfo => {
		    next();
	}).catch(err => {
		    logger.error(err);
		    next();
	});
});


function init(_crudder, _templateCrudder, _logger) {
	    crudder = _crudder,
		// logger = _logger;
		templateCrudder = _templateCrudder;
}

/**
 * This function will create the batch for the incoming Request
 * @param {*} data 
 */
function createBatch(data) {
	    return new Promise((resolve, reject) => {
		    crudder.model.create(data, function (err, doc) {
			    if (err) {
				    logger.error("BATCHPROCESSOR : CREATEBATCH : error Occured while Creating Batch ", err);
				    reject(err);
			} else {
				    logger.trace("BATCHPROCESSOR : CREATEBATCH : Batch Created Sucessfully ");
				    let data = { "_id": doc._id };
				    pushToQueue(data).then(() => {
					    resolve(doc);
				}).catch(err => {
					    reject(err);
				});

			}
		});
	});
}

/**
 * This function will process the batch 
 * @param {*} req 
 * @param {*} res 
 */
function processBatch(requestId) {
	/********STEP : 1 First Get the Record that Created Earlier which are in Pending and Partially Processed Status,and Number of Retried Count****************** */
	/********STEP : 2 get the Template Data************************************************************************************************************************/
	/********STEP :	3 Make API calls to the Configured Service and Process the Response and Update the Batch Status , Processed File and Details*****************   */
	    var condition = { "status": { "$in": ["PENDING", "PARTIALLYPROCESSED"] }, "retry": { "$gt": 0 }, "_id": Mongoose.Types.ObjectId(requestId) };
	    return new Promise((resolve, reject) => {
		    getBatch(condition).then(batch => {
			    if (_.isEmpty(batch[0])) {
				    logger.info("BATCHPROCESSOR :  PROCESSBATCH: No need to Process the Batch ");
				// res.status(200).send({ "message": "NO ACTIVE BATCH FOUND FOR PROCESSING" });
				    resolve({ "message": "NO ACTIVE BATCH FOUND FOR PROCESSING" });
			} else {
				    batch = batch[0];
				    fetchtemplateDetails(batch.templateCode).then(template => {
					    if (_.isEmpty(template)) {
						    logger.info("BATCHPROCESSOR :  PROCESSBATCH: No need to Process the Batch ");
						// res.status(400).send({ "message": "TEMPLATE NOT FOUND" });
						    resolve({ "message": "TEMPLATE NOT FOUND" });
					} else {
						    let processOnlyFailureRecords = false;
						    if (batch.retry > 0 && !_.isEmpty(batch.failureRecords)) {
							    processOnlyFailureRecords = true;
						}
						    processRecords(batch, template, processOnlyFailureRecords).then((updatedBatch) => {
							    if ((updatedBatch.retry == 0 || updatedBatch.status == "COMPLETED") && SHOULDSENDMAIL) {
								    let files = [];
								    updatedBatch.processedResultData.map(file => {
									    files.push(file.fileName);
								});
								    downloadAssetFiles(files).then((filed) => {
									    sendMail(updatedBatch, filed).then(() => {
										    resolve({ "message": "Batch is Processed SucessFully" });
									}).catch(err => {
										    resolve(err);
									});
								}).catch(err => {
									    reject(err);
								});
							} else {
								    resolve();
							}


						}).catch(err => {
							// res.status(400).send(err);
							    logger.warn(err);
							    resolve(err);
						});
					}
				}).catch(err => {
					    reject(err);
					// res.status(400).send(err);
				});
			}
		}).catch(err => {
			    logger.error("BATCHPROCESSOR : PROCESSBATCH : error Occured while Getting Batch ", err);
			// res.status(400).send(err);
			    reject(err);
		});
	});
}


function htmlContentForMail(processedInfo) {
	    let count = 0;
	    var html = "<h2><span style=\"text-decoration: underline; color: #333399;\">The status of Bulk Uploaded File Summary.</span></h2>";
	    processedInfo.map(processedRecord => {
		// count++;
		    html += count == 0 ? "<ol>" : "";
		    html += "<li><span style='color: #000000;'>File Name : " + processedRecord.fileName + "</span>";
		    html += "<ol>";
		    html += "<li><span style='color: #000000;'><span style='color: #00ff00;'>Sucess Records</span> :" + processedRecord.successRecords + "</span></li>";
		    html += "<li><span style='color: #000000;'><span style='color: #ff0000;'>Failure Records</span> : " + processedRecord.failureRecords + "</span></li>" + "</ol>";
		    html += count == 2 ? "</ol>" : "";
		    count++;

	});
	    return html;
}

function sendMail(batch, fileData) {
	    var html = htmlContentForMail(batch.processedResultData);
	    return new Promise((resolve, reject) => {
		    if (SHOULDSENDMAIL) {
			    var transporter = mailer.createTransport({
				        service: "gmail",
				        auth: {
					    user: MAILCREDENTIALS.USERNAME,
					    pass: MAILCREDENTIALS.PASSWORD
				}
			    }),
				    tomail = {
					    from: "StoreKing",
					    to: batch.email,
					    subject: "BULK UPLOADED REQUEST STATUS",
					    html: html,
					    attachments: fileData
				};
			    transporter.sendMail(tomail, function (err, info) {
				    if (err) {
					    resolve();
				}
				    else {
					    logger.info(info);
					    resolve();
				}

			});
		} else {
			    resolve();
		}
	});
}

function downloadAssetFiles(fileList) {
	    return Promise.all((fileList.map(file => {
		    return new Promise((resolve, reject) => {
			    getFileData(file).then((data) => {
				    let info = {
					    filename: file + ".csv",
					    content: data
				};
				    resolve(info);
			}).catch(err => {
				    reject(err);
			});
		});
	})));
}

function getFileData(fileId) {
	    return new Promise((resolve, reject) => {
		    cuti.request.getUrlandMagicKey("asset").then(options => {
			    options.path += "/" + fileId;
			    options.method = "GET";
			    let data = "";
			    request = http.request(options, function (response) {
				    response.on("data", function (chunk) {
					    data += chunk;
				});
				    response.on("end", () => {
					    if (response.statusCode >= 200 && response.statusCode < 299) {
						    resolve(data);
					} else {
						    reject(data);
					}
				});
			});
			    request.end();
			    request.on("error", function (err) {
				    reject(err);
			});
		}).catch(err => {
			    reject(err);
		});
	});

}



/**
 * This function will process all the Requests that present in the Batch 
 * @param {*} batch 
 * @param {*} templateInfo 
 * @param {*} req 
 */
function processRecords(batch, templateInfo, processOnlyFailureRecords) {
	    return new Promise((resolve, reject) => {
		    let count = 0;
		    var allRecords = [],
			    failureRecords = [],
			    successRecordCount = 0,
			    failureRecordCount = 0,
			    queue = async.queue(function (data, callback) {
				    logger.info("Processing----------------", count++);
				    processSingleRecord(data, templateInfo).then((record) => {
					    successRecordCount++;
					    data.STATUS = "SUCCESS";
					    data._id = record._id ? record._id : " ";
					    data.message = " ";
					    data.error = "";
					    allRecords.push(data);
					    callback(null);
				}).catch(err => {
					    if (_.isArray(err)) {
						    err = err[0];
					}

					    failureRecordCount++;
					    if (err.code == "ECONNRESET" || err.code == "ECONNREFUSED" || err.name) {
						    failureRecords.push(data);
						    var error = Object.assign({}, data);
						    error._id = data._id ? data._id : " ";
						    error.STATUS = "FAILURE";
						    error.message = " ";
						    error.error = err;
						    allRecords.push(error);
					} else {
						    data._id = data._id ? data._id : " ";
						    data.STATUS = "FAILURE";
						    data.message = " ";
						    data.error = err.message ? err.message : " ";
						    allRecords.push(data);
					}
					    callback(err);
				});
			}, 1),
			    processableData = processOnlyFailureRecords ? batch.failureRecords : batch.retry == 3 ? batch.processedJSONData : [];
		    if (_.isEmpty(processableData)) {
			    let setObject = { "$set": { "status": "COMPLETED", "retry": 0 } },
				    condition = { "_id": Mongoose.Types.ObjectId(batch._id) };
			    updateBatch(condition, setObject).then((updatedBatch) => {
				    resolve(updatedBatch);
				    return;
			}).catch(err => {
				    reject(err);
				    return;
			});
		} else {
			    queue.push(processableData, function (err, result) {
				    if (err) {
					    logger.warn("BATCHPROCESSOR CONTROLLER:PROCESSRECORDS:Error Occured while Executing record in the Queue ID  -" + err);
				}
			});
			    queue.drain = function () {
				//Here update the Batch with Proper status and File Name
				    var processedRecordStatus = {
					    "allRecords": allRecords,
					    "failureRecords": failureRecords,
					    "successRecordCount": successRecordCount,
					    "failureRecordCount": failureRecordCount
				};
				    updateBatchInfo(batch, templateInfo, processedRecordStatus).then((updatedBatch) => {

					    if (/*updatedBatch.retry > 0 &&*/ updatedBatch.status != "COMPLETED") {
						    let data = { "_id": updatedBatch._id };
						    pushToQueue(data);
					}
					    resolve(updatedBatch);
				}).catch(err => {
					    let data = { "_id": updateBatch._id };
					    pushToQueue(data);
					    reject(err);
				});

			};
		}
	});

}

/**
 * This function will process the single document 
 * @param {*} modelObjects 
 * @param {*} templateInfo 
 * @param {*} req 
 */
function processSingleRecord(modelObjects, templateInfo) {
	    return new Promise((resolve, reject) => {
		    cuti.request.getUrlandMagicKey(templateInfo.collectionName).then(options => {
			// options.headers["authorization"] = req.headers["authorization"] ? req.headers["authorization"] : "";
			    if (templateInfo.path || !_.isEmpty(templateInfo.path)) {
				    options.path += templateInfo.path;
			}
			    if (modelObjects._id) {
				    try {
					    options.path += "/" + (modelObjects._id).trim();
				}
				catch (e) {
					    options.path += "/" + (modelObjects._id);
				}
				    options.method = "PUT";

			} else {
				    options.method = "POST";
			}
			    let data = "",
				    request = http.request(options, function (response) {
					    response.on("data", function (chunk) {
						    data += chunk;
					});
					    response.on("end", () => {
						    if (response.statusCode >= 200 && response.statusCode < 299) {
							    try {
								    data = JSON.parse(data);
								    resolve(data);
							} catch (err) {
								    reject(err);
							}
						} else {
							console.log("data is --------",data);
							    if (data) {
								    try {
									    data = JSON.parse(data);
									    if (data.results) {
										    reject(data.results["errors"]);
									} else {
										    reject(data);
									}
								}
								catch (err) {
									    reject(data);
								}

							}
							    else {
								    reject({ "message": "EmptyResponse" });
							}
						}
					});
				});
			    request.on("error", function (err) {
				    reject(err);
			});
			    request.end(JSON.stringify(modelObjects));

		}).catch(err => {
			    reject(err);
		});
	});
}

function replaceKeyWithInputFileHeader(processedData, keyValSet) {
	    keyValSet.map(keyval => {
		    var RegEx = new RegExp(keyval.actualKey, "gi");
		    processedData = processedData.replace(RegEx, keyval.newKey);
	});
	    processedData = JSON.parse(processedData);
	    return processedData;
}

/**
 * this function will update the batch 
 * @param {*} batch 
 * @param {*} templateInfo 
 * @param {*} processedRecordStatus 
 */
function updateBatchInfo(batch, templateInfo, processedRecordStatus) {
	    return new Promise((resolve, reject) => {
		    var header = [];
		    var keyName = [];
		    templateInfo.fieldDefinition.map(fieldDefinition => {
			    let key = {};
			    key["newKey"] = fieldDefinition.name;
			    key["actualKey"] = fieldDefinition.column;
			    keyName.push(key);
			    header.push(fieldDefinition.name);
		});
		    header.push("STATUS");
		    header.push("message");
		    header.push("error");
		    header.push("_id");

		    processedRecordStatus.allRecords = replaceKeyWithInputFileHeader(JSON.stringify(processedRecordStatus.allRecords), keyName);
		    _.merge(processedRecordStatus.allRecords, batch.inputFileData);
		    csvFileCreation(processedRecordStatus.allRecords, header, templateInfo).then((uploadedFileInfo) => {
			    var status = processedRecordStatus.failureRecordCount > 0 ? "PARTIALLYPROCESSED" : "COMPLETED",
				    processedResultData = {
					    "successRecords": processedRecordStatus.successRecordCount,
					    "failureRecords": processedRecordStatus.failureRecordCount,
					    "fileName": uploadedFileInfo._id ? uploadedFileInfo._id : " ",
					    "processedTime": Date.now()
				},
				    setObject = { "$set": { "failureRecords": processedRecordStatus.failureRecords, "outputFilePath": processedResultData.fileName, "status": status }, "$inc": { "retry": -1 }, "$addToSet": { "processedResultData": processedResultData } },
				    condition = { "_id": Mongoose.Types.ObjectId(batch._id) };
			    updateBatch(condition, setObject).then((updatedBatch) => {
				    resolve(updatedBatch);
			}).catch(err => {
				    reject(err);
			});
		}).catch(err => {
			    reject(err);
		});
	});
}

/**
 * Update the batch
 * @param {*} condition 
 * @param {*} setObject 
 */
function updateBatch(condition, setObject) {
	    return new Promise((resolve, reject) => {
		    crudder.model.findOneAndUpdate(condition, setObject, { new: true, upsert: true }, (err, doc) => {
			    if (err) {
				    logger.error("BATCHPROCESSOR: UPDATEBATCH:Error Occured while deleting the config " + err.message);
				    reject(err);
			} else {
				    logger.info("BATCHPROCESSOR: UPDATEBATCH: Batch updated Successfully");
				    resolve(doc);
			}
		});
	});
}

/**
 * This funciton will Claiming Asset
 * @param {*} responseAsset 
 */
function claimAsset(responseAsset) {
	    return new Promise((resolve, reject) => {
		    cuti.request.getUrlandMagicKey("asset").then(options => {
			    options.path = "/asset/v1/claim/" + "ImportDocuments";
			    options.method = "PUT";
			    options.headers = {
				    "content-type": "application/json"
			};
			    options.path += "?id=" + JSON.parse(responseAsset)._id;
			    http.request(options, res => {
				    res.statusCode == 200 ? resolve() : reject();
			}).end();
		});
	});
}

/**
 * This function will upload the processed file to the Asset
 * @param {*} filename 
 */
function UploadToAsset(_file) {
	    return new Promise((resolve, reject) => {
		    cuti.request.getUrlandMagicKey("asset").then(options => {
			    var downloadPath = options;
			    options.path += "/upload?type=doc";
			    options.method = "POST";
			    if (!request.post) {
				    request = require("request");
			}
			    request.post({
				    url: "http://" + options.hostname + ":" + options.port + options.path,
				    formData: {
					    file: _file
				}
			},
				function functionCallback(err, response, body) {
					    if (err)
						    reject(err);
					    else {
						    claimAsset(body).then(() => {
							    resolve(body);
						});
					}
				}
			);
		}).catch(err => {
			    reject(err);
		});
	});
}

/**
 * This function will create the CSV File
 * @param {*} data 
 * @param {*} header 
 * @param {*} templateInfo 
 */
function csvFileCreation(data, header, templateInfo) {
	    return new Promise((resolve, reject) => {
		    json2csv({
			    data: data,
			    fields: header
		}, function (err, csv) {
			    if (err) {
				    reject(err);
			} else {
				    let fileInfo = {
					    value: csv.toString(),
					    options: {
						    filename: templateInfo.templateCode + "_" + moment(Date.now()).format("YYYY-MM-DD") + ".csv"
					}
				};
				    UploadToAsset(fileInfo).then(assetData => {
					    var fileDetails = JSON.parse(assetData);
					    resolve(fileDetails);
				}).catch((err) => {
					    reject(err);
				});

			}
		});
	});
}


/**
 * This function will gets the batch based on the condition
 * @param {*} condition 
 */
function getBatch(condition) {
	    logger.info("BATCHPROCESSOR:GETBATCH: Inside the getBatch method");
	    let sort = { "createdAt": -1 };
	    return new Promise((resolve, reject) => {
		    crudder.model.find(condition).sort(sort).limit(1).lean().exec().then((docs) => {
			    resolve(docs);
		}).catch(err => {
			    reject(err);
		});
	});
}

/**
 * This function will get the template Information
 * @param {*} templateId 
 */
function fetchtemplateDetails(templateId) {
	    logger.info("BATCHPROCESSOR: FETCHTEMPLATEDETAILS: Inside the fetchtemplateDetails method");
	    return new Promise((resolve, reject) => {
		    templateCrudder.model.findOne({ templateCode: templateId }, function (err, doc) {
			    if (err) {
				    reject(err);
			} else {
				    resolve(doc);
			}
		});
	});

}


/**
 * This function is to get all the Data based on the filter
 * @param {*} req 
 * @param {*} res 
 */
function index(req, res) {
	    logger.info("BATCHPROCESSOR:INDEXES: Inside the index method");
	    var sort = (req.swagger.params.sort.value) ? JSON.parse(req.swagger.params.sort.value) : {},
		    select = req.swagger.params.select.value || "",
		    filter = req.swagger.params.filter.value ? JSON.parse(req.swagger.params.filter.value) : {},
		    page = req.swagger.params.page.value || 1,
		    count = req.swagger.params.count.value || 10;

	    filter.deleted = false;
	    crudder.model.find(filter).sort(sort).skip((page - 1) * count).limit(count).select(select).lean().exec().then((docs) => {
		    res.status(200).send(docs);
	}).catch(err => {
		    res.status(200).send({ "message": err.message });
	});
}

/**
 * This method will give me all the status count based on the filter
 * @param {*} req 
 * @param {*} res 
 */
function count(req, res) {
	    logger.info("BATCHPROCESSOR:COUNT: Inside the count method");
	    var filter = req.swagger.params.filter.value ? JSON.parse(req.swagger.params.filter.value) : {};
	    filter.deleted = false;
	    crudder.model.find(filter).lean().exec().then((docs) => {
		    docs = _.countBy(docs, "status");
		    if (_.isEmpty(docs)) {
			    docs = {
				    "PENDING": 0,
				    "PROCESSING": 0,
				    "PARTIALLYPROCESSED": 0,
				    "COMPLETED": 0
			};
		}
		    docs.PENDING = docs.PENDING ? docs.PENDING : 0;
		    docs.PROCESSING = docs.PROCESSING ? docs.PROCESSING : 0;
		    docs.PARTIALLYPROCESSED = docs.PARTIALLYPROCESSED ? docs.PARTIALLYPROCESSED : 0;
		    docs.COMPLETED = docs.COMPLETED ? docs.COMPLETED : 0;
		    docs.TOTAL = docs.PENDING + docs.PROCESSING + docs.PARTIALLYPROCESSED + docs.COMPLETED;
		    res.status(200).send(docs);
	}).catch(err => {
		    res.status(200).send({ "message": err.message });
	});
}



/**
 * This method will give the document based on the ID
 * @param {*} req 
 * @param {*} res 
 */
function show(req, res) {
	    logger.info("BATCHPROCESSOR:SHOW: Inside the Show method");
	    var id = req.swagger.params.id.value;
	    id = Mongoose.Types.ObjectId(id);
	    crudder.model.findOne({ _id: id, deleted: false }, (err, doc) => {
		    if (err) {
			    res.status(400).send(err);
		} else {

			    res.status(200).send(doc);
		}
	});
}



module.exports = {
	    init: init,
	    show: show,
	    count: count,
	    index: index,
	    createBatch: createBatch,
	    processBatch: processBatch,
	    UploadToAsset: UploadToAsset
};

