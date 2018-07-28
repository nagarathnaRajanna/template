/*globals require, module */

var Mongoose = require("mongoose"),
    Schema = Mongoose.Schema,
    definition = {
        templateName: {
            type: String
        },
        templateId: {
            type: String
        },
        templateCode: {
            type: String
        },
        inputFileData: {
            type: Schema.Types.Mixed
        },
        processedJSONData: {
            type: Schema.Types.Mixed
        },
        email: {
            type: String
        },
        status: {
            type: String,
            enum: ["PENDING", "PROCESSING", "PARTIALLYPROCESSED", "COMPLETED"],
            default: "PENDING"
        },
        processedResultData: [{
            successRecords: {
                type: Number
            },
            failureRecords: {
                type: Number
            },
            fileName: {
                type: String
            },
            processedTime: {
                type: Date,
                default: Date.now
            }
        }],
        failureRecords: [{
            type: Schema.Types.Mixed
        }],
        createdAt: {
            type: Date,
            default: Date.now
        },
        lastUpdated: {
            type: Date,
            default: Date.now
        },
        modifiedBy: {
            type: String
        },
        createdBy: {
            type: String
        },
        deleted: {
            type: Boolean,
            default: false
        },
        retry: {
            type: Number,
            default: 3
        },
        inputFilePath: {
            type: String
        },
        outputFilePath: {
            type: String
        }
    };

module.exports = {
    definition: definition
};