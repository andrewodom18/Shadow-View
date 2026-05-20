import {POINTS_DATASET_ID} from './keplerConfig.js';

export const KEPLER_MAP_ID = 'shadow-view-map';
export const POINTS_LAYER_ID = 'shadow-view-points';

export function keplerInstance(state) {
  return state?.keplerGl?.[KEPLER_MAP_ID] ?? null;
}

export function clickedPointIndex(clicked) {
  if (!clicked?.picked || clicked.layer?.props?.id !== POINTS_LAYER_ID) {
    return null;
  }

  const index = Number.isInteger(clicked.index) ? clicked.index : clicked.object?.index;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function clickedPoint(clicked, points) {
  const index = clickedPointIndex(clicked);
  return index === null ? null : (points[index] ?? null);
}

export function pointLayerIndex(instance) {
  const layers = instance?.visState?.layers ?? [];
  const index = layers.findIndex((layer) => layer.id === POINTS_LAYER_ID);
  return index >= 0 ? index : null;
}

export function pointIndexByRowNumber(points) {
  return new Map(points.map((point, index) => [point.__row_number, index]));
}

export function mapClickInfoForPoint(point, index, layerIndex) {
  if (!point || !Number.isInteger(index) || index < 0 || !Number.isInteger(layerIndex) || layerIndex < 0) {
    return null;
  }

  return {
    picked: true,
    index,
    object: {index},
    coordinate: [point.__longitude, point.__latitude],
    layer: {
      props: {
        id: POINTS_LAYER_ID,
        idx: layerIndex,
        dataId: POINTS_DATASET_ID
      }
    }
  };
}
