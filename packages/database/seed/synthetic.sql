PRAGMA foreign_keys = ON;

-- Every row in this file is fabricated for product demonstration and tests.
INSERT OR IGNORE INTO users
  (id, access_subject, email, display_name, created_at)
VALUES
  (
    'usr_demo',
    'synthetic-access-subject',
    'demo@example.invalid',
    'Demo Operator',
    '2026-07-01T09:00:00-07:00'
  );

INSERT OR IGNORE INTO households
  (id, owner_user_id, name, base_currency, created_at)
VALUES
  (
    'hh_demo',
    'usr_demo',
    'Demo Household',
    'USD',
    '2026-07-01T09:00:00-07:00'
  );

INSERT OR IGNORE INTO companies
  (id, household_id, legal_name, website_host, status, created_at, updated_at)
VALUES
  (
    'co_northstar',
    'hh_demo',
    'Northstar Robotics',
    'northstar-robotics.example',
    'active',
    '2026-07-01T09:00:00-07:00',
    '2026-07-25T10:30:00-07:00'
  ),
  (
    'co_harbor',
    'hh_demo',
    'Harbor Health Systems',
    'harbor-health.example',
    'active',
    '2026-07-01T09:00:00-07:00',
    '2026-07-20T08:10:00-07:00'
  ),
  (
    'co_lattice',
    'hh_demo',
    'Lattice Grove Energy',
    'lattice-grove.example',
    'active',
    '2026-07-01T09:00:00-07:00',
    '2026-06-03T11:45:00-07:00'
  );

INSERT OR IGNORE INTO portfolio_watch_targets
  (
    id,
    household_id,
    company_id,
    status,
    source_policy,
    last_checked_at,
    created_at
  )
VALUES
  (
    'watch_northstar',
    'hh_demo',
    'co_northstar',
    'active',
    'public_only',
    NULL,
    '2026-07-01T09:00:00-07:00'
  ),
  (
    'watch_harbor',
    'hh_demo',
    'co_harbor',
    'active',
    'public_only',
    NULL,
    '2026-07-01T09:00:00-07:00'
  ),
  (
    'watch_lattice',
    'hh_demo',
    'co_lattice',
    'active',
    'public_only',
    NULL,
    '2026-07-01T09:00:00-07:00'
  );

INSERT OR IGNORE INTO asset_accounts
  (id, household_id, name, account_type, administrator_label, created_at)
VALUES
  (
    'acct_direct',
    'hh_demo',
    'Direct holdings',
    'direct',
    'Self-administered',
    '2026-07-01T09:00:00-07:00'
  ),
  (
    'acct_spv',
    'hh_demo',
    'Beacon Demo SPV',
    'spv',
    'Example Fund Services',
    '2026-07-01T09:00:00-07:00'
  );

INSERT OR IGNORE INTO private_vehicles
  (id, household_id, name, vehicle_type, created_at)
VALUES
  (
    'vehicle_beacon',
    'hh_demo',
    'Beacon Demo SPV',
    'spv',
    '2026-07-01T09:00:00-07:00'
  );

INSERT OR IGNORE INTO asset_lots
  (
    id,
    household_id,
    company_id,
    asset_account_id,
    private_vehicle_id,
    lot_label,
    security_type,
    quantity_scaled,
    quantity_scale,
    acquisition_date,
    cost_basis_minor,
    currency,
    created_at
  )
VALUES
  (
    'lot_northstar_seed',
    'hh_demo',
    'co_northstar',
    'acct_direct',
    NULL,
    'Seed preferred',
    'preferred_equity',
    125000,
    0,
    '2021-04-15',
    24000000,
    'USD',
    '2026-07-01T09:00:00-07:00'
  ),
  (
    'lot_harbor_spv',
    'hh_demo',
    'co_harbor',
    'acct_spv',
    'vehicle_beacon',
    'SPV interest',
    'llc_interest',
    850000,
    6,
    '2022-09-30',
    18000000,
    'USD',
    '2026-07-01T09:00:00-07:00'
  ),
  (
    'lot_lattice_seriesa',
    'hh_demo',
    'co_lattice',
    'acct_direct',
    NULL,
    'Series A preferred',
    'preferred_equity',
    48000,
    0,
    '2023-02-10',
    15000000,
    'USD',
    '2026-07-01T09:00:00-07:00'
  );

INSERT OR IGNORE INTO mark_sources
  (id, household_id, source_type, source_name, confidence_ppm, created_at)
VALUES
  (
    'src_admin',
    'hh_demo',
    'administrator_statement',
    'Synthetic administrator statement',
    940000,
    '2026-07-01T09:00:00-07:00'
  ),
  (
    'src_external',
    'hh_demo',
    'company_announcement',
    'Synthetic company update',
    760000,
    '2026-07-01T09:00:00-07:00'
  ),
  (
    'src_underwriting',
    'hh_demo',
    'manual_model',
    'FI underwriting policy v1',
    900000,
    '2026-07-01T09:00:00-07:00'
  ),
  (
    'src_thesis',
    'hh_demo',
    'scenario_model',
    'Thesis-weighted scenario',
    650000,
    '2026-07-01T09:00:00-07:00'
  );

