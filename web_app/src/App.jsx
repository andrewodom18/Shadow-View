import {KeplerGl} from '@kepler.gl/components';
import {addDataToMap} from '@kepler.gl/actions';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Upload,
  WifiOff
} from 'lucide-react';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useDispatch} from 'react-redux';

import {cleanCsvWithBackend, downloadBlob, fetchCleanerProfiles} from './cleanerApi.js';
import {formatTime, parseShadowViewCsv, parseShadowViewCsvText, prepareDeviceMapData} from './csvShadowView.js';
import {CUSTOM_MAP_STYLES, createKeplerPayload} from './keplerConfig.js';
import {clearSavedThreatConfig, loadThreatConfig, normalizeThreatConfig, saveThreatConfig} from './threatConfig.js';
import {analyzeThreats, threatSummary} from './threatDetection.js';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'shadow-view-local';

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

function SettingNumber({disabled, label, min = 0, step = 1, value, onChange}) {
  return (
    <label className="setting-field">
      <span>{label}</span>
      <input
        disabled={disabled}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
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
          label="Scans"
          min={1}
          value={config[`minScans${suffix}`]}
          onChange={(value) => onValue(`minScans${suffix}`, value)}
        />
        <SettingNumber
          disabled={disabled}
          label="Minutes"
          min={0}
          value={config[`minDurationMinutes${suffix}`]}
          onChange={(value) => onValue(`minDurationMinutes${suffix}`, value)}
        />
        <SettingNumber
          disabled={disabled}
          label="Locations"
          min={1}
          value={config[`minUniqueLocations${suffix}`]}
          onChange={(value) => onValue(`minUniqueLocations${suffix}`, value)}
        />
        <SettingNumber
          disabled={disabled}
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
      </summary>
      <div className="settings-grid criteria-basics">
        <label className="setting-field setting-toggle">
          <span>Detection</span>
          <input
            checked={config.enabled}
            disabled={disabled}
            onChange={(event) => setConfigValue('enabled', event.target.checked)}
            type="checkbox"
          />
        </label>
        <SettingNumber
          disabled={disabled}
          label="Same location (m)"
          min={1}
          value={config.sameLocationMeters}
          onChange={(value) => setConfigValue('sameLocationMeters', value)}
        />
        <SettingNumber
          disabled={disabled}
          label="Max radius (m)"
          min={1}
          value={config.maxDetectionRadiusMeters}
          onChange={(value) => setConfigValue('maxDetectionRadiusMeters', value)}
        />
        <label className="setting-field">
          <span>Notify at</span>
          <select
            disabled={disabled}
            value={config.notifyAtSeverity}
            onChange={(event) => setConfigValue('notifyAtSeverity', event.target.value)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <SettingNumber
          disabled={disabled}
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

function ThreatPanel({notification, onSelectThreat, selectedDeviceId, threats, visibleThreats}) {
  return (
    <section className="panel threat-panel" aria-live="polite">
      <div className="section-heading">
        <h2>Threat Indicators</h2>
        <span>{threats.length.toLocaleString()}</span>
      </div>
      {notification ? (
        <div className={`threat-alert ${notification.highestSeverity}`}>
          <Bell aria-hidden="true" size={16} />
          <span>
            {notification.count.toLocaleString()} BSSID{notification.count === 1 ? '' : 's'} match.
            Highest severity: {severityLabel(notification.highestSeverity)}.
          </span>
        </div>
      ) : threats.length ? (
        <p className="empty-state">Matches are below the notification threshold.</p>
      ) : (
        <p className="empty-state">No BSSIDs match the current criteria.</p>
      )}
      {Boolean(visibleThreats.length) && (
        <div className="threat-list">
          {visibleThreats.map((threat) => (
            <button
              className={selectedDeviceId === threat.bssid ? 'threat-item active' : 'threat-item'}
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

export default function App() {
  const dispatch = useDispatch();
  const [mapRef, mapSize] = useElementSize();
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedCsv, setParsedCsv] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [deviceMapData, setDeviceMapData] = useState({points: [], segments: []});
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [status, setStatus] = useState('Choose a CSV to map detections.');
  const [parseProgress, setParseProgress] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState('');
  const [elapsedMs, setElapsedMs] = useState(null);
  const [cleanerOptions, setCleanerOptions] = useState([]);
  const [cleanerId, setCleanerId] = useState('auto');
  const [cleanOutputs, setCleanOutputs] = useState({csv: true, xlsx: true, html: false});
  const [cleanerApi, setCleanerApi] = useState({available: false, loading: true, message: 'Checking cleaner API...'});
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanError, setCleanError] = useState('');
  const [downloadInfo, setDownloadInfo] = useState(null);
  const [baseThreatConfig, setBaseThreatConfig] = useState(() => normalizeThreatConfig());
  const [threatConfig, setThreatConfig] = useState(() => normalizeThreatConfig());
  const fileInputRef = useRef(null);

  const selectedDevice = useMemo(
    () => parsedCsv?.devices.find((device) => device.id === selectedDeviceId) ?? null,
    [parsedCsv, selectedDeviceId]
  );
  const hasCleanOutput = cleanOutputs.csv || cleanOutputs.xlsx || cleanOutputs.html;
  const threats = useMemo(
    () => (parsedCsv ? analyzeThreats(parsedCsv.observations, threatConfig) : []),
    [parsedCsv, threatConfig]
  );
  const threatsByBssid = useMemo(
    () => new Map(threats.map((threat) => [threat.bssid, threat])),
    [threats]
  );
  const notification = useMemo(
    () => threatSummary(threats, threatConfig.notifyAtSeverity),
    [threatConfig.notifyAtSeverity, threats]
  );
  const visibleThreats = threats.slice(0, threatConfig.maxThreatsToShow);

  const loadParsedCsv = useCallback((result, elapsed) => {
    setElapsedMs(elapsed);
    setParsedCsv(result);
    setSelectedDeviceId(result.devices[0]?.id ?? '');
    setStatus(`Loaded ${result.fileName}. ${result.mappedRows.toLocaleString()} mappable rows found.`);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCleanerApi({available: false, loading: true, message: 'Checking cleaner API...'});

    fetchCleanerProfiles(controller.signal)
      .then((cleaners) => {
        setCleanerOptions(cleaners);
        setCleanerApi({available: true, loading: false, message: 'Cleaner API ready.'});
      })
      .catch((caughtError) => {
        if (controller.signal.aborted) {
          return;
        }

        setCleanerOptions([]);
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

  const handleFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSelectedFile(file);
    setIsParsing(true);
    setError('');
    setCleanError('');
    setDownloadInfo(null);
    setElapsedMs(null);
    setParseProgress(null);
    setParsedCsv(null);
    setSelectedDeviceId('');
    setSelectedPoint(null);
    setDeviceMapData({points: [], segments: []});
    setStatus(`Reading ${file.name}...`);

    const started = performance.now();
    try {
      const result = await parseShadowViewCsv(file, setParseProgress);
      const elapsed = performance.now() - started;
      loadParsedCsv(result, elapsed);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      setStatus('CSV could not be mapped.');
    } finally {
      setIsParsing(false);
    }
  }, [loadParsedCsv]);

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
        cleanerId,
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
  }, [cleanOutputs, cleanerId, hasCleanOutput, selectedFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }

    window.__shadowViewLoadCsvTextForTest = (csvText, fileName = 'test.csv') => {
      setIsParsing(true);
      setError('');
      setCleanError('');
      setDownloadInfo(null);
      setElapsedMs(null);
      setParseProgress(null);
      setParsedCsv(null);
      setSelectedFile(new File([csvText], fileName, {type: 'text/csv'}));
      setSelectedDeviceId('');
      setSelectedPoint(null);
      setDeviceMapData({points: [], segments: []});
      const started = performance.now();

      try {
        const result = parseShadowViewCsvText(csvText, fileName, setParseProgress);
        loadParsedCsv(result, performance.now() - started);
        return result;
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
        setError(message);
        setStatus('CSV could not be mapped.');
        throw caughtError;
      } finally {
        setIsParsing(false);
      }
    };

    return () => {
      delete window.__shadowViewLoadCsvTextForTest;
    };
  }, [loadParsedCsv]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const sampleCsv = new URLSearchParams(window.location.search).get('sampleCsv');
    if (!sampleCsv) {
      return;
    }

    let cancelled = false;
    const sampleFileName = displayNameFromUrl(sampleCsv);
    setIsParsing(true);
    setError('');
    setCleanError('');
    setDownloadInfo(null);
    setElapsedMs(null);
    setParseProgress(null);
    setParsedCsv(null);
    setSelectedDeviceId('');
    setSelectedPoint(null);
    setDeviceMapData({points: [], segments: []});
    setStatus(`Reading ${sampleFileName}...`);
    const started = performance.now();

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
        setSelectedFile(new File([csvText], sampleFileName, {type: 'text/csv'}));
        const result = parseShadowViewCsvText(csvText, sampleFileName, setParseProgress);
        loadParsedCsv(result, performance.now() - started);
      })
      .catch((caughtError) => {
        if (cancelled) {
          return;
        }
        setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        setStatus('CSV could not be mapped.');
      })
      .finally(() => {
        if (!cancelled) {
          setIsParsing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadParsedCsv]);

  useEffect(() => {
    if (!parsedCsv || !selectedDeviceId) {
      return undefined;
    }

    const nextMapData = prepareDeviceMapData(parsedCsv.observations, selectedDeviceId);
    setDeviceMapData(nextMapData);
    setSelectedPoint(nextMapData.points[0] ?? null);
    const timer = window.setTimeout(() => {
      dispatch(addDataToMap(createKeplerPayload({...nextMapData, deviceId: selectedDeviceId})));
    }, 500);

    return () => window.clearTimeout(timer);
  }, [dispatch, parsedCsv, selectedDeviceId]);

  const visiblePoints = deviceMapData.points.slice(0, 150);

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

        <section className="panel upload-panel">
          <div>
            <h2>CSV Upload</h2>
            <p>Load a Shadow View CSV to review scanner detections by BSSID.</p>
          </div>
          <input
            accept=".csv,text/csv"
            className="visually-hidden"
            onChange={handleFile}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="primary-button"
            disabled={isParsing}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            {isParsing ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <Upload aria-hidden="true" size={16} />}
            <span>{isParsing ? 'Reading CSV...' : 'Choose CSV'}</span>
          </button>
          {selectedFile && (
            <div className="file-pill">
              <FileText aria-hidden="true" size={14} />
              <span>{selectedFile.name}</span>
              <small>{formatFileSize(selectedFile.size)}</small>
            </div>
          )}
        </section>

        <section className="status-card" aria-live="polite">
          <p>{status}</p>
          {parseProgress && (
            <div className="progress-copy">
              {parseProgress.rowNumber.toLocaleString()} rows scanned, {parseProgress.mappedRows.toLocaleString()} mapped
            </div>
          )}
          {elapsedMs !== null && <div className="progress-copy">Time taken: {(elapsedMs / 1000).toFixed(2)} seconds</div>}
          {isParsing && <div className="progress-bar"><span /></div>}
          {error && <div className="error-text">{error}</div>}
        </section>

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

          <label className="field-label" htmlFor="cleaner-select">Cleaner</label>
          <select
            disabled={!cleanerApi.available || isCleaning}
            id="cleaner-select"
            value={cleanerId}
            onChange={(event) => setCleanerId(event.target.value)}
          >
            {(cleanerOptions.length ? cleanerOptions : [{cleaner_id: 'auto', display_name: 'Auto-detect cleaner'}]).map(
              (cleaner) => (
                <option key={cleaner.cleaner_id} value={cleaner.cleaner_id}>
                  {cleaner.display_name}
                </option>
              )
            )}
          </select>

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

        {parsedCsv && (
          <>
            <section className="stats-grid">
              <Stat label="Mappable rows" value={parsedCsv.mappedRows.toLocaleString()} />
              <Stat label="BSSIDs" value={parsedCsv.devices.length.toLocaleString()} />
              <Stat label="Skipped rows" value={parsedCsv.skippedRows.toLocaleString()} />
            </section>

            <ThreatPanel
              notification={notification}
              onSelectThreat={(threat) => setSelectedDeviceId(threat.bssid)}
              selectedDeviceId={selectedDeviceId}
              threats={threats}
              visibleThreats={visibleThreats}
            />

            <section className="panel">
              <ThreatSettings
                config={threatConfig}
                disabled={isParsing}
                onChange={handleThreatConfigChange}
                onReset={handleThreatConfigReset}
              />
            </section>

            <section className="panel">
              <label className="field-label" htmlFor="device-select">BSSID</label>
              <select
                id="device-select"
                value={selectedDeviceId}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
              >
                {parsedCsv.devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                    {threatsByBssid.has(device.id) ? ` [${severityLabel(threatsByBssid.get(device.id).severity)}]` : ''}
                    {' '}({device.count.toLocaleString()})
                  </option>
                ))}
              </select>
              {selectedDevice && (
                <p className="device-summary">
                  {threatsByBssid.has(selectedDevice.id) && (
                    <>
                      <span className={`severity-badge inline ${threatsByBssid.get(selectedDevice.id).severity}`}>
                        {severityLabel(threatsByBssid.get(selectedDevice.id).severity)}
                      </span>{' '}
                    </>
                  )}
                  {selectedDevice.count.toLocaleString()} sightings
                  {selectedDevice.firstTimeMs !== null && (
                    <> from {formatTime(selectedDevice.firstTimeMs)} to {formatTime(selectedDevice.lastTimeMs)}</>
                  )}
                </p>
              )}
            </section>

            <section className="panel sightings-panel">
              <div className="section-heading">
                <h2>Scanner Sightings</h2>
                <span>{deviceMapData.points.length.toLocaleString()}</span>
              </div>
              <div className="sighting-list">
                {visiblePoints.map((point) => (
                  <button
                    className={selectedPoint?.__row_number === point.__row_number ? 'sighting active' : 'sighting'}
                    key={point.__row_number}
                    onClick={() => setSelectedPoint(point)}
                    type="button"
                  >
                    <strong>#{point.__sequence}</strong>
                    <span>{point.__event_time || 'Unknown time'}</span>
                    <small>{scannerSightingMeta(point)}</small>
                  </button>
                ))}
              </div>
              {deviceMapData.points.length > visiblePoints.length && (
                <p className="list-note">Showing first {visiblePoints.length} sightings. Kepler shows all scanner points.</p>
              )}
            </section>
          </>
        )}
      </aside>

      <section className="map-area">
        <div className="map-card" ref={mapRef}>
          <KeplerGl
            appName="Shadow View"
            id="shadow-view-map"
            mapboxApiAccessToken={MAPBOX_TOKEN}
            mapStyles={CUSTOM_MAP_STYLES}
            mapStylesReplaceDefault
            version="MVP"
            width={mapSize.width}
            height={mapSize.height}
          />
          {!parsedCsv && (
            <div className="map-empty">
              <h2>No CSV loaded</h2>
              <p>Load a Shadow View CSV to map scanner detections.</p>
            </div>
          )}
        </div>

        <div className="details-card">
          <div className="section-heading">
            <h2>Sighting Details</h2>
            <span>{selectedPoint ? `Row ${selectedPoint.__row_number}` : 'No selection'}</span>
          </div>
          <p className="details-hint">Selected sighting values from the original CSV.</p>
          <DetailTable row={selectedPoint} />
        </div>
      </section>
    </main>
  );
}
