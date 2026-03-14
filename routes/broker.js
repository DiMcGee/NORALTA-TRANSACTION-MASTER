// ============================================================================
// BROKER OVERSIGHT ROUTES - Dashboard for broker/admin
// Requires auth + broker or admin role
// ============================================================================

const express = require('express');
const router = express.Router();

const BROKER_ROLES = new Set(['broker', 'broker_owner', 'admin']);

function requireBroker(req, res, next) {
  if (!req.agent || !req.agent.role) {
    // Need to fetch role since requireAuth doesn't include it
    return res._pool.query(
      'SELECT role FROM agents WHERE id = $1',
      [req.agent.agent_id]
    ).then(result => {
      const role = result.rows[0]?.role;
      if (!BROKER_ROLES.has(role)) {
        return res.status(403).json({ error: 'Broker or admin access required' });
      }
      req.agent.role = role;
      next();
    }).catch(() => res.status(500).json({ error: 'Role check failed' }));
  } else if (!BROKER_ROLES.has(req.agent.role)) {
    return res.status(403).json({ error: 'Broker or admin access required' });
  } else {
    next();
  }
}

module.exports = function (pool) {
  // Attach pool to response for middleware use
  router.use((req, res, next) => {
    res._pool = pool;
    next();
  });

  // ========================================================================
  // GET /api/broker/stats - Brokerage-wide overview
  // ========================================================================
  router.get('/broker/stats', requireBroker, async (req, res) => {
    try {
      const [dealsByStatus, dealsByType, agentCount, recentActivity] = await Promise.all([
        pool.query(`
          SELECT status, COUNT(*) as count
          FROM transactions
          GROUP BY status ORDER BY count DESC
        `),
        pool.query(`
          SELECT transaction_type, COUNT(*) as count
          FROM transactions
          GROUP BY transaction_type ORDER BY count DESC
        `),
        pool.query("SELECT COUNT(*) FROM agents WHERE password_hash IS NOT NULL"),
        pool.query(`
          SELECT COUNT(*) as total,
                 COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7_days,
                 COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as last_30_days
          FROM transactions
        `)
      ]);

      res.json({
        agents: parseInt(agentCount.rows[0].count),
        deals: {
          byStatus: dealsByStatus.rows.reduce((acc, r) => { acc[r.status] = parseInt(r.count); return acc; }, {}),
          byType: dealsByType.rows.reduce((acc, r) => { acc[r.transaction_type || 'unset'] = parseInt(r.count); return acc; }, {}),
          total: parseInt(recentActivity.rows[0].total),
          last7Days: parseInt(recentActivity.rows[0].last_7_days),
          last30Days: parseInt(recentActivity.rows[0].last_30_days)
        }
      });
    } catch (e) {
      console.error('Broker stats error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/broker/agents - All agents with deal counts
  // ========================================================================
  router.get('/broker/agents', requireBroker, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          a.id, a.full_name, a.email, a.phone, a.branch, a.role, a.title, a.office_location_id, a.created_at,
          COUNT(t.id) as total_deals,
          COUNT(t.id) FILTER (WHERE t.status = 'draft') as draft_deals,
          COUNT(t.id) FILTER (WHERE t.status = 'active') as active_deals,
          COUNT(t.id) FILTER (WHERE t.status = 'conditional') as conditional_deals,
          COUNT(t.id) FILTER (WHERE t.status = 'firm') as firm_deals,
          COUNT(t.id) FILTER (WHERE t.status = 'closed') as closed_deals,
          MAX(t.updated_at) as last_deal_activity
        FROM agents a
        LEFT JOIN transactions t ON t.agent_id = a.id
        WHERE a.password_hash IS NOT NULL
        GROUP BY a.id
        ORDER BY a.full_name
      `);

      res.json(result.rows);
    } catch (e) {
      console.error('Broker agents error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/broker/deals - All deals across all agents (with search/filter)
  // ========================================================================
  router.get('/broker/deals', requireBroker, async (req, res) => {
    try {
      const { status, type, agent_id, search, sort, order, page, limit } = req.query;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 20));
      const offset = (pageNum - 1) * pageSize;

      const sortMap = {
        updated_at: 't.updated_at', created_at: 't.created_at',
        status: 't.status', price: 't.purchase_price',
        address: 'p.address', agent: 'a.full_name'
      };
      const sortCol = sortMap[sort] || 't.updated_at';
      const sortDir = order === 'asc' ? 'ASC' : 'DESC';

      const conditions = [];
      const params = [];
      let paramIdx = 1;

      if (status) {
        conditions.push(`t.status = $${paramIdx++}`);
        params.push(status);
      }
      if (type) {
        conditions.push(`t.transaction_type = $${paramIdx++}`);
        params.push(type);
      }
      if (agent_id) {
        conditions.push(`t.agent_id = $${paramIdx++}`);
        params.push(parseInt(agent_id));
      }
      if (search) {
        conditions.push(`(
          p.address ILIKE $${paramIdx} OR p.city ILIKE $${paramIdx} OR
          a.full_name ILIKE $${paramIdx} OR
          EXISTS (SELECT 1 FROM transaction_participants tp2
                  JOIN parties par2 ON par2.id = tp2.party_id
                  WHERE tp2.transaction_id = t.id AND par2.full_name ILIKE $${paramIdx})
        )`);
        params.push(`%${search}%`);
        paramIdx++;
      }

      const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM transactions t
         LEFT JOIN properties p ON p.id = t.property_id
         LEFT JOIN agents a ON a.id = t.agent_id
         ${where}`, params
      );
      const total = parseInt(countResult.rows[0].count);

      const result = await pool.query(`
        SELECT
          t.id, t.status, t.transaction_type, t.purchase_price,
          t.updated_at, t.created_at,
          p.address as property_address, p.city as property_city,
          a.full_name as agent_name, a.email as agent_email,
          (SELECT par.full_name FROM transaction_participants tp
           JOIN parties par ON par.id = tp.party_id
           WHERE tp.transaction_id = t.id AND tp.role = 'buyer' LIMIT 1) as buyer_name,
          (SELECT par.full_name FROM transaction_participants tp
           JOIN parties par ON par.id = tp.party_id
           WHERE tp.transaction_id = t.id AND tp.role = 'seller' LIMIT 1) as seller_name
        FROM transactions t
        LEFT JOIN properties p ON p.id = t.property_id
        LEFT JOIN agents a ON a.id = t.agent_id
        ${where}
        ORDER BY ${sortCol} ${sortDir}
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `, [...params, pageSize, offset]);

      res.json({
        deals: result.rows,
        pagination: { page: pageNum, limit: pageSize, total, pages: Math.ceil(total / pageSize) }
      });
    } catch (e) {
      console.error('Broker deals error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/broker/deals/:id - Broker can view any deal detail
  // ========================================================================
  router.get('/broker/deals/:id', requireBroker, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid deal ID' });
      const tx = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
      if (tx.rows.length === 0) {
        return res.status(404).json({ error: 'Deal not found' });
      }

      const [property, participants, documents, activity] = await Promise.all([
        pool.query('SELECT * FROM properties WHERE id = $1', [tx.rows[0].property_id]),
        pool.query(
          `SELECT tp.*, par.full_name as party_name, par.email as party_email,
                  a.full_name as agent_name, b.name as brokerage_name, l.name as lawyer_name
           FROM transaction_participants tp
           LEFT JOIN parties par ON par.id = tp.party_id
           LEFT JOIN agents a ON a.id = tp.agent_id
           LEFT JOIN brokerages b ON b.id = tp.brokerage_id
           LEFT JOIN lawyers l ON l.id = tp.lawyer_id
           WHERE tp.transaction_id = $1`, [id]
        ),
        pool.query('SELECT * FROM documents WHERE transaction_id = $1 ORDER BY form_code', [id]),
        pool.query(
          `SELECT dal.*, a.full_name as agent_name
           FROM deal_activity_log dal LEFT JOIN agents a ON a.id = dal.agent_id
           WHERE dal.transaction_id = $1 ORDER BY dal.created_at DESC LIMIT 20`, [id]
        )
      ]);

      const agent = await pool.query('SELECT id, full_name, email, branch FROM agents WHERE id = $1', [tx.rows[0].agent_id]);

      res.json({
        transaction: tx.rows[0],
        agent: agent.rows[0] || null,
        property: property.rows[0] || null,
        participants: participants.rows,
        documents: documents.rows,
        activity: activity.rows
      });
    } catch (e) {
      console.error('Broker deal detail error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // PUT /api/broker/agents/:id/role - Update agent role (broker only)
  // ========================================================================
  router.put('/broker/agents/:id/role', requireBroker, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid agent ID' });
      const { role } = req.body;
      const validRoles = ['agent', 'broker', 'broker_owner', 'admin'];
      if (!role || !validRoles.includes(role)) {
        return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
      }

      // Only broker_owner/admin can assign elevated roles
      const elevatedRoles = new Set(['broker_owner', 'admin']);
      if (elevatedRoles.has(role) && !elevatedRoles.has(req.agent.role)) {
        return res.status(403).json({ error: 'Only broker owners and admins can assign elevated roles' });
      }

      const agent = await pool.query('SELECT id, full_name FROM agents WHERE id = $1', [id]);
      if (agent.rows.length === 0) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      await pool.query('UPDATE agents SET role = $1 WHERE id = $2', [role, id]);
      res.json({ message: 'Role updated', agentId: parseInt(id), name: agent.rows[0].full_name, role });
    } catch (e) {
      console.error('Role update error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/broker/activity - Recent activity across all deals
  // ========================================================================
  router.get('/broker/activity', requireBroker, async (req, res) => {
    try {
      const { limit: lim } = req.query;
      const maxRows = Math.min(100, Math.max(1, parseInt(lim) || 50));

      const result = await pool.query(`
        SELECT dal.*, a.full_name as agent_name,
               p.address as property_address
        FROM deal_activity_log dal
        LEFT JOIN agents a ON a.id = dal.agent_id
        LEFT JOIN transactions t ON t.id = dal.transaction_id
        LEFT JOIN properties p ON p.id = t.property_id
        ORDER BY dal.created_at DESC
        LIMIT $1
      `, [maxRows]);

      res.json(result.rows);
    } catch (e) {
      console.error('Broker activity error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // FORM VERSION MONITORING
  // ========================================================================

  // GET /api/broker/form-versions - List all tracked form versions
  router.get('/broker/form-versions', requireBroker, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT * FROM form_versions ORDER BY form_code`
      );
      res.json(result.rows);
    } catch (e) {
      console.error('Form versions error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/broker/form-versions/audit - Run audit scan (seeds/updates form_versions)
  router.post('/broker/form-versions/audit', requireBroker, async (req, res) => {
    try {
      const path = require('path');
      const allForms = require(path.join(__dirname, '..', 'data', 'forms.json'));
      const overlayMaps = require(path.join(__dirname, '..', 'data', 'overlay-maps.json'));
      const fs = require('fs');
      const templateDir = path.join(__dirname, '..', 'templates');

      const results = [];
      for (const form of allForms) {
        const overlay = overlayMaps[form.code];
        const hasTemplate = overlay && overlay.file && fs.existsSync(path.join(templateDir, overlay.file));
        const fieldCount = form.sections.reduce((sum, s) => sum + s.fields.length, 0);
        const mappedCount = overlay ? Object.keys(overlay.fields || {}).length : 0;

        // Upsert into form_versions
        await pool.query(`
          INSERT INTO form_versions (form_code, form_name, current_version, source, last_audited, status, notes)
          VALUES ($1, $2, '1.0', $3, NOW(), $4, $5)
          ON CONFLICT (form_code) DO UPDATE SET
            last_audited = NOW(),
            status = $4,
            notes = $5,
            updated_at = NOW()
        `, [
          form.code,
          form.name,
          overlay ? 'AREA' : 'Internal',
          hasTemplate ? 'current' : 'review_needed',
          `${fieldCount} fields, ${mappedCount} mapped` + (hasTemplate ? ', PDF template present' : ', no PDF template')
        ]);

        results.push({
          code: form.code,
          name: form.name,
          fields: fieldCount,
          mapped: mappedCount,
          hasTemplate,
          status: hasTemplate ? 'current' : 'review_needed'
        });
      }

      // Log activity
      await pool.query(
        `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
         VALUES (NULL, $1, 'form_audit', $2)`,
        [req.agent.agent_id, JSON.stringify({ formsAudited: results.length, timestamp: new Date().toISOString() })]
      ).catch(() => {}); // Ignore if transaction_id NOT NULL constraint fails

      res.json({
        message: 'Audit complete',
        audited: results.length,
        forms: results
      });
    } catch (e) {
      console.error('Form audit error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // POST /api/broker/agents/invite - Create agent account (broker only)
  // ========================================================================
  router.post('/broker/agents/invite', requireBroker, async (req, res) => {
    try {
      const { full_name, email, phone, role } = req.body;
      if (!full_name || !email) {
        return res.status(400).json({ error: 'full_name and email are required' });
      }

      // Check if agent exists
      const existing = await pool.query('SELECT id FROM agents WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'An agent with this email already exists' });
      }

      // Generate temp password
      const crypto = require('crypto');
      const tempPassword = crypto.randomBytes(4).toString('hex'); // 8 char hex
      const bcryptLib = require('bcryptjs');
      const hash = await bcryptLib.hash(tempPassword, 10);

      const validRoles = ['agent', 'broker', 'broker_owner'];
      const agentRole = validRoles.includes(role) ? role : 'agent';

      const result = await pool.query(
        `INSERT INTO agents (full_name, email, phone, password_hash, role)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, role`,
        [full_name, email, phone || null, hash, agentRole]
      );

      res.status(201).json({
        message: 'Agent invited',
        agent: result.rows[0],
        tempPassword
      });
    } catch (e) {
      console.error('Invite agent error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/broker/export/deals - CSV export of all deals
  // ========================================================================
  router.get('/broker/export/deals', requireBroker, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          t.id as deal_id, t.status, t.transaction_type,
          t.purchase_price, t.possession_date, t.completion_date,
          t.created_at, t.updated_at,
          p.address as property_address, p.city as property_city, p.postal_code as property_postal_code,
          a.full_name as agent_name, a.email as agent_email,
          (SELECT par.full_name FROM transaction_participants tp
           JOIN parties par ON par.id = tp.party_id
           WHERE tp.transaction_id = t.id AND tp.role = 'buyer' LIMIT 1) as buyer_name,
          (SELECT par.email FROM transaction_participants tp
           JOIN parties par ON par.id = tp.party_id
           WHERE tp.transaction_id = t.id AND tp.role = 'buyer' LIMIT 1) as buyer_email,
          (SELECT par.full_name FROM transaction_participants tp
           JOIN parties par ON par.id = tp.party_id
           WHERE tp.transaction_id = t.id AND tp.role = 'seller' LIMIT 1) as seller_name,
          (SELECT par.email FROM transaction_participants tp
           JOIN parties par ON par.id = tp.party_id
           WHERE tp.transaction_id = t.id AND tp.role = 'seller' LIMIT 1) as seller_email
        FROM transactions t
        LEFT JOIN properties p ON p.id = t.property_id
        LEFT JOIN agents a ON a.id = t.agent_id
        ORDER BY t.created_at DESC
      `);

      // Build CSV
      const headers = [
        'Deal ID', 'Status', 'Type', 'Purchase Price',
        'Possession Date', 'Completion Date', 'Created', 'Updated',
        'Property Address', 'City', 'Postal Code',
        'Agent', 'Agent Email',
        'Buyer', 'Buyer Email', 'Seller', 'Seller Email'
      ];

      const escCsv = (v) => {
        if (v === null || v === undefined) return '';
        let s = String(v);
        // Prevent CSV formula injection
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes("'")) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };

      const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '';

      let csv = headers.join(',') + '\n';
      for (const r of result.rows) {
        csv += [
          r.deal_id, escCsv(r.status), escCsv(r.transaction_type), escCsv(r.purchase_price || ''),
          formatDate(r.possession_date), formatDate(r.completion_date),
          formatDate(r.created_at), formatDate(r.updated_at),
          escCsv(r.property_address), escCsv(r.property_city), escCsv(r.property_postal_code || ''),
          escCsv(r.agent_name), escCsv(r.agent_email || ''),
          escCsv(r.buyer_name), escCsv(r.buyer_email || ''),
          escCsv(r.seller_name), escCsv(r.seller_email || '')
        ].join(',') + '\n';
      }

      const dateStr = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="Noralta_Deals_${dateStr}.csv"`);
      res.send(csv);
    } catch (e) {
      console.error('CSV export error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/broker/email-status - Check SMTP configuration status
  // ========================================================================
  router.get('/broker/email-status', requireBroker, async (req, res) => {
    res.json({
      configured: !!process.env.SMTP_HOST,
      host: process.env.SMTP_HOST ? process.env.SMTP_HOST.replace(/./g, (c, i) => i < 3 ? c : '*') : null,
      from: process.env.SMTP_FROM || null
    });
  });

  // GET /api/broker/form-alerts - Get forms needing attention
  router.get('/broker/form-alerts', requireBroker, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT * FROM form_versions
        WHERE status != 'current'
           OR last_audited IS NULL
           OR last_audited < NOW() - INTERVAL '30 days'
        ORDER BY
          CASE WHEN status = 'outdated' THEN 0
               WHEN status = 'review_needed' THEN 1
               WHEN last_audited IS NULL THEN 2
               ELSE 3 END,
          form_code
      `);

      const neverAudited = await pool.query(
        `SELECT COUNT(*) FROM form_versions WHERE last_audited IS NULL`
      );
      const stale = await pool.query(
        `SELECT COUNT(*) FROM form_versions WHERE last_audited < NOW() - INTERVAL '30 days'`
      );

      res.json({
        alerts: result.rows,
        summary: {
          total: result.rows.length,
          neverAudited: parseInt(neverAudited.rows[0].count),
          staleOver30Days: parseInt(stale.rows[0].count)
        }
      });
    } catch (e) {
      console.error('Form alerts error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
