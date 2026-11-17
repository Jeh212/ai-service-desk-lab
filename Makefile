# AI Service Desk Lab — Node.js 22+, npm and Docker.
API_DIR := apps/api
WEB_DIR := apps/web
DATASET ?= service_desk_v1.json
PROVIDER ?= mock

.PHONY: help install up down logs seed reset api web test test-mongo lint fmt eval build-api build-web stop clean
help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'
install: ## Install locked backend and frontend dependencies
	npm ci --prefix $(API_DIR)
	npm ci --prefix $(WEB_DIR)
up: ## Start MongoDB
	docker compose up -d mongodb
down: ## Stop containers
	docker compose down
logs: ## Tail MongoDB logs
	docker compose logs -f mongodb
seed: ## Populate MongoDB with demo data
	npm run seed --prefix $(API_DIR)
reset: ## Clear application collections and re-seed
	npm run reset --prefix $(API_DIR)
api: ## Run TypeScript API with watch mode on :8000
	npm run dev --prefix $(API_DIR)
web: ## Run Next.js frontend on :3000
	npm run dev --prefix $(WEB_DIR)
test: ## Run offline backend tests
	npm test --prefix $(API_DIR)
test-mongo: ## Test real MongoDB using TEST_MONGO_URI (disposable database)
	npm run test:mongo --prefix $(API_DIR)
lint: ## Typecheck/format-check API and typecheck frontend
	npm run lint --prefix $(API_DIR)
	npm run typecheck --prefix $(WEB_DIR)
fmt: ## Format TypeScript backend and tests
	npm run format --prefix $(API_DIR)
eval: ## Evaluate DATASET with PROVIDER=mock|groq
	npm run eval --prefix $(API_DIR) -- --dataset $(DATASET) --provider $(PROVIDER)
build-api: ## Compile production API to apps/api/dist
	npm run build --prefix $(API_DIR)
build-web: ## Production frontend build
	npm run build --prefix $(WEB_DIR)
stop: ## Stop local development servers
	-pkill -f "node --watch --import tsx src/server.ts" 2>/dev/null || true
	-pkill -f "next dev" 2>/dev/null || true
clean: ## Remove generated builds and reports
	rm -rf reports $(API_DIR)/dist $(WEB_DIR)/.next
