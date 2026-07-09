-- =============================================================================
-- Telemetry ETL: winston_logs → provider_telemetry_events
-- =============================================================================
-- Run the ENTIRE file. Line 1 clears any stuck/aborted transaction (DBeaver/psql).
-- =============================================================================

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 1. Prep schema (no transaction wrapper — avoids 25P02 cascade)
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_provider_telemetry_timeline;
DROP VIEW IF EXISTS v_provider_telemetry_flows;

CREATE TABLE IF NOT EXISTS provider_telemetry_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              VARCHAR(128) NOT NULL,
    question_id             VARCHAR(128) NOT NULL,
    step_sequence           SMALLINT     NOT NULL,
    service_name            VARCHAR(64)  NOT NULL,
    event_type              VARCHAR(64)  NOT NULL,
    beckn_transaction_id    VARCHAR(128),
    endpoint_url            TEXT,
    http_status             SMALLINT,
    latency_ms              INTEGER,
    success                 BOOLEAN,
    error_message           TEXT,
    request_payload         JSONB,
    response_payload        JSONB,
    event_mid               VARCHAR(128),
    event_timestamp         TIMESTAMPTZ  NOT NULL,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pte_event_mid UNIQUE (event_mid),
    CONSTRAINT chk_pte_event_type CHECK (
        event_type IN (
            'flow_start', 'beckn_inbound', 'ext_api_call',
            'internal_step', 'beckn_outbound', 'flow_end', 'error'
        )
    )
);

ALTER TABLE provider_telemetry_events
    DROP COLUMN IF EXISTS direction;

