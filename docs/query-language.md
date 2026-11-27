# Query language

The CLI and API share a small, typed language for filtering places.
Combine predicates with `AND`, `OR`, and `NOT`.

## Filters

| Filter     | What it matches                                            |
| ---------- | ---------------------------------------------------------- |
| `tag`      | Exact tag names and `*` wildcard patterns                  |
| `source`   | Discovery source by provider type, ID, URL, or text        |
| `savedBy`  | Exact Places username of any saver                         |
| `name`     | Place name                                                 |
| `address`  | Place address                                              |
| `notes`    | Place notes                                                |
| `has`      | Presence of `tag`, `source`, `name`, `address`, or `notes` |
| `location` | Geographic area (radius, rectangle, sector)                |
| `open`     | Opening hours                                              |

## Examples

```text
tag[favorite] AND !tag[visited]
tag[laptop-friendly, notes:outlet]
(name[coffee] OR tag[type.bakery]) !has[notes]
location[radius(point(-73.985, 40.726), 1mi)]
location[sector(origin, bearing:90deg, range:2mi)]
open[@now, for:2h]
open["mon 6pm", until:"tue 2am"]
source[instagram]
```

## Tag filters

`tag` matches exact names and `*` wildcards.
`notes:` inside a tag predicate matches that assignment's note,
not the place's general note.

```text
tag[laptop-friendly, notes:outlet]
```

## Source filters

```text
source[instagram]
source[type:instagram]
source[id:"10000000-0000-4000-8000-000000000001"]
source[instagram, text:coffee]
source[url:"https://www.instagram.com/p/POST/"]
source[text:coffee] source[text:cocktails]
!has[source]
```

- **Type** matches a complete value, ignoring case.
- **IDs and URLs** match exactly, including URL case and trailing slashes.
- **`text`** searches source descriptions
  and Instagram captions using substring matching, `*` wildcards,
  or `=` for exact literal matches.
- Separate source predicates can match different attached sources.
- `source[]` and `has[source]` require any attached source;
  `!source[...]` excludes places with a matching source.

## Saved-by filters

`savedBy` matches places saved by the given Places username,
including places with multiple savers.
Usernames match exactly and are case-sensitive.

```text
savedBy[evan] tag[favorite]
savedBy[evan] OR savedBy[alice]
!savedBy[evan]
```

## Location filters

```text
location[radius(point(-73.985, 40.726), 1mi)]
location[rect(topLeft, bottomRight)]
location[sector(origin, towards:destination)]
location[sector(origin, bearing:90deg, range:2mi)]
```

- **`radius(point(longitude, latitude), distance)`** — within a distance.
  Units: `m`, `km`, `ft`, `mi`.
- **`rect(topLeft, bottomRight)`** — within a bounding rectangle.
- **`sector(origin, ...)`** — a wedge; supports `towards`, `bearing`, `range`,
  `spread`, and `buffer`.

Points also accept place names, addresses, or `gmaps:PLACE_ID`.
Names resolve through Google Places Text Search using `google.apiKey`.
`@ref` refers to the `--reference-location` value.

## Open-hours filters

```text
open[@now]
open[@now, for:2h]
open["mon 6pm", until:"tue 2am"]
open["2026-09-21T18:00:00-04:00"]
```

- **Time values:** `@now`, clock times (`6pm`, `22:00`), weekday times
  (`"MON 6pm"`), ISO timestamps.
- **`for:` / `until:`** require continuous opening.
  Duration units are `m` and `h`.
- Clock times mean "today in each place's time zone".
- `!open[@now]` selects known-closed places; missing hours stay unknown.

Hours are pairs of `[inclusive-start, exclusive-end]` minute offsets from Sunday
midnight, between 0 and 10080.
Monday 09:00–12:00 is `[[1980, 2160]]`; 24/7 is `[[0, 10080]]`;
`null` is unknown and `[]` is closed all week.

## Reference

`pnpm places docs filter` prints the server's registered filters, functions,
types, and examples.
The parser lives in `@places/common/search`; after editing `grammar.pegjs`, run:

```bash
pnpm --filter @places/common generate:search
```
