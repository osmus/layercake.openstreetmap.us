import type { Position } from "geojson";
import { FORMATS, type FormatId } from "../export/formats.ts";
import { type Bounds, type CompleteFilter, FID, RESERVED_COLUMNS, type Sort } from "../types.ts";
import { filterTerms, ident, text } from "./filters.ts";

/** Cache table columns that should not be included in the table view */
export const CACHE_RESERVED = [FID, "geometry"];

const GEOMETRY = {
  geojson: "ST_AsGeoJSON(geometry) AS geometry",
  wkt: "ST_AsText(geometry) AS geometry_wkt",
  native: "geometry",
};

export type Source = { url: string; bounds: Bounds; polygon?: Position[][] };

const coord = (n: number) => String(Number(n.toFixed(6))); // ~10cm at the equator

function polygonWKT(coordinates: Position[][]) {
  const ring = (coordinates[0] ?? []).map(([x, y]) => `${coord(x ?? 0)} ${coord(y ?? 0)}`);
  return `POLYGON((${ring.join(", ")}))`;
}

function extentTerms({ bounds, polygon }: Source) {
  const { xmin, ymin, xmax, ymax } = bounds;

  const spatial = polygon
    ? `ST_Intersects(geometry, ST_GeomFromText('${polygonWKT(polygon)}'))`
    : `ST_Intersects(geometry, ST_MakeEnvelope(${coord(xmin)}, ${coord(ymin)}, ${coord(xmax)}, ${coord(ymax)}))`;

  // FIXME: this does not work for viewports crossing the antimeridian. we need
  // to detect when xmax > 180 or xmin < -180 and OR two bbox checks together
  return [
    `bbox.xmax >= ${coord(xmin)}`,
    `bbox.xmin <= ${coord(xmax)}`,
    `bbox.ymax >= ${coord(ymin)}`,
    `bbox.ymin <= ${coord(ymax)}`,
    spatial,
  ];
}

const projection = (columns: string[] | null, reserved: string[]) =>
  columns === null ? [`* EXCLUDE (${reserved.join(", ")})`] : columns.map(ident);

function orderTerms(sorts: Sort[], { qualify = "", tiebreak = "" } = {}) {
  const name = (column: string) => (qualify ? `${qualify}.${ident(column)}` : ident(column));
  const terms = sorts.map((s) => `${name(s.column)} ${s.direction.toUpperCase()} NULLS LAST`);
  return tiebreak ? [...terms, tiebreak] : terms;
}

function sql(parts: { select: string[]; from: string; where?: string[]; orderBy?: string[] }) {
  const { select, from, where = [], orderBy = [] } = parts;
  return [
    `SELECT\n  ${select.join(",\n  ")}`,
    `\nFROM ${from}`,
    where.length === 0 ? "" : `\nWHERE ${where.join("\n  AND ")}`,
    orderBy.length === 0 ? "" : `\nORDER BY ${orderBy.join(", ")}`,
  ].join("");
}

export function selectSQL(
  q: Source & { filters: CompleteFilter[]; sorts: Sort[]; columns: string[] | null },
): string {
  return `${sql({
    select: [...projection(q.columns, RESERVED_COLUMNS), GEOMETRY.geojson],
    from: text(q.url),
    where: [...extentTerms(q), ...filterTerms(q.filters)],
    orderBy: orderTerms(q.sorts),
  })};`;
}

/** Build a query to load everything in the current extent into the cache table */
export function materializeSQL(table: string, src: Source): string {
  const body = sql({
    select: [
      `CAST(row_number() OVER () AS INTEGER) AS ${FID}`,
      ...projection(null, RESERVED_COLUMNS),
      GEOMETRY.native,
    ],
    from: text(src.url),
    where: extentTerms(src),
  });
  return `CREATE OR REPLACE TABLE ${table} AS\n${body};`;
}

/** Build a query which filters and sorts the cache table and returns GeoJSON (for MapLibre) */
export function rowsSQL(table: string, filters: CompleteFilter[], sorts: Sort[]): string {
  return `${sql({
    select: ["* EXCLUDE (geometry)", GEOMETRY.geojson],
    from: table,
    where: filterTerms(filters),
    orderBy: orderTerms(sorts, { tiebreak: FID }),
  })};`;
}

// types GDAL cannot serialize into GeoJSON/Shapefile/CSV
const needsCast = (type: string) =>
  /\[\]/.test(type) || /^(MAP|STRUCT|UNION|BIGINT|HUGEINT|UBIGINT|UHUGEINT)/i.test(type);

function exportProjection(columns: string[] | null, sqlTypes: Map<string, string>, cast: boolean) {
  if (!cast) return projection(columns, CACHE_RESERVED);

  // Casting needs each column named, which forces enumeration.
  const names = columns ?? [...sqlTypes.keys()].filter((c) => !CACHE_RESERVED.includes(c));
  return names.map((name) =>
    needsCast(sqlTypes.get(name) ?? "")
      ? `CAST(${ident(name)} AS VARCHAR) AS ${ident(name)}`
      : ident(name),
  );
}

/** Builds a query which exports data from the cache table to DuckBD's virtual fs */
export function exportSQL(
  table: string,
  q: { filters: CompleteFilter[]; sorts: Sort[]; columns: string[] | null },
  format: FormatId,
  path: string,
  sqlTypes: Map<string, string>,
): string {
  const spec = FORMATS[format];
  // USE_TMP_FILE false: DuckDB's atomic-COPY rename moves no bytes in wasm, and
  // registering the output path (which the GDAL drivers require) is what
  // triggers it. See NOTES.md.
  const copyOptions = spec.gdal ? `${spec.copyOptions}, USE_TMP_FILE false` : spec.copyOptions;

  const body = sql({
    select: [...exportProjection(q.columns, sqlTypes, spec.castComplex), GEOMETRY[spec.geometry]],
    from: table,
    where: filterTerms(q.filters),
    // Qualified because casting enumerates the columns: an unqualified name
    // binds to the cast VARCHAR alias and sorts lexicographically.
    orderBy: orderTerms(q.sorts, { qualify: table, tiebreak: FID }),
  })
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

  return `COPY (\n${body}\n) TO ${text(path)} WITH (${copyOptions});`;
}
