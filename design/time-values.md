# Time and duration values

The filter engine registers `time` and `duration` as typed values. Time literals
produce local clock times, recurring weekly times, or absolute instants. The
`@now` reference produces an instant captured once when the query context is
created. Every occurrence in that query uses the same value.

| Input                         | Meaning                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `@now`                        | The query's current instant                                |
| `6pm` or `6PM`                | 18:00 today in each place's time zone                      |
| `6:45`                        | 06:45 today in each place's time zone                      |
| `22:00`                       | 22:00 today in each place's time zone                      |
| `"MON 6pm"`                   | Monday at 18:00 in each place's recurring local week       |
| `"Monday 18:00"`              | The same recurring weekly time                             |
| `"2026-09-21T18:00:00-04:00"` | An absolute ISO 8601 timestamp with an explicit UTC offset |
| `"2026-09-21T22:00:00Z"`      | The same instant expressed in UTC                          |

Weekdays accept full English names and three-letter abbreviations, ignoring
case. Twelve-hour times require `am` or `pm`, ignoring case, with one optional
space before the suffix: `6pm`, `"6 pm"`, or `"6:30 PM"`.
Twenty-four-hour times require minutes. Quote any value containing
spaces. Bare clock times refer to today's local date even if that time has
already passed. Calendar dates use the ISO timestamp form with `Z` or an explicit
UTC offset; this identifies an instant independently of the place's time zone.

The decoded `Time` union distinguishes:

- `clock`: minute of day, from 0 through 1439.
- `weekly`: minute of week, from 0 through 10079, starting Sunday at midnight.
- `instant`: Unix epoch milliseconds.

A duration is a positive number followed by `m` for minutes or `h` for hours.
Examples: `30m`, `2h`, `1.5h`. Fractions are supported when the result is
representable as a positive safe integer of milliseconds. Durations describe
elapsed time; calendar evaluation belongs to the consuming filter.

## Open filter syntax

The `open` filter accepts `open(Time, for?: Duration, until?: Time)`:

```text
open[@now]
open[6pm]
open["MON 6pm", for:2h]
open["mon 6pm", until:"tue 2am"]
open["2026-09-21T18:00:00-04:00", for:2h]
```

`for` and `until` are mutually exclusive. Either requests continuous opening
throughout the half-open interval; a single time checks opening at that point.

Endpoints must have the same kind: clock, weekly, or instant. Weekly endpoints
advance through the recurring week, wrapping from Saturday to Sunday. Identical
weekly endpoints are rejected; use `for:168h` for a full week. Clock endpoints
are on today's local date and must increase; an overnight request can use a
duration or explicit weekdays. Instant endpoints must increase chronologically.

Weekly durations count wall-clock minutes in the recurring schedule. Clock and
instant durations count elapsed minutes, including time-zone offset changes.
Dated intervals are limited to 31 days (744 hours) to bound evaluation cost.

For repeated local clock times during daylight-saving changes, the standard-time
occurrence is used. A nonexistent clock time produces unknown. Offset-bearing
timestamps select an unambiguous instant. Evaluation checks continuous coverage,
including repeated hours and gaps between separate opening periods.

The filter evaluates the saved primary weekly schedule. A recorded temporary or
permanent business closure returns false. Missing hours produce unknown; clock
and instant evaluation also require the place's time zone. Negation preserves
unknown, so `!open[@now]` returns known-closed places. Results reflect the last
sync; holiday exceptions and date-specific schedules require additional data.

Weekly queries use multirange containment directly. Dated intervals project the
required minutes once per stored time zone, then reuse those ranges for each
place. The projection splits at UTC minute boundaries and subdivides minutes
containing an offset change into seconds, preserving historical IANA offsets.

The hours migration creates the GiST index `places_hours_weekly_open_idx`.
Weekly containment stays visible as a top-level boolean condition so PostgreSQL
can choose that index. Instant and dated conditions depend on each row's time
zone and currently scan candidates. A time-zone index alone does not make these
conditions indexable; larger datasets can use per-zone joins with fixed range
conditions. Assess query plans with `EXPLAIN (ANALYZE, BUFFERS)` on representative
data before adding indexes.
