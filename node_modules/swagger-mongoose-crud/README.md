# swagger-mongoose-crud
[![Build Status](https://travis-ci.org/capiotsoftware/swagger-mongoose-crud.svg?branch=master)](https://travis-ci.org/capiotsoftware/swagger-mongoose-crud)

A Simple wrapper for Swagger based mongoose CRUD operation. This plugin is a modfied version of the Mongoose CRUD operation introducted by [Micheal Krone](https://github.com/michaelkrone,Github Profile).
This module exposes following basic operations.
* Create
* Update
* Read
* Delete
* Index (list)

## Installation
npm install https://github.com/capiotsoftware/swagger-mongoose-crud.git --save

## Usage 
```javascript
var Mongoose = require('Mongoose');
var SMCrud = require('swagger-mongoose-crud.git');
//In your controller, simply expose the following
var schema = new Mongoose.Schema({ 
    //Your mongoose Schema definition here.
});
var collection = "Your Collection Name";

var crud = new SMCrud(schema,collection);
var exports = {};

//Takes all parameters for creating an entry
exports.create = crud.create; 

//Takes parameter 'id' for searching in the DB, will update rest of the parameters.
exports.update = crud.update;

//Will list out the entire collection, No parameters
exports.index = crud.index;

//Will delete the entity, takes 'id'
exports.destroy = crud.destroy;

//Will show a single entity, takes 'id'
exports.show = crud.show;

//Will count the number of entries in the DB, Supports filter options.
exports.count = crud.count;

//crud.model will hold the Mongoose Model.
//crud.schema will hold the schema passed on at constructor
crud.select = [ 
    //list of the fields for the listing in Index call
];

crud.omit = [
    //list of the fields to disallow for Index search
];

module.exports = exports;
```

**Note : Still under active development, Not ready for primetime use**
