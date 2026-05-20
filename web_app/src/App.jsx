import {KeplerGl} from '@kepler.gl/components';
import {addDataToMap, onLayerClick, removeDataset} from '@kepler.gl/actions';
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Upload,
  WifiOff,
  X
} from 'lucide-react';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';

import {cleanCsvWithBackend, downloadBlob, fetchCleanerProfiles} from './cleanerApi.js';
import {formatTime, parseShadowViewCsv, parseShadowViewCsvText, prepareDeviceMapData} from './csvShadowView.js';
import {CUSTOM_MAP_STYLES, POINTS_DATASET_ID, TRAIL_DATASET_ID, createKeplerPayload} from './keplerConfig.js';
import {
  KEPLER_MAP_ID,
  clickedPoint,
  keplerInstance,
  mapClickInfoForPoint,
  pointIndexByRowNumber,
  pointLayerIndex
} from './mapSelection.js';
import {countBySeverity, deviceMatchesSearch, searchTerm, threatMatchesSearch} from './searchFilters.js';
import {clearSavedThreatConfig, loadThreatConfig, normalizeThreatConfig, saveThreatConfig} from './threatConfig.js';
import {analyzeThreats} from './threatDetection.js';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'shadow-view-local';
const SIGHTING_LIST_LIMIT = 150;
const CSV_SESSION_STORAGE_KEY = 'shadow-view-current-csv-id-v1';
const CSV_SESSION_DB_NAME = 'shadow-view-csv-session';
const CSV_SESSION_DB_VERSION = 1;
const CSV_SESSION_STORE_NAME = 'csvFiles';

function getCsvSessionId() {
  try {
    return window.sessionStorage.getItem(CSV_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setCsvSessionId(id) {
  try {
    window.sessionStorage.setItem(CSV_SESSION_STORAGE_KEY, id);
  } catch {}
}

function clearCsvSessionId() {
  try {
    window.sessionStorage.removeItem(CSV_SESSION_STORAGE_KEY);
  } catch {}
}

function createCsvSessionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openCsvSessionDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }

    const request = window.indexedDB.open(CSV_SESSION_DB_NAME, CSV_SESSION_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CSV_SESSION_STORE_NAME)) {
        db.createObjectStore(CSV_SESSION_STORE_NAME, {keyPath: 'id'});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open CSV session storage.'));
  });
}

async function putCsvSessionRecord(record) {
  const db = await openCsvSessionDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CSV_SESSION_STORE_NAME, 'readwrite');
    transaction.objectStore(CSV_SESSION_STORE_NAME).put(record);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('Could not store CSV session.'));
    };
  });
}

async function getCsvSessionRecord(id) {
  const db = await openCsvSessionDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CSV_SESSION_STORE_NAME, 'readonly');
    const request = transaction.objectStore(CSV_SESSION_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('Could not restore CSV session.'));
    };
  });
}

async function deleteCsvSessionRecord(id) {
  const db = await openCsvSessionDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CSV_SESSION_STORE_NAME, 'readwrite');
    transaction.objectStore(CSV_SESSION_STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('Could not clear CSV session.'));
    };
  });
}

async function persistCsvFileForSession(file, result, shouldKeep = () => true) {
  const id = getCsvSessionId() || createCsvSessionId();
  await putCsvSessionRecord({
    id,
    file,
    result,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    updatedAt: Date.now()
  });
  if (shouldKeep()) {
    setCsvSessionId(id);
  } else {
    await deleteCsvSessionRecord(id);
  }
}

async function restoreCsvSessionFromStorage() {
  const id = getCsvSessionId();
  if (!id) {
    return null;
  }

  const record = await getCsvSessionRecord(id);
  if (!record?.file || !record?.result) {
    clearCsvSessionId();
    return null;
  }

  const file = new File([record.file], record.name || 'uploaded.csv', {
    type: record.type || 'text/csv',
    lastModified: record.lastModified || record.updatedAt || Date.now()
  });
  return {
    file,
    result: record.result
  };
}

async function clearPersistedCsvSession() {
  const id = getCsvSessionId();
  clearCsvSessionId();
  if (id) {
    await deleteCsvSessionRecord(id);
  }
}

