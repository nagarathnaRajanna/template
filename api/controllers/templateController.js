var http = require("http");
var _ = require("lodash");
var cuti = require("cuti");
var fs = require("fs");
var json2csv = require("json2csv");
var _crudder = null;
var request = require("request");
var logger = null;
function init(crudder, logger) {
    _crudder = crudder;
    logger = logger;
}
function customizer(objValue, srcValue) {
    if (_.isArray(objValue))
        return (objValue);
}

var updateModel = (templateId, templlateModel) => {
    return new Promise((res, rej) => {
        var _header = header(templlateModel);
        let sampleData=prepareSampleData(templlateModel);
        csvFileCreation(sampleData, _header, templlateModel.collectionName)
            .then((resobj) => {
                templlateModel.sampleFilePath = resobj.downloadLink;
                _crudder.model.findOneAndUpdate({ _id: templateId }, templlateModel, { new: true, upsert: true, setDefaultsOnInsert: true }, function (error, result) {
                    if (error) {
                        rej(error);
                    }
                    else {
                        res(result);
                    }
                });
            });
    });
};

function groupedFields(templateInfo){
    var groupFields=[];
    templateInfo.fieldDefinition.map(definition=>{
        if(definition.isGrouped){
            groupFields.push(definition.name);
        }
    });
    return groupFields;
}

function prepareSampleData(templateInfo){
    let sampleData=[];
    let row ={};
    let groupedFiledList=groupedFields(templateInfo);
    templateInfo.fieldDefinition.map(definition=>{
        if(_.includes(definition.column, "[n]")){
            if(sampleData.length==0){
                let firstRow={};
                firstRow[definition.name]=definition.sampleValue+"_1";
                let secondRow={};
                secondRow[definition.name]=definition.sampleValue+"_2";
                sampleData.push(firstRow);
                sampleData.push(secondRow);
            }else{
                sampleData.map((row,index)=>{
                    row[definition.name]=definition.sampleValue+"_"+(index+1);
                });
                groupedFiledList.map(field=>{
                    sampleData[1]={};
                    sampleData[1][field]=sampleData[0][field];
                    sampleData[1][definition.name]=definition.sampleValue+"_"+2;
                });
            }
        }else{
            if(sampleData.length==0){
                row[definition.name]=definition.sampleValue;
                sampleData.push(row);
            }else{
                sampleData.map(row=>{
                    row[definition.name]=definition.sampleValue;
                });
            }
        }
    });
    return sampleData;
}

var getTemplateById = (templateCode) => {
    return new Promise((resob, rej) => {
        _crudder.model.findOne({ templateCode: templateCode }, function (err, doc) {
            if (err) {
                rej(err);
            }
            else if (doc == null) {
                rej({ err: "Document Not Found" });
            }
            else {
                resob(doc);
            }
        });
    });
};

var Delete = (templateId) => {
    return new Promise((res, rej) => {
        _crudder.model.remove({ _id: templateId }, function (err) {
            if (err)
                rej(err);
            else
                res();
        });
    });
};
var getAllTemplates = () => {
    return new Promise((res, rej) => {
        _crudder.model.find({}, function (err, doc) {
            if (err)
                rej(err);
            else
                res(doc);
        });
    });
};
var createTemplate = (data) => {
    return new Promise((response, rej) => {
        _crudder.model.create(data, function (err, res) {
            if (err) {
                logger.error(err);
                rej(err);
            }
            else {
                response(res);

            }
        });

    });

};
var validate = (data) => {
    return new Promise((res, rej) => {
        Object.keys(data).map(el => {
            if (_.isArray(data[el])) {
                for (var i = 0; i < data[el].length - 1; i++) {
                    for (var j = i + 1; j < data[el].length - 1; j++) {
                        if ((data[el][i].name).toLowerCase() == (data[el][j].name).toLowerCase()) {
                            rej("Field Definition Object contains the same name");
                        }
                    }

                }
            }
        });
        res();
    });
};

