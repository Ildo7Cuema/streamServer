-- Migration 005: País/região do artista nos ficheiros de media
-- Permite filtrar a Biblioteca por origem (Angola, Brasil, Portugal, EUA, Espanha,
-- África do Sul, Moçambique, Cabo Verde, ...) usando o código ISO-3166-1 alpha-2.

ALTER TABLE media_files ADD COLUMN IF NOT EXISTS country VARCHAR(2);

CREATE INDEX IF NOT EXISTS idx_media_files_country ON media_files(country);