INSERT OR IGNORE INTO marks
  (
    id,
    household_id,
    company_id,
    asset_lot_id,
    mark_source_id,
    mark_kind,
    value_minor,
    currency,
    effective_at,
    retrieved_at,
    review_status,
    created_at
  )
VALUES
  ('mark_ns_nav', 'hh_demo', 'co_northstar', 'lot_northstar_seed', 'src_admin', 'administrator_nav', 124000000, 'USD', '2026-06-30T23:59:59-07:00', '2026-07-12T08:15:00-07:00', 'accepted', '2026-07-12T08:20:00-07:00'),
  ('mark_ns_ext', 'hh_demo', 'co_northstar', 'lot_northstar_seed', 'src_external', 'external_mark', 168000000, 'USD', '2026-07-18T12:00:00-07:00', '2026-07-18T12:10:00-07:00', 'accepted', '2026-07-18T12:15:00-07:00'),
  ('mark_ns_fi', 'hh_demo', 'co_northstar', 'lot_northstar_seed', 'src_underwriting', 'fi_underwriting', 78000000, 'USD', '2026-07-01T00:00:00-07:00', '2026-07-01T09:00:00-07:00', 'accepted', '2026-07-01T09:00:00-07:00'),
  ('mark_ns_thesis', 'hh_demo', 'co_northstar', 'lot_northstar_seed', 'src_thesis', 'thesis_weighted', 151000000, 'USD', '2026-07-01T00:00:00-07:00', '2026-07-01T09:00:00-07:00', 'accepted', '2026-07-01T09:00:00-07:00'),
  ('mark_ns_usable', 'hh_demo', 'co_northstar', 'lot_northstar_seed', 'src_underwriting', 'usable_liquidity', 0, 'USD', '2026-07-01T00:00:00-07:00', '2026-07-01T09:00:00-07:00', 'accepted', '2026-07-01T09:00:00-07:00'),
  ('mark_hh_nav', 'hh_demo', 'co_harbor', 'lot_harbor_spv', 'src_admin', 'administrator_nav', 86000000, 'USD', '2026-06-30T23:59:59-07:00', '2026-07-15T09:00:00-07:00', 'accepted', '2026-07-15T09:05:00-07:00'),
  ('mark_hh_ext', 'hh_demo', 'co_harbor', 'lot_harbor_spv', 'src_external', 'external_mark', 105000000, 'USD', '2026-07-09T12:00:00-07:00', '2026-07-09T12:08:00-07:00', 'accepted', '2026-07-09T12:10:00-07:00'),
  ('mark_hh_fi', 'hh_demo', 'co_harbor', 'lot_harbor_spv', 'src_underwriting', 'fi_underwriting', 54000000, 'USD', '2026-07-01T00:00:00-07:00', '2026-07-01T09:00:00-07:00', 'accepted', '2026-07-01T09:00:00-07:00'),
  ('mark_hh_thesis', 'hh_demo', 'co_harbor', 'lot_harbor_spv', 'src_thesis', 'thesis_weighted', 92000000, 'USD', '2026-07-01T00:00:00-07:00', '2026-07-01T09:00:00-07:00', 'accepted', '2026-07-01T09:00:00-07:00'),
  ('mark_hh_usable', 'hh_demo', 'co_harbor', 'lot_harbor_spv', 'src_underwriting', 'usable_liquidity', 7500000, 'USD', '2026-07-01T00:00:00-07:00', '2026-07-01T09:00:00-07:00', 'accepted', '2026-07-01T09:00:00-07:00'),
  ('mark_lg_nav', 'hh_demo', 'co_lattice', 'lot_lattice_seriesa', 'src_admin', 'administrator_nav', 61000000, 'USD', '2026-03-31T23:59:59-07:00', '2026-04-18T08:00:00-07:00', 'accepted', '2026-04-18T08:05:00-07:00'),
  ('mark_lg_ext', 'hh_demo', 'co_lattice', 'lot_lattice_seriesa', 'src_external', 'external_mark', 71000000, 'USD', '2026-03-22T12:00:00-07:00', '2026-04-02T07:30:00-07:00', 'proposed', '2026-04-02T07:35:00-07:00'),
  ('mark_lg_fi', 'hh_demo', 'co_lattice', 'lot_lattice_seriesa', 'src_underwriting', 'fi_underwriting', 36000000, 'USD', '2026-07-01T00:00:00-07:00', '2026-07-01T09:00:00-07:00', 'accepted', '2026-07-01T09:00:00-07:00'),
  ('mark_lg_thesis', 'hh_demo', 'co_lattice', 'lot_lattice_seriesa', 'src_thesis', 'thesis_weighted', 65000000, 'USD', '2026-07-01T00:00:00-07:00', '2026-07-01T09:00:00-07:00', 'accepted', '2026-07-01T09:00:00-07:00'),
  ('mark_lg_usable', 'hh_demo', 'co_lattice', 'lot_lattice_seriesa', 'src_underwriting', 'usable_liquidity', 0, 'USD', '2026-07-01T00:00:00-07:00', '2026-07-01T09:00:00-07:00', 'accepted', '2026-07-01T09:00:00-07:00');

