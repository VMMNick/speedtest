-- Анонімні результати тестів. IP-адреси НЕ зберігаються.
CREATE TABLE IF NOT EXISTS results (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  server         TEXT        NOT NULL,
  download_mbps  REAL        NOT NULL CHECK (download_mbps >= 0),
  upload_mbps    REAL        NOT NULL CHECK (upload_mbps >= 0),
  ping_ms        REAL        NOT NULL CHECK (ping_ms >= 0),
  jitter_ms      REAL        NOT NULL CHECK (jitter_ms >= 0),
  loss_pct       REAL        NOT NULL CHECK (loss_pct BETWEEN 0 AND 100),
  grade          CHAR(1)     NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D', 'F')),
  score          SMALLINT    NOT NULL CHECK (score BETWEEN 0 AND 100),
  bufferbloat_ms REAL                 CHECK (bufferbloat_ms >= 0),
  isp            TEXT,
  city           TEXT,
  country        CHAR(2),
  light_mode     BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS results_created_at_idx ON results (created_at DESC);
CREATE INDEX IF NOT EXISTS results_isp_idx ON results (isp) WHERE isp IS NOT NULL;
CREATE INDEX IF NOT EXISTS results_city_idx ON results (city) WHERE city IS NOT NULL;