function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({width: 800, height: 600});

  useEffect(() => {
    if (!ref.current) {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setSize({
        width: Math.max(320, Math.round(rect.width)),
        height: Math.max(320, Math.round(rect.height))
      });
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

function Stat({label, value}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function displayNameFromUrl(value, fallback = 'sample.csv') {
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === 'data:') {
      return fallback;
    }
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || fallback);
  } catch {
    const name = value.split('/').filter(Boolean).pop();
    return name && name.length < 80 ? name : fallback;
  }
}

function cleanerStatusMessage(caughtError) {
  const message = caughtError instanceof Error ? caughtError.message : String(caughtError || '');
  if (/bad gateway|failed to fetch|load failed|networkerror|proxy/i.test(message)) {
    return 'Cleaner backend offline.';
  }
  return message || 'Cleaner backend offline.';
}

function OutputToggle({checked, disabled, icon: Icon, label, onChange}) {
  return (
    <label className={checked ? 'output-toggle active' : 'output-toggle'}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <Icon aria-hidden="true" size={16} />
      <span>{label}</span>
    </label>
  );
}

function severityLabel(severity) {
  if (!severity) {
    return 'Normal';
  }
  return `${severity[0].toUpperCase()}${severity.slice(1)}`;
}

function formatDetectionRadius(value) {
  const radius = Number(value);
  return Number.isFinite(radius) ? `${Math.round(radius).toLocaleString()}m radius` : '';
}

function scannerSightingMeta(point) {
  const location = `${point.__latitude.toFixed(6)}, ${point.__longitude.toFixed(6)}`;
  const radius = formatDetectionRadius(point.__detection_radius_meters);
  return radius ? `${location} - ${radius}` : location;
}

function visibleSightingPoints(points, order) {
  if (order === 'newest') {
    return points.slice(-SIGHTING_LIST_LIMIT).reverse();
  }
  return points.slice(0, SIGHTING_LIST_LIMIT);
}

function SettingNumber({disabled, help, label, min = 0, step = 1, value, onChange}) {
  return (
    <label className="setting-field" title={help}>
      <span>{label}</span>
      <input
        aria-label={label}
        disabled={disabled}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        title={help}
        type="number"
        value={value}
      />
    </label>
  );
}

function SeveritySettings({config, disabled, label, level, onValue}) {
  const suffix = `${level[0].toUpperCase()}${level.slice(1)}`;

  return (
    <fieldset className="criteria-group">
      <legend>{label}</legend>
      <div className="settings-grid compact">
        <SettingNumber
          disabled={disabled}
          help="Minimum scanner-location clusters where this BSSID must appear. Repeated sightings inside the same location radius count once."
          label="Unique scans"
          min={1}
          value={config[`minScans${suffix}`]}
          onChange={(value) => onValue(`minScans${suffix}`, value)}
        />
        <SettingNumber
          disabled={disabled}
          help="Minimum elapsed time between the first and last qualifying sighting."
          label="Minutes"
          min={0}
          value={config[`minDurationMinutes${suffix}`]}
          onChange={(value) => onValue(`minDurationMinutes${suffix}`, value)}
        />
        <SettingNumber
          disabled={disabled}
          help="Minimum scanner path distance covered while this BSSID is still being detected."
          label="Path span (m)"
          min={0}
          value={config[`minPathSpanMeters${suffix}`]}
          onChange={(value) => onValue(`minPathSpanMeters${suffix}`, value)}
        />
      </div>
    </fieldset>
  );
}

function ThreatSettings({config, disabled, onChange, onReset}) {
  const setConfigValue = (name, value) => {
    onChange({...config, [name]: value});
  };

  return (
    <details className="threat-settings">
      <summary>
        <SlidersHorizontal aria-hidden="true" size={15} />
        <span>Threat Criteria</span>
        <ChevronDown aria-hidden="true" className="threat-settings-caret" size={18} />
      </summary>
      <div className="settings-grid criteria-basics">
        <label
          className="setting-field setting-toggle"
          title="Turn threat matching on or off for the loaded CSV."
        >
          <span>Detection</span>
          <input
            aria-label="Detection"
            checked={config.enabled}
            disabled={disabled}
            onChange={(event) => setConfigValue('enabled', event.target.checked)}
            title="Turn threat matching on or off for the loaded CSV."
            type="checkbox"
          />
        </label>
        <SettingNumber
          disabled={disabled}
          help="Scanner MGRS points within this distance count as the same location."
          label="Same location (m)"
          min={1}
          value={config.sameLocationMeters}
          onChange={(value) => setConfigValue('sameLocationMeters', value)}
        />
        <SettingNumber
          disabled={disabled}
          help="Only sightings with Accuracy at or below this radius qualify."
          label="Max radius (m)"
          min={1}
          value={config.maxDetectionRadiusMeters}
          onChange={(value) => setConfigValue('maxDetectionRadiusMeters', value)}
        />
        <SettingNumber
          disabled={disabled}
          help="Maximum number of matching BSSIDs shown in the threat list."
          label="Max list items"
          min={1}
          value={config.maxThreatsToShow}
          onChange={(value) => setConfigValue('maxThreatsToShow', value)}
        />
      </div>
      <SeveritySettings
        config={config}
        disabled={disabled}
        label="Low"
        level="low"
        onValue={setConfigValue}
      />
      <SeveritySettings
        config={config}
        disabled={disabled}
        label="Medium"
        level="medium"
        onValue={setConfigValue}
      />
      <SeveritySettings
        config={config}
        disabled={disabled}
        label="High"
        level="high"
        onValue={setConfigValue}
      />
      <button className="tertiary-button" disabled={disabled} onClick={onReset} type="button">
        <RotateCcw aria-hidden="true" size={14} />
        <span>Reset Criteria</span>
      </button>
    </details>
  );
}

function ThreatPanel({
  deviceOptions,
  filteredDeviceCount,
  filteredCount,
  onDeviceChange,
  onFilterChange,
  onSearchChange,
  onSelectThreat,
  searchValue,
  selectedDevice,
  selectedDeviceId,
  selectedDeviceOutsideFilter,
  selectedDeviceThreat,
  selectedThreatBssid,
  severityFilter,
  searchedDeviceCount,
  threatCounts,
  totalDeviceCount,
  threats,
  visibleThreats
}) {
  const visibleLabel = severityFilter === 'all' ? 'matches' : `${severityLabel(severityFilter).toLowerCase()} matches`;
  const hasSearch = searchTerm(searchValue) !== '';
  const hasDeviceFilter = hasSearch || severityFilter !== 'all';

  return (
    <section className="panel review-panel" aria-live="polite">
      <div className="section-heading">
        <h2>BSSID Review</h2>
        <span>{totalDeviceCount.toLocaleString()}</span>
      </div>
      <div className="severity-filter" role="group" aria-label="Threat severity filter">
        {['all', 'high', 'medium', 'low'].map((severity) => {
          const label = severity === 'all' ? 'All BSSIDs' : severityLabel(severity);
          const count = severity === 'all' ? searchedDeviceCount : (threatCounts[severity] ?? 0);
          return (
            <button
              aria-pressed={severityFilter === severity}
              className={`${severity} ${severityFilter === severity ? 'active' : ''}`.trim()}
              key={severity}
              onClick={() => onFilterChange(severity)}
              type="button"
            >
              <span>{label}</span>
              <strong>{count.toLocaleString()}</strong>
            </button>
          );
        })}
      </div>
      <label className="search-field">
        <span>Search BSSIDs</span>
        <input
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="BSSID or SSID"
          type="search"
          value={searchValue}
        />
      </label>
      <div className="device-picker">
        <select
          aria-label="Mapped BSSID"
          id="device-select"
          value={selectedDeviceId}
          onChange={(event) => onDeviceChange(event.target.value)}
        >
          {deviceOptions.map((device) => (
            <option key={device.id} value={device.id}>
              {device.currentOutsideFilter ? 'Current: ' : ''}
              {device.label}
              {device.threatSeverity ? ` [${severityLabel(device.threatSeverity)}]` : ''}
              {' '}({device.count.toLocaleString()})
            </option>
          ))}
        </select>
        {hasDeviceFilter && (
          <p className="list-note">
            {filteredDeviceCount > 0
              ? `Showing ${filteredDeviceCount.toLocaleString()} of ${totalDeviceCount.toLocaleString()} BSSIDs.${
                  selectedDeviceOutsideFilter ? ' Current selection is kept at top.' : ''
                }`
              : 'No BSSIDs match the current search and severity filter. The current map selection is unchanged.'}
          </p>
        )}
        {selectedDevice && (
          <p className="device-summary">
            {selectedDeviceThreat && (
              <>
                <span className={`severity-badge inline ${selectedDeviceThreat.severity}`}>
                  {severityLabel(selectedDeviceThreat.severity)}
                </span>{' '}
              </>
            )}
            {selectedDevice.count.toLocaleString()} sightings
            {selectedDevice.firstTimeMs !== null && (
              <> from {formatTime(selectedDevice.firstTimeMs)} to {formatTime(selectedDevice.lastTimeMs)}</>
            )}
          </p>
        )}
      </div>
      <div className="panel-subheading">
        <h3>Threat Indicators</h3>
        <span>{threats.length.toLocaleString()}</span>
      </div>
      {!threats.length && <p className="empty-state">No BSSIDs match the current criteria.</p>}
      {Boolean(filteredCount) && (
        <p className="list-note">
          Showing {visibleThreats.length.toLocaleString()} of {filteredCount.toLocaleString()} {visibleLabel}.
        </p>
      )}
      {!filteredCount && threats.length > 0 && (
        <p className="empty-state">No {visibleLabel}{hasSearch ? ' match the search.' : ' for the current criteria.'}</p>
      )}
      {Boolean(visibleThreats.length) && (
        <div className="threat-list">
          {visibleThreats.map((threat) => (
            <button
              className={`threat-item ${threat.severity}${selectedThreatBssid === threat.bssid ? ' active' : ''}`}
              key={threat.bssid}
              onClick={() => onSelectThreat(threat)}
              type="button"
            >
              <span className={`severity-badge ${threat.severity}`}>{severityLabel(threat.severity)}</span>
              <strong>{threat.bssid}</strong>
              {Boolean(threat.ssids.length) && <small>{threat.ssids.join(' | ')}</small>}
              <p>{threat.reason}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DetailTable({row}) {
  if (!row) {
    return <p className="empty-state">Select a sighting to inspect its CSV values.</p>;
  }

  const values = Object.entries(row).filter(([key, value]) => !key.startsWith('__') && value !== '');

  if (!values.length) {
    return <p className="empty-state">No populated CSV values for this sighting.</p>;
  }

  return (
    <div className="detail-table">
      {values.map(([key, value]) => (
        <div className="detail-row" key={key}>
          <dt>{key}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </div>
  );
}

function MapScopeStatus({pointCount, selectedDevice, selectedMapThreat, selectedPoint}) {
  if (!selectedDevice) {
    return null;
  }

  const severity = selectedMapThreat?.severity ?? '';
  const mode = selectedMapThreat ? 'Threat-qualified points' : 'Scanner points';

  return (
    <div className={`map-scope-status ${severity}`.trim()} aria-live="polite">
      <span>Map data</span>
      <strong>{selectedDevice.id}</strong>
      <small>
        {pointCount.toLocaleString()} {mode.toLowerCase()}
        {selectedPoint ? ` | Row ${selectedPoint.__row_number}` : ''}
      </small>
    </div>
  );
}

export default function App() {
  const dispatch = useDispatch();
  const clickedMapObject = useSelector((state) => keplerInstance(state)?.visState?.clicked ?? null);
  const selectedPointLayerIndex = useSelector((state) => pointLayerIndex(keplerInstance(state)));
  const [mapRef, mapSize] = useElementSize();
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedCsv, setParsedCsv] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedThreatBssid, setSelectedThreatBssid] = useState('');
  const [deviceMapData, setDeviceMapData] = useState({points: [], segments: []});
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [status, setStatus] = useState('Choose a CSV to map detections.');
  const [parseProgress, setParseProgress] = useState(null);
  const [csvReadSummary, setCsvReadSummary] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState('');
  const [detectedCleanerFormat, setDetectedCleanerFormat] = useState(null);
  const [cleanOutputs, setCleanOutputs] = useState({csv: true, xlsx: true, html: false});
  const [cleanerApi, setCleanerApi] = useState({available: false, loading: true, message: 'Checking cleaner API...'});
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanError, setCleanError] = useState('');
  const [downloadInfo, setDownloadInfo] = useState(null);
  const [baseThreatConfig, setBaseThreatConfig] = useState(() => normalizeThreatConfig());
  const [threatConfig, setThreatConfig] = useState(() => normalizeThreatConfig());
  const [threatSeverityFilter, setThreatSeverityFilter] = useState('all');
  const [reviewSearch, setReviewSearch] = useState('');
  const [sightingOrder, setSightingOrder] = useState('oldest');
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const fileInputRef = useRef(null);
  const loadRequestRef = useRef(0);

  const selectedDevice = useMemo(
    () => parsedCsv?.devices.find((device) => device.id === selectedDeviceId) ?? null,
    [parsedCsv, selectedDeviceId]
  );
  const csvProgress = isParsing ? parseProgress : csvReadSummary;
  const csvProgressText = csvProgress
    ? `${csvProgress.rowNumber.toLocaleString()} rows scanned, ${csvProgress.mappedRows.toLocaleString()} mapped`
    : '';
  const elapsedText =
    !isParsing && csvReadSummary?.elapsedMs !== null && csvReadSummary?.elapsedMs !== undefined
      ? `Time taken: ${(csvReadSummary.elapsedMs / 1000).toFixed(2)} seconds`
      : '';
  const showStatusCard = isParsing || Boolean(error);
  const hasCleanOutput = cleanOutputs.csv || cleanOutputs.xlsx || cleanOutputs.html;
  const threats = useMemo(
    () => (parsedCsv ? analyzeThreats(parsedCsv.observations, threatConfig) : []),
    [parsedCsv, threatConfig]
  );
  const threatsByBssid = useMemo(
    () => new Map(threats.map((threat) => [threat.bssid, threat])),
    [threats]
  );
  const normalizedReviewSearch = useMemo(() => searchTerm(reviewSearch), [reviewSearch]);
  const searchedThreats = useMemo(
    () => threats.filter((threat) => threatMatchesSearch(threat, normalizedReviewSearch)),
    [normalizedReviewSearch, threats]
  );
  const threatCounts = useMemo(() => countBySeverity(searchedThreats), [searchedThreats]);
  const filteredThreats = useMemo(
    () =>
      threatSeverityFilter === 'all'
        ? searchedThreats
        : searchedThreats.filter((threat) => threat.severity === threatSeverityFilter),
    [searchedThreats, threatSeverityFilter]
  );
  const visibleThreats = filteredThreats.slice(0, threatConfig.maxThreatsToShow);
  const searchedDevices = useMemo(() => {
    if (!parsedCsv) {
      return [];
    }

    return parsedCsv.devices.filter((device) =>
      deviceMatchesSearch(device, threatsByBssid.get(device.id), normalizedReviewSearch)
    );
  }, [normalizedReviewSearch, parsedCsv, threatsByBssid]);
  const filteredDevices = useMemo(() => {
    if (threatSeverityFilter === 'all') {
      return searchedDevices;
    }

    return searchedDevices.filter((device) => threatsByBssid.get(device.id)?.severity === threatSeverityFilter);
  }, [searchedDevices, threatSeverityFilter, threatsByBssid]);
  const selectedDeviceOutsideFilter = Boolean(
    selectedDevice && !filteredDevices.some((device) => device.id === selectedDevice.id)
  );
  const selectedDeviceThreat = selectedDevice ? threatsByBssid.get(selectedDevice.id) ?? null : null;
  const selectedMapThreat = selectedThreatBssid === selectedDeviceId ? selectedDeviceThreat : null;
  const deviceOptions = useMemo(() => {
    const withThreatSeverity = (device) => ({
      ...device,
      threatSeverity: threatsByBssid.get(device.id)?.severity ?? ''
    });

    if (!selectedDeviceOutsideFilter) {
      return filteredDevices.map(withThreatSeverity);
    }
    return [{...withThreatSeverity(selectedDevice), currentOutsideFilter: true}, ...filteredDevices.map(withThreatSeverity)];
  }, [filteredDevices, selectedDevice, selectedDeviceOutsideFilter, threatsByBssid]);

  const loadParsedCsv = useCallback((result, elapsedMs = null) => {
    setCsvReadSummary({
      rowNumber: result.rowCount ?? (result.mappedRows ?? 0) + (result.skippedRows ?? 0),
      mappedRows: result.mappedRows ?? 0,
      elapsedMs
    });
    setDetectedCleanerFormat(result.cleanerFormat ?? null);
    if (result.cleanOnly) {
      setParsedCsv(null);
      setSelectedDeviceId('');
      setSelectedThreatBssid('');
      setSelectedPoint(null);
      setDeviceMapData({points: [], segments: []});
      setStatus('');
      return;
    }

    setParsedCsv(result);
    setSelectedDeviceId(result.devices[0]?.id ?? '');
    setSelectedThreatBssid('');
    setStatus('');
  }, []);

  const beginCsvRead = useCallback((message) => {
    loadRequestRef.current += 1;
    setSelectedFile(null);
    setIsParsing(true);
    setError('');
    setCleanError('');
    setDownloadInfo(null);
    setCsvReadSummary(null);
    setDetectedCleanerFormat(null);
    setParseProgress(null);
    setParsedCsv(null);
    setThreatSeverityFilter('all');
    setReviewSearch('');
    setSightingOrder('oldest');
    setSelectedDeviceId('');
    setSelectedThreatBssid('');
    setSelectedPoint(null);
    setDeviceMapData({points: [], segments: []});
    setStatus(message);
    return loadRequestRef.current;
  }, []);

  const completeCsvRead = useCallback((file, result, elapsedMs, loadId, options = {}) => {
    if (loadRequestRef.current !== loadId) {
      return false;
    }

    setSelectedFile(file);
    loadParsedCsv(result, elapsedMs);
    if (options.persist) {
      persistCsvFileForSession(file, result, () => loadRequestRef.current === loadId).catch((caughtError) => {
        console.warn('Could not persist CSV for reload restore.', caughtError);
      });
    }
    return true;
  }, [loadParsedCsv]);

  const resetCsvUpload = useCallback(() => {
    loadRequestRef.current += 1;
    setSelectedFile(null);
    setParsedCsv(null);
    setSelectedDeviceId('');
    setSelectedThreatBssid('');
    setSelectedPoint(null);
    setDeviceMapData({points: [], segments: []});
    setStatus('Choose a CSV to map detections.');
    setParseProgress(null);
    setCsvReadSummary(null);
    setIsParsing(false);
    setError('');
    setCleanError('');
    setDownloadInfo(null);
    setDetectedCleanerFormat(null);
    setThreatSeverityFilter('all');
    setReviewSearch('');
    setSightingOrder('oldest');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    dispatch(removeDataset(POINTS_DATASET_ID));
    dispatch(removeDataset(TRAIL_DATASET_ID));
  }, [dispatch]);

  useEffect(() => {
    const controller = new AbortController();
    setCleanerApi({available: false, loading: true, message: 'Checking cleaner API...'});

    fetchCleanerProfiles(controller.signal)
      .then(() => {
        setCleanerApi({available: true, loading: false, message: 'Cleaner API ready.'});
      })
      .catch((caughtError) => {
        if (controller.signal.aborted) {
          return;
        }
        setCleanerApi({
          available: false,
          loading: false,
          message: cleanerStatusMessage(caughtError)
        });
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    loadThreatConfig(controller.signal)
      .then(({baseConfig, config}) => {
        if (controller.signal.aborted) {
          return;
        }
        setBaseThreatConfig(baseConfig);
        setThreatConfig(config);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBaseThreatConfig(normalizeThreatConfig());
          setThreatConfig(normalizeThreatConfig());
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('sampleCsv')) {
      return undefined;
    }

    let cancelled = false;
    const restoreRequestId = loadRequestRef.current;

    restoreCsvSessionFromStorage()
      .then((session) => {
        if (!session || cancelled || loadRequestRef.current !== restoreRequestId) {
          return;
        }

        loadRequestRef.current += 1;
        setSelectedFile(session.file);
        setIsParsing(false);
        setError('');
        setCleanError('');
        setDownloadInfo(null);
        setParseProgress(null);
        setThreatSeverityFilter('all');
        setReviewSearch('');
        setSightingOrder('oldest');
        setSelectedThreatBssid('');
        setSelectedPoint(null);
        loadParsedCsv(session.result);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      })
      .catch((caughtError) => {
        if (cancelled || !getCsvSessionId()) {
          return;
        }
        console.warn('Could not restore CSV from session storage.', caughtError);
        clearCsvSessionId();
        setError('CSV could not be restored. Choose it again.');
        setStatus('CSV could not be restored. Choose it again.');
      });

    return () => {
      cancelled = true;
    };
  }, [loadParsedCsv]);

  const handleFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    const loadId = beginCsvRead(`Reading ${file.name}...`);
    const startedAt = performance.now();
    try {
      const result = await parseShadowViewCsv(file, setParseProgress);
      completeCsvRead(file, result, performance.now() - startedAt, loadId, {persist: true});
    } catch (caughtError) {
      if (loadRequestRef.current !== loadId) {
        return;
      }
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      setStatus('CSV could not be mapped.');
    } finally {
      if (loadRequestRef.current === loadId) {
        setIsParsing(false);
      }
    }
  }, [beginCsvRead, completeCsvRead]);

  const setOutput = useCallback((name, checked) => {
    setCleanOutputs((current) => ({...current, [name]: checked}));
  }, []);

  const handleThreatConfigChange = useCallback((nextConfig) => {
    setThreatConfig(saveThreatConfig(nextConfig));
  }, []);

  const handleThreatConfigReset = useCallback(() => {
    clearSavedThreatConfig();
    setThreatConfig(baseThreatConfig);
  }, [baseThreatConfig]);

  const handleRemoveCsv = useCallback(() => {
    resetCsvUpload();
    clearPersistedCsvSession().catch((caughtError) => {
      console.warn('Could not clear CSV reload restore data.', caughtError);
    });
  }, [resetCsvUpload]);

  const handleClean = useCallback(async () => {
    if (!selectedFile) {
      setCleanError('Choose a CSV before cleaning.');
      return;
    }
    if (!hasCleanOutput) {
      setCleanError('Choose at least one output format.');
      return;
    }

    setIsCleaning(true);
    setCleanError('');
    setDownloadInfo(null);

    try {
      const result = await cleanCsvWithBackend({
        file: selectedFile,
        cleanerId: 'auto',
        includeCsv: cleanOutputs.csv,
        includeXlsx: cleanOutputs.xlsx,
        includeHtml: cleanOutputs.html
      });
      downloadBlob(result.blob, result.fileName);
      setDownloadInfo({fileName: result.fileName});
    } catch (caughtError) {
      setCleanError(cleanerStatusMessage(caughtError));
    } finally {
      setIsCleaning(false);
    }
  }, [cleanOutputs, hasCleanOutput, selectedFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }

    window.__shadowViewLoadCsvTextForTest = (csvText, fileName = 'test.csv', options = {}) => {
      const file = new File([csvText], fileName, {type: 'text/csv'});
      const loadId = beginCsvRead(`Reading ${fileName}...`);
      const startedAt = performance.now();

      try {
        const result = parseShadowViewCsvText(csvText, fileName, setParseProgress);
        completeCsvRead(file, result, performance.now() - startedAt, loadId, {persist: Boolean(options.persist)});
        return result;
      } catch (caughtError) {
        if (loadRequestRef.current !== loadId) {
          throw caughtError;
        }
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
        setError(message);
        setStatus('CSV could not be mapped.');
        throw caughtError;
      } finally {
        if (loadRequestRef.current === loadId) {
          setIsParsing(false);
        }
      }
    };

    return () => {
      delete window.__shadowViewLoadCsvTextForTest;
    };
  }, [beginCsvRead, completeCsvRead]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const sampleCsv = new URLSearchParams(window.location.search).get('sampleCsv');
    if (!sampleCsv) {
      return;
    }

    let cancelled = false;
    const persistSampleCsv = new URLSearchParams(window.location.search).get('persistSampleCsv') === '1';
    const sampleFileName = displayNameFromUrl(sampleCsv);
    const loadId = beginCsvRead(`Reading ${sampleFileName}...`);
    const startedAt = performance.now();

    fetch(sampleCsv)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load sample CSV: ${response.status}`);
        }
        return response.text();
      })
      .then((csvText) => {
        if (cancelled) {
          return;
        }
        const file = new File([csvText], sampleFileName, {type: 'text/csv'});
        const result = parseShadowViewCsvText(csvText, sampleFileName, setParseProgress);
        completeCsvRead(file, result, performance.now() - startedAt, loadId, {persist: persistSampleCsv});
      })
      .catch((caughtError) => {
        if (cancelled || loadRequestRef.current !== loadId) {
          return;
        }
        setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        setDetectedCleanerFormat(null);
        setStatus('CSV could not be mapped.');
      })
      .finally(() => {
        if (!cancelled && loadRequestRef.current === loadId) {
          setIsParsing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [beginCsvRead, completeCsvRead]);

  useEffect(() => {
    if (!parsedCsv || !selectedDeviceId) {
      return undefined;
    }

    const nextMapData = prepareDeviceMapData(parsedCsv.observations, selectedDeviceId, {
      includedRowNumbers: selectedMapThreat?.qualifyingRowNumbers
    });
    setDeviceMapData(nextMapData);
    const payload = createKeplerPayload({...nextMapData, deviceId: selectedDeviceId});
    dispatch(addDataToMap(payload));
    const timer = window.setTimeout(() => {
      dispatch(addDataToMap(payload));
    }, 500);

    return () => window.clearTimeout(timer);
  }, [dispatch, parsedCsv, selectedDeviceId, selectedMapThreat]);

  const visiblePoints = useMemo(
    () => visibleSightingPoints(deviceMapData.points, sightingOrder),
    [deviceMapData.points, sightingOrder]
  );
  const pointIndexesByRowNumber = useMemo(
    () => pointIndexByRowNumber(deviceMapData.points),
    [deviceMapData.points]
  );
  const selectedPointOutsideVisible = Boolean(
    selectedPoint && !visiblePoints.some((point) => point.__row_number === selectedPoint.__row_number)
  );
  const sightingListPoints = useMemo(
    () => (selectedPointOutsideVisible ? [selectedPoint, ...visiblePoints] : visiblePoints),
    [selectedPoint, selectedPointOutsideVisible, visiblePoints]
  );

  useEffect(() => {
    setSelectedPoint(visiblePoints[0] ?? null);
  }, [visiblePoints]);

  useEffect(() => {
    const point = clickedPoint(clickedMapObject, deviceMapData.points);
    if (!point) {
      return;
    }

    setSelectedPoint((current) => (current?.__row_number === point.__row_number ? current : point));
  }, [clickedMapObject, deviceMapData.points]);

  useEffect(() => {
    if (!selectedPoint) {
      return;
    }

    const pointIndex = pointIndexesByRowNumber.get(selectedPoint.__row_number);
    const clickInfo = mapClickInfoForPoint(selectedPoint, pointIndex, selectedPointLayerIndex);
    if (clickInfo) {
      dispatch(onLayerClick(clickInfo));
    }
  }, [dispatch, pointIndexesByRowNumber, selectedPoint, selectedPointLayerIndex]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">SV</div>
          <div>
            <h1>Shadow View Map</h1>
            <p>BSSID sightings along the scanner path</p>
          </div>
        </div>

        <section className={selectedFile ? 'panel upload-panel loaded' : 'panel upload-panel'}>
          <input
            accept=".csv,text/csv"
            className="visually-hidden"
            onChange={handleFile}
            ref={fileInputRef}
            type="file"
          />
          {selectedFile ? (
            <div className="file-pill">
              <FileText aria-hidden="true" size={14} />
              <div className="file-copy">
                <div className="file-title">
                  <span>{selectedFile.name}</span>
                  <small>{formatFileSize(selectedFile.size)}</small>
                </div>
                {(csvProgressText || elapsedText) && (
                  <div className="file-meta">
                    {csvProgressText && <span>{csvProgressText}</span>}
                    {elapsedText && <span>{elapsedText}</span>}
                  </div>
                )}
              </div>
              <button
                aria-label={`Remove ${selectedFile.name}`}
                className="file-remove-button"
                disabled={isCleaning}
                onClick={handleRemoveCsv}
                title="Remove CSV"
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
          ) : (
            <>
              <div>
                <h2>CSV Upload</h2>
                <p>Add a Shadow View CSV</p>
              </div>
              <button
                className="primary-button"
                disabled={isParsing}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                {isParsing ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <Upload aria-hidden="true" size={16} />}
                <span>{isParsing ? 'Reading CSV...' : 'Choose CSV'}</span>
              </button>
            </>
          )}
        </section>

        {showStatusCard && (
          <section className="status-card" aria-live="polite">
            {isParsing && status && <p>{status}</p>}
            {isParsing && csvProgressText && <div className="progress-copy">{csvProgressText}</div>}
            {isParsing && <div className="progress-bar"><span /></div>}
            {error && <div className="error-text">{error}</div>}
          </section>
        )}

        {parsedCsv && (
          <>
            <section className="stats-grid">
              <Stat label="Mappable rows" value={parsedCsv.mappedRows.toLocaleString()} />
              <Stat label="BSSIDs" value={parsedCsv.devices.length.toLocaleString()} />
              <Stat label="Skipped rows" value={parsedCsv.skippedRows.toLocaleString()} />
            </section>

            <ThreatPanel
              deviceOptions={deviceOptions}
              filteredDeviceCount={filteredDevices.length}
              filteredCount={filteredThreats.length}
              onDeviceChange={(deviceId) => {
                setSelectedDeviceId(deviceId);
                setSelectedThreatBssid('');
              }}
              onFilterChange={setThreatSeverityFilter}
              onSearchChange={setReviewSearch}
              onSelectThreat={(threat) => {
                setSelectedDeviceId(threat.bssid);
                setSelectedThreatBssid(threat.bssid);
              }}
              searchValue={reviewSearch}
              selectedDevice={selectedDevice}
              selectedDeviceId={selectedDeviceId}
              selectedDeviceOutsideFilter={selectedDeviceOutsideFilter}
              selectedDeviceThreat={selectedDeviceThreat}
              selectedThreatBssid={selectedThreatBssid}
              severityFilter={threatSeverityFilter}
              searchedDeviceCount={searchedDevices.length}
              threatCounts={threatCounts}
              totalDeviceCount={parsedCsv.devices.length}
              threats={threats}
              visibleThreats={visibleThreats}
            />

            <section className="panel sightings-panel">
              <div className="section-heading">
                <h2>{selectedMapThreat ? 'Threat Sightings' : 'Scanner Sightings'}</h2>
                <span>{deviceMapData.points.length.toLocaleString()}</span>
              </div>
              {selectedMapThreat && (
                <div className="scope-note">
                  <p>
                    Showing {selectedMapThreat.metrics.qualifyingScanCount.toLocaleString()} qualifying sightings used
                    for this threat.
                  </p>
                  <button className="tertiary-button" onClick={() => setSelectedThreatBssid('')} type="button">
                    Show all sightings
                  </button>
                </div>
              )}
              {deviceMapData.points.length > SIGHTING_LIST_LIMIT && (
                <div className="segmented-control" role="group" aria-label="Sighting order">
                  <button
                    aria-pressed={sightingOrder === 'oldest'}
                    className={sightingOrder === 'oldest' ? 'active' : ''}
                    onClick={() => setSightingOrder('oldest')}
                    type="button"
                  >
                    Oldest
                  </button>
                  <button
                    aria-pressed={sightingOrder === 'newest'}
                    className={sightingOrder === 'newest' ? 'active' : ''}
                    onClick={() => setSightingOrder('newest')}
                    type="button"
                  >
                    Newest
                  </button>
                </div>
              )}
              <div className="sighting-list">
                {sightingListPoints.map((point) => {
                  const isActive = selectedPoint?.__row_number === point.__row_number;
                  const isPinned = selectedPointOutsideVisible && isActive;
                  return (
                    <button
                      className={isActive ? `sighting active${isPinned ? ' pinned' : ''}` : 'sighting'}
                      key={point.__row_number}
                      onClick={() => setSelectedPoint(point)}
                      type="button"
                    >
                      <strong>#{point.__sequence}</strong>
                      <span>{point.__event_time || 'Unknown time'}</span>
                      <small>{scannerSightingMeta(point)}</small>
                    </button>
                  );
                })}
              </div>
              {selectedPointOutsideVisible && (
                <p className="list-note">Selected map sighting is pinned above the current list.</p>
              )}
              {deviceMapData.points.length > visiblePoints.length && (
                <p className="list-note">
                  Showing {sightingOrder === 'newest' ? 'newest' : 'oldest'} {visiblePoints.length} sightings.
                  Kepler shows all {selectedMapThreat ? 'threat-qualified points' : 'scanner points'}.
                </p>
              )}
            </section>

            <section className="panel threat-settings-panel">
              <ThreatSettings
                config={threatConfig}
                disabled={isParsing}
                onChange={handleThreatConfigChange}
                onReset={handleThreatConfigReset}
              />
            </section>
          </>
        )}

        <section className="panel cleaner-panel">
          <div className="section-heading">
            <h2>Clean & Export</h2>
            <span className={cleanerApi.available ? 'api-state ready' : 'api-state offline'}>
              {cleanerApi.loading && <Loader2 aria-hidden="true" className="spin" size={13} />}
              {!cleanerApi.loading && cleanerApi.available && <CheckCircle2 aria-hidden="true" size={13} />}
              {!cleanerApi.loading && !cleanerApi.available && <WifiOff aria-hidden="true" size={13} />}
              {cleanerApi.loading ? 'Checking' : cleanerApi.available ? 'Ready' : 'Offline'}
            </span>
          </div>

          {detectedCleanerFormat && (
            <p className="auto-cleaner-line">
              <span>Auto Cleaner:</span> <strong>{detectedCleanerFormat.displayName}</strong>
            </p>
          )}

          <div className="output-grid" role="group" aria-label="Output formats">
            <OutputToggle
              checked={cleanOutputs.csv}
              disabled={isCleaning}
              icon={FileText}
              label="CSV"
              onChange={(checked) => setOutput('csv', checked)}
            />
            <OutputToggle
              checked={cleanOutputs.xlsx}
              disabled={isCleaning}
              icon={FileSpreadsheet}
              label="Excel"
              onChange={(checked) => setOutput('xlsx', checked)}
            />
            <OutputToggle
              checked={cleanOutputs.html}
              disabled={isCleaning}
              icon={FileArchive}
              label="HTML"
              onChange={(checked) => setOutput('html', checked)}
            />
          </div>

          <button
            className="secondary-button"
            disabled={!selectedFile || !cleanerApi.available || isCleaning || !hasCleanOutput}
            onClick={handleClean}
            type="button"
          >
            {isCleaning ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <Download aria-hidden="true" size={16} />}
            <span>{isCleaning ? 'Cleaning...' : 'Clean & Download'}</span>
          </button>

          {!cleanerApi.available && !cleanerApi.loading && (
            <div className="clean-message muted">
              <AlertTriangle aria-hidden="true" size={14} />
              <span>{cleanerApi.message}</span>
            </div>
          )}
          {cleanError && (
            <div className="clean-message error-text">
              <AlertTriangle aria-hidden="true" size={14} />
              <span>{cleanError}</span>
            </div>
          )}
          {downloadInfo && (
            <div className="clean-message success-text">
              <CheckCircle2 aria-hidden="true" size={14} />
              <span>Downloaded {downloadInfo.fileName}</span>
            </div>
          )}
        </section>
      </aside>

      <section className={`map-area ${detailsCollapsed ? 'details-collapsed' : ''}`.trim()}>
        <div className="map-card" ref={mapRef}>
          <KeplerGl
            appName="Shadow View"
            id={KEPLER_MAP_ID}
            mapboxApiAccessToken={MAPBOX_TOKEN}
            mapStyles={CUSTOM_MAP_STYLES}
            mapStylesReplaceDefault
            mint={false}
            version="MVP"
            width={mapSize.width}
            height={mapSize.height}
          />
          <MapScopeStatus
            pointCount={deviceMapData.points.length}
            selectedDevice={selectedDevice}
            selectedMapThreat={selectedMapThreat}
            selectedPoint={selectedPoint}
          />
          {!parsedCsv && (
            <div className="map-empty">
              <h2>No CSV loaded</h2>
              <p>Load a Shadow View CSV to map scanner detections.</p>
            </div>
          )}
        </div>

        <div className={`details-card ${detailsCollapsed ? 'collapsed' : ''}`.trim()}>
          <div className="section-heading">
            <div className="details-heading-title">
              <h2>Sighting Details</h2>
              <span>{selectedPoint ? `Row ${selectedPoint.__row_number}` : 'No selection'}</span>
            </div>
            <button
              aria-expanded={!detailsCollapsed}
              className="tertiary-button details-toggle"
              onClick={() => setDetailsCollapsed((collapsed) => !collapsed)}
              title={detailsCollapsed ? 'Show sighting details' : 'Hide sighting details'}
              type="button"
            >
              <ChevronDown
                aria-hidden="true"
                className={detailsCollapsed ? 'details-toggle-icon collapsed' : 'details-toggle-icon'}
                size={16}
              />
              <span>{detailsCollapsed ? 'Show' : 'Hide'}</span>
            </button>
          </div>
          {!detailsCollapsed && (
            <>
              <p className="details-hint">Selected sighting values from the original CSV.</p>
              <DetailTable row={selectedPoint} />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
