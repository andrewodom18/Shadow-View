export const DEFAULT_THREAT_CONFIG = Object.freeze({
  enabled: true,
  sameLocationMeters: 50,
  maxDetectionRadiusMeters: 100,
  maxAccuracyMeters: 100,
  minScansLow: 3,
  minDurationMinutesLow: 5,
  minUniqueLocationsLow: 1,
  minPathSpanMetersLow: 0,
  minScansMedium: 4,
  minDurationMinutesMedium: 20,
  minUniqueLocationsMedium: 2,
  minPathSpanMetersMedium: 100,
  minScansHigh: 6,
  minDurationMinutesHigh: 45,
  minUniqueLocationsHigh: 3,
  minPathSpanMetersHigh: 250,
  notifyAtSeverity: 'medium',
  maxThreatsToShow: 10
});

const STORAGE_KEY = 'shadow-view-threat-config-v1';
const CONFIG_URL = '/threat-detection-config.json';
const SEVERITIES = new Set(['low', 'medium', 'high']);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function toPositiveNumber(value, fallback, {allowZero = false} = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  if (allowZero ? number < 0 : number <= 0) {
    return fallback;
  }
  return number;
}

function toPositiveInteger(value, fallback, {allowZero = false} = {}) {
  return Math.round(toPositiveNumber(value, fallback, {allowZero}));
}

export function normalizeThreatConfig(rawConfig = {}) {
  const sourceConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const merged = {...DEFAULT_THREAT_CONFIG, ...sourceConfig};
  const notifyAtSeverity = String(merged.notifyAtSeverity || '').toLowerCase();
  const radiusSource = hasOwn(sourceConfig, 'maxDetectionRadiusMeters')
    ? sourceConfig.maxDetectionRadiusMeters
    : hasOwn(sourceConfig, 'maxAccuracyMeters')
      ? sourceConfig.maxAccuracyMeters
      : DEFAULT_THREAT_CONFIG.maxDetectionRadiusMeters;
  const maxDetectionRadiusMeters = toPositiveNumber(
    radiusSource,
    DEFAULT_THREAT_CONFIG.maxDetectionRadiusMeters
  );

  return {
    enabled: Boolean(merged.enabled),
    sameLocationMeters: toPositiveNumber(merged.sameLocationMeters, DEFAULT_THREAT_CONFIG.sameLocationMeters),
    maxDetectionRadiusMeters,
    maxAccuracyMeters: maxDetectionRadiusMeters,
    minScansLow: toPositiveInteger(merged.minScansLow, DEFAULT_THREAT_CONFIG.minScansLow),
    minDurationMinutesLow: toPositiveNumber(
      merged.minDurationMinutesLow,
      DEFAULT_THREAT_CONFIG.minDurationMinutesLow,
      {allowZero: true}
    ),
    minUniqueLocationsLow: toPositiveInteger(
      merged.minUniqueLocationsLow,
      DEFAULT_THREAT_CONFIG.minUniqueLocationsLow
    ),
    minPathSpanMetersLow: toPositiveNumber(
      merged.minPathSpanMetersLow,
      DEFAULT_THREAT_CONFIG.minPathSpanMetersLow,
      {allowZero: true}
    ),
    minScansMedium: toPositiveInteger(merged.minScansMedium, DEFAULT_THREAT_CONFIG.minScansMedium),
    minDurationMinutesMedium: toPositiveNumber(
      merged.minDurationMinutesMedium,
      DEFAULT_THREAT_CONFIG.minDurationMinutesMedium,
      {allowZero: true}
    ),
    minUniqueLocationsMedium: toPositiveInteger(
      merged.minUniqueLocationsMedium,
      DEFAULT_THREAT_CONFIG.minUniqueLocationsMedium
    ),
    minPathSpanMetersMedium: toPositiveNumber(
      merged.minPathSpanMetersMedium,
      DEFAULT_THREAT_CONFIG.minPathSpanMetersMedium,
      {allowZero: true}
    ),
    minScansHigh: toPositiveInteger(merged.minScansHigh, DEFAULT_THREAT_CONFIG.minScansHigh),
    minDurationMinutesHigh: toPositiveNumber(
      merged.minDurationMinutesHigh,
      DEFAULT_THREAT_CONFIG.minDurationMinutesHigh,
      {allowZero: true}
    ),
    minUniqueLocationsHigh: toPositiveInteger(
      merged.minUniqueLocationsHigh,
      DEFAULT_THREAT_CONFIG.minUniqueLocationsHigh
    ),
    minPathSpanMetersHigh: toPositiveNumber(
      merged.minPathSpanMetersHigh,
      DEFAULT_THREAT_CONFIG.minPathSpanMetersHigh,
      {allowZero: true}
    ),
    notifyAtSeverity: SEVERITIES.has(notifyAtSeverity)
      ? notifyAtSeverity
      : DEFAULT_THREAT_CONFIG.notifyAtSeverity,
    maxThreatsToShow: toPositiveInteger(merged.maxThreatsToShow, DEFAULT_THREAT_CONFIG.maxThreatsToShow)
  };
}

function readStoredThreatConfig() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

async function readFileThreatConfig(signal) {
  try {
    const response = await fetch(CONFIG_URL, {signal, cache: 'no-cache'});
    if (!response.ok) {
      return {};
    }
    return await response.json();
  } catch {
    return {};
  }
}

export async function loadThreatConfig(signal) {
  const fileConfig = await readFileThreatConfig(signal);
  const baseConfig = normalizeThreatConfig(fileConfig);
  const userConfig = readStoredThreatConfig();
  const mergedConfig = {...baseConfig, ...userConfig};
  if (hasOwn(userConfig, 'maxAccuracyMeters') && !hasOwn(userConfig, 'maxDetectionRadiusMeters')) {
    mergedConfig.maxDetectionRadiusMeters = userConfig.maxAccuracyMeters;
  }

  return {
    baseConfig,
    config: normalizeThreatConfig(mergedConfig)
  };
}

export function saveThreatConfig(config) {
  const normalized = normalizeThreatConfig(config);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
  return normalized;
}

export function clearSavedThreatConfig() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore restricted storage; callers still receive the base config.
  }
}
