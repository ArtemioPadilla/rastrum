# Rastrum — developer workflow targets.
#
# Loads secrets from .env.local (gitignored). Run `cp .env.example .env.local`
# first, then fill in values. `make help` lists every target.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Load .env.local if present, export every variable for recipes.
ifneq (,$(wildcard .env.local))
  include .env.local
  export
endif

# Paths
SCHEMA          := docs/specs/infra/supabase-schema.sql
MIGRATIONS_DIR  := docs/specs/infra
MODULES_DIR     := docs/specs/modules

# Guard: fail fast if a required env var is missing.
define require_env
	@if [ -z "$${$(1)}" ]; then \
	  echo "✗ $(1) is not set. Copy .env.example → .env.local and fill it in."; \
	  exit 1; \
	fi
endef

# ───────────────────────────────────────────────── help
.PHONY: help
help: ## Show this help
	@echo "Rastrum — make targets"
	@echo ""
	@awk 'BEGIN { FS = ":.*?## "; OFS = "" } \
	     /^[a-zA-Z_-]+:.*?## / { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 } \
	     /^## / { printf "\n\033[1m%s\033[0m\n", substr($$0, 4) }' $(MAKEFILE_LIST)
	@echo ""

## Dev server
.PHONY: dev build preview install
install: ## Install npm dependencies
	npm ci

dev: ## Start Astro dev server (http://localhost:4321)
	npm run dev

build: ## Build static site into dist/
	npm run build

preview: build ## Build then preview the built site
	npm run preview

## Database — Supabase
.PHONY: db-ping db-apply db-verify db-reset-local db-diff db-psql db-tables db-policies db-triggers
db-ping: ## Verify connection to Supabase
	$(call require_env,SUPABASE_DB)
	@psql "$$SUPABASE_DB" -c "SELECT now(), current_database(), current_user, version();"

db-apply: ## Apply the canonical schema to Supabase
	$(call require_env,SUPABASE_DB)
	@echo "Applying $(SCHEMA) …"
	@psql "$$SUPABASE_DB" -v ON_ERROR_STOP=1 -f $(SCHEMA)
	@echo "✓ Schema applied"

db-seed-badges: ## Seed the badges catalogue (idempotent)
	$(call require_env,SUPABASE_DB)
	@psql "$$SUPABASE_DB" -v ON_ERROR_STOP=1 -f $(MIGRATIONS_DIR)/seed-badges.sql
	@echo "✓ Badges seeded"

db-verify: ## Verify tables, RLS, triggers, extensions are in place
	$(call require_env,SUPABASE_DB)
	@echo "── Tables ──"
	@psql "$$SUPABASE_DB" -At -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('users','taxa','observations','identifications','media_files','taxon_usage_history') ORDER BY tablename;"
	@echo ""
	@echo "── RLS enabled ──"
	@psql "$$SUPABASE_DB" -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('users','taxa','observations','identifications','media_files') ORDER BY tablename;"
	@echo "── Triggers ──"
	@psql "$$SUPABASE_DB" -At -c "SELECT tgname FROM pg_trigger WHERE tgname IN ('sync_primary_id_trigger','update_obs_count_trigger','on_auth_user_created') ORDER BY tgname;"
	@echo ""
	@echo "── Extensions ──"
	@psql "$$SUPABASE_DB" -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('uuid-ossp','postgis','pgcrypto','pg_stat_statements') ORDER BY extname;"

db-psql: ## Open an interactive psql shell to Supabase
	$(call require_env,SUPABASE_DB)
	@psql "$$SUPABASE_DB"

db-tables: ## List all public tables with row counts (fast estimate)
	$(call require_env,SUPABASE_DB)
	@psql "$$SUPABASE_DB" -c "\
	  SELECT schemaname, relname AS table, n_live_tup AS rows \
	  FROM pg_stat_user_tables \
	  WHERE schemaname='public' \
	  ORDER BY relname;"

db-policies: ## List all RLS policies on public schema
	$(call require_env,SUPABASE_DB)
	@psql "$$SUPABASE_DB" -c "\
	  SELECT tablename, policyname, cmd, permissive \
	  FROM pg_policies \
	  WHERE schemaname='public' \
	  ORDER BY tablename, policyname;"

db-triggers: ## List all triggers on public schema
	$(call require_env,SUPABASE_DB)
	@psql "$$SUPABASE_DB" -c "\
	  SELECT event_object_table AS table, trigger_name, event_manipulation, action_timing \
	  FROM information_schema.triggers \
	  WHERE trigger_schema='public' \
	  ORDER BY event_object_table, trigger_name;"

db-reset-local: ## Reset a local Supabase branch (requires supabase CLI)
	@command -v supabase >/dev/null || { echo "Install: brew install supabase/tap/supabase"; exit 1; }
	supabase db reset

db-diff: ## Show drift between local and deployed schema (requires supabase CLI)
	@command -v supabase >/dev/null || { echo "Install: brew install supabase/tap/supabase"; exit 1; }
	supabase db diff --linked

## Docs & checks
.PHONY: lint typecheck test docs-check
lint: ## (Placeholder — wire up eslint once code lands)
	@echo "TODO: eslint in v0.1. No app code yet."

typecheck: ## Typecheck via tsc
	@npx tsc --noEmit

test: ## Run unit tests (vitest)
	npm test

test-coverage: ## Run unit tests with coverage report
	npm run test:coverage

docs-check: ## Verify module index lists every module spec present on disk
	@echo "Specs on disk:"
	@ls $(MODULES_DIR)/*.md 2>/dev/null | xargs -n1 basename
	@echo ""
	@echo "Modules referenced in index:"
	@grep -oE '[0-9]{2}-[a-z-]+\.md' $(MODULES_DIR)/00-index.md | sort -u

## Git helpers
.PHONY: status push
status: ## Short git status
	@git status --short --branch

push: ## Push current branch to origin
	git push origin $$(git rev-parse --abbrev-ref HEAD)
