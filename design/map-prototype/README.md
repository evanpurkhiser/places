# Elsewhere — map interaction study

A React + TypeScript + MapLibre prototype of the personal saved-places spec.

## Run

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5187 or https://5187.prk.network within the tailnet.
`npm run build` checks TypeScript and builds production assets; `npm test`
checks the combined filtering behavior.

## Try it

- Pan and zoom the map, select pins or places, and fit all matching places.
- Select multiple categories (OR), then narrow by search, tags, opening status,
  or places you want to visit. Hide food and drink through More filters.
- Edit a place’s notes, add/remove tags, and toggle visited status. Edits persist
  in localStorage on this device. Press Escape to return; `/` focuses search.
- Switch light/dark basemaps. On mobile, collapse the places sheet to explore.

## Prototype boundaries

The 16 NYC places are hand-authored fixtures. Coordinates, notes, source reasons,
visited state, and opening status are illustrative, not live business information.
Search covers these saved fixtures. The prototype does not ingest or search new
places, calculate walking times, or implement the V0 database/API pipeline.

Map rendering is isolated in `src/Map.tsx`; fixture data and filter logic live in
`src/places.ts`. Notes, tags, and visited state persist separately from fixed place
metadata. No API keys are needed. Basemaps use CARTO’s public style endpoints and
require network access; evaluate a supported tile plan before production use.

MapLibre provides customizable vector rendering:
https://maplibre.org/maplibre-gl-js/docs/

Google Places policy requires Places results displayed on a map to use a Google
map. Resolve the production map/data-provider combination and caching rules before
implementing Google-backed metadata from the spec:
https://developers.google.com/maps/documentation/places/web-service/policies
