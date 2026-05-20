import assert from 'node:assert/strict';

import {parseShadowViewCsvText, prepareDeviceMapData} from '../src/csvShadowView.js';
import {CUSTOM_MAP_STYLES, DEFAULT_MAP_STYLE_ID, POINTS_DATASET_ID, TRAIL_DATASET_ID, createKeplerPayload} from '../src/keplerConfig.js';
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

const mapData = prepareDeviceMapData(parsed.observations, 'aa:bb:cc:00:00:01');
assert.equal(mapData.points.length, 2);
assert.equal(mapData.segments.length, 1);
assert.equal(mapData.points[0].Bssid, 'aa:bb:cc:00:00:01');
assert.equal(mapData.points[0]['Accuracy'], '26');
assert.equal(mapData.points[0]['Accuracy (2)'], '');

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
assert.equal(DEFAULT_THREAT_CONFIG.minUniqueLocationsLow, DEFAULT_THREAT_CONFIG.minScansLow);
assert.equal(DEFAULT_THREAT_CONFIG.minPathSpanMetersHigh, 1250);
assert.equal(DEFAULT_THREAT_CONFIG.notifyAtSeverity, 'high');

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
assert.match(threats[0].reason, /scanner location/);
assert.match(threats[0].reason, /detection radius/);
assert.match(threats[0].reason, /outside radius or MGRS criteria ignored/);
const directLegacyThreats = analyzeThreats(threatParsed.observations, {
  enabled: true,
  sameLocationMeters: 50,
  maxDetectionRadiusMeters: 100,
  minUniqueLocationsHigh: 6,
  minDurationMinutesHigh: 45,
  minPathSpanMetersHigh: 250
});
assert.equal(directLegacyThreats[0].severity, 'high');
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
  true
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
assert.equal(normalizeThreatConfig({maxAccuracyMeters: 42}).maxDetectionRadiusMeters, 42);
assert.equal(normalizeThreatConfig(null).maxDetectionRadiusMeters, DEFAULT_THREAT_CONFIG.maxDetectionRadiusMeters);
const legacyLocationConfig = normalizeThreatConfig({minUniqueLocationsLow: 7});
assert.equal(legacyLocationConfig.minScansLow, 7);
assert.equal(legacyLocationConfig.minUniqueLocationsLow, 7);
const scanConfig = normalizeThreatConfig({minScansLow: 9, minUniqueLocationsLow: 2});
assert.equal(scanConfig.minScansLow, 9);
assert.equal(scanConfig.minUniqueLocationsLow, 9);

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
