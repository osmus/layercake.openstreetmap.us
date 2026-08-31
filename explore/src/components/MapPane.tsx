import { type Context, Copy } from "@b9g/crank";
import { MapView, type MapViewEvents } from "../map/MapView.ts";

interface MapPaneProps extends MapViewEvents {
  onReady(view: MapView): void;
}

export function* MapPane(this: Context<MapPaneProps, HTMLElement>, props: MapPaneProps) {
  let view: MapView | null = null;

  this.after((node) => {
    MapView.create(node, {
      onFeatureClick: (fid) => props.onFeatureClick(fid),
      onFeatureHover: (fid) => props.onFeatureHover(fid),
      onAreaDrawn: (area) => props.onAreaDrawn(area),
      onExtentChange: () => props.onExtentChange(),
    }).then((created) => {
      view = created;
      props.onReady(created);
    });
  });

  this.cleanup(() => view?.remove());

  yield <div class="map" />;
  for (props of this) yield <Copy />;
}
