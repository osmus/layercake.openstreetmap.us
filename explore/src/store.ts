import { FIRST_TAG_COLUMN_INDEX, loadCatalog, loadUpdatedAt } from "./catalog.ts";
import { DuckDB } from "./duckdb.ts";
import { download } from "./export/download.ts";
import type { FormatId } from "./export/formats.ts";
import { boundsArea } from "./map/geometry.ts";
import type { MapView } from "./map/MapView.ts";
import { defaultOperator, operatorsFor } from "./query/filters.ts";
import { type Source, selectSQL } from "./query/sql.ts";
import { ResultCache } from "./ResultCache.ts";
import { readRoute, writeRoute } from "./router.ts";
import { Session } from "./session.ts";
import {
  type Area,
  type ColumnKind,
  type DrawTool,
  type Feature,
  type Fid,
  type Filter,
  featureFid,
  type Layer,
} from "./types.ts";

const FILTER_DEBOUNCE_MS = 200;
const MAX_FETCH_AREA_KM2 = 25_000;

let nextFilterId = 0;

// resolves just after the next frame is rendered
const painted = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Engine = "starting" | "ready" | { error: Error };
type FilterChanges = Partial<Pick<Filter, "column" | "operator" | "key" | "value">>;

export class Store {
  catalog: Record<string, Layer> | null = null;
  catalogError: Error | null = null;
  updatedAt: Date | null = null;
  engine: Engine = "starting";
  /** Set once MapLibre has loaded; non-null means fully usable. */
  map: MapView | null = null;
  /** The layer the URL asks for, which the catalog may not have explained yet. */
  route: string | null = null;
  session: Session | null = null;
  busy: string | null = null;
  busySeconds = 0;
  error: string | null = null;
  notice: string | null = null;

  private render: () => void;
  private db = new DuckDB();
  private renderQueued = false;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private extentBlocked = false;

  // bumped by openSession, fetch, etc; async tasks should check this
  // and abort if it has changed since they were fired.
  private generation = 0;

  constructor(render: () => void) {
    this.render = render;
    this.init();
  }

