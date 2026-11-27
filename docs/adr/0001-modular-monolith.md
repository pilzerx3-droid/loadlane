# ADR 0001: Modular monolith

Status: Accepted

Start with a modular monolith (single deployable, separate worker process) instead of microservices. Modules talk through service interfaces and domain events, never through another module's tables. Reason: one team, fast iteration, simple transactions. Split later along module boundaries (worker and tracking ingest first).
