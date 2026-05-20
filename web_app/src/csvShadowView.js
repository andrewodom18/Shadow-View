import Papa from 'papaparse';

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
  const points = observations
    .filter(
      (observation) =>
        observation.deviceId === deviceId && (!includedRowNumbers || includedRowNumbers.has(observation.rowNumber))
    )
    .slice()
    .sort(compareByTime)
    .map((observation, index) => ({
      ...observation.original,
      __row_number: observation.rowNumber,
      __device_id: observation.deviceId,
      __latitude: observation.latitude,
      __longitude: observation.longitude,
      __event_time: observation.timeRaw,
      __event_time_iso: Number.isFinite(observation.timeMs) ? new Date(observation.timeMs).toISOString() : '',
      __sequence: index + 1,
      __mgrs: observation.mgrs,
      __detection_radius_meters: observation.detectionRadius
    }));

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

  return {points, segments};
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
    state.observations.push({
      rowNumber: state.rowNumber,
      deviceId: deviceValue,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      timeRaw,
      timeMs,
      mgrs: String(valueFromHeaders(row, state.columns.mgrsHeaders)).trim(),
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
