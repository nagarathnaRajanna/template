/*globals require, module */
var http = require("http"),
	excel = require("excel4node"),
	fs = require("fs"),
	_ = require("lodash"),
	request = require("request"),
	logger,
	cuti,
	crudder;
var reportLogCrudder;
var _eval = require('eval');
var Parser = require('expr-eval').Parser;
var json2csv = require('json2csv');
var url = process.env.MONGO_URL ? process.env.MONGO_URL : "mongodb://localhost/storeKing";
var mongojs = require('mongojs');
var elasticsearch = require('elasticsearch');
// var es_url = process.env.ES_URL || "localhost:9200";
// var client = new elasticsearch.Client({
// 	host: "localhost:9200",
// 	log: "trace"
// });

function init(_logger, _cuti, _crudder, _reportLogcrudder) {
	logger = _logger,
		cuti = _cuti;
	crudder = _crudder;
	reportLogCrudder = _reportLogcrudder;
}

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

function uploadToAsset(filename) {
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
			}, function functionCallback(err, response, body) {
				if (err) {
					reject(err);
				} else {
					claimAsset(body).then(() => {
						fs.unlink(filename);
					});
					body.downloadPath = downloadPath;
					resolve(body);
				}
			});
		});
	});
}

function getLoanOrderDetails(templateInfo, docType, filter) {
	logger.trace("Fetching the Loan order details");
	return new Promise(function (resolve, reject) {
		cuti.request.getUrlandMagicKey("lender")
			.then(options => {
				try {
					filter = JSON.parse(filter);
					filter = JSON.stringify(filter);
				} catch (err) {
					reject({
						"message": "Error parsing the filter details"
					});
					return;
				}
				options.path += "?filter=" + filter;
				http.request(options, response => {
					if (response.statusCode !== 200) {
						logger.trace("Error fetching the Loan order details ", response.statusCode);
						reject({
							"message": "Error fetching the Loan order details"
						});
						return;
					}
					response.on("data", (_data) => {
						var loanOrders = "" + _data.toString(),
							fieldDefn = templateInfo.fieldDefinition || [],
							fields = [],
							workbook = new excel.Workbook(),
							worksheet = workbook.addWorksheet("Sheet 1"),
							style,
							i, j,
							dir = templateInfo.collectionName || "loanrecords",
							destPath,
							unit,
							info,
							col;
						// Throw error back if failed to parse abck to json
						try {
							loanOrders = JSON.parse(loanOrders);
						} catch (err) {
							reject({
								"message": "Error parsing the Loan order details"
							});
							return;
						}
						// Create the dir if it is not available
						if (!fs.existsSync(dir)) {
							fs.mkdirSync(dir);
						}
						// Style for Header
						style = workbook.createStyle({
							font: {
								color: "#FF0800",
								size: 14
							},
							numberFormat: "$#,##0.00; ($#,##0.00); -"
						});
						// Creating the Excel header
						for (i = 0; i < fieldDefn.length; i += 1) {
							fields.push(fieldDefn[i].column);
							worksheet.cell(1, i + 1).number(100).string(fieldDefn[i].name).style(style);
						}
						col = fields.length || 0;
						// Style for contents
						style = workbook.createStyle({
							font: {
								color: "#000000",
								size: 12
							},
							numberFormat: "$#,##0.00; ($#,##0.00); -"
						});
						// Updating the sheet with the Loan order details
						for (i = 0; i < loanOrders.length; i += 1) {
							unit = loanOrders[i];
							for (j = 0; j < col; j += 1) {
								info = _.get(unit, fields[j]) || "NA";
								info = info.toString();
								worksheet.cell(i + 2, j + 1).number(100).string(info).style(style);
							}
						}
						// Writing the file to Disk
						logger.trace("Writing the XLSX to disk");
						destPath = dir + "/" + templateInfo.collectionName + "_" + Date.now() + ".xlsx";
						workbook.write(destPath, function (err) {
							if (err) {
								reject({
									"message": "Error generating Excel file"
								});
								return;
							}
							uploadToAsset(destPath).then(assetData => {
								var data = JSON.parse(assetData),
									fileInfo = {};
								fileInfo.filename = data.originalName;
								cuti.request.getUrlandMagicKey("asset")
									.then(options => {
										options.path += "/" + data._id;
										fileInfo.downloadLink = "http://" + options.hostname + ":" + options.port + options.path;
										resolve(fileInfo);
									});
							}).catch(() => {
								reject();
							});
						});
					});
				}).on("error", () => {
					reject({
						"message": "Error fetching the Loan order details"
					});
				}).end();
			})
			.catch(error => {
				reject(error);
			});
	});
}

