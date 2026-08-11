import { zipSync } from "fflate";
import { FORMATS, type FormatId } from "./formats.ts";

/** The files an export produced, keyed by their path in DuckDB's filesystem. */
export interface ExportResult {
  filename: string;
  path: string;
  files: Map<string, Uint8Array>;
}

/**
 * Bundle an export into the single blob the browser saves. Multi-file formats
 * are zipped, with each member renamed after the download.
 */
export function packageExport(result: ExportResult, format: FormatId): Blob {
  const spec = FORMATS[format];
  const { archive } = spec;

  if (!archive) {
    const bytes = result.files.get(result.path);
    if (!bytes) throw new Error("the export produced no output");
    return new Blob([bytes as BlobPart], { type: spec.mimeType });
  }

  const base = result.filename.replace(/\.[^.]+$/, "");
  const entries: Record<string, Uint8Array> = {};
  for (const [path, bytes] of result.files) {
    entries[base + path.slice(path.lastIndexOf("."))] = bytes;
  }
  return new Blob([zipSync(entries) as BlobPart], { type: archive.mimeType });
}

export function download(result: ExportResult, format: FormatId): void {
  const url = URL.createObjectURL(packageExport(result, format));
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  a.click();
  // Revoking synchronously cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
