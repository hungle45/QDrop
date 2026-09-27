.PHONY: build test lint run clean dev docker-build docker-run docker-stop docker-push

# === Variables ===

PORT ?= 8080
IMG  ?= qdrop
TAG  ?= latest

# === Standard targets ===

build:
	npm run build

test:
	npm run test

lint:
	npm run lint

dev:
	npm run dev

clean:
	rm -rf dist node_modules

run:
	npm run dev

# === Docker targets ===

docker-build:
	@echo "Building Docker image $(IMG):$(TAG) ..."
	docker build -t $(IMG):$(TAG) .

docker-run: docker-build
	@docker rm -f $(IMG) 2>/dev/null || true
	@echo "Starting container on port $(PORT) ..."
	docker run -d --name $(IMG) -p $(PORT):80 $(IMG):$(TAG)
	@echo "App running at http://localhost:$(PORT)/"

docker-stop:
	@docker rm -f $(IMG) 2>/dev/null || echo "Container $(IMG) not running."

docker-push:
	@test -n "$(REGISTRY)" || (echo "Usage: make docker-push REGISTRY=<registry-url>" && exit 1)
	docker tag $(IMG):$(TAG) $(REGISTRY)/$(IMG):$(TAG)
	docker push $(REGISTRY)/$(IMG):$(TAG)