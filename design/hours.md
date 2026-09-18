# Hours enrichment and filtering

Proposal based on 12 Google Place Details responses fetched on September 18,
2026, using IDs from the 2,614 saved places in production. Production was read
through `places.list`; this investigation made no database writes.

## Observed schedules

All times below are local to the place.

| Sample                     | Observed structure                                                |
| -------------------------- | ----------------------------------------------------------------- |
| La Cabra, Lafayette Street | Seven periods; weekdays 07:00–20:00, weekends 08:00–20:00         |
| L’Échaudé, Québec          | Twelve periods; weekday lunch 11:30–14:00 and dinner 17:00–21:30  |
| Openaire, Los Angeles      | Seventeen periods, including three separate openings on some days |
| Bar Raval, Toronto         | Daily 13:00–01:00 the following day                               |
| Veselka, Second Avenue     | Five periods, including Friday 09:00 through Sunday 23:00         |
| Remedy Diner, Manhattan    | 24/7: one Sunday 00:00 opening with no closing endpoint           |
| Superbude Wien Prater      | Same 24/7 representation                                          |
| Four Freedoms State Park   | Six periods; Tuesday absent from the complete weekly schedule     |
| Little Italy, Toronto      | Both regular and current hours absent                             |
| Yoroniku, Tokyo            | Daily 17:00–00:00 the following day                               |
| Tsuchi Cafe, Toronto       | Separate general and kitchen schedules                            |
| Bastei Beisl, Vienna       | Two Saturday periods; separate kitchen schedule                   |

All 12 responses included an IANA time zone. Eleven included regular and current
hours. Five included secondary schedules, such as kitchen, brunch, and delivery.
The initial implementation uses the recurring primary schedule.

An actual Bar Raval regular period:

```json
{
  "open": {"day": 6, "hour": 13, "minute": 0},
  "close": {"day": 0, "hour": 1, "minute": 0}
}
```

Snapshot fields such as `openNow` and `nextCloseTime` change with the clock and
must not drive schedule change detection.

## Expanded sample audit

A second pass on September 18 fetched 77 additional places: 20 targeted venues
and up to four deterministic samples per country or region from the saved
addresses. The combined sample covers 89 places across 15 countries or regions
and 16 IANA time zones. All requests succeeded; production was read-only.

| Finding                                      | Count across 89 places |
| -------------------------------------------- | ---------------------- |
| Weekly hours present                         | 74                     |
| Weekly hours absent                          | 15                     |
| Permanently closed                           | 5                      |
| Temporarily closed                           | 2                      |
| 24/7 sentinel                                | 5                      |
| Multiple periods opening on the same weekday | 7                      |
| Periods crossing midnight                    | 14                     |
| Secondary schedules                          | 8                      |
| Missing time zone                            | 0                      |

KPH Marine Radio Station opens only Saturday 12:00–16:00; Queens Night Market
opens only Saturday 16:00–Sunday 00:00. Sparse weekly schedules must retain closed
days. Mahaneh Yehudah Market closes on Saturday and shortens Friday hours.
Taipei Tianhou Temple closes at 21:45, Kopi Kadé opens at 06:45, and Crave Gourmet
Street Food has a Saturday 22:15 opening. Preserve minute precision.

All seven closed businesses omitted weekly hours. Eight other places also
omitted hours, including operational hotels, museums, and train stations.
Keep business status distinct from missing schedule data. Successful syncs must
clear previously saved hours when the requested field becomes unavailable;
failed requests preserve the previous snapshot. Store the reported closure
status separately so filtering can account for known closures.

Every 24/7 response used exactly one Sunday 00:00 opening with no closing.
Treat that recognized sentinel as all-week coverage; validate other missing-close
shapes rather than assuming they mean 24/7. All observed endpoint fields were
valid integers with day 0–6, hour 0–23, and minute 0–59. The largest schedule
remained Openaire's 17 periods. No overlapping or touching periods, explicit empty
period arrays, moved-place IDs, or missing time zones appeared in the sample;
these cases still need synthetic fixtures.