function findTemplate(templateId) {
	// Function to fetch the Template info by Id
	logger.trace("Getting the template ", templateId);
	return new Promise(function (resolve, reject) {
		crudder.model.findOne({
			"_id": templateId
		}).exec()
			.then(function (document) {
				resolve(document);
			})
			.catch(function (err) {
				reject(err);
			});
	});
}

function download(req, res) {
	var docType = req.swagger.params.type.value,
		templateId = req.swagger.params.templateId.value,
		filter = req.query.filter || {};

	findTemplate(templateId)
		.then(function (templateInfo) {
			if (templateInfo.collectionName === "loanrecords") {
				return getLoanOrderDetails(templateInfo, docType, filter);
			}
			res.status(400).json({
				"error": "bad request"
			});
		})
		.then(function (downloadInfo) {
			res.status(200).json(downloadInfo);
		})
		.catch(function (err) {
			res.status(400).json({
				"error": err.message
			});
		});
}

function reportdownload(req, res) {
	var templateId = req.swagger.params.templateId.value;
	// console.log("The data us==>", req.swagger.params.data.value["data"]);
	var _filter = req.swagger.params.data.value["data"];
	findTemplate(templateId)
		.then(templateInfo => {
			if (templateInfo) {
				if (templateInfo.templateType == "export") {
					reportLog = {};
					reportLog.userAssigned = req.user.username;
					reportLog.createdAt = Date.now();
					reportLog.templateId = templateId;
					saveReportLogs(reportLog)
						.then(reportLog => {
							// console.log("The filetrs are", _filter);
							var filter = fetchFiletrs(_filter);
							fetchDetailsFromCollection(templateInfo.collectionName, templateInfo.path, filter, templateInfo.limit)
								.then(_data => {
									var collectionData = JSON.parse(_data);

									var _groupingFileds = groupingFileds(templateInfo);
									var _header = header(templateInfo);
									// console.log("The headers are", _header);
									// console.log("The grouped Fields are==>", _groupingFileds);
									var opFields = operationFields(templateInfo);
									var _dynamicColums = dynamicColumn(templateInfo);
									//var _mappedData = mapData(templateInfo, collectionData);
									mapData(templateInfo, collectionData)
										.then(_mappedData => {
											//console.log("The datassssssssssss is===>", _mappedData);
											//var _projectFields=projectFields(templateInfo);
											var _formattedData = formatData(_mappedData, _header);
											//console.log("The datassssssssssss is===>", _formattedData);
											var _dynamicColAddedData = addDynamicColumns(_formattedData, _dynamicColums);
											// if (!_.isEmpty(opFields)) {
											// 	_formattedData = applyFormula(_dynamicColAddedData, opFields);
											// }
											// else {
											// 	_formattedData = _dynamicColAddedData;
											// }
											var convertedData = dataTypeConversion(templateInfo, _formattedData);
											var summary;
											if (!_.isEmpty(_groupingFileds)) {
												var _groupOperation = groupOperation(templateInfo);
												// console.log("the grouped Operation==>",_groupOperation);
												var _groupOperation = groupOperation(templateInfo);
												//console.log("The grouped Field Operation", _groupOperation);
												//var _groupedData = groupByFields(_mappedData, _groupingFileds);
												var _groupedData = groupByFields(convertedData, _groupingFileds);
												//console.log("The grouped Data is==>", _groupedData);
												summary = groupedDataSummary(_groupedData, templateInfo.fieldDefinition);
											} else {
												//summary = _mappedData;
												summary = convertedData;
											}
											var _dataSummary = [];
											if (templateInfo.limit) {
												//console.log("The templlate limit==>", templateInfo.limit)
												summary.map((el, index) => {
													if ((index) < templateInfo.limit) {
														_dataSummary.push(el);
													}
												})
											} else {
												//console.log("The limit isssssss")
												_dataSummary = summary;
											}
											csvFileCreation(_dataSummary, _header, templateInfo, _groupingFileds)
												.then(obj => {
													res.set('Content-Type', 'application/json');
													res.status(200).send(obj);
												})
										})

										.catch(err => {
											res.set('Content-Type', 'application/json');
											res.status(400).send(err);
										})
								})
						})
						.catch(err => {
							res.set('Content-Type', 'application/json');
							res.status(400).send(err);
						})
				} else {
					res.set('Content-Type', 'application/json');
					res.status(400).send({
						err: "This is not export type"
					});
				}
			} else {
				res.set('Content-Type', 'application/json');
				res.status(400).send({
					err: "Template is Not Found"
				});
			}
		})
		.catch(err => {
			res.set('Content-Type', 'application/json');
			res.status(400).send(err);
		})
}

