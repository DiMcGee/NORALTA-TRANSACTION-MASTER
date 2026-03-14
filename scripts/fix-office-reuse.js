#!/usr/bin/env node
/**
 * One-time migration: Rewrite office form db mappings from office_forms.*
 * to canonical tables with reuse tags, matching the batch6 source-of-truth mapping.
 */
const fs = require('fs');
const path = require('path');

const formsPath = path.join(__dirname, '..', 'data', 'forms.json');
const forms = JSON.parse(fs.readFileSync(formsPath, 'utf8'));

// ============================================================================
// REUSE MAPPING: field ID → { db, reuse } (from batch6-field-mapping source of truth)
// Fields not listed here keep their current office_forms.* mapping
// ============================================================================

const REUSE_MAP = {
  // ── OFF-TIS (Transaction Info Sheet) — 57 reuse fields ──
  'TIS-01': { db: 'transactions.conditional', reuse: 'transaction' },
  'TIS-02': { db: 'transactions.firm', reuse: 'transaction' },
  'TIS-03': { db: 'properties.address', reuse: 'property' },
  'TIS-04': { db: 'properties.city', reuse: 'property' },
  'TIS-05': { db: 'properties.postal_code', reuse: 'property' },
  'TIS-06': { db: 'properties.plan', reuse: 'property' },
  'TIS-07': { db: 'properties.block_unit', reuse: 'property' },
  'TIS-08': { db: 'properties.lot', reuse: 'property' },
  'TIS-09': { db: 'listing.mls_number', reuse: 'listing' },
  'TIS-10': { db: 'transactions.sale_price', reuse: 'transaction' },
  'TIS-11': { db: 'listing.list_price', reuse: 'listing' },
  'TIS-12': { db: 'transactions.initial_deposit', reuse: 'transaction' },
  'TIS-13': { db: 'transactions.additional_deposit', reuse: 'transaction' },
  'TIS-14': { db: 'transactions.deposit_held_by', reuse: 'transaction' },
  'TIS-15': { db: 'transactions.possession_date', reuse: 'transaction' },
  'TIS-16': { db: 'transactions.binding_date', reuse: 'transaction' },
  'TIS-17': { db: 'transactions.condition_removal_date', reuse: 'transaction' },
  'TIS-18': { db: 'transactions.sign_removal_date' },  // no reuse — self-table
  'TIS-19': { db: 'brokerages.name', reuse: 'seller_brokerage' },
  'TIS-20': { db: 'agents.full_name', reuse: 'seller_agent' },
  'TIS-21': { db: 'brokerages.phone', reuse: 'seller_brokerage' },
  'TIS-22': { db: 'brokerages.address', reuse: 'seller_brokerage' },
  'TIS-23': { db: 'brokerages.city', reuse: 'seller_brokerage' },
  'TIS-24': { db: 'brokerages.postal_code', reuse: 'seller_brokerage' },
  'TIS-25': { db: 'brokerages.name', reuse: 'buyer_brokerage' },
  'TIS-26': { db: 'agents.full_name', reuse: 'buyer_agent' },
  'TIS-27': { db: 'brokerages.phone', reuse: 'buyer_brokerage' },
  'TIS-28': { db: 'brokerages.address', reuse: 'buyer_brokerage' },
  'TIS-29': { db: 'brokerages.city', reuse: 'buyer_brokerage' },
  'TIS-30': { db: 'brokerages.postal_code', reuse: 'buyer_brokerage' },
  'TIS-31': { db: 'parties.full_name', reuse: 'seller' },
  'TIS-32': { db: 'parties.full_name', reuse: 'seller_2' },
  'TIS-33': { db: 'parties.address', reuse: 'seller' },
  'TIS-34': { db: 'parties.city', reuse: 'seller' },
  'TIS-35': { db: 'parties.postal_code', reuse: 'seller' },
  'TIS-36': { db: 'parties.phone', reuse: 'seller' },
  'TIS-37': { db: 'parties.email', reuse: 'seller' },
  'TIS-38': { db: 'parties.full_name', reuse: 'buyer' },
  'TIS-39': { db: 'parties.full_name', reuse: 'buyer_2' },
  'TIS-40': { db: 'parties.address', reuse: 'buyer' },
  'TIS-41': { db: 'parties.city', reuse: 'buyer' },
  'TIS-42': { db: 'parties.postal_code', reuse: 'buyer' },
  'TIS-43': { db: 'parties.phone', reuse: 'buyer' },
  'TIS-44': { db: 'parties.email', reuse: 'buyer' },
  'TIS-45': { db: 'lawyers.full_name', reuse: 'seller_lawyer' },
  'TIS-46': { db: 'lawyers.firm', reuse: 'seller_lawyer' },
  'TIS-47': { db: 'lawyers.address', reuse: 'seller_lawyer' },
  'TIS-48': { db: 'lawyers.city', reuse: 'seller_lawyer' },
  'TIS-49': { db: 'lawyers.postal_code', reuse: 'seller_lawyer' },
  'TIS-50': { db: 'lawyers.phone', reuse: 'seller_lawyer' },
  'TIS-51': { db: 'lawyers.email', reuse: 'seller_lawyer' },
  'TIS-52': { db: 'lawyers.full_name', reuse: 'buyer_lawyer' },
  'TIS-53': { db: 'lawyers.firm', reuse: 'buyer_lawyer' },
  'TIS-54': { db: 'lawyers.address', reuse: 'buyer_lawyer' },
  'TIS-55': { db: 'lawyers.city', reuse: 'buyer_lawyer' },
  'TIS-56': { db: 'lawyers.postal_code', reuse: 'buyer_lawyer' },
  'TIS-57': { db: 'lawyers.phone', reuse: 'buyer_lawyer' },
  'TIS-58': { db: 'lawyers.email', reuse: 'buyer_lawyer' },
  // TIS-59 to TIS-78: referral/commission/other — stay on office_forms.*
  // BUT map TIS-72 (new_home) to transactions
  'TIS-72': { db: 'transactions.new_home', reuse: 'transaction' },

  // ── OFF-LST (Listing Checklist) — 12 reuse fields ──
  'LST-01': { db: 'parties.full_name', reuse: 'seller' },
  'LST-02': { db: 'listing.list_price', reuse: 'listing' },
  'LST-03': { db: 'properties.address', reuse: 'property' },
  'LST-05': { db: 'parties.address', reuse: 'seller' },
  'LST-06': { db: 'properties.city', reuse: 'property' },
  'LST-07': { db: 'parties.phone', reuse: 'seller' },
  'LST-08': { db: 'parties.email', reuse: 'seller' },
  'LST-09': { db: 'properties.postal_code', reuse: 'property' },
  'LST-10': { db: 'agents.full_name', reuse: 'agent' },
  'LST-12': { db: 'listing.list_date', reuse: 'listing' },
  'LST-13': { db: 'listing.expiry_date', reuse: 'listing' },
  'LST-14': { db: 'listing.mls_number', reuse: 'listing' },

  // ── OFF-TTS (Title Search Form) — 12 reuse fields ──
  'TTS-01': { db: 'agents.full_name', reuse: 'agent' },
  'TTS-03': { db: 'properties.address', reuse: 'property' },
  'TTS-04': { db: 'properties.plan', reuse: 'property' },
  'TTS-05': { db: 'properties.block_unit', reuse: 'property' },
  'TTS-06': { db: 'properties.lot', reuse: 'property' },
  'TTS-07': { db: 'properties.linc_number', reuse: 'property' },
  'TTS-08': { db: 'properties.meridian', reuse: 'property_rural' },
  'TTS-09': { db: 'properties.range', reuse: 'property_rural' },
  'TTS-10': { db: 'properties.township', reuse: 'property_rural' },
  'TTS-11': { db: 'properties.section', reuse: 'property_rural' },
  'TTS-12': { db: 'properties.quarter', reuse: 'property_rural' },
  'TTS-13': { db: 'properties.condo_plan', reuse: 'property' },

  // ── OFF-CAN (MLS Sale Cancellation) — 6 reuse fields ──
  'CAN-01': { db: 'listing.mls_number', reuse: 'listing' },
  'CAN-02': { db: 'transactions.sale_price', reuse: 'transaction' },
  'CAN-03': { db: 'parties.full_name', reuse: 'seller' },
  'CAN-04': { db: 'properties.address', reuse: 'property' },
  'CAN-15': { db: 'brokerages.name', reuse: 'seller_brokerage' },
  'CAN-16': { db: 'brokerages.branch_number', reuse: 'seller_brokerage' },

  // ── OFF-BRF (Builder/Realtor Registration) — 9 reuse fields ──
  'BRF-01': { db: 'parties.full_name', reuse: 'buyer' },
  'BRF-03': { db: 'parties.full_name', reuse: 'buyer' },
  'BRF-04': { db: 'parties.address', reuse: 'buyer' },
  'BRF-05': { db: 'parties.phone', reuse: 'buyer' },
  'BRF-06': { db: 'parties.phone_2', reuse: 'buyer' },
  'BRF-07': { db: 'agents.full_name', reuse: 'buyer_agent' },
  'BRF-10': { db: 'brokerages.address', reuse: 'buyer_brokerage' },
  'BRF-11': { db: 'brokerages.phone', reuse: 'buyer_brokerage' },
  'BRF-12': { db: 'agents.phone', reuse: 'buyer_agent' },

  // ── OFF-REF (Non-Industry Client Referral) — 5 reuse fields ──
  'REF-04': { db: 'properties.address', reuse: 'property' },
  'REF-12': { db: 'brokerages.address', reuse: 'brokerage' },
  'REF-13': { db: 'brokerages.city', reuse: 'brokerage' },
  'REF-14': { db: 'agents.full_name', reuse: 'agent' },
  'REF-15': { db: 'agents.email', reuse: 'agent' },

  // ── OFF-PTD (Personal Trade Disclosure) — 2 reuse fields ──
  'PTD-01': { db: 'agents.full_name', reuse: 'agent' },
  'PTD-02': { db: 'properties.address', reuse: 'property' },

  // ── OFF-LAS (List Activity Sheet) — 3 reuse fields ──
  'LAS-01': { db: 'parties.full_name', reuse: 'seller' },
  'LAS-02': { db: 'properties.address', reuse: 'property' },
  'LAS-03': { db: 'listing.mls_number', reuse: 'listing' },

  // ── OFF-EFT (EFT Wire Transfer Instructions) — 4 reuse fields ──
  // Note: EFT has more fields in app (16) vs mapping (5). The mapping's reuse fields are:
  // EFT-01=buyer name, EFT-02=property address, EFT-03=initial deposit, EFT-05=buyer agent name
  // But in our app, EFT-01=Bank Name, EFT-02=Bank Branch etc. The IDs don't match.
  // The mapping has different field ordering. Let me map by SEMANTIC meaning:
  // Mapping EFT-01 (Buyer Name) → app doesn't have this field. Need to add it or skip.
  // Actually the app's EFT form was built differently from the mapping. The mapping has 5 fields,
  // the app has 16. Let me map the overlapping fields by semantics:
  // The app's EFT form is a full wire transfer form. The mapping's INT-EFT is a simpler form.
  // I'll add the 4 reuse fields as new fields in the header section.
  // Skip for now — handled below as a special case.

  // ── OFF-NAR (New Agent Request) — 0 reuse fields — no changes ──
};

