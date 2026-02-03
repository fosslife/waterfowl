/**
 * PostgreSQL Seed Script for Waterfowl Database Manager
 *
 * This script creates tables covering many PostgreSQL data types and seeds them
 * with fake data for testing the GUI.
 *
 * Usage: tsx dev/seed.ts
 *
 * Environment variables (or edit CONFIG below):
 *   DATABASE_URL - PostgreSQL connection string
 *   SEED_COUNT   - Number of records per table (default: 100)
 */

import { Client } from "pg";
import { faker } from "@faker-js/faker";

// ============================================================================
// CONFIGURATION
// ============================================================================

const databaseUrl =
  "postgresql://postgres:postgres@localhost:5432/waterfowl_test";

const seedCount = 100;

const CONFIG = {
  // Connection string - override with DATABASE_URL env var
  connectionString: databaseUrl,

  // Number of records to generate per table - override with SEED_COUNT env var
  recordCount: seedCount,

  // Whether to drop existing tables before creating
  dropExisting: true,

  // Schema to use
  schema: "public",

  // Verbose logging
  verbose: true,
};

// ============================================================================
// HELPERS
// ============================================================================

function log(message: string) {
  if (CONFIG.verbose) {
    console.log(`[seed] ${message}`);
  }
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals: number = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSubset<T>(arr: T[], min: number = 1, max?: number): T[] {
  const maxCount = max ?? arr.length;
  const count = randomInt(min, maxCount);
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function generateUUID(): string {
  return faker.string.uuid();
}

function generateMacAddress(): string {
  return faker.internet.mac();
}

function generateIPv4(): string {
  return faker.internet.ipv4();
}

function generateIPv6(): string {
  return faker.internet.ipv6();
}

// ============================================================================
// SQL DEFINITIONS
// ============================================================================

const DROP_TABLES_SQL = `
-- Drop views first (they depend on tables)
DROP VIEW IF EXISTS v_user_stats CASCADE;
DROP VIEW IF EXISTS v_product_sales CASCADE;
DROP VIEW IF EXISTS v_active_sessions CASCADE;
DROP VIEW IF EXISTS v_order_summary CASCADE;
DROP VIEW IF EXISTS v_recent_reviews CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_product_rankings CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS fn_calculate_order_total CASCADE;
DROP FUNCTION IF EXISTS fn_get_user_stats CASCADE;
DROP FUNCTION IF EXISTS fn_update_timestamps CASCADE;
DROP FUNCTION IF EXISTS fn_validate_email CASCADE;
DROP FUNCTION IF EXISTS fn_generate_order_number CASCADE;

-- Drop custom sequences
DROP SEQUENCE IF EXISTS order_number_seq CASCADE;
DROP SEQUENCE IF EXISTS invoice_number_seq CASCADE;
DROP SEQUENCE IF EXISTS ticket_number_seq CASCADE;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS product_reviews CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS geo_locations CASCADE;
DROP TABLE IF EXISTS network_devices CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS time_series_data CASCADE;
DROP TABLE IF EXISTS config_settings CASCADE;
DROP TABLE IF EXISTS type_showcase CASCADE;

-- Drop custom types
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS order_status CASCADE;
DROP TYPE IF EXISTS priority_level CASCADE;
DROP TYPE IF EXISTS address_type CASCADE;
`;

const CREATE_TYPES_SQL = `
-- Custom ENUM types
CREATE TYPE user_role AS ENUM ('admin', 'moderator', 'user', 'guest', 'suspended');
CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
CREATE TYPE priority_level AS ENUM ('critical', 'high', 'medium', 'low', 'trivial');
CREATE TYPE address_type AS ENUM ('home', 'work', 'billing', 'shipping', 'other');
`;

const CREATE_TABLES_SQL = `
-- ==========================================================================
-- Table: users (core user table with various data types)
-- ==========================================================================
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid(),
  username        VARCHAR(50) NOT NULL UNIQUE,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   CHAR(60) NOT NULL,  -- bcrypt hash is always 60 chars
  role            user_role NOT NULL DEFAULT 'user',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_verified     BOOLEAN NOT NULL DEFAULT false,
  login_count     INTEGER NOT NULL DEFAULT 0,
  failed_attempts SMALLINT NOT NULL DEFAULT 0,
  credits         BIGINT NOT NULL DEFAULT 0,
  balance         NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  rating          REAL,
  score           DOUBLE PRECISION,
  tags            TEXT[] DEFAULT '{}',
  permissions     VARCHAR(50)[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  settings        JSON DEFAULT '{}',
  search_vector   TSVECTOR,
  last_login_ip   INET,
  registered_from CIDR,
  birth_date      DATE,
  preferred_time  TIME,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMPTZ,
  
  CONSTRAINT users_rating_check CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  CONSTRAINT users_balance_check CHECK (balance >= 0)
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_search ON users USING GIN(search_vector);
CREATE INDEX idx_users_tags ON users USING GIN(tags);
CREATE INDEX idx_users_metadata ON users USING GIN(metadata);

-- ==========================================================================
-- Table: user_profiles (1:1 relation with users, more data types)
-- ==========================================================================
CREATE TABLE user_profiles (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  display_name    TEXT,
  bio             TEXT,
  avatar_url      VARCHAR(500),
  cover_image     BYTEA,  -- Binary data for small images
  phone           VARCHAR(20),
  website         VARCHAR(255),
  company         VARCHAR(200),
  job_title       VARCHAR(100),
  address_type    address_type DEFAULT 'home',
  street_address  TEXT,
  city            VARCHAR(100),
  state           VARCHAR(100),
  country         CHAR(2),  -- ISO country code
  postal_code     VARCHAR(20),
  location        POINT,  -- Geometric point (lat, long)
  timezone        VARCHAR(50) DEFAULT 'UTC',
  locale          VARCHAR(10) DEFAULT 'en-US',
  currency        CHAR(3) DEFAULT 'USD',
  social_links    JSONB DEFAULT '{}',
  interests       TEXT[] DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_profiles_user ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_location ON user_profiles USING GIST(location);

-- ==========================================================================
-- Table: user_sessions (tracking sessions with time ranges)
-- ==========================================================================
CREATE TABLE user_sessions (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token   UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  ip_address      INET NOT NULL,
  user_agent      TEXT,
  device_info     JSONB DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  duration        INTERVAL  -- Calculated: ended_at - started_at (or use a view/trigger)
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_active ON user_sessions(is_active) WHERE is_active = true;

-- ==========================================================================
-- Table: categories (self-referential for hierarchy)
-- ==========================================================================
CREATE TABLE categories (
  id              SERIAL PRIMARY KEY,
  parent_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name            VARCHAR(100) NOT NULL,
  slug            VARCHAR(100) NOT NULL UNIQUE,
  description     TEXT,
  icon            VARCHAR(50),
  color           CHAR(7),  -- Hex color like #FF5733
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  metadata        JSONB DEFAULT '{}',
  path            TEXT[],  -- Materialized path for hierarchy
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_slug ON categories(slug);
CREATE INDEX idx_categories_path ON categories USING GIN(path);

-- ==========================================================================
-- Table: products (e-commerce example with many types)
-- ==========================================================================
CREATE TABLE products (
  id              SERIAL PRIMARY KEY,
  sku             VARCHAR(50) NOT NULL UNIQUE,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid(),
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) NOT NULL UNIQUE,
  description     TEXT,
  short_desc      VARCHAR(500),
  price           NUMERIC(10, 2) NOT NULL,
  compare_price   NUMERIC(10, 2),
  cost_price      NUMERIC(10, 2),
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  quantity        INTEGER NOT NULL DEFAULT 0,
  min_quantity    SMALLINT DEFAULT 1,
  max_quantity    SMALLINT,
  weight          REAL,  -- in kg
  dimensions      POINT,  -- width x height
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_featured     BOOLEAN NOT NULL DEFAULT false,
  is_digital      BOOLEAN NOT NULL DEFAULT false,
  tax_rate        NUMERIC(5, 4) DEFAULT 0.0000,
  tags            TEXT[] DEFAULT '{}',
  attributes      JSONB DEFAULT '{}',
  variants        JSONB DEFAULT '[]',
  images          TEXT[] DEFAULT '{}',
  rating_avg      NUMERIC(3, 2) DEFAULT 0.00,
  rating_count    INTEGER DEFAULT 0,
  view_count      BIGINT DEFAULT 0,
  sale_count      INTEGER DEFAULT 0,
  search_vector   TSVECTOR,
  valid_from      DATE,
  valid_until     DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT products_price_check CHECK (price >= 0),
  CONSTRAINT products_quantity_check CHECK (quantity >= 0),
  CONSTRAINT products_compare_check CHECK (compare_price IS NULL OR compare_price >= price)
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_products_search ON products USING GIN(search_vector);
CREATE INDEX idx_products_tags ON products USING GIN(tags);
CREATE INDEX idx_products_active ON products(is_active) WHERE is_active = true;

-- ==========================================================================
-- Table: product_reviews (reviews with various constraints)
-- ==========================================================================
CREATE TABLE product_reviews (
  id              BIGSERIAL PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating          SMALLINT NOT NULL,
  title           VARCHAR(200),
  content         TEXT,
  pros            TEXT[] DEFAULT '{}',
  cons            TEXT[] DEFAULT '{}',
  is_verified     BOOLEAN NOT NULL DEFAULT false,
  is_featured     BOOLEAN NOT NULL DEFAULT false,
  helpful_count   INTEGER NOT NULL DEFAULT 0,
  report_count    INTEGER NOT NULL DEFAULT 0,
  images          TEXT[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT reviews_rating_check CHECK (rating >= 1 AND rating <= 5),
  CONSTRAINT reviews_unique_user_product UNIQUE (product_id, user_id)
);

CREATE INDEX idx_reviews_product ON product_reviews(product_id);
CREATE INDEX idx_reviews_user ON product_reviews(user_id);
CREATE INDEX idx_reviews_rating ON product_reviews(rating);

-- ==========================================================================
-- Table: orders (order management with status tracking)
-- ==========================================================================
CREATE TABLE orders (
  id              BIGSERIAL PRIMARY KEY,
  order_number    VARCHAR(50) NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status          order_status NOT NULL DEFAULT 'pending',
  priority        priority_level NOT NULL DEFAULT 'medium',
  subtotal        NUMERIC(12, 2) NOT NULL,
  tax_amount      NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  shipping_cost   NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  total_amount    NUMERIC(12, 2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  payment_method  VARCHAR(50),
  payment_id      VARCHAR(100),
  is_paid         BOOLEAN NOT NULL DEFAULT false,
  paid_at         TIMESTAMPTZ,
  shipping_address JSONB,
  billing_address JSONB,
  notes           TEXT,
  internal_notes  TEXT,
  metadata        JSONB DEFAULT '{}',
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shipped_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  
  CONSTRAINT orders_total_check CHECK (total_amount >= 0)
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_number ON orders(order_number);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- ==========================================================================
-- Table: order_items (many-to-many between orders and products)
-- ==========================================================================
CREATE TABLE order_items (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity        SMALLINT NOT NULL DEFAULT 1,
  unit_price      NUMERIC(10, 2) NOT NULL,
  total_price     NUMERIC(12, 2) NOT NULL,
  discount        NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  tax_rate        NUMERIC(5, 4) NOT NULL DEFAULT 0.0000,
  tax_amount      NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  product_data    JSONB NOT NULL,  -- Snapshot of product at time of order
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT order_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT order_items_price_check CHECK (unit_price >= 0)
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- ==========================================================================
-- Table: audit_logs (immutable audit trail)
-- ==========================================================================
CREATE TABLE audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  event_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(50) NOT NULL,
  entity_type     VARCHAR(50) NOT NULL,
  entity_id       VARCHAR(100),
  old_values      JSONB,
  new_values      JSONB,
  changes         JSONB,
  ip_address      INET,
  user_agent      TEXT,
  session_id      UUID,
  metadata        JSONB DEFAULT '{}',
  severity        priority_level NOT NULL DEFAULT 'low',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_event ON audit_logs(event_id);

-- ==========================================================================
-- Table: geo_locations (geometric and geographic types)
-- ==========================================================================
CREATE TABLE geo_locations (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  point           POINT,
  line            LINE,
  line_segment    LSEG,
  box             BOX,
  path_open       PATH,
  path_closed     PATH,
  polygon         POLYGON,
  circle          CIRCLE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_geo_point ON geo_locations USING GIST(point);
CREATE INDEX idx_geo_box ON geo_locations USING GIST(box);

-- ==========================================================================
-- Table: network_devices (network-related types)
-- ==========================================================================
CREATE TABLE network_devices (
  id              SERIAL PRIMARY KEY,
  hostname        VARCHAR(255) NOT NULL,
  mac_address     MACADDR NOT NULL,
  mac_address_8   MACADDR8,
  ip_address      INET NOT NULL,
  subnet          CIDR,
  gateway         INET,
  dns_servers     INET[] DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  device_type     VARCHAR(50),
  manufacturer    VARCHAR(100),
  model           VARCHAR(100),
  firmware        VARCHAR(50),
  last_seen       TIMESTAMPTZ,
  config          JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_network_ip ON network_devices(ip_address);
CREATE INDEX idx_network_mac ON network_devices(mac_address);

-- ==========================================================================
-- Table: documents (text search and binary data)
-- ==========================================================================
CREATE TABLE documents (
  id              SERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid(),
  title           VARCHAR(500) NOT NULL,
  content         TEXT,
  summary         TEXT,
  file_data       BYTEA,
  file_name       VARCHAR(255),
  file_type       VARCHAR(50),
  file_size       BIGINT,
  checksum        CHAR(64),  -- SHA-256 hash
  language        CHAR(2) DEFAULT 'en',
  search_vector   TSVECTOR,
  keywords        TEXT[] DEFAULT '{}',
  categories      INTEGER[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  is_published    BOOLEAN NOT NULL DEFAULT false,
  published_at    TIMESTAMPTZ,
  author_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_documents_search ON documents USING GIN(search_vector);
CREATE INDEX idx_documents_keywords ON documents USING GIN(keywords);
CREATE INDEX idx_documents_author ON documents(author_id);

-- ==========================================================================
-- Table: time_series_data (time-based data with ranges)
-- ==========================================================================
CREATE TABLE time_series_data (
  id              BIGSERIAL PRIMARY KEY,
  sensor_id       VARCHAR(50) NOT NULL,
  metric_name     VARCHAR(100) NOT NULL,
  value           DOUBLE PRECISION NOT NULL,
  unit            VARCHAR(20),
  quality         SMALLINT DEFAULT 100,
  int_range       INT4RANGE,
  bigint_range    INT8RANGE,
  numeric_range   NUMRANGE,
  timestamp_range TSRANGE,
  timestamptz_range TSTZRANGE,
  date_range      DATERANGE,
  tags            TEXT[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_timeseries_sensor ON time_series_data(sensor_id);
CREATE INDEX idx_timeseries_metric ON time_series_data(metric_name);
CREATE INDEX idx_timeseries_recorded ON time_series_data(recorded_at DESC);
CREATE INDEX idx_timeseries_int_range ON time_series_data USING GIST(int_range);
CREATE INDEX idx_timeseries_date_range ON time_series_data USING GIST(date_range);

-- ==========================================================================
-- Table: config_settings (key-value with various types)
-- ==========================================================================
CREATE TABLE config_settings (
  id              SERIAL PRIMARY KEY,
  key             VARCHAR(100) NOT NULL UNIQUE,
  value           TEXT,
  value_type      VARCHAR(20) NOT NULL DEFAULT 'string',
  default_value   TEXT,
  description     TEXT,
  category        VARCHAR(50),
  is_secret       BOOLEAN NOT NULL DEFAULT false,
  is_readonly     BOOLEAN NOT NULL DEFAULT false,
  validation      JSONB,  -- JSON Schema for validation
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_config_key ON config_settings(key);
CREATE INDEX idx_config_category ON config_settings(category);

-- ==========================================================================
-- Table: type_showcase (demonstration of all remaining types)
-- ==========================================================================
CREATE TABLE type_showcase (
  id                  SERIAL PRIMARY KEY,
  
  -- Numeric types
  col_smallint        SMALLINT,
  col_integer         INTEGER,
  col_bigint          BIGINT,
  col_decimal         DECIMAL(20, 10),
  col_numeric         NUMERIC(15, 5),
  col_real            REAL,
  col_double          DOUBLE PRECISION,
  col_smallserial     SMALLSERIAL,
  col_serial          SERIAL,
  col_bigserial       BIGSERIAL,
  
  -- Monetary
  col_money           MONEY,
  
  -- Character types
  col_char            CHAR(10),
  col_varchar         VARCHAR(255),
  col_text            TEXT,
  
  -- Binary
  col_bytea           BYTEA,
  
  -- Date/Time
  col_timestamp       TIMESTAMP,
  col_timestamptz     TIMESTAMPTZ,
  col_date            DATE,
  col_time            TIME,
  col_timetz          TIMETZ,
  col_interval        INTERVAL,
  
  -- Boolean
  col_boolean         BOOLEAN,
  
  -- Geometric
  col_point           POINT,
  col_line            LINE,
  col_lseg            LSEG,
  col_box             BOX,
  col_path            PATH,
  col_polygon         POLYGON,
  col_circle          CIRCLE,
  
  -- Network
  col_cidr            CIDR,
  col_inet            INET,
  col_macaddr         MACADDR,
  col_macaddr8        MACADDR8,
  
  -- Bit String
  col_bit             BIT(8),
  col_varbit          BIT VARYING(64),
  
  -- Text Search
  col_tsvector        TSVECTOR,
  col_tsquery         TSQUERY,
  
  -- UUID
  col_uuid            UUID,
  
  -- XML (if supported)
  -- col_xml          XML,
  
  -- JSON
  col_json            JSON,
  col_jsonb           JSONB,
  
  -- Arrays
  col_int_array       INTEGER[],
  col_text_array      TEXT[],
  col_json_array      JSONB[],
  
  -- Range types
  col_int4range       INT4RANGE,
  col_int8range       INT8RANGE,
  col_numrange        NUMRANGE,
  col_tsrange         TSRANGE,
  col_tstzrange       TSTZRANGE,
  col_daterange       DATERANGE,
  
  -- Enum (custom type)
  col_enum            user_role,
  
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

// ============================================================================
// VIEWS SQL
// ============================================================================

const CREATE_VIEWS_SQL = `
-- View: User statistics summary
CREATE VIEW v_user_stats AS
SELECT 
    u.id,
    u.username,
    u.email,
    u.role,
    u.is_active,
    u.login_count,
    u.balance,
    u.rating,
    u.created_at,
    p.first_name,
    p.last_name,
    p.city,
    p.country,
    COUNT(DISTINCT o.id) as total_orders,
    COALESCE(SUM(o.total_amount), 0) as total_spent,
    COUNT(DISTINCT pr.id) as total_reviews
FROM users u
LEFT JOIN user_profiles p ON u.id = p.user_id
LEFT JOIN orders o ON u.id = o.user_id
LEFT JOIN product_reviews pr ON u.id = pr.user_id
GROUP BY u.id, p.id;

-- View: Product sales summary
CREATE VIEW v_product_sales AS
SELECT 
    p.id,
    p.name,
    p.sku,
    p.price,
    p.quantity as stock,
    c.name as category_name,
    p.rating_avg,
    p.rating_count,
    p.view_count,
    p.sale_count,
    COALESCE(SUM(oi.quantity), 0) as units_sold,
    COALESCE(SUM(oi.total_price), 0) as revenue
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN order_items oi ON p.id = oi.product_id
GROUP BY p.id, c.id;

-- View: Active user sessions
CREATE VIEW v_active_sessions AS
SELECT 
    s.id,
    s.user_id,
    u.username,
    u.email,
    s.ip_address,
    s.user_agent,
    s.device_info,
    s.started_at,
    s.expires_at,
    EXTRACT(epoch FROM (NOW() - s.started_at)) / 60 as session_minutes
FROM user_sessions s
JOIN users u ON s.user_id = u.id
WHERE s.is_active = true AND s.expires_at > NOW();

-- View: Order summary
CREATE VIEW v_order_summary AS
SELECT 
    o.id,
    o.order_number,
    u.username,
    u.email,
    o.status,
    o.priority,
    o.subtotal,
    o.tax_amount,
    o.shipping_cost,
    o.discount_amount,
    o.total_amount,
    o.is_paid,
    o.created_at,
    o.shipped_at,
    o.delivered_at,
    COUNT(oi.id) as item_count,
    SUM(oi.quantity) as total_items
FROM orders o
JOIN users u ON o.user_id = u.id
LEFT JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.id, u.id;

-- View: Recent product reviews
CREATE VIEW v_recent_reviews AS
SELECT 
    pr.id,
    pr.rating,
    pr.title,
    pr.content,
    pr.created_at,
    p.name as product_name,
    p.sku as product_sku,
    u.username as reviewer_username,
    pr.is_verified,
    pr.helpful_count
FROM product_reviews pr
JOIN products p ON pr.product_id = p.id
JOIN users u ON pr.user_id = u.id
WHERE pr.created_at > NOW() - INTERVAL '30 days'
ORDER BY pr.created_at DESC;
`;

// ============================================================================
// FUNCTIONS SQL
// ============================================================================

const CREATE_FUNCTIONS_SQL = `
-- Function: Calculate order total
CREATE OR REPLACE FUNCTION fn_calculate_order_total(p_order_id BIGINT)
RETURNS NUMERIC(12,2) AS $$
DECLARE
    v_total NUMERIC(12,2);
BEGIN
    SELECT COALESCE(SUM(total_price), 0)
    INTO v_total
    FROM order_items
    WHERE order_id = p_order_id;
    
    RETURN v_total;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Get user statistics
CREATE OR REPLACE FUNCTION fn_get_user_stats(p_user_id INTEGER)
RETURNS TABLE(
    total_orders BIGINT,
    total_spent NUMERIC,
    avg_order_value NUMERIC,
    total_reviews BIGINT,
    avg_rating NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT o.id)::BIGINT as total_orders,
        COALESCE(SUM(o.total_amount), 0)::NUMERIC as total_spent,
        COALESCE(AVG(o.total_amount), 0)::NUMERIC as avg_order_value,
        COUNT(DISTINCT pr.id)::BIGINT as total_reviews,
        COALESCE(AVG(pr.rating), 0)::NUMERIC as avg_rating
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    LEFT JOIN product_reviews pr ON u.id = pr.user_id
    WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Update timestamps trigger function
CREATE OR REPLACE FUNCTION fn_update_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function: Validate email format
CREATE OR REPLACE FUNCTION fn_validate_email(p_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN p_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Generate unique order number
CREATE OR REPLACE FUNCTION fn_generate_order_number()
RETURNS TEXT AS $$
DECLARE
    v_prefix TEXT := 'ORD';
    v_year TEXT := TO_CHAR(CURRENT_DATE, 'YYYY');
    v_seq BIGINT;
BEGIN
    v_seq := nextval('order_number_seq');
    RETURN v_prefix || '-' || v_year || '-' || LPAD(v_seq::TEXT, 8, '0');
END;
$$ LANGUAGE plpgsql;
`;

// ============================================================================
// SEQUENCES SQL
// ============================================================================

const CREATE_SEQUENCES_SQL = `
-- Custom sequence for order numbers
CREATE SEQUENCE order_number_seq
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 10;

-- Custom sequence for invoice numbers
CREATE SEQUENCE invoice_number_seq
    START WITH 100000
    INCREMENT BY 1
    MINVALUE 100000
    MAXVALUE 999999999
    CYCLE
    CACHE 5;

-- Custom sequence for ticket/support numbers  
CREATE SEQUENCE ticket_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Advance sequences to have some initial values
SELECT nextval('order_number_seq') FROM generate_series(1, 50);
SELECT nextval('invoice_number_seq') FROM generate_series(1, 25);
SELECT nextval('ticket_number_seq') FROM generate_series(1, 100);
`;

// ============================================================================
// DATA GENERATORS
// ============================================================================

async function seedUsers(client: Client, count: number): Promise<number[]> {
  log(`Seeding ${count} users...`);
  const ids: number[] = [];
  const roles: string[] = ["admin", "moderator", "user", "guest", "suspended"];

  for (let i = 0; i < count; i++) {
    const username =
      faker.internet.username().toLowerCase().substring(0, 50) + i;
    const email = `user${i}_${faker.internet.email().toLowerCase()}`;
    const passwordHash = faker.string.alphanumeric(60);
    const role = randomElement(roles);
    const isActive = Math.random() > 0.1;
    const isVerified = Math.random() > 0.3;
    const loginCount = randomInt(0, 500);
    const failedAttempts = randomInt(0, 5);
    const credits = BigInt(randomInt(0, 1000000));
    const balance = randomFloat(0, 10000, 2);
    const rating = Math.random() > 0.2 ? randomFloat(1, 5, 2) : null;
    const score = Math.random() > 0.1 ? randomFloat(0, 100, 4) : null;
    const tags = randomSubset(
      ["premium", "verified", "beta", "early-adopter", "vip", "newsletter"],
      0,
      4
    );
    const permissions = randomSubset(
      ["read", "write", "delete", "admin", "export", "import"],
      1,
      4
    );
    const metadata = JSON.stringify({
      source: randomElement(["organic", "referral", "ad", "social"]),
      campaign: faker.string.alphanumeric(10),
      preferences: {
        theme: randomElement(["light", "dark", "system"]),
        notifications: Math.random() > 0.5,
      },
    });
    const settings = JSON.stringify({
      language: randomElement(["en", "es", "fr", "de", "ja"]),
      timezone: faker.location.timeZone(),
    });
    const searchVector = `'${username}':1 '${email.split("@")[0]}':2`;
    const lastLoginIp = Math.random() > 0.2 ? generateIPv4() : null;
    // CIDR requires host bits to be 0 - for /24, last octet must be 0
    const registeredFrom =
      Math.random() > 0.5
        ? `${randomInt(1, 223)}.${randomInt(0, 255)}.${randomInt(0, 255)}.0/24`
        : null;
    const birthDate =
      Math.random() > 0.3
        ? faker.date
            .birthdate({ min: 18, max: 80, mode: "age" })
            .toISOString()
            .split("T")[0]
        : null;
    const preferredTime =
      Math.random() > 0.4
        ? `${randomInt(0, 23).toString().padStart(2, "0")}:${randomInt(0, 59)
            .toString()
            .padStart(2, "0")}:00`
        : null;
    const createdAt = faker.date.past({ years: 3 }).toISOString();
    const updatedAt = faker.date.recent({ days: 90 }).toISOString();
    const deletedAt =
      !isActive && Math.random() > 0.5
        ? faker.date.recent({ days: 30 }).toISOString()
        : null;

    const result = await client.query(
      `
      INSERT INTO users (
        username, email, password_hash, role, is_active, is_verified,
        login_count, failed_attempts, credits, balance, rating, score,
        tags, permissions, metadata, settings, search_vector,
        last_login_ip, registered_from, birth_date, preferred_time,
        created_at, updated_at, deleted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13::text[], $14::varchar[], $15::jsonb, $16::json, $17::tsvector,
        $18::inet, $19::cidr, $20::date, $21::time,
        $22, $23, $24
      ) RETURNING id
    `,
      [
        username,
        email,
        passwordHash,
        role,
        isActive,
        isVerified,
        loginCount,
        failedAttempts,
        credits.toString(),
        balance,
        rating,
        score,
        tags,
        permissions,
        metadata,
        settings,
        searchVector,
        lastLoginIp,
        registeredFrom,
        birthDate,
        preferredTime,
        createdAt,
        updatedAt,
        deletedAt,
      ]
    );

    ids.push(result.rows[0].id);
  }

  log(`Created ${ids.length} users`);
  return ids;
}

async function seedUserProfiles(
  client: Client,
  userIds: number[]
): Promise<void> {
  log(`Seeding ${userIds.length} user profiles...`);
  const addressTypes = ["home", "work", "billing", "shipping", "other"];

  for (const userId of userIds) {
    const hasProfile = Math.random() > 0.1;
    if (!hasProfile) continue;

    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const location =
      Math.random() > 0.3
        ? `(${faker.location.longitude()},${faker.location.latitude()})`
        : null;
    const coverImage =
      Math.random() > 0.8 ? Buffer.from(faker.string.alphanumeric(100)) : null;

    await client.query(
      `
      INSERT INTO user_profiles (
        user_id, first_name, last_name, display_name, bio, avatar_url,
        cover_image, phone, website, company, job_title, address_type,
        street_address, city, state, country, postal_code, location,
        timezone, locale, currency, social_links, interests
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18::point, $19, $20, $21, $22::jsonb, $23::text[]
      )
    `,
      [
        userId,
        firstName,
        lastName,
        Math.random() > 0.3
          ? `${firstName} ${lastName}`
          : faker.internet.displayName(),
        Math.random() > 0.4 ? faker.lorem.paragraph() : null,
        Math.random() > 0.2 ? faker.image.avatar() : null,
        coverImage,
        Math.random() > 0.3 ? faker.phone.number().substring(0, 20) : null,
        Math.random() > 0.5 ? faker.internet.url() : null,
        Math.random() > 0.4 ? faker.company.name() : null,
        Math.random() > 0.4 ? faker.person.jobTitle() : null,
        randomElement(addressTypes),
        Math.random() > 0.3 ? faker.location.streetAddress() : null,
        Math.random() > 0.2 ? faker.location.city() : null,
        Math.random() > 0.3 ? faker.location.state() : null,
        faker.location.countryCode(),
        Math.random() > 0.3 ? faker.location.zipCode().substring(0, 20) : null,
        location,
        faker.location.timeZone().substring(0, 50),
        randomElement(["en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "ja-JP"]),
        randomElement(["USD", "EUR", "GBP", "JPY", "CAD"]),
        JSON.stringify({
          twitter: Math.random() > 0.5 ? faker.internet.username() : null,
          linkedin: Math.random() > 0.5 ? faker.internet.username() : null,
          github: Math.random() > 0.5 ? faker.internet.username() : null,
        }),
        randomSubset(
          [
            "technology",
            "sports",
            "music",
            "travel",
            "food",
            "gaming",
            "art",
            "science",
          ],
          0,
          5
        ),
      ]
    );
  }

  log("Created user profiles");
}

async function seedUserSessions(
  client: Client,
  userIds: number[],
  count: number
): Promise<void> {
  log(`Seeding ${count} user sessions...`);

  for (let i = 0; i < count; i++) {
    const userId = randomElement(userIds);
    const startedAt = faker.date.recent({ days: 30 });
    const expiresAt = new Date(
      startedAt.getTime() + randomInt(1, 24) * 60 * 60 * 1000
    );
    const isActive = Math.random() > 0.7;
    const durationMinutes = randomInt(1, 180);
    const endedAt = !isActive
      ? new Date(startedAt.getTime() + durationMinutes * 60 * 1000)
      : null;
    const duration = endedAt ? `${durationMinutes} minutes` : null;

    await client.query(
      `
      INSERT INTO user_sessions (
        user_id, ip_address, user_agent, device_info, is_active,
        started_at, expires_at, ended_at, duration
      ) VALUES ($1, $2::inet, $3, $4::jsonb, $5, $6, $7, $8, $9::interval)
    `,
      [
        userId,
        generateIPv4(),
        faker.internet.userAgent(),
        JSON.stringify({
          browser: randomElement(["Chrome", "Firefox", "Safari", "Edge"]),
          os: randomElement(["Windows", "macOS", "Linux", "iOS", "Android"]),
          device: randomElement(["desktop", "mobile", "tablet"]),
        }),
        isActive,
        startedAt.toISOString(),
        expiresAt.toISOString(),
        endedAt?.toISOString() || null,
        duration,
      ]
    );
  }

  log("Created user sessions");
}

async function seedCategories(
  client: Client,
  count: number
): Promise<number[]> {
  log(`Seeding ${count} categories...`);
  const ids: number[] = [];
  const colors = [
    "#FF5733",
    "#33FF57",
    "#3357FF",
    "#FF33F5",
    "#F5FF33",
    "#33FFF5",
    "#FF8C33",
    "#8C33FF",
  ];
  const icons = [
    "folder",
    "star",
    "heart",
    "tag",
    "bookmark",
    "flag",
    "box",
    "package",
  ];

  // Create root categories first
  const rootCount = Math.min(Math.ceil(count / 5), 10);
  for (let i = 0; i < rootCount; i++) {
    const name = faker.commerce.department();
    const slug = `${name.toLowerCase().replace(/\s+/g, "-")}-${i}`;

    const result = await client.query(
      `
      INSERT INTO categories (name, slug, description, icon, color, sort_order, path)
      VALUES ($1, $2, $3, $4, $5, $6, $7::text[])
      RETURNING id
    `,
      [
        name,
        slug,
        faker.commerce.productDescription(),
        randomElement(icons),
        randomElement(colors),
        i,
        [slug],
      ]
    );

    ids.push(result.rows[0].id);
  }

  // Create child categories
  for (let i = rootCount; i < count; i++) {
    const parentId = randomElement(ids.slice(0, Math.min(i, rootCount)));
    const name =
      faker.commerce.productAdjective() + " " + faker.commerce.product();
    const slug = `${name.toLowerCase().replace(/\s+/g, "-")}-${i}`;

    const result = await client.query(
      `
      INSERT INTO categories (parent_id, name, slug, description, icon, color, sort_order, path)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[])
      RETURNING id
    `,
      [
        parentId,
        name,
        slug,
        Math.random() > 0.3 ? faker.commerce.productDescription() : null,
        randomElement(icons),
        randomElement(colors),
        i,
        [slug],
      ]
    );

    ids.push(result.rows[0].id);
  }

  log(`Created ${ids.length} categories`);
  return ids;
}

async function seedProducts(
  client: Client,
  categoryIds: number[],
  count: number
): Promise<number[]> {
  log(`Seeding ${count} products...`);
  const ids: number[] = [];

  for (let i = 0; i < count; i++) {
    const name = faker.commerce.productName();
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${i}`;
    const price = parseFloat(faker.commerce.price({ min: 1, max: 1000 }));
    const comparePrice =
      Math.random() > 0.6 ? price * randomFloat(1.1, 1.5) : null;
    const costPrice =
      Math.random() > 0.4 ? price * randomFloat(0.3, 0.7) : null;
    const validFrom =
      Math.random() > 0.7
        ? faker.date.past({ years: 1 }).toISOString().split("T")[0]
        : null;
    const validUntil =
      validFrom && Math.random() > 0.5
        ? faker.date.future({ years: 1 }).toISOString().split("T")[0]
        : null;

    const result = await client.query(
      `
      INSERT INTO products (
        sku, category_id, name, slug, description, short_desc, price,
        compare_price, cost_price, quantity, min_quantity, max_quantity,
        weight, dimensions, is_active, is_featured, is_digital, tax_rate,
        tags, attributes, variants, images, rating_avg, rating_count,
        view_count, sale_count, search_vector, valid_from, valid_until
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::point,
        $15, $16, $17, $18, $19::text[], $20::jsonb, $21::jsonb, $22::text[],
        $23, $24, $25, $26, $27::tsvector, $28::date, $29::date
      ) RETURNING id
    `,
      [
        `SKU-${faker.string.alphanumeric(8).toUpperCase()}`,
        randomElement(categoryIds),
        name,
        slug,
        faker.commerce.productDescription(),
        faker.lorem.sentence(),
        price,
        comparePrice,
        costPrice,
        randomInt(0, 1000),
        randomInt(1, 5),
        Math.random() > 0.7 ? randomInt(10, 100) : null,
        Math.random() > 0.3 ? randomFloat(0.1, 50, 2) : null,
        Math.random() > 0.4
          ? `(${randomFloat(1, 100)},${randomFloat(1, 100)})`
          : null,
        Math.random() > 0.1,
        Math.random() > 0.8,
        Math.random() > 0.9,
        randomFloat(0, 0.25, 4),
        randomSubset(
          ["new", "sale", "bestseller", "limited", "exclusive", "eco-friendly"],
          0,
          3
        ),
        JSON.stringify({
          color: randomElement([
            "red",
            "blue",
            "green",
            "black",
            "white",
            null,
          ]),
          size: randomElement(["S", "M", "L", "XL", null]),
          material: faker.commerce.productMaterial(),
        }),
        JSON.stringify(
          Math.random() > 0.7
            ? [
                {
                  name: "Small",
                  price: price,
                  sku: `SKU-${faker.string.alphanumeric(8)}`,
                },
                {
                  name: "Large",
                  price: price * 1.2,
                  sku: `SKU-${faker.string.alphanumeric(8)}`,
                },
              ]
            : []
        ),
        Array.from({ length: randomInt(0, 5) }, () => faker.image.url()),
        randomFloat(0, 5, 2),
        randomInt(0, 500),
        BigInt(randomInt(0, 100000)).toString(),
        randomInt(0, 5000),
        `'${name.toLowerCase()}':1`,
        validFrom,
        validUntil,
      ]
    );

    ids.push(result.rows[0].id);
  }

  log(`Created ${ids.length} products`);
  return ids;
}

