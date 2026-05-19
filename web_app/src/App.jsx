import {KeplerGl} from '@kepler.gl/components';
import {addDataToMap} from '@kepler.gl/actions';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useDispatch} from 'react-redux';

import {formatTime, parseShadowViewCsv, parseShadowViewCsvText, prepareDeviceMapData} from './csvShadowView.js';
import {BLANK_MAP_STYLE, createKeplerPayload} from './keplerConfig.js';

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

function DetailTable({row}) {
  if (!row) {
    return <p className="empty-state">Choose a sighting below to inspect the original CSV values.</p>;
  }

  return (
    <div className="detail-table">
      {Object.entries(row)
        .filter(([, value]) => value !== '')
        .map(([key, value]) => (
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
  const [parsedCsv, setParsedCsv] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [deviceMapData, setDeviceMapData] = useState({points: [], segments: []});
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [status, setStatus] = useState('Upload a Shadow View CSV to map device movement.');
  const [parseProgress, setParseProgress] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState('');
  const [elapsedMs, setElapsedMs] = useState(null);
  const fileInputRef = useRef(null);

  const selectedDevice = useMemo(
    () => parsedCsv?.devices.find((device) => device.id === selectedDeviceId) ?? null,
    [parsedCsv, selectedDeviceId]
  );

  const loadParsedCsv = useCallback((result, elapsed) => {
    setElapsedMs(elapsed);
    setParsedCsv(result);
    setSelectedDeviceId(result.devices[0]?.id ?? '');
    setStatus(`Loaded ${result.fileName}. ${result.mappedRows.toLocaleString()} mappable rows found.`);
  }, []);

  const handleFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsParsing(true);
    setError('');
    setElapsedMs(null);
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
  }, [dispatch, loadParsedCsv]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }

    window.__shadowViewLoadCsvTextForTest = (csvText, fileName = 'test.csv') => {
      setIsParsing(true);
      setError('');
      setElapsedMs(null);
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
    setIsParsing(true);
    setError('');
    setStatus(`Reading ${sampleCsv}...`);
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
        const result = parseShadowViewCsvText(csvText, sampleCsv.split('/').pop() || 'sample.csv', setParseProgress);
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
      return;
    }

    const nextMapData = prepareDeviceMapData(parsedCsv.observations, selectedDeviceId);
    setDeviceMapData(nextMapData);
    setSelectedPoint(nextMapData.points[0] ?? null);
    dispatch(addDataToMap(createKeplerPayload({...nextMapData, deviceId: selectedDeviceId})));
  }, [dispatch, parsedCsv, selectedDeviceId]);

  const visiblePoints = deviceMapData.points.slice(0, 150);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">SV</div>
          <div>
            <h1>Shadow View Map</h1>
            <p>Device trail viewer</p>
          </div>
        </div>

        <section className="panel upload-panel">
          <div>
            <h2>CSV Upload</h2>
            <p>Maps BSSID movement from raw Shadow View exports.</p>
          </div>
          <input
            accept=".csv,text/csv"
            className="visually-hidden"
            onChange={handleFile}
            ref={fileInputRef}
            type="file"
          />
          <button className="primary-button" disabled={isParsing} onClick={() => fileInputRef.current?.click()}>
            {isParsing ? 'Reading CSV...' : 'Choose CSV'}
          </button>
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

        {parsedCsv && (
          <>
            <section className="stats-grid">
              <Stat label="Mappable rows" value={parsedCsv.mappedRows.toLocaleString()} />
              <Stat label="Devices" value={parsedCsv.devices.length.toLocaleString()} />
              <Stat label="Skipped rows" value={parsedCsv.skippedRows.toLocaleString()} />
            </section>

            <section className="panel">
              <label className="field-label" htmlFor="device-select">Device (BSSID)</label>
              <select
                id="device-select"
                value={selectedDeviceId}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
              >
                {parsedCsv.devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label} ({device.count.toLocaleString()})
                  </option>
                ))}
              </select>
              {selectedDevice && (
                <p className="device-summary">
                  {selectedDevice.count.toLocaleString()} sightings
                  {selectedDevice.firstTimeMs !== null && (
                    <> from {formatTime(selectedDevice.firstTimeMs)} to {formatTime(selectedDevice.lastTimeMs)}</>
                  )}
                </p>
              )}
            </section>

            <section className="panel sightings-panel">
              <div className="section-heading">
                <h2>Sightings</h2>
                <span>{deviceMapData.points.length.toLocaleString()}</span>
              </div>
              <div className="sighting-list">
                {visiblePoints.map((point) => (
                  <button
                    className={selectedPoint?.__row_number === point.__row_number ? 'sighting active' : 'sighting'}
                    key={point.__row_number}
                    onClick={() => setSelectedPoint(point)}
                  >
                    <strong>#{point.__sequence}</strong>
                    <span>{point.__event_time || 'Unknown time'}</span>
                    <small>{point.__latitude.toFixed(6)}, {point.__longitude.toFixed(6)}</small>
                  </button>
                ))}
              </div>
              {deviceMapData.points.length > visiblePoints.length && (
                <p className="list-note">Showing first {visiblePoints.length} sightings. Kepler shows all mapped points.</p>
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
            mapStyles={[
              {
                id: 'shadow_view_blank',
                label: 'Shadow View Blank',
                style: BLANK_MAP_STYLE
              }
            ]}
            mapStylesReplaceDefault
            readOnly
            version="MVP"
            width={mapSize.width}
            height={mapSize.height}
          />
          {!parsedCsv && (
            <div className="map-empty">
              <h2>No CSV loaded</h2>
              <p>Choose a raw Shadow View export to display device points and the time-ordered trail.</p>
            </div>
          )}
        </div>

        <div className="details-card">
          <div className="section-heading">
            <h2>Point Details</h2>
            <span>{selectedPoint ? `Row ${selectedPoint.__row_number}` : 'No selection'}</span>
          </div>
          <p className="details-hint">
            Kepler shows the same row data when a mapped point is clicked. This panel keeps the selected sighting visible.
          </p>
          <DetailTable row={selectedPoint} />
        </div>
      </section>
    </main>
  );
}
