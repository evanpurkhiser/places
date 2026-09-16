# Place metadata

Planning proposal: PostgreSQL is selected; field layout and provider retention
remain to be decided before implementing tables or migrations.

## Data ownership

Keep durable application data in `places`, `tags`, `place_tags`, `sources`, and
`place_sources`. This includes internal identity, the Google Place ID, user notes,
manual tags, and independently captured discovery context.

Model provider metadata separately, with an explicit provenance and retention
policy. A proposed one-to-one `place_google_details` projection would let us refresh
or expire permitted provider fields without changing personal annotations. Its
existence and persisted fields depend on the permitted storage model below.

## Initial metadata fields

The initial place metadata consists of:

| Field               | Proposed PostgreSQL type | Purpose                          |
| ------------------- | ------------------------ | -------------------------------- |
| `name`              | `text`                   | Display name                     |
| `formatted_address` | `text`                   | Human-readable address           |
| `google_maps_url`   | `text`, nullable         | Google Maps link, when available |
| `coordinates`       | `geography(Point, 4326)` | Geographic position              |

Place identity, user notes, tags, and source associations remain part of the
application model. Provider retention and physical table layout remain open.

Use `displayName.text`, `formattedAddress`, `location`, and `googleMapsUri` from
Places API for name, address, coordinates, and the Google Maps URL respectively.
See [Google Maps URL guidance](https://developers.google.com/maps/architecture/maps-url).

## Coordinate storage

Use PostGIS geography with SRID 4326 (WGS 84) and a GiST index on `coordinates`.
Construct points in longitude, latitude order. Expose named latitude/longitude
values at the API boundary; derive them from the point rather than maintaining
separate independently editable copies.

This supports radius queries in meters using `ST_DWithin`, and geographic
distance calculations. Walking time will require routing data in addition to
coordinates. See [PostGIS radius queries](https://postgis.net/documentation/tips/st-dwithin/).

## Later metadata candidates

Primary/all place types, business status, time zone, and structured geographic
components are candidates for later filtering. Keep provider categories distinct
from manual tags. Define a country-aware address-component mapping before using
it for city or neighborhood filters.

## Hours and optional enrichment

For time-based filtering, consider regular hours plus date-specific current hours.
Google's current hours cover the next seven days including exceptional hours;
regular hours describe a typical week. Use the IANA time zone for date calculations.
See the [hours reference](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#OpeningHours).

Compute open status for the requested instant. Treat unavailable hours as unknown.
When interval queries are implemented, handle overnight periods, 24-hour operation,
and dated exceptions. Derived intervals inherit the provider data's retention policy.

Potential later fields include website, international phone number, price level,
and rating together with rating count. For intent filters, consider breakfast,
brunch, outdoor seating, vegetarian food, and accessibility. Preserve unknown
values rather than treating omitted booleans as false.

Defer reviews, photos, and editorial/AI summaries until there is a specific UI need.

## Fetch scope and freshness

Use explicit field masks for separate basic-details and enrichment requests.
The API bills according to requested fields: names and business status require
Place Details Pro; hours, website, ratings, and price require Enterprise; several
amenity fields require Enterprise + Atmosphere.
See [field tiers](https://developers.google.com/maps/documentation/places/web-service/data-fields).

Track requested fields, fetch time, language, and any permitted expiration per
field group. A basic refresh must not imply that hours were refreshed. Keep failure
information separate from the last successful fetch. A retained response, if
permitted, contains only requested fields and needs the same expiry handling as
its queryable projection.

## Storage and map constraints

Google's published policies allow indefinite Place ID storage but restrict caching
other Places content. The service-specific terms permit latitude/longitude caching
for up to 30 days; this is not a general allowance for every response field.

The current API terms also prohibit using Places content with a non-Google map.
The map prototype uses sample data with MapLibre. Resolve the provider, storage,
and map combination before implementing Google-backed persistence. An expiry
column alone does not grant permission to retain a field.

Sources:

- [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Service-specific terms, section 14](https://cloud.google.com/maps-platform/terms/maps-service-terms)

## Decisions to resolve

- Permitted retention for each desired provider field and derived value.
- On-demand retrieval versus persisted projections or another metadata provider.
- Initial field mask and enrichment budget.
- Address-component mapping and nullable-field behavior.
- Refresh scheduling and handling moved/closed places while preserving associations.