INSERT OR IGNORE INTO source_documents
  (
    id,
    household_id,
    object_key,
    file_name,
    content_type,
    byte_size,
    sha256,
    effective_date,
    retrieved_at,
    source_label,
    review_status,
    created_at
  )
VALUES
  (
    'doc_northstar_update',
    'hh_demo',
    'synthetic/northstar-company-update.txt',
    'northstar-company-update.txt',
    'text/plain',
    2048,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '2026-07-18',
    '2026-07-18T12:10:00-07:00',
    'Synthetic company update',
    'pending_review',
    '2026-07-18T12:10:00-07:00'
  ),
  (
    'doc_harbor_notice',
    'hh_demo',
    'synthetic/harbor-distribution-notice.txt',
    'harbor-distribution-notice.txt',
    'text/plain',
    1536,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '2026-07-09',
    '2026-07-09T12:08:00-07:00',
    'Synthetic distribution notice',
    'pending_review',
    '2026-07-09T12:08:00-07:00'
  ),
  (
    'doc_lattice_rss',
    'hh_demo',
    'synthetic/lattice-rss-item.txt',
    'lattice-rss-item.txt',
    'text/plain',
    1024,
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '2026-07-22',
    '2026-07-22T07:30:00-07:00',
    'Synthetic company RSS',
    'pending_review',
    '2026-07-22T07:30:00-07:00'
  );

INSERT OR IGNORE INTO evidence_events
  (
    id,
    household_id,
    company_id,
    source_document_id,
    event_type,
    headline,
    effective_date,
    detected_at,
    retrieved_at,
    status,
    confidence_ppm,
    prior_value_json,
    replacement_value_json,
    estimated_forecast_impact_minor,
    created_at
  )
VALUES
  (
    'evt_northstar_round',
    'hh_demo',
    'co_northstar',
    'doc_northstar_update',
    'financing_round',
    'New preferred financing terms detected',
    '2026-07-18',
    '2026-07-18T12:10:00-07:00',
    '2026-07-18T12:10:00-07:00',
    'pending_review',
    820000,
    '{"externalMarkMinor":142000000}',
    '{"externalMarkMinor":168000000}',
    18400000,
    '2026-07-18T12:10:00-07:00'
  ),
  (
    'evt_harbor_distribution',
    'hh_demo',
    'co_harbor',
    'doc_harbor_notice',
    'distribution_notice',
    'Partial distribution window announced',
    '2026-08-15',
    '2026-07-09T12:08:00-07:00',
    '2026-07-09T12:08:00-07:00',
    'pending_review',
    930000,
    '{"usableLiquidityMinor":0}',
    '{"usableLiquidityMinor":7500000}',
    7500000,
    '2026-07-09T12:08:00-07:00'
  ),
  (
    'evt_lattice_delay',
    'hh_demo',
    'co_lattice',
    'doc_lattice_rss',
    'operating_update',
    'Commercial launch timing moved',
    '2026-07-22',
    '2026-07-22T07:30:00-07:00',
    '2026-07-22T07:30:00-07:00',
    'pending_review',
    690000,
    '{"earliestLiquidityYear":2028}',
    '{"earliestLiquidityYear":2029}',
    -12500000,
    '2026-07-22T07:30:00-07:00'
  );

INSERT OR IGNORE INTO evidence_claims
  (
    id,
    household_id,
    evidence_event_id,
    field_path,
    claim_value_json,
    unit,
    provenance,
    created_at
  )
VALUES
  ('claim_ns_mark', 'hh_demo', 'evt_northstar_round', 'marks.external_mark.value_minor', '168000000', 'minor_units', 'Synthetic company update, section 2', '2026-07-18T12:10:00-07:00'),
  ('claim_hh_usable', 'hh_demo', 'evt_harbor_distribution', 'marks.usable_liquidity.value_minor', '7500000', 'minor_units', 'Synthetic distribution notice, paragraph 1', '2026-07-09T12:08:00-07:00'),
  ('claim_lg_year', 'hh_demo', 'evt_lattice_delay', 'scenario_assumptions.earliest_liquidity_year', '2029', 'year', 'Synthetic RSS update', '2026-07-22T07:30:00-07:00');

INSERT OR IGNORE INTO scenarios
  (id, household_id, name, description, is_sandbox, archived_at, created_at)
