const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'tala.db');

// Ensure parent directory exists (important for Render Persistent Disk)
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Performance & integrity pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32000'); // 32MB cache

function initDB() {
  db.exec(`
    -- ─── Utilisateurs ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      email                 TEXT    UNIQUE NOT NULL,
      password_hash         TEXT    NOT NULL,
      name                  TEXT    NOT NULL,
      onboarding_step       INTEGER DEFAULT 0,
      onboarding_completed  INTEGER DEFAULT 0,
      created_at            TEXT    DEFAULT (datetime('now')),
      updated_at            TEXT    DEFAULT (datetime('now'))
    );

    -- ─── Connexions Chariow ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS chariow_connections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      api_key         TEXT    NOT NULL,
      store_name      TEXT,
      store_slug      TEXT,
      store_currency  TEXT    DEFAULT 'XOF',
      connected_at    TEXT    DEFAULT (datetime('now')),
      last_sync_at    TEXT
    );

    -- ─── Connexions Meta Ads ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS meta_connections (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_token      TEXT    NOT NULL,
      ad_account_id     TEXT    NOT NULL,
      ad_account_name   TEXT,
      page_id           TEXT,
      token_expires_at  TEXT,
      connected_at      TEXT    DEFAULT (datetime('now'))
    );

    -- ─── Abonnements outils récurrents ──────────────────────────────────────
    CREATE TABLE IF NOT EXISTS tool_subscriptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT    NOT NULL,
      amount      REAL    NOT NULL,
      currency    TEXT    DEFAULT 'XOF',
      is_active   INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ─── Abonnements Tala (freemium) ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan                    TEXT    DEFAULT 'trial',
      status                  TEXT    DEFAULT 'active',
      fedapay_transaction_id  TEXT,
      started_at              TEXT    DEFAULT (datetime('now')),
      expires_at              TEXT,
      created_at              TEXT    DEFAULT (datetime('now'))
    );

    -- ─── Conversations Coach IA ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS coach_conversations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
      content     TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ─── Cache taux de change ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      from_currency   TEXT NOT NULL,
      to_currency     TEXT NOT NULL,
      rate            REAL NOT NULL,
      fetched_at      TEXT DEFAULT (datetime('now'))
    );

    -- ─── Index ───────────────────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_chariow_user ON chariow_connections(user_id);
    CREATE INDEX IF NOT EXISTS idx_meta_user ON meta_connections(user_id);
    CREATE INDEX IF NOT EXISTS idx_tool_subs_user ON tool_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_coach_user ON coach_conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_rates ON exchange_rates(from_currency, to_currency);
  `);

  console.log('✅ Base de données initialisée :', DB_PATH);

  // ── Migrations ────────────────────────────────────────────────────────────
  // Chaque migration est idempotente (try/catch car SQLite ne supporte pas
  // "ALTER TABLE ... ADD COLUMN IF NOT EXISTS")
  runMigrations();
}

function runMigrations() {
  // Chaque migration est idempotente (try/catch car SQLite ne supporte pas
  // ALTER TABLE ... ADD COLUMN IF NOT EXISTS)
  const columnMigrations = [
    // v1.1
    `ALTER TABLE chariow_connections ADD COLUMN store_id TEXT`,
  ];

  for (const sql of columnMigrations) {
    try { db.exec(sql); } catch { /* colonne déjà présente */ }
  }

  // v1.2 : table oauth_states (anti-CSRF pour Meta OAuth)
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state       TEXT    UNIQUE NOT NULL,
      expires_at  TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_state ON oauth_states(state);
  `);

  // v1.3 : index sur coach_conversations pour les requêtes d'historique
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_coach_user_date
             ON coach_conversations(user_id, created_at DESC)`);
  } catch { /* index déjà présent */ }
}

module.exports = { db, initDB };
