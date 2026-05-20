import assert from 'node:assert/strict';

import {detectCleanerCsvFormat, parseShadowViewCsvText, prepareDeviceMapData} from '../src/csvShadowView.js';
import {CUSTOM_MAP_STYLES, DEFAULT_MAP_STYLE_ID, POINTS_DATASET_ID, TRAIL_DATASET_ID, createKeplerPayload} from '../src/keplerConfig.js';
import {
  POINTS_LAYER_ID,
  clickedPoint,
  clickedPointIndex,
  mapClickInfoForPoint,
  pointIndexByRowNumber,
  pointLayerIndex
} from '../src/mapSelection.js';
import {countBySeverity, deviceMatchesSearch, searchTerm, threatMatchesSearch} from '../src/searchFilters.js';
import {DEFAULT_THREAT_CONFIG, normalizeThreatConfig} from '../src/threatConfig.js';
import {analyzeThreats} from '../src/threatDetection.js';

const csv = `Document ID,Display Name,City,Clazz,Country,Event Time,Last Updated,Location (Lat/Lon),Location (MGRS),Source,Super Type,Type,_id,_index,Accuracy,Accuracy,Altitude,Altitude,Bandwidth,Bssid,Bssid,Channel,Channel,Device Name,Device Name,Device Time,Device Time,Ssid,Ssid,Latitude,Latitude,Longitude,Longitude
doc-1,unit,Yotvata,NetworkSurveyWifiBeacon,Israel,2026-04-30 15:33:53.693291,2026-04-30 15:33:54,"29.9525051,34.9349915",36RXU8673215097,network-survey,survey,wifi-beacon,row-1,index,26,,455.7,,MHZ_40,aa:bb:cc:00:00:01,,40,,unit,,2026-04-30T18:33:53.693291+03:00,,NET_ONE,,29.9525051,,34.9349915,
doc-2,unit,Yotvata,NetworkSurveyWifiBeacon,Israel,2026-04-30 15:34:53.693291,2026-04-30 15:34:54,"29.9535051,34.9359915",36RXU8673315098,network-survey,survey,wifi-beacon,row-2,index,24,,455.7,,MHZ_40,aa:bb:cc:00:00:01,,40,,unit,,2026-04-30T18:34:53.693291+03:00,,NET_ONE,,29.9535051,,34.9359915,
doc-3,unit,Yotvata,NetworkSurveyWifiBeacon,Israel,2026-04-30 15:35:53.693291,2026-04-30 15:35:54,"29.9545051,34.9369915",36RXU8673415099,network-survey,survey,wifi-beacon,row-3,index,21,,455.7,,MHZ_40,aa:bb:cc:00:00:02,,40,,unit,,2026-04-30T18:35:53.693291+03:00,,NET_TWO,,29.9545051,,34.9369915,`;

const parsed = parseShadowViewCsvText(csv, 'real-format.csv');
assert.equal(parsed.mappedRows, 3);
assert.equal(parsed.skippedRows, 0);
assert.equal(parsed.devices.length, 2);
assert.equal(parsed.devices[0].id, 'aa:bb:cc:00:00:01');
assert.equal(parsed.devices[0].count, 2);

const rogueTowerCleanerCsv = `Document ID,Display Name,Event Time,Location (Lat/Lon),Location (MGRS),Type,Accuracy,Device Name,Device Time,Eci,Mcc,Mnc,Pci,Rsrp,Rsrq,Serving Cell,Tac
doc-1,unit,2026-04-30 15:33:53,"29.9525051,34.9349915",36RXU8673215097,lte,26,unit,2026-04-30T18:33:53+03:00,15175683,425,1,216,-88,-12,true,25321`;
const rogueOnly = parseShadowViewCsvText(rogueTowerCleanerCsv, 'rogue-tower.csv');
assert.equal(rogueOnly.cleanOnly, true);
assert.equal(rogueOnly.cleanerFormat.cleanerId, 'rogue_tower');
assert.equal(rogueOnly.cleanerFormat.displayName, 'Rogue Tower CSV Cleaner');
assert.equal(rogueOnly.mappedRows, 0);
assert.match(rogueOnly.mapError, /BSSID/);

