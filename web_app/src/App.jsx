import {KeplerGl} from '@kepler.gl/components';
import {addDataToMap, removeDataset, updateMap} from '@kepler.gl/actions';
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
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
  keplerInstance
} from './mapSelection.js';
import {countBySeverity, deviceMatchesSearch, searchTerm, threatMatchesSearch} from './searchFilters.js';
import {clearSavedThreatConfig, loadThreatConfig, normalizeThreatConfig, saveThreatConfig} from './threatConfig.js';
import {analyzeThreats} from './threatDetection.js';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'shadow-view-local';
const SIGHTING_LIST_LIMIT = 150;
const SELECTED_POINT_MIN_ZOOM = 17;
const WEB_MERCATOR_TILE_SIZE = 512;
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

function hasDevSampleCsvRequest() {
  if (!import.meta.env.DEV) {
    return false;
  }
  try {
    return Boolean(new URLSearchParams(window.location.search).get('sampleCsv'));
  } catch {
    return false;
  }
}

function shouldAttemptCsvSessionRestore() {
  return !hasDevSampleCsvRequest() && Boolean(getCsvSessionId());
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

function SidebarDropdown({ariaLive, children, className = '', count, defaultOpen = true, icon: Icon, meta, title}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className={`panel sidebar-dropdown-panel ${className}`.trim()} aria-live={ariaLive}>
      <details className="sidebar-dropdown" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
        <summary>
          {Icon && <Icon aria-hidden="true" size={15} />}
          <span className="sidebar-dropdown-title">{title}</span>
          {count !== undefined && <strong className="sidebar-dropdown-count">{count}</strong>}
          {meta && <span className="sidebar-dropdown-meta">{meta}</span>}
          <ChevronDown aria-hidden="true" className="sidebar-dropdown-caret" size={18} />
        </summary>
        <div className="sidebar-dropdown-content">{children}</div>
      </details>
    </section>
  );
}

function severityLabel(severity) {
  if (!severity) {
    return 'Normal';
  }
  return `${severity[0].toUpperCase()}${severity.slice(1)}`;
}

function observedTimeRange(firstTimeMs, lastTimeMs) {
  if (!Number.isFinite(firstTimeMs) && !Number.isFinite(lastTimeMs)) {
    return 'Unknown';
  }

  if (!Number.isFinite(firstTimeMs) || firstTimeMs === lastTimeMs) {
    return formatTime(Number.isFinite(firstTimeMs) ? firstTimeMs : lastTimeMs);
  }

  if (!Number.isFinite(lastTimeMs)) {
    return formatTime(firstTimeMs);
  }

  return `${formatTime(firstTimeMs)} to ${formatTime(lastTimeMs)}`;
}

function threatObservedTimeRange(threat) {
  return observedTimeRange(threat?.metrics?.firstTimeMs, threat?.metrics?.lastTimeMs);
}

function formatDetectionRadius(value) {
  const radius = Number(value);
  return Number.isFinite(radius) ? `${Math.round(radius).toLocaleString()}m radius` : '';
}

function scannerSightingMeta(point) {
  const location = `${point.__latitude.toFixed(6)}, ${point.__longitude.toFixed(6)}`;
  const radius = formatDetectionRadius(point.__detection_radius_meters);
  const grouped = point.__cluster_size > 1 ? `${point.__cluster_size.toLocaleString()} scans` : '';
  const duration = point.__cluster_duration_label ? `${point.__cluster_duration_label} here` : '';
  return [location, radius, grouped, duration].filter(Boolean).join(' - ');
}

function visibleSightingPoints(points, order) {
  if (order === 'newest') {
    return points.slice(-SIGHTING_LIST_LIMIT).reverse();
  }
  return points.slice(0, SIGHTING_LIST_LIMIT);
}

function mercatorWorldPoint(longitude, latitude, zoom) {
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const scale = WEB_MERCATOR_TILE_SIZE * 2 ** zoom;
  const sineLatitude = Math.sin((clampedLatitude * Math.PI) / 180);

  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sineLatitude) / (1 - sineLatitude)) / (4 * Math.PI)) * scale
  };
}