async function seedProductReviews(
  client: Client,
  productIds: number[],
  userIds: number[],
  count: number
): Promise<void> {
  log(`Seeding ${count} product reviews...`);
  const usedPairs = new Set<string>();
  let created = 0;

  for (let i = 0; i < count && created < count; i++) {
    const productId = randomElement(productIds);
    const userId = randomElement(userIds);
    const pairKey = `${productId}-${userId}`;

    if (usedPairs.has(pairKey)) continue;
    usedPairs.add(pairKey);

    await client.query(
      `
      INSERT INTO product_reviews (
        product_id, user_id, rating, title, content, pros, cons,
        is_verified, is_featured, helpful_count, report_count, images, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8, $9, $10, $11, $12::text[], $13::jsonb)
    `,
      [
        productId,
        userId,
        randomInt(1, 5),
        Math.random() > 0.2 ? faker.lorem.sentence() : null,
        Math.random() > 0.1 ? faker.lorem.paragraph() : null,
        randomSubset(
          [
            "Great quality",
            "Fast shipping",
            "Good value",
            "Easy to use",
            "Durable",
          ],
          0,
          3
        ),
        randomSubset(
          ["Expensive", "Slow delivery", "Poor packaging", "Difficult setup"],
          0,
          2
        ),
        Math.random() > 0.5,
        Math.random() > 0.9,
        randomInt(0, 100),
        randomInt(0, 10),
        Array.from({ length: randomInt(0, 3) }, () => faker.image.url()),
        JSON.stringify({ platform: randomElement(["web", "ios", "android"]) }),
      ]
    );

    created++;
  }

  log(`Created ${created} product reviews`);
}

