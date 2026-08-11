import type { Context } from "@b9g/crank";
import { type Feature, type Fid, featureFid, type Sort } from "../types.ts";
import { formatCell } from "../ui/format.ts";

// Fixed so scroll offset and row index convert exactly. Must match
// `--row-height` in styles.css.
const ROW_HEIGHT = 28;
const OVERSCAN = 8;

// Text width estimates, used to calculate column widths (the table's columns
// are fixed width because the table's contents are virtualized, so we can't
// use the normal auto-sizing layout behavior)
const CELL_CHAR_PX = 6.6;
const HEAD_CHAR_PX = 8.5;
const CELL_PADDING_PX = 16;
// Reserved in every header, sorted or not, so sorting a column doesn't resize
// it and shift everything after it sideways.
const SORT_MARKER_PX = 18;
const MIN_COLUMN_PX = 56;
const MAX_COLUMN_PX = 320;
const WIDTH_SAMPLE = 250;

function columnWidths(features: Feature[], columns: string[]): number[] {
  const sample = features.slice(0, WIDTH_SAMPLE);

  return columns.map((column) => {
    let longest = 0;
    for (const feature of sample) {
      const length = formatCell(feature.properties[column]).length;
      if (length > longest) longest = length;
    }
    const width =
      Math.max(column.length * HEAD_CHAR_PX + SORT_MARKER_PX, longest * CELL_CHAR_PX) +
      CELL_PADDING_PX;
    // Rounding down would leave the widest sampled value a fraction of a pixel
    // short and flag it as truncated when it isn't.
    return Math.ceil(Math.min(Math.max(width, MIN_COLUMN_PX), MAX_COLUMN_PX));
  });
}

const ARROW = { asc: "▲", desc: "▼" };

interface HeaderCellProps {
  column: string;
  width: number;
  sorts: Sort[];
  onSort(column: string): void;
}

/**
 * A column header, and the control for sorting by it.
 */
function HeaderCell({ column, width, sorts, onSort }: HeaderCellProps) {
  const rank = sorts.findIndex((s) => s.column === column);
  const sort = rank < 0 ? null : sorts[rank];

  const hint = !sort
    ? `Sort by ${column}`
    : sort.direction === "asc"
      ? `Sort by ${column} descending`
      : `Stop sorting by ${column}`;

  return (
    <th style={{ width: `${width}px` }} title={hint} onclick={() => onSort(column)}>
      <div class="th-inner">
        <span class="th-text">{column}</span>
        {sort ? (
          <span class="sort-marker">
            {ARROW[sort.direction]}
            {sorts.length > 1 ? rank + 1 : ""}
          </span>
        ) : null}
      </div>
    </th>
  );
}

interface DataTableProps {
  features: Feature[];
  columns: string[];
  sorts: Sort[];
  selected: Fid | null;
  hovered: Fid | null;
  scrollRequest: number;
  onSort(column: string): void;
  onRowClick(fid: Fid): void;
  onKeyboardSelect(fid: Fid): void;
  onRowHover(fid: Fid | null): void;
}

/**
 * The table of query results. The contents are virtualized (only the rows
 * near the visible area exist, to reduce the burden on the DOM).
 */
