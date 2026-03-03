.PHONY: up down build restart logs logs-backend logs-frontend ps clean db-shell \
       prod prod-build prod-down prod-logs prod-ps ssl-init ssl-renew

# -- Primary commands ------------------------------------------------------

up:                    ## Start all services
	docker compose up -d

up-build:              ## Build and start all services
	docker compose up -d --build

down:                  ## Stop all services
	docker compose down

restart:               ## Restart all services
	docker compose restart

build:                 ## Build all images
	docker compose build

# -- Logs ------------------------------------------------------------------

logs:                  ## Tail logs for all services
	docker compose logs -f

logs-backend:          ## Tail backend logs
	docker compose logs -f backend

logs-frontend:         ## Tail frontend logs
	docker compose logs -f frontend

logs-db:               ## Tail database logs
	docker compose logs -f db

# -- Status ----------------------------------------------------------------

ps:                    ## Show running services
	docker compose ps

health:                ## Check health of all services
	@docker compose ps --format "table {{.Name}}\t{{.Status}}"

# -- Shell access ----------------------------------------------------------

shell-backend:         ## Open shell in backend container
	docker compose exec backend bash

shell-frontend:        ## Open shell in frontend container
	docker compose exec frontend sh

db-shell:              ## Open psql shell
	docker compose exec db psql -U weave -d weave

# -- Production ------------------------------------------------------------

PROD_COMPOSE = docker compose --env-file .env.production -f docker-compose.prod.yml

prod:                  ## Start production services
	$(PROD_COMPOSE) up -d

prod-build:            ## Build and start production services
	$(PROD_COMPOSE) up -d --build

prod-down:             ## Stop production services
	$(PROD_COMPOSE) down

prod-logs:             ## Tail production logs
	$(PROD_COMPOSE) logs -f

prod-ps:               ## Show production service status
	$(PROD_COMPOSE) ps

ssl-init:              ## Issue SSL certificate (run once after domain DNS is set)
	$(PROD_COMPOSE) run --rm certbot certonly \
		--webroot --webroot-path=/var/www/certbot \
		--email $${CERTBOT_EMAIL} --agree-tos --no-eff-email \
		-d $${DOMAIN}

ssl-renew:             ## Renew SSL certificate
	$(PROD_COMPOSE) run --rm certbot renew

# -- Cleanup ---------------------------------------------------------------

clean:                 ## Stop services and remove volumes
	docker compose down -v

clean-all:             ## Stop services, remove volumes and images
	docker compose down -v --rmi local

# -- Help ------------------------------------------------------------------

help:                  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
