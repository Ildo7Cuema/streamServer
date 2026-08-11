-- =============================================================================
-- PostgreSQL Database Initialization - StreamServer
-- =============================================================================
-- Idempotent: safe to run multiple times (Supabase SQL Editor, Docker init, etc.)

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- USERS & AUTHENTICATION
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    auth_user_id UUID UNIQUE,
    display_name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'dj' CHECK (role IN ('admin', 'manager', 'dj', 'viewer')),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT true,
    account_status VARCHAR(20) DEFAULT 'active' CHECK (account_status IN ('active', 'blocked', 'pending')),
    blocked_at TIMESTAMPTZ,
    blocked_reason TEXT,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- STATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS stations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    genre VARCHAR(100),
    logo_url TEXT,
    mountpoint VARCHAR(100) NOT NULL DEFAULT '/live',
    bitrate INTEGER DEFAULT 128,
    format VARCHAR(10) DEFAULT 'mp3' CHECK (format IN ('mp3', 'aac', 'ogg')),
    is_active BOOLEAN DEFAULT true,
    max_listeners INTEGER DEFAULT 500,
    source_password VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- DJ / BROADCASTER PROFILES
-- =============================================================================
CREATE TABLE IF NOT EXISTS dj_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
    dj_name VARCHAR(100) NOT NULL,
    bio TEXT,
    photo_url TEXT,
    source_username VARCHAR(50) DEFAULT 'source',
    source_password VARCHAR(255) NOT NULL,
    allowed_mountpoints TEXT[] DEFAULT ARRAY['/live'],
    last_connected TIMESTAMPTZ,
    last_ip INET,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, station_id)
);

