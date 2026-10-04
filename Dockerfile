# syntax=docker/dockerfile:1

# The web and Go stages run on the build machine and cross-compile, so a
# multi-platform build (linux/amd64 + linux/arm64) needs no emulation.

# 1) Build the React frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2) Build the Go binary with the frontend embedded
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
ARG VERSION=dev
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/lajurops ./cmd/lajurops

# 3) Minimal runtime image: just the single binary
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/lajurops /lajurops
ENV ADDR=:8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/lajurops"]