CREATE TABLE IF NOT EXISTS telemetry_etl_state (
    id                SMALLINT PRIMARY KEY DEFAULT 1,
    last_processed_at TIMESTAMPTZ,
    last_run_at       TIMESTAMPTZ,
    rows_inserted     BIGINT DEFAULT 0,
    CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO telemetry_etl_state (id, last_processed_at)
VALUES (1, '1970-01-01'::TIMESTAMPTZ)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE VIEW v_provider_telemetry_flows AS
SELECT
    question_id,
    session_id,
    MAX(service_name)                                              AS service_name,
    MAX(request_payload->>'route_name')                            AS route_name,
    MAX(beckn_transaction_id)                                      AS beckn_transaction_id,
    MAX(request_payload->'beckn'->>'domain')                       AS beckn_domain,
    MAX(request_payload->'beckn'->>'action')                       AS beckn_action,
    MIN(event_timestamp) FILTER (WHERE event_type = 'flow_start')  AS flow_started_at,
    MAX(event_timestamp) FILTER (WHERE event_type = 'flow_end')    AS flow_ended_at,
    MAX(latency_ms)      FILTER (WHERE event_type = 'flow_end')    AS duration_ms,
    BOOL_AND(success)    FILTER (WHERE event_type = 'flow_end')    AS success,
    MAX(error_message)   FILTER (WHERE event_type IN ('flow_end', 'error')) AS error_message,
    COUNT(*)                                                       AS total_events,
    COUNT(*) FILTER (WHERE event_type = 'ext_api_call')            AS ext_api_count,
    SUM(latency_ms)  FILTER (WHERE event_type = 'ext_api_call')    AS ext_api_total_ms,
    (jsonb_agg(request_payload)  FILTER (WHERE event_type = 'beckn_inbound'))->0  AS beckn_request,
    (jsonb_agg(response_payload) FILTER (WHERE event_type = 'beckn_inbound'))->0  AS beckn_response,
    jsonb_agg(
        jsonb_build_object(
            'step',       step_sequence,
            'type',       event_type,
            'endpoint',   endpoint_url,
            'host',       request_payload->>'host',
            'service',    request_payload->>'downstream_service',
            'status',     http_status,
            'latency_ms', latency_ms,
            'success',    success
        )
        ORDER BY step_sequence
    ) FILTER (WHERE event_type = 'ext_api_call') AS external_api_calls
FROM provider_telemetry_events
GROUP BY question_id, session_id;

-- ---------------------------------------------------------------------------
-- 2. ETL run (single statement — auto-commits on success)
-- ---------------------------------------------------------------------------
WITH etl_state AS (
    SELECT COALESCE(last_processed_at, '1970-01-01'::TIMESTAMPTZ) AS watermark
    FROM telemetry_etl_state
    WHERE id = 1
),
parsed_logs AS (
    SELECT wl.timestamp AS winston_timestamp, wl.message AS raw_message
    FROM winston_logs wl
    CROSS JOIN etl_state es
    WHERE wl.timestamp > es.watermark
      AND wl.message IS NOT NULL
      AND left(btrim(wl.message), 1) = '{'
),
raw_events AS (
    SELECT
        pl.winston_timestamp,
        evt AS raw_event,
        NULLIF(btrim(evt->>'mid'), '') AS event_mid,
        evt->>'eid' AS oe_eid,
        COALESCE(NULLIF(evt->>'sid', ''), evt->'context'->>'session_id') AS session_id,
        COALESCE(NULLIF(evt->>'qid', ''), evt->'context'->>'question_id') AS question_id,
        evt->'context' AS beckn_ctx,
        evt->'edata' AS edata,
        evt->'edata'->'eks'->'target' AS flow_target,
        COALESCE(
            evt->'edata'->'eks'->'target'->'networkApiDetails'->>'service_name',
            evt->'edata'->'eks'->'target'->>'service_name',
            evt->'gdata'->>'id',
            evt->'context'->>'service_name',
            evt->'edata'->'eks'->'target'->'networkApiDetails'->'input'->>'use_case',
            evt->'edata'->>'service_name',
            'unknown'
        ) AS service_name,
        LOWER(COALESCE(
            evt->'edata'->'eks'->>'type',
            evt->'edata'->>'type',
            evt->'edata'->'eks'->'target'->'networkApiDetails'->>'type',
            'other'
        )) AS edata_type,
        evt->'edata'->'eks'->'target'->'networkApiDetails' AS net,
        CASE
            WHEN evt->>'ets' ~ '^[0-9]+$'
            THEN to_timestamp((evt->>'ets')::BIGINT / 1000.0)
            ELSE pl.winston_timestamp
        END AS event_timestamp
    FROM parsed_logs pl
    CROSS JOIN LATERAL json_array_elements(
        CASE
            WHEN json_typeof(pl.raw_message::json->'events') = 'array'
            THEN pl.raw_message::json->'events'
            ELSE '[]'::json
        END
    ) AS evt
    WHERE (pl.raw_message::json)->>'id' = 'ekstep.telemetry'
      AND evt->>'eid' IN ('OE_START', 'OE_ITEM_RESPONSE', 'OE_END')
      AND COALESCE(NULLIF(evt->>'qid', ''), evt->'context'->>'question_id') IS NOT NULL
      AND COALESCE(NULLIF(evt->>'sid', ''), evt->'context'->>'session_id') IS NOT NULL
      AND NULLIF(btrim(evt->>'mid'), '') IS NOT NULL
),
ordered AS (
    SELECT
        r.*,
        ROW_NUMBER() OVER (
            PARTITION BY r.question_id
            ORDER BY
                CASE r.oe_eid
                    WHEN 'OE_START' THEN 1
                    WHEN 'OE_ITEM_RESPONSE' THEN
                        CASE
                            WHEN r.edata_type IN ('ext_api_call', 'ext_api') THEN 2
                            WHEN r.edata_type IN ('bpp_network_api_call', 'bpp_network') THEN 3
                            ELSE 4
                        END
                    WHEN 'OE_END' THEN 5
                    ELSE 9
                END,
                r.event_timestamp,
                r.event_mid
        ) AS relative_step
    FROM raw_events r
),
numbered AS (
    SELECT
        o.*,
        COALESCE(
            (SELECT MAX(p.step_sequence) FROM provider_telemetry_events p WHERE p.question_id = o.question_id),
            0
        ) + o.relative_step AS step_sequence
    FROM ordered o
),
mapped AS (
    SELECT
        n.session_id,
        n.question_id,
        LEAST(n.step_sequence, 32767)::SMALLINT AS step_sequence,
        LEFT(n.service_name, 64) AS service_name,
        CASE n.oe_eid
            WHEN 'OE_START' THEN 'flow_start'
            WHEN 'OE_END' THEN 'flow_end'
            WHEN 'OE_ITEM_RESPONSE' THEN
                CASE
                    WHEN n.edata_type IN ('bpp_network_api_call', 'bpp_network') THEN 'beckn_inbound'
                    WHEN n.edata_type IN ('ext_api_call', 'ext_api') THEN 'ext_api_call'
                    ELSE 'internal_step'
                END
            ELSE 'error'
        END AS event_type,
        LEFT(COALESCE(
            n.net->'input'->'beckn'->>'transaction_id',
            n.flow_target->>'beckn_transaction_id',
            n.beckn_ctx->>'beckn_transaction_id'
        ), 128) AS beckn_transaction_id,
        CASE n.oe_eid
            WHEN 'OE_START' THEN COALESCE(n.flow_target->>'request_path', n.beckn_ctx->>'request_path')
            WHEN 'OE_END' THEN COALESCE(n.flow_target->>'request_path', n.beckn_ctx->>'request_path')
            ELSE n.net->>'url'
        END AS endpoint_url,
        CASE n.oe_eid
            WHEN 'OE_START' THEN NULL::SMALLINT
            WHEN 'OE_END' THEN NULL::SMALLINT
            ELSE NULLIF(n.net->>'statusCode', '')::SMALLINT
        END AS http_status,
        CASE n.oe_eid
            WHEN 'OE_END' THEN COALESCE(
                NULLIF(n.flow_target->>'durationMs', '')::INTEGER,
                NULLIF(n.edata->>'durationMs', '')::INTEGER
            )
            ELSE NULLIF(n.net->>'latencyMs', '')::INTEGER
        END AS latency_ms,
        CASE n.oe_eid
            WHEN 'OE_END' THEN
                CASE lower(COALESCE(n.flow_target->>'success', n.edata->>'success', ''))
                    WHEN 'true' THEN TRUE WHEN 'false' THEN FALSE ELSE NULL
                END
            WHEN 'OE_ITEM_RESPONSE' THEN
                CASE lower(COALESCE(n.net->>'success', ''))
                    WHEN 'true' THEN TRUE WHEN 'false' THEN FALSE ELSE NULL
                END
            WHEN 'OE_START' THEN TRUE
            ELSE NULL
        END AS success,
        COALESCE(
            NULLIF(n.net->>'error', ''),
            NULLIF(n.flow_target->>'error', ''),
            NULLIF(n.edata->>'error', '')
        ) AS error_message,
        CASE n.oe_eid
            WHEN 'OE_START' THEN jsonb_build_object(
                'beckn', jsonb_build_object(
                    'transaction_id', COALESCE(n.flow_target->>'beckn_transaction_id', n.beckn_ctx->>'beckn_transaction_id'),
                    'message_id', COALESCE(n.flow_target->>'beckn_message_id', n.beckn_ctx->>'beckn_message_id'),
                    'domain', COALESCE(n.flow_target->>'beckn_domain', n.beckn_ctx->>'beckn_domain'),
                    'action', COALESCE(n.flow_target->>'beckn_action', n.beckn_ctx->>'beckn_action'),
                    'request_path', COALESCE(n.flow_target->>'request_path', n.beckn_ctx->>'request_path')
                ),
                'route_name', COALESCE(n.flow_target->>'route_name', n.beckn_ctx->>'route_name'),
                'session_id', n.session_id,
                'question_id', n.question_id,
                'use_case', n.service_name
            )
            WHEN 'OE_END' THEN jsonb_build_object(
                'beckn', jsonb_build_object(
                    'transaction_id', COALESCE(n.flow_target->>'beckn_transaction_id', n.beckn_ctx->>'beckn_transaction_id'),
                    'message_id', COALESCE(n.flow_target->>'beckn_message_id', n.beckn_ctx->>'beckn_message_id'),
                    'domain', COALESCE(n.flow_target->>'beckn_domain', n.beckn_ctx->>'beckn_domain'),
                    'action', COALESCE(n.flow_target->>'beckn_action', n.beckn_ctx->>'beckn_action'),
                    'request_path', COALESCE(n.flow_target->>'request_path', n.beckn_ctx->>'request_path')
                ),
                'route_name', COALESCE(n.flow_target->>'route_name', n.beckn_ctx->>'route_name'),
                'session_id', n.session_id,
                'question_id', n.question_id,
                'use_case', n.service_name
            )
            WHEN 'OE_ITEM_RESPONSE' THEN (n.net->'input')::jsonb
            ELSE NULL
        END AS request_payload,
        CASE n.oe_eid
            WHEN 'OE_END' THEN jsonb_build_object(
                'duration_ms', COALESCE(
                    NULLIF(n.flow_target->>'durationMs', '')::INTEGER,
                    NULLIF(n.edata->>'durationMs', '')::INTEGER
                ),
                'success', CASE lower(COALESCE(n.flow_target->>'success', n.edata->>'success', ''))
                    WHEN 'true' THEN TRUE WHEN 'false' THEN FALSE ELSE NULL
                END,
                'error', COALESCE(n.flow_target->>'error', n.edata->>'error')
            )
            WHEN 'OE_ITEM_RESPONSE' THEN (n.net->'output')::jsonb
            ELSE NULL
        END AS response_payload,
        LEFT(n.event_mid, 128) AS event_mid,
        n.event_timestamp,
        n.winston_timestamp
    FROM numbered n
    WHERE NOT EXISTS (
        SELECT 1 FROM provider_telemetry_events p WHERE p.event_mid = n.event_mid
    )
),
inserted AS (
    INSERT INTO provider_telemetry_events (
        session_id, question_id, step_sequence, service_name, event_type,
        beckn_transaction_id, endpoint_url, http_status, latency_ms, success,
        error_message, request_payload, response_payload, event_mid, event_timestamp
    )
    SELECT
        session_id, question_id, step_sequence, service_name, event_type,
        beckn_transaction_id, endpoint_url, http_status, latency_ms, success,
        error_message, request_payload, response_payload, event_mid, event_timestamp
    FROM mapped
    ON CONFLICT (event_mid) DO NOTHING
    RETURNING id
),
stats AS (
    SELECT
        (SELECT MAX(winston_timestamp) FROM raw_events) AS max_ts,
        (SELECT COUNT(*) FROM inserted) AS inserted_count
)
UPDATE telemetry_etl_state t
SET
    last_processed_at = COALESCE(s.max_ts, t.last_processed_at),
    last_run_at = NOW(),
    rows_inserted = t.rows_inserted + COALESCE(s.inserted_count, 0)
FROM stats s
WHERE t.id = 1;