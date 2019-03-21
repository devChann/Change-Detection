// default global values;
var AOI = [];
console.log("global" + AOI)
var startDate = "2018";
const Weeks = getWeeksInYear(startDate);
console.log(Weeks);

(function renderMap(){
    var osmUrl = '//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            osmAttrib = '&copy; <a href="http://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            osm = L.tileLayer(osmUrl, {maxZoom: 18, attribution: osmAttrib}),
            map = new L.Map('map', {layers: [osm], center: new L.LatLng(-1.30252,36.812913), zoom: 3});
    var drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    // Set the title to show on the polygon button
    L.drawLocal.draw.toolbar.buttons.polygon = 'Draw a sexy polygon!';
    var drawControl = new L.Control.Draw({
        position: 'topleft',
        draw: {
            polyline: false,
            polygon: false,
            marker: false
        },
        edit: {
            featureGroup: drawnItems,
            remove: true
        }
    });
    map.addControl(drawControl);
    map.on(L.Draw.Event.CREATED, function (e) {
        var type = e.layerType,
                layer = e.layer;
        if(type === 'rectangle'){
            var coords = layer.getBounds().toBBoxString();
            console.log(coords);
            var tempArray = [];
            tempArray.push(coords); // convret coord to string
            AOI = JSON.parse("[" + tempArray + "]" );
            var area = AOI;
            
            for (var w = Weeks.length - 1; w >= 0; w--) {
              
              checkWeekAvailability(area,w);
              
            }
            
        [].forEach.call(document.querySelectorAll(".imagery-entry[data-area='" + area + "']"), function(node) {
        node.classList.add("current-area");
        node.classList.remove("loading");
        node.classList.add("order");
    });
        }
        drawnItems.addLayer(layer);
    });
    contentProvider();
}).call(this);
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
function checkWeekAvailability(area,weekId) {
    renderWeekRow(area,weekId);
    return getDatasetInfoForWeek(area, weekId)
        .then(function(dsInfo) {
            var node = document.querySelector(".imagery-entry[data-weekid='" + weekId + "']");
            console.log(node);
            if (_.isNull(dsInfo)) {
                node.classList.add("no-data");
                return;
            }

            var acqDate = moment(dsInfo.properties.acquisitionDate);
            console.log("acq"+ acqDate);
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
            if(acqDate < CurrentMaxDate){
                node.classList.add("filter-out");
            }

            return dsInfo.id;
        });
}
function getDatasetInfoForWeek(area,weekId) {

    var filters = {
        provider: "landsat",
        products: ["Landsat 8"],
        minAcquisitionDate: Weeks[weekId].start_date,
        maxAcquisitionDate: Weeks[weekId].end_date,
        bbox: area
    };
    console.log("filters" + filters);
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
                    return dataset.geometry.contains(area);
                })
                .sortBy(function(dataset) {
                    console.log("tt1" + dataset.properties.cloudCover);
                    return dataset.properties.cloudCover;
                })
                .value();
            
            return all.length > 0 ? all[0] : null;
        });
}
function getWeeksInYear(startDate) {
    var sdateObj = new Date(startDate);
    var smomentObj = moment(sdateObj);
    var startDateString = smomentObj.format('YYYY');
    
    var yearStart = moment().year(startDateString).month(0).date(1).utc().startOf('day');
    var yearEnd = moment().year(startDateString).utc().endOf('year');
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
// order content
function orderDataset(areaInx, weekId, datasetId) {
    var name = generateName(areaInx, weekId);

    var orderParams = {
       //"containerFolder": AppFolderId,
        "identifier": datasetId,
        "provider": "landsat",
        //"userDescription": name
    };

    var node = document.querySelector(".imagery-entry[data-area='" + areaInx + "'][data-weekid='" + weekId + "']");
    node.classList.remove("order");
    node.classList.add("processing");
    setStatus(areaInx, weekId, "Ordering dataset...");

    return new Promise(_.partial(gsp.m_app.platform.content.placeOrder, orderParams))
        .then(function(orderInfo) {
            return monitorOrderStatus(areaInx, weekId, orderInfo.id);
        });
}
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
        });
}

