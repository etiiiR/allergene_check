FROM node:24.21.0-alpine3.24 AS frontend
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.27.1-alpine3.24 AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/fiber-api .

FROM alpine:3.24.2

RUN adduser -D -H appuser
COPY --from=build /out/fiber-api /usr/local/bin/fiber-api
WORKDIR /app
COPY --from=frontend /web/dist ./web/dist

USER appuser
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/fiber-api"]
