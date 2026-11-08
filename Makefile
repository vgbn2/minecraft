.PHONY: build test vet atlas-check atlas-sync verify

build:
	./tools/go.sh go build -o dist/mc-control ./cmd/mc-control
	ln -sf mc-control dist/mcctl

test:
	./tools/go.sh go test ./...

vet:
	./tools/go.sh go vet ./...

atlas-check:
	./tools/go.sh go run ./cmd/mc-control atlas check --root .

atlas-sync:
	./tools/go.sh go run ./cmd/mc-control atlas sync --root .

verify: test vet build atlas-check
	docker compose config --quiet
	./tools/go.sh go run ./cmd/mc-control config validate --file examples/mc-control.config.json
	./tools/go.sh go run ./cmd/mc-control profile validate --file examples/profiles/paper-1.21.11-standard.json
	./tools/go.sh go run ./cmd/mc-control profile validate --file examples/profiles/fabric-1.21.11-standard.json
	git diff --check
