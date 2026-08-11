const oneDecimal = (n: number) => n.toFixed(1).replace(/\.0$/, "");

export function formatRows(n: number): string {
  if (n >= 1e9) return `${oneDecimal(n / 1e9)}B`;
  if (n >= 1e6) return `${oneDecimal(n / 1e6)}M`;
  if (n >= 1e3) return `${oneDecimal(n / 1e3)}K`;
  return String(n);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(0)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

/** Stringify a DuckDB value for a table cell. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
