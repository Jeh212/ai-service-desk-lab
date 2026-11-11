# AI Service Desk Lab — developer commands.
# macOS/Linux with Docker, Python (uv) and Node installed.

API_DIR := apps/api
WEB_DIR := apps/web
DATASET ?= service_desk_v1.json
PROVIDER ?= mock

.PHONY: help install up down logs seed reset api web test lint fmt eval build-web stop clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install backend (uv) and frontend (npm) dependencies
	cd $(API_DIR) && uv sync --extra dev
	cd $(WEB_DIR) && npm install

up: ## Start MongoDB (Docker)
	docker compose up -d mongodb

down: ## Stop all containers
	docker compose down

logs: ## Tail MongoDB logs
	docker compose logs -f mongodb

seed: ## Populate MongoDB with demo data (idempotent)
	cd $(API_DIR) && uv run asdl-seed

reset: ## Clear all collections and re-seed
	cd $(API_DIR) && uv run asdl-reset

api: ## Run the FastAPI backend (reload) on :8000
	cd $(API_DIR) && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

web: ## Run the Next.js frontend on :3000
	cd $(WEB_DIR) && npm run dev

test: ## Run backend tests (offline, mock provider)
	cd $(API_DIR) && uv run pytest -q

lint: ## Lint + format-check backend; typecheck frontend
	cd $(API_DIR) && uv run ruff check . && uv run ruff format --check .
	cd $(WEB_DIR) && npm run typecheck

fmt: ## Auto-format backend code
	cd $(API_DIR) && uv run ruff format . && uv run ruff check --fix .

eval: ## Run an evaluation dataset (DATASET=.. PROVIDER=mock|groq)
	cd $(API_DIR) && uv run asdl-eval --dataset $(DATASET) --provider $(PROVIDER)

build-web: ## Production build of the frontend (typecheck)
	cd $(WEB_DIR) && npm run build

stop: ## Stop local dev servers started outside make
	-pkill -f "uvicorn app.main:app" 2>/dev/null || true
	-pkill -f "next dev" 2>/dev/null || true

clean: ## Remove caches and reports
	rm -rf $(API_DIR)/reports $(API_DIR)/.pytest_cache $(API_DIR)/.ruff_cache $(WEB_DIR)/.next
