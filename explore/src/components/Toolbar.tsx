import type { Context } from "@b9g/crank";
import { FORMATS, type FormatId } from "../export/formats.ts";
import type { Session } from "../session.ts";
import type { Store } from "../store.ts";
import type { DrawTool } from "../types.ts";
import { ColumnMenu } from "./ColumnMenu.tsx";

const DRAW_TOOLS: [DrawTool, string, string][] = [
  ["rectangle", "Bbox", "Draw a bounding box"],
  ["polygon", "Polygon", "Draw a polygon"],
];

function* CopySQLButton(this: Context<{ store: Store }>, { store }: { store: Store }) {
  let feedback: "copied" | "failed" | null = null;

  for ({ store } of this) {
    yield (
      <button
        type="button"
        class="toolbar-btn mono"
        title="Copy this query as DuckDB SQL"
        disabled={store.blockedReason !== null}
        onclick={async () => {
          try {
            await store.copySQL();
            feedback = "copied";
          } catch {
            // writing to clipboard can fail (browser settings or non-secure context)
            feedback = "failed";
          }
          this.refresh();
          setTimeout(() => {
            feedback = null;
            this.refresh();
          }, 1500);
        }}
      >
        {feedback === "copied" ? "Copied" : feedback === "failed" ? "Failed" : "Copy SQL"}
      </button>
    );
  }
}

function fetchLabel(session: Session | null) {
  const verb = session?.loaded ? "Re-fetch" : "Fetch features";
  if (!session?.area) return `${verb} in view`;
  return session.area.polygon ? `${verb} in polygon` : `${verb} in bbox`;
}

interface ToolbarProps {
  store: Store;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function* Toolbar(this: Context<ToolbarProps>, props: ToolbarProps) {
  let format: FormatId = "geojson";

  for (props of this) {
    const { store, collapsed, onToggleCollapse } = props;
    const session = store.session;
    const blocked = store.blockedReason;
    const busy = store.busy !== null;
    const features = session?.features.length ?? 0;

    yield (
      <div class="toolbar">
        <button
          type="button"
          class="toolbar-btn primary"
          disabled={blocked !== null || busy}
          title={blocked ?? ""}
          onclick={() => store.fetch()}
        >
          {fetchLabel(session)}
        </button>

        <button type="button" class="toolbar-btn" onclick={() => store.addFilter()}>
          + Filter
        </button>

        <ColumnMenu store={store} />

        <div class="draw-tools">
          {DRAW_TOOLS.map(([tool, label, title]) => (
            <button
              type="button"
              class={session?.drawTool === tool ? "toolbar-btn active" : "toolbar-btn"}
              disabled={!store.map}
              title={title}
              onclick={() => store.armDraw(tool)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            class="toolbar-btn"
            disabled={!store.map || (!session?.area && !session?.drawTool)}
            title="Clear the drawn area"
            onclick={() => store.armDraw(null)}
          >
            Clear
          </button>
        </div>

        <CopySQLButton store={store} />

        <div class="spacer" />

        {session?.loaded ? (
          <span class="row-count">
            {store.busy === "Filtering"
              ? "Filtering..."
              : `${features.toLocaleString("en-US")} rows`}
          </span>
        ) : null}

        {features > 0 ? (
          <div class="export-controls">
            <select
              value={format}
              onchange={(ev: Event) => {
                format = (ev.target as HTMLSelectElement).value as FormatId;
              }}
            >
              {Object.entries(FORMATS).map(([value, spec]) => (
                <option value={value}>{spec.label}</option>
              ))}
            </select>
            <button
              type="button"
              class="toolbar-btn"
              disabled={busy}
              onclick={() => store.exportAs(format)}
            >
              Export
            </button>
          </div>
        ) : null}

        <button
          type="button"
          class="toolbar-btn"
          title={collapsed ? "Expand table" : "Collapse table"}
          aria-expanded={String(!collapsed)}
          onclick={onToggleCollapse}
        >
          {collapsed ? "▲" : "▼"}
        </button>
      </div>
    );
  }
}
