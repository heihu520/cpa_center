FROM node:22-bookworm AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.24-bookworm AS go-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -tags web -ldflags="-s -w" -o /out/cpa-control-center-web .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV CPA_DATA_DIR=/data \
    CPA_WEB_ADDR=0.0.0.0:8080
COPY --from=go-builder /out/cpa-control-center-web /usr/local/bin/cpa-control-center-web
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/cpa-control-center-web"]
