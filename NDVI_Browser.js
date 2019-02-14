/***************************
 * Application Configuration
 ***************************
 */
// Name of the folder that will contains application data
const APP_DATA_FOLDER_NAME = "NDVI_Browser_App_Data";
// Catalog name of the model to execute
const GEOPROCESSING_MODEL_NAME = "NDVI-Browser-Model";
// Year of the weeks
const YEAR = 2016;
// List of the places' names
const PLACES = ["Las Vegas", "Lodz", "Norcross"];
// View BBOX for each defined place. Should be in the CRS EPSG:3857.
// This defines portion of the map user will see after switching to the particular place.
const PLACES_MAP_VIEW = [
    [-12921068.135382762, 4249593.0245426595, -12637028.138275048, 4404607.317904998],
    [2103470.581379765, 6715833.74216387, 2245490.579933623, 6793340.888845039],
    [-9503262.852639392, 3943844.911401955, -9219222.855531678, 4098859.20476429]
];
// Search BBOX for each defined place. Should be in the CRS EPSG:4326.
// This defines area that needs to be included in the analysed datasets.
// Area should be smaller then single dataset.
const PLACES_SEARCH_AOI = [
    [36.02022525154813, -114.993896484375, 36.23984280222428, -114.66156005859376],
    [51.69724635547481, 19.37713623046875, 51.83068574881732, 19.553604125976562],
    [33.84874817060767, -84.35440063476562, 34.092473191457664, -84.0509033203125]
];


/***************************
 * Application internal data.
 ***************************
 */
// Week folder pattern: <place_name>_<year>_Week_<week_index>
const NameRegex = /^([a-z\- ]*)_([0-9]{4})_Week_([0-9]{1,2})$/i;
const LandsatNameRegex = /^L(.)(.)(\d{3})(\d{3})(\d{4})(\d{3})([a-zA-Z]{3})(\d{2})$/;
const GeojsonReader = new jsts.io.GeoJSONReader();
const GeometryFactory = new jsts.geom.GeometryFactory();

// parse PLACES_SEARCH_AOI to object-oriented form
const AoiBBox = [];
for (var i = 0; i < PLACES_SEARCH_AOI.length; i++) {
    var aoitemp = PLACES_SEARCH_AOI[i];
    AoiBBox.push(GeometryFactory.createLinearRing([
        new jsts.geom.Coordinate(aoitemp[0], aoitemp[1]),
        new jsts.geom.Coordinate(aoitemp[2], aoitemp[1]),
        new jsts.geom.Coordinate(aoitemp[2], aoitemp[3]),
        new jsts.geom.Coordinate(aoitemp[0], aoitemp[3]),
        new jsts.geom.Coordinate(aoitemp[0], aoitemp[1])
    ]));
}


/***************************
 * Application functions.
 ***************************
 */

/**
 * Adds ":scope" selector support for Edge.
 * Source: http://stackoverflow.com/a/17989803/3545303
 */
(function(doc, proto) {
    try {
        doc.querySelector(':scope body');
    } catch (err) {
        ['querySelector', 'querySelectorAll'].forEach(function(method) {
            var nativ = proto[method];
            proto[method] = function(selectors) {
                if (/(^|,)\s*:scope/.test(selectors)) {
                    var id = this.id;
                    this.id = 'ID_' + Date.now();
                    selectors = selectors.replace(/((^|,)\s*):scope/g, '$1#' + this.id);
                    var result = doc[method](selectors);
                    this.id = id;
                    return result;
                } else {
                    return nativ.call(this, selectors);
                }
            }
        });
    }
})(window.document, Element.prototype);

/**
 * Callback function (onClick event).
 * Executed when user changes active area (place).
 */
function changeActiveArea(areaInx) {
    // Remove "active" state from the current place's button.
    [].forEach.call(document.querySelectorAll(".place-selector div.active"), function(el) {
        el.classList.remove("active");
    });

    // Adds "active" state to the selected place's button.
    document.querySelector(".place-selector div:nth-of-type(" + (areaInx + 1) + ")").classList.add("active");
    ActiveArea = areaInx;

    // Change map view to the selected place.
    gsp.map.zoom({
        bbox: PLACES_MAP_VIEW[ActiveArea]
    });

    // Hides week rows from the previous area and displays ones from the selected place.
    // Week is only visible with the "current-area" class.
    [].forEach.call(document.querySelectorAll(".imagery-entry:not([data-area='" + areaInx + "'])"), function(node) {
        node.classList.remove("current-area");
    });

    [].forEach.call(document.querySelectorAll(".imagery-entry[data-area='" + areaInx + "']"), function(node) {
        node.classList.add("current-area");
    });
}

/**
 * Callback function (onClick event).
 * Executed when user changes weeks filter mode.
 */
