#!/bin/sh
set -eu

command=${1:-server}
if [ "$#" -gt 0 ]; then
	shift
fi

case "$command" in
server)
	node src/db/migrate.ts --config /etc/places.yaml "$@"
	script=src/main.ts
	;;
worker) script=src/worker.ts ;;
migrate) script=src/db/migrate.ts ;;
*)
	echo "Usage: server|worker|migrate [--config PATH]" >&2
	exit 1
	;;
esac

exec node "$script" --config /etc/places.yaml "$@"
