# syntax=docker/dockerfile:1

# 1) Build the React frontend
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2) Build the Go binary with the frontend embedded
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/open-planner ./cmd/open-planner

# 3) Minimal runtime image: just the single binary
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/open-planner /open-planner
ENV ADDR=:8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/open-planner"]
