-- ═══════════════════════════════════════════════════════════════════
-- NORALTA TRANSACTION MASTER - PRODUCTION SCHEMA v1.0
-- Generated from 39-form field mapping (1,381 fields, 660 reuse refs)
-- 30 tables, 432+ columns
-- Covers: FINTRAC, Residential, Commercial, Lease, Internal forms
-- ═══════════════════════════════════════════════════════════════════

-- Drop all tables if rebuilding from scratch (safe for prototype)
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- ═══════════════════════════════════════════════════════════════════
-- CORE IDENTITY TABLES (referenced by everything)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE agents (
  id              SERIAL PRIMARY KEY,
  full_name       VARCHAR(255) NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(20),
  fax             VARCHAR(20),
  branch          VARCHAR(100),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE brokerages (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  name_2          VARCHAR(255),         -- second brokerage (dual agency)
  address         TEXT,
  city            VARCHAR(100),
  postal_code     VARCHAR(10),
  phone           VARCHAR(20),
  fax             VARCHAR(20),
  email           VARCHAR(255),
  branch_number   VARCHAR(50),
  board_membership VARCHAR(255),
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE parties (
  id              SERIAL PRIMARY KEY,
  full_name       VARCHAR(255) NOT NULL,
  address         TEXT,
  city            VARCHAR(100),
  postal_code     VARCHAR(10),
  phone           VARCHAR(20),
  phone_2         VARCHAR(20),
  fax             VARCHAR(20),
  email           VARCHAR(255),
  date_of_birth   DATE,
  corporate_name  VARCHAR(255),
  entity_name     VARCHAR(255),
  auth_rep_name   VARCHAR(255),
  auth_rep_title  VARCHAR(255),
  gst_number      VARCHAR(50),
  legally_married BOOLEAN,
  spouse_name     VARCHAR(255),
  resided_on_property BOOLEAN,
  -- Non-Canadian Act fields
  non_canadian_status VARCHAR(50),
  non_canadian_exemption TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE lawyers (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255),
  full_name       VARCHAR(255),
  firm            VARCHAR(255),
  address         TEXT,
  city            VARCHAR(100),
  postal_code     VARCHAR(10),
  phone           VARCHAR(20),
  fax             VARCHAR(20),
  email           VARCHAR(255),
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- PROPERTY TABLE (unified residential + commercial + rural)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE properties (
  id                SERIAL PRIMARY KEY,
  -- Standard address
  address           TEXT,
  municipal_address TEXT,
  city              VARCHAR(100),
  postal_code       VARCHAR(10),
  municipality      VARCHAR(100),
  -- Legal description (non-condo)
  plan              VARCHAR(50),
  block             VARCHAR(50),
  block_unit        VARCHAR(50),
  lot               VARCHAR(50),
  legal_description TEXT,
  linc              VARCHAR(20),
  linc_number       VARCHAR(20),
  subdivision       VARCHAR(100),
  other_legal       TEXT,
  -- Condo
  condo_plan        VARCHAR(50),
  condo_unit        VARCHAR(50),
  condo_name        VARCHAR(255),
  -- Rural / ATS (Alberta Township System)
  meridian          VARCHAR(10),
  range             VARCHAR(10),
  range_val         VARCHAR(10),
  township          VARCHAR(10),
  section           VARCHAR(10),
  quarter           VARCHAR(10),
  quarter_section   VARCHAR(10),
  rural_address_id  VARCHAR(50),
  -- Land
  land_acres        DECIMAL(10,2),
  land_hectares     DECIMAL(10,2),
  -- Zoning & classification
  zone              VARCHAR(50),
  zoning            VARCHAR(100),
  minerals_exception TEXT,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- TRANSACTION HUB (central table linking everything)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE transactions (
  id                    SERIAL PRIMARY KEY,
  -- Status
  status                VARCHAR(50) DEFAULT 'draft',  -- draft, active, conditional, firm, closed, cancelled
  transaction_type      VARCHAR(50),                  -- residential, commercial, lease
  conditional           BOOLEAN,
  firm                  BOOLEAN,
  -- Foreign keys
  property_id           INT REFERENCES properties(id),
  agent_id              INT REFERENCES agents(id),      -- primary agent on the deal
  -- Contract basics
  contract_number       VARCHAR(50),
  contract_provider     VARCHAR(255),
  -- Pricing
  purchase_price        DECIMAL(12,2),
  sale_price            DECIMAL(12,2),
  -- Dates
  offer_deadline        TIMESTAMP,
  offer_deadline_time   TIME,
  completion_date       DATE,
  possession_date       DATE,
  binding_date          DATE,
  condition_removal_date DATE,
  sign_removal_date     DATE,
  -- Deposits
  deposit_amount        DECIMAL(12,2),
  deposit_method        VARCHAR(100),
  deposit_deadline_date DATE,
  deposit_deadline_time TIME,
  deposit_held_by       VARCHAR(255),
  trustee_name          VARCHAR(255),
  initial_deposit       DECIMAL(12,2),
  additional_deposit    DECIMAL(12,2),
  deposit_2_amount      DECIMAL(12,2),
  deposit_2_method      VARCHAR(100),
  deposit_2_deadline_date DATE,
  deposit_2_deadline_time TIME,
  -- Condo-specific
  condo_monthly         DECIMAL(10,2),
  condo_nontitled_fee   DECIMAL(10,2),
  -- Goods
  unattached_goods      TEXT,
  -- Attachments (checkboxes for which schedules are attached)
  attach_condo          BOOLEAN,
  attach_financing      BOOLEAN,
  attach_prop_schedule  BOOLEAN,
  attach_sale_buyer     BOOLEAN,
  attach_tenancy        BOOLEAN,
  attach_addendum       BOOLEAN,
  attach_mfg_home       BOOLEAN,
  attach_other          TEXT,
  attached_exceptions   TEXT,
  -- Other terms
  other_terms           TEXT,
  -- Dower
  dower_deadline_date   DATE,
  dower_deadline_time   TIME,
  -- Authorization
  alt_buyer_auth        TEXT,
  alt_seller_auth       TEXT,
  -- Flags
  new_home              BOOLEAN,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- TRANSACTION PARTICIPANT JUNCTION (links parties to transactions)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE transaction_participants (
  id              SERIAL PRIMARY KEY,
  transaction_id  INT REFERENCES transactions(id) ON DELETE CASCADE,
  party_id        INT REFERENCES parties(id),
  agent_id        INT REFERENCES agents(id),
  brokerage_id    INT REFERENCES brokerages(id),
  lawyer_id       INT REFERENCES lawyers(id),
  role            VARCHAR(50) NOT NULL,  -- buyer, buyer_2, seller, seller_2, landlord, tenant, etc.
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- LISTING TABLE
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE listing (
  id                    SERIAL PRIMARY KEY,
  transaction_id        INT REFERENCES transactions(id) ON DELETE CASCADE,
  property_id           INT REFERENCES properties(id),
  agent_id              INT REFERENCES agents(id),
  -- Listing details
  mls_number            VARCHAR(20),
  listing_number        VARCHAR(50),
  list_price            DECIMAL(12,2),
  list_date             DATE,
  expiry_date           DATE,
  possession_date       DATE,
  relist                BOOLEAN,
  lockbox               VARCHAR(50),
  -- Goods & inclusions
  attached_goods_excluded TEXT,
  unattached_goods      TEXT,
  -- Schedules
  condo_schedule        BOOLEAN,
  country_res_schedule  BOOLEAN,
  -- Disclosures
  material_defects      BOOLEAN,
  expensive_defects     BOOLEAN,
  govt_notices          BOOLEAN,
  lack_permits          BOOLEAN,
  -- Hold harmless
  vacant_hold_harmless  BOOLEAN,
  covid_hold_harmless   BOOLEAN,
  created_at            TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- RESIDENTIAL AGREEMENT TABLES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE buyer_rep (
  id                  SERIAL PRIMARY KEY,
  transaction_id      INT REFERENCES transactions(id) ON DELETE CASCADE,
  party_id            INT REFERENCES parties(id),
  agent_id            INT REFERENCES agents(id),
  brokerage_id        INT REFERENCES brokerages(id),
  -- Agency period
  start_date          DATE,
  start_time          TIME,
  end_date            DATE,
  end_time            TIME,
  -- Search criteria
  property_type       TEXT,
  market_areas        TEXT,
  -- Fee structure
  fee_amount          TEXT,
  retainer_amount     DECIMAL(10,2),
  retainer_due_date   DATE,
  retainer_refund_days INT,
  refund_excess_days  INT,
  fee_payment_days    INT,
  balance_owing_days  INT,
  holdover_days       INT,
  holdover_offer_days INT,
  reasonable_expenses BOOLEAN,
  other_fee_terms     TEXT,
  -- Services
  other_services      TEXT,
  -- Admin
  additional_terms    TEXT,
  attached_docs       TEXT,
  signing_date        DATE,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE seller_rep (
  id                  SERIAL PRIMARY KEY,
  transaction_id      INT REFERENCES transactions(id) ON DELETE CASCADE,
  party_id            INT REFERENCES parties(id),
  agent_id            INT REFERENCES agents(id),
  brokerage_id        INT REFERENCES brokerages(id),
  -- Agency period
  start_date          DATE,
  start_time          TIME,
  end_date            DATE,
  end_time            TIME,
  -- Fee structure
  fee_amount          TEXT,
  coop_fee            TEXT,
  balance_days        INT,
  holdover_days       INT,
  holdover_offer_days INT,
  reasonable_expenses BOOLEAN,
  -- Services
  service_b           TEXT,
  service_c           TEXT,
  service_d           TEXT,
  -- Admin
  additional_terms    TEXT,
  attached_docs       TEXT,
  dower_date          DATE,
  signing_date        DATE,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE seller_rep_amendments (
  id                  SERIAL PRIMARY KEY,
  seller_rep_id       INT REFERENCES seller_rep(id) ON DELETE CASCADE,
  agreement_number    VARCHAR(50),
  original_agreement  TEXT,
  listing_number      VARCHAR(50),
  effective_datetime  TIMESTAMP,
  amended_end_datetime TIMESTAMP,
  amended_price       DECIMAL(12,2),
  other_amendments    TEXT,
  signing_date        DATE,
  created_at          TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- CONDITIONS TABLE
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE conditions (
  id                        SERIAL PRIMARY KEY,
  transaction_id            INT REFERENCES transactions(id) ON DELETE CASCADE,
  -- Buyer conditions
  financing_deadline        DATE,
  financing_deadline_time   TIME,
  financing_dp_pct          DECIMAL(5,2),
  inspection_deadline       DATE,
  condo_docs_deadline       DATE,
  prop_schedule_deadline    DATE,
  prop_schedule_seller_deadline DATE,
  sale_property_deadline    DATE,
  buyer_additional          TEXT,
  buyer_additional_deadline DATE,
  buyer_additional_deadline_time TIME,
  -- Seller conditions
  seller_conditions         TEXT,
  seller_deadline           DATE,
  seller_deadline_time      TIME,
  -- Specialized
  subdivision_deadline      DATE,
  water_deadline            DATE,
  septic_deadline           DATE,
  created_at                TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- NOTICES TABLE
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE notices (
  id                  SERIAL PRIMARY KEY,
  transaction_id      INT REFERENCES transactions(id) ON DELETE CASCADE,
  notice_type         VARCHAR(50),  -- waiver, non_waiver, csd
  notice_party        VARCHAR(50),
  conditions_text     TEXT,
  signing_date        DATE,
  signing_time        TIME,
  signing_location    TEXT,
  signing_date_2      DATE,
  signing_time_2      TIME,
  signing_location_2  TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- OTHER RESIDENTIAL TABLES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE amendments (
  id                  SERIAL PRIMARY KEY,
  transaction_id      INT REFERENCES transactions(id) ON DELETE CASCADE,
  amendment_number    VARCHAR(50),
  delete_text         TEXT,
  insert_text         TEXT,
  signing_date        DATE,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE addendums (
  id                  SERIAL PRIMARY KEY,
  transaction_id      INT REFERENCES transactions(id) ON DELETE CASCADE,
  agreement_number    VARCHAR(50),
  original_agreement  TEXT,
  additional_terms    TEXT,
  buyer_signing_date  DATE,
  seller_signing_date DATE,
  party_signing_date  DATE,
  brokerage_signing_date DATE,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE remuneration (
  id                  SERIAL PRIMARY KEY,
  transaction_id      INT REFERENCES transactions(id) ON DELETE CASCADE,
  calculation         TEXT,
  signing_date        DATE,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE dual_agency (
  id                  SERIAL PRIMARY KEY,
  transaction_id      INT REFERENCES transactions(id) ON DELETE CASCADE,
  agreement_number    VARCHAR(50),
  rep_2_name          VARCHAR(255),
  rep_2_phone         VARCHAR(20),
  rep_2_fax           VARCHAR(20),
  rep_2_email         VARCHAR(255),
  signing_date        DATE,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conditional_sale (
  id                        SERIAL PRIMARY KEY,
  transaction_id            INT REFERENCES transactions(id) ON DELETE CASCADE,
  agreement_number          VARCHAR(50),
  seller_brokerage_agreement TEXT,
  disclose_on_showing       BOOLEAN,
  disclose_in_remarks       BOOLEAN,
  disclose_if_asked         BOOLEAN,
  do_not_disclose           BOOLEAN,
  signing_date              DATE,
  signing_location          TEXT,
  created_at                TIMESTAMP DEFAULT NOW()
);

-- Consent tables (Non-Canadian Act compliance)
CREATE TABLE consent_individual (
  id              SERIAL PRIMARY KEY,
  transaction_id  INT REFERENCES transactions(id) ON DELETE CASCADE,
  party_id        INT REFERENCES parties(id),
  date            DATE,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE consent_entity (
  id              SERIAL PRIMARY KEY,
  transaction_id  INT REFERENCES transactions(id) ON DELETE CASCADE,
  party_id        INT REFERENCES parties(id),
  date            DATE,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- COMMERCIAL TABLES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE commercial_transactions (
  id                      SERIAL PRIMARY KEY,
  transaction_id          INT REFERENCES transactions(id) ON DELETE CASCADE,
  -- Buyer/seller alternates
  alt_buyer_name          VARCHAR(255),
  alt_buyer_address       TEXT,
  alt_buyer_phone         VARCHAR(20),
  alt_buyer_fax           VARCHAR(20),
  alt_buyer_email         VARCHAR(255),
  alt_seller_name         VARCHAR(255),
  alt_seller_address      TEXT,
  alt_seller_phone        VARCHAR(20),
  alt_seller_fax          VARCHAR(20),
  alt_seller_email        VARCHAR(255),
  -- Commercial-specific
  buyer_gst_status        VARCHAR(50),
  disclosure_days         INT,
  accepted_encumbrances   TEXT,
  accepted_tenancies      TEXT,
  additional_disclosure_docs TEXT,
  -- Attachment checkboxes
  attach_cert_title       BOOLEAN,
  attach_condo_docs       BOOLEAN,
  attach_condo_schedule   BOOLEAN,
  attach_tenancies        BOOLEAN,
  created_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commercial_conditions (
  id                      SERIAL PRIMARY KEY,
  transaction_id          INT REFERENCES transactions(id) ON DELETE CASCADE,
  due_diligence_deadline  DATE,
  due_diligence_deadline_time TIME,
  created_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commercial_buyer_rep (
  id                      SERIAL PRIMARY KEY,
  transaction_id          INT REFERENCES transactions(id) ON DELETE CASCADE,
  -- Agency period
  start_date              DATE,
  start_time              TIME,
  end_date                DATE,
  end_time                TIME,
  disclosure_date         DATE,
  disclosure_time         TIME,
  -- Search criteria
  property_type           TEXT,
  market_areas            TEXT,
  -- Fee
  fee_amount              TEXT,
  retainer_amount         DECIMAL(10,2),
  retainer_due_date       DATE,
  reasonable_expenses     TEXT,
  other_fee_terms         TEXT,
  -- Services
  service_inspections     BOOLEAN,
  service_appraisals      BOOLEAN,
  service_advertise       BOOLEAN,
  service_d               TEXT,
  service_e               TEXT,
  -- Admin
  additional_terms        TEXT,
  attached_docs           TEXT,
  signing_date            DATE,
  -- Termination
  terminated_agreement    TEXT,
  termination_date        DATE,
  termination_time        TIME,
  termination_conditional BOOLEAN,
  termination_unconditional BOOLEAN,
  termination_terms       TEXT,
  termination_signing_date DATE,
  created_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commercial_buyer_amendments (
  id                      SERIAL PRIMARY KEY,
  buyer_rep_id            INT REFERENCES commercial_buyer_rep(id) ON DELETE CASCADE,
  original_agreement      TEXT,
  effective_time          TIME,
  effective_date          DATE,
  amended_end_time        TIME,
  amended_end_date        DATE,
  amended_property_type   TEXT,
  amended_market_areas    TEXT,
  other_amendments        TEXT,
  signing_date            DATE,
  created_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commercial_landlord_rep (
  id                      SERIAL PRIMARY KEY,
  transaction_id          INT REFERENCES transactions(id) ON DELETE CASCADE,
  -- Property
  premises_area_sqft      DECIMAL(10,2),
  currently_listed        BOOLEAN,
  proposed_possession_date DATE,
  listing_number          VARCHAR(50),
  -- Rental rate
  annual_basic_rent_sqft  DECIMAL(10,2),
  monthly_rent            DECIMAL(12,2),
  additional_rent_amount  DECIMAL(12,2),
  budget_years            INT,
  tenant_utilities        TEXT,
  preferred_lease_term_months INT,
  options_to_extend       INT,
  tenant_inducements      TEXT,
  -- Agency period
  start_date              DATE,
  start_time              TIME,
  end_date                DATE,
  end_time                TIME,
  -- Services
  service_title_search    BOOLEAN,
  service_signs           BOOLEAN,
  service_advertise       BOOLEAN,
  service_show            BOOLEAN,
  service_e               TEXT,
  service_f               TEXT,
  -- Fee structure
  fee_pct_initial         DECIMAL(5,2),
  fee_net_or_gross_initial VARCHAR(10),
  fee_initial_years       INT,
  fee_pct_beyond          DECIMAL(5,2),
  fee_net_or_gross_beyond VARCHAR(10),
  fee_beyond_years        INT,
  fee_minimum             DECIMAL(12,2),
  coop_fee_amount         DECIMAL(12,2),
  coop_fee_pct            DECIMAL(5,2),
  renewal_fee_pct         DECIMAL(5,2),
  renewal_net_or_gross    VARCHAR(10),
  renewal_first_years     INT,
  renewal_beyond_pct      DECIMAL(5,2),
  renewal_beyond_years    INT,
  reasonable_expenses     TEXT,
  -- Disclosures
  defects_material        BOOLEAN,
  defects_expensive       BOOLEAN,
  govt_notices            BOOLEAN,
  lack_permits            BOOLEAN,
  -- Admin
  additional_terms        TEXT,
  attached_docs           TEXT,
  signing_date            DATE,
  created_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commercial_landlord_amendments (
  id                      SERIAL PRIMARY KEY,
  landlord_rep_id         INT REFERENCES commercial_landlord_rep(id) ON DELETE CASCADE,
  original_agreement      TEXT,
  effective_date          DATE,
  effective_time          TIME,
  amended_end_date        DATE,
  amended_end_time        TIME,
  amended_rate            TEXT,
  other_amendments        TEXT,
  signing_date            DATE,
  created_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commercial_landlord_appendix (
  id                      SERIAL PRIMARY KEY,
  landlord_rep_id         INT REFERENCES commercial_landlord_rep(id) ON DELETE CASCADE,
  agreement_number        VARCHAR(50),
  owner_on_title          TEXT,
  expenses                TEXT,
  -- Expense grid (32 individual boolean columns)
  exp_biz_tax_l BOOLEAN, exp_biz_tax_t BOOLEAN, exp_biz_tax_p BOOLEAN,
  exp_prop_tax_l BOOLEAN, exp_prop_tax_t BOOLEAN, exp_prop_tax_p BOOLEAN,
  exp_ll_ins_l BOOLEAN, exp_ll_ins_t BOOLEAN, exp_ll_ins_p BOOLEAN,
  exp_tn_ins_l BOOLEAN, exp_tn_ins_t BOOLEAN, exp_tn_ins_p BOOLEAN,
  exp_glass_l BOOLEAN, exp_glass_t BOOLEAN, exp_glass_p BOOLEAN,
  exp_electricity BOOLEAN, exp_water BOOLEAN, exp_gas BOOLEAN,
  exp_telephone BOOLEAN, exp_cable BOOLEAN, exp_waste BOOLEAN,
  exp_janitorial BOOLEAN, exp_landscape BOOLEAN, exp_prop_mgmt BOOLEAN,
  exp_internet BOOLEAN, exp_structural BOOLEAN, exp_roof BOOLEAN,
  exp_hvac BOOLEAN, exp_electrical BOOLEAN, exp_interior BOOLEAN,
  exp_other_nonstr BOOLEAN, exp_pavement BOOLEAN,
  signing_date            DATE,
  created_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commercial_dual_lt (
  id                      SERIAL PRIMARY KEY,
  transaction_id          INT REFERENCES transactions(id) ON DELETE CASCADE,
  signing_date            DATE,
  created_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commercial_offer_to_lease (
  id                      SERIAL PRIMARY KEY,
  transaction_id          INT REFERENCES transactions(id) ON DELETE CASCADE,
  -- Premises
  premises_type           VARCHAR(50),  -- entire, portion
  premises_sqft           DECIMAL(10,2),
  docs_brokerage          TEXT,
  -- Term
  term_years              INT,
  term_months             INT,
  commencement_date       DATE,
  expiry_date             DATE,
  -- Renewal
  renewal_notice_months   INT,
  renewal_options         INT,
  renewal_term_years      INT,
  arbitration_months      INT,
  -- Rent
  rent_schedule           JSONB,    -- variable rows: period, basic_rent, additional_rent
  estimated_operating_expenses DECIMAL(12,2),
  -- Inducements
  inducement_free_basic_rent   BOOLEAN,
  inducement_free_basic_period TEXT,
  inducement_free_addl_rent    BOOLEAN,
  inducement_free_addl_period  TEXT,
  inducement_tia_amount        DECIMAL(12,2),
  inducement_tia_condition     TEXT,
  inducement_other             TEXT,
  -- Deposit
  trustee                 VARCHAR(255),
  deposit_amount          DECIMAL(12,2),
  deposit_method          VARCHAR(100),
  deposit_deadline_time   TIME,
  deposit_deadline_date   DATE,
  deposit_months_applied  INT,
  additional_security     TEXT,
  -- Work & possession
  fixturing_period_days   INT,
  -- Parking
  parking_underground     INT,
  parking_aboveground     INT,
  parking_assignment      VARCHAR(50),  -- assigned, unassigned
  parking_stall_numbers   TEXT,
  parking_underground_rate DECIMAL(10,2),
  parking_aboveground_rate DECIMAL(10,2),
  parking_monthly_fee     DECIMAL(10,2),
  parking_included        BOOLEAN,
  -- Signage
  tenant_signage          TEXT,
  signage_monthly_fee     DECIMAL(10,2),
  -- Use & exclusivity
  permitted_use           TEXT,
  exclusivity             TEXT,
  -- Conditions
  tenant_conditions       TEXT,
  tenant_condition_time   TIME,
  tenant_condition_date   DATE,
  landlord_credit_time    TIME,
  landlord_credit_date    DATE,
  tenant_info_days        INT,
  landlord_conditions     TEXT,
  landlord_condition_time TIME,
  landlord_condition_date DATE,
  -- Attachments
  attachments             JSONB,
  other_terms             TEXT,
  lease_delivery_days     INT,
  lease_execution_days    INT,
  -- Offer/acceptance timestamps
  offer_deadline_time     TIME,
  offer_deadline_date     DATE,
  tenant_signing_time     TIME,
  tenant_signing_date     DATE,
  landlord_signing_time   TIME,
  landlord_signing_date   DATE,
  created_at              TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- INTERNAL / BROKERAGE TABLES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE referrals (
  id                    SERIAL PRIMARY KEY,
  transaction_id        INT REFERENCES transactions(id) ON DELETE CASCADE,
  type                  VARCHAR(10),  -- buy, list
  referred_date         DATE,
  -- Referrer (non-industry person)
  referrer_name         VARCHAR(255),
  referrer_address      TEXT,
  referrer_city         VARCHAR(100),
  referrer_province     VARCHAR(50),
  referrer_postal_code  VARCHAR(10),
  referrer_phone        VARCHAR(20),
  referrer_email        VARCHAR(255),
  -- Referred client
  client_name           VARCHAR(255),
  client_address        TEXT,
  client_city           VARCHAR(100),
  client_province       VARCHAR(50),
  client_postal_code    VARCHAR(10),
  client_email          VARCHAR(255),
  client_phone_1        VARCHAR(20),
  client_phone_2        VARCHAR(20),
  -- Fee
  fee_pct               DECIMAL(5,2),
  fee_fixed             DECIMAL(12,2),
  -- TIS referral section
  brokerage             VARCHAR(255),
  agent_name            VARCHAR(255),
  address               TEXT,
  city                  VARCHAR(100),
  postal_code           VARCHAR(10),
  email                 VARCHAR(255),
  amount                VARCHAR(50),
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commissions (
  id                      SERIAL PRIMARY KEY,
  transaction_id          INT REFERENCES transactions(id) ON DELETE CASCADE,
  total_commission        DECIMAL(12,2),
  listing_split_pct       DECIMAL(5,2),
  buying_split_pct        DECIMAL(5,2),
  additional_instructions TEXT,
  net_gst                 BOOLEAN,
  source_of_business      VARCHAR(255),
  created_at              TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- FINTRAC TABLES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE fintrac_records (
  id                    SERIAL PRIMARY KEY,
  transaction_id        INT REFERENCES transactions(id) ON DELETE CASCADE,
  party_id              INT REFERENCES parties(id),
  record_type           VARCHAR(50),
  -- Legacy columns (from original schema)
  verification_method   VARCHAR(50),
  verification_date     DATE,
  verified_by_agent_id  INT REFERENCES agents(id),
  is_pep                BOOLEAN,
  third_party_involved  BOOLEAN,
  risk_level            VARCHAR(20),
  -- Entity identification (FIN-BOR)
  entity_name TEXT,
  directors_names TEXT,
  trustees_names TEXT,
  trust_entity_trustees TEXT,
  entity_owners_25pct TEXT,
  share_owners_25pct TEXT,
  unit_owners_25pct TEXT,
  ownership_structure TEXT,
  is_registered_charity TEXT,
  solicits_donations TEXT,
  asked_entity_info BOOLEAN DEFAULT FALSE,
  has_minute_book BOOLEAN DEFAULT FALSE,
  has_shareholders_register BOOLEAN DEFAULT FALSE,
  has_annual_returns BOOLEAN DEFAULT FALSE,
  has_shareholder_agreement BOOLEAN DEFAULT FALSE,
  has_board_records BOOLEAN DEFAULT FALSE,
  has_trust_deed BOOLEAN DEFAULT FALSE,
  has_securities_register BOOLEAN DEFAULT FALSE,
  has_articles_incorporation BOOLEAN DEFAULT FALSE,
  has_cert_corporate_status BOOLEAN DEFAULT FALSE,
  has_partnership_agreement BOOLEAN DEFAULT FALSE,
  accuracy_other_explain TEXT,
  checked_cra_charities BOOLEAN DEFAULT FALSE,
  accuracy_internet_search BOOLEAN DEFAULT FALSE,
  entity_signed_letter BOOLEAN DEFAULT FALSE,
  confirm_other_explain TEXT,
  measures_date DATE,
  verified_ceo_identity BOOLEAN DEFAULT FALSE,
  applied_special_measures BOOLEAN DEFAULT FALSE,
  -- Brokerage/admin (FIN-BRA)
  brokerage_name TEXT,
  compliance_officer TEXT,
  date_completed DATE,
  completed_by TEXT,
  -- Corporate identification (FIN-COR)
  property_address TEXT,
  rep_name TEXT,
  record_date DATE,
  corporation_name TEXT,
  corporate_address TEXT,
  principal_business TEXT,
  director_names TEXT,
  verification_record_type TEXT,
  verification_source TEXT,
  corp_registration_number TEXT,
  corp_records_attached BOOLEAN DEFAULT FALSE,
  other_entity_name TEXT,
  other_entity_address TEXT,
  other_entity_business TEXT,
  other_entity_verification_type TEXT,
  other_entity_record_source TEXT,
  other_entity_reg_number TEXT,
  -- Third party (shared FIN-COR/FIN-IND)
  has_third_party TEXT,
  third_party_reason TEXT,
  third_party_name TEXT,
  third_party_address TEXT,
  third_party_phone TEXT,
  third_party_dob DATE,
  third_party_occupation TEXT,
  third_party_reg_number TEXT,
  third_party_relationship TEXT,
  -- Risk assessment COR (q1-q17)
  risk_q1_previous_client TEXT,
  risk_q2_criminal_history TEXT,
  risk_q3_geographic_concern TEXT,
  risk_q4_border_proximity TEXT,
  risk_q5_canadian_corp TEXT,
  risk_q6_ministerial_directive TEXT,
  risk_q7_high_risk_country TEXT,
  risk_q8_concealed_identity TEXT,
  risk_q9_previous_str TEXT,
  risk_q10_unusual_transaction TEXT,
  risk_q11_third_party TEXT,
  risk_q12_non_face_to_face TEXT,
  risk_q13_cash_deposit TEXT,
  risk_q14_unusual_past TEXT,
  risk_q15_shell_company TEXT,
  risk_q16_cash_intensive TEXT,
  risk_q17_other_unusual TEXT,
  total_risk_score NUMERIC,
  business_purpose TEXT,
  business_purpose_other TEXT,
  business_dealings_desc TEXT,
  monitoring_measures TEXT,
  enhanced_measures TEXT,
  -- Managed Account Agreement (FIN-MAA)
  brokerage_address TEXT,
  agent_name TEXT,
  agent_address TEXT,
  effective_day TEXT,
  effective_year TEXT,
  compensation_details TEXT,
  execution_day TEXT,
  execution_month TEXT,
  execution_year TEXT,
  broker_signature TEXT,
  broker_sign_date DATE,
  agent_signature TEXT,
  agent_sign_date DATE,
  -- Individual identification (FIN-IND)
  individuals_to_identify TEXT,
  corps_to_identify TEXT,
  date_info_received DATE,
  date_info_referred DATE,
  method_photo_id BOOLEAN DEFAULT FALSE,
  method_credit_file BOOLEAN DEFAULT FALSE,
  method_dual_id BOOLEAN DEFAULT FALSE,
  date_verified DATE,
  individual_name TEXT,
  individual_address TEXT,
  individual_dob DATE,
  individual_occupation TEXT,
  id_type TEXT,
  id_type_other TEXT,
  id_number TEXT,
  id_jurisdiction TEXT,
  id_country TEXT,
  id_expiry DATE,
  credit_bureau_name TEXT,
  credit_file_ref TEXT,
  dual_id_name_dob BOOLEAN DEFAULT FALSE,
  dual_id_dob_source TEXT,
  dual_id_dob_account TEXT,
  dual_id_name_address BOOLEAN DEFAULT FALSE,
  dual_id_addr_source TEXT,
  dual_id_addr_account TEXT,
  dual_id_name_account BOOLEAN DEFAULT FALSE,
  dual_id_fin_source TEXT,
  dual_id_fin_acct_type TEXT,
  dual_id_fin_acct_num TEXT,
  -- Risk assessment IND (different numbering)
  risk_q5_canadian_citizen TEXT,
  risk_q6_domestic_pep TEXT,
  risk_q7_foreign_pep TEXT,
  risk_q8_ministerial_directive TEXT,
  risk_q9_high_risk_country TEXT,
  risk_q10_concealed_identity TEXT,
  risk_q11_previous_str TEXT,
  risk_q12_unusual_transaction TEXT,
  risk_q13_third_party TEXT,
  risk_q14_non_face_to_face TEXT,
  risk_q15_cash_deposit TEXT,
  risk_q16_unusual_past TEXT,
  -- PEP determination (FIN-PEP)
  pep_individual_name TEXT,
  is_foreign_pep BOOLEAN DEFAULT FALSE,
  is_domestic_pep BOOLEAN DEFAULT FALSE,
  is_hio BOOLEAN DEFAULT FALSE,
  pep_none_above BOOLEAN DEFAULT FALSE,
  pep_method_asked BOOLEAN DEFAULT FALSE,
  pep_method_internet BOOLEAN DEFAULT FALSE,
  pep_method_database BOOLEAN DEFAULT FALSE,
  pep_method_other TEXT,
  pep_determination_date DATE,
  pep_position TEXT,
  pep_organization TEXT,
  pep_domestic_high_risk TEXT,
  pep_source_wealth TEXT,
  pep_enhanced_measures_verified BOOLEAN DEFAULT FALSE,
  pep_100k_high_risk TEXT,
  pep_100k_source_cash TEXT,
  pep_100k_source_wealth TEXT,
  pep_100k_mgmt_reviewer TEXT,
  pep_100k_review_date DATE,
  -- Receipt of Funds (FIN-ROF) - 3 fund sources
  funds1_amount TEXT,
  funds1_currency TEXT,
  funds1_date DATE,
  funds1_type TEXT,
  funds1_type_other TEXT,
  funds1_method TEXT,
  funds1_method_other TEXT,
  funds1_purpose TEXT,
  funds1_exchange_rate TEXT,
  funds1_exchange_source TEXT,
  funds2_amount TEXT,
  funds2_currency TEXT,
  funds2_date DATE,
  funds2_type TEXT,
  funds2_type_other TEXT,
  funds2_method TEXT,
  funds2_method_other TEXT,
  funds2_purpose TEXT,
  funds2_exchange_rate TEXT,
  funds2_exchange_source TEXT,
  funds3_amount TEXT,
  funds3_currency TEXT,
  funds3_date DATE,
  funds3_type TEXT,
  funds3_type_other TEXT,
  funds3_method TEXT,
  funds3_method_other TEXT,
  funds3_purpose TEXT,
  funds3_exchange_rate TEXT,
  funds3_exchange_source TEXT,
  -- Accounts
  brokerage_ref_number TEXT,
  account1_number TEXT,
  account1_holder TEXT,
  account1_type TEXT,
  account1_type_other TEXT,
  account2_number TEXT,
  account2_holder TEXT,
  account2_type TEXT,
  account2_type_other TEXT,
  -- Funder identification
  funder_name TEXT,
  funder_address TEXT,
  funder_dob DATE,
  funder_occupation TEXT,
  funder_date_verified DATE,
  funder_id_type TEXT,
  funder_id_type_other TEXT,
  funder_id_number TEXT,
  funder_id_jurisdiction TEXT,
  funder_id_country TEXT,
  funder_id_expiry DATE,
  funder_credit_bureau TEXT,
  funder_credit_ref TEXT,
  funder_dual_dob_source TEXT,
  funder_dual_dob_account TEXT,
  funder_dual_addr_source TEXT,
  funder_dual_addr_account TEXT,
  funder_dual_fin_source TEXT,
  funder_dual_fin_type TEXT,
  funder_dual_fin_account TEXT,
  funder_corp_name TEXT,
  funder_corp_address TEXT,
  funder_corp_business TEXT,
  funder_corp_verification_type TEXT,
  funder_corp_verification_source TEXT,
  funder_corp_directors TEXT,
  funder_corp_reg_number TEXT,
  funder_corp_records_attached BOOLEAN DEFAULT FALSE,
  funder_entity_reg_number TEXT,
  -- Other person
  other_person_name TEXT,
  other_person_address TEXT,
  other_person_dob DATE,
  other_person_occupation TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- DOCUMENT & SIGNATURE TRACKING
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE documents (
  id                SERIAL PRIMARY KEY,
  transaction_id    INT REFERENCES transactions(id) ON DELETE CASCADE,
  form_code         VARCHAR(20) NOT NULL,  -- matches field mapping codes: RES-PC, INT-TIS, etc.
  form_name         VARCHAR(255),
  status            VARCHAR(50) DEFAULT 'draft',  -- draft, completed, signed, submitted
  generated_pdf_url TEXT,
  submitted_at      TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE signatures (
  id              SERIAL PRIMARY KEY,
  document_id     INT REFERENCES documents(id) ON DELETE CASCADE,
  field_id        VARCHAR(20),     -- e.g. RPC-88, maps to field mapping
  signer_name     VARCHAR(255),
  signer_role     VARCHAR(50),     -- buyer, seller, agent, broker
  signed_at       TIMESTAMP,
  signature_data  TEXT,            -- base64 or reference
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- AGENT AUTH & DEAL MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE agent_sessions (
  id              SERIAL PRIMARY KEY,
  agent_id        INT REFERENCES agents(id) ON DELETE CASCADE,
  session_token   VARCHAR(255) UNIQUE NOT NULL,
  expires_at      TIMESTAMP NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE deal_activity_log (
  id              SERIAL PRIMARY KEY,
  transaction_id  INT REFERENCES transactions(id) ON DELETE CASCADE,
  agent_id        INT REFERENCES agents(id),
  action          VARCHAR(100),  -- created, updated, form_generated, submitted_to_conveyancing
  details         JSONB,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_agent ON transactions(agent_id);
CREATE INDEX idx_transactions_property ON transactions(property_id);
CREATE INDEX idx_transaction_participants_txn ON transaction_participants(transaction_id);
CREATE INDEX idx_transaction_participants_role ON transaction_participants(role);
CREATE INDEX idx_listing_mls ON listing(mls_number);
CREATE INDEX idx_listing_transaction ON listing(transaction_id);
CREATE INDEX idx_documents_transaction ON documents(transaction_id);
CREATE INDEX idx_documents_form_code ON documents(form_code);
CREATE INDEX idx_fintrac_transaction ON fintrac_records(transaction_id);
CREATE INDEX idx_agent_sessions_token ON agent_sessions(session_token);
CREATE INDEX idx_deal_activity_transaction ON deal_activity_log(transaction_id);
CREATE INDEX idx_conditions_transaction ON conditions(transaction_id);
CREATE INDEX idx_referrals_transaction ON referrals(transaction_id);
CREATE INDEX idx_commissions_transaction ON commissions(transaction_id);

-- ═══════════════════════════════════════════════════════════════════
-- SEED: Noralta brokerage record
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO brokerages (name, address, city, postal_code, phone, email)
VALUES ('Royal LePage Noralta Real Estate', '3018 Calgary Trail NW', 'Edmonton', 'T6J 6V4', '780-431-5600', 'noraltadeals@royallepage.ca');
