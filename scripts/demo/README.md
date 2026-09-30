# README media

Scripts that produce the GIFs and screenshots in `docs/media`. They run against an **isolated demo
instance** (its own database, login disabled) so no real data or credentials appear in the media.

Requirements: Docker, Node 20+, Python 3, ffmpeg and Microsoft Edge (Playwright drives the installed Edge,
so no browser download is needed; set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` when installing).

```bash
# 1. demo instance on :8095 (uses the open-planner:latest image built by docker compose)
docker network create opdemo
docker run -d --name opdemo-db --network opdemo -e POSTGRES_USER=planner -e POSTGRES_PASSWORD=planner -e POSTGRES_DB=planner postgres:16-alpine
docker run -d --name opdemo-app --network opdemo -p 8095:8080 -e AUTH_DISABLED=true \
  -e "DATABASE_URL=postgres://planner:planner@opdemo-db:5432/planner?sslmode=disable" open-planner:latest

# 2. demo data (dates are fixed around 2026-09-30; adjust seed.py for other "today"s)
python seed.py

# 3. record (all scenarios, or name some: board projects timeline calendar create-task comments workload backup)
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
node record.mjs <OPS workspace id>
for n in board projects timeline calendar create-task comments workload backup; do ./make-gif.sh $n; done
node shots.mjs <OPS workspace id>   # hero + sign-in (the sign-in page needs the Keycloak-enabled app on :8080)

# 4. copy gifs/*.gif and shots/{hero-timeline,sign-in}.png into docs/media, then clean up
docker rm -f opdemo-app opdemo-db && docker network rm opdemo
```

Recordings use the DevTools screencast (frame timestamps are kept, so pauses play back at real speed) and
ffmpeg with a 128-colour palette at 960px/12 fps. Scenarios change the demo data (e.g. drag a card), so
reset the demo database before re-recording everything.
