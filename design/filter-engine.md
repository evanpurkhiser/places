# Filter engine

## Goal

Execute the search language through registered filters and functions, with clean
boundaries between syntax, meaning, resolution, and database queries. Registered
text, tag, presence, geographic, and opening-hours predicates run through
`places list --query` and `places sync --query`.

The [search grammar](search-grammar.md) defines the language. Its parser produces
source-located syntax nodes for generic filters, functions, arguments, values,
and boolean expressions. Application names such as `tag`, `notes`, `has`, and
`location` belong to registrations.

## Layers and ownership

| Layer                  | Location                                                       | Responsibility                                                                                         |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Search syntax          | `packages/common/src/search`                                   | PEG grammar, source locations, syntax tree, parsing errors                                             |
| Filter engine          | `packages/common/src/filter-engine`                            | Registries, type compatibility, argument binding, resolution, boolean composition                      |
| Places definitions     | `packages/common/src/filter-engine/{filters,functions,values}` | Filter signatures, semantic values, literal decoding, functions, examples, and pure validation         |
| Places implementations | `packages/server/src/filter-engine`                            | External value resolution, database lookups, semantic predicate compilation, and Drizzle filter output |
| Query runner           | Server RPC                                                     | Select columns, apply predicate, order results, transport errors                                       |
| CLI                    | `packages/cli`                                                 | Forward query text and display results or diagnostics                                                  |

The shared engine has no database schema, Drizzle, RPC, or provider dependencies.
Its predicate type and boolean operations are supplied by the host. Shared
definitions use `defineFilter`, `defineFunction`, and `defineValue`, and
`defineFilterEngine` collects them into one named catalog. Values include their
browser-safe literal decoders, and functions evaluate to plain semantic values.
The `placeFilterEngineDefinition` catalog is the complete executable definition
available to browser clients. Server implementations own external lookups,
Drizzle, and the Places schema.

`implementFilterEngine` overlays host behavior on that definition. Its
`valueResolvers` turn decoded inputs into environment-specific semantic values,
its filter compilers turn resolved arguments into host predicates, and its boolean
operations compose those predicates. TypeScript requires every filter compiler,
every advertised reference resolver, every decoder-to-semantic resolver, and a
`presence` compiler for each filter that sets `supportsPresence: true`.

Function parameters and results use semantic value types directly. The geographic
predicate is a shared discriminated union produced by `radius`, `rect`, and
`sector`. The server translates that union to SQL only when the `location` filter
is compiled.

## Registered capabilities

### Value types

A value definition declares its identity, supported literal and reference forms,
semantic type, and browser-safe decoder. Server value resolvers perform operations
that require request context or external data, such as resolving a place name,
checking an exact tag, or evaluating `@now`.
Registered types include text, tag names, property names, distances, degrees,
latitude, longitude, geographic points/predicates, time, and duration. `time`
resolves `@now`; geographic named references such as `@home` are planned.

Preserve wildcard intent through decoding. An escaped star differs from a
wildcard, and equality treats stars literally. Comparison operators remain
attached to the argument so implementations can distinguish matching from
literal equality.

### Functions

A function definition declares ordered parameters and a return type, then evaluates
those resolved parameters into a plain semantic value. Function results can feed
filters or other functions whose parameter type accepts that result.

The spatial pipeline is:

```text
point(longitude, latitude) -> geographic point
radius(geographic point, distance) -> {kind: "radius", origin, distance}
location[geographic predicate] -> SQL predicate
```

Type compatibility determines where functions can appear. Registering a new
geographic-predicate function makes it available to `location`;
application-specific grammar edits are unnecessary.

The geographic predicate contains plain data and can be inspected or visualized by
a browser. `location` exhaustively compiles each predicate variant to Drizzle SQL.
Polygon and route functions can extend the same semantic type.

### Filters

A filter definition declares its arguments. Its server implementation compiles
resolved values to a predicate.
Filters and functions share argument syntax. Values without a key fill parameters
in declaration order; `key:value` fills the parameter with that name. A parameter
can be supplied once per call, and positional values precede named values.
Filters may resolve application data before compilation, such as looking up exact
tag names. `tag`, `notes`, `has`, and `location` use the same registration mechanism.

A filter may expose a presence predicate. `has` discovers these capabilities
through narrow presence interfaces. Validation can ask whether a named filter
supports presence. Compilation can retrieve that filter's presence handler.
`has` validates literal property names during preparation and checks resolved
names during compilation.

The `notes` implementation owns the meaning of “notes exist”; the engine does not
maintain a separate switch over field names.

The query runner owns selected columns and ordering. Pagination is future work. Filter handlers
own predicates and any correlated subqueries needed to express membership.

## Capability documentation

