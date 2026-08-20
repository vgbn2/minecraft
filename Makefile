.PHONY: build test vet atlas-check atlas-sync verify

build:
	./tools/go.sh go build -o dist/mcctl ./cmd/mcctl

test:
	./tools/go.sh go test ./...

vet:
	./tools/go.sh go vet ./...

atlas-check:
	./tools/go.sh go run ./cmd/mcctl atlas check --root .

atlas-sync:
	./tools/go.sh go run ./cmd/mcctl atlas sync --root .

verify: test vet build atlas-check
	docker compose config --quiet
	./tools/go.sh go run ./cmd/mcctl config validate --file examples/mcctl.config.json
	./tools/go.sh go run ./cmd/mcctl profile validate --file examples/profiles/paper-1.21.11-standard.json
	./tools/go.sh go run ./cmd/mcctl profile validate --file examples/profiles/fabric-1.21.11-standard.json
	git diff --check