function changeFilter(btn, event) {
    document.querySelector(".nav button.active").classList.remove("active");
    btn.classList.add("active");
    document.getElementById("imageries-body").dataset.filter = btn.dataset.filter;
}

/**
 * Determines status of all weeks.
 * Checks which datasets were already analyzed.
 * Also determinds availability of the data for specific weeks.
 */
function checkAllWeeksStatus() {
    // When week is being analyzed, it creates its own folder in the application data directory
    // in the user catalog. This is where week's dataset is stored. In order to determine
    // week status, we are getting information about all folder stored in app data directory (1).
    // Also user could request analysis of the particular week, but order is not completed yet.
    // In this case week's data folder may not be created yet. This is why we are also fetching
    // user orders list (2).
    var getWeekFoldersRequestParams = {
        path: "api/v1/search.json",
        entity: {
            "maxresults": 99999999999999,
            "owner": "me",
            "profile": "eac-brief",
            "template": {
                "class": ["com.erdas.rsp.babel.model.ResourceAggregate"],
                "parent": {
                    "id": AppFolderId
                }
            }
        }
    };

    var getDataPromisses = [];
    getDataPromisses.push(gsp.m_app.utils.userConnection(getWeekFoldersRequestParams)); // (1)
    getDataPromisses.push(new Promise(_.partial(gsp.m_app.platform.content.getOrders))); // (2)

    return Promise.all(getDataPromisses)
        .then(function(results) {
            var folders = results[0];
            var orders = results[1];

            var data = {};

            data.folders = _
                .chain(folders.entity.results)
                .reduce(function(map, folderInfo) {
                    // Folder name contains week identifier. We are parsing folder name
                    // to determine week related to it. If folder is not related to any week
                    // method returns null.
                    var info = parseName(folderInfo.name);

                    if (info == null) {
                        return map;
                    }

                    if (map[info.area] == null) {
                        map[info.area] = {};
                    }

                    map[info.area][info.week] = folderInfo;
                    return map;
                }, {})
                .value();

            data.orders = _
                .chain(orders.entity)
                .reduce(function(map, orderInfo) {
                    // Order description contains week identifier. We are parsing it
                    // to determine week related to it. If order is not related to any week
                    // method returns null.
                    var info = parseName(orderInfo.userDescription);

                    if (info == null || map[info.area] != null && map[info.area][info.week] != null) {
                        return map;
                    }

                    if (orderInfo.statusCode === "ERROR_OCCURRED") {
                        return map;
                    }

                    // If order is completed, but its output folder does not exist (e.g user deleled it manually), treat order as non-existing.
                    if (orderInfo.statusCode === "COMPLETED" && data.folders[info.area] == null || data.folders[info.area][info.week] == null) {
                        return map;
                    }

                    if (map[info.area] == null) {
                        map[info.area] = {};
                    }

                    map[info.area][info.week] = orderInfo;
                    return map;
                }, {})
                .value();

            return data;
        })
        .then(function(infoMap) {
            for (var area = 0; area < PLACES.length; area++) {
                for (var week = Weeks.length - 1; week >= 0; week--) {
                    (function(area, week) {
                        checkWeekAvailability(area, week)
                            .then(function(datasetId) {
                                var node = document.querySelector(".imagery-entry[data-area='" + area + "'][data-weekid='" + week + "']");
                                node.classList.remove("loading");

                                if (!_.isNil(infoMap.folders[area]) && !_.isNil(infoMap.folders[area][week])) {
                                    //Data folder for the particular week exists. Check if analysis is fully completed.
                                    node.classList.add("processing");
                                    prepareProcessedData(area, week, datasetId, infoMap.folders[area][week]);
                                    return;
                                }

                                if (!_.isNil(infoMap.orders[area]) && !_.isNil(infoMap.orders[area][week])) {
                                    //Order is still in progress. Monitor its progress.
                                    node.classList.add("processing");
                                    setStatus(area, week, "Ordering dataset...");
                                    monitorOrderStatus(area, week, infoMap.orders[area][week].id);
                                    return;
                                }

                                if (!node.classList.contains("no-data")) {
                                    // Data is available for the particular week, but user have not requested it yet.
                                    node.classList.add("order");
                                    node.querySelector(":scope .get-data-btn").addEventListener("click", orderDataset.bind(null, area, week, node.dataset.dsId));
                                }
                            });
                    })(area, week);
                }
            }
        });
}

/**
 * Checks whether dataset is available for the particular week.
 * If so, renders dataset metadata into the week's view.
 */
