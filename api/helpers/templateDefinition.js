/*globals module*/

var template = {
    _id:
    {
        type: String,
        default: null
    },
    templateCode:
    {
        type: String
    },
    templateName:
    {
        type: String
    },
    templateDescription:
    {
        type: String
    },
    templateType: {
        type: String,
        enum: ["export", "import"],
        default: "import"
    },
    outputType:
    {
        type: String,
        enum: ["csv", "xml", "json", "xls"]
    },
    inputType:
    {
        type: String,
        enum: ["csv", "xml", "json", "xls"]
    },
    path: {
        type: String
    },
    collectionName:
    {
        type: String
    },
    createdBy: {
        type: String
    },
    createdAt: {
        type: Date
    },
    deleted: {
        type: Boolean,
        default: false
    },
    apiMethod:{
        type : String,
        enum : ["GET","PUT","POST","PATCH"],
        default : "PUT"
    },
    apiBodyStructure:{
        type : String,
        enum : ["OBJECT","ARRAYOFOBJECT"],//if its object means request Needs to be Processed one by one else it will send array of object
        default : "OBJECT"
    },
    fieldDefinition:
    [
        {
            name: {
                type: String
            },
            type: {
                type: String,
                enum: ["String", "Number", "Boolean", "Array", "Date", "DateTime"]
            },
            column: {
                type: String
            },
            min: {
                type: String
            },
            isPrimaryKey: {
                type: String
            },
            isGrouped: {
                type: Boolean,
                default: false
            },
            format:{
                type : String,
                default :"DD/MM/YYYY"
            },
            sampleValue:{
                type : String
            }
        }
    ],
    sampleFilePath: {
        type: String
    },
    fileSize: {
        type: Number
    }
};

module.exports.template = template;