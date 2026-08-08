-- 001_extensiones.sql
-- Extensiones necesarias: PostGIS para geometrias y unaccent/pg_trgm para busqueda.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
