// Build template-map.json by auto-mapping forms.json field IDs to PDF field names
// Strategy: Match using BOTH PDF field names AND visual labels (printed text near each field)

const fs = require('fs');
const path = require('path');

const forms = require(path.join(__dirname, '..', 'data', 'forms.json'));
const pdfData = require(path.join(__dirname, 'pdf-fields.json'));

// Visual labels extracted from PDF page text (field positions + nearby printed text)
let visualData = {};
const visualPath = path.join(__dirname, 'pdf-fields-with-labels.json');
if (fs.existsSync(visualPath)) {
  visualData = require(visualPath);
}

// Map form codes to Forms/ directory filenames
const formToFile = {
  'RES-PC': 'Residential Purchase Contract.pdf',
  'RES-BRA': 'Exclusive Buyer Representation Agreement (Common Law).pdf',
  'RES-SRA': 'Exclusive Seller Representation Agreement (common law).pdf',
  'CR-PC': 'Country Residential Purchase Contract.pdf',
  'RES-PC-AMD': 'Amendment - Purchase Contract.pdf',
  'RES-SRA-A': 'Exclusive Seller Representation Agreement Amendment.pdf',
  'RES-DUAL': 'Agreement to Represent Both Seller and Buyer (common law).pdf',
  'RES-DUAL-A': 'Agreement to Represent Both Seller and Buyer Addendum.pdf',
  'RES-PC-ADD': 'Addendum - Purchase Contract.pdf',
  'RES-RA-ADD': 'Addendum (For Adding Contract Terms).pdf',
  'RES-REM': 'Agreement for Remuneration (common law and designated agency).pdf',
  'RES-CRG': 'Consumer Relationships Guide (Print Friendly).pdf',
  'COM-PC': 'Commercial Purchase Contract.pdf',
  'COM-BRA': 'Commercial Exclusive Buyer Representation Agreement (common law).pdf',
  'COM-BRA-T': 'Commercial Exclusive Buyer Representation Agreement Termination (common law).pdf',
  'COM-BDA': 'Commercial Buyer Customer Disclosure Acknowledgement.pdf',
  'COM-LRA-A': 'Commercial Exclusive Landlord Representation Agreement Amendment (common law and designated agency).pdf',
  'COM-LRA-AP': 'Commercial Exclusive Landlord Brokerage Agreement Appendix (common law and designated agency).pdf',
  'COM-DUAL': 'Agreement to Represent Both Landlord and Tenant (common law).pdf',
  'COM-BRA-A': 'Commercial Exclusive Buyer Representation Agreement Amendment (common law and designated agency).pdf',
  'COM-LRA': 'Commercial Exclusive Landlord Representation Agreement (common law).pdf',
  'COM-OTL': 'Commercial Offer to Lease.pdf',
  'NOT-NW': 'Notice (For Non-Waiver_Non-Satisfaction of Conditions).pdf',
  'NOT-W': 'Notice (For Waiver_Satisfaction of Conditions).pdf',
  'NOT-CSD': 'Conditional Sale Disclosure Instruction.pdf',
  'OFF-LAS': '05 List Activity Sheet.pdf',
  'OFF-CAN': 'Cancellation of Reported Sale.pdf',
  'OFF-LST': 'Listing Checklist 2025.pdf',
  'OFF-TIS': 'Transaction Info Sheet 2026.pdf',
  'FIN-BOR': 'FINTRAC - Beneficial Ownership Record.pdf',
  'FIN-BRA': 'FINTRAC - Brokerage Risk Assessment.pdf',
  'FIN-COR': 'FINTRAC - Corporation Entity Identification Information Record.pdf',
  'FIN-MAA': 'FINTRAC - Identification Mandatary Agent Agreement.pdf',
  'FIN-IND': 'FINTRAC - Individual Identification Information Record.pdf',
  'FIN-PEP': 'FINTRAC - Politically Exposed Person_Head of International Organization Checklist_Record.pdf',
  'FIN-ROF': 'FINTRAC - Receipt Of Funds Record.pdf'
};