export function* DataTable(this: Context<DataTableProps, HTMLElement>, props: DataTableProps) {
  let scroller: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;
  let scrollTop = 0;
  let viewportHeight = 400;
  let lastScrollRequest = props.scrollRequest;
  let lastFeatures: Feature[] | null = null;
  let lastColumnKey: string | null = null;
  let widths: number[] = [];
  let totalWidth = 0;

  const resetScroll = () => {
    scrollTop = 0;
    if (scroller) scroller.scrollTop = 0;
  };

  const onscroll = () => {
    if (!scroller || scroller.scrollTop === scrollTop) return;
    scrollTop = scroller.scrollTop;
    this.refresh();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const { features, selected, onKeyboardSelect } = props;
    if (features.length === 0) return;
    ev.preventDefault();

    const current = features.findIndex((f) => featureFid(f) === selected);
    const next =
      ev.key === "ArrowDown"
        ? current < 0
          ? 0
          : Math.min(current + 1, features.length - 1)
        : current < 0
          ? features.length - 1
          : Math.max(current - 1, 0);

    const feature = features[next];
    if (next !== current && feature) onKeyboardSelect(featureFid(feature));
  };

  const scrollToRow = (index: number) => {
    if (!scroller) return;
    const max = Math.max(0, props.features.length * ROW_HEIGHT - viewportHeight);
    const centred = index * ROW_HEIGHT - (viewportHeight - ROW_HEIGHT) / 2;
    scroller.scrollTop = Math.min(Math.max(centred, 0), max);
  };

  this.after((node) => {
    scroller = node;
    // fires immediately and sets viewportHeight to the actual height
    observer = new ResizeObserver(() => {
      if (!scroller || scroller.clientHeight === viewportHeight) return;
      viewportHeight = scroller.clientHeight;
      this.refresh();
    });
    observer.observe(scroller);
  });

  this.cleanup(() => observer?.disconnect());

  for (props of this) {
    const { features, columns, selected, hovered, onRowClick, onRowHover } = props;

    // `columns` is rebuilt on every render, so compare by value; `features` is
    // stable between fetches and can be compared by identity.
    const columnKey = JSON.stringify(columns);
    if (features !== lastFeatures || columnKey !== lastColumnKey) {
      if (features !== lastFeatures) resetScroll();
      lastFeatures = features;
      lastColumnKey = columnKey;
      widths = columnWidths(features, columns);
      totalWidth = widths.reduce((sum, w) => sum + w, 0);
    }

    if (props.scrollRequest !== lastScrollRequest) {
      lastScrollRequest = props.scrollRequest;
      const index = features.findIndex((f) => featureFid(f) === selected);
      if (index >= 0) this.after(() => scrollToRow(index));
    }

    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(features.length, start + visible);

    // we only want to add tooltips when text overflows the table cell, and
    // we only know the cell width after the table is laid out, hence why
    // the title is set imperatively rather than as a prop.
    this.after((node) => {
      for (const span of node.querySelectorAll(".cell-text")) {
        const td = span.parentElement;
        if (!td) continue;
        if (span.scrollWidth > span.clientWidth) td.title = span.textContent ?? "";
        else td.removeAttribute("title");
      }
    });

    yield (
      <div class="table-scroll" onscroll={onscroll}>
        {features.length === 0 ? null : (
          <table
            class="feature-table"
            aria-label="Features"
            tabindex="0"
            onkeydown={onKeyDown}
            style={{ width: `${totalWidth}px` }}
          >
            <thead>
              <tr>
                {columns.map((column, i) => (
                  <HeaderCell
                    key={column}
                    column={column}
                    width={widths[i] ?? MIN_COLUMN_PX}
                    sorts={props.sorts}
                    onSort={props.onSort}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {start > 0 ? <tr style={{ height: `${start * ROW_HEIGHT}px` }} /> : null}

              {features.slice(start, end).map((feature) => {
                const fid = featureFid(feature);
                const classes =
                  [fid === selected ? "selected" : "", fid === hovered ? "hovered" : ""]
                    .filter(Boolean)
                    .join(" ") || undefined;
                return (
                  <tr
                    key={fid}
                    class={classes}
                    onclick={(ev: MouseEvent) => {
                      onRowClick(fid);
                      (ev.currentTarget as HTMLElement).closest("table")?.focus();
                    }}
                    onmouseenter={() => onRowHover(fid)}
                    onmouseleave={() => onRowHover(null)}
                  >
                    {columns.map((c) => (
                      <td>
                        <span class="cell-text">{formatCell(feature.properties[c])}</span>
                      </td>
                    ))}
                  </tr>
                );
              })}

              {end < features.length ? (
                <tr style={{ height: `${(features.length - end) * ROW_HEIGHT}px` }} />
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    );
  }
}
