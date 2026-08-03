export const RETAINED_HOT_PUBLICATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS = 30 * 1000;
export const RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS =
  15 * 60 * 1000 + RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS;
export const RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS = 5 * 60 * 1000;

export const RETAINED_HOT_FROM_INDEX =
  "publication_switch_history_from_retained_hot_idx" as const;
export const RETAINED_HOT_ROLLBACK_INDEX =
  "publication_switch_history_prior_rollback_retained_hot_idx" as const;

export const RETAINED_HOT_REFERENCE_CTE_SQL = `
retained_reference AS (
  SELECT max(
    coalesce((
      SELECT history.switched_at_ms
      FROM publication_switch_history AS history
        INDEXED BY ${RETAINED_HOT_FROM_INDEX}
      WHERE history.from_publication_id = ?1
      ORDER BY history.switched_at_ms DESC, history.new_generation DESC
      LIMIT 1
    ), -1),
    coalesce((
      SELECT history.switched_at_ms
      FROM publication_switch_history AS history
        INDEXED BY ${RETAINED_HOT_ROLLBACK_INDEX}
      WHERE history.expected_prior_rollback_candidate_publication_id = ?1
      ORDER BY history.switched_at_ms DESC, history.new_generation DESC
      LIMIT 1
    ), -1)
  ) AS latest_head_reference_ms
)
` as const;

export const validRequiredAvailableUntilMs = (
  value: unknown,
): value is number | null =>
  value === null ||
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
