import * as duckdb from "@duckdb/duckdb-wasm";

export type Row = Record<string, unknown>;

/**
 * DuckDB-WASM: the engine's lifecycle, queries, and the virtual filesystem
 * exports are written to. Knows nothing about the app's queries or formats.
 */
export class DuckDB {
  private handle: { db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection } | null = null;

  private get ready() {
    if (!this.handle) throw new Error("the query engine is not running");
    return this.handle;
  }

  async init() {
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    if (!bundle.mainWorker) throw new Error("no DuckDB bundle for this browser");
    const worker = await duckdb.createWorker(bundle.mainWorker);
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    await db.open({
      path: ":memory:",
      query: {
        castBigIntToDouble: true,
        castTimestampToDate: true,
        castDecimalToDouble: true,
      },
      filesystem: {
        // Force HTTP range requests so DuckDB fetches only the row groups it
        // needs rather than the whole Parquet file.
        allowFullHTTPReads: false,
        reliableHeadRequests: true,
        forceFullHTTPReads: false,
      },
    });

    const conn = await db.connect();

    // The spatial extension's GeoParquet auto-conversion hook triggers a
    // `stoi: no conversion` error in duckdb-wasm v1.5.2 when reading. Running
    // this first fixes it, for reasons nobody has pinned down.
    // See https://github.com/duckdb/duckdb-wasm/issues/2199
    await conn.query(`SELECT * FROM duckdb_coordinate_systems();`);

    await conn.query(`INSTALL spatial;`);
    await conn.query(`LOAD spatial;`);

    // Pin the axis order for GDAL exports. Without it GDAL may use the
    // authority-defined order for the CRS (lat/lon for EPSG:4326) while DuckDB
    // stores lon/lat, silently transposing exported coordinates.
    // `SET enable_geoparquet_conversion = false` fixes this too, but then omits
    // the geo metadata from Parquet exports.
    await conn.query(`SET geometry_always_xy = true;`);

    this.handle = { db, conn };
  }

  async query(sql: string): Promise<Row[]> {
    const result = await this.ready.conn.query(sql);
    return result.toArray() as Row[];
  }

  /** The types of the columns in `source` (a table name, or a quoted parquet URL). */
  async columnTypes(source: string): Promise<Map<string, string>> {
    const rows = await this.query(`DESCRIBE SELECT * FROM ${source} LIMIT 0`);
    return new Map(rows.map((row) => [String(row.column_name), String(row.column_type)]));
  }

  registerFile(path: string, bytes: Uint8Array): Promise<void> {
    return this.ready.db.registerFileBuffer(path, bytes);
  }

  readFile(path: string): Promise<Uint8Array> {
    return this.ready.db.copyFileToBuffer(path);
  }

  dropFile(path: string): Promise<void> {
    return this.ready.db.dropFile(path).then(() => undefined);
  }
}
