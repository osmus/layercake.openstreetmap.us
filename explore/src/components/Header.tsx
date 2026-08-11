import type { Context } from "@b9g/crank";
import type { Store } from "../store.ts";
import { formatRows } from "../ui/format.ts";

const DATE_FORMAT: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

interface HeaderProps {
  store: Store;
}

export function* Header(this: Context<HeaderProps, HTMLElement>, props: HeaderProps) {
  let buttonNode: HTMLElement | null = null;
  let menuNode: HTMLElement | null = null;
  let wired = false;

  const positionMenu = () => {
    if (!buttonNode || !menuNode) return;
    const rect = buttonNode.getBoundingClientRect();
    menuNode.style.top = `${rect.bottom + 4}px`;
    menuNode.style.left = `${rect.left}px`;
  };

  for (props of this) {
    const { store } = props;

    this.after((node) => {
      buttonNode = node.querySelector(".header-breadcrumb");
      menuNode = node.querySelector(".layer-menu");
      if (menuNode && !wired) {
        wired = true;
        menuNode.addEventListener("toggle", (ev) => {
          if ((ev as ToggleEvent).newState === "open") positionMenu();
        });
      }
    });

    yield (
      <header class="header">
        <a class="header-home" href="/">
          Layercake
        </a>
        <span class="header-separator">/</span>
        <button type="button" class="header-breadcrumb" popovertarget="layer-menu">
          {store.session ? store.session.layer.name : "Choose a dataset"}
        </button>
        <div id="layer-menu" popover="auto" class="layer-menu">
          {store.catalog
            ? Object.values(store.catalog).map((layer) => (
                <button
                  type="button"
                  class={layer.id === store.route ? "layer-menu-item active" : "layer-menu-item"}
                  onclick={() => {
                    menuNode?.hidePopover();
                    store.navigate(layer.id);
                  }}
                >
                  <span class="layer-menu-item-name">{layer.name}</span>
                  <span class="layer-menu-item-meta">{formatRows(layer.rows)}</span>
                </button>
              ))
            : null}
        </div>
        <span class="spacer" />
        {store.updatedAt ? (
          <span class="header-meta" title={store.updatedAt.toISOString()}>
            Data updated {store.updatedAt.toLocaleDateString(undefined, DATE_FORMAT)} &middot;
          </span>
        ) : null}
        <a class="header-link" href="/docs/">
          Docs
        </a>
        &middot;
        <a class="header-link" href="https://github.com/osmus/layercake">
          GitHub
        </a>
      </header>
    );
  }
}