Registrations supply descriptions for filters, functions, types, and parameters.
Parameter names appear in documentation and can be used in calls. Filters and
functions may include complete query examples as
`{query, description?}` objects. Example descriptions explain the expected match.

`engine.describe()` returns a serializable description of registered capabilities,
including parameter types, optionality, operators, presence support, function
return types, and whether value types accept literals or named references.
`query.describe` exposes the Places engine's description over RPC, and
`places docs filter` renders it as plain text. This output reflects the running server's
registrations. Examples are checked during preparation in tests, without invoking
external resolution.

## Execution stages

1. Parse query text into a syntax tree.
2. Prepare the complete tree: validate registered capabilities, argument names,
   arity, comparisons, literal values, and function return types. Bind arguments
   and report errors with their source spans.
3. Resolve prepared values and filter inputs. External lookups and database reads
   happen here. A request context carries dependencies and shared request state.
4. Compile resolved filters and compose them with the injected AND, OR, and negation
   operations. The empty query compiles to true.
5. Run the resulting predicate against the places query.

Preparation completes for the entire tree before any resolver runs. Preparation errors in a branch prevent resolution of the entire query.
Constraints involving resolved values are checked by resolvers or compilation
handlers and can fail after lookups. Resolution failures terminate
the query; they do not become empty result sets. SQL compilation is synchronous
and performs no external requests.

Registration errors, such as duplicate names or references to unregistered types,
are programming errors detected when building the engine. User queries produce
structured diagnostics. Known language features without executable registrations
must fail explicitly rather than silently broadening the selection.

## Places implementations

### Tag

```text
tag[favorite]
tag["date night"]
tag[type.*]
tag[laptop-friendly, notes:outlet]
!tag[visited]
```

Use correlated EXISTS predicates to test assignment membership. A tag name and
its note constraint apply to the same assignment. A place with several matching
tags appears once. Negation applies to the whole membership predicate.

Exact tag names are normalized and resolved before execution. Unknown exact names
are errors, including under negation. Wildcard patterns may match zero definitions.
Default tag matching covers the full name. `=` performs literal matching. Use
`!` around a predicate for exclusion, including predicates with note constraints.

### Text and presence

```text
notes[espresso]
name[="La Cabra"]
!has[notes]
```

Default text matching is case-insensitive substring matching. Explicit equality
matches the complete field. Unescaped stars provide wildcard matching; SQL `%`,
`_`, and escape characters remain literal user data. Every value is parameterized.

Absent or empty notes fail positive note matches. Negation includes places whose
notes are absent. `has[notes]` uses the notes registration's presence predicate.
`has[tag]` tests whether any active tag assignment exists.

### Sources

`source` accepts named conditions and compiles them inside a correlated `EXISTS`
over `place_sources` and `sources`. All conditions match one source and its
association with the selected place. This prevents duplicate places, scopes
association descriptions correctly, and makes negation apply to the whole place.
Its presence predicate supports `has[source]`. Source matching reads saved data.

### Geography and opening hours

`point`, `radius`, `rect`, and `sector` produce values consumed by `location`.
Point strings resolve through Google Places; the first text-search result is used.
Maps inputs and explicit coordinates provide more specific origins. The query
context shares repeated lookups and resolves independent origins concurrently.

`open` consumes a time and optional `for` duration or `until` endpoint. It checks
the saved weekly multirange, with business closures taking precedence and unknown
hours preserving SQL NULL through boolean composition. The context captures
`@now` once. See [time values](time-values.md) for local versus absolute times,
continuous coverage, DST behavior, interval limits, and index use.

## Semantic validation

Registrations define the accepted query surface and its implementations. The PEG
parser recognizes generic syntax; the engine validates the resulting AST against
registered signatures before resolution. Function placement follows registered
return types. Planned capabilities in the language design become executable when
their registrations are implemented.

The parser remains independently usable for syntax tooling. A syntactically valid
expression with an unregistered name produces a semantic diagnostic during engine
preparation.

## Scope and verification

The engine implements API/CLI retrieval, tag/text/presence filters, geographic
point/radius/rectangle/sector functions, and opening-hours evaluation. Area
boundaries, routing, saved locations, saved queries, and query explanations are
planned; the [grammar status](search-grammar.md#implementation-status) tracks them.

Tests cover parser-to-engine behavior, registration invariants, preparation before
resolution, nested function compatibility, boolean composition, diagnostics, and
SQL parameterization. PostgreSQL integration tests cover actual spatial and hours
results, DST transitions, unknown hours, wildcard escaping, absent notes, tag-note
correlation, and whole-place negation. API and CLI tests exercise filtered results
and diagnostic transport. Database tests require `TEST_DATABASE_URL` and run in
isolated databases.
