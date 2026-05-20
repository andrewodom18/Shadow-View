const MGRS_PATTERN = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-Z])(\d*)$/;
const LATITUDE_BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const COLUMN_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_SETS = ['ABCDEFGHJKLMNPQRSTUV', 'FGHJKLMNPQRSTUVABCDE'];
const MIN_NORTHING_BY_BAND = {
  C: 1100000,
  D: 2000000,
  E: 2800000,
  F: 3700000,
  G: 4600000,
  H: 5500000,
  J: 6400000,
  K: 7300000,
  L: 8200000,
  M: 9100000,
  N: 0,
  P: 800000,
  Q: 1700000,
  R: 2600000,
  S: 3500000,
  T: 4400000,
  U: 5300000,
  V: 6200000,
  W: 7000000,
  X: 7900000
};
const WGS84_A = 6378137.0;
const WGS84_ECC_SQUARED = 0.00669438;
const UTM_K0 = 0.9996;
const EARTH_RADIUS_METERS = 6371008.8;
const SEVERITY_RANK = {none: 0, low: 1, medium: 2, high: 3};

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

export function parseMgrs(value) {
  const cleaned = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
  if (!cleaned) {
    return null;
  }

  const match = cleaned.match(MGRS_PATTERN);
  if (!match) {
    return null;
  }

  const zone = Number(match[1]);
  const band = match[2];
  const columnLetter = match[3];
  const rowLetter = match[4];
  const digits = match[5];

  if (zone < 1 || zone > 60 || !LATITUDE_BANDS.includes(band) || digits.length > 10 || digits.length % 2 !== 0) {
    return null;
  }

  const columnSet = COLUMN_SETS[(zone - 1) % 3];
  const rowSet = ROW_SETS[(zone - 1) % 2];
  if (!columnSet.includes(columnLetter) || !rowSet.includes(rowLetter)) {
    return null;
  }

  const precision = digits.length / 2;
  const scale = 10 ** (5 - precision);
  const eastingDigits = digits.slice(0, precision);
  const northingDigits = digits.slice(precision);
  const eastingOffset = eastingDigits ? Number(eastingDigits) * scale : 0;
  const northingOffset = northingDigits ? Number(northingDigits) * scale : 0;

  let northing = rowSet.indexOf(rowLetter) * 100000 + northingOffset;
  const minNorthing = MIN_NORTHING_BY_BAND[band];
  while (northing < minNorthing) {
    northing += 2000000;
  }

  return {
    raw: cleaned,
    zone,
    band,
    hemisphere: band >= 'N' ? 'N' : 'S',
    easting: (columnSet.indexOf(columnLetter) + 1) * 100000 + eastingOffset,
    northing
  };
}

export function mgrsDistanceMeters(first, second) {
  if (first.zone === second.zone && first.hemisphere === second.hemisphere) {
    return Math.hypot(first.easting - second.easting, first.northing - second.northing);
  }

  return haversineMeters(utmToLatLon(first), utmToLatLon(second));
}

