# CLI

Run the CLI as `pnpm places` from the repo root, or install it globally:

```bash
pnpm add -g ./packages/cli --global-bin-dir="$HOME/.local/bin"
places --help
```

The CLI reads `~/.config/places/config.yaml`
(or `$XDG_CONFIG_HOME/places/config.yaml`) with a `server:` URL.
`--config PATH` selects another file and `--server URL` overrides the server.
With no config, the CLI defaults to `http://127.0.0.1:5188`.
Data commands print JSON, docs print text,
and errors go to stderr with a nonzero exit.

## Tags

```bash
pnpm places tags create 'type.cafe'
pnpm places tags create 'type.bar' --icon '🍸' --description 'For drinks'
pnpm places tags list
pnpm places tags get ID
pnpm places tags update ID 'type.coffee'
pnpm places tags update ID --icon '' --description ''
pnpm places tags update ID --archive
pnpm places tags update ID --unarchive
pnpm places tags delete ID
```

- Names are globally unique, trimmed, and lowercase.
- Qualified (`type.cafe`) or bare (`favorite`); qualified names have one dot.
- Namespaces must exist before creating or renaming a tag into them.
- Renaming preserves the ID, metadata, and place associations.
- Deleting a tag keeps the places; it removes their associations.
- Archived tags are hidden from lists but keep their names reserved.
- `has[tag]` counts active tags only; wildcards still match archived tags.

## Namespaces

```bash
pnpm places namespace create type --icon '🏷️'
pnpm places ns list
pnpm places ns get ID
pnpm places ns update ID category
pnpm places ns update ID --icon '' --description ''
pnpm places ns delete ID            # add --force if it contains tags
```

Names are unique, trimmed, lowercase, nonempty; colons are reserved.
Renaming rewrites all member tags' prefixes in one transaction.

## Tagging places

```bash
pnpm places tag PLACE_ID attr.nice-bathroom
pnpm places tag PLACE_ID attr.nice-bathroom --notes 'Code 1234'
pnpm places untag PLACE_ID attr.nice-bathroom
```

`tag` ensures the assignment exists;
omit `--notes` to keep the current note or pass `''` to clear it.
`untag` removes the assignment but keeps the place and the shared tag.

## Importing

```bash
pnpm places import 'https://maps.app.goo.gl/...'          # Maps link
pnpm places import 'gmaps:ChIJ...' --wait --tag type.cafe
pnpm places import 'https://www.instagram.com/p/...' --wait
pnpm places search-gmaps 'coffee shops in East Village, NYC'
pnpm places import runs
pnpm places import runs --limit 100
pnpm places import runs JOB_ID
```

Import returns a job ID and `importType` (`gmaps` or `instagram`).
`--wait` polls once per second until completion and prints the result as JSON.
Repeat `--tag` to apply tags, `--notes TEXT` for a place note,
and `--tag-note NAME NOTE` for a per-assignment note.

Supported inputs: `query_place_id`, `q=place_id:...`, `ftid`,
Maps place links with a `data=` payload
(including Takeout exports), and Instagram post/reel URLs.

## Listing and sorting

```bash
pnpm places list
pnpm places list --sort name
pnpm places list --sort recently-recommended
pnpm places list --reference-location 'point(-73.985, 40.726)' --sort distance
pnpm places list --query 'tag[favorite] AND !tag[visited]'
```

Sort orders: `name`, `recently-saved` (default), `recently-recommended`,
and `distance`.
Append `-asc` or `-desc` for direction.
Distance sorting requires `--reference-location`.

## Deleting places

```bash
pnpm places delete PLACE_ID
```

Use a saved place UUID from `list`.
Deletion hides the place from the list and preserves its notes, tags, and sources.
A direct Google Maps import restores the same saved place.

## Sync

```bash
pnpm places sync
pnpm places sync --query 'tag[type.cafe]'
pnpm places sync-status JOB_ID
```

Sync selects places (same query syntax as `list`), queues one job per place,
and refreshes their Google metadata.

## Other commands

```bash
pnpm places docs filter    # print available filters, functions, and examples
```

See [Concepts](concepts.md) for the tags, namespaces, and sources model,
and [Query language](query-language.md) for the filter syntax.