var dataTypeConversion = (templateInfo, data) => {
	templateInfo.fieldDefinition.map(fields => {
		if (fields.type == "Date" || fields.type == "DateTime") {
			convertToDate(data, fields.name);
		}
	})
	return data;
}
var convertToDate = (data, columnName) => {
	data.map(_row => {
		var date = new Date(_row[columnName]);
		_row[columnName] = date.getDate() + '-' + (date.getMonth() + 1) + '-' + date.getFullYear();
	})
	return data;
}
var addDynamicColumns = (formattedData, dynamicColums) => {

	dynamicColums.map(el => {
		formattedData.map(row => {
			row[el.name] = el.value;
		})
	})
	return formattedData;
}

var dynamicColumn = (templateInfo) => {
	var dynamicFields = [];
	templateInfo.fieldDefinition.map(el => {
		operationField = {};
		if (!_.isEmpty(el.dynamicColumn) && el.dynamicColumn.isDynamicCol) {
			operationField.name = el.name;
			operationField.value = el.dynamicColumn.value;
			dynamicFields.push(operationField);
		}
	})
	return dynamicFields;

}

var formatData = (_mappedData, _header) => {
	//  console.log("The mapped length ===>", _mappedData.length);
	var rows = [];

	var Length;
	_mappedData.map(row => {
		var arrayElements = [];
		var arr = [];
		var elements = [];
		// console.log("The row is==>", row);
		// console.log("000000000000");
		_header.map(headfield => {
			if (_.isArray(row[headfield]) && row[headfield]) {
				arr.push(headfield);
				arrayElements = _.uniq(arr);
				Length = (row[headfield]).length;
			} else {
				elements.push(headfield);
			}
		})
		// console.log("The elements==", elements);

		var a = [];
		// console.log("The arryel==>", arrayElements);
		// console.log("The lenghtrrrrrrr==>", Length);
		// if(Length==0)
		// {
		//   var newrow = {};
		//   a.push(newrow);
		// }
		// else{
		while (Length > 0) {
			var newrow = {};
			a.push(newrow);
			Length--;
		}
		// }

		arrayElements.map(el => {
			// if(a.length>0)
			// {
			if (row[el]) {
				row[el].map((els, index) => {
					a[index][el] = els;
				})
			}
			// else{
			//  a[0][el]=row[el];
			// }
			// }
			//console.log("inside loop-->", a);
			// else{
			// 	a[0][el]=row[el];
			// }
		})
		var alength = a.length;
		if (a.length == 0) {
			a[0] = row;
		}
		a.map(el => {
			elements.map(els => {
				el[els] = row[els];
			})
		})
		// console.log("The final array is==>", a);
		a.map(_row => {
			rows.push(_row);
		})
	});
	if (rows.length > 0) {
		// console.log("TH E LENGTH IS")
		return rows;
	} else {
		// console.log("the objsssssss")
		return _mappedData;
	}
}

