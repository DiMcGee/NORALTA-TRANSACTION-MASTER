// ============================================================================
// REUSE ENGINE - Core resolution for cross-form data reuse
// 5 patterns: self, direct, fixed, participant, child
// Batched reads (group by table), transactional writes
// ============================================================================

const path = require('path');
const forms = require(path.join(__dirname, '..', 'data', 'forms.json'));
const reuseGroups = require(path.join(__dirname, '..', 'data', 'reuse-groups.json'));

// Build whitelist of allowed table.column pairs from forms.json at startup
const ALLOWED_COLUMNS = new Set();
const FORM_INDEX = new Map(); // code -> form definition

for (const form of forms) {
  FORM_INDEX.set(form.code, form);
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (field.db) {
        ALLOWED_COLUMNS.add(field.db);
      }
    }
  }
}

// Validate that a table.column pair is in our whitelist
function isAllowed(tableCol) {
  return ALLOWED_COLUMNS.has(tableCol);
}

// Nested child tables: link through parent table instead of transaction_id
const NESTED_CHILDREN = {
  seller_rep_amendments: { parent: 'seller_rep', fk: 'seller_rep_id' },
  commercial_buyer_amendments: { parent: 'commercial_buyer_rep', fk: 'buyer_rep_id' },
  commercial_landlord_amendments: { parent: 'commercial_landlord_rep', fk: 'landlord_rep_id' },
  commercial_landlord_appendix: { parent: 'commercial_landlord_rep', fk: 'landlord_rep_id' }
};

// FK-linked tables: resolve through transactions FK (no transaction_id column)
const FK_TABLES = {
  properties: { fk: 'property_id' },
  agents: { fk: 'agent_id' }
};

// Self-referencing table: non-reuse fields on transactions write directly via id
const SELF_TABLE = 'transactions';

// ============================================================================
// BATCHED READ - Load all field values for a form
// ============================================================================

async function loadFormValues(pool, transactionId, formCode) {
  const form = FORM_INDEX.get(formCode);
  if (!form) throw new Error(`Unknown form: ${formCode}`);

  // Group fields by resolution strategy
  const readBatches = new Map(); // key -> { fields, resolver }

  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!field.db) continue; // skip signature-only fields

      const [table, column] = field.db.split('.');

      if (field.reuse) {
        const group = reuseGroups[field.reuse];
        if (!group) continue;
        const batchKey = `reuse:${field.reuse}:${group.pattern === 'participant' ? group.entityTable : group.table || table}`;
        if (!readBatches.has(batchKey)) {
          readBatches.set(batchKey, { group: field.reuse, config: group, columns: new Set(), fields: [] });
        }
        const batch = readBatches.get(batchKey);
        batch.columns.add(column);
        batch.fields.push(field);
      } else {
        // Non-reuse: read from child table
        const batchKey = `child:${table}`;
        if (!readBatches.has(batchKey)) {
          readBatches.set(batchKey, { table, columns: new Set(), fields: [] });
        }
        const batch = readBatches.get(batchKey);
        batch.columns.add(column);
        batch.fields.push(field);
      }
    }
  }

  // Execute all batches in parallel
  const values = {};
  const promises = [];

  for (const [key, batch] of readBatches) {
    if (key.startsWith('reuse:')) {
      promises.push(
        readReuseGroup(pool, transactionId, batch.config, batch.group, [...batch.columns])
          .then(row => {
            for (const field of batch.fields) {
              const col = field.db.split('.')[1];
              values[field.id] = row ? row[col] ?? null : null;
            }
          })
          .catch(() => {
            // Reuse group read failed — gracefully fall back to null values
            for (const field of batch.fields) {
              values[field.id] = null;
            }
          })
      );
    } else {
      promises.push(
        readChildTable(pool, transactionId, batch.table, [...batch.columns])
          .then(row => {
            for (const field of batch.fields) {
              const col = field.db.split('.')[1];
              values[field.id] = row ? row[col] ?? null : null;
            }
          })
          .catch(() => {
            // Table may not have transaction_id and isn't in special maps — skip gracefully
            for (const field of batch.fields) {
              values[field.id] = null;
            }
          })
      );
    }
  }

  await Promise.all(promises);
  return values;
}

// ============================================================================
// READ HELPERS (one per pattern)
// ============================================================================

