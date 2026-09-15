FROM golang:1.26-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/fiber-api .

FROM alpine:3.22

RUN adduser -D -H appuser
COPY --from=build /out/fiber-api /usr/local/bin/fiber-api

USER appuser
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/fiber-api"]
