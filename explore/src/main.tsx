import { renderer } from "@b9g/crank/dom";
import { App } from "./components/App.tsx";

renderer.render(<App />, document.getElementById("app") as HTMLElement);