async function seedOrders(
  client: Client,
  userIds: number[],
  productIds: number[],
  count: number
): Promise<void> {
  log(`Seeding ${count} orders...`);
  const statuses = [
    "pending",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "refunded",
  ];
  const priorities = ["critical", "high", "medium", "low", "trivial"];
  const paymentMethods = [
    "credit_card",
    "debit_card",
    "paypal",
    "bank_transfer",
    "crypto",
    "cash",
  ];

  for (let i = 0; i < count; i++) {
    const status = randomElement(statuses);
    const isPaid =
      ["shipped", "delivered"].includes(status) || Math.random() > 0.3;
    const createdAt = faker.date.past({ years: 2 });
    const shippedAt = ["shipped", "delivered"].includes(status)
      ? new Date(createdAt.getTime() + randomInt(1, 7) * 24 * 60 * 60 * 1000)
      : null;
    const deliveredAt =
      status === "delivered" && shippedAt
        ? new Date(shippedAt.getTime() + randomInt(1, 14) * 24 * 60 * 60 * 1000)
        : null;

    const subtotal = randomFloat(10, 5000, 2);
    const taxAmount = subtotal * randomFloat(0.05, 0.15, 2);
    const shippingCost = randomFloat(0, 50, 2);
    const discountAmount =
      Math.random() > 0.7 ? subtotal * randomFloat(0.05, 0.2, 2) : 0;
    const totalAmount = subtotal + taxAmount + shippingCost - discountAmount;

    const orderResult = await client.query(
      `
      INSERT INTO orders (
        order_number, user_id, status, priority, subtotal, tax_amount,
        shipping_cost, discount_amount, total_amount, payment_method,
        payment_id, is_paid, paid_at, shipping_address, billing_address,
        notes, internal_notes, metadata, ip_address, user_agent,
        created_at, shipped_at, delivered_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14::jsonb, $15::jsonb, $16, $17, $18::jsonb, $19::inet, $20,
        $21, $22, $23
      ) RETURNING id
    `,
      [
        `ORD-${faker.string.alphanumeric(12).toUpperCase()}`,
        randomElement(userIds),
        status,
        randomElement(priorities),
        subtotal,
        taxAmount,
        shippingCost,
        discountAmount,
        totalAmount,
        randomElement(paymentMethods),
        isPaid ? faker.string.alphanumeric(20) : null,
        isPaid,
        isPaid
          ? faker.date
              .between({ from: createdAt, to: new Date() })
              .toISOString()
          : null,
        JSON.stringify({
          name: faker.person.fullName(),
          street: faker.location.streetAddress(),
          city: faker.location.city(),
          state: faker.location.state(),
          country: faker.location.countryCode(),
          postal: faker.location.zipCode(),
        }),
        JSON.stringify({
          name: faker.person.fullName(),
          street: faker.location.streetAddress(),
          city: faker.location.city(),
          state: faker.location.state(),
          country: faker.location.countryCode(),
          postal: faker.location.zipCode(),
        }),
        Math.random() > 0.7 ? faker.lorem.sentence() : null,
        Math.random() > 0.8 ? faker.lorem.sentence() : null,
        JSON.stringify({ source: randomElement(["web", "mobile", "api"]) }),
        generateIPv4(),
        faker.internet.userAgent(),
        createdAt.toISOString(),
        shippedAt?.toISOString() || null,
        deliveredAt?.toISOString() || null,
      ]
    );

    // Add order items
    const itemCount = randomInt(1, 5);
    for (let j = 0; j < itemCount; j++) {
      const productId = randomElement(productIds);
      const quantity = randomInt(1, 5);
      const unitPrice = randomFloat(5, 500, 2);
      const discount =
        Math.random() > 0.8 ? unitPrice * randomFloat(0.05, 0.2, 2) : 0;
      const taxRate = randomFloat(0.05, 0.15, 4);
      const taxAmt = (unitPrice * quantity - discount) * taxRate;
      const totalPrice = unitPrice * quantity - discount + taxAmt;

      await client.query(
        `
        INSERT INTO order_items (
          order_id, product_id, quantity, unit_price, total_price,
          discount, tax_rate, tax_amount, product_data, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      `,
        [
          orderResult.rows[0].id,
          productId,
          quantity,
          unitPrice,
          totalPrice,
          discount,
          taxRate,
          taxAmt,
          JSON.stringify({
            name: faker.commerce.productName(),
            sku: `SKU-${faker.string.alphanumeric(8)}`,
            price: unitPrice,
          }),
          Math.random() > 0.9 ? faker.lorem.sentence() : null,
        ]
      );
    }
  }

  log(`Created ${count} orders with items`);
}