const coTravelerCleanerCsv = `BSSID,SSID,Accuracy,Event Time,Device Name,MGRS
aa:bb:cc:00:00:01,NET_ONE,10,2026-05-19 12:00:00,Field Sensor,15SWC1234567890`;
const coTravelerOnly = parseShadowViewCsvText(coTravelerCleanerCsv, 'co-traveler.csv');
assert.equal(coTravelerOnly.cleanOnly, true);
assert.equal(coTravelerOnly.cleanerFormat.cleanerId, 'co_traveler');
assert.equal(coTravelerOnly.cleanerFormat.displayName, 'Co-Traveler CSV Cleaner');
assert.equal(detectCleanerCsvFormat(['Device Name', 'Device Time', 'MCC', 'MNC', 'Serving Cell', 'Location (MGRS)', 'PCI', 'ECI', 'RSRP', 'RSRQ', 'TAC', 'Type', 'Accuracy']).cleanerId, 'rogue_tower');
assert.throws(
  () => parseShadowViewCsvText('Device Name,Accuracy\nscanner,10', 'unknown.csv'),
  /Could not find a BSSID column/
);

const mapData = prepareDeviceMapData(parsed.observations, 'aa:bb:cc:00:00:01');
assert.equal(mapData.points.length, 2);
assert.equal(mapData.segments.length, 1);
assert.equal(mapData.rawPointCount, 2);
assert.equal(mapData.points[0].Bssid, 'aa:bb:cc:00:00:01');
assert.equal(mapData.points[0]['Accuracy'], '26');
assert.equal(mapData.points[0]['Accuracy (2)'], '');
const groupedMapData = prepareDeviceMapData(parsed.observations, 'aa:bb:cc:00:00:01', {
  clusterDistanceMeters: 200
});
assert.equal(groupedMapData.points.length, 1);
assert.equal(groupedMapData.rawPointCount, 2);
assert.equal(groupedMapData.points[0]['Map radius (m)'], 25);
assert.equal(groupedMapData.points[0]['Grouped scans'], 2);
assert.equal(groupedMapData.points[0]['Location observed span'], '1m');
assert.equal(groupedMapData.points[0].__cluster_size, 2);
assert.equal(groupedMapData.points[0].__cluster_duration_ms, 60000);
assert.equal(groupedMapData.clusterDistanceMeters, 200);
assert.deepEqual(
  Object.keys(groupedMapData.points[0]).filter((key) => !key.startsWith('__')).slice(0, 6),
  [
    'Map radius (m)',
    'Grouped scans',
    'Grouped rows',
    'Location group radius (m)',
    'Location first seen',
    'Location last seen'
  ]
);
assert.equal(clickedPointIndex({picked: true, index: 1, layer: {props: {id: POINTS_LAYER_ID}}}), 1);
assert.equal(clickedPointIndex({picked: true, object: {index: 0}, layer: {props: {id: POINTS_LAYER_ID}}}), 0);
assert.equal(clickedPointIndex({picked: true, index: 0, layer: {props: {id: 'other-layer'}}}), null);
assert.equal(clickedPoint({picked: true, index: 1, layer: {props: {id: POINTS_LAYER_ID}}}, mapData.points), mapData.points[1]);
assert.equal(pointLayerIndex({visState: {layers: [{id: 'other-layer'}, {id: POINTS_LAYER_ID}]}}), 1);
assert.equal(pointLayerIndex({visState: {layers: [{id: 'other-layer'}]}}), null);
assert.equal(pointIndexByRowNumber(mapData.points).get(mapData.points[1].__row_number), 1);
assert.deepEqual(mapClickInfoForPoint(mapData.points[1], 1, 2), {
  picked: true,
  index: 1,
  object: {index: 1},
  coordinate: [mapData.points[1].__longitude, mapData.points[1].__latitude],
  layer: {
    props: {
      id: POINTS_LAYER_ID,
      idx: 2,
      dataId: POINTS_DATASET_ID
    }
  }
});
assert.equal(mapClickInfoForPoint(mapData.points[1], -1, 2), null);

