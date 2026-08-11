import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { packageExport } from "./download.ts";
import { exportFilename, exportPath } from "./formats.ts";

const bytes = (n: number) => new Uint8Array(n).fill(1);

describe("export naming", () => {
  it("offers the archive's extension when there is one", () => {
    expect(exportFilename("geojson")).toBe("layercake_export.geojson");
    expect(exportFilename("shapefile")).toBe("layercake_export.zip");
  });

  it("never reuses a path, since duckdb-wasm keeps them for the life of the page", () => {
    expect(exportPath("csv")).not.toBe(exportPath("csv"));
  });
});

describe("packageExport", () => {
  it("hands single-file formats straight through", () => {
    const blob = packageExport(
      {
        filename: "layercake_export.geojson",
        path: "out_0.geojson",
        files: new Map([["out_0.geojson", bytes(4)]]),
      },
      "geojson",
    );
    expect(blob.type).toBe("application/geo+json");
    expect(blob.size).toBe(4);
  });

  it("zips a shapefile's siblings under the download name", async () => {
    const files = new Map([
      ["out_0.shp", bytes(4)],
      ["out_0.dbf", bytes(8)],
      ["out_0.prj", bytes(2)],
    ]);
    const blob = packageExport(
      { filename: "layercake_export.zip", path: "out_0.shp", files },
      "shapefile",
    );

    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "layercake_export.dbf",
      "layercake_export.prj",
      "layercake_export.shp",
    ]);
  });

  it("complains rather than saving an empty file", () => {
    expect(() =>
      packageExport({ filename: "x.geojson", path: "out_0.geojson", files: new Map() }, "geojson"),
    ).toThrow();
  });
});