function selectedPointScreenPosition(point, mapState, mapSize) {
  const width = Number(mapState?.width) || mapSize.width;
  const height = Number(mapState?.height) || mapSize.height;
  const zoom = Number(mapState?.zoom);
  const centerLatitude = Number(mapState?.latitude);
  const centerLongitude = Number(mapState?.longitude);

  if (
    !point ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(zoom) ||
    !Number.isFinite(centerLatitude) ||
    !Number.isFinite(centerLongitude) ||
    !Number.isFinite(point.__latitude) ||
    !Number.isFinite(point.__longitude)
  ) {
    return null;
  }

  const center = mercatorWorldPoint(centerLongitude, centerLatitude, zoom);
  const selected = mercatorWorldPoint(point.__longitude, point.__latitude, zoom);
  const x = selected.x - center.x + width / 2;
  const y = selected.y - center.y + height / 2;
  const margin = 80;

  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -margin || y < -margin || x > width + margin || y > height + margin) {
    return null;
  }

  return {x, y};
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
          help="Minimum scanner-location clusters where this BSSID must appear. Repeated scans inside the same location radius count once."
          label="Unique locations"
          min={1}
          value={config[`minScans${suffix}`]}
          onChange={(value) => onValue(`minScans${suffix}`, value)}
        />
        <SettingNumber
          disabled={disabled}
          help="Minimum elapsed time between the first and last qualifying scan."
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
    <details className="sidebar-dropdown threat-settings">
      <summary>
        <SlidersHorizontal aria-hidden="true" size={15} />
        <span className="sidebar-dropdown-title">Threat Criteria</span>
        <ChevronDown aria-hidden="true" className="sidebar-dropdown-caret" size={18} />
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
          help="Only scans with Accuracy at or below this radius qualify."
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
  selectedDeviceId,
  selectedDeviceOutsideFilter,
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
    <SidebarDropdown
      ariaLive="polite"
      className="review-panel"
      count={totalDeviceCount.toLocaleString()}
      icon={Search}
      title="BSSID Review"
    >
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
              <small className="threat-observed">Observed {threatObservedTimeRange(threat)}</small>
              <p>{threat.reason}</p>
            </button>
          ))}
        </div>
      )}
    </SidebarDropdown>
  );
}