const payload = createKeplerPayload({...mapData, deviceId: 'aa:bb:cc:00:00:01'});
assert.equal(payload.datasets[0].info.id, POINTS_DATASET_ID);
assert.equal(payload.datasets[1].info.id, TRAIL_DATASET_ID);
assert.ok(payload.bounds[0] < Math.min(...mapData.points.map((point) => point.__longitude)));
assert.ok(payload.bounds[1] < Math.min(...mapData.points.map((point) => point.__latitude)));
assert.ok(payload.bounds[2] > Math.max(...mapData.points.map((point) => point.__longitude)));
assert.ok(payload.bounds[3] > Math.max(...mapData.points.map((point) => point.__latitude)));
assert.equal(payload.config.visState.layers.length, 3);
assert.equal(payload.config.visState.layers[0].config.label, 'Detection radius');
assert.equal(payload.config.visState.layers[0].config.sizeField.name, '__detection_radius_meters');
assert.equal(payload.config.visState.layers[1].config.columns.lat, '__latitude');
assert.equal(payload.config.visState.layers[2].config.columns.lat0, '__lat0');
assert.deepEqual(payload.config.visState.layerOrder, [
  'shadow-view-detection-radius',
  'shadow-view-trail',
  'shadow-view-points'
]);
assert.deepEqual(payload.config.visState.layers[1].config.color, [76, 201, 240]);
assert.deepEqual(payload.config.visState.layers[2].config.color, [255, 215, 0]);
const highSeverityPayload = createKeplerPayload({...mapData, deviceId: 'aa:bb:cc:00:00:01', severity: 'high'});
assert.deepEqual(highSeverityPayload.config.visState.layers[0].config.color, [217, 45, 32]);
assert.deepEqual(highSeverityPayload.config.visState.layers[1].config.color, [217, 45, 32]);
assert.deepEqual(highSeverityPayload.config.visState.layers[2].config.color, [217, 45, 32]);
assert.ok(
  payload.config.visState.interactionConfig.tooltip.config.fieldsToShow[POINTS_DATASET_ID].every(
    (field) => !field.name.startsWith('__')
  )
);
assert.equal(payload.config.mapStyle.styleType, DEFAULT_MAP_STYLE_ID);
const mapStyleIds = new Set(CUSTOM_MAP_STYLES.map((style) => style.id));
assert.equal(mapStyleIds.size, CUSTOM_MAP_STYLES.length);
assert.ok(mapStyleIds.has(DEFAULT_MAP_STYLE_ID));
assert.ok(mapStyleIds.has('shadow_view_satellite'));
assert.ok(mapStyleIds.has('shadow_view_dark'));
assert.equal(
  CUSTOM_MAP_STYLES.find((style) => style.id === 'shadow_view_satellite').style.sources['esri-satellite-tiles'].maxzoom,
  18
);
assert.equal(DEFAULT_THREAT_CONFIG.maxDetectionRadiusMeters, 50);
assert.equal(DEFAULT_THREAT_CONFIG.minScansLow, 8);
assert.equal(DEFAULT_THREAT_CONFIG.minPathSpanMetersHigh, 1250);
assert.deepEqual(Object.keys(DEFAULT_THREAT_CONFIG), [
  'enabled',
  'sameLocationMeters',
  'maxDetectionRadiusMeters',
  'minScansLow',
  'minDurationMinutesLow',
  'minPathSpanMetersLow',
  'minScansMedium',
  'minDurationMinutesMedium',
  'minPathSpanMetersMedium',
  'minScansHigh',
  'minDurationMinutesHigh',
  'minPathSpanMetersHigh',
  'maxThreatsToShow'
]);

