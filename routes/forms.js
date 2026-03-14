// ============================================================================
// FORM ROUTES - 7 endpoints for deal workflow
// All require auth (applied by parent router mounting)
// ============================================================================

const express = require('express');
const router = express.Router();
const path = require('path');

const forms = require(path.join(__dirname, '..', 'data', 'forms.json'));
const formChains = require(path.join(__dirname, '..', 'data', 'form-chains.json'));
const {
  FORM_INDEX,
  reuseGroups,
  loadFormValues,
  saveFormValues,
  loadReuseGroupData,
  calculateProgress
} = require(path.join(__dirname, '..', 'lib', 'reuse-engine'));
const { onFormMilestone } = require(path.join(__dirname, '..', 'lib', 'notifications'));

// Helper: verify deal ownership
async function verifyDealOwnership(pool, dealId, agentId) {
  const result = await pool.query(
    'SELECT id FROM transactions WHERE id = $1 AND agent_id = $2',
    [dealId, agentId]
  );
  return result.rows.length > 0;
}

module.exports = function (pool) {
  // ========================================================================
  // GET /api/forms - List all form definitions (metadata only)
  // ========================================================================
  router.get('/forms', (req, res) => {
    const summary = forms.map(f => ({
      code: f.code,
      id: f.id,
      name: f.name,
      source: f.source,
      pages: f.pages,
      registry: f.registry,
      status: f.status,
      fieldCount: f.sections.reduce((sum, s) => sum + s.fields.length, 0),
      sectionCount: f.sections.length
    }));
    res.json(summary);
  });

  // ========================================================================
  // GET /api/forms/chain/:txnType - Forms for a transaction type
  // ========================================================================
  router.get('/forms/chain/:txnType', (req, res) => {
    const raw = req.params.txnType;
    const baseType = raw.replace(/_(purchase|sale|lease)$/, '');
    const chain = formChains[raw] || formChains[baseType];
    if (!chain) {
      return res.status(404).json({
        error: `Unknown transaction type: ${req.params.txnType}`,
        available: Object.keys(formChains)
      });
    }

    // Enrich with form metadata
    const enriched = chain.forms.map(entry => {
      const form = FORM_INDEX.get(entry.code);
      return {
        ...entry,
        name: form?.name || entry.code,
        fieldCount: form ? form.sections.reduce((sum, s) => sum + s.fields.length, 0) : 0
      };
    });

    res.json({
      type: req.params.txnType,
      label: chain.label,
      forms: enriched
    });
  });

  // ========================================================================
  // GET /api/forms/:formCode - Full form definition with sections + fields
  // ========================================================================
  router.get('/forms/:formCode', (req, res) => {
    const form = FORM_INDEX.get(req.params.formCode);
    if (!form) {
      return res.status(404).json({ error: `Unknown form: ${req.params.formCode}` });
    }
    res.json(form);
  });

  // ========================================================================
  // GET /api/deals/:id/forms/:formCode - Load field values (reuse engine)
  // ========================================================================
  router.get('/deals/:id/forms/:formCode([A-Z0-9-]+)', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const owns = await verifyDealOwnership(pool, dealId, req.agent.agent_id);
      if (!owns) return res.status(404).json({ error: 'Deal not found' });

      const form = FORM_INDEX.get(req.params.formCode);
      if (!form) return res.status(404).json({ error: `Unknown form: ${req.params.formCode}` });

      const values = await loadFormValues(pool, dealId, req.params.formCode);

      res.json({
        formCode: form.code,
        formName: form.name,
        dealId,
        values
      });
    } catch (e) {
      console.error(`Load form values error [${req.params.formCode}]:`, e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // PUT /api/deals/:id/forms/:formCode - Save field values (reuse engine)
  // ========================================================================
  router.put('/deals/:id/forms/:formCode([A-Z0-9-]+)', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const owns = await verifyDealOwnership(pool, dealId, req.agent.agent_id);
      if (!owns) return res.status(404).json({ error: 'Deal not found' });

      const form = FORM_INDEX.get(req.params.formCode);
      if (!form) return res.status(404).json({ error: `Unknown form: ${req.params.formCode}` });

      const { fields } = req.body;
      if (!fields || typeof fields !== 'object') {
        return res.status(400).json({ error: 'Request body must include "fields" object' });
      }

      // Validate all field IDs belong to this form
      const validIds = new Set();
      for (const section of form.sections) {
        for (const field of section.fields) {
          validIds.add(field.id);
        }
      }
      const invalidIds = Object.keys(fields).filter(id => !validIds.has(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({
          error: `Invalid field IDs for form ${form.code}`,
          invalidIds
        });
      }

      const result = await saveFormValues(pool, dealId, req.params.formCode, fields);

      // Log activity (non-critical — don't fail the save response)
      try {
        await pool.query(
          `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
           VALUES ($1, $2, 'form_saved', $3)`,
          [dealId, req.agent.agent_id, JSON.stringify({ formCode: form.code, fieldCount: result.saved })]
        );
      } catch (logErr) {
        console.warn('Activity log failed:', logErr.message);
      }

      // Check if THIS form hit 100% — notify brokers (only check single form, not all 28)
      try {
        const formValues = await loadFormValues(pool, dealId, form.code);
        const allFields = form.sections.flatMap(s => s.fields);
        const total = allFields.length;
        const filled = allFields.filter(f => formValues[f.id] !== null && formValues[f.id] !== undefined && String(formValues[f.id]).trim() !== '').length;
        if (total > 0 && filled === total) {
          onFormMilestone(pool, dealId, form.code, form.name, req.agent.agent_id, req.agent.full_name);
        }
      } catch (e) {
        console.warn('Progress check failed:', e.message);
      }

      res.json({
        message: 'Fields saved',
        formCode: form.code,
        dealId,
        ...result
      });
    } catch (e) {
      console.error(`Save form values error [${req.params.formCode}]:`, e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/deals/:id/reuse/:group - Get all data for a reuse group
  // ========================================================================
  router.get('/deals/:id/reuse/:group', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const owns = await verifyDealOwnership(pool, dealId, req.agent.agent_id);
      if (!owns) return res.status(404).json({ error: 'Deal not found' });

      if (!reuseGroups[req.params.group]) {
        return res.status(404).json({
          error: `Unknown reuse group: ${req.params.group}`,
          available: Object.keys(reuseGroups)
        });
      }

      const data = await loadReuseGroupData(pool, dealId, req.params.group);
      res.json({ dealId, ...data });
    } catch (e) {
      console.error(`Reuse group error [${req.params.group}]:`, e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/deals/:id/progress - Completion % for all forms
  // ========================================================================
  router.get('/deals/:id/progress', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const owns = await verifyDealOwnership(pool, dealId, req.agent.agent_id);
      if (!owns) return res.status(404).json({ error: 'Deal not found' });

      const progress = await calculateProgress(pool, dealId);

      // Overall stats
      let totalFields = 0;
      let totalFilled = 0;
      for (const p of Object.values(progress)) {
        totalFields += p.total;
        totalFilled += p.filled;
      }

      res.json({
        dealId,
        overall: {
          total: totalFields,
          filled: totalFilled,
          pct: totalFields > 0 ? Math.round((totalFilled / totalFields) * 100) : 0
        },
        forms: progress
      });
    } catch (e) {
      console.error('Progress error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // POST /api/deals/:id/signatures - Save a signature
  // ========================================================================
  router.post('/deals/:id/signatures', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const owns = await verifyDealOwnership(pool, dealId, req.agent.agent_id);
      if (!owns) return res.status(404).json({ error: 'Deal not found' });

      const { field_id, signer_name, signer_role, signature_data } = req.body;
      if (!field_id || !signature_data) {
        return res.status(400).json({ error: 'field_id and signature_data are required' });
      }

      // Upsert: delete existing for this field + transaction, then insert
      await pool.query(
        'DELETE FROM signatures WHERE transaction_id = $1 AND field_id = $2',
        [dealId, field_id]
      );

      const result = await pool.query(
        `INSERT INTO signatures (transaction_id, agent_id, field_id, signer_name, signer_role, signature_data, signed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
        [dealId, req.agent.agent_id, field_id, signer_name || req.agent.full_name, signer_role || 'agent', signature_data]
      );

      res.status(201).json({ message: 'Signature saved', id: result.rows[0].id });
    } catch (e) {
      console.error('Save signature error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/deals/:id/signatures - Load all signatures for a deal
  // ========================================================================
  router.get('/deals/:id/signatures', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const owns = await verifyDealOwnership(pool, dealId, req.agent.agent_id);
      if (!owns) return res.status(404).json({ error: 'Deal not found' });

      const result = await pool.query(
        'SELECT field_id, signer_name, signer_role, signature_data, signed_at FROM signatures WHERE transaction_id = $1',
        [dealId]
      );

      // Return as map keyed by field_id
      const signatures = {};
      for (const row of result.rows) {
        signatures[row.field_id] = {
          signer_name: row.signer_name,
          signer_role: row.signer_role,
          signature_data: row.signature_data,
          signed_at: row.signed_at
        };
      }

      res.json({ signatures });
    } catch (e) {
      console.error('Load signatures error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/agents/me/signature - Get agent's most recent signature
  // ========================================================================
  router.get('/agents/me/signature', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT signature_data, signed_at FROM signatures
         WHERE agent_id = $1
         ORDER BY signed_at DESC LIMIT 1`,
        [req.agent.agent_id]
      );

      if (result.rows.length === 0) {
        return res.json({ signature: null });
      }

      res.json({
        signature: result.rows[0].signature_data,
        signed_at: result.rows[0].signed_at
      });
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
