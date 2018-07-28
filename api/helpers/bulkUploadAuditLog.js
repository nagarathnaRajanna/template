
var auditLog = {
    templateId: {
        type: String
    },
    templateName:
    {
        type: String
    },
    createdAt: {
        type: Date
    },
    createdBy: {
        type: String
    },
    status:{
        type: String
    },
    downloadLink:{
        type:String
    },
    fileName:{
        type:String
    },
    inputJson:{
        type:String
    },
    deleted: {
        type: Boolean,
        default: false
    }
};

module.exports.auditLog = auditLog;