VALUES
  ('scn_runway', 'hh_demo', 'Runway / No Liquidity', 'Assumes no private-company liquidity during the planning horizon.', 0, NULL, '2026-07-01T09:00:00-07:00'),
  ('scn_fi', 'hh_demo', 'FI Underwriting', 'Conservative values and timing used for financial-independence decisions.', 0, NULL, '2026-07-01T09:00:00-07:00'),
  ('scn_thesis', 'hh_demo', 'Thesis-Weighted Expected', 'Probability-weighted economic outcomes with timing haircuts.', 0, NULL, '2026-07-01T09:00:00-07:00'),
  ('scn_upside', 'hh_demo', 'Upside', 'Optimistic but explicit exit-value and timing assumptions.', 0, NULL, '2026-07-01T09:00:00-07:00'),
  ('scn_sandbox', 'hh_demo', 'Sandbox', 'Editable working assumptions that never replace an accepted baseline.', 1, NULL, '2026-07-01T09:00:00-07:00');

INSERT OR IGNORE INTO scenario_assumptions
  (
    id,
    household_id,
    scenario_id,
    assumption_key,
    label,
    value_integer,
    value_scale,
    unit,
    provenance,
    effective_date,
    created_at
  )
VALUES
  ('asm_runway_probability', 'hh_demo', 'scn_runway', 'liquidity_probability', 'Liquidity probability', 0, 6, 'ppm', 'Policy: exclude private liquidity', '2026-07-01', '2026-07-01T09:00:00-07:00'),
  ('asm_runway_delay', 'hh_demo', 'scn_runway', 'timing_delay_months', 'Timing delay', 60, 0, 'months', 'Policy: beyond planning horizon', '2026-07-01', '2026-07-01T09:00:00-07:00'),
  ('asm_fi_probability', 'hh_demo', 'scn_fi', 'liquidity_probability', 'Liquidity probability', 430000, 6, 'ppm', 'FI underwriting policy v1', '2026-07-01', '2026-07-01T09:00:00-07:00'),
  ('asm_fi_delay', 'hh_demo', 'scn_fi', 'timing_delay_months', 'Timing delay', 18, 0, 'months', 'FI underwriting policy v1', '2026-07-01', '2026-07-01T09:00:00-07:00'),
  ('asm_thesis_probability', 'hh_demo', 'scn_thesis', 'liquidity_probability', 'Liquidity probability', 680000, 6, 'ppm', 'Synthetic thesis review', '2026-07-01', '2026-07-01T09:00:00-07:00'),
  ('asm_thesis_delay', 'hh_demo', 'scn_thesis', 'timing_delay_months', 'Timing delay', 10, 0, 'months', 'Synthetic thesis review', '2026-07-01', '2026-07-01T09:00:00-07:00'),
  ('asm_upside_probability', 'hh_demo', 'scn_upside', 'liquidity_probability', 'Liquidity probability', 820000, 6, 'ppm', 'Explicit upside hypothesis', '2026-07-01', '2026-07-01T09:00:00-07:00'),
  ('asm_upside_delay', 'hh_demo', 'scn_upside', 'timing_delay_months', 'Timing delay', 6, 0, 'months', 'Explicit upside hypothesis', '2026-07-01', '2026-07-01T09:00:00-07:00'),
  ('asm_sandbox_probability', 'hh_demo', 'scn_sandbox', 'liquidity_probability', 'Liquidity probability', 550000, 6, 'ppm', 'Synthetic operator input', '2026-07-01', '2026-07-01T09:00:00-07:00'),
  ('asm_sandbox_delay', 'hh_demo', 'scn_sandbox', 'timing_delay_months', 'Timing delay', 14, 0, 'months', 'Synthetic operator input', '2026-07-01', '2026-07-01T09:00:00-07:00');

INSERT OR IGNORE INTO tax_profiles
  (
    id,
    household_id,
    name,
    assumed_tax_rate_ppm,
    effective_date,
    provenance,
    created_at
  )
VALUES
  (
    'tax_demo',
    'hh_demo',
    'Synthetic blended tax profile',
    285000,
    '2026-07-01',
    'Demonstration assumption only; not tax advice',
    '2026-07-01T09:00:00-07:00'
  );

INSERT OR IGNORE INTO cash_flow_plans
  (
    id,
    household_id,
    scenario_id,
    household_burn_monthly_minor,
    business_burn_monthly_minor,
    fi_eligible_liquid_minor,
    protected_cash_floor_minor,
    fi_target_minor,
    effective_date,
    provenance,
    created_at
  )
VALUES
  ('cf_runway', 'hh_demo', 'scn_runway', 2850000, 1250000, 182500000, 10300000, 325000000, '2026-07-01', 'Synthetic planning inputs', '2026-07-01T09:00:00-07:00'),
  ('cf_fi', 'hh_demo', 'scn_fi', 2850000, 1250000, 182500000, 10300000, 325000000, '2026-07-01', 'Synthetic planning inputs', '2026-07-01T09:00:00-07:00'),
  ('cf_thesis', 'hh_demo', 'scn_thesis', 2850000, 1250000, 182500000, 10300000, 325000000, '2026-07-01', 'Synthetic planning inputs', '2026-07-01T09:00:00-07:00'),
  ('cf_upside', 'hh_demo', 'scn_upside', 2850000, 1250000, 182500000, 10300000, 325000000, '2026-07-01', 'Synthetic planning inputs', '2026-07-01T09:00:00-07:00'),
  ('cf_sandbox', 'hh_demo', 'scn_sandbox', 2850000, 1250000, 182500000, 10300000, 325000000, '2026-07-01', 'Synthetic planning inputs', '2026-07-01T09:00:00-07:00');