async function seedAuditLogs(
  client: Client,
  userIds: number[],
  count: number
): Promise<void> {
  log(`Seeding ${count} audit logs...`);
  const actions = [
    "create",
    "update",
    "delete",
    "login",
    "logout",
    "view",
    "export",
    "import",
    "approve",
    "reject",
  ];
  const entityTypes = [
    "user",
    "product",
    "order",
    "category",
    "review",
    "setting",
    "document",
  ];
  const severities = ["critical", "high", "medium", "low", "trivial"];

  for (let i = 0; i < count; i++) {
    await client.query(
      `
      INSERT INTO audit_logs (
        user_id, action, entity_type, entity_id, old_values, new_values,
        changes, ip_address, user_agent, metadata, severity
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::inet, $9, $10::jsonb, $11)
    `,
      [
        Math.random() > 0.1 ? randomElement(userIds) : null,
        randomElement(actions),
        randomElement(entityTypes),
        faker.string.alphanumeric(10),
        Math.random() > 0.5 ? JSON.stringify({ field: "old_value" }) : null,
        Math.random() > 0.5 ? JSON.stringify({ field: "new_value" }) : null,
        Math.random() > 0.6
          ? JSON.stringify([{ field: "field", from: "old", to: "new" }])
          : null,
        generateIPv4(),
        faker.internet.userAgent(),
        JSON.stringify({
          browser: randomElement(["Chrome", "Firefox", "Safari"]),
        }),
        randomElement(severities),
      ]
    );
  }

  log(`Created ${count} audit logs`);
}

