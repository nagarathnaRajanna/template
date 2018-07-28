/*globals  module , require*/
var _ = require("lodash"),
    cuti = require("cuti"),
    http = require("http"),
    _crudder = null,
    logger = null,
    auditLogCrudder = null,
    dot = require("dot-object"),
    moment = require("moment"),
    batchController = require("./batchProcessor.js");

function init(crudder, auditCrudder, _logger) {
    _crudder = crudder;
    auditLogCrudder = auditCrudder;
    logger = _logger;
}

function convertingTojson(filedata) {
    var re = /\n(?=[^"]*"(?:[^"]*"[^"]*")*[^"]*$)/g,
        subst = "",
        filedata = filedata.replace(re, subst),
        rowdata = filedata.split("\n"),
        objects = _.map(rowdata, function (item) {
            var str = [];
            item.split(/,(?![^"]*"(?:(?:[^"]*"){2})*[^"]*$)/).map(el => {
                el = el.replace(/"/g, "");
                el = el.replace(/\r/g, "");
                el = typeof el === "string" ? el.trim() : el;
                str.push(el);
            });
            return str;
        });
    var headers = objects[0];
    objects.splice(0, 1); // remove the header line
    var populatedObject = [];
    objects.forEach(function (item) {
        if (item != null) {
            if (checkForEmptyRow(item) != headers.length || checkForEmptyRow(item) == 0 || checkForEmptyRow(item) != 1) {
                var obj = _.zipObject(headers, item);
                populatedObject.push(obj);
            }
        }
    });
    var jsonModelObject = populatedObject.splice(0, populatedObject.length - 1); //to remove the last line from the csv object
    return jsonModelObject;
}

function checkForEmptyRow(row) {
    var count = 0;
    row.map(el => {
        if (_.isEmpty(el)) {
            count++;
        }
    });
    return count;
}

function fetchtemplateDetails(templateId) {
    return new Promise((resolve, reject) => {
        _crudder.model.findOne({
            // _id: templateId
            //initially we triying to fetch Template Data by templateId but we changed the requirement to fetch only from template code.we are mainting templateCode as Unique
            templateCode: templateId
        }, function (err, doc) {
            if (err) {
                reject(err);
            } else {
                resolve(doc);
            }

        });
    });
}

function assignValues(templateInfo, modeldata) {
    var preparedJSON = [];
    var deinitions = templateInfo["fieldDefinition"];
    Object.keys(modeldata).map(key => {
        modeldata[key].map((data, index) => {
            var newObject = {};
            deinitions.map(definition => {
                if (!_.isEmpty(data[definition.name]) && (data[definition.name] != "" || data[definition.name] != " ")) {
                    let column = definition.column;
                    column = column.replace("[n]", `.${index}`);
                    newObject[column] = data[definition.name];
                    newObject[column] = dataTypeConversion(definition.type, data[definition.name]);
                }
            });
            preparedJSON.push(dot.object(newObject));
        });
    });
    return preparedJSON;
}

function convertToNumberData(data) {
    if (!_.isEmpty(data)) {
        if (!_.isNaN(parseFloat(data)))
            return parseFloat(data);
    }
    return data;
}

var convertToBooleanData = (data) => {
    if (!_.isEmpty(data)) {
        switch (data.toLowerCase()) {
        case "true":
            return Boolean(true);
        case "false":
            return Boolean(false);
        }
    }
    return data;
};

var convertToDateData = (data) => {
    if (!_.isEmpty(data)) {
        let date = new Date(data);
        return moment(date).format();
    }
    return data;
};

function dataTypeConversion(type, data) {
    switch (type.toLowerCase()) {
    case "number":
        data = convertToNumberData(data);
        break;
    case "boolean":
        data = convertToBooleanData(data);
        break;
    case "date":
        data = convertToDateData(data);
        break;
    default:
        break;
    }
    return data;
}

function getEmployeeEmail(userInfo) {
    return new Promise((resolve, reject) => {
        return cuti.request.getUrlandMagicKey("employee")
            .then(options => {
                options.path += "/" + (userInfo.refId ? userInfo.refId : userInfo.employee ? userInfo.employee : "");
                // options.path += "?select='contact_details.office_email_id'";
                options.method = "GET";
                var data = "";
                var reqst = http.request(options, function (response) {
                    response.on("data", function (chunk) {
                        data += chunk;
                    });
                    response.on("end", () => {
                        if (response.statusCode >= 200 && response.statusCode < 299) {
                            try {
                                data = JSON.parse(data);
                                data = data.contact_details && data.contact_details.office_email_id ? data.contact_details.office_email_id : "techalerts@storeking.in";
                                resolve(data);
                            } catch (error) {
                                resolve("techalerts@storeking.in");
                            }
                        } else {
                            resolve("techalerts@storeking.in");
                        }
                    });
                });
                reqst.end();
                reqst.on("error", function (err) {
                    resolve("techalerts@storeking.in");
                });
            }).catch(err => {
                resolve("techalerts@storeking.in");
            });
    });
}


function parse(req, res) {
    var params = _crudder.swagMapper(req);
    var data = params.file.buffer.toString();
    let templateId = params["templateId"];
    let auditLog = {};
    let originalFile = {
        value: req.files.file[0].buffer,
        options: {
            filename: req.files.file[0].originalname
        }
    };
    auditLog.templateId = templateId;
    auditLog.createdAt = Date.now();
    auditLog.createdBy = req.user ? req.user.username : " ";
    fetchtemplateDetails(params["templateId"])
        .then(templateInfo => {
            batchController.UploadToAsset(originalFile).then((uploadedFileInfo) => {
                if (typeof uploadedFileInfo == "string") {
                    uploadedFileInfo = JSON.parse(uploadedFileInfo);
                }

                if (!_.isEmpty(templateInfo)) {
                    auditLog.templateName = templateInfo.templateName;
                    var _groupingFileds = groupingFileds(templateInfo);
                    if (templateInfo.inputType == "csv") {
                        var returnedjson = convertingTojson(data);
                        if (returnedjson.length > 0) {
                            var _groupedData = groupByFields(returnedjson, _groupingFileds);
                            if (returnedjson.length > 0) {
                                var preparedJSON = assignValues(templateInfo, _groupedData);
                                //if output type is JSON then directly Send it No need to Process that
                                if(templateInfo.outputType=="json"){
                                    res.status(200).send(preparedJSON);
                                }else{
                                    getEmployeeEmail(req.user).then(email => {
                                    //Here Create Batch Instead of Directly Processing
                                        let batch = {};
                                        batch.templateName = templateInfo.name;
                                        batch.templateId = templateInfo._id;
                                        batch.templateCode = templateInfo.templateCode;
                                        batch.inputFileData = dot.object(returnedjson);
                                        batch.processedJSONData = dot.object(preparedJSON);
                                        batch.status = "PENDING";
                                        batch.email = email;
                                        batch.createdBy = req.user && req.user._id ? req.user._id : "";
                                        batch.inputFilePath = uploadedFileInfo._id ? uploadedFileInfo._id : "";
                                        batchController.createBatch(batch).then(createdBatch => {
                                            logger.info("Batch is Created Successfully");
                                            res.status(200).send(createdBatch);
                                        }).catch(err => {
                                            logger.error("Error Occured Whilr Creating the Batch", err);
                                            res.status(400).send({ message: err });
                                        });
                                    }).catch(err => {
                                        logger.error("Error Occured Whilr getting the EMAIL", err);
                                        res.status(400).send({ message: err });
                                    });
                                }
                            }
                            else {
                                res.status(400).send({ "message": "The File is Empty,Enter some Valid Data" });
                            }
                        } else {
                            res.status(400).send({ "message": "The File is Empty,Enter some Valid Data" });
                        }
                    }
                    else if (templateInfo.inputType == "json") {
                        res.status(400).send({ message: "Template Input Type is Invalid" });
                    } else {
                        res.status(400).send({ message: "Template Input Type is Invalid" });
                    }
                }
                else {
                    res.status(400).send({ message: "Template Not Found" });
                }
            }).catch(err => { res.status(400).send(err); });
        })
        .catch(err => {
            res.status(400).send(err);
        });
}

var groupingFileds = (templateInfo) => {
    var groupFields = [];
    templateInfo.fieldDefinition.map(el => {
        if (el.isGrouped)
            groupFields.push(el.name);
    });
    return groupFields;
};

function groupByFields(formattedData, _groupingFileds) {
    var groupedData = _.groupBy(formattedData, function (item) {
        return obsKeysToString(item, _groupingFileds, "-");
    });
    return groupedData;
}

function obsKeysToString(o, k, sep) {
    return k.map(key => _.get(o, key)).filter(v => v).join(sep);
}

module.exports = {
    parse: parse,
    init: init
};