  notify() {
    // coalesce so multiple notify() calls only queue a single microtask
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private init() {
    // Each chain notifies on its way through, so the UI renders as the parts
    // of the app come up independently.
    loadCatalog()
      .then((catalog) => {
        this.catalog = catalog;
        this.applyRoute();
      })
      .catch((error) => {
        this.catalogError = error;
      })
      .finally(() => this.notify());

    loadUpdatedAt().then((date) => {
      this.updatedAt = date;
      this.notify();
    });

    // DuckDB takes several seconds to start, so kick it off alongside the
    // catalog rather than waiting for a dataset to be opened.
    this.db
      .init()
      .then(() => {
        this.engine = "ready";
      })
      .catch((error) => {
        this.engine = { error };
      })
      .finally(() => this.notify());
  }

  get engineFailed() {
    return typeof this.engine === "object";
  }

  /** Ground area the next fetch would cover, in km², or null before the map loads. */
  get extentArea(): number | null {
    if (!this.map) return null;
    return boundsArea(this.session?.area?.bounds ?? this.map.viewportBounds());
  }

  get extentTooLarge(): boolean {
    const area = this.extentArea;
    return area !== null && area > MAX_FETCH_AREA_KM2;
  }

  get tooLargeReason(): string {
    return `Area too large to fetch (limit: ${Math.round(MAX_FETCH_AREA_KM2).toLocaleString()} km²). Zoom in, or draw a smaller bbox or polygon.`;
  }

  /** Why the app cannot query yet, or null if it is fully initialized. */
  get notReadyReason(): string | null {
    if (typeof this.engine === "object") {
      return `Query engine failed to start: ${this.engine.error.message}`;
    }
    if (this.engine === "starting") return "Starting query engine";
    if (!this.map) return "Waiting for the map";
    return null;
  }

  /** Why a fetch cannot run right now, or null if it can. */
  get blockedReason(): string | null {
    return this.notReadyReason ?? (this.extentTooLarge ? this.tooLargeReason : null);
  }

  /** Called by MapView as the viewport moves. */
  onExtentChange() {
    const blocked = this.extentTooLarge;
    if (blocked === this.extentBlocked) return;
    this.extentBlocked = blocked;
    this.notify();
  }

  /** Open a layer and record it in history. */
  navigate(id: string) {
    if (id === this.route) return;
    this.route = id;
    this.openSession();
    writeRoute(id);
  }

  /** Adopt whatever the URL says, without writing history back. */
  applyRoute() {
    this.route = readRoute();
    this.openSession();
  }

  /**
   * Point the session at the routed layer. Called again when the catalog
   * arrives, since a deep link can name a layer before we know what it is.
   */
  private openSession() {
    const layer = this.route === null ? null : (this.catalog?.[this.route] ?? null);
    // A deep link to a layer whose metadata failed to load would otherwise open
    // an empty viewer with buttons that do nothing; fall back to no dataset.
    if (layer === null && this.route !== null && this.catalog !== null) this.route = null;
    if (layer?.id === this.session?.layer.id) return;

    const previous = this.session;
    this.generation++;
    this.session = layer ? new Session(layer, new ResultCache(this.db)) : null;
    clearTimeout(this.refreshTimer);
    this.error = null;
    this.notice = null;
    this.map?.armDraw(null);
    this.map?.clearFeatures();
    this.notify();

    // Failing to release the old table is not the new layer's problem.
    previous?.cache.drop().catch((error) => console.warn("Releasing cached data:", error));
  }

  setMap(view: MapView) {
    this.map = view;
    this.notify();
  }

  /**
   * Run `fn` under a progress label, with an elapsed-second counter. Can
   * safely be nested (the inner fn's label overwrites the outer one's).
   *
   * TODO: no way to cancel. duckdb-wasm only exposes cancelPendingQuery for
   * its pending-query API, which conn.query() does not use.
   */
  async withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const outer = this.busy;
    if (outer === null) {
      this.busySeconds = 0;
      this.error = null;
      this.notice = null;
    }
    this.busy = label;
    this.notify();

    // Nothing between the click and DuckDB's first call yields, so without
    // this the label would not be on screen until `fn` first awaits.
    await painted();

    const started = Date.now();
    const timer =
      outer === null
        ? setInterval(() => {
            this.busySeconds = Math.round((Date.now() - started) / 1000);
            this.notify();
          }, 1000)
        : null;

    try {
      return await fn();
    } finally {
      if (timer !== null) {
        clearInterval(timer);
        this.busySeconds = 0;
      }
      this.busy = outer;
      this.notify();
    }
  }

  private fail(prefix: string, error: unknown) {
    this.error = `${prefix}: ${message(error)}`;
    this.notify();
  }

  dismiss() {
    this.error = null;
    this.notice = null;
    this.notify();
  }

  /** Load the current extent into the session's cache table. */
  async fetch() {
    const s = this.session;
    const map = this.map;
    if (!s || !map || this.engine !== "ready" || this.busy !== null) return;

    // A refresh queued by typing would run against the table this fetch is
    // about to replace; bumping the generation supersedes it.
    clearTimeout(this.refreshTimer);
    const gen = ++this.generation;

    // Cleared before `withBusy` notifies, so a single render shows the
    // indicator and the emptied table together.
    s.selected = null;
    s.hovered = null;
    s.features = [];
    s.renderedFilterKey = null;
    map.clearFeatures();

    const src = this.extentOf(s, map);

    try {
      await this.withBusy("Querying", async () => {
        await s.cache.load(src);
        if (gen !== this.generation) return;
        // Forced: a new extent must render even if the filters are unchanged.
        // It bumps the generation again, which is safe: it catches its own
        // errors, and nothing below reads `gen` after it.
        await this.refreshResults({ force: true });
      });
    } catch (error) {
      // A layer switch drops the table this was filling; that is not a failure
      // the layer now on screen should hear about.
      if (gen !== this.generation) return;
      s.features = [];
      this.fail("Query failed", error);
    }
  }