function checkWeekAvailability(areaId, weekId) {
    return getDatasetInfoForWeek(areaId, weekId)
        .then(function(dsInfo) {
            var node = document.querySelector(".imagery-entry[data-area='" + areaId + "'][data-weekid='" + weekId + "']");

            if (_.isNull(dsInfo)) {
                node.classList.add("no-data");
                return;
            }

            var acqDate = moment(dsInfo.properties.acquisitionDate);

            var acqNode = document.createElement("span");
            acqNode.innerHTML = acqDate.format('LL');
            node.querySelector(":scope .acq").appendChild(acqNode);

            var ccNode = document.createElement("span");
            ccNode.innerHTML = dsInfo.properties.cloudCover + "%";
            node.querySelector(":scope .cc").appendChild(ccNode);

            node.dataset.dsId = dsInfo.id;
            node.dataset.cc = dsInfo.properties.cloudCover;

            if (parseFloat(dsInfo.properties.cloudCover) > CurrentMaxCC) {
                node.classList.add("filter-out");
            }

            return dsInfo.id;
        });
}

/**
 * Generate user friendly description of the analysis status.
 */
function generateDetailedStatus(processingInfo) {

    if (processingInfo.Status === "Processing") {
        if (processingInfo.TaskName === "Validation") {
            return "Validating...";
        }

        if (processingInfo.TaskName === "Awaiting Executor") {
            return "Queued";
        }

        if (_.startsWith(processingInfo.TaskName, "Executing") || _.startsWith(processingInfo.TaskName, "Execution")) {
            return "Analysing... (" + processingInfo.Progress + "%)";
        }
    }

    if (processingInfo.Status === "Registering Datasets") {
        return "Saving output... (" + processingInfo.Progress + "%)";
    }

    return "";
}

/**
 * Generates week signature name for the folder/order.
 */
function generateName(areaInx, weekId) {
    return PLACES[areaInx] + "_" + YEAR + "_Week_" + (weekId + 1);
}

/**
 * Use discover service from the Content Broker Service in order to get best
 * available dataset for the particular week. Returns null if nothing is found.
 */
function getDatasetInfoForWeek(areaId, weekId) {

    var filters = {
        provider: "landsat",
        products: ["Landsat 8"],
        minAcquisitionDate: Weeks[weekId].start_date,
        maxAcquisitionDate: Weeks[weekId].end_date,
        bbox: PLACES_SEARCH_AOI[areaId]
    }

    return new Promise(_.partial(gsp.m_app.platform.content.discover, filters))
        .then(function(response) {
            if (response.properties.totalAvailableRecords === 0) {
                return null;
            }

            var all = _.chain(response.features)
                .map(function(feature) {
                    feature.geometry.coordinates[0].push(feature.geometry.coordinates[0][0]);
                    return GeojsonReader.read(feature);
                })
                .filter(function(dataset) {
                    return dataset.geometry.contains(AoiBBox[areaId]);
                })
                .sortBy(function(dataset) {
                    return dataset.properties.cloudCover;
                })
                .value();

            return all.length > 0 ? all[0] : null;
        });
}

/**
 * Gets file info with the provided name and parent from the user catalog.
 */
function getFileFromCatalog(fileName, parentFolderId) {
    var requestParams = {
        path: "api/v1/search.json",
        entity: {
            "maxresults": 1,
            "owner": "me",
            "profile": "eac-brief",
            "template": {
                "class": ["com.erdas.rsp.babel.model.imagery.ImageReference"],
                "keywords": fileName,
                "parent": {
                    "id": parentFolderId
                }
            }
        }
    };

    return gsp.m_app.utils.userConnection(requestParams)
        .then(function(response) {
            return response.entity.results[0];
        });
}

/**
 * Gets folder info of the folder with provided identifier.
 */
function getFolderInfo(id) {
    return gsp.m_app.utils.userConnection("api/v1/folders/" + id + ".json?profile=eac-brief")
        .then(function(response) {
            return response.entity.results[0];
        });
}

function getGeoprocessingModelId() {
    var requestParam = {
        path: "api/v1/search.json",
        entity: {
            maxresults: 50,
            owner: "me",
            profile: "eac-brief",
            template: {
                "class": [
                    "com.erdas.rsp.babel.model.model.ModelResource"
                ],
                "keywords": GEOPROCESSING_MODEL_NAME
            }
        }
    };

    return gsp.m_app.utils.userConnection(requestParam)
        .then(function(response) {
            var results = response.entity.results;
            if (results.length == 0) {
                throw new Error("NVDI Model not found.");
            }

            return results[0].id;
        });
}