const threatCsv = `BSSID,SSID,Accuracy,Event Time,Device Name,MGRS,Latitude,Longitude
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:00:00,scanner,36RXU1000010000,29.9500,34.9300
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:10:00,scanner,36RXU1010010000,29.9501,34.9301
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:20:00,scanner,36RXU1020010000,29.9502,34.9302
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:30:00,scanner,36RXU1030010000,29.9503,34.9303
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:40:00,scanner,36RXU1040010000,29.9504,34.9304
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:50:00,scanner,36RXU1050010000,29.9505,34.9305
aa:bb:cc:00:00:99,FOLLOWER,150,2026-04-30 13:00:00,scanner,36RXU1060010000,29.9506,34.9306
aa:bb:cc:00:00:10,STATIC,20,2026-04-30 12:00:00,scanner,NOT-MGRS,29.9500,34.9300`;
const threatParsed = parseShadowViewCsvText(threatCsv, 'threat-format.csv');
assert.deepEqual(threatParsed.devices.map((device) => device.id), ['aa:bb:cc:00:00:99', 'aa:bb:cc:00:00:10']);
assert.ok(!threatParsed.devices.some((device) => device.id === 'scanner'));
const focusedThreatConfig = normalizeThreatConfig({
  ...DEFAULT_THREAT_CONFIG,
  maxDetectionRadiusMeters: 100,
  minScansHigh: 6,
  minDurationMinutesHigh: 45,
  minPathSpanMetersHigh: 250
});
const threats = analyzeThreats(threatParsed.observations, focusedThreatConfig);
assert.equal(threats.length, 1);
assert.equal(threats[0].bssid, 'aa:bb:cc:00:00:99');
assert.equal(threats[0].severity, 'high');
assert.equal(threats[0].metrics.scanCount, 6);
assert.equal(threats[0].metrics.qualifyingScanCount, 6);
assert.equal(threats[0].metrics.ignoredScanCount, 1);
assert.equal(threats[0].metrics.scannerLocationCount, 6);
assert.equal(threats[0].metrics.medianDetectionRadiusMeters, 20);
assert.equal(threats[0].qualifyingRowNumbers.length, 6);
const allThreatDeviceMapData = prepareDeviceMapData(threatParsed.observations, threats[0].bssid);
const qualifyingThreatMapData = prepareDeviceMapData(threatParsed.observations, threats[0].bssid, {
  includedRowNumbers: threats[0].qualifyingRowNumbers
});
const groupedQualifyingThreatMapData = prepareDeviceMapData(threatParsed.observations, threats[0].bssid, {
  includedRowNumbers: threats[0].qualifyingRowNumbers,
  clusterDistanceMeters: focusedThreatConfig.sameLocationMeters
});
assert.equal(allThreatDeviceMapData.points.length, 7);
assert.equal(qualifyingThreatMapData.points.length, 6);
assert.equal(groupedQualifyingThreatMapData.rawPointCount, qualifyingThreatMapData.points.length);
assert.equal(groupedQualifyingThreatMapData.points.length, threats[0].metrics.scannerLocationCount);
assert.ok(qualifyingThreatMapData.points.every((point) => Number(point.Accuracy) <= focusedThreatConfig.maxDetectionRadiusMeters));
assert.match(threats[0].reason, /scanner location/);
assert.match(threats[0].reason, /detection radius/);
assert.match(threats[0].reason, /outside radius or MGRS criteria ignored/);
assert.deepEqual(countBySeverity(threats), {all: 1, high: 1, medium: 0, low: 0});
assert.equal(searchTerm('  FOLLOWER  '), 'follower');
assert.equal(threatMatchesSearch(threats[0], 'follower'), true);
assert.equal(threatMatchesSearch(threats[0], 'AA:BB'), true);
assert.equal(threatMatchesSearch(threats[0], 'missing'), false);
assert.equal(threatMatchesSearch({bssid: '11:22:33:44:55:66', severity: 'low'}, '11:22'), true);
assert.equal(threatMatchesSearch(null, '11:22'), false);
assert.equal(
  deviceMatchesSearch(
    {id: 'aa:bb:cc:00:00:99', label: 'aa:bb:cc:00:00:99'},
    threats[0],
    'high'
  ),
  false
);
assert.equal(
  deviceMatchesSearch(
    {id: 'aa:bb:cc:00:00:99', label: 'aa:bb:cc:00:00:99'},
    threats[0],
    'follower'
  ),
  true
);
assert.equal(
  deviceMatchesSearch(
    {id: 'aa:bb:cc:00:00:99', label: 'aa:bb:cc:00:00:99'},
    threats[0],
    'scanner'
  ),
  false
);
assert.equal(deviceMatchesSearch(null, null, 'missing'), false);
assert.equal(normalizeThreatConfig(null).maxDetectionRadiusMeters, DEFAULT_THREAT_CONFIG.maxDetectionRadiusMeters);
assert.deepEqual(Object.keys(normalizeThreatConfig()), Object.keys(DEFAULT_THREAT_CONFIG));
assert.equal(normalizeThreatConfig({minScansLow: 9}).minScansLow, 9);

