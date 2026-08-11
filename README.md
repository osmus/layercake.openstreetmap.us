# layercake.openstreetmap.us

This is the source code for [layercake.openstreetmap.us](https://layercake.openstreetmap.us/), the documentation website and interactive data exploration and download tool for [Layercake](https://github.com/osmus/layercake).

It consists of two parts:
- a static Jekyll site (for the docs)
- a single-page JS app which uses MapLibre and DuckDB-WASM (for the explore app)

To build, run `make`. The site is deployed on GitHub Pages.