-- =============================================================================
-- PLAYLISTS & MEDIA
-- =============================================================================
CREATE TABLE IF NOT EXISTS playlists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    type VARCHAR(20) DEFAULT 'music' CHECK (type IN ('music', 'jingles', 'ads', 'shows')),
    is_active BOOLEAN DEFAULT true,
    play_order VARCHAR(20) DEFAULT 'shuffle' CHECK (play_order IN ('sequential', 'shuffle', 'weighted')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(500) NOT NULL,
    original_name VARCHAR(500) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    duration REAL,
    format VARCHAR(10),
    bitrate INTEGER,
    sample_rate INTEGER,
    channels INTEGER DEFAULT 2,
    title VARCHAR(500),
    artist VARCHAR(500),
    album VARCHAR(500),
    genre VARCHAR(100),
    year INTEGER,
    cover_art_url TEXT,
    waveform_data JSONB,
    type VARCHAR(20) DEFAULT 'music' CHECK (type IN ('music', 'jingle', 'ad', 'show', 'other')),
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlist_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
    media_file_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    weight INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Metadata history (Liquidsoap/internal + top-tracks stats)
CREATE TABLE IF NOT EXISTS metadata_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    media_file_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    title VARCHAR(500),
    artist VARCHAR(500),
    album VARCHAR(500),
    raw_metadata JSONB DEFAULT '{}',
    played_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SCHEDULE
-- =============================================================================
CREATE TABLE IF NOT EXISTS schedule_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
    dj_profile_id UUID REFERENCES dj_profiles(id) ON DELETE SET NULL,
    playlist_id UUID REFERENCES playlists(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_live BOOLEAN DEFAULT false,
    is_recurring BOOLEAN DEFAULT true,
    color VARCHAR(7) DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- STREAM HISTORY & STATISTICS
-- =============================================================================
CREATE TABLE IF NOT EXISTS stream_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
    dj_profile_id UUID REFERENCES dj_profiles(id) ON DELETE SET NULL,
    mountpoint VARCHAR(100) NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    peak_listeners INTEGER DEFAULT 0,
    total_bytes_sent BIGINT DEFAULT 0,
    source_ip INET
);

CREATE TABLE IF NOT EXISTS listener_stats (
    id BIGSERIAL PRIMARY KEY,
    station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
    mountpoint VARCHAR(100) NOT NULL,
    listener_count INTEGER NOT NULL,
    peak_listeners INTEGER DEFAULT 0,
    bandwidth_kbps REAL DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS track_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
    mountpoint VARCHAR(100) NOT NULL,
    title VARCHAR(500),
    artist VARCHAR(500),
    album VARCHAR(500),
    media_file_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    played_at TIMESTAMPTZ DEFAULT NOW(),
    duration REAL
);

-- =============================================================================
-- RECORDINGS
-- =============================================================================
CREATE TABLE IF NOT EXISTS recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
    stream_session_id UUID REFERENCES stream_sessions(id) ON DELETE SET NULL,
    filename VARCHAR(500) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    duration REAL,
    format VARCHAR(10) DEFAULT 'mp3',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    is_podcast BOOLEAN DEFAULT false,
    podcast_title VARCHAR(500),
    podcast_description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SYSTEM LOGS
-- =============================================================================
CREATE TABLE IF NOT EXISTS system_logs (
    id BIGSERIAL PRIMARY KEY,
    level VARCHAR(10) NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error', 'fatal')),
    source VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_listener_stats_station_time ON listener_stats(station_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_track_history_station_time ON track_history(station_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_station ON stream_sessions(station_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_files_type ON media_files(type);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_station_day ON schedule_slots(station_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_system_logs_level_time ON system_logs(level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, is_active);
CREATE INDEX IF NOT EXISTS idx_metadata_history_station_played ON metadata_history(station_id, played_at DESC);

-- Existing deployments before last_connected / last_ip (idempotent)
ALTER TABLE dj_profiles ADD COLUMN IF NOT EXISTS last_connected TIMESTAMPTZ;
ALTER TABLE dj_profiles ADD COLUMN IF NOT EXISTS last_ip INET;
ALTER TABLE stations ADD COLUMN IF NOT EXISTS source_password VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

-- Supabase Auth integration (optional FK added in infrastructure/supabase/supabase_auth.sql)
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
DO $$
BEGIN
  ALTER TABLE users ADD CONSTRAINT users_password_or_auth_user
    CHECK (password_hash IS NOT NULL OR auth_user_id IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- DEFAULT DATA (skip if already present)
-- =============================================================================

-- Default admin user (password: admin123 - CHANGE IMMEDIATELY)
INSERT INTO users (username, email, password_hash, display_name, role)
VALUES (
    'admin',
    'admin@streamserver.local',
    crypt('admin123', gen_salt('bf', 12)),
    'System Administrator',
    'admin'
)
ON CONFLICT (username) DO NOTHING;

-- Default station (with streaming password)
INSERT INTO stations (name, slug, description, genre, mountpoint, bitrate, format, source_password)
SELECT
    'Main Station',
    'main',
    'StreamServer Main Radio Station',
    'Various',
    '/live',
    128,
    'mp3',
    encode(gen_random_bytes(16), 'base64')
WHERE NOT EXISTS (SELECT 1 FROM stations WHERE slug = 'main');

-- Default playlists (once per station main)
INSERT INTO playlists (station_id, name, description, type)
SELECT s.id, 'Music', 'Main music rotation', 'music'
FROM stations s WHERE s.slug = 'main'
AND NOT EXISTS (SELECT 1 FROM playlists p WHERE p.station_id = s.id AND p.name = 'Music');

INSERT INTO playlists (station_id, name, description, type)
SELECT s.id, 'Jingles', 'Station jingles and IDs', 'jingles'
FROM stations s WHERE s.slug = 'main'
AND NOT EXISTS (SELECT 1 FROM playlists p WHERE p.station_id = s.id AND p.name = 'Jingles');

INSERT INTO playlists (station_id, name, description, type)
SELECT s.id, 'Advertisements', 'Commercial breaks', 'ads'
FROM stations s WHERE s.slug = 'main'
AND NOT EXISTS (SELECT 1 FROM playlists p WHERE p.station_id = s.id AND p.name = 'Advertisements');

-- =============================================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_stations_updated_at ON stations;
CREATE TRIGGER trg_stations_updated_at BEFORE UPDATE ON stations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_dj_profiles_updated_at ON dj_profiles;
CREATE TRIGGER trg_dj_profiles_updated_at BEFORE UPDATE ON dj_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_playlists_updated_at ON playlists;
CREATE TRIGGER trg_playlists_updated_at BEFORE UPDATE ON playlists FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_media_files_updated_at ON media_files;
CREATE TRIGGER trg_media_files_updated_at BEFORE UPDATE ON media_files FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_schedule_slots_updated_at ON schedule_slots;
CREATE TRIGGER trg_schedule_slots_updated_at BEFORE UPDATE ON schedule_slots FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION get_listener_stats_hourly(
    p_station_id UUID,
    p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    hour TIMESTAMPTZ,
    avg_listeners NUMERIC,
    max_listeners INTEGER,
    min_listeners INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        date_trunc('hour', ls.recorded_at) AS hour,
        ROUND(AVG(ls.listener_count), 1) AS avg_listeners,
        MAX(ls.listener_count) AS max_listeners,
        MIN(ls.listener_count) AS min_listeners
    FROM listener_stats ls
    WHERE ls.station_id = p_station_id
        AND ls.recorded_at >= NOW() - (p_hours || ' hours')::INTERVAL
    GROUP BY date_trunc('hour', ls.recorded_at)
    ORDER BY hour DESC;
END;
$$ LANGUAGE plpgsql;

-- Local dev: grant app role access when streamadmin exists (Postgres.app / manual setup)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'streamadmin') THEN
    GRANT ALL ON SCHEMA public TO streamadmin;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO streamadmin;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO streamadmin;
    GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO streamadmin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO streamadmin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO streamadmin;
  END IF;
END
$$;
