import type { ColumnKind, CompleteFilter, Filter, OperatorId } from "../types.ts";

export const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const quote = (s: string) => s.replace(/'/g, "''");
export const text = (s: string) => `'${quote(s)}'`;
const num = (s: string) => String(Number(s));

function leaf(kind: ColumnKind): ColumnKind {
  if (kind.kind === "list") return leaf(kind.element);
  if (kind.kind === "map") return leaf(kind.value);
  return kind;
}

const lit = (value: string, kind: ColumnKind) =>
  leaf(kind).kind === "number" ? num(value) : text(value);

function like(expr: string, value: string, { anchored = false } = {}) {
  // escape literal % characters the user typed first
  const escaped = quote(value.replace(/[\\%_]/g, (c) => `\\${c}`));
  return `${expr} ILIKE '${anchored ? "" : "%"}${escaped}%' ESCAPE '\\'`;
}

/** The values a list or map column holds at the point the filter is asking about. */
function elements({ column, key, kind }: Filter) {
  if (kind.kind === "list") return ident(column);
  const extract = `map_extract(${ident(column)}, ${text(key)})`;
  return kind.kind === "map" && kind.value.kind === "list" ? `flatten(${extract})` : extract;
}

// list_filter over a NULL list yields NULL rather than an empty list, so this
// is NULL for a missing value and the row drops out, as with a bare comparison.
const anyMatch = (list: string, predicate: string) =>
  `len(list_filter(${list}, lambda x: ${predicate})) > 0`;

type Term = (expr: string, filter: Filter) => string;

interface Operator {
  needsValue: boolean;
  term(filter: Filter): string;
}

/**
 * An operator testing the column's value against what the user typed. Scalar
 * columns are tested directly; list and map columns hold several values and
 * match when any one passes, either via `list` or by testing each element.
 */
function valueOp(scalar: Term, list?: Term): Operator {
  return {
    needsValue: true,
    term(filter) {
      if (filter.kind.kind !== "list" && filter.kind.kind !== "map") {
        return scalar(ident(filter.column), filter);
      }
      const values = elements(filter);
      return list ? list(values, filter) : anyMatch(values, scalar("x", filter));
    },
  };
}

const compare = (symbol: string) =>
  valueOp((expr, { value, kind }) =>
    leaf(kind).kind === "number"
      ? `${expr} ${symbol} ${num(value)}`
      : `TRY_CAST(${expr} AS DOUBLE) ${symbol} ${num(value)}`,
  );

const nullOp = (negated: boolean): Operator => ({
  needsValue: false,
  term({ column, key, kind }) {
    if (kind.kind !== "map") return `${ident(column)} IS ${negated ? "NOT NULL" : "NULL"}`;
    const present = `map_contains(${ident(column)}, ${text(key)})`;
    return negated ? present : `${present} IS NOT TRUE`;
  },
});

const OPERATORS: Record<OperatorId, Operator> = {
  "=": valueOp(
    (expr, { value, kind }) => `${expr} = ${lit(value, kind)}`,
    (values, { value, kind }) => `list_contains(${values}, ${lit(value, kind)})`,
  ),
  "!=": valueOp((expr, { value, kind }) => `${expr} != ${lit(value, kind)}`),
  "contains": valueOp((expr, { value }) => like(expr, value)),
  "starts with": valueOp((expr, { value }) => like(expr, value, { anchored: true })),
  ">": compare(">"),
  ">=": compare(">="),
  "<": compare("<"),
  "<=": compare("<="),
  "is null": nullOp(false),
  "is not null": nullOp(true),
};

/**
 * Which operators each kind of column offers, in display order, the first
 * being the default. A list's elements and a map's value at a key are usually
 * text, so those columns offer what a text column does: the kind changes what
 * the operator compiles to, not what the user can ask.
 */
const TEXT_OPERATORS: [OperatorId, ...OperatorId[]] = [
  "=",
  "!=",
  "contains",
  "starts with",
  ">",
  ">=",
  "<",
  "<=",
  "is null",
  "is not null",
];

const OPERATORS_BY_KIND: Record<ColumnKind["kind"], [OperatorId, ...OperatorId[]]> = {
  text: TEXT_OPERATORS,
  list: TEXT_OPERATORS,
  map: TEXT_OPERATORS,
  number: ["=", "!=", ">", ">=", "<", "<=", "is null", "is not null"],
  other: ["is null", "is not null"],
};

export type OperatorOption = { id: OperatorId; needsValue: boolean };

export function operatorsFor(kind: ColumnKind): OperatorOption[] {
  return OPERATORS_BY_KIND[kind.kind].map((id) => ({ id, needsValue: OPERATORS[id].needsValue }));
}

export function defaultOperator(kind: ColumnKind): OperatorId {
  return OPERATORS_BY_KIND[kind.kind][0];
}

export function needsKey(kind: ColumnKind) {
  return kind.kind === "map";
}

const ORDERED_OPERATORS: OperatorId[] = [">", ">=", "<", "<="];

export function filterComplete(filter: Filter): filter is CompleteFilter {
  const { operator, key, value, kind } = filter;
  if (needsKey(kind) && key.trim() === "") return false;
  if (OPERATORS[operator].needsValue && value.trim() === "") return false;
  // Ordered comparisons cast the column to DOUBLE, and `=` on a number column
  // compares numerically; a value that does not parse would make DuckDB fail
  // at query time, so treat the filter as incomplete rather than erroring.
  const numeric =
    ORDERED_OPERATORS.includes(operator) ||
    (leaf(kind).kind === "number" && OPERATORS[operator].needsValue);
  return !numeric || Number.isFinite(Number(value));
}

export function filterTerms(filters: CompleteFilter[]): string[] {
  return filters.map((filter) => OPERATORS[filter.operator].term(filter));
}
