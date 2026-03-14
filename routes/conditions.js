// ============================================================================
// CONDITION ROUTES - CRUD for deal conditions (financing, inspection, etc.)
// All require auth (applied by parent router mounting)
// ============================================================================

const express = require('express');
const router = express.Router();

const BROKER_ROLES = new Set(['broker', 'broker_owner', 'admin']);

async function verifyDealAccess(pool, dealId, agent) {
  // Brokers / broker_owners / admins can access ANY deal
  if (BROKER_ROLES.has(agent.role)) {
    const result = await pool.query(
      'SELECT id FROM transactions WHERE id = $1',
      [dealId]
    );
    return result.rows.length > 0;
  }
  // Regular agents can only access their own deals
  const result = await pool.query(
    'SELECT id FROM transactions WHERE id = $1 AND agent_id = $2',
    [dealId, agent.agent_id]
  );
  return result.rows.length > 0;
}

module.exports = function (pool) {
  // GET /api/deals/:id/conditions
  router.get('/deals/:id/conditions', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const hasAccess = await verifyDealAccess(pool, dealId, req.agent);
      if (!hasAccess) return res.status(404).json({ error: 'Deal not found' });

      const result = await pool.query(
        'SELECT * FROM deal_conditions WHERE transaction_id = $1 ORDER BY deadline_date ASC NULLS LAST, created_at',
        [dealId]
      );
      res.json(result.rows);
    } catch (e) {
      console.error('Condition error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/deals/:id/conditions
  router.post('/deals/:id/conditions', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const hasAccess = await verifyDealAccess(pool, dealId, req.agent);
      if (!hasAccess) return res.status(404).json({ error: 'Deal not found' });

      const { condition_type, description, deadline_date } = req.body;
      if (!condition_type) return res.status(400).json({ error: 'condition_type is required' });

      const result = await pool.query(
        `INSERT INTO deal_conditions (transaction_id, condition_type, description, deadline_date)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [dealId, condition_type, description || null, deadline_date || null]
      );

      await pool.query(
        `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
         VALUES ($1, $2, 'condition_added', $3)`,
        [dealId, req.agent.agent_id, JSON.stringify({ type: condition_type })]
      );

      res.status(201).json(result.rows[0]);
    } catch (e) {
      console.error('Condition error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/deals/:id/conditions/:condId
  router.put('/deals/:id/conditions/:condId', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const condId = parseInt(req.params.condId);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });
      if (isNaN(condId)) return res.status(400).json({ error: 'Invalid condition ID' });

      const hasAccess = await verifyDealAccess(pool, dealId, req.agent);
      if (!hasAccess) return res.status(404).json({ error: 'Deal not found' });

      const { condition_type, description, deadline_date, status } = req.body;
      const validStatuses = ['pending', 'waived', 'fulfilled', 'expired'];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
      }

      const result = await pool.query(
        `UPDATE deal_conditions SET
           condition_type = COALESCE($1, condition_type),
           description = COALESCE($2, description),
           deadline_date = COALESCE($3, deadline_date),
           status = COALESCE($4, status),
           updated_at = NOW()
         WHERE id = $5 AND transaction_id = $6 RETURNING *`,
        [condition_type || null, description, deadline_date, status || null, condId, dealId]
      );

      if (result.rows.length === 0) return res.status(404).json({ error: 'Condition not found' });

      if (status) {
        await pool.query(
          `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
           VALUES ($1, $2, 'condition_updated', $3)`,
          [dealId, req.agent.agent_id, JSON.stringify({ conditionId: condId, status })]
        );
      }

      res.json(result.rows[0]);
    } catch (e) {
      console.error('Condition error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/deals/:id/conditions/:condId
  router.delete('/deals/:id/conditions/:condId', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const condId = parseInt(req.params.condId);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });
      if (isNaN(condId)) return res.status(400).json({ error: 'Invalid condition ID' });

      const hasAccess = await verifyDealAccess(pool, dealId, req.agent);
      if (!hasAccess) return res.status(404).json({ error: 'Deal not found' });

      const result = await pool.query(
        'DELETE FROM deal_conditions WHERE id = $1 AND transaction_id = $2 RETURNING id',
        [condId, dealId]
      );

      if (result.rows.length === 0) return res.status(404).json({ error: 'Condition not found' });
      res.json({ message: 'Condition deleted' });
    } catch (e) {
      console.error('Condition error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
