# Search grammar

## Purpose and status

Design for querying saved places through the API and CLI. The shared PEG parser
and typed syntax tree are implemented in `packages/common/src/search`. The filter
engine validates and executes registered tag, text, and presence predicates
through the API and CLI. Geographic, hours, and saved-query execution remain
planned. The first consumer is an agent managing the collection through the CLI.

Queries select places. Inspection and mutation use the returned place IDs. Sorting,
pagination, and output selection are separate API inputs and CLI options.

```sh
places list --query 'tag[type:cafe] tag[attr:laptop-friendly]'
places list --query '(tag[type:cafe] OR tag[type:bakery]) location[within("Manhattan, NYC")]'
places list --query 'tag[status:want-to-try] hours[open(now)]'
```

Use a PEG grammar generated with Peggy and a typed expression tree shared through
`packages/common`. Sentry's `searchSyntax` grammar provides
precedent for filter syntax, typed nodes, and source locations. Places needs an
execution grammar with explicit boolean precedence and actionable errors.

## Expressions and operators

- Adjacent expressions imply AND. Explicit `AND` is equivalent.
- `OR` matches either expression.
- Prefix `!` negates an expression, including a parenthesized group.
- Parentheses group expressions and may nest.
- Precedence is negation, then AND, then OR.
- Boolean keywords are case-insensitive and require token boundaries between
  expressions.
- An empty query selects all places.

```text
tag[type:cafe] tag[attr:laptop-friendly]
tag[type:cafe] AND tag[attr:laptop-friendly]
(tag[type:cafe] OR tag[type:bakery]) AND !tag[status:visited]
!(tag[type:bar] OR tag[type:restaurant])
```

Comparison operators appear inside the brackets before the value: `name[="La Cabra"]` or, for a
future ordered field, `created[>=2026-09-01]`. Recognize `=`, `<`, `<=`, `>`,
and `>=`; validate supported operators against the field's type. Ordering applies
to dates and numbers once those fields are defined. Strings support default
matching and exact equality. Unsupported combinations are errors.

`!field[=value]` excludes an exact match. For tags, `!tag[=type:cafe]`
selects places without that tag, regardless of other assigned tags.

## Strings and wildcards

Double quotes delimit strings containing whitespace or grammar punctuation.
Unquoted values may contain colons, hyphens, dots, and slashes. Whitespace,
parentheses, square brackets, commas, comparison symbols, quotes, and `!`
delimit unquoted values.
Within strings, `\"` represents a quote, `\\` a backslash, and `\*` a literal
asterisk. Unknown escape sequences are errors.

Default string matching supports `*` for zero or more characters. Quoting groups
a string but preserves wildcard behavior. Use `=` for literal equality, including
literal asterisks. Wildcards have no regular-expression syntax; SQL wildcard
characters such as `%` and `_` remain literal characters.

```text
tag[favorite]
tag["date night"]
tag[*friendly*]
tag[type:*]
tag[gmaps-list:*]
tag["gmaps-list:[NYC] Coffee"]
name["*coffee*"]
name[="La Cabra"]
```

Tag matches cover the entire normalized tag name. Thus `tag[cafe]` matches the
exact tag `cafe`, while `tag[*cafe*]` matches names containing `cafe`. Normalize tag
values using the same trimming and lowercasing rules as tag creation.

Default `name[...]`, `address[...]`, and `notes[...]` matching use
case-insensitive substring matching; explicit `=` requires whole-field equality,
also case-insensitive. For example, `name[coffee]` matches a name containing coffee.
Accent folding and language-specific search behavior remain open decisions.

## Filter keys and tags

Each predicate uses `field[condition]`. The field selects what to filter; the
condition is a string, wildcard pattern, boolean, comparison, or function call.
Use a fixed registry of filter keys. A bracketed predicate contains a primary
condition and any supported named constraints. Constraints apply to the same
related record. Boolean operators and groups combine complete predicates outside
the brackets.

Tag names are arbitrary labels: `tag[favorite]`, `tag["date night"]`, and
`tag[type:cafe]` all match tag names. Colons are ordinary characters; names such
as `type:cafe` follow a user-chosen naming convention. Quote values containing
spaces or square brackets, such as `tag["gmaps-list:[NYC] Coffee"]`.

