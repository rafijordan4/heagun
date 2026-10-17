-- Heagun PostgreSQL schema
-- Run this against your SQL Turbo PostgreSQL database.
CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(20) NOT NULL,
  username_key VARCHAR(20) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_results (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mode VARCHAR(10) NOT NULL CHECK (mode IN ('offline', 'online')),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100000),
  duration_seconds INTEGER NOT NULL DEFAULT 60 CHECK (duration_seconds IN (30, 60)),
  opponent_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  match_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_results_mode_score_idx
  ON game_results (mode, score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS game_results_player_mode_idx
  ON game_results (player_id, mode, score DESC);
CREATE INDEX IF NOT EXISTS game_results_match_idx
  ON game_results (match_id);
