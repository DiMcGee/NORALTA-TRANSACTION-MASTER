// ============================================================================
// NORALTA TRANSACTION MASTER - BACKEND API v3 (Production Schema)
// Node.js + Express + PostgreSQL
// ============================================================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { Pool } = require('pg');
const notifications = require('./lib/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

// Constants
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TOKEN_DURATION_MS = 60 * 60 * 1000; // 1 hour
const VALID_DEAL_STATUSES = ['draft', 'active', 'conditional', 'firm', 'closed', 'cancelled'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper: parse and validate numeric route param
function parseId(val) {
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

// Railway private networking (same project) - no SSL needed
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const ALLOWED_ORIGINS = [
  'https://noralta-transaction-master.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(null, true); // Allow all for now; log unknown origins in production
  }
}));
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// ============================================================================
// ONE-TIME MIGRATION (runs on startup, idempotent)
// ============================================================================

async function runMigration() {
  const client = await pool.connect();
  try {
    // Helper: check if column exists
    async function hasColumn(table, column) {
      const r = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, column]
      );
      return r.rows.length > 0;
    }
    // Helper: check if index exists
    async function hasIndex(indexName) {
      const r = await client.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = $1`, [indexName]
      );
      return r.rows.length > 0;
    }

    // --- Phase 1: Deploy production schema if needed ---
    const oldSchema = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'property_details'
    `);
    if (oldSchema.rows.length > 0) {
      console.log('Migration: dropping old prototype schema...');
      const tables = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
      );
      if (tables.rows.length > 0) {
        const names = tables.rows.map(r => `"${r.tablename}"`).join(', ');
        await client.query(`DROP TABLE IF EXISTS ${names} CASCADE`);
      }
      console.log('Migration: old tables dropped');
    }

    const newSchema = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'transaction_participants'
    `);
    if (newSchema.rows.length === 0) {
      console.log('Migration: deploying production schema...');
      const path = require('path');
      const sqlPath = path.join(__dirname, 'noralta-production-schema.sql');
      const fullSql = fs.readFileSync(sqlPath, 'utf8');
      const sql = fullSql
        .replace('DROP SCHEMA public CASCADE;', '')
        .replace('CREATE SCHEMA public;', '');
      await client.query(sql);
      console.log('Migration: production schema deployed (30 tables)');
    }

    // --- Phase 1 auth columns ---
    if (!(await hasColumn('agents', 'password_hash'))) {
      await client.query('ALTER TABLE agents ADD COLUMN password_hash VARCHAR(255)');
      console.log('Migration: added password_hash to agents');
    }
    if (!(await hasIndex('idx_agents_email'))) {
      await client.query('CREATE UNIQUE INDEX idx_agents_email ON agents(email) WHERE email IS NOT NULL');
      console.log('Migration: added unique email index on agents');
    }

    // --- Phase 4: agent role + deal management ---
    if (!(await hasColumn('agents', 'role'))) {
      await client.query("ALTER TABLE agents ADD COLUMN role VARCHAR(20) DEFAULT 'agent'");
      console.log('Migration: added role to agents');
    }

    // --- Phase 5: office_forms + fintrac_records tables ---
    const hasOffice = await client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'office_forms'`
    );
    if (hasOffice.rows.length === 0) {
      const newTablesSql = fs.readFileSync(require('path').join(__dirname, 'new-tables.sql'), 'utf8');
      await client.query(newTablesSql);
      console.log('Migration: created office_forms + fintrac_records tables');
    }

    // --- Phase 6: office locations, agent title, form versions, Tom Shearer ---

    // 6a: office_locations table
    const hasOfficeLocations = await client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'office_locations'`
    );
    if (hasOfficeLocations.rows.length === 0) {
      await client.query(`
        CREATE TABLE office_locations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          address TEXT,
          city VARCHAR(100),
          postal_code VARCHAR(10),
          phone VARCHAR(20),
          email VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await client.query(`
        INSERT INTO office_locations (name, address, city, postal_code, phone, email) VALUES
        ('Edmonton', '3018 Calgary Trail NW', 'Edmonton', 'T6J 6V4', '(780) 431-5600', 'admin@royallepagenoralta.ca'),
        ('Spruce Grove', '202 Main St', 'Spruce Grove', 'T7X 0G2', '(780) 962-4950', 'admin@royallepagenoralta.ca'),
        ('Fort Saskatchewan', '317-10451 99 Ave.', 'Fort Saskatchewan', 'T8L 0V6', '(780)-998-7801', 'admin@royallepagenoralta.ca'),
        ('Sherwood Park', '2755 Broadmoor Blvd #148', 'Sherwood Park', 'T8H 2W7', '(780) 467-7334', 'admin@royallepagenoralta.ca')
      `);
      console.log('Migration: created office_locations table with 4 offices');
    }

    // 6b: office_location_id on agents
    if (!(await hasColumn('agents', 'office_location_id'))) {
      await client.query('ALTER TABLE agents ADD COLUMN office_location_id INTEGER REFERENCES office_locations(id)');
      console.log('Migration: added office_location_id to agents');
    }

    // 6c: title on agents
    if (!(await hasColumn('agents', 'title'))) {
      await client.query('ALTER TABLE agents ADD COLUMN title VARCHAR(150)');
      // Set Diana's title
      await client.query(
        `UPDATE agents SET title = 'Team Leader of Agent Success' WHERE email = 'dmcgee@royallepage.ca'`
      );
      console.log('Migration: added title to agents, set Diana title');
    }

    // 6d: form_versions table for monitoring
    const hasFormVersions = await client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'form_versions'`
    );
    if (hasFormVersions.rows.length === 0) {
      await client.query(`
        CREATE TABLE form_versions (
          id SERIAL PRIMARY KEY,
          form_code VARCHAR(20) NOT NULL UNIQUE,
          form_name VARCHAR(255),
          current_version VARCHAR(20),
          source VARCHAR(50) DEFAULT 'AREA',
          last_audited TIMESTAMP,
          status VARCHAR(20) DEFAULT 'current',
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('Migration: created form_versions table');
    }

    // 6e: Tom Shearer broker_owner account
    const hasTom = await client.query(
      `SELECT 1 FROM agents WHERE email = 'tomshearer@royallepage.ca'`
    );
    if (hasTom.rows.length === 0) {
      const bcryptMig = require('bcryptjs');
      const tomHash = await bcryptMig.hash('Noralta2026', 10);
      await client.query(
        `INSERT INTO agents (full_name, email, password_hash, role, title)
         VALUES ('Tom Shearer', 'tomshearer@royallepage.ca', $1, 'broker_owner', 'Broker Owner')`,
        [tomHash]
      );
      console.log('Migration: created Tom Shearer broker_owner account');
    }

    // --- Phase 7: notifications + signature columns ---

    // 7a: app_notifications table
    const hasAppNotif = await client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_notifications'`
    );
    if (hasAppNotif.rows.length === 0) {
      await client.query(`
        CREATE TABLE app_notifications (
          id SERIAL PRIMARY KEY,
          agent_id INT REFERENCES agents(id) ON DELETE CASCADE,
          type VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          body TEXT,
          deal_id INT,
          read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await client.query('CREATE INDEX idx_app_notif_agent ON app_notifications(agent_id, read)');
      console.log('Migration: created app_notifications table');
    }

    // 7b: signature columns for agent/transaction binding
    if (!(await hasColumn('signatures', 'agent_id'))) {
      await client.query('ALTER TABLE signatures ADD COLUMN agent_id INT REFERENCES agents(id)');
      console.log('Migration: added agent_id to signatures');
    }
    if (!(await hasColumn('signatures', 'transaction_id'))) {
      await client.query('ALTER TABLE signatures ADD COLUMN transaction_id INT REFERENCES transactions(id)');
      console.log('Migration: added transaction_id to signatures');
    }

    // --- Phase 8: conditions, password reset, notification preferences ---

    // 8a: deal_conditions table
    const hasDealConditions = await client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'deal_conditions'`
    );
    if (hasDealConditions.rows.length === 0) {
      await client.query(`
        CREATE TABLE deal_conditions (
          id SERIAL PRIMARY KEY,
          transaction_id INT REFERENCES transactions(id) ON DELETE CASCADE,
          condition_type VARCHAR(50) NOT NULL,
          description TEXT,
          deadline_date DATE,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await client.query('CREATE INDEX idx_deal_conditions_txn ON deal_conditions(transaction_id)');
      console.log('Migration: created deal_conditions table');
    }

    // 8b: password_reset_tokens table
    const hasResetTokens = await client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'password_reset_tokens'`
    );
    if (hasResetTokens.rows.length === 0) {
      await client.query(`
        CREATE TABLE password_reset_tokens (
          id SERIAL PRIMARY KEY,
          agent_id INT REFERENCES agents(id) ON DELETE CASCADE,
          token VARCHAR(64) NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          used BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('Migration: created password_reset_tokens table');
    }

    // 8c: notification_preferences table
    const hasNotifPrefs = await client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notification_preferences'`
    );
    if (hasNotifPrefs.rows.length === 0) {
      await client.query(`
        CREATE TABLE notification_preferences (
          id SERIAL PRIMARY KEY,
          agent_id INT REFERENCES agents(id) ON DELETE CASCADE UNIQUE,
          status_changes BOOLEAN DEFAULT TRUE,
          form_completions BOOLEAN DEFAULT TRUE,
          handoffs BOOLEAN DEFAULT TRUE,
          deal_created BOOLEAN DEFAULT TRUE,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('Migration: created notification_preferences table');
    }

    // --- Phase 9: Add unique constraint on documents for proper upsert ---
    try {
      // Remove duplicates before creating unique index
      await client.query(`
        DELETE FROM documents a USING documents b
        WHERE a.id < b.id AND a.transaction_id = b.transaction_id AND a.form_code = b.form_code
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_tx_form
        ON documents (transaction_id, form_code)
      `);
    } catch (e9) {
      console.warn('Phase 9 index:', e9.message);
    }

    // --- Phase 9b: Fix fintrac_records schema (extended columns from new-tables.sql) ---
    const hasFintracEntity = await hasColumn('fintrac_records', 'entity_name');
    if (!hasFintracEntity) {
      // Production schema created a simple fintrac_records; new-tables.sql has the full version
      // but IF NOT EXISTS skipped it. Drop and recreate with all FINTRAC form columns.
      await client.query('DROP TABLE IF EXISTS fintrac_records CASCADE');
      const ntSql = fs.readFileSync(require('path').join(__dirname, 'new-tables.sql'), 'utf8');
      const fintracMatch = ntSql.match(/CREATE TABLE IF NOT EXISTS fintrac_records[\s\S]*?\);/);
      if (fintracMatch) {
        await client.query(fintracMatch[0]);
      }
      console.log('Migration: recreated fintrac_records with extended FINTRAC columns');
    }

    // Verify table count
    const tableCount = await client.query(
      "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'"
    );
    console.log(`Migration: complete - ${tableCount.rows[0].count} tables`);

    // Phase 10: Create office_forms table (dynamically from forms.json)
    const hasOfficeFormsTable = await client.query(
      "SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'office_forms'"
    );
    if (hasOfficeFormsTable.rows.length === 0) {
      console.log('Migration Phase 10: creating office_forms table...');
      const allForms = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'data', 'forms.json'), 'utf8'));
      const cols = new Set();
      for (const form of allForms) {
        for (const section of form.sections) {
          for (const field of section.fields) {
            if (field.db && field.db.startsWith('office_forms.')) {
              cols.add(field.db.replace('office_forms.', ''));
            }
          }
        }
      }
      if (cols.size > 0) {
        const colDefs = Array.from(cols).map(c => `${c} TEXT`).join(',\n  ');
        await client.query(`
          CREATE TABLE office_forms (
            id SERIAL PRIMARY KEY,
            transaction_id INT REFERENCES transactions(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            ${colDefs}
          )
        `);
        await client.query('CREATE INDEX IF NOT EXISTS idx_office_forms_tx ON office_forms(transaction_id)');
        console.log(`Migration Phase 10: office_forms created with ${cols.size} columns`);
      }
    }

    // Phase 11: Ensure fintrac_records has all FINTRAC form columns
    const hasFintracProp = await hasColumn('fintrac_records', 'property_address');
    if (!hasFintracProp) {
      console.log('Migration Phase 11: adding missing fintrac_records columns...');
      const ntSql = fs.readFileSync(require('path').join(__dirname, 'new-tables.sql'), 'utf8');
      const fintracMatch = ntSql.match(/CREATE TABLE IF NOT EXISTS fintrac_records\s*\(([\s\S]*?)\);/);
      if (fintracMatch) {
        const body = fintracMatch[1];
        const lines = body.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('--'))
          .map(l => l.replace(/,\s*$/, ''));

        let added = 0;
        for (const line of lines) {
          const match = line.match(/^([a-z_][a-z0-9_]*)\s+(.+)/);
          if (!match) continue;
          const [, col, typeDef] = match;
          if (['id', 'transaction_id', 'created_at', 'updated_at'].includes(col)) continue;
          // Strip any REFERENCES constraints for safe ADD COLUMN
          const safeType = typeDef.replace(/REFERENCES\s+\S+\([^)]*\)\s*(ON\s+\w+\s+\w+)?/gi, '').trim();
          try {
            await client.query(`ALTER TABLE fintrac_records ADD COLUMN IF NOT EXISTS "${col}" ${safeType}`);
            added++;
          } catch (e) {
            console.warn(`  skip column ${col}: ${e.message}`);
          }
        }
        console.log(`Migration Phase 11: added ${added} columns to fintrac_records`);
      }
    }

    // Phase 12: Fix column type mismatches (BOOLEAN → TEXT where forms send text/textarea)
    const attachOtherType = await client.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'attach_other'`
    );
    if (attachOtherType.rows[0]?.data_type === 'boolean') {
      await client.query('ALTER TABLE transactions ALTER COLUMN attach_other TYPE TEXT USING CASE WHEN attach_other THEN \'true\' ELSE NULL END');
      await client.query('ALTER TABLE commercial_buyer_rep ALTER COLUMN reasonable_expenses TYPE TEXT USING CASE WHEN reasonable_expenses THEN \'true\' ELSE NULL END');
      await client.query('ALTER TABLE commercial_landlord_rep ALTER COLUMN reasonable_expenses TYPE TEXT USING CASE WHEN reasonable_expenses THEN \'true\' ELSE NULL END');
      console.log('Migration Phase 12: fixed attach_other + commercial reasonable_expenses column types (BOOLEAN → TEXT)');
    }

    // Phase 13: Add separate TIME columns for COM-PC date/time split + expense grid columns
    const hasFinDeadlineTime = await hasColumn('conditions', 'financing_deadline_time');
    if (!hasFinDeadlineTime) {
      console.log('Migration Phase 13: adding time columns + expense grid columns...');
      // COM-PC: 5 time fields that were colliding with date fields
      await client.query('ALTER TABLE conditions ADD COLUMN IF NOT EXISTS financing_deadline_time TIME');
      await client.query('ALTER TABLE commercial_conditions ADD COLUMN IF NOT EXISTS due_diligence_deadline_time TIME');
      await client.query('ALTER TABLE conditions ADD COLUMN IF NOT EXISTS buyer_additional_deadline_time TIME');
      await client.query('ALTER TABLE conditions ADD COLUMN IF NOT EXISTS seller_deadline_time TIME');
      await client.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS offer_deadline_time TIME');

      // COM-LRA-AP: 32 expense grid booleans (were all mapped to single "expenses" TEXT column)
      const expCols = [
        'exp_biz_tax_l','exp_biz_tax_t','exp_biz_tax_p',
        'exp_prop_tax_l','exp_prop_tax_t','exp_prop_tax_p',
        'exp_ll_ins_l','exp_ll_ins_t','exp_ll_ins_p',
        'exp_tn_ins_l','exp_tn_ins_t','exp_tn_ins_p',
        'exp_glass_l','exp_glass_t','exp_glass_p',
        'exp_electricity','exp_water','exp_gas','exp_telephone','exp_cable',
        'exp_waste','exp_janitorial','exp_landscape','exp_prop_mgmt','exp_internet',
        'exp_structural','exp_roof','exp_hvac','exp_electrical',
        'exp_interior','exp_other_nonstr','exp_pavement'
      ];
      for (const col of expCols) {
        await client.query(`ALTER TABLE commercial_landlord_appendix ADD COLUMN IF NOT EXISTS "${col}" BOOLEAN`);
      }
      console.log('Migration Phase 13: added 5 time columns + 32 expense columns');
    }

  } catch (e) {
    console.error('Migration error:', e.message);
  } finally {
    client.release();
  }
}

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const result = await pool.query(
      'SELECT s.agent_id, a.full_name, a.email, a.role, a.title, a.office_location_id FROM agent_sessions s JOIN agents a ON a.id = s.agent_id WHERE s.session_token = $1 AND s.expires_at > NOW()',
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.agent = result.rows[0];
    next();
  } catch (e) {
    console.error('Auth check error:', e.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT COUNT(*) as tables FROM pg_tables WHERE schemaname = $1', ['public']);
    res.json({
      status: 'ok',
      service: 'Noralta Transaction Master API v3',
      database: 'connected',
      tables: parseInt(dbCheck.rows[0].tables),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
  }
});

// ============================================================================
// AUTH ROUTES
// ============================================================================

// Register a new agent (broker/admin only)
app.post('/api/auth/register', requireAuth, async (req, res) => {
  // Only brokers and admins can register new agents
  const ALLOWED_ROLES = new Set(['broker', 'broker_owner', 'admin']);
  if (!ALLOWED_ROLES.has(req.agent.role)) {
    return res.status(403).json({ error: 'Only brokers can register new agents' });
  }
  const { full_name, email, password, phone, branch } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'full_name, email, and password are required' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check for existing agent with this email
    const existing = await pool.query('SELECT id FROM agents WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An agent with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO agents (full_name, email, password_hash, phone, branch) VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, branch',
      [full_name, email, password_hash, phone || null, branch || null]
    );

    res.status(201).json({ message: 'Agent registered', agent: result.rows[0] });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, full_name, email, password_hash, branch, role, title, office_location_id FROM agents WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const agent = result.rows[0];
    if (!agent.password_hash) {
      return res.status(401).json({ error: 'Account not set up for login' });
    }

    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create session token (24h expiry)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await pool.query(
      'INSERT INTO agent_sessions (agent_id, session_token, expires_at) VALUES ($1, $2, $3)',
      [agent.id, token, expiresAt]
    );

    res.json({
      message: 'Login successful',
      token,
      agent: { id: agent.id, full_name: agent.full_name, email: agent.email, branch: agent.branch, role: agent.role || 'agent', title: agent.title || null, office_location_id: agent.office_location_id || null }
    });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  try {
    await pool.query('DELETE FROM agent_sessions WHERE session_token = $1', [token]);
    res.json({ message: 'Logged out' });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current agent
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ agent: req.agent });
});

// Forgot password - generates reset token
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const agent = await pool.query('SELECT id, full_name, email FROM agents WHERE email = $1', [email]);
    // Always return success (don't reveal if email exists)
    if (agent.rows.length === 0) {
      return res.json({ message: 'If that email exists, a reset link has been generated.' });
    }

    // Invalidate old tokens
    await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE agent_id = $1 AND used = FALSE', [agent.rows[0].id]);

    // Generate new token (1 hour expiry)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_DURATION_MS);
    await pool.query(
      'INSERT INTO password_reset_tokens (agent_id, token, expires_at) VALUES ($1, $2, $3)',
      [agent.rows[0].id, token, expiresAt]
    );

    // Try to send email if SMTP is configured
    const resetUrl = `https://noralta-transaction-master.vercel.app/reset-password?token=${token}`;
    const { sendResetEmail } = notifications;
    if (sendResetEmail) {
      sendResetEmail(agent.rows[0].email, agent.rows[0].full_name, resetUrl);
    }

    // Only include reset token/URL when no SMTP is configured (dev/manual mode)
    const hasSmtp = !!process.env.SMTP_HOST;
    const response = { message: 'If that email exists, a reset link has been generated.' };
    if (!hasSmtp) {
      response.resetToken = token;
      response.resetUrl = resetUrl;
    }
    res.json(response);
  } catch (e) {
    console.error('Forgot password error:', e.message);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Reset password using token
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    return res.status(400).json({ error: 'Token and new_password are required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const result = await pool.query(
      'SELECT id, agent_id FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { id: tokenId, agent_id } = result.rows[0];
    const password_hash = await bcrypt.hash(new_password, 10);

    await pool.query('UPDATE agents SET password_hash = $1 WHERE id = $2', [password_hash, agent_id]);
    await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [tokenId]);

    // Invalidate all existing sessions for security
    await pool.query('DELETE FROM agent_sessions WHERE agent_id = $1', [agent_id]);

    res.json({ message: 'Password reset successfully. Please log in with your new password.' });
  } catch (e) {
    console.error('Reset password error:', e.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ============================================================================
// OFFICE LOCATIONS
// ============================================================================

// List all office locations (no auth required - needed for dropdowns)
app.get('/api/office-locations', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM office_locations ORDER BY name');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set agent's office location
app.put('/api/auth/office-location', requireAuth, async (req, res) => {
  try {
    const office_location_id = parseId(req.body.office_location_id);
    if (!office_location_id) {
      return res.status(400).json({ error: 'office_location_id is required and must be a number' });
    }
    // Verify location exists
    const loc = await pool.query('SELECT * FROM office_locations WHERE id = $1', [office_location_id]);
    if (loc.rows.length === 0) {
      return res.status(404).json({ error: 'Office location not found' });
    }
    await pool.query(
      'UPDATE agents SET office_location_id = $1 WHERE id = $2',
      [office_location_id, req.agent.agent_id]
    );
    res.json({ message: 'Office location updated', location: loc.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// DEAL DASHBOARD
// ============================================================================

// List deals for the logged-in agent (with search, filter, pagination, sort)
app.get('/api/deals', requireAuth, async (req, res) => {
  try {
    const { status, type, search, sort, order, page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * pageSize;

    // Allowed sort columns
    const sortMap = {
      updated_at: 't.updated_at', created_at: 't.created_at',
      status: 't.status', price: 't.purchase_price', address: 'p.address'
    };
    const sortCol = sortMap[sort] || 't.updated_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    // Build WHERE clauses
    const conditions = ['t.agent_id = $1'];
    const params = [req.agent.agent_id];
    let paramIdx = 2;

    if (status) {
      conditions.push(`t.status = $${paramIdx++}`);
      params.push(status);
    }
    if (type) {
      conditions.push(`t.transaction_type = $${paramIdx++}`);
      params.push(type);
    }
    if (search) {
      conditions.push(`(
        p.address ILIKE $${paramIdx} OR p.city ILIKE $${paramIdx} OR
        EXISTS (SELECT 1 FROM transaction_participants tp2
                JOIN parties par2 ON par2.id = tp2.party_id
                WHERE tp2.transaction_id = t.id AND par2.full_name ILIKE $${paramIdx})
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM transactions t
       LEFT JOIN properties p ON p.id = t.property_id
       WHERE ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    // Fetch page
    const result = await pool.query(`
      SELECT
        t.id, t.status, t.transaction_type, t.purchase_price,
        t.updated_at, t.created_at,
        p.address as property_address, p.city as property_city,
        (SELECT par.full_name FROM transaction_participants tp
         JOIN parties par ON par.id = tp.party_id
         WHERE tp.transaction_id = t.id AND tp.role = 'buyer' LIMIT 1) as buyer_name,
        (SELECT par.full_name FROM transaction_participants tp
         JOIN parties par ON par.id = tp.party_id
         WHERE tp.transaction_id = t.id AND tp.role = 'seller' LIMIT 1) as seller_name
      FROM transactions t
      LEFT JOIN properties p ON p.id = t.property_id
      WHERE ${where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, pageSize, offset]);

    res.json({
      deals: result.rows,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      }
    });
  } catch (e) {
    console.error('Deals list error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dashboard stats (server-side counts)
app.get('/api/deals/stats', requireAuth, async (req, res) => {
  try {
    const agentId = req.agent.agent_id;
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status IN ('active','conditional')) AS active,
        COUNT(*) FILTER (WHERE status = 'firm') AS firm,
        COUNT(*) FILTER (WHERE status = 'closed'
          AND date_trunc('month', updated_at) = date_trunc('month', NOW())) AS closed_this_month
      FROM transactions WHERE agent_id = $1
    `, [agentId]);
    const r = result.rows[0];
    res.json({
      total: parseInt(r.total),
      active: parseInt(r.active),
      firm: parseInt(r.firm),
      closedThisMonth: parseInt(r.closed_this_month),
    });
  } catch (e) {
    console.error('Deal stats error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single deal with all related data
app.get('/api/deals/:id', requireAuth, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid deal ID' });
    const tx = await pool.query(
      'SELECT * FROM transactions WHERE id = $1 AND agent_id = $2',
      [id, req.agent.agent_id]
    );
    if (tx.rows.length === 0) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    const property = await pool.query('SELECT * FROM properties WHERE id = $1', [tx.rows[0].property_id]);
    const participants = await pool.query(
      `SELECT tp.*, par.full_name as party_name, par.email as party_email, par.phone as party_phone,
              a.full_name as agent_name, b.name as brokerage_name, l.name as lawyer_name
       FROM transaction_participants tp
       LEFT JOIN parties par ON par.id = tp.party_id
       LEFT JOIN agents a ON a.id = tp.agent_id
       LEFT JOIN brokerages b ON b.id = tp.brokerage_id
       LEFT JOIN lawyers l ON l.id = tp.lawyer_id
       WHERE tp.transaction_id = $1`,
      [id]
    );
    const documents = await pool.query(
      'SELECT * FROM documents WHERE transaction_id = $1 ORDER BY form_code',
      [id]
    );

    res.json({
      transaction: tx.rows[0],
      property: property.rows[0] || null,
      participants: participants.rows,
      documents: documents.rows
    });
  } catch (e) {
    console.error('Deal detail error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new deal (with optional bulk pre-fill for buyer/seller/property/pricing)
app.post('/api/deals', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      transaction_type, property_address, property_city, property_postal_code,
      buyer_name, buyer_email, buyer_phone, buyer_address,
      seller_name, seller_email, seller_phone, seller_address,
      purchase_price, possession_date, completion_date
    } = req.body;

    // Create property if address provided
    let property_id = null;
    if (property_address) {
      const propResult = await client.query(
        'INSERT INTO properties (address, municipal_address, city, postal_code) VALUES ($1, $2, $3, $4) RETURNING id',
        [property_address, property_address, property_city || null, property_postal_code || null]
      );
      property_id = propResult.rows[0].id;
    }

    // Build transaction insert with optional pricing/dates
    const txCols = ['transaction_type', 'agent_id', 'property_id', 'status'];
    const txVals = [transaction_type || 'residential', req.agent.agent_id, property_id, 'draft'];
    if (purchase_price) { txCols.push('purchase_price'); txVals.push(String(purchase_price).replace(/,/g, '')); }
    if (possession_date) { txCols.push('possession_date'); txVals.push(possession_date); }
    if (completion_date) { txCols.push('completion_date'); txVals.push(completion_date); }

    const placeholders = txVals.map((_, i) => `$${i + 1}`).join(', ');
    const txResult = await client.query(
      `INSERT INTO transactions (${txCols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      txVals
    );
    const txId = txResult.rows[0].id;

    // Seed buyer party if name provided
    if (buyer_name) {
      const buyerResult = await client.query(
        'INSERT INTO parties (full_name, email, phone, address) VALUES ($1, $2, $3, $4) RETURNING id',
        [buyer_name, buyer_email || null, buyer_phone || null, buyer_address || null]
      );
      await client.query(
        "INSERT INTO transaction_participants (transaction_id, party_id, role) VALUES ($1, $2, 'buyer')",
        [txId, buyerResult.rows[0].id]
      );
    }

    // Seed seller party if name provided
    if (seller_name) {
      const sellerResult = await client.query(
        'INSERT INTO parties (full_name, email, phone, address) VALUES ($1, $2, $3, $4) RETURNING id',
        [seller_name, seller_email || null, seller_phone || null, seller_address || null]
      );
      await client.query(
        "INSERT INTO transaction_participants (transaction_id, party_id, role) VALUES ($1, $2, 'seller')",
        [txId, sellerResult.rows[0].id]
      );
    }

    // Log activity
    await client.query(
      `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
       VALUES ($1, $2, 'created', $3)`,
      [txId, req.agent.agent_id, JSON.stringify({
        transaction_type,
        prefilled: { buyer: !!buyer_name, seller: !!seller_name, property: !!property_address, pricing: !!purchase_price }
      })]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Deal created', deal: txResult.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Create deal error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update deal status
app.put('/api/deals/:id/status', requireAuth, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid deal ID' });
    const { status } = req.body;
    if (!status || !VALID_DEAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${VALID_DEAL_STATUSES.join(', ')}` });
    }

    const tx = await pool.query(
      'SELECT id, status FROM transactions WHERE id = $1 AND agent_id = $2',
      [id, req.agent.agent_id]
    );
    if (tx.rows.length === 0) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    const oldStatus = tx.rows[0].status;
    await pool.query(
      'UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, id]
    );

    await pool.query(
      `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
       VALUES ($1, $2, 'status_changed', $3)`,
      [id, req.agent.agent_id, JSON.stringify({ from: oldStatus, to: status })]
    );

    notifications.onStatusChange(pool, id, req.agent, oldStatus, status);

    res.json({ message: 'Status updated', dealId: parseInt(id), from: oldStatus, to: status });
  } catch (e) {
    console.error('Status update error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handoff deal to another agent
app.post('/api/deals/:id/handoff', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid deal ID' });
    const { to_agent_id, notes } = req.body;

    const targetId = parseId(to_agent_id);
    if (!targetId) {
      return res.status(400).json({ error: 'to_agent_id is required and must be a number' });
    }
    if (targetId === req.agent.agent_id) {
      return res.status(400).json({ error: 'Cannot hand off a deal to yourself' });
    }

    await client.query('BEGIN');

    // Verify deal ownership
    const tx = await client.query(
      'SELECT id, agent_id FROM transactions WHERE id = $1 AND agent_id = $2',
      [id, req.agent.agent_id]
    );
    if (tx.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Deal not found or not owned by you' });
    }

    // Verify target agent exists
    const target = await client.query(
      'SELECT id, full_name, email FROM agents WHERE id = $1',
      [targetId]
    );
    if (target.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Target agent not found' });
    }

    // Transfer ownership
    await client.query(
      'UPDATE transactions SET agent_id = $1, updated_at = NOW() WHERE id = $2',
      [targetId, id]
    );

    // Log activity
    await client.query(
      `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
       VALUES ($1, $2, 'handoff', $3)`,
      [id, req.agent.agent_id, JSON.stringify({
        from_agent: { id: req.agent.agent_id, name: req.agent.full_name },
        to_agent: { id: target.rows[0].id, name: target.rows[0].full_name },
        notes: notes || null
      })]
    );

    await client.query('COMMIT');

    notifications.onHandoff(pool, id, req.agent, target.rows[0], notes);

    res.json({
      message: 'Deal handed off',
      dealId: parseInt(id),
      from: { id: req.agent.agent_id, name: req.agent.full_name },
      to: { id: target.rows[0].id, name: target.rows[0].full_name }
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Handoff error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Duplicate a deal
app.post('/api/deals/:id/duplicate', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) { client.release(); return res.status(400).json({ error: 'Invalid deal ID' }); }
    await client.query('BEGIN');

    // Load original deal
    const orig = await client.query(
      'SELECT * FROM transactions WHERE id = $1 AND agent_id = $2',
      [id, req.agent.agent_id]
    );
    if (orig.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Deal not found' });
    }
    const origTx = orig.rows[0];

    // Copy property if exists
    let newPropId = null;
    if (origTx.property_id) {
      const prop = await client.query('SELECT * FROM properties WHERE id = $1', [origTx.property_id]);
      if (prop.rows.length > 0) {
        const p = prop.rows[0];
        // Copy all property columns except id and created_at
        const skipCols = new Set(['id', 'created_at']);
        const cols = Object.keys(p).filter(k => !skipCols.has(k) && p[k] !== null);
        const vals = cols.map(k => p[k]);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
        const newProp = await client.query(
          `INSERT INTO properties (${cols.join(',')}) VALUES (${placeholders}) RETURNING id`,
          vals
        );
        newPropId = newProp.rows[0].id;
      }
    }

    // Copy all transaction columns dynamically (except id, created_at, updated_at)
    const txSkipCols = new Set(['id', 'created_at', 'updated_at', 'property_id', 'agent_id', 'status']);
    const txCols = Object.keys(origTx).filter(k => !txSkipCols.has(k) && origTx[k] !== null);
    const txInsertCols = ['agent_id', 'property_id', 'status', ...txCols];
    const txInsertVals = [req.agent.agent_id, newPropId, 'draft', ...txCols.map(k => origTx[k])];
    const txPlaceholders = txInsertCols.map((_, i) => `$${i + 1}`).join(',');
    const newTx = await client.query(
      `INSERT INTO transactions (${txInsertCols.join(',')}) VALUES (${txPlaceholders}) RETURNING *`,
      txInsertVals
    );
    const newTxId = newTx.rows[0].id;

    // Copy participants (parties, not form data)
    const participants = await client.query(
      'SELECT * FROM transaction_participants WHERE transaction_id = $1', [id]
    );
    for (const tp of participants.rows) {
      // Copy party record dynamically (all columns except id, created_at)
      let newPartyId = null;
      if (tp.party_id) {
        const party = await client.query('SELECT * FROM parties WHERE id = $1', [tp.party_id]);
        if (party.rows.length > 0) {
          const pr = party.rows[0];
          const pSkipCols = new Set(['id', 'created_at']);
          const pCols = Object.keys(pr).filter(k => !pSkipCols.has(k) && pr[k] !== null);
          const pVals = pCols.map(k => pr[k]);
          const pPlaceholders = pCols.map((_, i) => `$${i + 1}`).join(',');
          const newParty = await client.query(
            `INSERT INTO parties (${pCols.join(',')}) VALUES (${pPlaceholders}) RETURNING id`,
            pVals
          );
          newPartyId = newParty.rows[0].id;
        }
      }
      await client.query(
        'INSERT INTO transaction_participants (transaction_id, party_id, agent_id, brokerage_id, lawyer_id, role) VALUES ($1,$2,$3,$4,$5,$6)',
        [newTxId, newPartyId, tp.agent_id, tp.brokerage_id, tp.lawyer_id, tp.role]
      );
    }

    // Log activity
    await client.query(
      `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
       VALUES ($1, $2, 'duplicated', $3)`,
      [newTxId, req.agent.agent_id, JSON.stringify({ source_deal: parseInt(id) })]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Deal duplicated', deal: newTx.rows[0], sourceDealId: parseInt(id) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Duplicate deal error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete a deal
app.delete('/api/deals/:id', requireAuth, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid deal ID' });
    const tx = await pool.query(
      'SELECT id, status FROM transactions WHERE id = $1 AND agent_id = $2',
      [id, req.agent.agent_id]
    );
    if (tx.rows.length === 0) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    // Only allow deleting draft deals; others get cancelled
    if (tx.rows[0].status === 'draft') {
      await pool.query('DELETE FROM transactions WHERE id = $1', [id]);
      res.json({ message: 'Deal deleted', dealId: parseInt(id) });
    } else {
      await pool.query(
        "UPDATE transactions SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
        [id]
      );
      await pool.query(
        `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
         VALUES ($1, $2, 'cancelled', $3)`,
        [id, req.agent.agent_id, JSON.stringify({ previous_status: tx.rows[0].status })]
      );
      notifications.onStatusChange(pool, id, req.agent, tx.rows[0].status, 'cancelled');
      res.json({ message: 'Deal cancelled (non-draft deals are cancelled, not deleted)', dealId: parseInt(id), status: 'cancelled' });
    }
  } catch (e) {
    console.error('Delete deal error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List agents (for handoff dropdown)
app.get('/api/agents', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, full_name, email, branch, role, title, office_location_id FROM agents WHERE password_hash IS NOT NULL ORDER BY full_name"
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deal activity log
app.get('/api/deals/:id/activity', requireAuth, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid deal ID' });
    const tx = await pool.query(
      'SELECT id FROM transactions WHERE id = $1 AND agent_id = $2',
      [id, req.agent.agent_id]
    );
    if (tx.rows.length === 0) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    const result = await pool.query(
      `SELECT dal.*, a.full_name as agent_name
       FROM deal_activity_log dal
       LEFT JOIN agents a ON a.id = dal.agent_id
       WHERE dal.transaction_id = $1
       ORDER BY dal.created_at DESC
       LIMIT 50`,
      [id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bootstrap: promote current agent to broker (only works if no broker exists yet)
app.post('/api/auth/promote-broker', requireAuth, async (req, res) => {
  try {
    const existing = await pool.query("SELECT id FROM agents WHERE role IN ('broker', 'broker_owner', 'admin')");
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A broker already exists. Use /api/broker/agents/:id/role to manage roles.' });
    }
    await pool.query("UPDATE agents SET role = 'broker' WHERE id = $1", [req.agent.agent_id]);
    res.json({ message: 'Promoted to broker', agentId: req.agent.agent_id, name: req.agent.full_name });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// SCHEMA INFO (for verification)
// ============================================================================

app.get('/api/schema', requireAuth, async (req, res) => {
  try {
    const tables = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    const brokerage = await pool.query('SELECT * FROM brokerages LIMIT 1');
    res.json({
      tables: tables.rows.map(r => r.tablename),
      table_count: tables.rows.length,
      seed_brokerage: brokerage.rows[0] || null
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// FORM WORKFLOW ROUTES (Phase 2)
// ============================================================================

const formsRouter = require('./routes/forms')(pool);
app.use('/api', requireAuth, formsRouter);

// ============================================================================
// DOCUMENT / PDF ROUTES (Phase 3)
// ============================================================================

const documentsRouter = require('./routes/documents')(pool);
app.use('/api', requireAuth, documentsRouter);

// ============================================================================
// NOTIFICATION ROUTES (Phase 7)
// ============================================================================

const notificationsRouter = require('./routes/notifications')(pool);
app.use('/api', requireAuth, notificationsRouter);

// ============================================================================
// CONDITION ROUTES (Phase 8)
// ============================================================================

const conditionsRouter = require('./routes/conditions')(pool);
app.use('/api', requireAuth, conditionsRouter);

// ============================================================================
// BROKER OVERSIGHT ROUTES (Phase 4)
// ============================================================================

const brokerRouter = require('./routes/broker')(pool);
app.use('/api', requireAuth, brokerRouter);

// ============================================================================
// 404 + ERROR HANDLERS
// ============================================================================

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// START (run migration then listen)
// ============================================================================

async function start() {
  // Test connection
  let connected = false;
  try {
    await pool.query('SELECT 1');
    console.log('Database connected');
    connected = true;
  } catch (e) {
    console.error('Database connection failed:', e.message);
  }

  if (connected) {
    try {
      await runMigration();
    } catch (e) {
      console.error('Migration failed (non-fatal):', e.message);
    }
  }

  app.listen(PORT, () => {
    console.log(`Noralta Transaction Master API v3`);
    console.log(`Port: ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Database: ${connected ? 'Connected' : 'NOT CONNECTED'}`);
    console.log(`Server is running!`);
  });
}

start();

process.on('SIGTERM', () => {
  pool.end(() => process.exit(0));
});