// Extract meaningful keywords from a string (handles camelCase, underscores, abbreviations)
function extractKeywords(str) {
  let s = str
    // Strip common PDF field name prefixes (even without camelCase boundary)
    .replace(/^(txtp_?|txt_?|hid[xX]?_?|chk_?|cb_?)/i, '')
    // Split camelCase: "SellerCond" -> "Seller Cond"
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\/().,#:;'"]+/g, ' ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    // Remove underscores/blanks that are just line fills
    .replace(/_+/g, ' ')
    .toLowerCase()
    .trim();

  const words = s.split(/\s+/).filter(w => w.length > 0);

  const expansions = {
    'txt': '', 'txtp': '', 'hid': '', 'chk': '', 'cb': '', 'fill': '',
    'num': 'number', 'addr': 'address', 'amt': 'amount',
    'dt': 'date', 'ph': 'phone', 'em': 'email', 'pc': 'postal code',
    'ven': 'vendor seller', 'pur': 'purchaser buyer',
    'bro': 'brokerage', 'comm': 'commission',
    'dep': 'deposit', 'fin': 'financing', 'insp': 'inspection',
    'prop': 'property', 'cond': 'condition', 'rem': 'remuneration',
    'agmt': 'agreement', 'rep': 'representation',
    'mls': 'mls', 'rpr': 'rpr', 'crg': 'consumer relationships guide',
    'lisng': 'listing', 'ref': 'referral',
    'ampm': 'am pm', 'yy': 'year', 'dd': 'day', 'mmmm': 'month',
    'streetnum': 'street number', 'zipcode': 'postal code',
    'closedate': 'completion date close date',
    'pagenum': 'page', 'pagenumber': 'page',
    'unitnumber': 'unit number', 'lotnumber': 'lot',
    'possdate': 'possession date', 'poss': 'possession',
    'totalfinance': 'total financing', 'fintime': 'financing time',
    'inspecttime': 'inspection time', 'inspectiondate': 'inspection date',
    'financingdate': 'financing date',
    'seller': 'seller vendor', 'buyer': 'buyer purchaser',
    'landlord': 'landlord owner', 'tenant': 'tenant lessee',
    'brokerage': 'brokerage office', 'law': 'lawyer legal',
    'sig': 'signature', 'sigdate': 'signature date',
  };

  const expanded = [];
  for (const w of words) {
    if (expansions[w] !== undefined) {
      if (expansions[w]) expanded.push(...expansions[w].split(' '));
    } else {
      expanded.push(w);
    }
  }

  const noise = new Set(['the', 'of', 'a', 'an', 'to', 'for', 'in', 'on', 'at', 'and', 'or', 'is', 'es', 'af', 'be', 'by', 'this', 'that', 'will', 'may', 'shall', 'contract', 'form', 'part', 'which']);
  return new Set(expanded.filter(w => w.length > 1 && !noise.has(w)));
}

// Compute Jaccard-like similarity between two keyword sets
function keywordSimilarity(wordsA, wordsB) {
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  // Also check substring matches for partial words
  if (intersection === 0) {
    for (const wa of wordsA) {
      for (const wb of wordsB) {
        if (wa.length >= 3 && wb.length >= 3) {
          if (wa.includes(wb) || wb.includes(wa)) intersection += 0.5;
        }
      }
    }
  }
  return intersection / (wordsA.size + wordsB.size - intersection);
}

