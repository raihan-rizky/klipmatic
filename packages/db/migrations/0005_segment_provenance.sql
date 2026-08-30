ALTER TABLE media_segments ADD COLUMN IF NOT EXISTS is_fixture boolean NOT NULL DEFAULT false;
