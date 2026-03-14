// ============================================================================
// DOCUMENT ROUTES - PDF generation & conveyancing package
// All require auth (applied by parent router mounting)
// ============================================================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const formChains = require(path.join(__dirname, '..', 'data', 'form-chains.json'));
const { loadFormValues } = require(path.join(__dirname, '..', 'lib', 'reuse-engine'));
const { generateFormPDF, FORM_INDEX } = require(path.join(__dirname, '..', 'lib', 'pdf-generator'));

const BROKER_ROLES = new Set(['broker', 'broker_owner', 'admin']);

// Helper: verify deal access and return deal info
// Brokers/broker_owners/admins can access any deal; agents only their own
async function getDealInfo(pool, dealId, agent) {
  const isBroker = BROKER_ROLES.has(agent.role);
  const query = isBroker
    ? `SELECT t.id, t.status, t.transaction_type, t.created_at,
              p.address as property_address, p.city as property_city
       FROM transactions t
       LEFT JOIN properties p ON p.id = t.property_id
       WHERE t.id = $1`
    : `SELECT t.id, t.status, t.transaction_type, t.created_at,
              p.address as property_address, p.city as property_city
       FROM transactions t
       LEFT JOIN properties p ON p.id = t.property_id
       WHERE t.id = $1 AND t.agent_id = $2`;
  const params = isBroker ? [dealId] : [dealId, agent.agent_id];
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

module.exports = function (pool) {
  // ========================================================================
  // POST /api/deals/:id/forms/:formCode/pdf - Generate single form PDF
  // ========================================================================
  router.post('/deals/:id/forms/:formCode([A-Z0-9-]+)/pdf', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const deal = await getDealInfo(pool, dealId, req.agent);
      if (!deal) return res.status(404).json({ error: 'Deal not found' });

      const formCode = req.params.formCode;
      if (!FORM_INDEX.has(formCode)) {
        return res.status(404).json({ error: `Unknown form: ${formCode}` });
      }

      // Load field values via reuse engine
      const values = await loadFormValues(pool, dealId, formCode);

      // Load signatures for this deal
      const sigResult = await pool.query(
        'SELECT field_id, signature_data FROM signatures WHERE transaction_id = $1',
        [dealId]
      );
      const signatures = {};
      for (const row of sigResult.rows) {
        signatures[row.field_id] = row.signature_data;
      }

      // Generate PDF
      const result = await generateFormPDF(formCode, values, deal, signatures);

      // Track document generation in documents table (non-critical)
      try {
        await pool.query(
          `INSERT INTO documents (transaction_id, form_code, form_name, status, submitted_at, updated_at)
           VALUES ($1, $2, $3, 'generated', NOW(), NOW())
           ON CONFLICT (transaction_id, form_code) DO UPDATE SET status = 'generated', updated_at = NOW()`,
          [dealId, formCode, FORM_INDEX.get(formCode).name]
        );
      } catch (docErr) {
        console.warn('Document tracking failed:', docErr.message);
      }

      // Log activity (non-critical)
      try {
        await pool.query(
          `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
           VALUES ($1, $2, 'pdf_generated', $3)`,
          [dealId, req.agent.agent_id, JSON.stringify({
            formCode,
            mode: result.mode,
            filled: result.filled,
            total: result.total,
            pct: result.pct
          })]
        );
      } catch (logErr) {
        console.warn('Activity log failed:', logErr.message);
      }

      // Send PDF - include property address in filename
      const propSlug = deal.property_address
        ? deal.property_address.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').substring(0, 40)
        : `Deal-${dealId}`;
      const filename = `${formCode}_${propSlug}_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-PDF-Mode', result.mode);
      res.setHeader('X-PDF-Filled', result.filled);
      if (result.total) res.setHeader('X-PDF-Total', result.total);
      if (result.pct !== undefined) res.setHeader('X-PDF-Completion', result.pct);
      res.send(result.bytes);
    } catch (e) {
      console.error(`PDF generation error [${req.params.formCode}]:`, e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // POST /api/deals/:id/package - Generate conveyancing package (ZIP of all forms)
  // ========================================================================
  router.post('/deals/:id/package', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const deal = await getDealInfo(pool, dealId, req.agent);
      if (!deal) return res.status(404).json({ error: 'Deal not found' });

      // Determine which forms to include
      const txnType = deal.transaction_type || 'residential';
      const baseType = txnType.replace(/_(purchase|sale|lease)$/, '');
      const chain = formChains[txnType] || formChains[baseType];
      const formCodes = req.body?.forms || (chain ? chain.forms.map(f => f.code) : []);

      if (formCodes.length === 0) {
        return res.status(400).json({ error: 'No forms to generate. Specify forms[] or ensure deal has a transaction_type.' });
      }

      // Load signatures for this deal (shared across all forms)
      const pkgSigResult = await pool.query(
        'SELECT field_id, signature_data FROM signatures WHERE transaction_id = $1',
        [dealId]
      );
      const pkgSignatures = {};
      for (const row of pkgSigResult.rows) {
        pkgSignatures[row.field_id] = row.signature_data;
      }

      // Generate all PDFs
      const generated = [];
      for (const code of formCodes) {
        const formCode = typeof code === 'string' ? code : code.code;
        if (!FORM_INDEX.has(formCode)) continue;

        try {
          const values = await loadFormValues(pool, dealId, formCode);
          const result = await generateFormPDF(formCode, values, deal, pkgSignatures);

          // Only include forms that have some data
          const hasData = result.filled > 0;
          if (hasData) {
            generated.push({
              formCode,
              formName: FORM_INDEX.get(formCode).name,
              bytes: result.bytes,
              mode: result.mode,
              filled: result.filled,
              total: result.total,
              pct: result.pct
            });
          }
        } catch (err) {
          console.error(`Package: skipping ${formCode}:`, err.message);
        }
      }

      if (generated.length === 0) {
        return res.status(400).json({ error: 'No forms have data to generate. Fill in some form fields first.' });
      }

      // Build property string for filename
      const propStr = deal.property_address
        ? deal.property_address.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30)
        : `Deal-${dealId}`;
      const dateStr = new Date().toISOString().split('T')[0];
      const zipFilename = `Conveyancing_${propStr}_${dateStr}.zip`;

      // Log activity
      await pool.query(
        `INSERT INTO deal_activity_log (transaction_id, agent_id, action, details)
         VALUES ($1, $2, 'package_generated', $3)`,
        [dealId, req.agent.agent_id, JSON.stringify({
          formCount: generated.length,
          forms: generated.map(g => ({ code: g.formCode, pct: g.pct }))
        })]
      );

      // Stream ZIP response
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
      res.setHeader('X-Package-Forms', generated.length);

      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', err => {
        console.error('Archive error:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Package generation failed' });
        }
      });
      archive.pipe(res);

      // Load deal conditions for the manifest
      const conditionsResult = await pool.query(
        'SELECT id, condition_type, description, deadline_date, status, created_at FROM deal_conditions WHERE transaction_id = $1 ORDER BY deadline_date ASC NULLS LAST, created_at',
        [dealId]
      );

      // Add a summary manifest
      const manifest = {
        deal: { id: dealId, type: txnType, property: deal.property_address, status: deal.status },
        generated: new Date().toISOString(),
        agent: req.agent.full_name,
        conditions: conditionsResult.rows.map(c => ({
          type: c.condition_type,
          description: c.description,
          deadline: c.deadline_date,
          status: c.status
        })),
        forms: generated.map(g => ({
          code: g.formCode,
          name: g.formName,
          mode: g.mode,
          completion: `${g.filled}/${g.total} (${g.pct}%)`
        }))
      };
      archive.append(JSON.stringify(manifest, null, 2), { name: '_manifest.json' });

      // Add each PDF
      for (const gen of generated) {
        const pdfName = `${gen.formCode}_${gen.formName.replace(/[^a-zA-Z0-9 -]/g, '').replace(/\s+/g, '_')}.pdf`;
        archive.append(gen.bytes, { name: pdfName });
      }

      // Include static reference documents if they exist
      const procedurePath = path.join(__dirname, '..', 'templates', 'Sale Transaction Procedure for Conveyancing (1).pdf');
      if (fs.existsSync(procedurePath)) {
        archive.file(procedurePath, { name: '_Reference_Sale_Transaction_Procedure.pdf' });
      }

      await archive.finalize();
    } catch (e) {
      console.error('Package generation error:', e.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // ========================================================================
  // GET /api/deals/:id/documents - List generated documents for a deal
  // ========================================================================
  router.get('/deals/:id/documents', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const deal = await getDealInfo(pool, dealId, req.agent);
      if (!deal) return res.status(404).json({ error: 'Deal not found' });

      const docs = await pool.query(
        `SELECT id, form_code, form_name, status, submitted_at, created_at, updated_at
         FROM documents
         WHERE transaction_id = $1
         ORDER BY form_code`,
        [dealId]
      );

      // Also show which forms are available but not yet generated
      const txnType = deal.transaction_type || 'residential';
      const baseType2 = txnType.replace(/_(purchase|sale|lease)$/, '');
      const chain = formChains[txnType] || formChains[baseType2];
      const chainForms = chain ? chain.forms : [];

      const generatedCodes = new Set(docs.rows.map(d => d.form_code));
      const available = chainForms
        .filter(f => !generatedCodes.has(f.code) && FORM_INDEX.has(f.code))
        .map(f => ({
          code: f.code,
          name: FORM_INDEX.get(f.code).name,
          stage: f.stage,
          required: f.required,
          status: 'not_generated'
        }));

      res.json({
        dealId,
        transactionType: txnType,
        generated: docs.rows,
        available
      });
    } catch (e) {
      console.error('Documents list error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // POST /api/deals/:id/forms/:formCode/preview - Preview PDF metadata (no download)
  // ========================================================================
  router.post('/deals/:id/forms/:formCode([A-Z0-9-]+)/preview', async (req, res) => {
    try {
      const dealId = parseInt(req.params.id);
      if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid deal ID' });

      const deal = await getDealInfo(pool, dealId, req.agent);
      if (!deal) return res.status(404).json({ error: 'Deal not found' });

      const formCode = req.params.formCode;
      const formDef = FORM_INDEX.get(formCode);
      if (!formDef) return res.status(404).json({ error: `Unknown form: ${formCode}` });

      // Load values
      const values = await loadFormValues(pool, dealId, formCode);

      // Calculate stats without generating PDF
      const totalDataFields = formDef.sections.reduce(
        (sum, s) => sum + s.fields.filter(f => f.db && f.type !== 'signature').length, 0
      );
      const filledCount = Object.values(values).filter(v => v !== null && v !== undefined && v !== '').length;

      // List empty required-looking fields
      const emptyFields = [];
      for (const section of formDef.sections) {
        for (const field of section.fields) {
          if (field.db && field.type !== 'signature') {
            const val = values[field.id];
            if (val === null || val === undefined || val === '') {
              emptyFields.push({ id: field.id, label: field.label, section: section.name });
            }
          }
        }
      }

      const hasTemplate = !!require(path.join(__dirname, '..', 'data', 'template-map.json')).templates[formCode];
      const hasOverlay = !!require(path.join(__dirname, '..', 'data', 'overlay-maps.json'))[formCode];
      const mode = hasTemplate ? 'template' : hasOverlay ? 'overlay' : 'datasheet';

      res.json({
        dealId,
        formCode,
        formName: formDef.name,
        hasTemplate,
        mode,
        completion: {
          filled: filledCount,
          total: totalDataFields,
          pct: totalDataFields > 0 ? Math.round((filledCount / totalDataFields) * 100) : 0
        },
        emptyFields: emptyFields.slice(0, 20), // Cap at 20 for readability
        emptyCount: emptyFields.length
      });
    } catch (e) {
      console.error(`Preview error [${req.params.formCode}]:`, e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