// Score how well a PDF field matches one of our form fields
// Uses both the PDF field name AND visual label
function matchScore(ourLabel, pdfFieldName, visualLabel) {
  const ourWords = extractKeywords(ourLabel);

  // Score from PDF field name
  const nameWords = extractKeywords(pdfFieldName);
  const nameScore = keywordSimilarity(ourWords, nameWords);

  // Score from visual label (nearby printed text on the page)
  let labelScore = 0;
  if (visualLabel && visualLabel !== '(no label found)') {
    const labelWords = extractKeywords(visualLabel);
    labelScore = keywordSimilarity(ourWords, labelWords);
  }

  // Take the best of both, with a small bonus if both match
  const best = Math.max(nameScore, labelScore);
  const bonus = (nameScore > 0.15 && labelScore > 0.15) ? 0.1 : 0;
  return Math.min(best + bonus, 1.0);
}

// Build visual label lookup: { fieldName -> visualLabel }
function buildVisualLookup(code) {
  const vd = visualData[code];
  if (!vd) return {};
  const lookup = {};
  for (const f of vd.fields) {
    // Use first occurrence (don't overwrite if duplicate field names on different pages)
    if (!lookup[f.name]) lookup[f.name] = f.visualLabel;
  }
  return lookup;
}

// For each form, try to match our fields to PDF fields
const templateMap = {
  _comment: "Maps form codes to fillable PDF templates. File paths relative to templates/ dir. Auto-generated by build-template-map.js",
  templates: {}
};

let totalMapped = 0;
let totalUnmapped = 0;

for (const [code, pdf] of Object.entries(pdfData)) {
  const formDef = forms.find(f => f.code === code);
  if (!formDef) continue;

  const pdfFields = pdf.pdfFields;
  const file = formToFile[code];
  if (!file) continue;

  const visualLookup = buildVisualLookup(code);

  const fields = {};
  const usedPdfFields = new Set();

  const ourFields = [];
  for (const section of formDef.sections) {
    for (const field of section.fields) {
      ourFields.push(field);
    }
  }

  // Two-pass matching: high-confidence first, then lower-confidence
  // This prevents wrong matches from stealing the correct PDF fields
  const thresholds = [0.50, 0.30];

  for (const threshold of thresholds) {
    for (const ourField of ourFields) {
      if (ourField.type === 'signature') continue;
      if (fields[ourField.id]) continue; // already matched in previous pass

      let bestMatch = null;
      let bestScore = 0;

      for (const pdfField of pdfFields) {
        if (usedPdfFields.has(pdfField.name)) continue;

        // Check type compatibility
        const isCheckboxOur = ['checkbox', 'boolean'].includes(ourField.type);
        const isCheckboxPdf = pdfField.type === 'checkbox' || pdfField.type === 'radiobutton';
        if (isCheckboxOur !== isCheckboxPdf) continue;

        const visualLabel = visualLookup[pdfField.name] || '';
        const score = matchScore(ourField.label, pdfField.name, visualLabel);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = pdfField;
        }
      }

      if (bestMatch && bestScore >= threshold) {
        fields[ourField.id] = bestMatch.name;
        usedPdfFields.add(bestMatch.name);
      }
    }
  }

  // Only include in template-map if >= 40% of non-signature fields are mapped
  const nonSigFields = ourFields.filter(f => f.type !== 'signature').length;
  const coverage = nonSigFields > 0 ? Object.keys(fields).length / nonSigFields : 0;
  if (Object.keys(fields).length > 0 && coverage >= 0.40) {
    templateMap.templates[code] = {
      file: '../Forms/' + file,
      fields
    };
  } else if (Object.keys(fields).length > 0) {
    console.error(`  -> SKIPPED ${code} (coverage ${Math.round(coverage*100)}% < 40% threshold, overlay mode is better)`);
  }

  const mapped = Object.keys(fields).length;
  const unmapped = ourFields.filter(f => !fields[f.id] && f.type !== 'signature').length;
  totalMapped += mapped;
  totalUnmapped += unmapped;
  console.error(`${code}: ${mapped} mapped, ${unmapped} unmapped (${ourFields.length} total our fields, ${pdfFields.length} PDF fields)`);
}

console.error(`\nTOTAL: ${totalMapped} mapped, ${totalUnmapped} unmapped`);
console.log(JSON.stringify(templateMap, null, 2));