function getLandsatDatasetInfo(datasetId) {
    var parts = LandsatNameRegex.exec(datasetId);

    if (parts == null) {
        return null;
    }

    var path = parts[3];
    var row = parts[4];

    var metadataUrl = "https://landsat-pds.s3.amazonaws.com/L8/" + path + "/" + row + "/" + datasetId + "/" + datasetId + "_MTL.txt";

    return axios.get(metadataUrl)
        .then(function(response) {
            var data = response.data;

            var reflectanceMultBand5Regex = /^\s+REFLECTANCE_MULT_BAND_5\s=\s(.*)$/m;
            var reflectanceAddBand5Regex = /^\s+REFLECTANCE_ADD_BAND_5\s=\s(.*)$/m;
            var reflectanceMultBand4Regex = /^\s+REFLECTANCE_MULT_BAND_4\s=\s(.*)$/m;
            var reflectanceAddBand4Regex = /^\s+REFLECTANCE_ADD_BAND_4\s=\s(.*)$/m;
            var sunElevationRegex = /^\s+SUN_ELEVATION\s=\s(.*)$/m;

            return {
                reflectanceMultBand5: parseFloat(reflectanceMultBand5Regex.exec(data)[1]),
                reflectanceAddBand5: parseFloat(reflectanceAddBand5Regex.exec(data)[1]),
                reflectanceMultBand4: parseFloat(reflectanceMultBand4Regex.exec(data)[1]),
                reflectanceAddBand4: parseFloat(reflectanceAddBand4Regex.exec(data)[1]),
                sunElevation: parseFloat(sunElevationRegex.exec(data)[1])
            }
        })
        .catch(function(e) {
            console.error("Unable to get Landsat metadata file", e);
            return null;
        });
}

/**
 * Generates weeks info in the provided year.
 * Returns array of weeks info (start and end time of each week)
 */
function getWeeksInYear(year) {
    var yearStart = moment().year(year).month(0).date(1).utc().startOf('day');
    var yearEnd = moment().year(year).utc().endOf('year');
    var now = moment().utc().endOf('day');
    var maxDate = now < yearEnd ? now : yearEnd;
    var currentDayIndex = maxDate.diff(yearStart, 'days') + 1;

    var weeks = Math.ceil(currentDayIndex / 7);
    var weekRange = [];
    var weekStart = yearStart;
    var i = 0;

    while (i < weeks) {
        var weekEnd = moment(weekStart).utc().endOf('isoweek').endOf('day');

        weekRange.push({
            'start': weekStart.format('Do MMM'),
            'end': weekEnd.format('Do MMM'),
            'start_date': weekStart.toDate(),
            'end_date': weekEnd.toDate()
        });

        weekStart = weekStart.isoWeekday(8);
        i++;
    }
    return weekRange;
}

/**
 * Checks week's order status. Also monitors it and waits for the order to complete.
 */
function monitorOrderStatus(areaInx, weekId, orderId) {
    return new Promise(_.partial(gsp.m_app.platform.content.getOrderStatus, orderId, "detailed"))
        .then(function(orderInfo) {

            // If order fails, start new one.
            if (orderInfo.statusCode === "ERROR_OCCURRED") {
                return getDatasetInfoForWeek(areaInx, weekId)
                    .then(function(dsInfo) {
                        if (_.isNull(dsInfo)) {
                            return checkWeekAvailability(areaInx, weekId);
                        }

                        return orderDataset(areaInx, weekId, dsInfo.id);
                    });
            }

            if (orderInfo.statusCode !== "COMPLETED") {
                return new Promise(function(resolve, reject) {
                    setTimeout(_.partial(monitorOrderStatus, areaInx, weekId, orderId), 10000);
                });
            }

            return getFolderInfo(orderInfo.outputFolderId)
                .then(_.partial(prepareProcessedData, areaInx, weekId, orderInfo.dataSetId));
        });
}

/**
 * Monitors analysis status and waits for its completion.
 */
function monitorProcessing(folderId, area, weekId, processingId) {
    var params = {
        path: "api/v1/geoprocesses/status",
        entity: {
            "IDList": [
                processingId
            ]
        }
    };

    return gsp.m_app.utils.userConnection(params)
        .then(function(response) {
            var processingInfo = response.entity[0];
            var node = document.querySelector(".imagery-entry[data-processing='" + processingId + "']");

            if (processingInfo.Status !== "") {
                node.querySelector(":scope .processing").dataset.details = generateDetailedStatus(processingInfo);

                return new Promise(function(resolve, reject) {
                    setTimeout(function() {
                        return monitorProcessing(folderId, area, weekId, processingId).then(resolve);
                    }, 2000)
                });
            }

            if (processingInfo.Outcome !== "Success") {
                return getDatasetInfoForWeek(area, weekId)
                    .then(function(dsInfo) {
                        return startProcessing(folderId, dsInfo.id);
                    })
                    .then(function(newProcessingId) {
                        node.dataset.processing = newProcessingId;
                        return newProcessingId;
                    })
                    .then(_.partial(monitorProcessing, folderId, area, weekId));
            }

            return Promise.resolve();
        });
}

