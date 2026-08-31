import type { FeatureCollection } from "geojson";
import maplibregl from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { SimpleGeometry } from "../types.ts";
import { type Area, type Bounds, type DrawTool, type Feature, FID, type Fid } from "../types.ts";
import { bbox, renderable } from "./geometry.ts";
import { BASEMAP, DRAW_STYLES, FEATURE_LAYERS, POLYGON_DRAW_STYLES, SOURCE_ID } from "./style.ts";

// click target size (half the box width/height)
const HIT_RADIUS = 6;

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export interface MapViewEvents {
  onFeatureClick(fid: Fid | null): void;
  onFeatureHover(fid: Fid | null): void;
  onAreaDrawn(area: Area): void;
  onExtentChange(): void;
}

export class MapView {
  private map: maplibregl.Map;
  private events: MapViewEvents;
  private source: maplibregl.GeoJSONSource;
  private draw: TerraDraw;
  private tool: DrawTool | null = null;
  private hasShape = false;
  // HACK: these are copies of the store's hover and selection state, kept in
  // sync here. only needed so repeat writes can be skipped and so a click knows
  // whether it is deselecting.
  private hovered: Fid | null = null;
  private selected: Fid | null = null;
  private lastClick: string | null = null;
  private lastClickIndex = -1;

  static async create(container: HTMLElement, events: MapViewEvents): Promise<MapView> {
    const map = new maplibregl.Map({
      container,
      style: BASEMAP,
      center: [-98.5795, 39.8283],
      zoom: 4,
      hash: true,
      // Clicking the same spot repeatedly cycles through the features under
      // the cursor; disable double-click-to-zoom so it doesn't collide.
      doubleClickZoom: false,
    });
    map.addControl(new maplibregl.NavigationControl());
    await map.once("load");
    return new MapView(map, events);
  }

  private constructor(map: maplibregl.Map, events: MapViewEvents) {
    this.map = map;
    this.events = events;

    map.addSource(SOURCE_ID, { type: "geojson", promoteId: FID, data: EMPTY });
    for (const layer of FEATURE_LAYERS) map.addLayer({ ...layer, source: SOURCE_ID });
    this.source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;

    this.draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawSelectMode(),
        new TerraDrawRectangleMode({ styles: DRAW_STYLES }),
        new TerraDrawPolygonMode({ styles: POLYGON_DRAW_STYLES }),
      ],
    });
    this.draw.on("finish", (id) => this.finishDrawing(id));

    const layers = FEATURE_LAYERS.map((l) => l.id);

    map.on("click", (e) => {
      const fids = this.featureIdsNear(e.point, layers);
      // Clicking the only feature under the cursor deselects it when it is
      // already selected; otherwise clicking the same spot cycles to the next
      // feature underneath.
      if (fids.length === 0 || (fids.length === 1 && fids[0] === this.selected)) {
        this.lastClick = null;
        this.events.onFeatureClick(null);
        return;
      }
      this.events.onFeatureClick(this.cycleClick(fids));
    });

    map.on("mousemove", (e) => {
      const fid = this.featureIdsNear(e.point, layers)[0] ?? null;
      map.getCanvas().style.cursor = fid === null ? "" : "pointer";
      this.events.onFeatureHover(fid);
    });

    map.on("mouseout", () => {
      map.getCanvas().style.cursor = "";
      this.events.onFeatureHover(null);
    });

    map.on("move", () => this.events.onExtentChange());
  }

  async setFeatures(features: Feature[]): Promise<void> {
    // Parsing and tiling happen off the main thread, so `setData` returns long
    // before anything is drawn. `waitForCompletion` waits for the worker, and
    // waiting for `idle` after that ensures everything is rendered.
    await this.source.setData({ type: "FeatureCollection", features: renderable(features) }, true);
    await this.map.once("idle");
  }

  clearFeatures() {
    this.source.setData(EMPTY);
    this.map.removeFeatureState({ source: SOURCE_ID });
    this.hovered = null;
    this.selected = null;
    this.lastClick = null;
  }

  setSelected(fid: Fid | null) {
    if (fid === this.selected) return;
    if (this.selected !== null) this.setFeatureState(this.selected, { selected: false });
    this.selected = fid;
    if (fid !== null) this.setFeatureState(fid, { selected: true });
  }

  setHover(fid: Fid | null) {
    if (fid === this.hovered) return;
    if (this.hovered !== null) this.setFeatureState(this.hovered, { hover: false });
    this.hovered = fid;
    if (fid !== null) this.setFeatureState(fid, { hover: true });
  }

  /** Arm a drawing tool, discarding whatever was drawn. Null returns to select mode. */
  armDraw(tool: DrawTool | null) {
    if (this.draw.enabled) this.draw.clear();
    this.hasShape = false;
    this.tool = tool;
    this.setMode(tool);
  }

  viewportBounds(): Bounds {
    const b = this.map.getBounds();
    return { xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth() };
  }

  zoomTo(geometry: SimpleGeometry) {
    const { xmin, ymin, xmax, ymax } = bbox(geometry);
    this.map.fitBounds(
      [
        [xmin, ymin],
        [xmax, ymax],
      ],
      { padding: 100, maxZoom: 16, animate: false },
    );
  }

  resize() {
    this.map.resize();
  }

  remove() {
    this.map.remove();
  }

  private finishDrawing(id: string | number) {
    const feature = this.draw.getSnapshotFeature(id);
    if (feature?.geometry.type !== "Polygon") return;

    const drawnPolygon = this.tool === "polygon";
    this.hasShape = true;
    this.tool = null;
    this.setMode(null);

    this.events.onAreaDrawn({
      bounds: bbox(feature.geometry),
      ...(drawnPolygon ? { polygon: feature.geometry.coordinates } : {}),
    });
  }

  private setMode(tool: DrawTool | null) {
    if (tool === null && !this.hasShape) {
      if (this.draw.enabled) this.draw.stop();
      return;
    }
    if (!this.draw.enabled) {
      this.draw.start();
      // terra-draw doesn't expose an option for this, so patch it into the style
      this.map.setPaintProperty("td-polygon-outline", "line-dasharray", [2, 2]);
    }
    this.draw.setMode(tool ?? "select");
  }

  private setFeatureState(fid: Fid, state: Record<string, boolean>) {
    this.map.setFeatureState({ source: SOURCE_ID, id: fid }, state);
  }

  /** The features under `point`, lowest id first so hover and click agree. */
  private featureIdsNear(point: maplibregl.Point, layers: string[]): Fid[] {
    const box: [maplibregl.PointLike, maplibregl.PointLike] = [
      [point.x - HIT_RADIUS, point.y - HIT_RADIUS],
      [point.x + HIT_RADIUS, point.y + HIT_RADIUS],
    ];
    const hits = this.map.queryRenderedFeatures(box, { layers });
    const fids = new Set(hits.map((f) => f.properties[FID] as Fid));
    return [...fids].sort((a, b) => a - b);
  }

  /** Repeated clicks on the same stack of features walk through it. */
  private cycleClick(fids: Fid[]): Fid | null {
    const spot = fids.join(",");
    this.lastClickIndex = spot === this.lastClick ? (this.lastClickIndex + 1) % fids.length : 0;
    this.lastClick = spot;
    return fids[this.lastClickIndex] ?? null;
  }
}