| Key        | Meaning                               | Example                              |
| ---------- | ------------------------------------- | ------------------------------------ |
| `tag`      | Match an assigned tag name or pattern | `tag[type:cafe]`                     |
| `name`     | Match the saved place name            | `name["La Cabra"]`                   |
| `address`  | Match the formatted address as text   | `address["Broadway"]`                |
| `notes`    | Match the general place note          | `notes[espresso]`                    |
| `has`      | Presence of optional saved context    | `has[notes]`                         |
| `location` | Evaluate a geographic function        | `location[within("Manhattan, NYC")]` |
| `hours`    | Evaluate opening hours                | `hours[open(now)]`                   |

`has[tag]` means at least one tag is assigned. `!has[tag]` means no tag
assignments at all, including original import-list tags. Visit status stays in
user-managed tags.

`has[notes]` means a nonempty general place note exists. `!has[notes]` selects
places with an absent or empty general note, regardless of tag-assignment notes.
Additional presence checks must be registered explicitly.

Use `name[...]`, `address[...]`, and `notes[...]` to search place fields.

```text
name["La Cabra"] tag[type:cafe]
name[espresso] !has[notes]
!has[tag]
```

Use `tag[...]` for tag membership. Namespaces such as `type:`, `status:`, and
`trip:` remain part of the tag name. For example, `tag[location:nyc]` matches a tag
independently of the `location[...]` geographic filter.

Exact tag references must resolve to an existing tag or produce an unknown-tag
error. Wildcard patterns may match zero tag definitions; the query explanation
should expose that expansion, especially when the expression is negated.

### Tag-assignment notes

```text
tag[attr:laptop-friendly, notes:"*outlet*"]
tag[attr:*, notes:"upstairs"]
!tag[attr:laptop-friendly, notes:"*outlet*"]
```

The primary condition matches the tag name. The optional `notes:` constraint
matches the note on that same assignment using the text matching and wildcard
rules for `notes[...]`. A matching name on one assignment and a matching note on
another cannot satisfy the predicate. The tag definition's description and the
place's general note are separate fields.

Comma-separated constraints are conjunctive. A missing or empty assignment note
does not satisfy a positive note match. Negating the whole predicate means no
assignment matches both the name and note; places without that tag also qualify.
To require the tag while excluding a particular note, combine predicates:

```text
tag[attr:laptop-friendly] AND !tag[attr:laptop-friendly, notes:"*outlet*"]
```

Tag names and note constraints support default matching or `=` for literal
equality. Express exclusion with `!` around the whole predicate. Constraint
names must be unique and registered.

## Geographic functions

`location[...]` accepts functions that describe a geographic selection. Location
resolution is a server operation after parsing and validation. A location string
is an argument to the resolver, rather than embedded query syntax.

### Area boundaries

```text
location[within("Manhattan, NYC")]
location[within("East Village, NYC")]
```

Resolve the name to a geographic area represented by a GeoJSON Polygon or
MultiPolygon. Include places inside or on the boundary, respecting holes and all
polygon components. A bounding box is useful for candidate retrieval, but the
area's actual geometry determines membership.

The resolver must distinguish an area boundary from a point or display viewport.
If a boundary is unavailable, return an explicit resolution error. Ambiguous names
return candidates for the caller to disambiguate.

### Radius around a point

```text
location[radius("East Village, NYC", 5mi)]
location[radius(point(-73.985, 40.726), 800m)]
```

Resolve the first argument to a point, then include places at most the supplied
straight-line geographic distance from it. For a named neighborhood, expose the
chosen representative point in the query explanation. A named point and an area
boundary are distinct resolver outputs.

`point(longitude, latitude)` uses explicit numeric coordinates. Validate coordinate
ranges. Distances require a positive number and a unit: `m`, `km`, `ft`, or `mi`.
Normalize distances internally to meters. Radius is independent of travel time.

### Route corridor

```text
location[route("Union Square, NYC", "Tompkins Square Park, NYC", buffer:800ft, mode:walk)]
```

Resolve endpoints to points and request a route for the specified travel mode.
The route supplies a GeoJSON LineString or MultiLineString. Match places within
`buffer` distance of any part of that route, including its endpoints. `800ft` is
the maximum distance on either side, giving a corridor approximately 1,600 feet
wide along straight sections.