async function seedGeoLocations(client: Client, count: number): Promise<void> {
  log(`Seeding ${count} geo locations...`);

  for (let i = 0; i < count; i++) {
    const x1 = randomFloat(-180, 180);
    const y1 = randomFloat(-90, 90);
    const x2 = randomFloat(-180, 180);
    const y2 = randomFloat(-90, 90);

    await client.query(
      `
      INSERT INTO geo_locations (
        name, description, point, line, line_segment, box, path_open,
        path_closed, polygon, circle, metadata
      ) VALUES (
        $1, $2, $3::point, $4::line, $5::lseg, $6::box, $7::path,
        $8::path, $9::polygon, $10::circle, $11::jsonb
      )
    `,
      [
        faker.location.city() + " " + faker.location.street(),
        faker.lorem.sentence(),
        `(${x1},${y1})`,
        `{${randomFloat(-1, 1)},${randomFloat(-1, 1)},${randomFloat(
          -100,
          100
        )}}`,
        `[(${x1},${y1}),(${x2},${y2})]`,
        `((${Math.min(x1, x2)},${Math.min(y1, y2)}),(${Math.max(
          x1,
          x2
        )},${Math.max(y1, y2)}))`,
        `[(${x1},${y1}),(${x2},${y2}),(${randomFloat(-180, 180)},${randomFloat(
          -90,
          90
        )})]`,
        `((${x1},${y1}),(${x2},${y2}),(${randomFloat(-180, 180)},${randomFloat(
          -90,
          90
        )}))`,
        `((${x1},${y1}),(${x2},${y2}),(${randomFloat(-180, 180)},${randomFloat(
          -90,
          90
        )}),(${x1},${y1}))`,
        `<(${x1},${y1}),${randomFloat(1, 100)}>`,
        JSON.stringify({
          type: randomElement(["city", "region", "country", "landmark"]),
        }),
      ]
    );
  }

  log(`Created ${count} geo locations`);
}