  /** The extent the next fetch would use. */
  private extentOf(s: Session, map: MapView): Source {
    return {
      url: s.layer.url,
      bounds: s.area?.bounds ?? map.viewportBounds(),
      polygon: s.area?.polygon,
    };
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshResults(), FILTER_DEBOUNCE_MS);
  }

  /**
   * Re-read the cache table through the current filters and sort.
   */
  async refreshResults({ force = false } = {}) {
    const s = this.session;
    if (!s?.loaded) return;
    // Debounced refreshes yield to whatever is already running; the forced pass
    // inside fetch() is the one legitimate nesting.
    if (!force && this.busy !== null) return this.scheduleRefresh();

    // Captured together so the key describes exactly what the query asked for.
    // No projection: hiding a column must not cost a re-query.
    const filters = s.activeFilters;
    const sorts = s.sorts;
    const key = s.resultKey;
    if (!force && key === s.appliedResultKey) return;

    // Nothing cancels a running DuckDB query, so a superseded pass drops its
    // results instead.
    const gen = ++this.generation;

    try {
      await this.withBusy("Filtering", async () => {
        const features = await s.cache.features(filters, sorts);
        if (gen !== this.generation) return;
        // Recorded only on success, so a failed pass can be retried.
        s.appliedResultKey = key;
        await this.showFeatures(s, features);
      });
    } catch (error) {
      if (gen === this.generation) this.fail("Filter failed", error);
    }
  }

  /**
   * Show `features`, redrawing the map only when the set of features changed.
   */
  private async showFeatures(s: Session, features: Feature[]) {
    s.features = features;

    const visible = new Set(features.map(featureFid));
    if (s.selected !== null && !visible.has(s.selected)) {
      s.selected = null;
      this.map?.setSelected(null);
    }
    if (s.hovered !== null && !visible.has(s.hovered)) {
      s.hovered = null;
      this.map?.setHover(null);
    }

    // changing the sort yields the same features in a new order; there's no
    // point in redrawing the map in this case, but we do trigger a scroll so
    // that the selected row is scrolled back into view again
    const key = s.filterKey;
    const sameFeatures = key === s.renderedFilterKey;
    s.renderedFilterKey = key;
    if (sameFeatures && s.selected !== null) s.scrollRequest++;

    this.notify();
    if (sameFeatures) return;

    const map = this.map;
    if (map) await this.withBusy("Rendering", () => map.setFeatures(features));
  }

  async exportAs(format: FormatId) {
    const s = this.session;
    if (!s?.loaded || this.busy !== null) return;

    // Read, not bumped: an export supersedes nothing. The busy gate keeps
    // refreshes out, so this only moves if the user navigates.
    // CAREFUL: we don't want to increment this.generation here; starting
    // an export does not invalidate in-flight async tasks like fetching
    const gen = this.generation;

    try {
      const result = await this.withBusy(`Exporting ${format}`, () =>
        s.cache.export(s.refineQuery, format),
      );
      download(result, format);
      this.notice = `Downloaded ${result.filename}`;
      this.notify();
    } catch (error) {
      if (gen === this.generation) this.fail("Export failed", error);
    }
  }

  /**
   * Copy a DuckDB SQL query to the clipboard that would return the same
   * elements that are currently shown on-screen (or which would be returned
   * by fetch, if nothing has been fetched yet).
   */
  async copySQL() {
    const s = this.session;
    const map = this.map;
    if (!s || !map) return;

    const src = s.cache.extent ?? this.extentOf(s, map);
    await navigator.clipboard.writeText(selectSQL({ ...src, ...s.refineQuery }));
  }

  toggleColumn(column: string) {
    // this doesn't actually cost a re-query; we handle showing/hidin
    // columns in the UI, not via SQL SELECT
    const s = this.session;
    if (!s) return;
    if (s.selectedColumns.has(column)) s.selectedColumns.delete(column);
    else s.selectedColumns.add(column);
    this.dropHiddenSorts(s);
    this.notify();
  }

  setAllColumns(selected: boolean) {
    const s = this.session;
    if (!s) return;
    s.selectedColumns = selected ? new Set(s.columns) : new Set();
    this.dropHiddenSorts(s);
    this.notify();
  }

  /**
   * Drop sorts on hidden columns (otherwise there's no way to undo them)
   */
  private dropHiddenSorts(s: Session) {
    const kept = s.sorts.filter((sort) => s.selectedColumns.has(sort.column));
    if (kept.length === s.sorts.length) return;
    s.sorts = kept;
    this.scheduleRefresh();
  }

  /**
   * Cycle a column through ascending, descending, unsorted.
   *
   * A newly sorted column becomes the most significant, with existing sorts
   * kept behind it as tiebreaks. Reversing a column already in the list leaves
   * its priority alone.
   */
  toggleSort(column: string) {
    const s = this.session;
    if (!s) return;
    const current = s.sorts.find((sort) => sort.column === column);

    if (!current) s.sorts = [{ column, direction: "asc" }, ...s.sorts];
    else if (current.direction === "asc")
      s.sorts = s.sorts.map((sort) =>
        sort === current ? { ...sort, direction: "desc" as const } : sort,
      );
    else s.sorts = s.sorts.filter((sort) => sort !== current);

    this.scheduleRefresh();
    this.notify();
  }

  addFilter() {
    const s = this.session;
    if (!s) return;

    // The column after the last filter's, so filters walk down the schema
    // instead of stacking on one column.
    const { columns, kinds } = s.layer;
    const last = s.filters.at(-1);
    const index = last ? columns.indexOf(last.column) + 1 : FIRST_TAG_COLUMN_INDEX;
    const column = columns[Math.min(index, columns.length - 1)] ?? "";
    const kind = kindOf(kinds, column);

    s.filters = [
      ...s.filters,
      { id: nextFilterId++, column, kind, operator: defaultOperator(kind), key: "", value: "" },
    ];
    this.scheduleRefresh();
    this.notify();
  }

  updateFilter(id: number, changes: FilterChanges) {
    const s = this.session;
    if (!s) return;

    s.filters = s.filters.map((filter) => {
      if (filter.id !== id) return filter;

      const next = { ...filter, ...changes };
      if (changes.column !== undefined) next.kind = kindOf(s.layer.kinds, changes.column);
      // An operator the newly chosen column does not offer falls back to its default.
      if (!operatorsFor(next.kind).some((o) => o.id === next.operator)) {
        next.operator = defaultOperator(next.kind);
      }
      return next;
    });
    this.scheduleRefresh();
    this.notify();
  }

  removeFilter(id: number) {
    const s = this.session;
    if (!s) return;
    s.filters = s.filters.filter((filter) => filter.id !== id);
    this.scheduleRefresh();
    this.notify();
  }

  /** Arm a drawing tool, discarding whatever was drawn before. Null is "Clear". */
  armDraw(tool: DrawTool | null) {
    const s = this.session;
    if (!s) return;
    s.drawTool = tool;
    s.area = null;
    this.map?.armDraw(tool);
    this.notify();
  }

  /** Called by MapView when a shape is finished. */
  onAreaDrawn(area: Area) {
    const s = this.session;
    if (!s) return;
    s.area = area;
    s.drawTool = null;
    this.notify();
  }

  /** Called by MapView when a feature is clicked, or empty space deselects. */
  selectFromMap(fid: Fid | null) {
    const s = this.session;
    if (!s) return;
    if (fid === null) return this.deselect();

    s.selected = fid;
    s.scrollRequest++;
    this.map?.setSelected(fid);
    this.notify();
  }

  /**
   * Reselecting the current row deselects it. `scroll` is for keyboard nav,
   * where the newly selected row may be off screen.
   */
  selectFromTable(fid: Fid, { scroll = false } = {}) {
    const s = this.session;
    if (!s) return;
    if (s.selected === fid) return this.deselect();

    const feature = s.features.find((f) => featureFid(f) === fid);
    if (!feature) return;

    s.selected = fid;
    if (scroll) s.scrollRequest++;
    this.map?.setSelected(fid);
    this.map?.zoomTo(feature.geometry);
    this.notify();
  }

  deselect() {
    const s = this.session;
    if (!s || s.selected === null) return;
    s.selected = null;
    this.map?.setSelected(null);
    this.notify();
  }

  /** Light up a feature's marker and row, driven by either the map or the table. */
  hover(fid: Fid | null) {
    const s = this.session;
    if (!s || s.hovered === fid) return;
    s.hovered = fid;
    this.map?.setHover(fid);
    this.notify();
  }
}

const kindOf = (kinds: Map<string, ColumnKind>, column: string): ColumnKind =>
  kinds.get(column) ?? { kind: "other" };
