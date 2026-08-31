import type { Context } from "@b9g/crank";
import type { Store } from "../store.ts";
import { DataTable } from "./DataTable.tsx";
import { FilterBar } from "./FilterBar.tsx";
import { MapPane } from "./MapPane.tsx";
import { LoadingState, Spinner } from "./Spinner.tsx";
import { Toolbar } from "./Toolbar.tsx";

/** Progress indicator that appears over the map when fetching, rendering, etc */
function MapStatus({ store }: { store: Store }) {
  if (store.busy) {
    return (
      <div class="map-status" role="status">
        <Spinner />
        <span>{store.busy}...</span>
        <span class="map-status-elapsed">
          {store.busySeconds > 2 ? `${store.busySeconds}s` : ""}
        </span>
      </div>
    );
  }

  const session = store.session;
  if (!session || session.drawTool !== null || !store.extentTooLarge) return null;

  return (
    <div class="map-status hint" role="status">
      {store.tooLargeReason}
    </div>
  );
}

function TableBody({ store }: { store: Store }) {
  const session = store.session;

  if (!session) {
    // no dataset chosen (should only be reachable if someone directly edits the URL)
    if (store.catalogError) {
      return <p class="empty-state">Could not load the datasets: {store.catalogError.message}</p>;
    }
    if (!store.catalog) return <LoadingState>Loading datasets</LoadingState>;
    return (
      <p class="empty-state">
        Choose a dataset from the menu above, or <a href="/layers/">browse all layers</a>.
      </p>
    );
  }

  if (session.features.length === 0) {
    if (store.busy) return <LoadingState>Loading features</LoadingState>;
    if (store.engineFailed) return <p class="empty-state">{store.notReadyReason}</p>;
    if (store.notReadyReason) return <LoadingState>{store.notReadyReason}</LoadingState>;
    return <p class="empty-state">No features loaded. Pan or draw an area, then fetch.</p>;
  }

  return (
    <DataTable
      features={session.features}
      columns={session.visibleColumns}
      sorts={session.sorts}
      selected={session.selected}
      hovered={session.hovered}
      scrollRequest={session.scrollRequest}
      onSort={(column) => store.toggleSort(column)}
      onRowClick={(fid) => store.selectFromTable(fid)}
      onKeyboardSelect={(fid) => store.selectFromTable(fid, { scroll: true })}
      onRowHover={(fid) => store.hover(fid)}
    />
  );
}

interface ViewerProps {
  store: Store;
}

export function* Viewer(this: Context<ViewerProps>, props: ViewerProps) {
  let collapsed = false;
  const { store } = props;

  const onKeydown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") store.deselect();
  };
  document.addEventListener("keydown", onKeydown);
  this.cleanup(() => document.removeEventListener("keydown", onKeydown));

  const toggleCollapse = () => {
    collapsed = !collapsed;
    this.refresh();
    this.after(() => store.map?.resize());
  };

  for (props of this) {
    yield (
      <div class="viewer">
        <div class="map-container">
          <MapPane
            onReady={(view) => store.setMap(view)}
            onFeatureClick={(fid) => store.selectFromMap(fid)}
            onFeatureHover={(fid) => store.hover(fid)}
            onAreaDrawn={(area) => store.onAreaDrawn(area)}
            onExtentChange={() => store.onExtentChange()}
          />
          <MapStatus store={store} />
        </div>

        <div class={collapsed ? "table-panel collapsed" : "table-panel"}>
          <Toolbar store={store} collapsed={collapsed} onToggleCollapse={toggleCollapse} />

          {store.error || store.notice ? (
            <div class={store.error ? "notice notice-error" : "notice notice-success"}>
              <span>{store.error ?? store.notice}</span>
              <button type="button" onclick={() => store.dismiss()}>
                Dismiss
              </button>
            </div>
          ) : null}

          {collapsed ? null : (
            <>
              <FilterBar store={store} />
              <div class="table-content">
                <TableBody store={store} />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
}
