export const POINTS_DATASET_ID = 'shadow_view_points';
export const TRAIL_DATASET_ID = 'shadow_view_trail';

export const BLANK_MAP_STYLE = {
  version: 8,
  name: 'Shadow View Blank',
  sources: {},
  layers: [
    {
      id: 'shadow-view-background',
      type: 'background',
      paint: {
        'background-color': '#07111f'
      }
    }
  ]
};

function boundsFor(points) {
  if (!points.length) {
    return {
      latitude: 39.5,
      longitude: -98.35,
      zoom: 3
    };
  }

  const latitudes = points.map((point) => point.__latitude);
  const longitudes = points.map((point) => point.__longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const latSpan = Math.max(0.0001, maxLat - minLat);
  const lonSpan = Math.max(0.0001, maxLon - minLon);
  const span = Math.max(latSpan, lonSpan);

  let zoom = 15;
  if (span > 50) zoom = 2;
  else if (span > 20) zoom = 3;
  else if (span > 8) zoom = 5;
  else if (span > 2) zoom = 8;
  else if (span > 0.5) zoom = 10;
  else if (span > 0.08) zoom = 12;
  else if (span > 0.02) zoom = 14;

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    zoom: Math.max(1, zoom - 1),
    bounds: [
      minLon - lonSpan * 0.25,
      minLat - latSpan * 0.25,
      maxLon + lonSpan * 0.25,
      maxLat + latSpan * 0.25
    ]
  };
}

function tooltipFields(fields) {
  return fields
    .filter((field) => !['__latitude', '__longitude', '__lat0', '__lng0', '__lat1', '__lng1'].includes(field.name))
    .slice(0, 80)
    .map((field) => ({name: field.name, format: null}));
}

function fieldType(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'real';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return 'string';
}

function processRows(rows) {
  const keys = Array.from(
    rows.reduce((allKeys, row) => {
      Object.keys(row).forEach((key) => allKeys.add(key));
      return allKeys;
    }, new Set())
  );

  const sample = rows.find((row) => keys.some((key) => row[key] !== '' && row[key] !== null && row[key] !== undefined)) ?? {};

  return {
    fields: keys.map((key) => ({
      name: key,
      type: fieldType(sample[key]),
      format: ''
    })),
    rows: rows.map((row) => keys.map((key) => row[key] ?? ''))
  };
}

export function createKeplerPayload({points, segments, deviceId}) {
  const pointData = processRows(points);
  const segmentData = processRows(segments.length ? segments : [emptySegment(deviceId)]);
  const center = boundsFor(points);

  return {
    datasets: [
      {
        info: {
          label: `Sightings: ${deviceId}`,
          id: POINTS_DATASET_ID
        },
        data: pointData
      },
      {
        info: {
          label: `Trail: ${deviceId}`,
          id: TRAIL_DATASET_ID
        },
        data: segmentData
      }
    ],
    options: {
      centerMap: true,
      readOnly: false,
      keepExistingConfig: false
    },
    bounds: center.bounds,
    config: {
      mapState: {
        ...center,
        bearing: 0,
        pitch: 0,
        dragRotate: false
      },
      mapStyle: {
        styleType: 'shadow_view_blank',
        visibleLayerGroups: {
          label: false,
          road: false,
          border: false,
          building: false,
          water: true,
          land: true,
          '3d building': false
        }
      },
      visState: {
        layers: [
          {
            id: 'shadow-view-points',
            type: 'point',
            config: {
              dataId: POINTS_DATASET_ID,
              label: 'Device sightings',
              color: [76, 201, 240],
              columns: {
                lat: '__latitude',
                lng: '__longitude',
                altitude: null
              },
              isVisible: true,
              visConfig: {
                radius: 7,
                fixedRadius: true,
                opacity: 0.9,
                outline: true,
                thickness: 2,
                strokeColor: [255, 255, 255],
                filled: true
              }
            },
            visualChannels: {
              colorField: {
                name: '__sequence',
                type: 'integer'
              },
              colorScale: 'quantile'
            }
          },
          {
            id: 'shadow-view-trail',
            type: 'line',
            config: {
              dataId: TRAIL_DATASET_ID,
              label: 'Time trail',
              color: [255, 215, 0],
              columns: {
                lat0: '__lat0',
                lng0: '__lng0',
                lat1: '__lat1',
                lng1: '__lng1'
              },
              isVisible: segments.length > 0,
              visConfig: {
                opacity: 0.85,
                thickness: 3
              }
            },
            visualChannels: {
              colorField: {
                name: '__segment',
                type: 'integer'
              },
              colorScale: 'quantile'
            }
          }
        ],
        layerOrder: ['shadow-view-trail', 'shadow-view-points'],
        interactionConfig: {
          tooltip: {
            enabled: true,
            config: {
              fieldsToShow: {
                [POINTS_DATASET_ID]: tooltipFields(pointData.fields),
                [TRAIL_DATASET_ID]: tooltipFields(segmentData.fields)
              },
              compareMode: false,
              compareType: 'absolute'
            }
          }
        }
      }
    },
    info: {
      title: 'Shadow View Device Trail',
      description: `Selected device: ${deviceId}`
    }
  };
}

function emptySegment(deviceId) {
  return {
    __segment: 0,
    __device_id: deviceId,
    __lat0: 0,
    __lng0: 0,
    __lat1: 0,
    __lng1: 0,
    __from_time: '',
    __to_time: '',
    __from_row: '',
    __to_row: ''
  };
}
