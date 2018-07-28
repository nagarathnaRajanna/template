/*globals require,global, process, module */

var Mongoose = require("mongoose"),
    SMCrud = require("swagger-mongoose-crud"),
    url = process.env.MONGO_URL ? process.env.MONGO_URL : "mongodb://localhost/storeKing",
//http = require("http"),
    cuti = require("cuti"),
    puttu = require("puttu-redis"),
    definition = require("../helpers/templateDefinition").template,
    auditLogDefinition = require("../helpers/bulkUploadAuditLog").auditLog,
    templateController = require("./templateController"),
    parserController = require("./parseController"),
    downloadController = require("./downloadController"),
    log4js = cuti.logger.getLogger,
//lodash = require("lodash"),
    logger = log4js.getLogger("template"),
    collection = "templates",
    batchDefinition = require("../helpers/batch.definition.js").definition,
    schema = new Mongoose.Schema(definition),
    batchSchema = new Mongoose.Schema(batchDefinition),
    batchController = require("./batchProcessor.js");
schema.index({ templateName:1}, { unique: true, sparse:1});
schema.index({templateCode:1}, { unique: true, sparse:1});
var crudder = new SMCrud(schema, collection, logger),
    batchCrudder = new SMCrud(batchSchema, "batchTemplateRequest", logger),
    auditLogSchema=new Mongoose.Schema(auditLogDefinition),
    auditLogCrudder=new SMCrud(auditLogSchema, "bulkuploadaudits", logger);
logger.trace("Connecting to DB : " + url);
Mongoose.Promise = global.Promise;
Mongoose.connect(url);
puttu.connect();
templateController.init(crudder, logger);
parserController.init(crudder, auditLogCrudder, logger);
downloadController.init(logger, cuti, crudder, auditLogCrudder);
batchController.init(batchCrudder, crudder, logger);

schema.pre("save", function(next) {
    logger.info("ID generation");
    if (!this._id) {
        cuti.counter.getCount("TemplateId", null, (err, doc) => {
            this._id = "TE" + doc.next;
            next();
        });    
    } else {
        next();
    }
});

module.exports = {
    v1_templateCreate: templateController.templateCreate,
    v1_fetchTemplate: crudder.index,
    v1_templateDelete: templateController.templateDelete,
    v1_getTemplateById: templateController.templatebyId,
    v1_updateTemplate: templateController.updateTemplate,
    v1_fileParse: parserController.parse,
    v1_download: downloadController.download,
    v1_reportdownload:downloadController.reportdownload,
    v1_count: crudder.count,
    v1_queryTest:downloadController.queryTest,
    v1_auditLogs:auditLogCrudder.index,
    v1_auditLogCount:auditLogCrudder.count,
    v1_batchList : batchController.index,
    v1_batchShow : batchController.show,
    v1_batchCount : batchController.count,
    v1_batchProcess : batchController.processBatch
};