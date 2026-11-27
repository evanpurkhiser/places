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
users) PLACES_CONFIG_PATH=/etc/places.yaml exec node src/users.ts "$@" ;;
*)
	echo "Usage: server|worker|migrate|users [--config PATH]" >&2
	exit 1
	;;
esac

exec node "$script" --config /etc/places.yaml "$@"
