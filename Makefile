BIN := bin/open-planner
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

.PHONY: build web backend dev-backend dev-web docker up down clean

## build: frontend + single Go binary (bin/open-planner)
build: web backend

web:
	cd web && npm ci --no-audit --no-fund && npm run build && touch dist/.gitkeep

backend:
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o $(BIN) ./cmd/open-planner

## dev-backend: API on :8080 with auth disabled (needs a local Postgres)
dev-backend:
	AUTH_DISABLED=true go run ./cmd/open-planner

## dev-web: Vite dev server on :5173, proxying /api to :8080
dev-web:
	cd web && npm run dev

docker:
	docker build --build-arg VERSION=$(VERSION) -t open-planner:$(VERSION) .

up:
	docker compose up -d --build

down:
	docker compose down

clean:
	rm -rf bin web/dist/assets web/dist/index.html web/dist/favicon.svg
