import Papa from 'papaparse';

import {mgrsDistanceMeters, parseMgrs} from './threatDetection.js';

const DEVICE_ALIASES = ['bssid', 'bssid_1', 'bssid (2)', 'device bssid'];
const TIME_ALIASES = ['event time', 'device time', 'last updated'];
const LAT_ALIASES = ['latitude', 'lat'];
const LON_ALIASES = ['longitude', 'lon', 'lng'];
const LAT_LON_ALIASES = ['location (lat/lon)', 'location lat/lon', 'lat/lon'];
const MGRS_ALIASES = ['mgrs', 'location (mgrs)'];
const ACCURACY_ALIASES = [
  'accuracy',
  'accuracy meters',
  'detection radius',
  'detection radius meters',
  'range',
  'range meters'
];
const SSID_ALIASES = ['ssid', 'ssid (2)', 'network name'];
const CLEANER_FORMATS = [
  {
    cleanerId: 'co_traveler',
    displayName: 'Co-Traveler CSV Cleaner',
    requiredAliases: [
      ['BSSID'],
      ['SSID'],
      ['Accuracy'],
      ['Event Time'],
      ['Device Name'],
      ['MGRS', 'Location (MGRS)']
    ]
  },
  {
    cleanerId: 'rogue_tower',
    displayName: 'Rogue Tower CSV Cleaner',
    requiredAliases: [
      ['Device Name'],
      ['Device Time'],
      ['MCC'],
      ['MNC'],
      ['Serving Cell'],
      ['MGRS', 'Location (MGRS)'],
      ['PCI'],
      ['ECI'],
      ['RSRP'],
      ['RSRQ'],
      ['TAC'],
      ['Type'],
      ['Accuracy']
    ]
  }
];

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function uniqueHeaders(rawHeaders) {
  const counts = new Map();

  return rawHeaders.map((header, index) => {
    const base = String(header || `Column ${index + 1}`).trim() || `Column ${index + 1}`;
    const normalized = normalizeHeader(base);
    const count = counts.get(normalized) || 0;
    counts.set(normalized, count + 1);
    return {
      raw: base,
      key: count === 0 ? base : `${base} (${count + 1})`,
      normalized,
      duplicateIndex: count
    };
  });
}

function findHeaders(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.filter((header) => normalizedAliases.includes(header.normalized));
}

function normalizedHeaderSet(headers) {
  return new Set(
    headers
      .map((header) => (typeof header === 'string' ? normalizeHeader(header) : normalizeHeader(header.raw)))
      .filter(Boolean)
  );
}

function hasHeaderAlias(normalizedHeaders, aliases) {
  return aliases.some((alias) => normalizedHeaders.has(normalizeHeader(alias)));
}

export function detectCleanerCsvFormat(headers) {
  const normalizedHeaders = normalizedHeaderSet(headers);
  const matches = CLEANER_FORMATS.filter((format) =>
    format.requiredAliases.every((aliases) => hasHeaderAlias(normalizedHeaders, aliases))
  );

  if (matches.length !== 1) {
    return null;
  }

  const {cleanerId, displayName} = matches[0];
  return {cleanerId, displayName};
}

function parseNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim();
  if (!cleaned) {
    return null;
  }

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function parseLatLonPair(value) {
  if (!value) {
    return null;
  }

  const match = String(value)
    .trim()
    .match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);

  if (!match) {
    return null;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {latitude, longitude};
}