This measures geographic proximity to the route. Reachability and additional
walking distance for a detour require separate routing calculations.

Require `buffer` and `mode` explicitly in the initial syntax. Begin with `walk`;
additional modes depend on the routing integration. Route alternatives, waypoints,
and reuse of an existing route are extension points. Expose the selected route
and provider identity so the caller can inspect what was used.

### Sector

```text
location[sector("Union Square, NYC", towards:"East Village, NYC")]
location[sector("Union Square, NYC", bearing:90deg, spread:60deg, buffer:200m, range:2mi)]
```

Resolve an origin and select a sector facing either `towards` or `bearing`.
Require exactly one heading argument. `towards` supplies a point from which to
calculate the heading and default range. An explicit `range` overrides that
distance. Require `range` with `bearing`. Resolve origin and heading place names
concurrently. Coincident origin and heading points are invalid.

Bearings run clockwise from true north: 0 degrees is north, 90 east, 180 south,
and 270 west. `spread` is the full opening angle; 60 degrees means 30 degrees on
either side of the bearing. Defaults are `spread:30deg` and `buffer:200m`.

Expand the entire sector by `buffer`, including its sides, forward edge, and
origin. This includes places up to the buffer distance behind the starting point.
`range` is forward reach before buffering, so the maximum distance from the
origin is `range + buffer`.

Include the origin and sector edges. Accept bearings in `[0, 360)` and spreads in
`(0, 360]`. A 360-degree spread selects a circle of `range + buffer`. Explicit
ranges must be less than 10000km to keep the geography interior within a
hemisphere. When deriving range, require the heading point to be within 90 degrees
of the origin.

Build sector boundaries using WGS84 geodesic projections. Approximate the outer
arc with steps of at most one degree, refined for a nominal chord error of 0.5m.
Measure the buffer using PostGIS geography distances in meters. Sectors support
headings crossing north and coordinates crossing the antimeridian.

### Named locations

Named locations give saved geographic references short, reusable names:

```text
location[radius(@home, 1mi)]
location[within(@neighborhood)]
location[route(@home, @work, buffer:800ft, mode:walk)]
location[sector(@home, bearing:90deg, spread:60deg, range:2mi)]
```

Resolve `@name` from an application-managed location registry. Each entry has a
stable ID, a unique name, and an explicit point or area geometry, with provenance
when derived from a provider. A point supports radius origins and route endpoints;
an area supports `within`. A location may have both an area and an explicitly
chosen representative point. Report an error when the required geometry is absent.

Unknown names produce a reference error. Resolve each reference once per request
and expose its ID, current name, and geometry in the explanation. Named locations
refer to stored geography; caller-supplied current position remains separate.
Use unquoted identifiers such as `@home` or `@east-village`, with `@"name with spaces"`
for other names. Quote an ordinary string beginning with `@` to search for that
literal location name.

Registry CRUD commands and geometry refresh behavior require implementation
design. Queries stored by the application should bind named locations by stable
ID so renaming preserves their meaning; geometry updates affect future evaluations.

### Travel time and detours: exploratory

Potential future syntax:

```text
location[reachable(@home, within:20min, mode:walk)]
location[detour(@home, @work, extra:10min, mode:walk)]
```

`reachable` would select places whose travel time from an origin is at most the
budget. Candidate implementation approaches include a provider-supplied reachable
area or travel-time calculations to candidate places. Their accuracy and cost
need evaluation before committing to an implementation.

`detour` would compare travel time from origin to destination via a candidate place
against the direct journey, using consistent routing settings. The `extra` budget
covers additional travel; time spent visiting the place would be a separate input.

Both depend on routing capabilities beyond geometric filtering. Evaluate provider
support, request volume, latency, batching, departure-time behavior, and treatment
of unreachable places. A radius or route corridor remains a geographic predicate;
it cannot establish either travel-time budget. These functions are exploratory
and have no committed delivery phase.

### Resolution and execution context

Choose boundary, geocoding, and routing providers during implementation. Each
integration must specify available geometry, attribution, freshness, and permitted
reuse. Provider selection is independent of the expression grammar.