INSERT OR IGNORE INTO forecast_snapshots
  (
    id,
    household_id,
    scenario_id,
    version,
    input_hash,
    created_at,
    created_by,
    trigger,
    attributed_change,
    immutable
  )
VALUES
  ('snap_fi_v1', 'hh_demo', 'scn_fi', 1, 'synthetic-fi-v1-input-hash', '2026-07-02T09:00:00-07:00', 'Demo Operator', 'Initial forecast', 'Initial conservative baseline', 1),
  ('snap_fi_v2', 'hh_demo', 'scn_fi', 2, 'synthetic-fi-v2-input-hash', '2026-07-10T14:20:00-07:00', 'Demo Operator', 'Assumption revision', 'Harbor timing moved forward by six months', 1),
  ('snap_fi_v3', 'hh_demo', 'scn_fi', 3, 'synthetic-fi-v3-input-hash', '2026-07-22T08:00:00-07:00', 'Demo Operator', 'Evidence accepted', 'Northstar financing mark incorporated with FI haircut', 1),
  ('snap_runway_v1', 'hh_demo', 'scn_runway', 1, 'synthetic-runway-v1-input-hash', '2026-07-22T08:01:00-07:00', 'Demo Operator', 'Scenario refresh', 'No-liquidity policy baseline', 1),
  ('snap_thesis_v1', 'hh_demo', 'scn_thesis', 1, 'synthetic-thesis-v1-input-hash', '2026-07-22T08:02:00-07:00', 'Demo Operator', 'Scenario refresh', 'Thesis probabilities refreshed', 1),
  ('snap_upside_v1', 'hh_demo', 'scn_upside', 1, 'synthetic-upside-v1-input-hash', '2026-07-22T08:03:00-07:00', 'Demo Operator', 'Scenario refresh', 'Upside timing assumptions refreshed', 1),
  ('snap_sandbox_v1', 'hh_demo', 'scn_sandbox', 1, 'synthetic-sandbox-v1-input-hash', '2026-07-22T08:04:00-07:00', 'Demo Operator', 'Sandbox saved', 'Synthetic sandbox assumptions', 1);

INSERT OR IGNORE INTO company_forecasts
  (
    id,
    household_id,
    forecast_snapshot_id,
    scenario_id,
    company_id,
    conditional_value_minor,
    timing_adjusted_liquidity_minor,
    probability_zero_ppm,
    effective_date,
    created_at
  )
VALUES
  ('fc_runway_ns', 'hh_demo', 'snap_runway_v1', 'scn_runway', 'co_northstar', 78000000, 0, 1000000, '2026-07-22', '2026-07-22T08:01:00-07:00'),
  ('fc_runway_hh', 'hh_demo', 'snap_runway_v1', 'scn_runway', 'co_harbor', 54000000, 0, 1000000, '2026-07-22', '2026-07-22T08:01:00-07:00'),
  ('fc_runway_lg', 'hh_demo', 'snap_runway_v1', 'scn_runway', 'co_lattice', 36000000, 0, 1000000, '2026-07-22', '2026-07-22T08:01:00-07:00'),
  ('fc_fi_ns', 'hh_demo', 'snap_fi_v3', 'scn_fi', 'co_northstar', 78000000, 42000000, 430000, '2026-07-22', '2026-07-22T08:00:00-07:00'),
  ('fc_fi_hh', 'hh_demo', 'snap_fi_v3', 'scn_fi', 'co_harbor', 54000000, 36000000, 350000, '2026-07-22', '2026-07-22T08:00:00-07:00'),
  ('fc_fi_lg', 'hh_demo', 'snap_fi_v3', 'scn_fi', 'co_lattice', 36000000, 14500000, 590000, '2026-07-22', '2026-07-22T08:00:00-07:00'),
  ('fc_thesis_ns', 'hh_demo', 'snap_thesis_v1', 'scn_thesis', 'co_northstar', 151000000, 102000000, 260000, '2026-07-22', '2026-07-22T08:02:00-07:00'),
  ('fc_thesis_hh', 'hh_demo', 'snap_thesis_v1', 'scn_thesis', 'co_harbor', 92000000, 71000000, 220000, '2026-07-22', '2026-07-22T08:02:00-07:00'),
  ('fc_thesis_lg', 'hh_demo', 'snap_thesis_v1', 'scn_thesis', 'co_lattice', 65000000, 35000000, 410000, '2026-07-22', '2026-07-22T08:02:00-07:00'),
  ('fc_upside_ns', 'hh_demo', 'snap_upside_v1', 'scn_upside', 'co_northstar', 220000000, 175000000, 120000, '2026-07-22', '2026-07-22T08:03:00-07:00'),
  ('fc_upside_hh', 'hh_demo', 'snap_upside_v1', 'scn_upside', 'co_harbor', 142000000, 118000000, 100000, '2026-07-22', '2026-07-22T08:03:00-07:00'),
  ('fc_upside_lg', 'hh_demo', 'snap_upside_v1', 'scn_upside', 'co_lattice', 98000000, 72000000, 190000, '2026-07-22', '2026-07-22T08:03:00-07:00'),
  ('fc_sandbox_ns', 'hh_demo', 'snap_sandbox_v1', 'scn_sandbox', 'co_northstar', 132000000, 83000000, 320000, '2026-07-22', '2026-07-22T08:04:00-07:00'),
  ('fc_sandbox_hh', 'hh_demo', 'snap_sandbox_v1', 'scn_sandbox', 'co_harbor', 78000000, 56000000, 290000, '2026-07-22', '2026-07-22T08:04:00-07:00'),
  ('fc_sandbox_lg', 'hh_demo', 'snap_sandbox_v1', 'scn_sandbox', 'co_lattice', 50000000, 26000000, 510000, '2026-07-22', '2026-07-22T08:04:00-07:00');

