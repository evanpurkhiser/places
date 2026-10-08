# Hours enrichment and filtering

Hours enrichment, import/sync, and the `open` filter are implemented. This document
records the research behind the representation and its current storage and refresh
behavior. [Time values](time-values.md) defines the executable query semantics.

The initial research used 12 Google Place Details responses fetched on September
18, 2026, using IDs from the 2,614 saved places in production. Production was read
through `places.list`; that investigation made no database writes.

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
normalization and sync tests exercise these cases with synthetic fixtures.

An independent scratch comparison expanded each structured weekly schedule and
its English weekday descriptions into 10,080 minute flags. All 74 schedules
matched at every minute, including overnight carryover and week wrap. Use
structured periods in the implementation; this comparison was an audit of the
sample, not a proposed dependency on localized display text.

The installed Google protobuf helper converts both an absent `periods` property
and an explicit empty array to an owned empty array. A direct `fromObject` probe
confirmed that these inputs become indistinguishable. Metadata fetching uses
REST JSON so validation preserves absent versus explicitly empty periods.

Google returned `Asia/Saigon` for Vietnamese places. All 16 returned zones were
accepted by Node's `Intl.DateTimeFormat`; database integration tests should also
exercise the returned identifiers, including aliases.

This sample validates the observed weekly schedule shapes, not completeness or
real-world accuracy. Seasonal venues can advertise a weekly schedule that does
not capture off-season closures. Results describe the last synced schedule.

## Storage

The primary schedule is stored directly on `places` using native PostgreSQL
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
failed refreshes preserve it. REST fetching preserves absent-versus-empty API
fields through validation.

Store business status with provider-owned place metadata. A closure status needs
to participate in availability evaluation; a current status is not historical
proof about arbitrary past dates. Preserve the saved place and annotations when
Google reports closure or a moved identifier. A successful details response can
refresh `google_place_id` while retaining the internal UUID. The unique ID
constraint rolls back the refresh if another saved place owns the returned ID.

JSONB is useful for an optional source snapshot, but nested JSON period queries
would require extracting and interpreting intervals on each evaluation. A GIN
index over that JSON does not directly solve continuous temporal coverage.

The hours migration creates a GiST index on `hours_weekly_open` for range
containment. Time-zone-dependent queries currently scan candidates; adding a
time-zone index requires a query plan that can use it. The integration tests use
PostgreSQL 17 with PostGIS.
See [PostgreSQL range types](https://www.postgresql.org/docs/17/rangetypes.html).

## Query behavior

Keep the temporal syntax and three-valued semantics in
[the search grammar](search-grammar.md#opening-hours):

```text
open[@now]
open["2026-09-19T00:30:00-04:00"]
open["mon 6pm", until:"tue 2am"]
open[@now, for:2h]
!open[@now]
```

Intervals require continuous opening throughout the half-open interval. Being
open at both endpoints is insufficient: L’Échaudé's lunch-to-dinner gap must
cause a spanning request to fail. Resolve `@now` once per query. Literal formats
and endpoint semantics are documented in [time values](time-values.md).

Results describe the saved weekly schedule as of `last_sync`. Holiday exceptions
and temporary schedule changes may differ from that schedule. Occasional syncs
refresh the saved hours; filtering evaluates them locally.

A nullable SQL predicate preserves unknown through `NOT`, `AND`, and `OR`.
Missing hours produce unknown. Clock and instant evaluation also require the
place's time zone; recurring weekly values can use the schedule directly.

Instant evaluation converts the instant to each place's local minute of week and
tests `hours_weekly_open @> minute`. Weekly values use direct indexable containment.
Dated intervals project the requested minutes once per stored time zone and reuse
the resulting multirange for each place. The projection splits at UTC minute
boundaries, subdividing transition minutes at second boundaries for historical
IANA offsets. Containment requires every visited local minute to be open.

Clock and instant predicates currently scan candidates. A future per-zone join
with fixed range conditions could make those queries indexable. DST tests cover
skipped and repeated local times; a local week is not always 168 elapsed hours.

For example, Monday 09:00–12:00 is `[1980,2160)` in minutes from Sunday midnight:

```sql
-- Monday at 10:00.
hours_weekly_open @> 2040

-- Continuously open Monday 10:00–11:00.
hours_weekly_open @> int4range(2040, 2100, '[)')
```

## Sync implementation

`places sync` accepts an optional filter query, selects saved places, and queues
one pg-boss job per place. It returns `matched`, `queued`, `alreadyQueued`, and
`jobIds`. `places sync-status` reports each job's state and result: `updated`,
`unchanged`, `missing`, or `superseded`.

Imports and syncs fetch basic metadata, time zone, business status, and regular
primary hours with an explicit mask. Imports normalize hours before inserting new
places; reimporting an existing place reuses it and applies supplied annotations.
Sync fetches outside the write transaction, locks the place before applying the
validated projection, and skips a response if another refresh already completed.
A changed Google ID keeps the internal UUID; a collision with another place's
Google ID rolls back the refresh. Notes, tags, and sources remain intact.

Queue workers have configurable batch size and concurrency. Failed jobs retry
three times with backoff. Change detection happens after fetching details: it
reduces database writes, not provider requests. A complete successful refresh
advances `last_sync`, even when no metadata changed.

The current commands queue explicit refreshes. Scheduled refreshes, bounded-batch
selection, a dry-run diff mode, and aggregate completion summaries remain planned.
Current/date-specific hours and secondary schedules are future enrichment work.

## Verification

Normalization and PostgreSQL tests cover split shifts, overnight and multi-day
periods, week wrapping, 24/7, missing/empty hours, DST transitions, unknown
negation, idempotent sync, unchanged refreshes, and failed-refresh preservation.
API and CLI tests cover query forwarding, results, and diagnostics.

`EXPLAIN (ANALYZE, BUFFERS)` on 26,000 synthetic places across six time zones
confirmed GiST use for a selective weekly interval. Warm local execution times
were about 0.6 ms for that weekly interval, 32 ms for `open[@now]`, and 25 ms for a
two-hour dated interval. These measure database filtering on test data, excluding
API transport and result serialization; production latency depends on workload.

Google's reference defines local weekday endpoints, dated current periods,
secondary schedule types, and IANA time zones:
[Place and OpeningHours reference](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#OpeningHours).
Provider retention considerations are tracked in [place metadata](place-metadata.md).