const repeatedLocationCsv = `BSSID,SSID,Accuracy,Event Time,Device Name,MGRS,Latitude,Longitude
aa:bb:cc:00:00:77,STATIONARY,20,2026-04-30 12:00:00,scanner,36RXU1000010000,29.9500,34.9300
aa:bb:cc:00:00:77,STATIONARY,20,2026-04-30 12:10:00,scanner,36RXU1000010000,29.9500,34.9300
aa:bb:cc:00:00:77,STATIONARY,20,2026-04-30 12:20:00,scanner,36RXU1000010000,29.9500,34.9300
aa:bb:cc:00:00:77,STATIONARY,20,2026-04-30 12:30:00,scanner,36RXU1000010000,29.9500,34.9300
aa:bb:cc:00:00:77,STATIONARY,20,2026-04-30 12:40:00,scanner,36RXU1000010000,29.9500,34.9300
aa:bb:cc:00:00:77,STATIONARY,20,2026-04-30 12:50:00,scanner,36RXU1000010000,29.9500,34.9300`;
const repeatedLocationParsed = parseShadowViewCsvText(repeatedLocationCsv, 'repeated-location-format.csv');
const repeatedLocationConfig = normalizeThreatConfig({
  ...DEFAULT_THREAT_CONFIG,
  minScansLow: 3,
  minDurationMinutesLow: 30,
  minPathSpanMetersLow: 0
});
assert.equal(analyzeThreats(repeatedLocationParsed.observations, repeatedLocationConfig).length, 0);
const oneUniqueScanThreats = analyzeThreats(
  repeatedLocationParsed.observations,
  normalizeThreatConfig({
    ...repeatedLocationConfig,
    minScansLow: 1
  })
);
assert.equal(oneUniqueScanThreats.length, 1);
assert.equal(oneUniqueScanThreats[0].metrics.scanCount, 1);
assert.equal(oneUniqueScanThreats[0].metrics.qualifyingScanCount, 6);
const groupedRepeatedLocationMapData = prepareDeviceMapData(
  repeatedLocationParsed.observations,
  oneUniqueScanThreats[0].bssid,
  {
    includedRowNumbers: oneUniqueScanThreats[0].qualifyingRowNumbers,
    clusterDistanceMeters: repeatedLocationConfig.sameLocationMeters
  }
);
assert.equal(groupedRepeatedLocationMapData.points.length, 1);
assert.equal(groupedRepeatedLocationMapData.rawPointCount, 6);
assert.equal(groupedRepeatedLocationMapData.points[0]['Grouped scans'], 6);
assert.equal(groupedRepeatedLocationMapData.points[0]['Location observed span'], '50m');

const chainCsv = `BSSID,SSID,Accuracy,Event Time,Device Name,MGRS,Latitude,Longitude
aa:bb:cc:00:00:88,CHAIN,20,2026-04-30 12:00:00,scanner,36RXU1000010000,29.9500,34.9300
aa:bb:cc:00:00:88,CHAIN,20,2026-04-30 12:10:00,scanner,36RXU1004010000,29.9501,34.9301
aa:bb:cc:00:00:88,CHAIN,20,2026-04-30 12:20:00,scanner,36RXU1008010000,29.9502,34.9302`;
const chainParsed = parseShadowViewCsvText(chainCsv, 'chain-format.csv');
const chainThreats = analyzeThreats(
  chainParsed.observations,
  normalizeThreatConfig({
    ...DEFAULT_THREAT_CONFIG,
    minScansLow: 2,
    minDurationMinutesLow: 20,
    minPathSpanMetersLow: 0
  })
);
assert.equal(chainThreats[0].metrics.scanCount, 2);
assert.equal(chainThreats[0].metrics.qualifyingScanCount, 3);
assert.equal(chainThreats[0].metrics.scannerLocationCount, 2);

console.log('Shadow View map smoke test passed.');