INSERT OR IGNORE INTO liquidity_curves
  (
    id,
    household_id,
    forecast_snapshot_id,
    scenario_id,
    year,
    p25_minor,
    p50_minor,
    p75_minor,
    expected_minor,
    probability_zero_ppm,
    created_at
  )
VALUES
  ('curve_runway_2027', 'hh_demo', 'snap_runway_v1', 'scn_runway', 2027, 0, 0, 0, 0, 1000000, '2026-07-22T08:01:00-07:00'),
  ('curve_runway_2028', 'hh_demo', 'snap_runway_v1', 'scn_runway', 2028, 0, 0, 0, 0, 1000000, '2026-07-22T08:01:00-07:00'),
  ('curve_runway_2029', 'hh_demo', 'snap_runway_v1', 'scn_runway', 2029, 0, 0, 0, 0, 1000000, '2026-07-22T08:01:00-07:00'),
  ('curve_runway_2030', 'hh_demo', 'snap_runway_v1', 'scn_runway', 2030, 0, 0, 0, 0, 1000000, '2026-07-22T08:01:00-07:00'),
  ('curve_runway_2031', 'hh_demo', 'snap_runway_v1', 'scn_runway', 2031, 0, 0, 0, 0, 1000000, '2026-07-22T08:01:00-07:00'),
  ('curve_fi_2027', 'hh_demo', 'snap_fi_v3', 'scn_fi', 2027, 0, 18000000, 62000000, 26000000, 690000, '2026-07-22T08:00:00-07:00'),
  ('curve_fi_2028', 'hh_demo', 'snap_fi_v3', 'scn_fi', 2028, 12000000, 54000000, 128000000, 71000000, 420000, '2026-07-22T08:00:00-07:00'),
  ('curve_fi_2029', 'hh_demo', 'snap_fi_v3', 'scn_fi', 2029, 42000000, 108000000, 210000000, 132000000, 230000, '2026-07-22T08:00:00-07:00'),
  ('curve_fi_2030', 'hh_demo', 'snap_fi_v3', 'scn_fi', 2030, 72000000, 166000000, 286000000, 195000000, 120000, '2026-07-22T08:00:00-07:00'),
  ('curve_fi_2031', 'hh_demo', 'snap_fi_v3', 'scn_fi', 2031, 94000000, 210000000, 354000000, 246000000, 70000, '2026-07-22T08:00:00-07:00'),
  ('curve_thesis_2027', 'hh_demo', 'snap_thesis_v1', 'scn_thesis', 2027, 8000000, 42000000, 105000000, 59000000, 470000, '2026-07-22T08:02:00-07:00'),
  ('curve_thesis_2028', 'hh_demo', 'snap_thesis_v1', 'scn_thesis', 2028, 38000000, 118000000, 230000000, 141000000, 250000, '2026-07-22T08:02:00-07:00'),
  ('curve_thesis_2029', 'hh_demo', 'snap_thesis_v1', 'scn_thesis', 2029, 88000000, 205000000, 355000000, 241000000, 110000, '2026-07-22T08:02:00-07:00'),
  ('curve_thesis_2030', 'hh_demo', 'snap_thesis_v1', 'scn_thesis', 2030, 145000000, 286000000, 465000000, 335000000, 50000, '2026-07-22T08:02:00-07:00'),
  ('curve_thesis_2031', 'hh_demo', 'snap_thesis_v1', 'scn_thesis', 2031, 190000000, 352000000, 548000000, 402000000, 30000, '2026-07-22T08:02:00-07:00'),
  ('curve_upside_2027', 'hh_demo', 'snap_upside_v1', 'scn_upside', 2027, 26000000, 88000000, 182000000, 111000000, 280000, '2026-07-22T08:03:00-07:00'),
  ('curve_upside_2028', 'hh_demo', 'snap_upside_v1', 'scn_upside', 2028, 92000000, 218000000, 395000000, 271000000, 110000, '2026-07-22T08:03:00-07:00'),
  ('curve_upside_2029', 'hh_demo', 'snap_upside_v1', 'scn_upside', 2029, 180000000, 360000000, 590000000, 431000000, 40000, '2026-07-22T08:03:00-07:00'),
  ('curve_upside_2030', 'hh_demo', 'snap_upside_v1', 'scn_upside', 2030, 258000000, 482000000, 735000000, 554000000, 20000, '2026-07-22T08:03:00-07:00'),
  ('curve_upside_2031', 'hh_demo', 'snap_upside_v1', 'scn_upside', 2031, 330000000, 566000000, 828000000, 645000000, 10000, '2026-07-22T08:03:00-07:00'),
  ('curve_sandbox_2027', 'hh_demo', 'snap_sandbox_v1', 'scn_sandbox', 2027, 2000000, 28000000, 84000000, 41000000, 570000, '2026-07-22T08:04:00-07:00'),
  ('curve_sandbox_2028', 'hh_demo', 'snap_sandbox_v1', 'scn_sandbox', 2028, 22000000, 84000000, 172000000, 105000000, 330000, '2026-07-22T08:04:00-07:00'),
  ('curve_sandbox_2029', 'hh_demo', 'snap_sandbox_v1', 'scn_sandbox', 2029, 60000000, 148000000, 272000000, 181000000, 170000, '2026-07-22T08:04:00-07:00'),
  ('curve_sandbox_2030', 'hh_demo', 'snap_sandbox_v1', 'scn_sandbox', 2030, 100000000, 210000000, 365000000, 255000000, 90000, '2026-07-22T08:04:00-07:00'),
  ('curve_sandbox_2031', 'hh_demo', 'snap_sandbox_v1', 'scn_sandbox', 2031, 132000000, 258000000, 438000000, 309000000, 50000, '2026-07-22T08:04:00-07:00');

