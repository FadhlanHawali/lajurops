#!/bin/sh
# Upgrade (or restart) the app replicas of docker-compose.ha.yml without
# downtime: start the new version next to the old one, wait until every new
# replica is ready, then stop the old ones (they finish their requests first).
#
#   LAJUROPS_VERSION=0.6.0 deploy/rolling-update.sh     # upgrade to a release
#   deploy/rolling-update.sh                            # replace with a fresh pull of the current tag
#
# Uses COMPOSE_FILE like docker compose does (default docker-compose.ha.yml;
# list several, e.g. with your overrides, separated by ":" on Linux/macOS or
# ";" on Windows). SKIP_PULL=1 uses an image that's already on the host.
set -eu

export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ha.yml}"
compose() { docker compose "$@"; }

old=$(compose ps -q app | tr '\n' ' ')
count=$(echo $old | wc -w)
if [ "$count" -eq 0 ]; then
  echo "No app replicas are running; start the stack first with: docker compose up -d (COMPOSE_FILE=$COMPOSE_FILE)" >&2
  exit 1
fi
proxy=$(compose ps -q proxy)

[ "${SKIP_PULL:-}" = 1 ] || compose pull app

echo "Starting $count new replica(s) next to the $count running..."
compose up -d --no-deps --no-recreate --scale "app=$((count * 2))" app

new=""
for c in $(compose ps -q app); do
  case " $old " in
  *" $c "*) ;;
  *) new="$new $c" ;;
  esac
done
if [ -z "$new" ]; then
  echo "No new replicas were started." >&2
  exit 1
fi

# Wait for each new replica's /readyz (asked from the proxy's network).
for c in $new; do
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$c" | awk '{print $1}')
  name=$(docker inspect -f '{{.Name}}' "$c" | sed 's|^/||')
  printf 'Waiting for %s to be ready' "$name"
  tries=0
  until docker exec "$proxy" wget -qO- -T 2 "http://$ip:8080/readyz" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -gt 120 ]; then
      echo " gave up after 2 minutes; the old replicas keep running. See: docker logs $name" >&2
      exit 1
    fi
    printf '.'
    sleep 1
  done
  echo " ready"
done

# Give the proxy a moment to see the new replicas, then retire the old ones.
sleep 6
echo "Stopping the old replica(s)..."
for c in $old; do
  docker stop -t 15 "$c" >/dev/null
  docker rm "$c" >/dev/null
done
compose up -d --no-deps --no-recreate --scale "app=$count" app >/dev/null
echo "Done: $count replica(s) on $(docker inspect -f '{{.Config.Image}}' "$(compose ps -q app | head -n 1)")."