var saveReportLogs = (data) => {
	return new Promise((resolve, reject) => {
		reportLogCrudder.model.create(data, function (err, doc) {
			if (err)
				reject(err);
			else
				resolve(doc);
		})
	})
}

var groupByFields = (formattedData, _groupingFileds) => {
	var groupedData = _.groupBy(formattedData, function (item) {
		return obsKeysToString(item, _groupingFileds, '-')
	});
	return groupedData;
}

var foriegnKey = (templateInfo) => {
	var foriegnKey = [];
	templateInfo.fieldDefinition.map(el => {
		operation = {};
		if (el.isForeignKey) {
			operation.column = el.column;
			operation.name = el.name;
			operation.groupedFieldOperation = el.groupedFieldOperation;
			operation._collectionName = el._collectionName;
			foriegnKey.push(operation);
		}
	})
	return foriegnKey;
}

var groupOperation = (templateInfo) => {
	var groupFields = [];
	templateInfo.fieldDefinition.map(el => {
		operation = {};
		if (el.isGrouped) {
			operation.column = el.column;
			operation.name = el.name;
			operation.groupedFieldOperation = el.groupedFieldOperation;
			groupFields.push(operation);
		}
	})
	return groupFields;
}

var groupedDataSummary = (_groupedData, _operation) => {
	summary = [];
	Object.keys(_groupedData).forEach(function (key) {
		data = {};
		_operation.map(column => {
			switch (column.groupedFieldOperation) {
				case "sum":
					data = (sum(_groupedData[key], column.name));
					break;
				case "avg":
					data = (avg(_groupedData[key], column.name))
					break;
				case "min":
					data = (min(_groupedData[key], column.name))
					break;
				case "max":
					data = (max(_groupedData[key], column.name))
					break;
				case "count":
					data = (count(_groupedData[key], column.name))
					break;
				case "join":
					data = (join(_groupedData[key], column.name))
					break;
				case "distinct":
					data = (distinct(_groupedData[key], column.name))
					break;
				case "none":
					data = (none(_groupedData[key], [column.name]))
					break;
			}
		});
		//data = data[0];
		summary.push(data);
	});
	return summary;
}



var count = (_groupedData, columnName) => {
	var singleRow = _groupedData[0];
	singleRow[columnName] = _groupedData.length;
	return singleRow;
}

var none = (_groupedData, columnName) => {
	var singleRow = _groupedData[0];
	singleRow[columnName] = _groupedData[0][columnName];
	return singleRow;
}

var sum = (_groupedData, columnName) => {
	var singleRow = _groupedData[0];
	var sumTotal = 0;
	_groupedData.map(el => {
		sumTotal += parseFloat(el[columnName]);
	})
	singleRow[columnName] = sumTotal;
	// console.log("The sum Total is==>", singleRow[columnName]);
	return singleRow;
}

var avg = (_groupedData, columnName) => {
	var singleRow = _groupedData[0];
	var sumTotal = 0;
	_groupedData.map(el => {
		sumTotal += parseFloat(el[columnName]);
	})
	singleRow[columnName] = sumTotal / _groupedData.length;
	return singleRow;
}

var min = (_groupedData, columnName) => {
	var singleRow = _groupedData[0];
	var values = [];
	_groupedData.map(el => {
		values.push(parseFloat(el[columnName]));
	})
	singleRow[columnName] = _.min(values);
	return singleRow;
}

