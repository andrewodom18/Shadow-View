import Papa from 'papaparse';

const DEVICE_ALIASES = ['bssid', 'bssid_1', 'bssid (2)', 'device bssid'];
const FALLBACK_DEVICE_ALIASES = ['device name', 'eci', 'document id'];
const TIME_ALIASES = ['event time', 'device time', 'last updated'];
const LAT_ALIASES = ['latitude', 'lat'];
const LON_ALIASES = ['longitude', 'lon', 'lng'];
const LAT_LON_ALIASES = ['location (lat/lon)', 'location lat/lon', 'lat/lon'];
const MGRS_ALIASES = ['mgrs', 'location (mgrs)'];

export function normalizeHeader(value) {
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

function findHeader(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.find((header) => normalizedAliases.includes(header.normalized)) ?? null;
}

function findAnyHeader(headers, aliasGroups) {
  for (const aliases of aliasGroups) {
    const match = findHeader(headers, aliases);
    if (match) {
      return match;
    }
  }
  return null;
}

function parseNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(String(value).trim());
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

function detectColumns(headers) {
  const deviceHeader = findAnyHeader(headers, [DEVICE_ALIASES, FALLBACK_DEVICE_ALIASES]);
  const timeHeader = findHeader(headers, TIME_ALIASES);
  const latHeader = findHeader(headers, LAT_ALIASES);
  const lonHeader = findHeader(headers, LON_ALIASES);
  const latLonHeader = findHeader(headers, LAT_LON_ALIASES);
  const mgrsHeader = findHeader(headers, MGRS_ALIASES);

  return {
    deviceHeader,
    timeHeader,
    latHeader,
    lonHeader,
    latLonHeader,
    mgrsHeader
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
  const latitude = parseNumber(valueFromHeader(row, columns.latHeader));
  const longitude = parseNumber(valueFromHeader(row, columns.lonHeader));
  if (latitude !== null && longitude !== null) {
    return {latitude, longitude};
  }

  return parseLatLonPair(valueFromHeader(row, columns.latLonHeader));
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

export function analyzeDevices(observations) {
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

export function prepareDeviceMapData(observations, deviceId) {
  const points = observations
    .filter((observation) => observation.deviceId === deviceId)
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
      __mgrs: observation.mgrs
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
      continue;
    }

    state.rowNumber += 1;
    const row = rowToObject(rawRow, state.headers);
    const coordinates = extractCoordinates(row, state.columns);
    const deviceValue = String(valueFromHeader(row, state.columns.deviceHeader)).trim();

    if (!coordinates || !deviceValue) {
      state.skippedRows += 1;
      continue;
    }

    const timeRaw = String(valueFromHeader(row, state.columns.timeHeader)).trim();
    const timeMs = parseTime(timeRaw);
    state.observations.push({
      rowNumber: state.rowNumber,
      deviceId: deviceValue,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      timeRaw,
      timeMs,
      mgrs: String(valueFromHeader(row, state.columns.mgrsHeader)).trim(),
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

function finishParse(state, fileName) {
  if (!state.headers) {
    throw new Error('The selected CSV is empty.');
  }
  if (!state.columns?.deviceHeader) {
    throw new Error('Could not find a BSSID column or a supported device identifier column.');
  }
  if ((!state.columns?.latHeader || !state.columns?.lonHeader) && !state.columns?.latLonHeader) {
    throw new Error('Could not find Latitude/Longitude or Location (Lat/Lon) columns.');
  }
  if (!state.observations.length) {
    throw new Error('No mappable rows were found. Check that device IDs and coordinates are populated.');
  }

  return {
    fileName,
    headers: state.headers,
    columns: state.columns,
    observations: state.observations,
    mappedRows: state.mappedRows,
    skippedRows: state.skippedRows,
    devices: analyzeDevices(state.observations)
  };
}

export function parseShadowViewCsvText(csvText, fileName = 'uploaded.csv', onProgress = () => {}) {
  const state = createParseState(onProgress);
  const result = Papa.parse(csvText, {
    skipEmptyLines: true
  });

  if (result.errors.length) {
    throw new Error(result.errors[0].message);
  }

  ingestRows(result.data, state);
  return finishParse(state, fileName);
}

export function parseShadowViewCsv(file, onProgress = () => {}) {
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
          resolve(finishParse(state, file.name));
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
