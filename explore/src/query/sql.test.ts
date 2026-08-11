import { describe, expect, it } from "vitest";
import type { Bounds, CompleteFilter, Filter, Sort } from "../types.ts";
import { filterComplete } from "./filters.ts";
import { exportSQL, materializeSQL, rowsSQL, selectSQL } from "./sql.ts";

const BOUNDS: Bounds = { xmin: -1.5, ymin: 50.1234567, xmax: 2, ymax: 51 };
const URL = "https://example.com/buildings.parquet";

const complete = (over: Partial<Filter>): CompleteFilter => {
  const f: Filter = {
    id: 0,
    column: "name",
    kind: { kind: "text" },
    operator: "=",
    key: "",
    value: "Paris",
    ...over,
  };
  if (!filterComplete(f)) throw new Error("filter is incomplete");
  return f;
};

const SORTS: Sort[] = [
  { column: "name", direction: "asc" },
  { column: "height", direction: "desc" },
];

const SQL_TYPES = new Map([
  ["_fid", "INTEGER"],
  ["id", "BIGINT"],
  ["name", "VARCHAR"],
  ["tags", "MAP(VARCHAR, VARCHAR)"],
  ["names", "VARCHAR[]"],
  ["geometry", "GEOMETRY"],
]);

describe("selectSQL", () => {
  it("puts extent and filters in one query against the parquet file", () => {
    expect(
      selectSQL({
        url: URL,
        bounds: BOUNDS,
        filters: [complete({})],
        sorts: SORTS,
        columns: null,
      }),
    ).toMatchInlineSnapshot(`
      "SELECT
        * EXCLUDE (bbox, geometry),
        ST_AsGeoJSON(geometry) AS geometry
      FROM 'https://example.com/buildings.parquet'
      WHERE bbox.xmax >= -1.5
        AND bbox.xmin <= 2
        AND bbox.ymax >= 50.123457
        AND bbox.ymin <= 51
        AND ST_Intersects(geometry, ST_MakeEnvelope(-1.5, 50.123457, 2, 51))
        AND "name" = 'Paris'
      ORDER BY "name" ASC NULLS LAST, "height" DESC NULLS LAST;"
    `);
  });

  it("uses the drawn polygon when there is one, and projects chosen columns", () => {
    expect(
      selectSQL({
        url: URL,
        bounds: BOUNDS,
        polygon: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        filters: [],
        sorts: [],
        columns: ["id", "name"],
      }),
    ).toMatchInlineSnapshot(`
      "SELECT
        "id",
        "name",
        ST_AsGeoJSON(geometry) AS geometry
      FROM 'https://example.com/buildings.parquet'
      WHERE bbox.xmax >= -1.5
        AND bbox.xmin <= 2
        AND bbox.ymax >= 50.123457
        AND bbox.ymin <= 51
        AND ST_Intersects(geometry, ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 0))'));"
    `);
  });
});

describe("materializeSQL", () => {
  it("loads the extent and nothing else", () => {
    const sql = materializeSQL("features_0", { url: URL, bounds: BOUNDS });
    expect(sql).toMatchInlineSnapshot(`
      "CREATE OR REPLACE TABLE features_0 AS
      SELECT
        CAST(row_number() OVER () AS INTEGER) AS _fid,
        * EXCLUDE (bbox, geometry),
        geometry
      FROM 'https://example.com/buildings.parquet'
      WHERE bbox.xmax >= -1.5
        AND bbox.xmin <= 2
        AND bbox.ymax >= 50.123457
        AND bbox.ymin <= 51
        AND ST_Intersects(geometry, ST_MakeEnvelope(-1.5, 50.123457, 2, 51));"
    `);
  });
});

describe("rowsSQL", () => {
  it("filters and sorts the cache table, with _fid as the tiebreak", () => {
    expect(rowsSQL("features_0", [complete({})], SORTS)).toMatchInlineSnapshot(`
      "SELECT
        * EXCLUDE (geometry),
        ST_AsGeoJSON(geometry) AS geometry
      FROM features_0
      WHERE "name" = 'Paris'
      ORDER BY "name" ASC NULLS LAST, "height" DESC NULLS LAST, _fid;"
    `);
  });

  it("takes no projection, so hiding a column cannot force a re-query", () => {
    expect(rowsSQL("features_0", [], [])).toContain("* EXCLUDE (geometry)");
  });
});

describe("exportSQL", () => {
  it("casts what GDAL cannot serialize and qualifies the sort columns", () => {
    expect(
      exportSQL(
        "features_0",
        { filters: [], sorts: SORTS, columns: null },
        "geojson",
        "out.geojson",
        SQL_TYPES,
      ),
    ).toMatchInlineSnapshot(`
      "COPY (
        SELECT
          CAST("id" AS VARCHAR) AS "id",
          "name",
          CAST("tags" AS VARCHAR) AS "tags",
          CAST("names" AS VARCHAR) AS "names",
          geometry
        FROM features_0
        ORDER BY features_0."name" ASC NULLS LAST, features_0."height" DESC NULLS LAST, _fid
      ) TO 'out.geojson' WITH (FORMAT GDAL, DRIVER 'GeoJSON', USE_TMP_FILE false);"
    `);
  });

  it("leaves parquet uncast, so the columns stay as they are", () => {
    expect(
      exportSQL(
        "features_0",
        { filters: [], sorts: [], columns: null },
        "parquet",
        "out.parquet",
        SQL_TYPES,
      ),
    ).toMatchInlineSnapshot(`
      "COPY (
        SELECT
          * EXCLUDE (_fid, geometry),
          geometry
        FROM features_0
        ORDER BY _fid
      ) TO 'out.parquet' WITH (FORMAT PARQUET);"
    `);
  });

  it("writes CSV geometry as WKT", () => {
    const sql = exportSQL(
      "features_0",
      { filters: [], sorts: [], columns: ["name"] },
      "csv",
      "out.csv",
      SQL_TYPES,
    );
    expect(sql).toContain("ST_AsText(geometry) AS geometry_wkt");
    expect(sql).toContain("WITH (FORMAT CSV, HEADER)");
  });

  it("keeps GDAL drivers off the atomic-rename path", () => {
    const sql = exportSQL(
      "features_0",
      { filters: [], sorts: [], columns: null },
      "shapefile",
      "out.shp",
      SQL_TYPES,
    );
    expect(sql).toContain("USE_TMP_FILE false");
    expect(sql).toContain("LAYER_CREATION_OPTIONS ('ENCODING=UTF-8')");
  });
});