var max = (_groupedData, columnName) => {
	var singleRow = _groupedData[0];
	var values = [];
	_groupedData.map(el => {
		values.push(parseFloat(el[columnName]));
	})
	singleRow[columnName] = _.max(values);
	return singleRow;
}

var join = (_groupedData, columnName) => {
	var singleRow = _groupedData[0];
	var values = [];
	_groupedData.map(el => {
		values.push(el[columnName]);
	})
	singleRow[columnName] = _.join(values, '-');
	return singleRow;
}

var distinct = (_groupedData, columnName) => {
	var singleRow = _groupedData[0];
	var values = [];
	_groupedData.map(el => {
		values.push(parseFloat(el[columnName]));
	})
	singleRow[columnName] = _.uniq(values);
	return singleRow;
}

function obsKeysToString(o, k, sep) {
	//return k.map(key => o[key]).filter(v => v).join(sep);
	return k.map(key => _.get(o, key)).filter(v => v).join(sep);
}
var header = (templateInfo) => {
	headers = [];
	templateInfo.fieldDefinition.map(el => {
		headers.push(el.name);
	})
	return headers;
}
var csvFileCreation = (_formattedData, headers, templateInfo, _groupingFileds) => {
	// console.log("The formatted Dat is-->", _formattedData);
	return new Promise((resolve, reject) => {
		json2csv({
			data: _formattedData,
			fields: headers
		}, function (err, csv) {
			if (err)
				logger.error("The err is==>", err);
			else {
				obj = {};
				var dir = templateInfo.collectionName;
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir);
				}

				file = templateInfo.collectionName + "_" + Date.now() + ".csv";
				var desPath = dir + "/" + file;
				fs.writeFile(desPath, csv, function (err) {
					// console.log("The csv data is==>", csv);
					if (err)
						throw err;
					else {
						uploadToAsset(desPath).then(assetData => {
							var data = JSON.parse(assetData);
							obj.filename = data.originalName;
							cuti.request.getUrlandMagicKey("asset")
								.then(options => {
									options.path += '/' + data._id;
									obj.downloadLink = 'http://' + options.hostname + ':' + options.port + options.path;
									obj.downloadLink = options.path;
									obj.downloadLink = data._id;
									resolve(obj);
								})
						}).catch(() => {
							reject()
						})
						// resolve(obj);
					}
				});

			}
		});
	});
}
var applyFormula = (_mappedData, opFields) => {
	// console.log("The opfields==>",opFields);
	opFields.map(el => {
		// expr = Parser.parse('FuelCharge*2-field');
		// var variables=expr.variables();
		Object.keys(el).forEach(function (key) {
			expr = Parser.parse(el[key]);
			var variables = expr.variables();
			_mappedData.map(singleRow => {
				var v = {};
				var arrayRow = {};
				variables.map(variable => {
					v[variable] = singleRow[variable];
				})
				singleRow[key] = expr.evaluate(v);
			})

		})
	})
	return _mappedData;

}

var operationFields = (templateInfo) => {
	var operationFields = [];
	templateInfo.fieldDefinition.map(el => {
		operationField = {};
		if (!_.isEmpty(el.operation) && el.dynamicColumn.isDynamicCol) {
			operationField[el.name] = el.operation;
			//operationFields[el.alias] = el.alias;
			operationFields.push(operationField);
		}
	})
	return operationFields;
}
var groupingFileds = (templateInfo) => {
	var groupFields = [];
	templateInfo.fieldDefinition.map(el => {
		if (el.isGrouped && el.groupedFieldOperation === "none")
			groupFields.push(el.name);
	})
	return groupFields;
}