// Pattern A - "self": read directly from transactions row
async function readSelf(pool, transactionId, columns) {
  const cols = columns.filter(c => isAllowed(`transactions.${c}`));
  if (cols.length === 0) return null;
  const result = await pool.query(
    `SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM transactions WHERE id = $1`,
    [transactionId]
  );
  return result.rows[0] || null;
}

// Pattern B - "direct": follow FK on transactions
async function readDirect(pool, transactionId, table, fk, columns) {
  const cols = columns.filter(c => isAllowed(`${table}.${c}`));
  if (cols.length === 0) return null;
  const result = await pool.query(
    `SELECT ${cols.map(c => `t."${c}"`).join(', ')}
     FROM ${table} t
     JOIN transactions tx ON tx."${fk}" = t.id
     WHERE tx.id = $1`,
    [transactionId]
  );
  return result.rows[0] || null;
}

// Pattern C - "fixed": read from fixed row (e.g., brokerage id=1)
async function readFixed(pool, table, fixedId, columns) {
  const cols = columns.filter(c => isAllowed(`${table}.${c}`));
  if (cols.length === 0) return null;
  const result = await pool.query(
    `SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM ${table} WHERE id = $1`,
    [fixedId]
  );
  return result.rows[0] || null;
}

// Pattern F - "office": brokerage data merged with agent's office location
// Brokerage-level fields (name, name_2, fax) come from brokerages table
// Office-specific fields (address, postal_code, phone, email) come from office_locations
const OFFICE_FIELDS = new Set(['address', 'postal_code', 'phone', 'email']);

