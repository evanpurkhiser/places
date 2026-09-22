# Sources

Sources capture where a saved place was discovered, including the original content
and context. Examples include an Instagram post and a Google Maps import.

## Source records

Store sources in a dedicated `sources` table with the following initial fields:

| Field         | Purpose                                                  |
| ------------- | -------------------------------------------------------- |
| `id`          | Source identity                                          |
| `external_id` | Provider identity, unique together with `type`; nullable |
| `url`         | Link to the original content, when available             |
| `type`        | Source kind, such as `instagram` or `google_maps_import` |
| `description` | Human-readable description of the source                 |
| `data`        | Source-specific JSON payload                             |

Illustrative Instagram source:

```json
{
  "externalId": "Dcw6FFrISub",
  "url": "https://www.instagram.com/p/Dcw6FFrISub/",
  "type": "instagram",
  "description": "A post recommending neighborhood cafes",
  "data": {
    "caption": "Some favorite places for coffee",
    "username": "examplecreator",
    "postedAt": "2026-09-01T12:00:00.000Z",
    "thumbnailUrl": "https://cdn.example/cover.jpg"
  }
}
```

The shared `source` Zod contract discriminates on `type` and validates its `data`
payload. Instagram is the supported variant: caption is a string; username, UTC
ISO post timestamp, and thumbnail URL are nullable. Its external ID is the post
shortcode. Additional provider variants define their own metadata shapes.

The database enforces uniqueness of `(type, external_id)`. Sources with null
external IDs remain distinct. Application boundaries validate the full source
with Zod; Drizzle's column types alone do not perform runtime validation.

## Relationship to places

A post can mention several places, and a place can be discovered through several
sources. Model this as a many-to-many relationship. The `place_sources` join
table links place UUIDs to source UUIDs with a composite primary key. Associations
have nullable `description` and JSON `data`, plus creation/update timestamps.

Preserve distinct sources associated with the same canonical place. A place's
detail view should be able to show "Mentioned in 3 Instagram posts" and let the
user inspect each post and its context. Reprocessing the same post should reuse
its source association; a different post about that place adds another source.

Source records preserve discovery context. Tags provide organization and filtering:
for example, `source.instagram` can group places while a source record identifies
the particular post. Imported list membership can be preserved as tags alongside
the import source.

The mechanism that writes a place, such as an API client or automation, can differ
from its discovery source. An automation might save a place discovered on Instagram.

## Future Instagram capture

Places is intended to eventually absorb the Instagram extraction workflow from
`instagram-saver`. Its README describes an API that accepts an Instagram URL,
extracts place names from Reels, and returns a list of places. The example output
includes a name, address, place type, `whatsGood`, `vibe`, emoji, Google Maps URL,
and the originating Instagram URL.

The intended flow is to capture the post as a source, resolve extracted places to
canonical place records, and associate each place with that source. When another
post mentions an existing place, retain that post as an additional source for it.

Extraction context can describe a particular place within a post: one Reel might
recommend dumplings at a restaurant, while another highlights its cocktails.
Preserve both recommendations with their originating sources. A proposed home for
place-specific extraction data is the place/source association; the source's
`data` holds post-level content. The exact fields remain to be designed.

This is a future integration direction. Extraction, place resolution, and API
behavior will be designed as part of that work.

## Open decisions

- Whether sources can exist before a place is attached.
- Fields for place-specific extraction context on source associations.
- Whether a Google Maps source represents an import batch, a list, or an entry.
- Source creation, editing, attachment, and deletion through the API and CLI.
- How attaching a source to an existing place interacts with duplicate-place handling.
- Whether source tags are manual or derived from attached source records.
- Whether to track the ingestion mechanism separately from discovery sources.
- Provider payload retention and refresh behavior.

## Source filtering

`source[...]` selects places with an attached source satisfying every argument.
The first positional argument is the provider type; `type:instagram` is equivalent
to `instagram`. All conditions apply to the same source and its association with that
place. Separate predicates can match different sources:

```text
source[instagram, text:coffee]
source[text:coffee] source[text:cocktails]
```

Supported arguments:

- `type`: exact provider type, ignoring case. Instagram is the current provider.
- `id`: exact source UUID. Unknown UUIDs match no places.
- `url`: exact stored URL, including case and trailing slash.
- `text`: source description, Instagram caption, or the description on the matching
  place/source association. Uses case-insensitive substring matching and `*`
  wildcards; `text:="date night"` matches a complete field literally.

`source[]` and `has[source]` both require any attached source. `!has[source]`
selects places without sources. `!source[text:coffee]` selects places with no
source mentioning coffee, including places without sources. Multiple matching
sources return each place once. Unattached sources do not affect place results.

IDs must be valid UUIDs. Unknown types match no places. Literal identity fields
treat `*` literally. Missing source metadata fails a positive condition. Text
matches each field independently and only searches the association belonging to
the selected place.

Source dates, counts, and external-ID filtering remain future work.