function fetchFiletrs(filter) {
	var filterArray = {};
	if (filter) {
		filter.map((el, index) => {
			if (el) {
				if (el.type == "DateRange" || el.type == "DateRangeTime") {
					filterArray[el.column] = {
						'$gte': new Date(el.from).toISOString(),
						'$lte': new Date(el.to).toISOString()
					}
				} else if (el.type == "Date") {
					var date = new Date(el.value).toISOString();
					filterArray[el.column] = {
						date
					}
				} else {
					filterArray[el.column] = el.value;
				}
			}
		});
	} else {
		filterArray = {};
	}
	return JSON.stringify(filterArray)
	//return (filterArray);
}

function mapData(templateInfo, collectionData) {
	return new Promise((resolve, reject) => {
		var bodyData = [];
		collectionData.map(_data => {
			var _row = {};
			templateInfo.fieldDefinition.map(fields => {
				//_row[fields.name] = _.get(_data, fields.column);
				if (_.isEmpty(fields.operation)) {
					if (fields.column)
						colValue = getColumnValue(_data, fields.column);

					if (colValue) {
						if (_.isArray(colValue)) {
							switch (fields.groupedFieldOperation) {
								case "sum":
									var sum = 0;
									colValue.map(el => {
										sum += el;
									})
									_row[fields.name] = sum;
									break;
								case "avg":
									var sum = 0;
									colValue.map(el => {
										sum += el;
									})
									_row[fields.name] = sum / colValue.length;
									break;
								case "min":
									_row[fields.name] = _.min(colValue);
									break;
								case "max":
									_row[fields.name] = _.max(colValue);
									break;
								case "distinct":
									_row[fields.name] = _.uniq(colValue);
									break;
								case "join":
									_row[fields.name] = _.join(colValue, '-');
									break;
								case "none":
									_row[fields.name] = colValue;
									break;
							}
						} else {
							_row[fields.name] = colValue;
						}
					} else {
						_row[fields.name] = colValue;
					}
				} else if (!_.isEmpty(fields.operation)) {
					var alias = fields.alias;
					var expr = Parser.parse(fields.operation);
					var variables = expr.variables();
					var val = [];
					alias.map(el => {
						var singleRowVal = {};
						if (el.value)
							var colValue = getColumnValue(_data, el.value);
						singleRowVal.value = colValue;
						if (_.isArray(colValue)) {
							singleRowVal.isArrayVal = true;
						} else {
							singleRowVal.isArrayVal = false;
						}
						singleRowVal.name = el.name;
						val.push(singleRowVal);

					});
					var length = val.length;
					var a = [];
					var grouped = _.groupBy(val, function (item) {
						if (item.isArrayVal)
							return item;
					})
					Object.keys(grouped).forEach(function (key) {
						if (key) {
							arrayObjects = grouped[key];
							var arrLength;
							arrayObjects.map(el => {
								arrLength = el.value.length;
							})
							while (arrLength > 0) {
								singleObject = {};
								a.push(singleObject);
								arrLength--;
							}

						} else {

						}
					})

					val.map(el => {
						if (el.isArrayVal) {
							el.value.map((individiual, index) => {
								a[index][el.name] = individiual;
								//els[el.name]=individiual;
							})
						} else {
							a.map(els => {
								els[el.name] = el.value;
							})
						}
					})
					var evaluatedArr = [];
					//console.log("aaaaaaaaaaaaaaa", a);
					a.map(el => {
						evaluatedArr.push(_.round(expr.evaluate(el), 3));
					});
					// var totalSum = 0;
					// evaluatedArr.map(el => {
					// 	totalSum += el;
					// })
					// _row[fields.name] = totalSum;
					_row[fields.name] = groupOperationResult(evaluatedArr, fields.groupedFieldOperation);
					//console.log("The row value is==>", _row[fields.name]);
				}
				// _data[fields.column];
			})
			bodyData.push(_row);
		});
		var _header = header(templateInfo);
		var data = formatData(bodyData, _header);
		var _foriegnKey = foriegnKey(templateInfo);

		//console.log("The key===>",_foriegnKey);
		if (_foriegnKey.length > 0) {
			fillDataForForiegnCol(_foriegnKey, data, templateInfo)
				.then(obj => {
					//console.log("The data is===>",obj);
					resolve(obj);
				})
		} else {
			resolve(bodyData);
		}
	});
	//return bodyData;
}


