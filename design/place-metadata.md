# Place metadata

## Stored model

`places` has an internal UUID primary key and a unique Google Place ID. Provider
metadata and user annotations share that record; tags and sources use separate
many-to-many associations. Refreshes replace provider-owned values atomically
while preserving the internal ID and personal annotations.

| Column                     | PostgreSQL type            | Meaning                                                       |
| -------------------------- | -------------------------- | ------------------------------------------------------------- |
| `google_place_id`          | `text`, unique             | Provider identity, refreshed when Google returns a changed ID |
| `name`                     | `text`                     | Display name                                                  |
| `formatted_address`        | `text`                     | Display address                                               |
| `google_maps_url`          | `text`, nullable           | Provider Maps link                                            |
| `coordinates`              | `geography(Point, 4326)`   | Geographic position                                           |
| `time_zone`                | `text`, nullable           | IANA time zone                                                |
| `business_status`          | `text`, nullable           | Provider operational/closure status                           |
| `hours_weekly_open`        | `int4multirange`, nullable | Recurring local opening minutes                               |
| `last_sync`                | `timestamptz`, nullable    | Last successful full metadata refresh                         |
| `user_note`                | `text`, nullable           | User-authored place note                                      |
| `created_at`, `updated_at` | `timestamptz`              | Application timestamps                                        |

The API exposes camelCase properties. Coordinates are projected into named
`latitude` and `longitude` values from the PostGIS point. The database stores
coordinates in longitude/latitude order and indexes them with GiST.

## Fetching and freshness

Imports and sync use `getMetadata` with the field mask:

```text
id,displayName,formattedAddress,googleMapsUri,location,timeZone,businessStatus,regularOpeningHours
```

This path fetches REST JSON to preserve absent versus explicitly empty opening
periods. Basic point resolution uses the Google Places SDK for details or Text
Search and requests only identity, name, address, Maps URL, and coordinates.
Requests have ten-second timeouts. Background jobs own import/sync retries.

An import inserts a fully populated new place with `last_sync` set. Reimporting an
existing place reuses its identity and applies supplied tags/notes. Explicit sync
refreshes provider metadata and advances `last_sync` even when unchanged; unchanged
refreshes preserve `updated_at`. A successful response with missing optional fields
clears those fields. Failed refreshes preserve the saved snapshot. A concurrent
refresh can supersede an in-flight response.

A changed Google ID retains the internal UUID. A collision with another saved
place's Google ID fails the refresh atomically. Recorded closures preserve the
place and annotations. Scheduled refresh and per-field expiration are future work.

## Coordinates and geography

Radius and sector queries use geographic distances in meters. Rectangle queries
compare longitude/latitude bounds in degrees, including antimeridian wrapping.
Named origins use Google Places; text queries select the first result. Explicit
coordinates, Maps links, and Google Place IDs offer more specific point inputs.

Area resolution with `within`, named-location management, and routing are planned.
See [grammar status](search-grammar.md#implementation-status).

## Opening hours

Weekly hours use inclusive-start/exclusive-end minute ranges from Sunday 00:00
through minute 10080. Normalization merges touching/overlapping periods and splits
week-crossing intervals. SQL NULL means unknown, an empty multirange means closed
all week, and `{[0,10080)}` means 24/7. A GiST index supports containment.

`open` checks a local clock time, weekly time, or absolute instant. Intervals
require continuous opening. Missing data remains unknown under negation; recorded
temporary/permanent closure makes the predicate false. Calendar-date queries use
the saved recurring schedule and current closure status. Holiday exceptions and
secondary schedules are future work. See [hours research](hours.md) and
[time values](time-values.md).

## Future enrichment

Candidates include provider place types, structured address components, website,
phone number, price, ratings, and amenity flags. Provider categories remain
separate from manual tags. Address-component mapping needs country-aware rules.
Each extension needs a field mask, nullable-value semantics, fetch budget, and
retention policy. Reviews and photos need a concrete product use before inclusion.

## Provider policy decisions

The implementation persists the fields above and the web interface uses MapLibre.
Provider retention, permitted map use, attribution, refresh/expiration behavior,
and raw-response storage policy require an explicit review against the applicable
provider agreement. The implemented schema records behavior; it does not establish
permission to retain or display provider content.

References for that review:

- [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [Field masks and request tiers](https://developers.google.com/maps/documentation/places/web-service/place-details)
