import assert from 'node:assert/strict';

import {parseShadowViewCsvText, prepareDeviceMapData} from '../src/csvShadowView.js';
import {CUSTOM_MAP_STYLES, DEFAULT_MAP_STYLE_ID, POINTS_DATASET_ID, TRAIL_DATASET_ID, createKeplerPayload} from '../src/keplerConfig.js';
import {DEFAULT_THREAT_CONFIG} from '../src/threatConfig.js';
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
assert.equal(payload.config.visState.layers.length, 2);
assert.equal(payload.config.visState.layers[0].config.columns.lat, '__latitude');
assert.equal(payload.config.visState.layers[1].config.columns.lat0, '__lat0');
assert.equal(payload.config.mapStyle.styleType, DEFAULT_MAP_STYLE_ID);
assert.ok(CUSTOM_MAP_STYLES.find((style) => style.id === 'shadow_view_satellite'));

const threatCsv = `BSSID,SSID,Accuracy,Event Time,Device Name,MGRS,Latitude,Longitude
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:00:00,scanner,36RXU1000010000,29.9500,34.9300
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:10:00,scanner,36RXU1010010000,29.9501,34.9301
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:20:00,scanner,36RXU1020010000,29.9502,34.9302
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:30:00,scanner,36RXU1030010000,29.9503,34.9303
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:40:00,scanner,36RXU1040010000,29.9504,34.9304
aa:bb:cc:00:00:99,FOLLOWER,20,2026-04-30 12:50:00,scanner,36RXU1050010000,29.9505,34.9305
aa:bb:cc:00:00:10,STATIC,20,2026-04-30 12:00:00,scanner,NOT-MGRS,29.9500,34.9300`;
const threatParsed = parseShadowViewCsvText(threatCsv, 'threat-format.csv');
const threats = analyzeThreats(threatParsed.observations, DEFAULT_THREAT_CONFIG);
assert.equal(threats.length, 1);
assert.equal(threats[0].bssid, 'aa:bb:cc:00:00:99');
assert.equal(threats[0].severity, 'high');
assert.equal(threats[0].metrics.ignoredScanCount, 0);

console.log('Shadow View map smoke test passed.');