/**
 * Orders dataset in the Content Broker Service for the particular week.
 */
function orderDataset(areaInx, weekId, datasetId) {
    var name = generateName(areaInx, weekId);

    var orderParams = {
        "containerFolder": AppFolderId,
        "identifier": datasetId,
        "provider": "landsat",
        "userDescription": name
    }

    var node = document.querySelector(".imagery-entry[data-area='" + areaInx + "'][data-weekid='" + weekId + "']");
    node.classList.remove("order");
    node.classList.add("processing");
    setStatus(areaInx, weekId, "Ordering dataset...");

    return new Promise(_.partial(gsp.m_app.platform.content.placeOrder, orderParams))
        .then(function(orderInfo) {
            return monitorOrderStatus(areaInx, weekId, orderInfo.id);
        })
}

/**
 * Parse provided name to retrive week's info.
 * If week's info cannot be found, returns null.
 */
function parseName(name) {
    var result = NameRegex.exec(name);

    if (result == null) {
        return null;
    }

    var areaName = result[1];
    var areaInx = PLACES.indexOf(areaName);

    if (areaInx === -1) {
        return null;
    }

    if (parseInt(result[2]) !== YEAR) {
        return null;
    }

    return {
        area: areaInx,
        week: parseInt(result[3]) - 1
    };
}

/**
 * Takes care of dataset analysis. Executes geoprocessing model and waits for its execution.
 */
function prepareProcessedData(area, weekId, datasetId, folderInfo) {
    // Information about analysis is saved in the week's folder properties.
    // Property processingId contains geoprocessing execution identifier.
    // Property processingDone contains id of the catalog item which is analysis output (imagery).
    setStatus(area, weekId, "Preparing NDVI analysis...");
    var processingId = _.isNil(folderInfo.properties.processingId) ? startProcessing(folderInfo.id, datasetId) : Promise.resolve(folderInfo.properties.processingId);
    var processingItemId = folderInfo.properties.processingDone;

    var donePromise = null;

    if (!_.isNil(processingItemId)) {
        donePromise = Promise.resolve();
    } else {
        donePromise = processingId
            .then(function(processingId) {
                var node = document.querySelector(".imagery-entry[data-area='" + area + "'][data-weekid='" + weekId + "']");
                node.dataset.processing = processingId;
                return processingId;
            })
            .then(_.partial(monitorProcessing, folderInfo.id, area, weekId))
            .then(_.partial(getFileFromCatalog, "NDVI", folderInfo.id))
            .then(function(itemInfo) {
                return new Promise(function(resolve, reject) {
                    gsp.m_app.platform.publications.get(itemInfo.id, resolve, function() {
                        var config = {
                            "id": itemInfo.id,
                            "title": itemInfo.title
                        };

                        gsp.m_app.platform.publications.publish(config, function() {
                            gsp.m_app.platform.publications.get(itemInfo.id, resolve, reject);
                        }, reject);
                    });
                })
            })
            .then(function(pubInfo) {
                var setPropertyWithProcessingDoneRequestParams = {
                    path: "api/v1/items/" + folderInfo.id + "/processingDone",
                    entity: {
                        "type": "1",
                        "value": pubInfo.catalogItemId
                    }
                };
                processingItemId = pubInfo.catalogItemId;
                return gsp.m_app.utils.userConnection(setPropertyWithProcessingDoneRequestParams);
            })
    }

    donePromise.then(function() {
        var node = document.querySelector(".imagery-entry[data-area='" + area + "'][data-weekid='" + weekId + "']");
        node.classList.remove("processing");
        node.classList.add("ready");

        var btn = node.querySelector(":scope .done button");
        btn.addEventListener("click", _.debounce(_.partial(toggleImage, area, weekId, btn, processingItemId), 100));
    });
}

/**
 * Callback function (onInput event).
 * Executed when user changes change max CloudCover value.
 */
function recalculateCCFilter(maxValue) {
    CurrentMaxCC = maxValue;
    [].forEach.call(document.querySelectorAll(".imagery-entry"), function(el) {
        var ccValue = parseFloat(el.dataset.cc);
        el.classList.toggle("filter-out", ccValue > maxValue);
    });
}

/*
 * Removes dom node from the document.
 */
function removeElement(element) {
    element && element.parentNode && element.parentNode.removeChild(element);
}

/**
 * Renders weeks's row to the view.
 */
