-- Стан провайдерів: знімок останньої перевірки (фонова задача provider-status, BullMQ)
CREATE TABLE IF NOT EXISTS provider_status (
  isp               TEXT        PRIMARY KEY,
  status            TEXT        NOT NULL CHECK (status IN ('ok', 'degraded', 'unknown')),
  -- Медіани за останні години («зараз») і за базовий період («як зазвичай»)
  recent_download   REAL,
  baseline_download REAL,
  recent_ping       REAL,
  baseline_ping     REAL,
  recent_samples    INT         NOT NULL,
  baseline_samples  INT         NOT NULL,
  checked_at        TIMESTAMPTZ NOT NULL,
  -- Відколи триває поточний стан
  since             TIMESTAMPTZ NOT NULL
);

-- Інциденти: період, коли провайдер був помітно повільнішим, ніж зазвичай
CREATE TABLE IF NOT EXISTS provider_incidents (
  id                BIGSERIAL   PRIMARY KEY,
  isp               TEXT        NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,
  reasons           TEXT[]      NOT NULL,
  recent_download   REAL,
  baseline_download REAL,
  recent_ping       REAL,
  baseline_ping     REAL,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Не більше одного відкритого інциденту на провайдера
CREATE UNIQUE INDEX IF NOT EXISTS provider_incidents_open_idx ON provider_incidents (isp) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS provider_incidents_started_idx ON provider_incidents (started_at DESC);

-- Вибірка «провайдер за останні N годин» для перевірки стану
CREATE INDEX IF NOT EXISTS results_isp_created_idx ON results (isp, created_at DESC) WHERE isp IS NOT NULL;
