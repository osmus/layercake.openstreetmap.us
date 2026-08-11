import type { DuckDB, Row } from "./duckdb.ts";
import type { ExportResult } from "./export/download.ts";
import { exportFilename, exportPath, FORMATS, type FormatId } from "./export/formats.ts";
import { exportSQL, materializeSQL, rowsSQL, type Source } from "./query/sql.ts";
import type { CompleteFilter, Feature, Sort } from "./types.ts";

export interface RefineQuery {
  filters: CompleteFilter[];
  sorts: Sort[];
  columns: string[] | null;
}

let serial = 0;

/**
 * A DuckDB table holding the rows fetched for an area. Filtering, sorting,
 * projecting and exporting all run against it rather than the remote parquet,
 * which is what makes them fast.
 */
export class ResultCache {
  readonly table = `features_${serial++}`;
  extent: Source | null = null;

  private db: DuckDB;
  private sqlTypes = new Map<string, string>();
  private created = false;

  constructor(db: DuckDB) {
    this.db = db;
  }

  get loaded() {
    return this.extent !== null;
  }

  async load(src: Source): Promise<void> {
    this.extent = null;
    this.sqlTypes = new Map();
    this.created = true;

    await this.db.query(materializeSQL(this.table, src));
    this.sqlTypes = await this.db.columnTypes(this.table);
    this.extent = src;
  }

  async features(filters: CompleteFilter[], sorts: Sort[]): Promise<Feature[]> {
    const rows = await this.db.query(rowsSQL(this.table, filters, sorts));
    return rows.map(toFeature);
  }

  async export(query: RefineQuery, format: FormatId): Promise<ExportResult> {
    const spec = FORMATS[format];
    const path = exportPath(format);
    const sql = exportSQL(this.table, query, format, path, this.sqlTypes);

    const files = spec.gdal
      ? await this.gdalFiles(path, sql, spec.siblings ?? [])
      : new Map([[path, await this.bufferFile(path, sql)]]);

    return { filename: exportFilename(format), path, files };
  }

  async drop(): Promise<void> {
    if (!this.created) return;
    this.extent = null;
    this.sqlTypes = new Map();
    this.created = false;
    await this.db.query(`DROP TABLE IF EXISTS ${this.table};`);
  }

  private async bufferFile(path: string, sql: string): Promise<Uint8Array> {
    await this.db.query(sql);
    const bytes = await this.db.readFile(path);
    await this.db.dropFile(path).catch(() => {});
    return bytes;
  }

  private async gdalFiles(path: string, sql: string, siblings: string[]) {
    const stem = path.replace(/\.[^.]+$/, "");
    const paths = [path, ...siblings.map((extension) => `${stem}.${extension}`)];

    // every path GDAL might touch has to exist first, otherwise weird things
    // happen. might be a duckdb-wasm bug? seems like files get corrupted.
    for (const p of paths) await this.db.registerFile(p, new Uint8Array());

    try {
      await this.db.query(sql);

      const files = new Map<string, Uint8Array>();
      for (const p of paths) {
        const bytes = await this.db.readFile(p);
        if (bytes.length > 0) files.set(p, bytes);
      }
      return files;
    } finally {
      for (const p of paths) await this.db.dropFile(p).catch(() => {});
    }
  }
}

function toFeature(row: Row): Feature {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key !== "geometry") properties[key] = value;
  }
  return { type: "Feature", properties, geometry: JSON.parse(String(row.geometry)) };
}