async function seedNetworkDevices(
  client: Client,
  count: number
): Promise<void> {
  log(`Seeding ${count} network devices...`);
  const deviceTypes = [
    "router",
    "switch",
    "server",
    "workstation",
    "printer",
    "phone",
    "iot",
    "camera",
  ];
  const manufacturers = [
    "Cisco",
    "Juniper",
    "HP",
    "Dell",
    "Apple",
    "Ubiquiti",
    "Netgear",
    "TP-Link",
  ];

  for (let i = 0; i < count; i++) {
    const ipBase = `192.168.${randomInt(0, 255)}`;

    await client.query(
      `
      INSERT INTO network_devices (
        hostname, mac_address, mac_address_8, ip_address, subnet, gateway,
        dns_servers, is_active, device_type, manufacturer, model, firmware,
        last_seen, config
      ) VALUES (
        $1, $2::macaddr, $3::macaddr8, $4::inet, $5::cidr, $6::inet,
        $7::inet[], $8, $9, $10, $11, $12, $13, $14::jsonb
      )
    `,
      [
        faker.internet.domainWord() + "-" + randomInt(1, 999),
        generateMacAddress(),
        generateMacAddress() +
          ":" +
          faker.string.hexadecimal({ length: 2, casing: "lower", prefix: "" }) +
          ":" +
          faker.string.hexadecimal({ length: 2, casing: "lower", prefix: "" }),
        `${ipBase}.${randomInt(1, 254)}`,
        `${ipBase}.0/24`,
        `${ipBase}.1`,
        `{${ipBase}.1,8.8.8.8}`,
        Math.random() > 0.1,
        randomElement(deviceTypes),
        randomElement(manufacturers),
        faker.string.alphanumeric(10).toUpperCase(),
        `${randomInt(1, 10)}.${randomInt(0, 99)}.${randomInt(0, 999)}`,
        Math.random() > 0.2
          ? faker.date.recent({ days: 7 }).toISOString()
          : null,
        JSON.stringify({
          ports: randomInt(4, 48),
          speed: randomElement(["100Mbps", "1Gbps", "10Gbps"]),
          vlan: randomInt(1, 100),
        }),
      ]
    );
  }

  log(`Created ${count} network devices`);
}