function templateCreate(req, response) {
    var params = _crudder.swagMapper(req);
    var templateData = params["data"];
    var _headers = header(templateData);
    templateData.createdBy = req.user.username;
    templateData.createdAt = Date.now();
    response.set("Content-Type", "application/json");
    validate(params["data"]).then(()=>{
        var sampleData=prepareSampleData(templateData);
        csvFileCreation(sampleData, _headers, templateData.collectionName)
        .then(path=>{
            templateData.sampleFilePath = path.downloadLink;
            createTemplate(templateData)
                .then(res => {
                    response.set("Content-Type", "application/json");
                    response.status(201).send(res);
                })
                .catch(err => {
                    response.status(400).send({ "error": err.toString() });
                });
        }).catch(err=>{
            response.status(400).send({ "error":err});
        });
    }).catch(err=>{
        response.status(400).send({ "message": err });
    });
}

function fetchTemplate(req, res) {
    getAllTemplates()
        .then(obj => {
            res.set("Content-Type", "application/json");
            res.status(200).send(obj);
        });
}

function templateDelete(req, res) {
    var params = _crudder.swagMapper(req);
    Delete(params["id"])
        .then(() => {
            res.set("Content-Type", "application/json");
            res.status(200).send({ message: "Template is Deleted" });
        })
        .catch((err) => {
            res.set("Content-Type", "application/json");
            res.status(400).send(err);
        });

}

function templatebyId(req, res) {
    var params = _crudder.swagMapper(req);
    getTemplateById(params["id"])
        .then(responseobj => {
            res.set("Content-Type", "application/json");
            res.status(200).send(responseobj);
        })
        .catch(err => {
            res.set("Content-Type", "application/json");
            res.status(400).json(err);
        });
}

function updateTemplate(req, res) {
    var params = _crudder.swagMapper(req);
    updateModel(params["id"], params["data"])
        .then(obj => {
            res.set("Content-Type", "application/json");
            res.status(200).send(obj);
        })
        .catch(err => {
            res.set("Content-Type", "application/json");
            res.status(400).send(err);
        });

}

var header = (_data) => {
    var _header = [];
    _data.fieldDefinition.map(el => {
        _header.push(el.name);
    });
    return _header;
};

var csvFileCreation = (_data, header, templatename) => {
    return new Promise((resolve, reject) => {
        json2csv({
            data: _data,
            fields: header
        }, function (err, csv) {
            if (err) {
                throw err;
            } else {
                obj = {};
                var dir = "temp";
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir);
                }

                file = templatename + "_" + Date.now() + ".csv";
                var desPath = dir + "/" + file;
                fs.writeFile(desPath, csv, function (err) {
                    if (err)
                        throw err;
                    else {
                        UploadToAsset(desPath).then(assetData => {
                            var data = JSON.parse(assetData);
                            obj.filename = data.originalName;
                            cuti.request.getUrlandMagicKey("asset")
                                .then(options => {
                                    options.path += "/" + data._id;
                                    obj.downloadLink = data._id;
                                    resolve(obj);
                                });
                        }).catch((err) => {
                            reject(err);
                        });
                        // resolve(obj);
                    }
                });

            }
        });
    });
};

var claimAsset = (responseAsset) => {
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
};

var UploadToAsset = (filename) => {
    return new Promise((resolve, reject) => {
        cuti.request.getUrlandMagicKey("asset").then(options => {
            var downloadPath = options;
            options.path += "/upload?type=doc";
            options.method = "POST";
            request.post({
                url: "http://" + options.hostname + ":" + options.port + options.path,
                formData: {
                    file: fs.createReadStream(filename)
                }
            },
                function functionCallback(err, response, body) {
                    if (err)
                        reject(err);
                    else {
                        claimAsset(body).then(() => {
                            fs.unlink(filename, function (err, success) { });
                        });
                        body.downloadPath = downloadPath;
                        resolve(body);
                    }
                }
            );
        });
    });
};


module.exports={
    init : init,
    templateCreate : templateCreate,
    fetchTemplate : fetchTemplate,
    templateDelete : templateDelete,
    templatebyId : templatebyId,
    updateTemplate : updateTemplate
};
