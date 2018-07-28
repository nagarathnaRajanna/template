var reportLog = {
    templateId:{
        type:String
    },
    templateName:
    {
        type: String
    },
    createdAt:{
        type: Date
    },
    userAssigned:
    {
        type:String
    },
    deleted:{
        type:Boolean,
        default:false
    }
}

module.exports.reportLog = reportLog;