async function seedDocuments(
  client: Client,
  userIds: number[],
  count: number
): Promise<void> {
  log(`Seeding ${count} documents...`);
  const fileTypes = ["pdf", "doc", "docx", "txt", "md", "html", "json", "xml"];

  for (let i = 0; i < count; i++) {
    const title = faker.lorem.sentence();
    const content = faker.lorem.paragraphs(randomInt(1, 10));
    const isPublished = Math.random() > 0.3;

    await client.query(
      `
      INSERT INTO documents (
        title, content, summary, file_data, file_name, file_type, file_size,
        checksum, language, search_vector, keywords, categories, metadata,
        is_published, published_at, author_id, version
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::tsvector, $11::text[],
        $12::integer[], $13::jsonb, $14, $15, $16, $17
      )
    `,
      [
        title,
        content,
        faker.lorem.sentences(2),
        Math.random() > 0.7
          ? Buffer.from(faker.string.alphanumeric(randomInt(100, 1000)))
          : null,
        Math.random() > 0.4
          ? `${faker.system.fileName()}.${randomElement(fileTypes)}`
          : null,
        Math.random() > 0.4 ? randomElement(fileTypes) : null,
        Math.random() > 0.4 ? randomInt(1024, 10485760) : null,
        Math.random() > 0.5
          ? faker.string.hexadecimal({
              length: 64,
              casing: "lower",
              prefix: "",
            })
          : null,
        randomElement(["en", "es", "fr", "de", "ja"]),
        `'${title.toLowerCase().split(" ").slice(0, 3).join("':1 '")}':1`,
        randomSubset(
          ["tutorial", "guide", "reference", "api", "example", "faq"],
          0,
          4
        ),
        Array.from({ length: randomInt(0, 3) }, () => randomInt(1, 100)),
        JSON.stringify({
          format: randomElement(["article", "tutorial", "documentation"]),
        }),
        isPublished,
        isPublished ? faker.date.past({ years: 1 }).toISOString() : null,
        randomElement(userIds),
        randomInt(1, 10),
      ]
    );
  }

  log(`Created ${count} documents`);
}

async function seedTimeSeriesData(
  client: Client,
  count: number
): Promise<void> {
  log(`Seeding ${count} time series records...`);
  const sensors = Array.from({ length: 10 }, (_, i) => `sensor-${i + 1}`);
  const metrics = [
    "temperature",
    "humidity",
    "pressure",
    "voltage",
    "current",
    "power",
    "flow",
    "level",
  ];
  const units = ["°C", "%", "hPa", "V", "A", "W", "L/min", "m"];

  for (let i = 0; i < count; i++) {
    const metricIdx = randomInt(0, metrics.length - 1);
    const now = new Date();
    const past = faker.date.recent({ days: 30 });
    const future = faker.date.soon({ days: 30 });

    await client.query(
      `
      INSERT INTO time_series_data (
        sensor_id, metric_name, value, unit, quality, int_range, bigint_range,
        numeric_range, timestamp_range, timestamptz_range, date_range, tags, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6::int4range, $7::int8range, $8::numrange,
        $9::tsrange, $10::tstzrange, $11::daterange, $12::text[], $13::jsonb
      )
    `,
      [
        randomElement(sensors),
        metrics[metricIdx],
        randomFloat(-100, 1000, 4),
        units[metricIdx],
        randomInt(50, 100),
        `[${randomInt(0, 50)},${randomInt(51, 100)}]`,
        `[${randomInt(0, 5000)},${randomInt(5001, 10000)}]`,
        `[${randomFloat(0, 50)},${randomFloat(51, 100)}]`,
        `[${past.toISOString()},${now.toISOString()}]`,
        `[${past.toISOString()},${future.toISOString()}]`,
        `[${past.toISOString().split("T")[0]},${
          future.toISOString().split("T")[0]
        }]`,
        randomSubset(["calibrated", "verified", "estimated", "raw"], 1, 2),
        JSON.stringify({
          location: faker.location.city(),
          floor: randomInt(1, 10),
        }),
      ]
    );
  }

  log(`Created ${count} time series records`);
}