INSERT OR IGNORE INTO forecast_outputs
  (
    id,
    household_id,
    forecast_snapshot_id,
    metric_key,
    horizon_date,
    percentile,
    value_minor,
    probability_ppm,
    created_at
  )
VALUES
  ('out_fi_v1_p50', 'hh_demo', 'snap_fi_v1', 'cumulative_liquidity', '2031-12-31', 50, 158000000, NULL, '2026-07-02T09:00:00-07:00'),
  ('out_fi_v2_p50', 'hh_demo', 'snap_fi_v2', 'cumulative_liquidity', '2031-12-31', 50, 186000000, NULL, '2026-07-10T14:20:00-07:00'),
  ('out_fi_v3_p25', 'hh_demo', 'snap_fi_v3', 'cumulative_liquidity', '2031-12-31', 25, 94000000, NULL, '2026-07-22T08:00:00-07:00'),
  ('out_fi_v3_p50', 'hh_demo', 'snap_fi_v3', 'cumulative_liquidity', '2031-12-31', 50, 210000000, NULL, '2026-07-22T08:00:00-07:00'),
  ('out_fi_v3_p75', 'hh_demo', 'snap_fi_v3', 'cumulative_liquidity', '2031-12-31', 75, 354000000, NULL, '2026-07-22T08:00:00-07:00'),
  ('out_fi_v3_cross', 'hh_demo', 'snap_fi_v3', 'probability_crossing_fi', '2031-12-31', NULL, NULL, 640000, '2026-07-22T08:00:00-07:00'),
  ('out_runway_p50', 'hh_demo', 'snap_runway_v1', 'cumulative_liquidity', '2031-12-31', 50, 0, NULL, '2026-07-22T08:01:00-07:00'),
  ('out_thesis_p50', 'hh_demo', 'snap_thesis_v1', 'cumulative_liquidity', '2031-12-31', 50, 352000000, NULL, '2026-07-22T08:02:00-07:00'),
  ('out_upside_p50', 'hh_demo', 'snap_upside_v1', 'cumulative_liquidity', '2031-12-31', 50, 566000000, NULL, '2026-07-22T08:03:00-07:00'),
  ('out_sandbox_p50', 'hh_demo', 'snap_sandbox_v1', 'cumulative_liquidity', '2031-12-31', 50, 258000000, NULL, '2026-07-22T08:04:00-07:00');

INSERT OR IGNORE INTO actual_liquidity_events
  (
    id,
    household_id,
    company_id,
    asset_lot_id,
    source_document_id,
    event_type,
    amount_minor,
    currency,
    occurred_at,
    created_at
  )
