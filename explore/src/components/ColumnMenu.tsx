import type { Context } from "@b9g/crank";
import type { Store } from "../store.ts";

interface ColumnMenuProps {
  store: Store;
}

export function* ColumnMenu(this: Context<ColumnMenuProps>, { store }: ColumnMenuProps) {
  let open = false;

  const close = (ev: Event) => {
    if (!open || (ev.target as HTMLElement).closest(".column-select-wrapper")) return;
    open = false;
    this.refresh();
  };

  document.addEventListener("click", close);
  this.cleanup(() => document.removeEventListener("click", close));

  for ({ store } of this) {
    const columns = store.session?.columns ?? [];
    const selected = store.session?.selectedColumns ?? new Set<string>();
    const label =
      selected.size < columns.length ? `Columns (${selected.size}/${columns.length})` : "Columns";

    yield (
      <div class="column-select-wrapper">
        <button
          type="button"
          class="toolbar-btn"
          disabled={columns.length === 0}
          aria-expanded={String(open)}
          onclick={() => {
            open = !open;
            this.refresh();
          }}
        >
          {label}
        </button>

        {open ? (
          <div class="column-select-menu">
            <div class="column-select-actions">
              <button type="button" onclick={() => store.setAllColumns(true)}>
                All
              </button>
              <button type="button" onclick={() => store.setAllColumns(false)}>
                None
              </button>
            </div>
            <div class="column-select-list">
              {columns.map((column) => (
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(column)}
                    onchange={() => store.toggleColumn(column)}
                  />
                  {column}
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
}
