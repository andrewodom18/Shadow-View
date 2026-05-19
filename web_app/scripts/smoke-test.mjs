import assert from 'node:assert/strict';

import {parseShadowViewCsvText, prepareDeviceMapData} from '../src/csvShadowView.js';
import {POINTS_DATASET_ID, TRAIL_DATASET_ID, createKeplerPayload} from '../src/keplerConfig.js';

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

console.log('Shadow View map smoke test passed.');
