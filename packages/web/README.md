# Places web

React + Vite map interface using TanStack Query and the shared oRPC contract.
MapLibre renders CARTO Voyager and Dark Matter basemaps through
`react-map-gl/maplibre`; map integration lives in `src/Map.tsx`.

From the repository root:

```sh
pnpm install
pnpm web
```

Open http://127.0.0.1:5187 or https://5187.prk.network within the tailnet.
Vite proxies `/rpc` to `http://127.0.0.1:5188`. The API must support the `rect`
location function. Select another API with:

```sh
PLACES_API_URL=https://places.prk.network pnpm web
```

Pan or zoom to load saved places within the map bounds. Enter a filter expression
such as `name[coffee]`, `tag[type.cafe]`, or `open[@now, for:2h]` in
the search box. The expression is grouped and combined with map bounds; the tag
picker adds an exact tag filter. Select a pin or
list entry to see its saved address and note, or open it in Google Maps. Escape
closes details, `/` focuses search, and `[` toggles the docked sidebar. These
shortcuts leave text entry intact. On narrow screens the list sits above the map.
Base UI provides the buttons, search input, and tag picker. Details are read-only.

Filter syntax and the implemented versus planned capabilities are documented in
the [search grammar](../../design/search-grammar.md#implementation-status).

Place icons use emoji from the tag associations returned by `places.list`.
An icon-bearing `type.*` tag takes precedence, followed by other icon-bearing tags
in name order. Places without a tag emoji use a generic pin.

TanStack Query caches each viewport/filter combination and keeps previous results
visible while fetching. Requests update on map movement ending and window resize;
text search is debounced. The client normalizes wrapped longitudes and full-world
views before constructing `location[rect(...)]` queries.

```sh
pnpm --filter @places/web build
pnpm --filter @places/web preview
```

The build writes static assets to `packages/web/dist`. A production host should
serve these assets and route `/rpc` to the Places API on the same origin. The
current server container serves the API; the web build can be previewed with Vite.

## Map rendering

Voyager provides a colorful street map; the style toggle selects Dark Matter.
The basemaps require network access. MapLibre's worker is bundled by Vite.
Viewport queries update on map load, resize, and movement ending. Pins and labels render in native symbol layers. Small black labels with white
halos sit below pins and appear when space permits; collision detection reserves
space for every pin before placing labels. Canvas sprites preserve color emoji.
The results list provides keyboard access to the same places, and the map ref
supplies camera controls.
