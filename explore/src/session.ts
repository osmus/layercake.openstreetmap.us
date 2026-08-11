import { filterComplete } from "./query/filters.ts";
import type { RefineQuery, ResultCache } from "./ResultCache.ts";
import type { Area, CompleteFilter, DrawTool, Feature, Fid, Filter, Layer, Sort } from "./types.ts";

/**
 * A sessions owns all state related to the currently open layer (remote parquet file).
 */
export class Session {
  readonly layer: Layer;
  readonly cache: ResultCache;

  /** GeoJSON features representing the rows matched by the current filters */
  features: Feature[] = [];
  selectedColumns: Set<string>;
  filters: Filter[] = [];
  /** Columns the table is ordered by, most significant first. */
  sorts: Sort[] = [];
  area: Area | null = null;
  drawTool: DrawTool | null = null;
  selected: Fid | null = null;
  hovered: Fid | null = null;
  /** Bumped when a selection needs the table scrolled to it. */
  scrollRequest = 0;
  appliedResultKey: string | null = null;
  /** filterKey of what is currently drawn on the map, or null if nothing is. */
  renderedFilterKey: string | null = null;

  constructor(layer: Layer, cache: ResultCache) {
    this.layer = layer;
    this.cache = cache;
    this.selectedColumns = new Set(layer.columns);
  }

  get loaded() {
    return this.cache.loaded;
  }

  get columns(): string[] {
    return this.layer.columns;
  }

  get activeFilters(): CompleteFilter[] {
    return this.filters.filter(filterComplete);
  }

  get filterKey(): string {
    return JSON.stringify(this.activeFilters.map((f) => [f.column, f.operator, f.key, f.value]));
  }

  get resultKey(): string {
    return JSON.stringify([this.filterKey, this.sorts.map((s) => [s.column, s.direction])]);
  }

  get visibleColumns(): string[] {
    return this.columns.filter((c) => this.selectedColumns.has(c));
  }

  get projection(): string[] | null {
    const visible = this.visibleColumns;
    return visible.length === this.columns.length ? null : visible;
  }

  get refineQuery(): RefineQuery {
    return { filters: this.activeFilters, sorts: this.sorts, columns: this.projection };
  }
}
