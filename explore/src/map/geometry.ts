import turfArea from "@turf/area";
import bboxPolygon from "@turf/bbox-polygon";
import type { Position } from "geojson";
import type { Bounds, Feature, Fid, SimpleGeometry } from "../types.ts";
import { FID } from "../types.ts";

// Below this on-screen size a polygon collapses to a point marker.
const COLLAPSE_PX = 2;

// Mercator scale (degrees longitude at the equator) at z0
const MERCATOR_K = 111320 / 156543.03392;

type Coordinates = Position | Position[] | Position[][] | Position[][][];

export function bbox(geometry: SimpleGeometry): Bounds {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;

  const walk = (coords: Coordinates) => {
    const head = coords[0];
    if (typeof head !== "number") {
      for (const child of coords as Coordinates[]) walk(child);
      return;
    }
    const [x = 0, y = 0] = coords as Position;
    xmin = Math.min(xmin, x);
    ymin = Math.min(ymin, y);
    xmax = Math.max(xmax, x);
    ymax = Math.max(ymax, y);
  };

  walk(geometry.coordinates);
  return { xmin, ymin, xmax, ymax };
}

/** Ground area covered by a bounding box, in square kilometres. */
export function boundsArea({ xmin, ymin, xmax, ymax }: Bounds): number {
  return turfArea(bboxPolygon([xmin, ymin, xmax, ymax])) / 1e6;
}

/**
 * The zoom below which a polygon's bounding box would be smaller than
 * `COLLAPSE_PX` on screen, or 0 if it never gets that small.
 */
export function collapseZoom({ xmin, ymin, xmax, ymax }: Bounds): number {
  const latRad = (((ymin + ymax) / 2) * Math.PI) / 180;
  const widthAtZ0 = (xmax - xmin) * MERCATOR_K;
  const heightAtZ0 = ((ymax - ymin) * MERCATOR_K) / Math.cos(latRad);
  const sizeAtZ0 = Math.max(widthAtZ0, heightAtZ0);
  if (sizeAtZ0 <= 0) return 0;
  return Math.ceil(Math.log2(COLLAPSE_PX / sizeAtZ0));
}

type RenderProperties = { [FID]: Fid; _dot?: boolean; _collapseZoom?: number };
export type RenderFeature = {
  type: "Feature";
  properties: RenderProperties;
  geometry: SimpleGeometry;
};

/**
 * Strip features down to what the map style reads.
 */
export function renderable(features: Feature[]): RenderFeature[] {
  const out: RenderFeature[] = [];

  for (const feature of features) {
    const { geometry } = feature;
    const fid = feature.properties[FID] as Fid;

    const box = geometry.type.endsWith("Polygon") ? bbox(geometry) : null;
    const zoom = box ? collapseZoom(box) : 0;

    out.push({
      type: "Feature",
      properties: zoom > 0 ? { [FID]: fid, _collapseZoom: zoom } : { [FID]: fid },
      geometry,
    });

    if (!box || zoom <= 0) continue;

    // same FID for the label point so the same select/hover feature states hit both
    out.push({
      type: "Feature",
      properties: { [FID]: fid, _dot: true, _collapseZoom: zoom },
      geometry: {
        type: "Point",
        coordinates: [(box.xmin + box.xmax) / 2, (box.ymin + box.ymax) / 2],
      },
    });
  }

  return out;
}
