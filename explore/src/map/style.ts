import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

export const SOURCE_ID = "features";

// Must match --accent in styles.css. The only hue on an otherwise monochrome
// map, reserved for hover/selection.
const ACCENT = "#41facf";

const SELECTED: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];
const HOVERED: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];
const EMPHASIZED: ExpressionSpecification = ["any", SELECTED, HOVERED];
const IS_DOT: ExpressionSpecification = ["boolean", ["get", "_dot"], false];

const SMALL_ZOOM = 8;
const FULL_ZOOM = 18;

const byZoom = (
  small: ExpressionSpecification,
  full: ExpressionSpecification,
): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  SMALL_ZOOM,
  small,
  FULL_ZOOM,
  full,
];

const emphasis = (base: number): ExpressionSpecification => [
  "case",
  SELECTED,
  base * 1.5,
  HOVERED,
  base * 1.25,
  base,
];

const DOT_RADIUS_SMALL = 0.5;
const DOT_RADIUS_FULL = 4.0;
const HALO_WIDTH_SMALL = 0.2;
const HALO_WIDTH_FULL = 1.0;

const dotRadius = (halo: boolean) =>
  byZoom(
    emphasis(DOT_RADIUS_SMALL + (halo ? HALO_WIDTH_SMALL : 0)),
    emphasis(DOT_RADIUS_FULL + (halo ? HALO_WIDTH_FULL : 0)),
  );

const POINT_FILTER: FilterSpecification = [
  "any",
  ["all", ["==", ["geometry-type"], "Point"], ["!", IS_DOT]],
  ["all", IS_DOT, ["<", ["zoom"], ["get", "_collapseZoom"]]],
];

type FeatureLayer =
  | Omit<FillLayerSpecification, "source">
  | Omit<LineLayerSpecification, "source">
  | Omit<CircleLayerSpecification, "source">;

export const FEATURE_LAYERS: FeatureLayer[] = [
  {
    id: "features-fill",
    type: "fill",
    filter: [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      [">=", ["zoom"], ["coalesce", ["get", "_collapseZoom"], 0]],
    ],
    paint: {
      "fill-color": ["case", EMPHASIZED, ACCENT, "#000000"],
      "fill-opacity": ["case", SELECTED, 0.5, HOVERED, 0.45, 0.35],
      "fill-outline-color": ["case", EMPHASIZED, ACCENT, "#000000"],
    },
  },
  {
    id: "features-line",
    type: "line",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": ["case", EMPHASIZED, ACCENT, "#000000"],
      "line-width": byZoom(emphasis(0.75), emphasis(2)),
    },
  },
  {
    id: "features-circle-halo",
    type: "circle",
    filter: POINT_FILTER,
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": dotRadius(true),
    },
  },
  {
    id: "features-circle",
    type: "circle",
    filter: POINT_FILTER,
    paint: {
      "circle-color": ["case", EMPHASIZED, ACCENT, "#000000"],
      "circle-radius": dotRadius(false),
    },
  },
];

export const DRAW_STYLES = {
  fillColor: ACCENT,
  fillOpacity: 0.2,
  outlineColor: ACCENT,
  outlineWidth: 2,
} as const;

export const POLYGON_DRAW_STYLES = {
  ...DRAW_STYLES,
  closingPointColor: ACCENT,
  closingPointOutlineColor: "#ffffff",
  coordinatePointColor: ACCENT,
  coordinatePointOutlineColor: "#ffffff",
} as const;

export const BASEMAP: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "Map data from <a href='https://openstreetmap.org/copyright'>OpenStreetMap</a>",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: { "raster-saturation": -1, "raster-opacity": 0.6 },
    },
  ],
};