VALUES
  (
    'liq_harbor_demo',
    'hh_demo',
    'co_harbor',
    'lot_harbor_spv',
    'doc_harbor_notice',
    'distribution',
    4800000,
    'USD',
    '2026-06-20T12:00:00-07:00',
    '2026-06-20T12:05:00-07:00'
  );

INSERT OR IGNORE INTO connector_accounts
  (
    id,
    household_id,
    connector_type,
    display_label,
    secret_reference,
    status,
    last_synced_at,
    created_at
  )
VALUES
  (
    'connector_rss_demo',
    'hh_demo',
    'company-rss',
    'Synthetic company feeds',
    'secret-reference-not-configured',
    'paused',
    '2026-07-22T07:30:00-07:00',
    '2026-07-01T09:00:00-07:00'
  );

INSERT OR IGNORE INTO connector_sync_runs
  (
    id,
    household_id,
    connector_account_id,
    status,
    started_at,
    finished_at,
    cursor,
    discovered_count,
    proposed_count,
    error_code
  )
VALUES
  (
    'sync_rss_demo',
    'hh_demo',
    'connector_rss_demo',
    'succeeded',
    '2026-07-22T07:29:00-07:00',
    '2026-07-22T07:30:00-07:00',
    'synthetic-cursor',
    1,
    1,
    NULL
  );

INSERT OR IGNORE INTO goals
  (id, household_id, template_key, is_primary, archived_at, created_at)
VALUES
  (
    'goal_fi',
    'hh_demo',
    'financial_independence',
    1,
    NULL,
    '2026-07-01T09:00:00-07:00'
  ),
  (
    'goal_runway',
    'hh_demo',
    'cash_runway',
    0,
    NULL,
    '2026-07-01T09:01:00-07:00'
  ),
  (
    'goal_purchase',
    'hh_demo',
    'major_purchase',
    0,
    NULL,
    '2026-07-01T09:02:00-07:00'
  );

INSERT OR IGNORE INTO goal_versions
  (
    id,
    household_id,
    goal_id,
    version,
    name,
    metric_key,
    metric_label,
    target_value_integer,
    target_unit,
    target_date,
    current_value_integer,
    current_value_source,
    change_note,
    created_at,
    created_by,
    immutable
  )
VALUES
  (
    'goalv_fi_1',
    'hh_demo',
    'goal_fi',
    1,
    'Financial independence',
    'fi_eligible_liquid',
    'FI-eligible liquid assets',
    325000000,
    'minor_units',
    NULL,
    182500000,
    'Synthetic FI planning inputs',
    'Initial synthetic FI goal',
    '2026-07-01T09:00:00-07:00',
    'Demo Operator',
    1
  ),
  (
    'goalv_runway_1',
    'hh_demo',
    'goal_runway',
    1,
    'Keep a three-year cash runway',
    'protected_runway_months',
    'Months of protected runway',
    36,
    'months',
    NULL,
    42,
    'Synthetic cash-flow plan',
    'Initial synthetic runway guardrail',
    '2026-07-01T09:01:00-07:00',
    'Demo Operator',
    1
  ),
  (
    'goalv_purchase_1',
    'hh_demo',
    'goal_purchase',
    1,
    'Future home purchase',
    'purchase_fund',
    'Purchase fund',
    120000000,
    'minor_units',
    '2030-06-30',
    25000000,
    'Synthetic goal input',
    'Initial synthetic purchase goal',
    '2026-07-01T09:02:00-07:00',
    'Demo Operator',
    1
  );

INSERT OR IGNORE INTO goal_forecast_snapshots
  (
    id,
    household_id,
    goal_version_id,
    version,
    model_status,
    lower_value_integer,
    middle_value_integer,
    higher_value_integer,
    success_probability_ppm,
    unit,
    horizon_date,
    methodology,
    created_at,
    created_by,
    immutable
  )
VALUES
  (
    'goalsnap_fi_1',
    'hh_demo',
    'goalv_fi_1',
    1,
    'modeled',
    276500000,
    392500000,
    536500000,
    640000,
    'minor_units',
    '2031-12-31',
    'Five-year total available value combines the current baseline with the saved lower, middle, and higher liquidity outcomes.',
    '2026-07-01T09:00:00-07:00',
    'Demo Operator',
    1
  ),
  (
    'goalsnap_runway_1',
    'hh_demo',
    'goalv_runway_1',
    1,
    'not_configured',
    NULL,
    NULL,
    NULL,
    NULL,
    'months',
    NULL,
    'Current progress is saved. Add scenario inputs before treating this goal as a forecast.',
    '2026-07-01T09:01:00-07:00',
    'Demo Operator',
    1
  ),
  (
    'goalsnap_purchase_1',
    'hh_demo',
    'goalv_purchase_1',
    1,
    'not_configured',
    NULL,
    NULL,
    NULL,
    NULL,
    'minor_units',
    NULL,
    'Current progress is saved. Add scenario inputs before treating this goal as a forecast.',
    '2026-07-01T09:02:00-07:00',
    'Demo Operator',
    1
  );
