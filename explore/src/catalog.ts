import { type ColumnKind, type Layer, RESERVED_COLUMNS } from "./types.ts";

const BASE_URL = "https://data.openstreetmap.us/layercake";

export const LAYER_IDS = [
  "addresses",
  "boundaries",
  "buildings",
  "highways",
  "parks",
  "pois",
  "settlements",
  "waterways",
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

// every layer's first two columns are type and id; it's more useful to have
// the "Add Filter" button default to the next column after that
export const FIRST_TAG_COLUMN_INDEX = 2;

const LAYER_NAMES: Partial<Record<LayerId, string>> = { pois: "POIs" };

export type SchemaField = GroupField | LeafField;

export interface GroupField {
  name: string;
  annotation: "group" | "list" | "map";
  fields: SchemaField[];
}

export interface LeafField {
  name: string;
  type: string;
  annotation?: string;
}

/** The parts of `<layer>.description.json` we care about */
interface Description {
  rows: number;
  schema: GroupField;
}

export async function loadCatalog(): Promise<Record<string, Layer>> {
  const settled = await Promise.allSettled(LAYER_IDS.map(layerMetadata));

  const failures = settled.filter((r) => r.status === "rejected");
  for (const failure of failures) console.warn("Layercake catalog:", failure.reason);

  const layers = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (layers.length === 0) throw failures[0]?.reason;

  return Object.fromEntries(layers.map((l) => [l.id, l]));
}

/** When the Layercake data was last built, or null if unavailable. */
export async function loadUpdatedAt(): Promise<Date | null> {
  try {
    const { timestamp } = await getJSON<{ timestamp: string }>(`${BASE_URL}/metadata.json`);
    const date = new Date(timestamp);
    return Number.isNaN(date.valueOf()) ? null : date;
  } catch {
    return null;
  }
}

async function layerMetadata(id: LayerId): Promise<Layer> {
  const url = `${BASE_URL}/${id}.parquet`;

  const [description, bytes] = await Promise.all([
    getJSON<Description>(`${BASE_URL}/${id}.description.json`),
    // A missing byte count is cosmetic; losing the layer over it is not.
    getContentLength(url).catch(() => null),
  ]);

  const fields = description.schema.fields.filter((f) => !RESERVED_COLUMNS.includes(f.name));
  const kinds = new Map(fields.map((f) => [f.name, columnKind(f)]));

  return {
    id,
    url,
    name: LAYER_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1), // HACK
    rows: description.rows,
    bytes,
    columns: [...kinds.keys()],
    kinds,
  };
}

/**
 * Based on the column type in the parquet schema, return the column's "kind"
 * which determines what filters can be applied to it by the user.
 */
export function columnKind(field: SchemaField | undefined): ColumnKind {
  if (!field) return { kind: "other" };
  if (!("fields" in field)) return scalarKind(field);

  switch (field.annotation) {
    case "list":
      return { kind: "list", element: columnKind(nested(field, 0)) };
    case "map":
      return { kind: "map", value: columnKind(nested(field, 1)) };
    default:
      return { kind: "other" }; // unknown, no filters will be available
  }
}

function scalarKind(field: LeafField): ColumnKind {
  if (field.annotation === "string") return { kind: "text" };
  return /^(int|float|double|decimal)/.test(field.annotation ?? field.type)
    ? { kind: "number" }
    : { kind: "other" };
}

/**
 * The schema JSON wraps the payload of a LIST or MAP in a repeated group;
 * this unpacks it to get the element type or value type.
 */
function nested(field: GroupField, index: number): SchemaField | undefined {
  const repeated = field.fields[0];
  return repeated && "fields" in repeated ? repeated.fields[index] : undefined;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json() as Promise<T>;
}

async function getContentLength(url: string): Promise<number | null> {
  const res = await fetch(url, { method: "HEAD" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const contentLength = res.headers.get("content-length");
  return contentLength ? parseInt(contentLength, 10) : null;
}
