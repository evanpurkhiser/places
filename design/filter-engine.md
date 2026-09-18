# Filter engine

## Goal

Execute the search language through registered filters and functions, with clean
boundaries between syntax, meaning, resolution, and database queries. The shared
engine supplies registration, preparation, resolution, compilation, and capability
descriptions. Places-specific SQL filters and API/CLI integration follow separately.

The [search grammar](search-grammar.md) defines the language. Its parser produces
source-located syntax nodes for generic filters, functions, arguments, values,
and boolean expressions. Application names such as `tag`, `notes`, `has`, and
`location` belong to registrations.

## Layers and ownership

| Layer          | Location                            | Responsibility                                                                     |
| -------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| Search syntax  | `packages/common/src/search`        | PEG grammar, source locations, syntax tree, parsing errors                         |
| Filter engine  | `packages/common/src/filter-engine` | Registries, type compatibility, argument binding, resolution, boolean composition  |
| Places filters | `packages/server/src/filter-engine` | Place-specific registrations, database lookups, Drizzle predicates, schema imports |
| Query runner   | Server RPC                          | Select columns, apply predicate, order results, transport errors                   |
| CLI            | `packages/cli`                      | Forward query text and display results or diagnostics                              |

The shared engine has no database schema, Drizzle, RPC, or provider dependencies.
Its predicate type and boolean operations are supplied by the host. Server filter
modules can import Drizzle and the Places schema directly: those dependencies
belong in implementations that translate domain meaning into SQL.

## Registered capabilities

### Value types

A value type declares its identity and decodes supported literals. It may also
resolve named references. Types carry the value shape into registration handlers.
Examples include text patterns, booleans, instants, distances, points, and regions.

Preserve wildcard intent through decoding. An escaped star differs from a
wildcard, and equality treats stars literally. Comparison operators remain
attached to the argument so implementations can distinguish matching from
literal equality.

### Functions

A function declares argument types, positional and named parameters, and a return
type. Its resolver produces a value, potentially asynchronously. Function results
can feed filters or other functions whose parameter type accepts that result.

For example, a future spatial pipeline is:

```text
point(number, number) -> Point
radius(Point, Distance) -> Region
location[Region] -> Predicate
```

Type compatibility determines where functions can appear. Registering a new
region-producing function makes it available to region-consuming arguments;
application-specific grammar edits are unnecessary.

A region can describe a radius, polygon, or route corridor. The location filter
chooses the suitable SQL operation. A radius representation can retain its center
and distance until compilation.

### Filters

A filter declares its arguments and compiles resolved values to a predicate.
Filters may resolve application data before compilation, such as looking up exact
tag names. `tag`, `notes`, `has`, and `location` use the same registration mechanism.

A filter may expose a presence predicate that another registration can discover
through the registry. Validation handlers receive the registry as their second
argument; compilation handlers receive application context as their second
argument and the registry as their third. The registry exposes a read-only map of
the invoking engine's filters.

Each registration owns the meaning of presence for its value.

The query runner owns selected columns, ordering, and pagination. Filter handlers
own predicates and any correlated subqueries needed to express membership.

## Capability documentation

Registrations supply descriptions for filters, functions, types, and parameters.
Positional parameters have names for documentation; named parameters use their
registration keys. Filters and functions may include complete query examples as
`{query, description?}` objects. Example descriptions explain the expected match.

`engine.describe()` returns a serializable description of registered capabilities,
including parameter types, optionality, operators, presence support, function
return types, and whether value types accept literals or named references.
Consumers can render this description for capability discovery. Examples are
checked during preparation in tests, without invoking external resolution.

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

Preparation completes for the entire tree before any resolver runs. A malformed
branch cannot trigger lookups in a different branch. Resolution failures terminate
the query; they do not become empty result sets. SQL compilation is synchronous
and performs no external requests.

Registration errors, such as duplicate names or references to unregistered types,
are programming errors detected when building the engine. User queries produce
structured diagnostics. Known language features without executable registrations
must fail explicitly rather than silently broadening the selection.

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

Test-only functions demonstrate nested typed composition and asynchronous
resolution. Verify registration invariants, full-tree validation before resolution,
nested function compatibility, Boolean composition, registry isolation, and
serializable capability descriptions.