function renderWeekRow(areaInx, weekInx) {
    var node = document.createElement("div");
    node.className = "imagery-entry loading";
    node.dataset.weekid = weekInx;
    node.dataset.area = areaInx;

    var label = document.createElement("div");
    label.className = "imagery-label";
    label.innerHTML = "Week #" + (weekInx + 1) + " (" + Weeks[weekInx].start + " - " + Weeks[weekInx].end + ")";
    node.appendChild(label);

    var loading_img = document.createElement("img");
    loading_img.src = "http://www.premiumbeat.com/v217/assets/img/loading.gif";
    label.appendChild(loading_img);

    var content = document.createElement("div");
    content.className = "imagery-content";
    node.appendChild(content);

    var acquisitionDateNode = document.createElement("div");
    acquisitionDateNode.className = "info acq";
    acquisitionDateNode.innerHTML = '<span class="prefix">Acquired:</span>';
    content.appendChild(acquisitionDateNode);

    var providerNode = document.createElement("div");
    providerNode.className = "info pr";
    providerNode.innerHTML = '<span class="prefix">Provider:</span>Landsat';
    content.appendChild(providerNode);

    var cloudCoverNode = document.createElement("div");
    cloudCoverNode.className = "info cc";
    cloudCoverNode.innerHTML = '<span class="prefix">Cloud Cover:</span>';
    content.appendChild(cloudCoverNode);

    var getDataBtn = document.createElement("button");
    getDataBtn.className = "get-data-btn";
    getDataBtn.innerHTML = "Get Imagery";
    content.appendChild(getDataBtn);

    var statusNode = document.createElement("div");
    statusNode.className = "processing";
    statusNode.innerHTML = '<img src="http://www.mikesport.pl/skin/frontend/default/smartmage/images/ajaxcart/loading.gif">';
    content.appendChild(statusNode);

    var statusTestNode = document.createElement("span");
    statusTestNode.className = "statusTxt";
    statusNode.appendChild(statusTestNode);

    var doneNode = document.createElement("div");
    doneNode.className = "done";
    doneNode.innerHTML = '<button>Show Imagery</button>';
    content.appendChild(doneNode);

    document.getElementById("imageries-body").appendChild(node);
}

/**
 * Change user-friendly processing status of the week.
 */
function setStatus(area, weekId, message) {
    var node = document.querySelector(".imagery-entry[data-area='" + area + "'][data-weekid='" + weekId + "']");
    node.querySelector(":scope .statusTxt").innerHTML = message;
}

/**
 * Executes NDVI analysis for the imagery bands in the particular folder.
 */
function startProcessing(folderId, datasetId) {
    var getFilesInFolderRequestParams = {
        path: "api/v1/search.json",
        entity: {
            "maxresults": 50,
            "owner": "me",
            "profile": "eac-brief",
            "template": {
                "class": ["com.erdas.rsp.babel.model.imagery.ImageReference"],
                "parent": {
                    "id": folderId
                }
            }
        }
    };

    var metadataInfo = getLandsatDatasetInfo(datasetId);
    var bandsCatalogIds = gsp.m_app.utils.userConnection(getFilesInFolderRequestParams)
        .then(function(response) {
            var files = response.entity.results;

            var bands = {};
            for (var i = 1; i <= 11; i++) {
                bands[i] = _.find(files, function(o) {
                    return _.endsWith(o.name, "_B" + i)
                }).id;
            }

            return bands;
        });

    return Promise.all([metadataInfo, bandsCatalogIds])
        .then(function(results) {
            var metadataInfo = results[0];
            var bands = results[1];
            var startGeoprocessingRequestParams = {
                path: "api/v1/geoprocesses/" + GeoprocessingModelId + "/execute",
                entity: {
                    "Inputs": [{
                        "Data": {
                            "Input": true,
                            "Type": "IMAGINE.File",
                            "Value": bands[4]
                        },
                        "Name": "Landsat 8 Red File Input"
                    }, {
                        "Data": {
                            "Input": true,
                            "Type": "IMAGINE.File",
                            "Value": bands[5]
                        },
                        "Name": "Landsat 8 NIR File Input"
                    }, {
                        "Data": {
                            "Type": "IMAGINE.Double",
                            "Value": metadataInfo.reflectanceMultBand5
                        },
                        "Name": "REFLECTANCE_MULT_BAND_5"
                    }, {
                        "Data": {
                            "Type": "IMAGINE.Double",
                            "Value": metadataInfo.reflectanceAddBand5
                        },
                        "Name": "REFLECTANCE_ADD_BAND_5"
                    }, {
                        "Data": {
                            "Type": "IMAGINE.Double",
                            "Value": metadataInfo.sunElevation
                        },
                        "Name": "SUN_ELEVATION"
                    }, {
                        "Data": {
                            "Type": "IMAGINE.Double",
                            "Value": metadataInfo.reflectanceMultBand4
                        },
                        "Name": "REFLECTANCE_MULT_BAND_4"
                    }, {
                        "Data": {
                            "Type": "IMAGINE.Double",
                            "Value": metadataInfo.reflectanceAddBand4
                        },
                        "Name": "REFLECTANCE_ADD_BAND_4"
                    }, {
                        "Data": {
                            "Input": false,
                            "Type": "IMAGINE.File",
                            "Value": folderId + "/NDVI.img"
                        },
                        "Name": "Filename Out"
                    }],
                    "Method": "Asynchronous"
                }

            };

            return gsp.m_app.utils.userConnection(startGeoprocessingRequestParams);
        })
        .then(function(response) {
            return response.entity.ID;
        })
        .then(function(processingId) {
            var setPropertyWithProcessingIdRequestParams = {
                path: "api/v1/items/" + folderId + "/processingId",
                entity: {
                    "type": "1",
                    "value": processingId
                }
            };

            return gsp.m_app.utils.userConnection(setPropertyWithProcessingIdRequestParams)
                .then(function() {
                    return processingId;
                });
        });
}