// ============================================================================
// Special handling: OFF-EFT needs reuse header fields ADDED
// The app has 16 bank/wire fields; the mapping expects 4 reuse header fields
// that don't exist yet. We'll add them to the first section.
// ============================================================================
const EFT_REUSE_FIELDS = [
  { id: 'EFT-H1', label: 'Buyer Name', type: 'text', db: 'parties.full_name', reuse: 'buyer' },
  { id: 'EFT-H2', label: 'Property Address', type: 'text', db: 'properties.address', reuse: 'property' },
  { id: 'EFT-H3', label: 'Initial Deposit Amount', type: 'currency', db: 'transactions.initial_deposit', reuse: 'transaction' },
  { id: 'EFT-H4', label: 'Buyer Agent Name', type: 'text', db: 'agents.full_name', reuse: 'buyer_agent' }
];

// ============================================================================
// APPLY TRANSFORMATIONS
// ============================================================================

let changed = 0;
let reuseAdded = 0;

for (const form of forms) {
  if (!form.code || !form.code.startsWith('OFF-')) continue;

  // Special: Add reuse header to OFF-EFT
  if (form.code === 'OFF-EFT') {
    // Add a new "Deal Info" section at the beginning with reuse fields
    form.sections.unshift({
      name: 'Deal Info (Auto-populated)',
      fields: EFT_REUSE_FIELDS
    });
    reuseAdded += 4;
    console.log(`  OFF-EFT: Added 4 reuse header fields`);
  }

  // Apply reuse mapping to existing fields
  for (const section of form.sections) {
    for (const field of section.fields) {
      const mapping = REUSE_MAP[field.id];
      if (mapping) {
        const oldDb = field.db;
        field.db = mapping.db;
        if (mapping.reuse) {
          field.reuse = mapping.reuse;
          reuseAdded++;
        }
        changed++;
        console.log(`  ${field.id}: ${oldDb} → ${mapping.db}${mapping.reuse ? ` (reuse: ${mapping.reuse})` : ''}`);
      }
    }
  }
}

// ============================================================================
// WRITE OUTPUT
// ============================================================================

fs.writeFileSync(formsPath, JSON.stringify(forms, null, 2) + '\n');
console.log(`\nDone: ${changed} fields remapped, ${reuseAdded} reuse tags added`);