async function readOfficeLocation(pool, transactionId, fallbackTable, fallbackId, columns) {
  // Look up agent's office location through transaction -> agent -> office_location
  const agentResult = await pool.query(
    `SELECT a.office_location_id
     FROM agents a
     JOIN transactions t ON t.agent_id = a.id
     WHERE t.id = $1`,
    [transactionId]
  );
  const officeId = agentResult.rows[0]?.office_location_id;

  // If no office location set, fall back to fixed brokerage record
  if (!officeId) {
    return readFixed(pool, fallbackTable, fallbackId, columns);
  }

  const result = {};

  // Get office-specific fields from office_locations
  const officeCols = columns.filter(c => OFFICE_FIELDS.has(c) && isAllowed(`${fallbackTable}.${c}`));
  if (officeCols.length > 0) {
    const officeResult = await pool.query(
      `SELECT ${officeCols.map(c => `"${c}"`).join(', ')} FROM office_locations WHERE id = $1`,
      [officeId]
    );
    if (officeResult.rows[0]) {
      Object.assign(result, officeResult.rows[0]);
    }
  }

  // Get brokerage-level fields (name, name_2, fax, etc.) from fixed brokerage
  const brokCols = columns.filter(c => !OFFICE_FIELDS.has(c) && isAllowed(`${fallbackTable}.${c}`));
  if (brokCols.length > 0) {
    const brokResult = await pool.query(
      `SELECT ${brokCols.map(c => `"${c}"`).join(', ')} FROM ${fallbackTable} WHERE id = $1`,
      [fallbackId]
    );
    if (brokResult.rows[0]) {
      Object.assign(result, brokResult.rows[0]);
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// Pattern D - "participant": resolve through transaction_participants junction
async function readParticipant(pool, transactionId, role, entityTable, entityFK, columns) {
  const cols = columns.filter(c => isAllowed(`${entityTable}.${c}`));
  if (cols.length === 0) return null;
  const result = await pool.query(
    `SELECT ${cols.map(c => `e."${c}"`).join(', ')}
     FROM transaction_participants tp
     JOIN ${entityTable} e ON e.id = tp."${entityFK}"
     WHERE tp.transaction_id = $1 AND tp.role = $2
     LIMIT 1`,
    [transactionId, role]
  );
  return result.rows[0] || null;
}

// Pattern E - "child": read child table by transaction_id (or through parent/FK for special tables)
async function readChildTable(pool, transactionId, table, columns) {
  const cols = columns.filter(c => isAllowed(`${table}.${c}`));
  if (cols.length === 0) return null;

  // Self-reference: non-reuse fields on transactions table read directly
  if (table === SELF_TABLE) {
    return readSelf(pool, transactionId, cols);
  }

  // Nested child: join through parent table (e.g., seller_rep_amendments → seller_rep)
  const nested = NESTED_CHILDREN[table];
  if (nested) {
    const result = await pool.query(
      `SELECT ${cols.map(c => `c."${c}"`).join(', ')}
       FROM ${table} c
       JOIN ${nested.parent} p ON p.id = c."${nested.fk}"
       WHERE p.transaction_id = $1
       LIMIT 1`,
      [transactionId]
    );
    return result.rows[0] || null;
  }

  // FK-linked table: join through transactions FK (e.g., properties → transactions.property_id)
  const fkTable = FK_TABLES[table];
  if (fkTable) {
    const result = await pool.query(
      `SELECT ${cols.map(c => `t."${c}"`).join(', ')}
       FROM ${table} t
       JOIN transactions tx ON tx."${fkTable.fk}" = t.id
       WHERE tx.id = $1`,
      [transactionId]
    );
    return result.rows[0] || null;
  }

  const result = await pool.query(
    `SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM ${table} WHERE transaction_id = $1 LIMIT 1`,
    [transactionId]
  );
  return result.rows[0] || null;
}

// Dispatcher for reuse group reads
async function readReuseGroup(pool, transactionId, config, groupName, columns) {
  switch (config.pattern) {
    case 'self':
      return readSelf(pool, transactionId, columns);
    case 'direct':
      return readDirect(pool, transactionId, config.table, config.fk, columns);
    case 'fixed':
      return readFixed(pool, config.table, config.fixedId, columns);
    case 'office':
      return readOfficeLocation(pool, transactionId, config.table, config.fixedId, columns);
    case 'participant':
      return readParticipant(pool, transactionId, config.role, config.entityTable, config.entityFK, columns);
    case 'child':
      return readChildTable(pool, transactionId, config.table, columns);
    default:
      return null;
  }
}

// ============================================================================
// BATCHED WRITE - Save field values for a form
// ============================================================================

async function saveFormValues(pool, transactionId, formCode, fieldValues) {
  const form = FORM_INDEX.get(formCode);
  if (!form) throw new Error(`Unknown form: ${formCode}`);

  // Build field lookup: id -> field definition
  const fieldDefs = new Map();
  for (const section of form.sections) {
    for (const field of section.fields) {
      fieldDefs.set(field.id, field);
    }
  }

  // Group writes by target
  const writeBatches = new Map();

  for (const [fieldId, rawValue] of Object.entries(fieldValues)) {
    const field = fieldDefs.get(fieldId);
    if (!field || !field.db) continue;

    const [table, column] = field.db.split('.');
    if (!isAllowed(field.db)) continue;

    // Coerce empty strings to null (PostgreSQL rejects "" for non-text types like BOOLEAN, TIME, DATE)
    const value = (rawValue === '' || rawValue === null || rawValue === undefined) ? null : rawValue;

    if (field.reuse) {
      const config = reuseGroups[field.reuse];
      if (!config || config.readOnly) continue;

      const batchKey = `reuse:${field.reuse}`;
      if (!writeBatches.has(batchKey)) {
        writeBatches.set(batchKey, { type: 'reuse', group: field.reuse, config, updates: {} });
      }
      writeBatches.get(batchKey).updates[column] = value;
    } else {
      const batchKey = `child:${table}`;
      if (!writeBatches.has(batchKey)) {
        writeBatches.set(batchKey, { type: 'child', table, updates: {} });
      }
      writeBatches.get(batchKey).updates[column] = value;
    }
  }

  // Execute all writes in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [key, batch] of writeBatches) {
      if (batch.type === 'reuse') {
        await writeReuseGroup(client, transactionId, batch.config, batch.group, batch.updates);
      } else {
        await writeChildTable(client, transactionId, batch.table, batch.updates);
      }
    }

    // Update transaction timestamp
    await client.query('UPDATE transactions SET updated_at = NOW() WHERE id = $1', [transactionId]);

    await client.query('COMMIT');
    return { saved: Object.keys(fieldValues).length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// WRITE HELPERS
// ============================================================================

// Pattern A - "self": update transactions row directly
async function writeSelf(client, transactionId, updates) {
  const entries = Object.entries(updates).filter(([c]) => isAllowed(`transactions.${c}`));
  if (entries.length === 0) return;
  const sets = entries.map(([c], i) => `"${c}" = $${i + 2}`);
  const vals = entries.map(([, v]) => v);
  await client.query(
    `UPDATE transactions SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [transactionId, ...vals]
  );
}

// Pattern B - "direct": follow FK, update or create the related entity
async function writeDirect(client, transactionId, table, fk, updates) {
  const entries = Object.entries(updates).filter(([c]) => isAllowed(`${table}.${c}`));
  if (entries.length === 0) return;

  // Check if FK exists on transaction
  const txRow = await client.query(`SELECT "${fk}" FROM transactions WHERE id = $1`, [transactionId]);
  let entityId = txRow.rows[0]?.[fk];

  if (!entityId) {
    // Auto-create entity
    const cols = entries.map(([c]) => `"${c}"`);
    const placeholders = entries.map((_, i) => `$${i + 1}`);
    const vals = entries.map(([, v]) => v);
    const result = await client.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
      vals
    );
    entityId = result.rows[0].id;
    await client.query(`UPDATE transactions SET "${fk}" = $1 WHERE id = $2`, [entityId, transactionId]);
  } else {
    // Update existing
    const sets = entries.map(([c], i) => `"${c}" = $${i + 2}`);
    const vals = entries.map(([, v]) => v);
    await client.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1`, [entityId, ...vals]);
  }
}

// Pattern D - "participant": resolve/create through junction table
async function writeParticipant(client, transactionId, role, entityTable, entityFK, updates) {
  const entries = Object.entries(updates).filter(([c]) => isAllowed(`${entityTable}.${c}`));
  if (entries.length === 0) return;

  // Find existing participant
  const existing = await client.query(
    `SELECT tp.id as tp_id, tp."${entityFK}" as entity_id
     FROM transaction_participants tp
     WHERE tp.transaction_id = $1 AND tp.role = $2
     LIMIT 1`,
    [transactionId, role]
  );

  let entityId = existing.rows[0]?.entity_id;
  let tpId = existing.rows[0]?.tp_id;

  if (!entityId) {
    // Don't auto-create entity if required NOT NULL columns are missing
    const REQUIRED_COLS = { parties: 'full_name', brokerages: 'name' };
    const reqCol = REQUIRED_COLS[entityTable];
    const reqEntry = entries.find(([c]) => c === reqCol);
    if (reqCol && (!reqEntry || !reqEntry[1])) {
      // Skip — can't create a party/brokerage without a non-empty name
      return;
    }

    // Auto-create entity row
    const cols = entries.map(([c]) => `"${c}"`);
    const placeholders = entries.map((_, i) => `$${i + 1}`);
    const vals = entries.map(([, v]) => v);
    const result = await client.query(
      `INSERT INTO ${entityTable} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
      vals
    );
    entityId = result.rows[0].id;

    if (!tpId) {
      // Also create participant junction row
      await client.query(
        `INSERT INTO transaction_participants (transaction_id, "${entityFK}", role) VALUES ($1, $2, $3)`,
        [transactionId, entityId, role]
      );
    } else {
      // Update existing participant to point to new entity
      await client.query(
        `UPDATE transaction_participants SET "${entityFK}" = $1 WHERE id = $2`,
        [entityId, tpId]
      );
    }
  } else {
    // Update existing entity
    const sets = entries.map(([c], i) => `"${c}" = $${i + 2}`);
    const vals = entries.map(([, v]) => v);
    await client.query(`UPDATE ${entityTable} SET ${sets.join(', ')} WHERE id = $1`, [entityId, ...vals]);
  }
}

// Pattern E - "child": upsert child table by transaction_id (or through parent/FK for special tables)
async function writeChildTable(client, transactionId, table, updates) {
  const entries = Object.entries(updates).filter(([c]) => isAllowed(`${table}.${c}`));
  if (entries.length === 0) return;

  // Self-reference: non-reuse fields on transactions update directly
  if (table === SELF_TABLE) {
    return writeSelf(client, transactionId, Object.fromEntries(entries));
  }

  const nested = NESTED_CHILDREN[table];
  if (nested) {
    return writeNestedChild(client, transactionId, table, nested, entries);
  }

  // FK-linked table: write through transactions FK (e.g., properties → transactions.property_id)
  const fkTable = FK_TABLES[table];
  if (fkTable) {
    return writeDirect(client, transactionId, table, fkTable.fk, Object.fromEntries(entries));
  }

  // Check if row exists
  const existing = await client.query(
    `SELECT id FROM ${table} WHERE transaction_id = $1 LIMIT 1`,
    [transactionId]
  );

  if (existing.rows.length === 0) {
    // Insert new row
    const cols = ['transaction_id', ...entries.map(([c]) => `"${c}"`)];
    const placeholders = entries.map((_, i) => `$${i + 2}`);
    const vals = entries.map(([, v]) => v);
    await client.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES ($1, ${placeholders.join(', ')})`,
      [transactionId, ...vals]
    );
  } else {
    // Update existing row
    const sets = entries.map(([c], i) => `"${c}" = $${i + 2}`);
    const vals = entries.map(([, v]) => v);
    await client.query(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1`,
      [existing.rows[0].id, ...vals]
    );
  }
}

// Nested child write: find/create parent, then find/create child
async function writeNestedChild(client, transactionId, table, nested, entries) {
  // Find or create parent row
  let parentResult = await client.query(
    `SELECT id FROM ${nested.parent} WHERE transaction_id = $1 LIMIT 1`,
    [transactionId]
  );

  let parentId;
  if (parentResult.rows.length === 0) {
    const ins = await client.query(
      `INSERT INTO ${nested.parent} (transaction_id) VALUES ($1) RETURNING id`,
      [transactionId]
    );
    parentId = ins.rows[0].id;
  } else {
    parentId = parentResult.rows[0].id;
  }

  // Find or create child row
  const existing = await client.query(
    `SELECT id FROM ${table} WHERE "${nested.fk}" = $1 LIMIT 1`,
    [parentId]
  );

  if (existing.rows.length === 0) {
    const cols = [`"${nested.fk}"`, ...entries.map(([c]) => `"${c}"`)];
    const placeholders = entries.map((_, i) => `$${i + 2}`);
    const vals = entries.map(([, v]) => v);
    await client.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES ($1, ${placeholders.join(', ')})`,
      [parentId, ...vals]
    );
  } else {
    const sets = entries.map(([c], i) => `"${c}" = $${i + 2}`);
    const vals = entries.map(([, v]) => v);
    await client.query(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1`,
      [existing.rows[0].id, ...vals]
    );
  }
}

// Dispatcher for reuse group writes
async function writeReuseGroup(client, transactionId, config, groupName, updates) {
  switch (config.pattern) {
    case 'self':
      return writeSelf(client, transactionId, updates);
    case 'direct':
      return writeDirect(client, transactionId, config.table, config.fk, updates);
    case 'fixed':
    case 'office':
      return; // Read-only patterns
    case 'participant':
      return writeParticipant(client, transactionId, config.role, config.entityTable, config.entityFK, updates);
    case 'child':
      return writeChildTable(client, transactionId, config.table, updates);
  }
}

// ============================================================================
// REUSE GROUP DATA - Read all data for a specific reuse group
// ============================================================================

async function loadReuseGroupData(pool, transactionId, groupName) {
  const config = reuseGroups[groupName];
  if (!config) throw new Error(`Unknown reuse group: ${groupName}`);

  const row = await readReuseGroup(pool, transactionId, config, groupName, config.columns);
  return {
    group: groupName,
    label: config.label,
    pattern: config.pattern,
    readOnly: config.readOnly || false,
    data: row || {}
  };
}

// ============================================================================
// PROGRESS - Calculate completion % for all forms in a deal
// ============================================================================

async function calculateProgress(pool, transactionId) {
  const progress = {};

  for (const form of forms) {
    const totalDataFields = form.sections.reduce(
      (sum, s) => sum + s.fields.filter(f => f.db && f.type !== 'signature').length,
      0
    );

    if (totalDataFields === 0) {
      progress[form.code] = { total: 0, filled: 0, pct: 0 };
      continue;
    }

    try {
      const values = await loadFormValues(pool, transactionId, form.code);
      const filled = Object.values(values).filter(v => v !== null && v !== '' && v !== undefined).length;
      progress[form.code] = {
        total: totalDataFields,
        filled,
        pct: Math.round((filled / totalDataFields) * 100)
      };
    } catch {
      progress[form.code] = { total: totalDataFields, filled: 0, pct: 0 };
    }
  }

  return progress;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  FORM_INDEX,
  ALLOWED_COLUMNS,
  reuseGroups,
  loadFormValues,
  saveFormValues,
  loadReuseGroupData,
  calculateProgress
};
