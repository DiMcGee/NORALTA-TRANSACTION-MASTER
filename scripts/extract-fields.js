// Extract all PDF form field names from Forms/ directory and auto-map to forms.json field IDs
// Output: complete template-map.json

// Suppress pdfjs canvas polyfill warnings (they go to console.warn on require)
const _origWarn = console.warn;
const _origLog = console.log;
console.warn = () => {};
console.log = () => {};
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
console.warn = _origWarn;
console.log = _origLog;
const fs = require('fs');
const path = require('path');

const forms = require(path.join(__dirname, '..', 'data', 'forms.json'));

// Map form codes to PDF filenames in Forms/
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

(async () => {
  const allFieldData = {};

  for (const [code, file] of Object.entries(formToFile)) {
    const fp = path.join(__dirname, '..', 'Forms', file);
    if (!fs.existsSync(fp)) {
      console.error(`SKIP ${code}: file not found`);
      continue;
    }

    const data = new Uint8Array(fs.readFileSync(fp));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const fieldObjects = await doc.getFieldObjects();

    if (!fieldObjects) {
      console.error(`SKIP ${code}: no form fields`);
      continue;
    }

    const pdfFields = [];
    for (const [name, arr] of Object.entries(fieldObjects)) {
      const f = arr[0];
      pdfFields.push({
        name,
        type: f.type,        // text, checkbox, radio, etc.
        value: f.value || ''
      });
    }

    allFieldData[code] = { file, pdfFields };
    console.error(`${code}: ${pdfFields.length} PDF fields`);
  }

  // Output the complete field data as JSON
  console.log(JSON.stringify(allFieldData, null, 2));
})().catch(e => console.error('FATAL:', e.message));