function utmToLatLon(point) {
  const x = point.easting - 500000.0;
  let y = point.northing;
  if (point.hemisphere === 'S') {
    y -= 10000000.0;
  }

  const eccPrimeSquared = WGS84_ECC_SQUARED / (1.0 - WGS84_ECC_SQUARED);
  const lonOrigin = (point.zone - 1) * 6 - 180 + 3;
  const m = y / UTM_K0;
  const mu =
    m /
    (WGS84_A *
      (1.0 -
        WGS84_ECC_SQUARED / 4.0 -
        (3.0 * WGS84_ECC_SQUARED ** 2) / 64.0 -
        (5.0 * WGS84_ECC_SQUARED ** 3) / 256.0));

  const e1 =
    (1.0 - Math.sqrt(1.0 - WGS84_ECC_SQUARED)) /
    (1.0 + Math.sqrt(1.0 - WGS84_ECC_SQUARED));
  const phi1 =
    mu +
    ((3.0 * e1) / 2.0 - (27.0 * e1 ** 3) / 32.0) * Math.sin(2.0 * mu) +
    ((21.0 * e1 ** 2) / 16.0 - (55.0 * e1 ** 4) / 32.0) * Math.sin(4.0 * mu) +
    ((151.0 * e1 ** 3) / 96.0) * Math.sin(6.0 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const n1 = WGS84_A / Math.sqrt(1.0 - WGS84_ECC_SQUARED * sinPhi1 ** 2);
  const t1 = tanPhi1 ** 2;
  const c1 = eccPrimeSquared * cosPhi1 ** 2;
  const r1 =
    (WGS84_A * (1.0 - WGS84_ECC_SQUARED)) /
    (1.0 - WGS84_ECC_SQUARED * sinPhi1 ** 2) ** 1.5;
  const d = x / (n1 * UTM_K0);

  const lat =
    phi1 -
    ((n1 * tanPhi1) / r1) *
      (d ** 2 / 2.0 -
        ((5.0 + 3.0 * t1 + 10.0 * c1 - 4.0 * c1 ** 2 - 9.0 * eccPrimeSquared) * d ** 4) / 24.0 +
        ((61.0 +
          90.0 * t1 +
          298.0 * c1 +
          45.0 * t1 ** 2 -
          252.0 * eccPrimeSquared -
          3.0 * c1 ** 2) *
          d ** 6) /
          720.0);
  const lon =
    (lonOrigin * Math.PI) / 180.0 +
    (d -
      ((1.0 + 2.0 * t1 + c1) * d ** 3) / 6.0 +
      ((5.0 -
        2.0 * c1 +
        28.0 * t1 -
        3.0 * c1 ** 2 +
        8.0 * eccPrimeSquared +
        24.0 * t1 ** 2) *
        d ** 5) /
        120.0) /
      cosPhi1;

  return {
    latitude: (lat * 180.0) / Math.PI,
    longitude: (lon * 180.0) / Math.PI
  };
}

function haversineMeters(first, second) {
  const firstLat = (first.latitude * Math.PI) / 180.0;
  const firstLon = (first.longitude * Math.PI) / 180.0;
  const secondLat = (second.latitude * Math.PI) / 180.0;
  const secondLon = (second.longitude * Math.PI) / 180.0;
  const deltaLat = secondLat - firstLat;
  const deltaLon = secondLon - firstLon;
  const haversine =
    Math.sin(deltaLat / 2.0) ** 2 +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(deltaLon / 2.0) ** 2;
  return EARTH_RADIUS_METERS * 2.0 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1.0 - haversine));
}

function clusterPoints(points, sameLocationMeters) {
  const clusters = [];

  for (const point of points) {
    const matchingIndexes = clusters
      .map((cluster, index) =>
        cluster.some((existing) => mgrsDistanceMeters(point, existing) <= sameLocationMeters) ? index : -1
      )
      .filter((index) => index >= 0);

    if (!matchingIndexes.length) {
      clusters.push([point]);
      continue;
    }

    const targetIndex = matchingIndexes[0];
    clusters[targetIndex].push(point);
    for (const index of matchingIndexes.slice(1).reverse()) {
      clusters[targetIndex].push(...clusters[index]);
      clusters.splice(index, 1);
    }
  }

  return clusters;
}

function maxPairDistanceMeters(points) {
  let maxDistance = 0;
  for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
      maxDistance = Math.max(maxDistance, mgrsDistanceMeters(points[firstIndex], points[secondIndex]));
    }
  }
  return maxDistance;
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = values.slice().sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function distinctValues(values) {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))).sort((first, second) =>
    first.localeCompare(second)
  );
}

function evaluateSeverity(metrics, config) {
  const checks = {
    high:
      metrics.scanCount >= config.minScansHigh &&
      metrics.durationMinutes >= config.minDurationMinutesHigh &&
      metrics.uniqueLocationCount >= config.minUniqueLocationsHigh &&
      metrics.pathSpanMeters >= config.minPathSpanMetersHigh,
    medium:
      metrics.scanCount >= config.minScansMedium &&
      metrics.durationMinutes >= config.minDurationMinutesMedium &&
      metrics.uniqueLocationCount >= config.minUniqueLocationsMedium &&
      metrics.pathSpanMeters >= config.minPathSpanMetersMedium,
    low:
      metrics.scanCount >= config.minScansLow &&
      metrics.durationMinutes >= config.minDurationMinutesLow &&
      metrics.uniqueLocationCount >= config.minUniqueLocationsLow &&
      metrics.pathSpanMeters >= config.minPathSpanMetersLow
  };

  if (checks.high) {
    return 'high';
  }
  if (checks.medium) {
    return 'medium';
  }
  if (checks.low) {
    return 'low';
  }
  return 'none';
}