var fillDataForForiegnCol = (_foriegnKey, mappedData, templateInfo) => {
	var db = mongojs(url);
	var forienkeys = [];
	var distinctForienkeys = [];
	return new Promise((resolve, reject) => {
		_foriegnKey.map(el => {
			mycollection = db.collection(el._collectionName);
			// console.log("THe collection name is", mycollection);
			mappedData.map(row => {
				if (_.isArray(row[el.name])) {
					row[el.name].map(el => {
						forienkeys.push(el);
					})
				} else {
					forienkeys.push(row[el.name]);
				}
			});
			var _secCol = secondaryCol(templateInfo);
			//console.log("sec", _secCol);
			distinctForienkeys = _.uniq(forienkeys);
			// console.log("distinct keys are==>", distinctForienkeys);

			fetchData(mycollection, distinctForienkeys)
				.then(docs => {
					var data = _formRow(docs, mappedData, _secCol, el.name);
					resolve(data);
				});
		});
	});
}

var _formRow = (docs, mappedData, templateInfo, name) => {
	// console.log("THe heads==>", templateInfo);
	var _mappedData = [];

	var data = _.groupBy(mappedData, function (item) {
		return item[name];
	})

	docs.map(row => {
		similarIdData = _.filter(mappedData, function (item) {
			return item[name] == row._id;
		});

		templateInfo.map(head => {
			//console.log("The operation",)
			if (!_.isEmpty(head.operation)) {
				var alias = head.alias;
				var expr = Parser.parse(head.operation);
				var variables = expr.variables();
				var val = [];
				alias.map(el => {
					var singleRowVal = {};
					if (el.value)
						var colValue = getColumnValue(row, el.value);
					singleRowVal.value = colValue;
					if (_.isArray(colValue)) {
						singleRowVal.isArrayVal = true;
					} else {
						singleRowVal.isArrayVal = false;
					}
					singleRowVal.name = el.name;
					val.push(singleRowVal);

				});
				var length = val.length;
				var a = [];
				var grouped = _.groupBy(val, function (item) {
					if (item.isArrayVal)
						return item;
				})
				Object.keys(grouped).forEach(function (key) {
					if (key) {
						arrayObjects = grouped[key];
						var arrLength;
						arrayObjects.map(el => {
							arrLength = el.value.length;
						})
						while (arrLength > 0) {
							singleObject = {};
							a.push(singleObject);
							arrLength--;
						}

					} else {

					}
				})

				val.map(el => {
					if (el.isArrayVal) {
						el.value.map((individiual, index) => {
							a[index][el.name] = individiual;
							//els[el.name]=individiual;
						})
					} else {
						a.map(els => {
							els[el.name] = el.value;
						})
					}
				})
				var evaluatedArr = [];
				//console.log("aaaaaaaaaaaaaaa", a);
				a.map(el => {
					evaluatedArr.push(_.round(expr.evaluate(el), 3));
				});
				similarIdData.map(_eachRow => {
					_eachRow[head.name] = groupOperationResult(evaluatedArr, head.groupedFieldOperation);
					_mappedData.push(_eachRow);
				});

			} else {

				similarIdData.map(_eachRow => {
					colValue = getColumnValue(row, head.column);
					//console.log("The colvalue is==>", colValue);
					_eachRow[head.name] = colValue;
					_mappedData.push(_eachRow);
				});

			}
		})
	})
	return mappedData;
}


var secondaryCol = (templateInfo) => {
	var secondaryCols = [];
	templateInfo.fieldDefinition.map(el => {
		operations = {};
		if (el.isSecondaryCol) {
			operations.column = el.column;
			operations.name = el.name;
			operations.groupedFieldOperation = el.groupedFieldOperation;
			operations._collectionName = el._collectionName;
			operations.operation = el.operation;
			operations.alias = el.alias;
			secondaryCols.push(operations);
		}
	})
	return secondaryCols;
}