An independent scratch comparison expanded each structured weekly schedule and
its English weekday descriptions into 10,080 minute flags. All 74 schedules
matched at every minute, including overnight carryover and week wrap. Use
structured periods in the implementation; this comparison was an audit of the
sample, not a proposed dependency on localized display text.

The installed Google protobuf helper converts both an absent `periods` property
and an explicit empty array to an owned empty array. A direct `fromObject` probe
confirmed that these inputs become indistinguishable. Validate the actual SDK
response path before assigning known-closed semantics to empty decoded arrays;
use the REST representation if preserving field presence requires it.

Google returned `Asia/Saigon` for Vietnamese places. All 16 returned zones were
accepted by Node's `Intl.DateTimeFormat`; database integration tests should also
exercise the returned identifiers, including aliases.

This sample validates the observed weekly schedule shapes, not completeness or
real-world accuracy. Seasonal venues can advertise a weekly schedule that does
not capture off-season closures. Results describe the last synced schedule.

## Storage recommendation

Store the primary schedule directly on `places` using native PostgreSQL
multiranges. Each place contains its weekly schedule and last successful sync
time. Multiranges keep opening periods together while supporting indexed
containment.

Store the IANA time zone in `places.time_zone` as nullable `text`, populated from
Google's `timeZone.id`. It describes the place and supports local calendar
calculations independently of hours availability. Hours evaluation uses this
field; sync updates it atomically with any affected hours projections.

| Column              | Type                       | Meaning                                                 |
| ------------------- | -------------------------- | ------------------------------------------------------- |
| `time_zone`         | `text`, nullable           | IANA time zone for the place                            |
| `hours_weekly_open` | `int4multirange`, nullable | Open minutes in a recurring local week                  |
| `last_sync`         | `timestamptz`, nullable    | Last successful Google place refresh; null until synced |

For regular hours, minute zero is Sunday 00:00; the week ends at minute 10,080.
Split periods crossing the week boundary. Bar Raval's Saturday period becomes
`{[9420,10080),[0,60)}` before canonical sorting. A 24/7 schedule is
`{[0,10080)}`. Merge overlapping and touching periods. Enforce finite bounds
within the week and opening-before-closing for each normalized component.

SQL `NULL` means unknown. An empty multirange means known closed throughout the
applicable schedule. An unfetched place has a null `last_sync`. A
successful sync with no hours sets `last_sync` while leaving the schedule
null, distinguishing unavailable hours from unfinished backfill work. Advance
`last_sync` after a complete successful refresh even when no values changed;
failed refreshes preserve it. Preserve absent-versus-empty API fields through
validation; check
the Google SDK's default handling before relying on its decoded arrays.

Store business status with provider-owned place metadata. A closure status needs
to participate in availability evaluation; a current status is not historical
proof about arbitrary past dates. Preserve the saved place and annotations when
Google reports closure or a moved identifier. A successful details response can
refresh `google_place_id` while retaining the internal UUID. The unique ID
constraint rolls back the refresh if another saved place owns the returned ID.

JSONB is useful for an optional source snapshot, but nested JSON period queries
would require extracting and interpreting intervals on each evaluation. A GIN
index over that JSON does not directly solve continuous temporal coverage.

