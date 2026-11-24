# Concepts

## Places

A place has a UUID (internal identity) and a unique Google Place ID
(provider identity).
Each place carries `coordinates`, `name`, `address`, `timeZone`,
`businessStatus`, `googleMetadata`, `hoursWeeklyOpen`, and `lastSync`,
plus `tags` and `sources` arrays.

## Tags

Tags are labels attached to places.
Names are qualified (`type.cafe`) or bare (`favorite`):

- Globally unique, trimmed, and lowercase.
- A qualified name has exactly one dot with nonempty namespace
  and local-name parts.
- A bare name has no namespace.
- Renaming preserves the tag's ID, metadata, and place associations.
- Deleting a tag removes its place associations but preserves the places.
- Archiving hides a tag from lists while keeping its name reserved.

## Namespaces

Namespaces group tags; `type.cafe` lives in the `type` namespace.
Names are unique, trimmed, lowercase, and nonempty; colons are reserved.
Renaming a namespace rewrites all member tags' prefixes in one transaction.
Deleting a namespace that contains tags requires `--force`.

## Sources

A source records where you discovered a place —
an Instagram post or a Google Maps import.
A place can have multiple sources, so you can revisit every recommendation,
including separate Instagram posts about the same spot.

## Design docs

The `design/` directory holds product and technical specs,
including the query grammar, filter engine, hours representation,
and source model.
