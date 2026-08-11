import { describe, expect, it } from "vitest";
import { columnKind, type SchemaField } from "./catalog.ts";

const list = (element: SchemaField): SchemaField => ({
  name: "names",
  annotation: "list",
  fields: [{ name: "list", annotation: "group", fields: [element] }],
});

const map = (value: SchemaField): SchemaField => ({
  name: "tags",
  annotation: "map",
  fields: [
    {
      name: "key_value",
      annotation: "group",
      fields: [{ name: "key", type: "binary", annotation: "string" }, value],
    },
  ],
});

const text: SchemaField = { name: "element", type: "binary", annotation: "string" };

describe("columnKind", () => {
  it("reads scalars from the annotation, falling back to the physical type", () => {
    expect(columnKind(text)).toEqual({ kind: "text" });
    expect(
      columnKind({ name: "id", type: "int64", annotation: "int(bitwidth=64, issigned=true)" }),
    ).toEqual({ kind: "number" });
    expect(columnKind({ name: "h", type: "double" })).toEqual({ kind: "number" });
    expect(columnKind({ name: "when", type: "int64", annotation: "timestamp" })).toEqual({
      kind: "other",
    });
  });

  it("descends into lists and maps", () => {
    expect(columnKind(list(text))).toEqual({ kind: "list", element: { kind: "text" } });
    expect(columnKind(map(text))).toEqual({ kind: "map", value: { kind: "text" } });
  });

  it("handles a map of lists", () => {
    expect(columnKind(map(list(text)))).toEqual({
      kind: "map",
      value: { kind: "list", element: { kind: "text" } },
    });
  });

  it("cannot filter on a plain group", () => {
    const bbox: SchemaField = {
      name: "bbox",
      annotation: "group",
      fields: [{ name: "xmin", type: "float" }],
    };
    expect(columnKind(bbox)).toEqual({ kind: "other" });
  });

  it("cannot filter on the payload of a list nested unexpectedly", () => {
    expect(columnKind({ name: "names", annotation: "list", fields: [] })).toEqual({
      kind: "list",
      element: { kind: "other" },
    });
  });
});