A resolution result should expose the matched name, stable reference where
available, provider, geometry kind, and relevant point or boundary. Support a
way to reuse a resolved reference so an agent can repeat an unambiguous selection.
Named locations provide durable reuse; a reference format for ad hoc resolution
results remains an implementation decision.

The server cannot infer the user's physical location from where the CLI runs.
A future `here` operand must resolve from explicit request coordinates. Geographic
bias may help resolve names, but ambiguous candidates require caller selection.
Provider failures are query errors rather than successful empty results.

Combine geography with ordinary boolean expressions:

```text
tag[type:cafe] location[within("Manhattan, NYC")] !location[within("East Village, NYC")]
(location[within("Manhattan, NYC")] OR location[within("Brooklyn, NYC")]) tag[type:museum]
```

## Opening hours

Use the `open` filter with typed time and duration values:

```text
open[@now]
open[6pm, for:2h]
open["MON 6pm", until:"tue 2am"]
open["2026-09-21T18:00:00-04:00", for:2h]
!open[@now]
```

Time literals accept local clock times, recurring weekdays, and ISO timestamps
with an explicit UTC offset or `Z`. `@now` resolves once per query. Bare clock
times use today's date in each place's time zone. Duration literals use `m` or
`h`. See [time values](time-values.md) for supported spellings, endpoint rules,
daylight-saving behavior, and interval limits.

`for` and `until` require continuous opening throughout the half-open interval.
Missing hours produce unknown, preserved by negation. `!open[@now]` therefore
selects known-closed places. Boolean composition uses SQL three-valued logic:
`false AND unknown` is false and `true OR unknown` is true. Return places whose
complete expression is true.

The filter evaluates the saved recurring primary schedule and recorded business
closure status. Results reflect the last sync; holiday exceptions and dated
schedules require additional data.

## Saved queries: future implementation

```text
saved[work-friendly] AND location[within("Manhattan, NYC")]
saved["date night"] AND !tag[status:visited]
```

`saved[...]` references a named query and evaluates its complete expression as a
group. It represents a live selection: current data and request context determine
the results on each evaluation. A saved query containing `now` uses the same
instant as the enclosing query.

Names resolve exactly to stable query IDs. Stored expressions bind exact tag,
named-location, and saved-query references by ID so renaming preserves meaning;
wildcard tag patterns remain dynamic. Unknown or deleted references are explicit
errors. Detect direct and indirect reference cycles and bound expansion depth.

An explanation should show the expanded expression and referenced query identities.
Storage, naming rules, CRUD commands, and versioning are future implementation
work. Initial saved queries take no parameters.

## Grammar outline

This is a structural sketch; the executable PEG grammar defines lexical
boundaries and escaping, with coverage in parser tests.

```text
query       := whitespace expression? whitespace EOF
expression  := orExpression
orExpression := andExpression (OR andExpression)*
andExpression := unaryExpression ((AND | implicitAnd) unaryExpression)*
unaryExpression := "!" unaryExpression | primary
primary     := "(" expression ")" | filter
filter      := key "[" whitespace filterArguments? whitespace "]"
filterArguments := positionalArgument ("," argument)*
comparison  := ">=" | "<=" | "=" | ">" | "<"
value       := function | reference | quotedString | unquotedValue
reference   := "@" (identifier | quotedString)
function    := identifier "(" arguments? ")"
arguments   := argument ("," argument)*
argument    := identifier ":" comparison? value | positionalArgument
positionalArgument := comparison? value
```

`implicitAnd` requires whitespace and the start of another expression. Function
arguments permit whitespace around separators. An identifier immediately followed
by `[` starts a filter and must name a registered field. Quote string values
containing literal brackets. Colons remain
part of string values, with `:` also separating named function arguments such as
`buffer:800ft`. The first filter argument is positional, preserving colons in
tag names. Subsequent filter arguments and all function arguments may be named.
Quote colon-containing positional strings after a comma or inside a function to
distinguish them from named arguments. Positional arguments precede named ones.
Each field declares its allowed arguments. References such as `@home` are valid
only in configured reference positions; a tag name beginning with `@` must be
quoted.

