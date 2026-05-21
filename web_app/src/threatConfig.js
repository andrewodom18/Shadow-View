export const DEFAULT_THREAT_CONFIG = Object.freeze({
  enabled: true,
  sameLocationMeters: 50,
  maxDetectionRadiusMeters: 50,
  minScansLow: 4,
  maxScansLow: 11,
  minDurationMinutesLow: 30,
  minPathSpanMetersLow: 250,
  minScansMedium: 12,
  maxScansMedium: 18,
  minDurationMinutesMedium: 90,
  minPathSpanMetersMedium: 750,
  minScansHigh: 19,
  maxScansHigh: 25,
  minDurationMinutesHigh: 180,
  minPathSpanMetersHigh: 1250,
  maxThreatsToShow: 10
});

const STORAGE_KEY = 'shadow-view-threat-config-v3';
const CONFIG_URL = '/threat-detection-config.json';

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

function toOptionalPositiveInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.round(number);
}

function normalizeScanRange(merged, suffix) {
  const minName = `minScans${suffix}`;
  const maxName = `maxScans${suffix}`;
  const minScans = toPositiveInteger(merged[minName], DEFAULT_THREAT_CONFIG[minName]);
  const maxScans = toOptionalPositiveInteger(merged[maxName], DEFAULT_THREAT_CONFIG[maxName]);

  return {
    [minName]: minScans,
    [maxName]: maxScans === null ? null : Math.max(minScans, maxScans)
  };
}

export function normalizeThreatConfig(rawConfig = {}) {
  const merged = {
    ...DEFAULT_THREAT_CONFIG,
    ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {})
  };
  const maxDetectionRadiusMeters = toPositiveNumber(
    merged.maxDetectionRadiusMeters,
    DEFAULT_THREAT_CONFIG.maxDetectionRadiusMeters
  );

  return {
    enabled: Boolean(merged.enabled),
    sameLocationMeters: toPositiveNumber(merged.sameLocationMeters, DEFAULT_THREAT_CONFIG.sameLocationMeters),
    maxDetectionRadiusMeters,
    ...normalizeScanRange(merged, 'Low'),
    minDurationMinutesLow: toPositiveNumber(
      merged.minDurationMinutesLow,
      DEFAULT_THREAT_CONFIG.minDurationMinutesLow,
      {allowZero: true}
    ),
    minPathSpanMetersLow: toPositiveNumber(
      merged.minPathSpanMetersLow,
      DEFAULT_THREAT_CONFIG.minPathSpanMetersLow,
      {allowZero: true}
    ),
    ...normalizeScanRange(merged, 'Medium'),
    minDurationMinutesMedium: toPositiveNumber(
      merged.minDurationMinutesMedium,
      DEFAULT_THREAT_CONFIG.minDurationMinutesMedium,
      {allowZero: true}
    ),
    minPathSpanMetersMedium: toPositiveNumber(
      merged.minPathSpanMetersMedium,
      DEFAULT_THREAT_CONFIG.minPathSpanMetersMedium,
      {allowZero: true}
    ),
    ...normalizeScanRange(merged, 'High'),
    minDurationMinutesHigh: toPositiveNumber(
      merged.minDurationMinutesHigh,
      DEFAULT_THREAT_CONFIG.minDurationMinutesHigh,
      {allowZero: true}
    ),
    minPathSpanMetersHigh: toPositiveNumber(
      merged.minPathSpanMetersHigh,
      DEFAULT_THREAT_CONFIG.minPathSpanMetersHigh,
      {allowZero: true}
    ),
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

  return {
    baseConfig,
    config: normalizeThreatConfig({...baseConfig, ...userConfig})
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