/**
 * Callback function (onClick event).
 * Displays/Hides analysis output (imagery) on the map.
 */
function toggleImage(area, weekId, button, catalogItemId, event) {
    var promises = [];

    promises.push(new Promise(_.partial(gsp.m_app.platform.publications.get, catalogItemId)));
    promises.push(new Promise(_.partial(gsp.m_app.platform.catalog.get, catalogItemId)));

    button.disabled = true;

    Promise.all(promises)
        .then(function(infos) {
            var pubInfo = infos[0];
            var itemInfo = infos[1];
            var stateOn = !_.isNil(button.dataset.on) && button.dataset.on === "true";

            if (!stateOn) {
                var wmsUrl = "/api/v1/services/ogc/wms/" + pubInfo.serviceName,
                    legendDefinition = {
                        definitionName: "MAppPlatformWms",
                        url: wmsUrl,
                        id: pubInfo.catalogItemId,
                        name: PLACES[area] + " - NDVI Week #" + (weekId + 1),
                        bbox: itemInfo.footprint.envelope.slice(0, 4),
                        bboxCrs: itemInfo.footprint.envelope[4],
                        supportedCrses: pubInfo.outputCSList
                    };

                gsp.legend.add(legendDefinition, function(ret) {
                    button.dataset.legendid = ret.ids[0];
                    button.disabled = false;
                });
                button.dataset.on = "true";
                button.innerHTML = "Hide Imagery";
            } else {
                gsp.legend.find({
                    id: button.dataset.legendid
                }, function(ret) {
                    ret.legendItems[0].remove();
                    button.dataset.legendid = null;
                    button.disabled = false;
                });
                button.dataset.on = "false";
                button.innerHTML = "Show Imagery";
            }
        });
}

/**
 * "Main" function of the application. Executes after view rendering.
 */
function startApplicationCore() {
    //First action to perform is to find id of the user ROOT folder.
    var getRootRequestParams = {
        path: "api/v1/search.json",
        entity: {
            "maxresults": 1,
            "owner": "me",
            "template": {
                class: "com.erdas.rsp.babel.model.CatalogItem",
                name: "ROOT"
            }
        }
    };

    gsp.m_app.utils.userConnection(getRootRequestParams)
        .then(function(result) {
            if (result.entity.results.length === 0) {
                throw new Error("Unable to fetch ROOT folder id.");
            }
            document.querySelector(".preparing .percent").innerHTML = "33";
            return result.entity.results[0].id;
        })
        .then(function(rootFolderId) {
            // We are trying to find application's data folder.
            var getAppDataFolderRequestParams = {
                path: "api/v1/search.json",
                entity: {
                    "maxresults": 1,
                    "owner": "me",
                    "template": {
                        "class": ["com.erdas.rsp.babel.model.ResourceAggregate"],
                        "keywords": APP_DATA_FOLDER_NAME,
                        "parent": {
                            "id": rootFolderId
                        }
                    }
                }
            };

            return gsp.m_app.utils.userConnection(getAppDataFolderRequestParams).then(function(result) {
                document.querySelector(".preparing .percent").innerHTML = "66";
                if (result.entity.results.length === 0) {
                    // If application's data folder is not found - create it.
                    var createFolderRequestParams = {
                        path: "api/v1/folders",
                        entity: {
                            "description": "Folder with data for CBS Sample Application",
                            "name": APP_DATA_FOLDER_NAME,
                            "title": APP_DATA_FOLDER_NAME,
                            "parent": {
                                "id": rootFolderId
                            }
                        }
                    };

                    return gsp.m_app.utils.userConnection(createFolderRequestParams).then(function(result) {
                        document.querySelector(".preparing .percent").innerHTML = "99";
                        return JSON.parse(result.entity).id;
                    });
                }

                return result.entity.results[0].id;

            });
        })
        .then(function(appFolderId) {
            AppFolderId = appFolderId;

            return getGeoprocessingModelId()
                .then(function(modelId) {
                    GeoprocessingModelId = modelId;
                })
                .catch(function() {
                    throw new Error("Unable to find NDVI model.");
                });
        })
        .then(function() {
            document.querySelector(".preparing").style.display = "none";
            // Focus on first defined area
            changeActiveArea(0);
            // Start to determinig weeks' statuses
            checkAllWeeksStatus();
        })
        .catch(function(error){
            document.querySelector(".preparing").innerHTML = error.message;
            document.querySelector(".preparing").classList.add("error");
        });
}