function checkWeeklyStatus(area,weekid){
     for (var week = Weeks.length - 1; week >= 0; week--) {
            (function(area, week) {
                checkWeekAvailability(area, week)
                    .then(function(datasetId) {
                        var node = document.querySelector(".imagery-entry[data-area='" + area + "'][data-weekid='" + week + "']");
                        node.classList.remove("loading");

                        if (!node.classList.contains("no-data")) {
                            // Data is available for the particular week, but user have not requested it yet.
                            node.classList.add("order");
                            node.querySelector(":scope .get-data-btn").addEventListener("click", orderDataset.bind(null, area, week, node.dataset.dsId));
                        }
                    });
            });
    }
}
// get weeks in a year
//const Weeks = getWeeksInYear(startDate);

function renderWeekRow(area,weekInx) {
    var node = document.createElement("div");
    node.className = "imagery-entry loading";
    node.dataset.weekid = weekInx;
    node.dataset.area = area;

    var label = document.createElement("div");
    label.className = "imagery-label";
    label.innerHTML = Weeks[weekInx].start + " - " + Weeks[weekInx].end ;
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
function changeFilter(btn, event) {
    document.querySelector(".nav button.active").classList.remove("active");
    btn.classList.add("active");
    document.getElementById("imageries-body").dataset.filter = btn.dataset.filter;
}
function recalculateCCFilter(maxValue) {
    CurrentMaxCC = maxValue;
    [].forEach.call(document.querySelectorAll(".imagery-entry"), function(el) {
        var ccValue = parseFloat(el.dataset.cc);
        //console.log("ccvalue: " + ccValue);
        //console.log("maxValue: " + maxValue);
        el.classList.toggle("filter-out", ccValue > maxValue);
    });
}
function recalculateAqDate(maxDate) {
    CurrentMaxDate = maxDate;
    var imagesRows = document.querySelectorAll(".imagery-entry");

    // document.getElementById("startDateId").addEventListener("change", function(e) {
    //     var newDate = e.target.value;
    //     //var dateEntered = new Date(input);
    //     //console.log(input); //e.g. 2015-11-13
    //      e.classList.toggle("filter-out", newDate < maxDate);
    //     console.log(newDate); //e.g. Fri Nov 13 2015 00:00:00 GMT+0000 (GMT Standard Time)
    // });
    for (var i = 0; i < imagesRows.length; i++) {

        imagesRows[i].classList.toggle("filter-out", startDate < maxDate);
    }
}
function contentProvider(){
    var body = document.createElement("div");
    body.className = "floatingpanel";
    body.id = "imageries-body";
    document.getElementById("imageries-panel").appendChild(body);

    var nav = document.createElement("div");
    nav.className = "nav";
    body.appendChild(nav);

    var allBtn = document.createElement("button");
    allBtn.className = "active";
    allBtn.innerHTML = "Content Provider";
    allBtn.dataset.filter = "";
    allBtn.dataset.tooltip = "Display all weeks";
    allBtn.addEventListener("click", changeFilter.bind(null, allBtn));
    nav.appendChild(allBtn);

    //for (var w = Weeks.length - 1; w >= 0; w--) {
            //renderWeekRow(w);
        //}

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
    
    var startDateLabel= document.createElement('label')
    startDateLabel.innerHTML = "Start Date";
    nav.appendChild(startDateLabel);
    
    var inputStartdate = document.createElement("input");
    inputStartdate.className = "input";
    inputStartdate.setAttribute("id","startDateId")
    inputStartdate.setAttribute("type", "Year");
    inputStartdate.setAttribute("value","2018");
    inputStartdate.dataset.value = "2018";
    inputStartdate.addEventListener("input", function(event) {
        event.target.dataset.value = event.target.value;

        recalculateAqDate(event.target.value);
        
    });
    nav.appendChild(inputStartdate);
}
function createArrayFromGeoJson(json, callback) {
   var array = [];
   console.log("Translating GeoJSON into array of rows...");
   for (var i = 0; i < json.features.length; i++) {
      var row = "{";
      for (var property in json.features[i].properties) {
         if (json.features[i].properties.hasOwnProperty(property)) {
            row += "\"" + property + "\":" + JSON.stringify(json.features[i].properties[property]) + ",";
         }
      }
      array.push(JSON.parse(row.substring(0, row.length - 1) + "}"));
   }
   console.log("Done. Total array size: " + array.length);
   callback(array);
}

// listen to message from recipe

var messageName = "displaySHPOnMap";
gsp.m_app.messages.subscribe(messageName, function (messageParams) {
    
    var catalogItemId = messageParams.catalogItemProperties.id;
    var layerInfo = {
            bbox:  messageParams.catalogItemProperties.footprint.envelope.slice(0, 4),
            bboxCrs: messageParams.catalogItemProperties.footprint.envelope[4]
        }
    var bottomLeftCorner = { x: layerInfo.bbox[0], y: layerInfo.bbox[1] },topRightCorner = { x: layerInfo.bbox[2], y: layerInfo.bbox[3] };
    
    console.log("bbox object" + bottomLeftCorner);
    
    
    gsp.m_app.platform.catalog.get(catalogItemId, function (catalogItemProperties) {
        var url = "api/v1/items/" + catalogItemProperties.id + "/attachments/" + catalogItemProperties.attachments[catalogItemProperties.name + ".geojson.attachment"].name;
        gsp.m_app.utils.connection(url).then(function (response) {
            
            console.log(response);
            
            geojson = JSON.parse(response.entity);
            
            console.log(geojson);
            
            renderCharts(geojson);
        });
        
    });
    

});

function renderCharts(geojson){
    createArrayFromGeoJson(geojson,function(array){
        console.log(array);
        var dataCrossfilter = crossfilter(array);
        
        var area = dataCrossfilter.dimension(function(d){ return d.M_AREA;});
        var groupArea = area.group();
        
        var typeOfChange = dataCrossfilter.dimension(function(d){
            if(d.Value == 1){return "Negative"}else{
                return "Positive";
            }
        });
        
        var groupname = "Choropleth";
        
        
        var totalChangeArea = typeOfChange.group().reduceSum(function(d){
            return +d.M_AREA;
        });
        
        var returnRowChart = dc.rowChart("#rowChart");
        
        returnRowChart
            .dimension(typeOfChange)
            .group(totalChangeArea)
            .controlsUseVisibility(true)
            .elasticX(true)
        returnRowChart.xAxis().ticks(5).tickFormat(function(d){return d;});
        returnRowChart.ordinalColors(["#d81111","#125907"]);
        
        
        var returnPiechart = dc.pieChart("#piechart");
        returnPiechart
            .dimension(typeOfChange)
            .group(totalChangeArea)
            .innerRadius(45)
            .controlsUseVisibility(true)
            //.on('pretransition',function(chart){
                //chart.selectAll('text.pie-slice').text(function(d){
                    // return d.data.key + '-' + dc.utils.printSingleValue((d.endAngle - d.startAngle) / (2*Math.PI) * 100) + '%';
                //})
            //})
        returnPiechart.ordinalColors(["#d81111","#125907"]);
        var map = document.getElementById("map");
        console.log(map);
        var choroChart = dc.geoChoroplethChart(map)
          .dimension(area)
          .group(totalChangeArea)
          .colors(["#125907","#d81111"])
          .colorDomain([-5, 200])   
          .colorAccessor(function(d, i){return d.M_Area;})
          .overlayGeoJson(geojson.features, 'M_AREA', function(d) {
            return d.properties.M_AREA;
          })
        dc.renderAll();
        
    });
    
}