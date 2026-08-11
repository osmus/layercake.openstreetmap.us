import { LAYER_IDS, type LayerId } from "./catalog.ts";

// really basic query string based routing

export function readRoute(): LayerId | null {
  const layer = new URLSearchParams(location.search).get("layer");
  return isLayerId(layer) ? layer : null;
}

const isLayerId = (value: string | null): value is LayerId =>
  value !== null && (LAYER_IDS as readonly string[]).includes(value);

export function writeRoute(layerId: string) {
  const url = new URL(location.href);
  url.searchParams.set("layer", layerId);
  if (url.href !== location.href) history.pushState(null, "", url);
}
