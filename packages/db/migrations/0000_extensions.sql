-- Migration 0000: database extensions only. Business tables start with migration 0001 (P1-04).
-- PostGIS provides geography/geometry types for locations, routes and positions (ADR 0006).
CREATE EXTENSION IF NOT EXISTS postgis;
