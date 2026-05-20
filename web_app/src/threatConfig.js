export const DEFAULT_THREAT_CONFIG = Object.freeze({
  enabled: true,
  sameLocationMeters: 50,
  maxDetectionRadiusMeters: 50,
  maxAccuracyMeters: 50,
  minScansLow: 8,
  minDurationMinutesLow: 30,
  minUniqueLocationsLow: 8,
  minPathSpanMetersLow: 250,
  minScansMedium: 12,
  minDurationMinutesMedium: 90,
  minUniqueLocationsMedium: 12,
  minPathSpanMetersMedium: 750,
  minScansHigh: 25,
  minDurationMinutesHigh: 180,
  minUniqueLocationsHigh: 25,
  minPathSpanMetersHigh: 1250,
  notifyAtSeverity: 'high',
  maxThreatsToShow: 10
});

const STORAGE_KEY = 'shadow-view-threat-config-v3';
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

function thresholdValue(sourceConfig, merged, scanKey, locationKey) {
  const value = hasOwn(sourceConfig, scanKey)
    ? merged[scanKey]
    : hasOwn(sourceConfig, locationKey)
      ? merged[locationKey]
      : DEFAULT_THREAT_CONFIG[scanKey];
  return toPositiveInteger(value, DEFAULT_THREAT_CONFIG[scanKey]);
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
  const minScansLow = thresholdValue(sourceConfig, merged, 'minScansLow', 'minUniqueLocationsLow');
  const minScansMedium = thresholdValue(sourceConfig, merged, 'minScansMedium', 'minUniqueLocationsMedium');
  const minScansHigh = thresholdValue(sourceConfig, merged, 'minScansHigh', 'minUniqueLocationsHigh');

  return {
    enabled: Boolean(merged.enabled),
    sameLocationMeters: toPositiveNumber(merged.sameLocationMeters, DEFAULT_THREAT_CONFIG.sameLocationMeters),
    maxDetectionRadiusMeters,
    maxAccuracyMeters: maxDetectionRadiusMeters,
    minScansLow,
    minDurationMinutesLow: toPositiveNumber(
      merged.minDurationMinutesLow,
      DEFAULT_THREAT_CONFIG.minDurationMinutesLow,
      {allowZero: true}
    ),
    minUniqueLocationsLow: minScansLow,
    minPathSpanMetersLow: toPositiveNumber(
      merged.minPathSpanMetersLow,
      DEFAULT_THREAT_CONFIG.minPathSpanMetersLow,
      {allowZero: true}
    ),
    minScansMedium,
    minDurationMinutesMedium: toPositiveNumber(
      merged.minDurationMinutesMedium,
      DEFAULT_THREAT_CONFIG.minDurationMinutesMedium,
      {allowZero: true}
    ),
    minUniqueLocationsMedium: minScansMedium,
    minPathSpanMetersMedium: toPositiveNumber(
      merged.minPathSpanMetersMedium,
      DEFAULT_THREAT_CONFIG.minPathSpanMetersMedium,
      {allowZero: true}
    ),
    minScansHigh,
    minDurationMinutesHigh: toPositiveNumber(
      merged.minDurationMinutesHigh,
      DEFAULT_THREAT_CONFIG.minDurationMinutesHigh,
      {allowZero: true}
    ),
    minUniqueLocationsHigh: minScansHigh,
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