Parse strings, function calls, and source spans into an AST. A typed validation
pass assigns booleans, distances, angles, timestamps, and field-specific meaning.
Validate function names, argument names, arity, duplicate arguments, and operators
before invoking external services. Function calls are limited to registered
functions and valid field contexts.

### Shared parser API

Import `parseQuery` and `SearchError` from `@places/common/search`.
`parseQuery(input)` parses the complete query into an AST. An empty query produces
`null`. The parser recognizes generic filter and function calls, including names
that have no registered implementation.

```ts
const query = parseQuery(
  'tag[attr:laptop-friendly, notes:"*outlet*"] location[radius(@home, 1mi)]',
);
```

The filter engine's `prepare(input)` parses syntax and validates it against the
engine's registrations. Registrations define argument types, positional and named
parameters, optional parameters, allowed operators, reference support, and custom
constraints. Functions declare return types, which determine where they can be
used. Unknown filters or functions, incompatible types, invalid values, and
argument errors produce structured diagnostics with source locations before
asynchronous resolution begins.

Nodes preserve source text and offsets, line and column positions, explicit
groups, operators, quoted strings, and references. Scalar values remain decoded
strings. Registered value types decode literals into their semantic values
during engine preparation. Unescaped wildcard positions are retained separately
from literal stars. Equality operators interpret all stars literally. Filter,
function, and parameter names are case-sensitive; boolean keywords are case-insensitive.

The executable registrations currently support tag, text, and presence
filters. Geographic, hours, date, and saved-query examples describe planned
registrations. They can be parsed as syntax; execution requires an implementation.

Syntax and validation failures throw `SearchError` with a `diagnostics` array.
Invalid syntax is rejected as a complete query.

The generated ES module is included for direct Node and browser imports. Peggy
is a development dependency; generation runs through
`pnpm --filter @places/common generate:search`. Run
`pnpm --filter @places/common check:search` to check reproducibility. Parser tests
also verify that the generated module matches the grammar.

## Execution and agent tooling

The [filter engine](filter-engine.md) defines registration, typed function
composition, resolution, and SQL compilation layers. Application implementations
live in server modules, separate from the PEG grammar and shared engine.

1. Parse the complete query into a typed expression tree with source spans.
2. Validate fields, functions, operators, and values.
3. Expand saved queries when supported, then resolve tags, named locations,
   geographic searches, routes, and temporal context.
4. Compile the resolved expression into parameterized database predicates.
5. Return matching places with IDs and enough tag context for inspection.

Keep parsing pure and reusable. Server code owns database access, external
resolution, and query compilation. Tag predicates should compose without
introducing duplicate place results. Apply negation to membership of the whole
place, rather than to individual joined tag rows.

Propose `places query explain '<expression>'` to return canonical syntax, the
expression tree, tag expansions, resolved locations, temporal context, and missing
data warnings. It may perform external resolution; it does not mutate places.
An agent can inspect the selection before applying updates by place ID.

Errors should include a stable code, source span, offending field or argument,
and a correction where possible. Distinguish syntax errors, unknown keys/tags,
invalid values, ambiguous locations, unavailable boundaries, unsupported
capabilities, and provider failures. Bound external resolution work according to
provider capabilities and request budgets.

## Delivery sequence and open decisions

1. Boolean expressions, groups, explicit tag matching, strings, wildcards, and
   inspection-friendly CLI results. Add tag-assignment note constraints, `has[tag]`,
   text fields, and `has[notes]` with negation.
2. Geographic radius from explicit points, then named points, area boundaries,
   and the named-location registry.
3. A dedicated hours design, followed by enrichment and temporal evaluation.
4. Route corridors and directional sectors, ordered by actual use.

Document all function families now; expose implemented capabilities explicitly.
A planned predicate used before its integration exists returns an unsupported
capability error.

Before implementation, settle:

- Exact tag errors and zero-match wildcard diagnostics.
- Provider selection, named-location management, and ad hoc resolution references.
- Hours freshness and the window for which status can be established.
- Text normalization beyond case-insensitivity.
- Pagination and the detailed explanation response contract.

Saved queries are a future implementation. Travel-time and detour filters remain
exploratory pending a routing feasibility assessment. Other later extensions
include saved-date comparisons, source predicates, and distance sorting.