PostgreSQL supports GiST indexes for multirange containment and overlap. Use a GiST
index on `hours_weekly_open`, plus a B-tree on `places.time_zone` if query plans
justify it. Production's deployment specifies PostgreSQL 17.
See [PostgreSQL range types](https://www.postgresql.org/docs/17/rangetypes.html).

## Query behavior

Keep the temporal syntax and three-valued semantics in
[the search grammar](search-grammar.md#opening-hours-and-aliases):

```text
hours[open(now)]
hours[open("2026-09-19T00:30:00-04:00")]
hours[openDuring("2026-09-19T18:00:00-04:00", "2026-09-19T20:00:00-04:00")]
hours[closed(now)]
hours[known(now)]
```

`openDuring` means continuously open for the entire half-open interval. Being
open at both endpoints is insufficient: L’Échaudé's lunch-to-dinner gap must
cause a spanning request to fail. An overlap predicate can be added separately
when needed. Resolve `now` once per query and require explicit offsets for
timestamp literals.

Results describe the saved weekly schedule as of `last_sync`. Holiday exceptions
and temporary schedule changes may differ from that schedule. Occasional syncs
refresh the saved hours; filtering evaluates them locally.

A nullable SQL predicate preserves unknown through `NOT`, `AND`, and `OR`;
`known` explicitly returns a non-null boolean. Missing hours or a missing time
zone make time-based evaluation unknown.

For regular instant evaluation, convert the instant to each place's local minute
of week and test `hours_weekly_open @> minute`. Group candidates by time zone so the
lookup minute can be computed once per zone and supplied as an indexable search
value. A per-row time-zone expression is correct but should not be assumed to
use the range index efficiently.

For intervals, project the request into local weekly ranges, splitting at week
boundaries and time-zone offset transitions. Require containment of all requested
segments; preserve continuous coverage across adjacent periods. DST needs
explicit tests for skipped and repeated local times. A local week is not always
168 elapsed hours.

For example, Monday 09:00–12:00 is `[1980,2160)` in minutes from Sunday midnight:

```sql
-- Monday at 10:00.
hours_weekly_open @> 2040

-- Continuously open Monday 10:00–11:00.
hours_weekly_open @> int4range(2040, 2100, '[)')
```

Benchmark with `EXPLAIN (ANALYZE, BUFFERS)` on development data. This
investigation does not establish query latency.

## Implementation sequence

1. Add hours validation, normalization, schema, and a shared provider refresh
   service. Imports should use the same normalization so new places receive hours.
2. Add `places sync`, backed by RPC and pg-boss per-place jobs. Support selecting
   a place or query, a bounded batch, and a dry run that fetches and reports diffs.
   Return counts for checked, changed, unchanged, unavailable-hours, and failed.
3. Fetch provider-owned basic fields, business status, time zone, and regular
   primary hours with an explicit mask. Keep secondary hours for a later feature.
   Normalize before comparing; update changed values and set `last_sync` after
   each successful refresh, including unchanged or unavailable-hours results.
4. Fetch outside transactions, then apply each validated update atomically.
   Preserve user notes, tags, sources, and internal IDs. Serialize jobs per place
   to avoid stale responses overwriting newer snapshots. Retry transient failures
   with bounded concurrency and keep last successful data on fetch failure.
5. Backfill all saved places through sync. Initial missing hours cause every place
   to be checked, but some responses will still legitimately have unknown hours.
   Exclude unavailable-hours rows from repeated initial-backfill selection;
   include them in subsequent explicit syncs.
6. Register a temporal-predicate data type, `open`/`openDuring`/`closed`/`known`
   functions, and the `hours` filter. Keep temporal logic in reusable helpers and
   publish signatures through the existing filter documentation registry.

Change detection happens after fetching provider details. It saves database
writes, not API requests. Hours fields trigger the Place Details Enterprise tier;
the sample used 12 details requests. See
[Google's field-mask and SKU reference](https://developers.google.com/maps/documentation/places/web-service/place-details).

Normalization tests should cover the observed split shifts, overnight and
multi-day periods, week wrap, 24/7 sentinel, and missing/empty hours. Add DST
transitions, invalid intervals, negation of unknown, idempotent sync, successful
unchanged refreshes advancing `last_sync`, and failed-refresh preservation. Verify range predicates and query plans against a
development PostgreSQL database.

Google's reference defines local weekday endpoints, dated current periods,
secondary schedule types, and IANA time zones:
[Place and OpeningHours reference](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#OpeningHours).
Provider retention considerations are tracked in [place metadata](place-metadata.md).