async function seedConfigSettings(
  client: Client,
  count: number
): Promise<void> {
  log(`Seeding ${count} config settings...`);
  const categories = [
    "general",
    "email",
    "security",
    "notifications",
    "appearance",
    "integrations",
  ];
  const valueTypes = ["string", "number", "boolean", "json", "array"];

  const settings = [
    {
      key: "app.name",
      value: "Waterfowl",
      type: "string",
      category: "general",
    },
    { key: "app.debug", value: "false", type: "boolean", category: "general" },
    { key: "app.timezone", value: "UTC", type: "string", category: "general" },
    {
      key: "email.smtp_host",
      value: "smtp.example.com",
      type: "string",
      category: "email",
    },
    { key: "email.smtp_port", value: "587", type: "number", category: "email" },
    {
      key: "security.session_timeout",
      value: "3600",
      type: "number",
      category: "security",
    },
    {
      key: "security.max_login_attempts",
      value: "5",
      type: "number",
      category: "security",
    },
    {
      key: "notifications.email_enabled",
      value: "true",
      type: "boolean",
      category: "notifications",
    },
    {
      key: "appearance.theme",
      value: "dark",
      type: "string",
      category: "appearance",
    },
    {
      key: "appearance.sidebar_collapsed",
      value: "false",
      type: "boolean",
      category: "appearance",
    },
  ];

  for (let i = 0; i < Math.min(count, settings.length); i++) {
    const s = settings[i];
    await client.query(
      `
      INSERT INTO config_settings (
        key, value, value_type, default_value, description, category,
        is_secret, is_readonly, validation, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
    `,
      [
        s.key,
        s.value,
        s.type,
        s.value,
        faker.lorem.sentence(),
        s.category,
        s.key.includes("password") || s.key.includes("secret"),
        Math.random() > 0.8,
        JSON.stringify({ required: true }),
        JSON.stringify({ updated_by: "system" }),
      ]
    );
  }

  // Generate additional random settings
  for (let i = settings.length; i < count; i++) {
    const valueType = randomElement(valueTypes);
    let value: string;

    switch (valueType) {
      case "number":
        value = String(randomInt(1, 1000));
        break;
      case "boolean":
        value = String(Math.random() > 0.5);
        break;
      case "json":
        value = JSON.stringify({ key: "value" });
        break;
      case "array":
        value = JSON.stringify(["item1", "item2"]);
        break;
      default:
        value = faker.lorem.word();
    }

    await client.query(
      `
      INSERT INTO config_settings (
        key, value, value_type, description, category, is_secret, is_readonly
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
      [
        `custom.setting_${i}`,
        value,
        valueType,
        faker.lorem.sentence(),
        randomElement(categories),
        false,
        false,
      ]
    );
  }

  log(`Created ${count} config settings`);
}

async function seedTypeShowcase(client: Client, count: number): Promise<void> {
  log(`Seeding ${count} type showcase records...`);
  const roles = ["admin", "moderator", "user", "guest", "suspended"];

  for (let i = 0; i < count; i++) {
    const now = new Date();
    const past = faker.date.past({ years: 1 });
    const future = faker.date.future({ years: 1 });

    await client.query(
      `
      INSERT INTO type_showcase (
        col_smallint, col_integer, col_bigint, col_decimal, col_numeric,
        col_real, col_double, col_money, col_char, col_varchar, col_text,
        col_bytea, col_timestamp, col_timestamptz, col_date, col_time,
        col_timetz, col_interval, col_boolean, col_point, col_line, col_lseg,
        col_box, col_path, col_polygon, col_circle, col_cidr, col_inet,
        col_macaddr, col_macaddr8, col_bit, col_varbit, col_tsvector,
        col_tsquery, col_uuid, col_json, col_jsonb, col_int_array,
        col_text_array, col_json_array, col_int4range, col_int8range,
        col_numrange, col_tsrange, col_tstzrange, col_daterange, col_enum
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::money, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18::interval, $19, $20::point, $21::line,
        $22::lseg, $23::box, $24::path, $25::polygon, $26::circle, $27::cidr,
        $28::inet, $29::macaddr, $30::macaddr8, $31::bit(8), $32::bit varying(64),
        $33::tsvector, $34::tsquery, $35::uuid, $36::json, $37::jsonb,
        $38::integer[], $39::text[], $40::jsonb[], $41::int4range, $42::int8range,
        $43::numrange, $44::tsrange, $45::tstzrange, $46::daterange, $47
      )
    `,
      [
        randomInt(-32768, 32767), // smallint
        randomInt(-2147483648, 2147483647), // integer
        BigInt(randomInt(-1000000000, 1000000000)).toString(), // bigint
        randomFloat(-999999999, 999999999, 10), // decimal
        randomFloat(-9999999999, 9999999999, 5), // numeric
        randomFloat(-1000, 1000, 4), // real
        randomFloat(-1000000, 1000000, 8), // double
        randomFloat(0, 10000, 2), // money
        faker.string.alpha(10), // char(10)
        faker.lorem.words(3).substring(0, 255), // varchar
        faker.lorem.paragraph(), // text
        Buffer.from(faker.string.alphanumeric(50)), // bytea
        faker.date.anytime().toISOString(), // timestamp
        faker.date.anytime().toISOString(), // timestamptz
        faker.date.anytime().toISOString().split("T")[0], // date
        `${randomInt(0, 23)}:${randomInt(0, 59)}:${randomInt(0, 59)}`, // time
        `${randomInt(0, 23)}:${randomInt(0, 59)}:${randomInt(0, 59)}+00`, // timetz
        `${randomInt(0, 365)} days ${randomInt(0, 23)} hours`, // interval
        Math.random() > 0.5, // boolean
        `(${randomFloat(-180, 180)},${randomFloat(-90, 90)})`, // point
        `{${randomFloat(-1, 1)},${randomFloat(-1, 1)},${randomFloat(
          -100,
          100
        )}}`, // line
        `[(${randomFloat(-10, 10)},${randomFloat(-10, 10)}),(${randomFloat(
          -10,
          10
        )},${randomFloat(-10, 10)})]`, // lseg
        `((${randomFloat(-10, 0)},${randomFloat(-10, 0)}),(${randomFloat(
          0,
          10
        )},${randomFloat(0, 10)}))`, // box
        `[(${randomFloat(-10, 10)},${randomFloat(-10, 10)}),(${randomFloat(
          -10,
          10
        )},${randomFloat(-10, 10)})]`, // path
        `((0,0),(1,0),(1,1),(0,1))`, // polygon
        `<(${randomFloat(-100, 100)},${randomFloat(-100, 100)}),${randomFloat(
          1,
          50
        )}>`, // circle
        `192.168.${randomInt(0, 255)}.0/24`, // cidr
        generateIPv4(), // inet
        generateMacAddress(), // macaddr
        generateMacAddress() + ":00:00", // macaddr8
        faker.string
          .binary({ length: 8, prefix: "" })
          .replace(/[^01]/g, () => String(randomInt(0, 1)))
          .padEnd(8, "0"), // bit(8)
        faker.string
          .binary({ length: randomInt(1, 64), prefix: "" })
          .replace(/[^01]/g, () => String(randomInt(0, 1))), // bit varying
        `'${faker.lorem.word()}':1 '${faker.lorem.word()}':2`, // tsvector
        `${faker.lorem.word()} & ${faker.lorem.word()}`, // tsquery
        generateUUID(), // uuid
        JSON.stringify({ key: faker.lorem.word(), value: randomInt(1, 100) }), // json
        JSON.stringify({ data: faker.lorem.words(3), nested: { a: 1 } }), // jsonb
        `{${randomInt(1, 10)},${randomInt(11, 20)},${randomInt(21, 30)}}`, // integer[]
        `{"${faker.lorem.word()}","${faker.lorem.word()}","${faker.lorem.word()}"}`, // text[]
        `{"{\\"a\\": 1}","{\\"b\\": 2}"}`, // jsonb[]
        `[${randomInt(0, 50)},${randomInt(51, 100)}]`, // int4range
        `[${randomInt(0, 5000)},${randomInt(5001, 10000)}]`, // int8range
        `[${randomFloat(0, 50)},${randomFloat(51, 100)}]`, // numrange
        `[${past.toISOString()},${now.toISOString()}]`, // tsrange
        `[${past.toISOString()},${future.toISOString()}]`, // tstzrange
        `[${past.toISOString().split("T")[0]},${
          future.toISOString().split("T")[0]
        }]`, // daterange
        randomElement(roles), // enum
      ]
    );
  }

  log(`Created ${count} type showcase records`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("PostgreSQL Seed Script for Waterfowl");
  console.log("=".repeat(60));
  console.log(
    `Connection: ${CONFIG.connectionString.replace(/:[^:@]+@/, ":****@")}`
  );
  console.log(`Record count: ${CONFIG.recordCount}`);
  console.log("=".repeat(60));

  const client = new Client({ connectionString: CONFIG.connectionString });

  try {
    await client.connect();
    log("Connected to database");

    // Drop existing tables if configured
    if (CONFIG.dropExisting) {
      log("Dropping existing tables...");
      await client.query(DROP_TABLES_SQL);
      log("Tables dropped");
    }

    // Create types and tables
    log("Creating types...");
    await client.query(CREATE_TYPES_SQL);
    log("Types created");

    log("Creating tables...");
    await client.query(CREATE_TABLES_SQL);
    log("Tables created");

    // Seed data
    const userIds = await seedUsers(client, CONFIG.recordCount);
    await seedUserProfiles(client, userIds);
    await seedUserSessions(client, userIds, CONFIG.recordCount * 2);

    const categoryIds = await seedCategories(
      client,
      Math.ceil(CONFIG.recordCount / 5)
    );
    const productIds = await seedProducts(
      client,
      categoryIds,
      CONFIG.recordCount
    );

    await seedProductReviews(client, productIds, userIds, CONFIG.recordCount);
    await seedOrders(
      client,
      userIds,
      productIds,
      Math.ceil(CONFIG.recordCount / 2)
    );
    await seedAuditLogs(client, userIds, CONFIG.recordCount * 3);

    await seedGeoLocations(client, Math.ceil(CONFIG.recordCount / 4));
    await seedNetworkDevices(client, Math.ceil(CONFIG.recordCount / 4));
    await seedDocuments(client, userIds, CONFIG.recordCount);
    await seedTimeSeriesData(client, CONFIG.recordCount * 5);
    await seedConfigSettings(client, Math.min(CONFIG.recordCount, 50));
    await seedTypeShowcase(client, CONFIG.recordCount);

    // Create sequences (after data so we can advance them)
    log("Creating custom sequences...");
    await client.query(CREATE_SEQUENCES_SQL);
    log("Sequences created");

    // Create functions
    log("Creating functions...");
    await client.query(CREATE_FUNCTIONS_SQL);
    log("Functions created");

    // Create views (after all tables have data)
    log("Creating views...");
    await client.query(CREATE_VIEWS_SQL);
    log("Views created");

    console.log("=".repeat(60));
    console.log("Seeding complete!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Error during seeding:", error);
    process.exit(1);
  } finally {
    await client.end();
    log("Disconnected from database");
  }
}

main();
