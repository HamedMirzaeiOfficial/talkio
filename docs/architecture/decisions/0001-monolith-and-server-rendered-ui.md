# ADR 0001: Keep a Django Monolith with a React Client

## Status

Accepted

## Decision

Keep Django as a monolith/API and use a separate React/Vite client for the product UI. Use Channels for live updates and keep domain logic in Django application services rather than introducing backend microservices.

## Rationale

The existing backend remains a strong base for the portfolio, while a dedicated client gives the messaging workspace a proper application boundary and richer interaction model.

## Consequences

The project gains a frontend build and a CORS/CSRF boundary. API and event contracts must be explicit, but backend deployment remains a single Django service plus its data dependencies.