var fetchData = (collection, ids) => {
	return new Promise((resolve, reject) => {
		mycollection.find({
			_id: {
				$in: ids
			}
		}, function (err, doc) {
			if (doc) {
				resolve(doc);
			} else
				reject();
		})
	})
}

var groupOperationResult = (arr, operation) => {
	var _data = 0;
	switch (operation) {

		case "sum":
			var sumTotal = 0;
			arr.map(el => {
				sumTotal += el;
			})
			_data = sumTotal;
			break;
		case "avg":
			var sum = 0;
			arr.map(el => {
				sum += el;
			})
			_data = sum / arr.length;
			break;
		case "min":
			_data = _.min(arr);
			break;
		case "max":
			_data = _.max(arr);
			break;
		case "distinct":
			_data = _.uniq(arr);
			break;
		case "join":
			_data = _.join(arr, '-');
			break;
		case "none":
			_data = arr;
			break;
	}
	return _data;
}

var getColumnValue = (_data, column) => {
	var operation = column.groupedFieldOperation;
	var splittedColumnValue = _.split(column, ".");

	var v;
	splittedColumnValue.map((el, index) => {
		if (_.includes(el, "[n]") || _.isArray(_data)) {
			if ((index > 0 && _.isArray(_data) && !_.includes(el, "[n]"))) {
				var arr = [];
				_data.map(els => {
					arr.push(els[el]);
				})
				v = arr;
				_data = v;
			} else if (index > 0 && _.isArray(_data) && _.includes(el, "[n]")) {
				var arr = [];
				_data.map(els => {
					(els[_.trim(el, "[n]")]).map(e => {
						arr.push(e);
					})
				})
				v = arr;
				_data = v;
			} else {

				if (_data[_.trim(el, "[n]")]) {
					var v = _data[_.trim(el, "[n]")];
					_data = v;
				} else {
					_data = "";
				}
				// console.log("brabd",_data);
			}
		} else {
			if (_data[el]) {
				v = _data[el];
				_data = v;
			} else {
				_data = "";
			}

		}
	})
	return _data;
}

function fetchDetailsFromCollection(collectionName, path, filter, limit) {
	return new Promise((resolve, reject) => {
		cuti.request.getUrlandMagicKey(collectionName).then(options => {
			options.method = "GET";
			if (path) {
				options.path += path;
			}

			if (limit)
				options.path += "?count=" + "" + limit;
			else
				options.path += "?count=50";

			// console.log("The filters are-->", filter);
			if (!_.isEmpty(filter)) {
				options.path += "&filter=" + encodeURIComponent((filter));
			}

			http.request(options, response => {
				var data = "";
				response.on("data", _data => data += _data);
				response.on("end", () => {
					if (response.statusCode >= 200 && response.statusCode < 299) {
						resolve(data);
					} else {
						if (JSON.parse(data).results) {
							reject(JSON.parse(data).results["errors"]);
						} else {
							reject(data);
						}
					}
				});
			}).end();
		});
	});
}


function queryTest(req, res) {
	// var client = new elasticsearch.Client({
	// 	host: 'http://52.66.151.182:9200'
	// })
	// client.search({
	// 	index: 'account',
	// 	// body: {
	// 	// 	"size":0,
	// 	// 	"aggs":{"max_value":{"max":{"field":"amount"}}}
	// 	// }
	// }).then(function (resp) {
	// 	var hits = resp.hits.hits;
	// 	//_source
	// 	console.log("The response is---->",resp)
	// 	res.send(resp);
	// }, function (err) {
	// 	console.trace(err.message);
	// });

}

module.exports = {
	init: init,
	download: download,
	reportdownload: reportdownload,
	queryTest: queryTest
};