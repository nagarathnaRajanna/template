'use strict';
var mongoose = require('mongoose');
var ParamController = require('./param.controller');
var _ = require('lodash');
var log4js = require('log4js');
log4js.levels.forName('AUDIT',50001);
var logger = process.env.PROD_ENV?log4js.getLogger('swagger-mongoose-crud'):log4js.getLogger('swagger-mongoose-crud-dev');   
var params = require('./swagger.params.map');
var uniqueValidator = require('mongoose-unique-validator');
/**
 * Constructor function for MongooseModel
 * @classdesc Basic mongoose Model sytem
 * Uses the definition passed on the by the Input object for creating crud operations
 * @constructor
 * @inherits ParamController
 * @param {Object} schema  - Schema for mongoose object.
 * @param {String} collection - Collection to which data needs to be populated.
 */

function MongooseModel(schema,collection,_logger) {
    this.schema = injectDefaults(schema); 
    logger = _logger?_logger:logger;
    schema.plugin(uniqueValidator);
    this.model = mongoose.model(collection, this.schema);
    ParamController.call(this, this.model, this.model.modelName,logger);
    this.index = this._index.bind(this);
    this.create = this._create.bind(this);
    this.show = this._show.bind(this);
    this.update = this._update.bind(this);
    this.destroy = this._destroy.bind(this);
    this.rucc = this._rucc.bind(this);
    this.count = this._count.bind(this);
    this.bulkUpdate = this._bulkUpdate.bind(this);
    this.bulkUpload = this._bulkUpload.bind(this);
    this.bulkShow = this._bulkShow.bind(this);
    this.markAsDeleted = this._markAsDeleted.bind(this);
    logger.trace('Initialised Mongoose Model');
}

MongooseModel.prototype = {
    constructor: MongooseModel,
    model: null,
    schema: null,
    definition: null,
    swagMapper: params.map
};
function injectDefaults(schema){
    schema.add( {createdAt : {
        type:Date,
        default:Date.now
    }});
    schema.add( {lastUpdated : {
        type:Date,
        default:Date.now
    }});
    schema.index({lastUpdated:1});
    schema.index({createdAt:1});
    schema.pre('save',function(next){this.lastUpdated = new Date();next();});
    schema.pre('update',function(next){this.lastUpdated = new Date();next();});
    return schema;
}
MongooseModel.prototype = _.create(ParamController.prototype,MongooseModel.prototype);
exports = module.exports = MongooseModel.bind(MongooseModel);
