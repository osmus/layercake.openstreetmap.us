export type FormatId = "geojson" | "shapefile" | "parquet" | "csv";

export interface Format {
  label: string;
  extension: string;
  mimeType: string;
  /** How the geometry column is written: as-is, or as WKT in a text column. */
  geometry: "native" | "wkt";
  copyOptions: string;
  /** Whether the driver writes the file itself instead of handing DuckDB bytes. */
  gdal: boolean;
  /** Whether types GDAL cannot serialize have to be cast to VARCHAR first. */
  castComplex: boolean;
  /** Extensions of the companion files the driver derives from the output path. */
  siblings?: string[];
  archive?: { extension: string; mimeType: string };
}

export const FORMATS: Record<FormatId, Format> = {
  geojson: {
    label: "GeoJSON",
    extension: "geojson",
    mimeType: "application/geo+json",
    geometry: "native",
    copyOptions: "FORMAT GDAL, DRIVER 'GeoJSON'",
    gdal: true,
    castComplex: true,
  },
  shapefile: {
    label: "Shapefile (zip)",
    extension: "shp",
    mimeType: "application/octet-stream",
    geometry: "native",
    copyOptions:
      "FORMAT GDAL, DRIVER 'ESRI Shapefile', SRS 'EPSG:4326', " +
      "LAYER_CREATION_OPTIONS ('ENCODING=UTF-8')",
    gdal: true,
    castComplex: true,
    siblings: ["shx", "dbf", "prj", "cpg"],
    archive: { extension: "zip", mimeType: "application/zip" },
  },
  parquet: {
    label: "Parquet",
    extension: "parquet",
    mimeType: "application/octet-stream",
    geometry: "native",
    copyOptions: "FORMAT PARQUET",
    gdal: false,
    castComplex: false, // parquet can handle whatever since the source data is also parquet
  },
  csv: {
    label: "CSV",
    extension: "csv",
    mimeType: "text/csv",
    geometry: "wkt",
    copyOptions: "FORMAT CSV, HEADER",
    gdal: false,
    castComplex: true,
  },
};

let serial = 0;

/**
 * The path an export is written to inside DuckDB's virtual filesystem. Paths
 * are taken for the life of the page (RemoveFile is a no-op there), so every
 * export gets a fresh one.
 */
export function exportPath(format: FormatId) {
  return `layercake_export_${serial++}.${FORMATS[format].extension}`;
}

/** The name an export is offered to the browser as. */
export function exportFilename(format: FormatId) {
  const spec = FORMATS[format];
  return `layercake_export.${spec.archive?.extension ?? spec.extension}`;
}