function formatMeters(value) {
  if (!Number.isFinite(value)) {
    return '0m';
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}km`;
  }
  return `${Math.round(value)}m`;
}

function formatMinutes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 minutes';
  }
  if (value >= 60) {
    return `${(value / 60).toFixed(1)} hours`;
  }
  return `${Math.round(value)} minutes`;
}

function buildReason(metrics) {
  const accuracyCopy =
    metrics.medianAccuracyMeters === null ? 'accuracy unavailable' : `median accuracy ${formatMeters(metrics.medianAccuracyMeters)}`;

  return `Seen ${metrics.scanCount} times across ${metrics.uniqueLocationCount} locations over ${formatMinutes(
    metrics.durationMinutes
  )}, spanning ${formatMeters(metrics.pathSpanMeters)} with ${accuracyCopy}.`;
}

export function analyzeThreats(observations, config) {
  if (!config.enabled) {
    return [];
  }

  const grouped = new Map();
  for (const observation of observations) {
    const bssid = String(observation.deviceId ?? '').trim();
    if (!bssid) {
      continue;
    }
    if (!grouped.has(bssid)) {
      grouped.set(bssid, []);
    }
    grouped.get(bssid).push(observation);
  }

  const threats = [];
  for (const [bssid, rows] of grouped.entries()) {
    const qualifiedRows = rows
      .map((row) => ({
        row,
        point: parseMgrs(row.mgrs),
        accuracy: row.accuracy === null || row.accuracy === undefined ? NaN : Number(row.accuracy)
      }))
      .filter(
        ({point, accuracy}) =>
          point !== null && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= config.maxAccuracyMeters
      );

    if (!qualifiedRows.length) {
      continue;
    }

    const points = qualifiedRows.map(({point}) => point);
    const timeValues = qualifiedRows.map(({row}) => row.timeMs).filter(Number.isFinite);
    const firstTimeMs = timeValues.length ? Math.min(...timeValues) : null;
    const lastTimeMs = timeValues.length ? Math.max(...timeValues) : null;
    const durationMinutes = firstTimeMs !== null && lastTimeMs !== null ? (lastTimeMs - firstTimeMs) / 60000 : 0;
    const clusters = clusterPoints(points, config.sameLocationMeters);
    const metrics = {
      scanCount: qualifiedRows.length,
      rawScanCount: rows.length,
      ignoredScanCount: rows.length - qualifiedRows.length,
      uniqueLocationCount: clusters.length,
      durationMinutes,
      pathSpanMeters: maxPairDistanceMeters(points),
      medianAccuracyMeters: median(qualifiedRows.map(({accuracy}) => accuracy)),
      firstTimeMs,
      lastTimeMs
    };
    const severity = evaluateSeverity(metrics, config);

    if (severity === 'none') {
      continue;
    }

    threats.push({
      bssid,
      ssids: distinctValues(qualifiedRows.map(({row}) => row.ssid)),
      severity,
      rank: severityRank(severity),
      reason: buildReason(metrics),
      metrics
    });
  }

  return threats.sort((first, second) => {
    return (
      second.rank - first.rank ||
      second.metrics.scanCount - first.metrics.scanCount ||
      second.metrics.durationMinutes - first.metrics.durationMinutes ||
      first.bssid.localeCompare(second.bssid)
    );
  });
}

export function threatSummary(threats, notifyAtSeverity) {
  const notifyRank = severityRank(notifyAtSeverity);
  const notifyingThreats = threats.filter((threat) => threat.rank >= notifyRank);
  if (!notifyingThreats.length) {
    return null;
  }

  return {
    count: notifyingThreats.length,
    highestSeverity: notifyingThreats[0].severity,
    highCount: notifyingThreats.filter((threat) => threat.severity === 'high').length,
    mediumCount: notifyingThreats.filter((threat) => threat.severity === 'medium').length,
    lowCount: notifyingThreats.filter((threat) => threat.severity === 'low').length
  };
}
