# README media

Scripts that produce the GIFs and screenshots in `docs/media`. They run against an **isolated demo
instance** (its own database, login disabled) so no real data or credentials appear in the media.

Requirements: Docker, Node 20+, Python 3, ffmpeg and Microsoft Edge (Playwright drives the installed Edge,
so no browser download is needed; set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` when installing).

```bash
# 1. demo instance on :8095 (uses the lajurops:latest image built by docker compose)
docker network create lajurops-demo
docker run -d --name lajurops-demo-db --network lajurops-demo -e POSTGRES_USER=planner -e POSTGRES_PASSWORD=planner -e POSTGRES_DB=planner postgres:16-alpine
docker run -d --name lajurops-demo-app --network lajurops-demo -p 8095:8080 -e AUTH_DISABLED=true \
  -e "DATABASE_URL=postgres://planner:planner@lajurops-demo-db:5432/planner?sslmode=disable" lajurops:latest

# 2. demo data: a product team building an app (dates are fixed around 2026-09-30; adjust seed.py for other "today"s)
python seed.py > ws.txt   # prints the APP workspace id

# 3. record (all scenarios, or name some: board projects timeline calendar create-task comments workload backup)
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
node record.mjs $(cat ws.txt)
for n in board projects timeline calendar create-task comments workload backup; do ./make-gif.sh $n; done
node shots.mjs $(cat ws.txt)   # hero + sign-in (the sign-in page needs the Keycloak-enabled app on :8080)

# 4. copy gifs/*.gif and shots/{hero-timeline,sign-in}.png into docs/media, then clean up
docker rm -f lajurops-demo-app lajurops-demo-db && docker network rm lajurops-demo
```

Recordings use the DevTools screencast (frame timestamps are kept, so pauses play back at real speed) and
ffmpeg with a 128-colour palette at 960px/12 fps. Scenarios change the demo data (e.g. drag a card), so
reset the demo database before re-recording everything.