function parseTime(value) {
  if (!value) {
    return null;
  }

  const raw = String(value).trim();
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const normalized = raw.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueFromHeader(row, header) {
  if (!header) {
    return '';
  }
  return row[header.key] ?? '';
}

function valueFromHeaders(row, headers) {
  for (const header of headers) {
    const value = valueFromHeader(row, header);
    if (String(value).trim()) {
      return value;
    }
  }
  return valueFromHeader(row, headers[0]);
}

function detectColumns(headers) {
  const deviceHeaders = findHeaders(headers, DEVICE_ALIASES);
  const timeHeaders = findHeaders(headers, TIME_ALIASES);
  const latHeaders = findHeaders(headers, LAT_ALIASES);
  const lonHeaders = findHeaders(headers, LON_ALIASES);
  const latLonHeaders = findHeaders(headers, LAT_LON_ALIASES);
  const mgrsHeaders = findHeaders(headers, MGRS_ALIASES);
  const accuracyHeaders = findHeaders(headers, ACCURACY_ALIASES);
  const ssidHeaders = findHeaders(headers, SSID_ALIASES);

  return {
    deviceHeader: deviceHeaders[0] ?? null,
    deviceHeaders,
    timeHeader: timeHeaders[0] ?? null,
    timeHeaders,
    latHeader: latHeaders[0] ?? null,
    latHeaders,
    lonHeader: lonHeaders[0] ?? null,
    lonHeaders,
    latLonHeader: latLonHeaders[0] ?? null,
    latLonHeaders,
    mgrsHeader: mgrsHeaders[0] ?? null,
    mgrsHeaders,
    accuracyHeader: accuracyHeaders[0] ?? null,
    accuracyHeaders,
    ssidHeader: ssidHeaders[0] ?? null,
    ssidHeaders
  };
}

function rowToObject(row, headers) {
  const object = {};
  headers.forEach((header, index) => {
    object[header.key] = row[index] ?? '';
  });
  return object;
}

function extractCoordinates(row, columns) {
  const latitude = parseNumber(valueFromHeaders(row, columns.latHeaders));
  const longitude = parseNumber(valueFromHeaders(row, columns.lonHeaders));
  if (latitude !== null && longitude !== null) {
    return {latitude, longitude};
  }

  return parseLatLonPair(valueFromHeaders(row, columns.latLonHeaders));
}

function compareByTime(first, second) {
  if (first.timeMs === null && second.timeMs === null) {
    return first.rowNumber - second.rowNumber;
  }
  if (first.timeMs === null) {
    return 1;
  }
  if (second.timeMs === null) {
    return -1;
  }
  return first.timeMs - second.timeMs || first.rowNumber - second.rowNumber;
}

function distanceMeters(first, second) {
  const firstLat = (first.latitude * Math.PI) / 180;
  const secondLat = (second.latitude * Math.PI) / 180;
  const deltaLat = secondLat - firstLat;
  const deltaLon = ((second.longitude - first.longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(deltaLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function observationMgrsPoint(observation) {
  return Object.hasOwn(observation, 'mgrsPoint') ? observation.mgrsPoint : parseMgrs(observation.mgrs);
}

function observationDistanceMeters(first, second) {
  const firstMgrsPoint = observationMgrsPoint(first);
  const secondMgrsPoint = observationMgrsPoint(second);
  if (firstMgrsPoint && secondMgrsPoint) {
    return mgrsDistanceMeters(firstMgrsPoint, secondMgrsPoint);
  }
  return distanceMeters(first, second);
}

function compareByLocation(first, second) {
  const firstMgrsPoint = observationMgrsPoint(first);
  const secondMgrsPoint = observationMgrsPoint(second);
  if (firstMgrsPoint && secondMgrsPoint) {
    return (
      firstMgrsPoint.zone - secondMgrsPoint.zone ||
      firstMgrsPoint.hemisphere.localeCompare(secondMgrsPoint.hemisphere) ||
      firstMgrsPoint.easting - secondMgrsPoint.easting ||
      firstMgrsPoint.northing - secondMgrsPoint.northing ||
      firstMgrsPoint.raw.localeCompare(secondMgrsPoint.raw) ||
      compareByTime(first, second)
    );
  }
  if (firstMgrsPoint) {
    return -1;
  }
  if (secondMgrsPoint) {
    return 1;
  }
  return first.latitude - second.latitude || first.longitude - second.longitude || compareByTime(first, second);
}

function medianNumber(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((first, second) => first - second);
  if (!sorted.length) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function durationLabel(ms) {
  if (!Number.isFinite(ms)) {
    return '';
  }
  if (ms <= 0) {
    return '<1 min';
  }

  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days) {
    parts.push(`${days}d`);
  }
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (minutes || !parts.length) {
    parts.push(`${minutes}m`);
  }

  return parts.join(' ');
}

function groupedObservations(observations, distanceThresholdMeters) {
  if (!Number.isFinite(distanceThresholdMeters) || distanceThresholdMeters <= 0) {
    return observations.map((observation) => [observation]);
  }

  const groups = [];
  for (const observation of observations.slice().sort(compareByLocation)) {
    const existingGroup = groups.find(
      (group) => observationDistanceMeters(observation, group.anchor) <= distanceThresholdMeters
    );
    if (existingGroup) {
      existingGroup.observations.push(observation);
      continue;
    }

    groups.push({
      anchor: observation,
      observations: [observation]
    });
  }

  return groups
    .map((group) => group.observations.slice().sort(compareByTime))
    .sort((firstGroup, secondGroup) => compareByTime(firstGroup[0], secondGroup[0]));
}

function observationGroupPoint(group, index) {
  const orderedGroup = group.slice().sort(compareByTime);
  const representative = orderedGroup[0];
  const rows = orderedGroup.map((observation) => observation.rowNumber);
  const timedObservations = orderedGroup.filter((observation) => Number.isFinite(observation.timeMs));
  const firstTimedObservation = timedObservations[0] ?? null;
  const lastTimedObservation = timedObservations[timedObservations.length - 1] ?? null;
  const observedSpanMs =
    firstTimedObservation && lastTimedObservation ? lastTimedObservation.timeMs - firstTimedObservation.timeMs : null;
  const locationObservedSpan = durationLabel(observedSpanMs);
  const detectionRadii = orderedGroup
    .map((observation) => Number(observation.detectionRadius ?? observation.accuracy))
    .filter(Number.isFinite);
  const detectionRadiusMeters = medianNumber(detectionRadii) ?? representative.detectionRadius;
  const groupRadiusMeters = Math.max(
    0,
    ...orderedGroup.map((observation) => observationDistanceMeters(representative, observation)).filter(Number.isFinite)
  );

  return {
    ...representative.original,
    'Map radius (m)': Number.isFinite(detectionRadiusMeters) ? Math.round(detectionRadiusMeters) : '',
    ...(orderedGroup.length > 1
      ? {
          'Grouped scans': orderedGroup.length,
          'Grouped rows': `${Math.min(...rows)}-${Math.max(...rows)}`,
          'Location group radius (m)': Math.round(groupRadiusMeters),
          ...(locationObservedSpan
            ? {
                'Location first seen': firstTimedObservation.timeRaw,
                'Location last seen': lastTimedObservation.timeRaw,
                'Location observed span': locationObservedSpan
              }
            : {})
        }
      : {}),
    __row_number: representative.rowNumber,
    __device_id: representative.deviceId,
    __latitude: representative.latitude,
    __longitude: representative.longitude,
    __event_time: representative.timeRaw,
    __event_time_iso: Number.isFinite(representative.timeMs) ? new Date(representative.timeMs).toISOString() : '',
    __sequence: index + 1,
    __mgrs: representative.mgrs,
    __detection_radius_meters: detectionRadiusMeters,
    __cluster_size: orderedGroup.length,
    __cluster_first_row: Math.min(...rows),
    __cluster_last_row: Math.max(...rows),
    __cluster_radius_meters: Math.round(groupRadiusMeters),
    __cluster_start_time: firstTimedObservation?.timeRaw ?? '',
    __cluster_end_time: lastTimedObservation?.timeRaw ?? '',
    __cluster_duration_ms: Number.isFinite(observedSpanMs) ? observedSpanMs : null,
    __cluster_duration_label: locationObservedSpan
  };
}

export function formatTime(ms) {
  if (!Number.isFinite(ms)) {
    return 'Unknown time';
  }
  return new Date(ms).toLocaleString();
}

function analyzeDevices(observations) {
  const devices = new Map();

  for (const observation of observations) {
    const existing = devices.get(observation.deviceId) ?? {
      id: observation.deviceId,
      label: observation.deviceId,
      count: 0,
      firstTimeMs: null,
      lastTimeMs: null
    };

    existing.count += 1;
    if (Number.isFinite(observation.timeMs)) {
      existing.firstTimeMs =
        existing.firstTimeMs === null ? observation.timeMs : Math.min(existing.firstTimeMs, observation.timeMs);
      existing.lastTimeMs =
        existing.lastTimeMs === null ? observation.timeMs : Math.max(existing.lastTimeMs, observation.timeMs);
    }

    devices.set(observation.deviceId, existing);
  }

  return Array.from(devices.values()).sort((first, second) => {
    const countSort = second.count - first.count;
    return countSort || first.label.localeCompare(second.label);
  });
}

export function prepareDeviceMapData(observations, deviceId, options = {}) {
  const includedRowNumbers =
    options.includedRowNumbers instanceof Set
      ? options.includedRowNumbers
      : Array.isArray(options.includedRowNumbers)
        ? new Set(options.includedRowNumbers)
        : null;
  const clusterDistanceMeters = Number(options.clusterDistanceMeters);
  const rawObservations = observations
    .filter(
      (observation) =>
        observation.deviceId === deviceId && (!includedRowNumbers || includedRowNumbers.has(observation.rowNumber))
    )
    .slice()
    .sort(compareByTime);
  const groups = groupedObservations(rawObservations, clusterDistanceMeters);
  const points = groups.map(observationGroupPoint);

  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (
      Number.isFinite(previous.__latitude) &&
      Number.isFinite(previous.__longitude) &&
      Number.isFinite(current.__latitude) &&
      Number.isFinite(current.__longitude)
    ) {
      segments.push({
        __segment: index,
        __device_id: deviceId,
        __lat0: previous.__latitude,
        __lng0: previous.__longitude,
        __lat1: current.__latitude,
        __lng1: current.__longitude,
        __from_time: previous.__event_time,
        __to_time: current.__event_time,
        __from_row: previous.__row_number,
        __to_row: current.__row_number
      });
    }
  }

  return {
    points,
    segments,
    rawPointCount: rawObservations.length,
    clusterDistanceMeters: Number.isFinite(clusterDistanceMeters) && clusterDistanceMeters > 0 ? clusterDistanceMeters : 0
  };
}

function createParseState(onProgress) {
  return {
    headers: null,
    columns: null,
    cleanerFormat: null,
    rowNumber: 0,
    mappedRows: 0,
    skippedRows: 0,
    observations: [],
    onProgress
  };
}

function ingestRows(rows, state) {
  for (const rawRow of rows) {
    if (!state.headers) {
      state.headers = uniqueHeaders(rawRow);
      state.columns = detectColumns(state.headers);
      state.cleanerFormat = detectCleanerCsvFormat(state.headers);
      continue;
    }

    state.rowNumber += 1;
    const row = rowToObject(rawRow, state.headers);
    const coordinates = extractCoordinates(row, state.columns);
    const deviceValue = String(valueFromHeaders(row, state.columns.deviceHeaders)).trim();

    if (!coordinates || !deviceValue) {
      state.skippedRows += 1;
      continue;
    }

    const timeRaw = String(valueFromHeaders(row, state.columns.timeHeaders)).trim();
    const timeMs = parseTime(timeRaw);
    const mgrs = String(valueFromHeaders(row, state.columns.mgrsHeaders)).trim();
    state.observations.push({
      rowNumber: state.rowNumber,
      deviceId: deviceValue,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      timeRaw,
      timeMs,
      mgrs,
      mgrsPoint: parseMgrs(mgrs),
      accuracy: parseNumber(valueFromHeaders(row, state.columns.accuracyHeaders)),
      detectionRadius: parseNumber(valueFromHeaders(row, state.columns.accuracyHeaders)),
      ssid: String(valueFromHeaders(row, state.columns.ssidHeaders)).trim(),
      original: row
    });
    state.mappedRows += 1;
  }

  state.onProgress({
    rowNumber: state.rowNumber,
    mappedRows: state.mappedRows,
    skippedRows: state.skippedRows
  });
}

function cleanOnlyResult(state, fileName, mapError) {
  return {
    fileName,
    headers: state.headers,
    columns: state.columns,
    observations: [],
    mappedRows: state.mappedRows,
    skippedRows: state.skippedRows,
    rowCount: state.rowNumber,
    devices: [],
    cleanOnly: true,
    cleanerFormat: state.cleanerFormat,
    mapError
  };
}

function finishParse(state, fileName, options = {}) {
  const {allowCleanerOnly = true} = options;
  const failOrCleanOnly = (message) => {
    if (allowCleanerOnly && state.cleanerFormat) {
      return cleanOnlyResult(state, fileName, message);
    }
    throw new Error(message);
  };

  if (!state.headers) {
    throw new Error('The selected CSV is empty.');
  }
  if (!state.columns?.deviceHeader) {
    return failOrCleanOnly('Could not find a BSSID column.');
  }
  if ((!state.columns?.latHeader || !state.columns?.lonHeader) && !state.columns?.latLonHeader) {
    return failOrCleanOnly('Could not find Latitude/Longitude or Location (Lat/Lon) columns.');
  }
  if (!state.observations.length) {
    return failOrCleanOnly('No mappable rows were found. Check that device IDs and coordinates are populated.');
  }

  return {
    fileName,
    headers: state.headers,
    columns: state.columns,
    observations: state.observations,
    mappedRows: state.mappedRows,
    skippedRows: state.skippedRows,
    rowCount: state.rowNumber,
    devices: analyzeDevices(state.observations),
    cleanOnly: false,
    cleanerFormat: state.cleanerFormat
  };
}

export function parseShadowViewCsvText(csvText, fileName = 'uploaded.csv', onProgress = () => {}, options = {}) {
  const state = createParseState(onProgress);
  const result = Papa.parse(csvText, {
    skipEmptyLines: true
  });

  if (result.errors.length) {
    throw new Error(result.errors[0].message);
  }

  ingestRows(result.data, state);
  return finishParse(state, fileName, options);
}

export function parseShadowViewCsv(file, onProgress = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    const state = createParseState(onProgress);
    let failed = false;

    Papa.parse(file, {
      worker: true,
      skipEmptyLines: true,
      chunkSize: 1024 * 1024,
      chunk(results, parser) {
        try {
          ingestRows(results.data, state);
        } catch (error) {
          failed = true;
          parser.abort();
          reject(error);
        }
      },
      complete() {
        if (failed) {
          return;
        }

        try {
          resolve(finishParse(state, file.name, options));
        } catch (error) {
          reject(error);
        }
      },
      error(error) {
        reject(error);
      }
    });
  });
}