function DetailTable({row}) {
  if (!row) {
    return <p className="empty-state">Select a map item to inspect its CSV values.</p>;
  }

  const values = Object.entries(row).filter(([key, value]) => !key.startsWith('__') && value !== '');

  if (!values.length) {
    return <p className="empty-state">No populated CSV values for this selection.</p>;
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

function MapScopeStatus({
  clusterDistanceMeters,
  pointCount,
  rawPointCount,
  selectedDevice,
  selectedDeviceThreat,
  selectedMapThreat,
  selectedPoint
}) {
  if (!selectedDevice || pointCount === 0) {
    return null;
  }

  const severity = selectedDeviceThreat?.severity ?? '';
  const scope = selectedMapThreat ? 'qualifying threat locations' : 'scanner locations';
  const rawCount = Number.isFinite(rawPointCount) ? rawPointCount : pointCount;
  const distanceCopy =
    Number.isFinite(clusterDistanceMeters) && clusterDistanceMeters > 0
      ? ` (${Math.round(clusterDistanceMeters).toLocaleString()}m groups)`
      : '';
  const countCopy =
    rawCount === pointCount
      ? `${pointCount.toLocaleString()} ${scope}`
      : `${pointCount.toLocaleString()} ${scope} from ${rawCount.toLocaleString()} scans`;

  return (
    <div className={`map-scope-status ${severity}`.trim()} aria-live="polite">
      <span>Selected BSSID</span>
      <strong>{selectedDevice.id}</strong>
      <small>
        {countCopy}
        {distanceCopy}
        {selectedPoint ? ` | Row ${selectedPoint.__row_number}` : ''}
      </small>
    </div>
  );
}

function MapSelectionCard({point, selectedMapThreat}) {
  if (!point) {
    return null;
  }

  return (
    <div className="map-selection-card" aria-live="polite">
      <span>{selectedMapThreat ? 'Selected Threat Location' : 'Selected Location'}</span>
      <strong>Row {point.__row_number}</strong>
      <small>{point.__event_time || 'Unknown time'}</small>
      <small>{scannerSightingMeta(point)}</small>
    </div>
  );
}

function SelectedMapMarker({onSelect, point, position, selectedDeviceThreat}) {
  if (!point || !position) {
    return null;
  }

  const severity = selectedDeviceThreat?.severity ?? '';

  return (
    <button
      aria-label={`Selected map point, row ${point.__row_number}`}
      className={`selected-map-marker ${severity}`.trim()}
      onClick={() => onSelect(point)}
      style={{left: `${position.x}px`, top: `${position.y}px`}}
      title={`Selected row ${point.__row_number}`}
      type="button"
    >
      <span aria-hidden="true" />
      <strong>Row {point.__row_number}</strong>
    </button>
  );
}

function RestoreCsvModal() {
  return (
    <div className="restore-modal-backdrop" role="status" aria-live="polite">
      <div className="restore-modal">
        <Loader2 aria-hidden="true" className="spin" size={26} />
        <div>
          <h2>Restoring Previous CSV</h2>
          <p>Reloading the saved map data from this browser. Your data should appear shortly.</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const dispatch = useDispatch();
  const clickedMapObject = useSelector((state) => keplerInstance(state)?.visState?.clicked ?? null);
  const currentMapState = useSelector((state) => keplerInstance(state)?.mapState ?? null);
  const [mapRef, mapSize] = useElementSize();
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedCsv, setParsedCsv] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedThreatBssid, setSelectedThreatBssid] = useState('');
  const [deviceMapData, setDeviceMapData] = useState({points: [], segments: []});
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [status, setStatus] = useState(() =>
    shouldAttemptCsvSessionRestore() ? 'Restoring previous CSV...' : 'Choose a CSV to map detections.'
  );
  const [parseProgress, setParseProgress] = useState(null);
  const [csvReadSummary, setCsvReadSummary] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isRestoringCsv, setIsRestoringCsv] = useState(() => shouldAttemptCsvSessionRestore());
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
  const sightingButtonRefs = useRef(new Map());

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
  const showStatusCard = isParsing || isRestoringCsv || Boolean(error);
  const isLoadingCsv = isParsing || isRestoringCsv;
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
    setIsRestoringCsv(false);
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
    setIsRestoringCsv(false);
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
    if (hasDevSampleCsvRequest()) {
      setIsRestoringCsv(false);
      return undefined;
    }

    let cancelled = false;
    const restoreRequestId = loadRequestRef.current;
    const sessionId = getCsvSessionId();
    if (!sessionId) {
      setIsRestoringCsv(false);
      return undefined;
    }

    setIsRestoringCsv(true);
    setStatus('Restoring previous CSV...');
    setError('');

    restoreCsvSessionFromStorage()
      .then((session) => {
        if (cancelled || loadRequestRef.current !== restoreRequestId) {
          return;
        }
        setIsRestoringCsv(false);
        if (!session) {
          setStatus('Choose a CSV to map detections.');
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
        if (cancelled) {
          return;
        }
        setIsRestoringCsv(false);
        if (!getCsvSessionId()) {
          setStatus('Choose a CSV to map detections.');
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

    const clusterDistanceMeters = threatConfig.sameLocationMeters;
    const nextMapData = prepareDeviceMapData(parsedCsv.observations, selectedDeviceId, {
      includedRowNumbers: selectedMapThreat?.qualifyingRowNumbers,
      clusterDistanceMeters
    });
    setDeviceMapData(nextMapData);
    const payload = createKeplerPayload({
      ...nextMapData,
      deviceId: selectedDeviceId,
      severity: selectedDeviceThreat?.severity
    });
    dispatch(addDataToMap(payload));
    const timer = window.setTimeout(() => {
      dispatch(addDataToMap(payload));
    }, 500);

    return () => window.clearTimeout(timer);
  }, [dispatch, parsedCsv, selectedDeviceId, selectedDeviceThreat, selectedMapThreat, threatConfig.sameLocationMeters]);

  const visiblePoints = useMemo(
    () => visibleSightingPoints(deviceMapData.points, sightingOrder),
    [deviceMapData.points, sightingOrder]
  );
  const selectedPointOutsideVisible = Boolean(
    selectedPoint && !visiblePoints.some((point) => point.__row_number === selectedPoint.__row_number)
  );
  const sightingListPoints = useMemo(
    () => (selectedPointOutsideVisible ? [selectedPoint, ...visiblePoints] : visiblePoints),
    [selectedPoint, selectedPointOutsideVisible, visiblePoints]
  );
  const selectedMarkerPosition = useMemo(
    () => selectedPointScreenPosition(selectedPoint, currentMapState, mapSize),
    [currentMapState, mapSize, selectedPoint]
  );
  const setSightingButtonRef = useCallback((rowNumber, element) => {
    if (element) {
      sightingButtonRefs.current.set(rowNumber, element);
    } else {
      sightingButtonRefs.current.delete(rowNumber);
    }
  }, []);
  const focusPointOnMap = useCallback(
    (point) => {
      if (!point || !Number.isFinite(point.__latitude) || !Number.isFinite(point.__longitude)) {
        return;
      }

      const currentZoom = Number(currentMapState?.zoom);
      const viewport = {
        latitude: point.__latitude,
        longitude: point.__longitude,
        zoom: Math.min(19, Math.max(Number.isFinite(currentZoom) ? currentZoom : 0, SELECTED_POINT_MIN_ZOOM)),
        bearing: 0,
        pitch: 0,
        dragRotate: false
      };
      if (mapSize.width > 0 && mapSize.height > 0) {
        viewport.width = mapSize.width;
        viewport.height = mapSize.height;
      }

      dispatch(updateMap(viewport, 0));
    },
    [currentMapState, dispatch, mapSize]
  );
  const selectSightingPoint = useCallback(
    (point, options = {}) => {
      setSelectedPoint(point);
      setDetailsCollapsed(false);
      if (options.focusMap) {
        focusPointOnMap(point);
      }
    },
    [focusPointOnMap]
  );

  useEffect(() => {
    setSelectedPoint(visiblePoints[0] ?? null);
  }, [visiblePoints]);

  useEffect(() => {
    const point = clickedPoint(clickedMapObject, deviceMapData.points);
    if (!point) {
      return;
    }

    setDetailsCollapsed(false);
    setSelectedPoint((current) => (current?.__row_number === point.__row_number ? current : point));
  }, [clickedMapObject, deviceMapData.points]);

  useEffect(() => {
    if (!selectedPoint) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      sightingButtonRefs.current.get(selectedPoint.__row_number)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedPoint, sightingListPoints]);

  return (
    <main className="app-shell">
      {isRestoringCsv && <RestoreCsvModal />}
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">SV</div>
          <div>
            <h1>Shadow View Map</h1>
            <p>BSSID scans along the scanner path</p>
          </div>
        </div>

        <SidebarDropdown
          className={selectedFile ? 'upload-panel loaded' : 'upload-panel'}
          icon={FileText}
          title="CSV Upload"
        >
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
                <p>{isRestoringCsv ? 'Restoring saved CSV' : 'Add a Shadow View CSV'}</p>
              </div>
              <button
                className="primary-button"
                disabled={isLoadingCsv}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                {isLoadingCsv ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <Upload aria-hidden="true" size={16} />}
                <span>{isRestoringCsv ? 'Restoring...' : isParsing ? 'Reading CSV...' : 'Choose CSV'}</span>
              </button>
            </>
          )}
        </SidebarDropdown>

        {showStatusCard && (
          <section className="status-card" aria-live="polite">
            {isLoadingCsv && status && <p>{status}</p>}
            {isRestoringCsv && <div className="progress-copy">Your saved CSV data is still on this device.</div>}
            {isParsing && csvProgressText && <div className="progress-copy">{csvProgressText}</div>}
            {isLoadingCsv && <div className="progress-bar"><span /></div>}
            {error && <div className="error-text">{error}</div>}
          </section>
        )}

        {parsedCsv && (
          <>
            <SidebarDropdown
              className="summary-panel"
              count={parsedCsv.rowCount.toLocaleString()}
              icon={CheckCircle2}
              title="CSV Summary"
            >
              <div className="stats-grid">
                <Stat label="Mappable rows" value={parsedCsv.mappedRows.toLocaleString()} />
                <Stat label="BSSIDs" value={parsedCsv.devices.length.toLocaleString()} />
                <Stat label="Skipped rows" value={parsedCsv.skippedRows.toLocaleString()} />
              </div>
            </SidebarDropdown>

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
              selectedDeviceId={selectedDeviceId}
              selectedDeviceOutsideFilter={selectedDeviceOutsideFilter}
              selectedThreatBssid={selectedThreatBssid}
              severityFilter={threatSeverityFilter}
              searchedDeviceCount={searchedDevices.length}
              threatCounts={threatCounts}
              totalDeviceCount={parsedCsv.devices.length}
              threats={threats}
              visibleThreats={visibleThreats}
            />

            <SidebarDropdown
              className="sightings-panel"
              count={deviceMapData.points.length.toLocaleString()}
              icon={MapPin}
              title={selectedMapThreat ? 'Threat Locations' : 'Scanner Locations'}
            >
              {selectedMapThreat && (
                <div className="scope-note">
                  <p>
                    Showing {deviceMapData.points.length.toLocaleString()} location groups from{' '}
                    {(deviceMapData.rawPointCount ?? selectedMapThreat.metrics.qualifyingScanCount).toLocaleString()}{' '}
                    qualifying scans used for this threat.
                  </p>
                  <button className="tertiary-button" onClick={() => setSelectedThreatBssid('')} type="button">
                    Show all locations
                  </button>
                </div>
              )}
              {deviceMapData.points.length > SIGHTING_LIST_LIMIT && (
                <div className="segmented-control" role="group" aria-label="Location order">
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
                      aria-current={isActive ? 'true' : undefined}
                      className={isActive ? `sighting active${isPinned ? ' pinned' : ''}` : 'sighting'}
                      data-row-number={point.__row_number}
                      data-selected={isActive ? 'true' : undefined}
                      key={point.__row_number}
                      onClick={() => selectSightingPoint(point, {focusMap: true})}
                      ref={(element) => setSightingButtonRef(point.__row_number, element)}
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
                <p className="list-note">Selected map item is pinned above the current list.</p>
              )}
              {deviceMapData.points.length > visiblePoints.length && (
                <p className="list-note">
                  Showing {sightingOrder === 'newest' ? 'newest' : 'oldest'} {visiblePoints.length}{' '}
                    locations. Map shows all{' '}
                    {selectedMapThreat ? 'qualifying threat location groups' : 'grouped scanner locations'}.
                </p>
              )}
            </SidebarDropdown>

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

        <SidebarDropdown
          className="cleaner-panel"
          icon={Download}
          meta={
            <span className={cleanerApi.available ? 'api-state ready' : 'api-state offline'}>
              {cleanerApi.loading && <Loader2 aria-hidden="true" className="spin" size={13} />}
              {!cleanerApi.loading && cleanerApi.available && <CheckCircle2 aria-hidden="true" size={13} />}
              {!cleanerApi.loading && !cleanerApi.available && <WifiOff aria-hidden="true" size={13} />}
              {cleanerApi.loading ? 'Checking' : cleanerApi.available ? 'Ready' : 'Offline'}
            </span>
          }
          title="Clean & Export"
        >

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
        </SidebarDropdown>
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
          <SelectedMapMarker
            onSelect={selectSightingPoint}
            point={selectedPoint}
            position={selectedMarkerPosition}
            selectedDeviceThreat={selectedDeviceThreat}
          />
          <MapScopeStatus
            clusterDistanceMeters={deviceMapData.clusterDistanceMeters}
            pointCount={deviceMapData.points.length}
            rawPointCount={deviceMapData.rawPointCount}
            selectedDevice={selectedDevice}
            selectedDeviceThreat={selectedDeviceThreat}
            selectedMapThreat={selectedMapThreat}
            selectedPoint={selectedPoint}
          />
          <MapSelectionCard point={selectedPoint} selectedMapThreat={selectedMapThreat} />
          {isRestoringCsv && (
            <div className="map-empty map-loading">
              <Loader2 aria-hidden="true" className="spin" size={24} />
              <h2>Restoring previous CSV</h2>
              <p>Reloading saved map data from this browser.</p>
            </div>
          )}
          {!parsedCsv && !isRestoringCsv && (
            <div className="map-empty">
              <h2>No CSV loaded</h2>
              <p>Load a Shadow View CSV to map scanner detections.</p>
            </div>
          )}
        </div>

        <div className={`details-card ${detailsCollapsed ? 'collapsed' : ''}`.trim()}>
          <div className="section-heading">
            <div className="details-heading-title">
              <h2>Location Details</h2>
              <span>{selectedPoint ? `Row ${selectedPoint.__row_number}` : 'No selection'}</span>
            </div>
            <button
              aria-expanded={!detailsCollapsed}
              className="tertiary-button details-toggle"
              onClick={() => setDetailsCollapsed((collapsed) => !collapsed)}
              title={detailsCollapsed ? 'Show details' : 'Hide details'}
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
              <p className="details-hint">Selected map item values from the original CSV.</p>
              <DetailTable row={selectedPoint} />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