/***************************
 * Application global variables.
 ***************************
 */
const Weeks = getWeeksInYear(YEAR);
var AppFolderId = null;
var ActiveArea = null;
var CurrentMaxCC = null;
var GeoprocessingModelId = null;

/***************************
 * User Interface preparation.
 ***************************
 */
{
    removeElement(document.getElementById("livesearch"));
    removeElement(document.getElementsByClassName("mapc")[0].parentNode);

    var appNav = document.createElement("div");
    appNav.className = "appNav";
    document.body.appendChild(appNav);

    var logoUrlBase = "https://" + window.top.location.host + "/" + window.top.location.pathname;
    var appTitle = document.createElement("div");
    appTitle.className = "appTitle";
    appTitle.innerHTML = '<img src="' + logoUrlBase + '/assets/images/logos/hex-logo.png">Weekly NDVI Browser';
    appNav.appendChild(appTitle);

    var placeSelector = document.createElement("div");
    placeSelector.className = "place-selector";
    appNav.appendChild(placeSelector);

    for (var i = 0; i < PLACES.length; i++) {
        var placeNode = document.createElement("div");
        placeNode.innerHTML = PLACES[i];

        placeNode.addEventListener("click", changeActiveArea.bind(null, i));
        placeSelector.appendChild(placeNode);
    }

    gsp.ui.sidebar.add({
        title: "Satellite imageries (Year " + YEAR + ")",
        id: "imageries-panel",
        sticky: true
    }, function(ret) {
        var body = document.createElement("div");
        body.className = "floatingpanel-body";
        body.id = "imageries-body";
        document.getElementById("imageries-panel").appendChild(body);

        var nav = document.createElement("div");
        nav.className = "nav";
        body.appendChild(nav);

        var allBtn = document.createElement("button");
        allBtn.className = "active";
        allBtn.innerHTML = "All";
        allBtn.dataset.filter = "";
        allBtn.dataset.tooltip = "Display all weeks";
        allBtn.addEventListener("click", changeFilter.bind(null, allBtn));
        nav.appendChild(allBtn);

        var availableBtn = document.createElement("button");
        availableBtn.innerHTML = "Available";
        availableBtn.dataset.filter = "available";
        availableBtn.dataset.tooltip = "Display only weeks with available datasets";
        availableBtn.addEventListener("click", changeFilter.bind(null, availableBtn));
        nav.appendChild(availableBtn);

        var analBtn = document.createElement("button");
        analBtn.innerHTML = "Analyzed";
        analBtn.dataset.filter = "analyzed";
        analBtn.dataset.tooltip = "Display only weeks with NDVI analysis";
        analBtn.addEventListener("click", changeFilter.bind(null, analBtn));
        nav.appendChild(analBtn);

        for (var p = 0; p < PLACES.length; p++) {
            for (var w = Weeks.length - 1; w >= 0; w--) {
                renderWeekRow(p, w);
            }
        }

        var ccFieldset = document.createElement("fieldset");
        ccFieldset.className = "cc-selector-fieldset";
        ccFieldset.innerHTML = "<legend>Max Cloud Cover:</legend>";
        nav.appendChild(ccFieldset);

        var initValue = 50;
        var ccRange = document.createElement("input");
        ccRange.setAttribute("type", "range");
        ccRange.setAttribute("min", "1");
        ccRange.setAttribute("max", "100");
        ccRange.setAttribute("step", "1");
        ccRange.setAttribute("value", initValue);
        ccRange.dataset.value = initValue;
        ccRange.addEventListener("input", function(event) {
            event.target.dataset.value = event.target.value;

            recalculateCCFilter(parseFloat(event.target.value));
        });
        ccFieldset.appendChild(ccRange);
        CurrentMaxCC = initValue;

        var preparingNode = document.createElement("div");
        preparingNode.className = "preparing";
        preparingNode.innerHTML = 'Preparing application <span class="percent">0</span>%';
        body.insertBefore(preparingNode, nav.nextSibling);

        window.location.hash = '#imageries-panel';

        startApplicationCore();
    });
}
