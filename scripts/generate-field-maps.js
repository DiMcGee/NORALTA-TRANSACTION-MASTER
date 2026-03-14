// Generate "field map" PDFs — fills every fillable field with its own field name
// Open the output PDF in Adobe to see exactly which field name corresponds to which box
//
// Usage: node scripts/generate-field-maps.js
// Output: scripts/field-maps/<FormCode>_field-map.pdf

const muhammara = require('muhammara');
const fs = require('fs');
const path = require('path');

const formsDir = path.join(__dirname, '..', 'Forms');
const outputDir = path.join(__dirname, 'field-maps');
fs.mkdirSync(outputDir, { recursive: true });

// All 36 forms we use
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

let totalForms = 0;
let totalFields = 0;

for (const [code, file] of Object.entries(formToFile)) {
  const inputPath = path.join(formsDir, file);
  if (!fs.existsSync(inputPath)) {
    console.log(`SKIP ${code}: file not found`);
    continue;
  }

  const outputPath = path.join(outputDir, `${code}_field-map.pdf`);
  fs.copyFileSync(inputPath, outputPath);

  try {
    const writer = muhammara.createWriterToModify(outputPath);
    const reader = writer.getModifiedFileParser();

    const catalog = reader.queryDictionaryObject(reader.getTrailer(), 'Root');
    const acroForm = reader.queryDictionaryObject(catalog, 'AcroForm');
    if (!acroForm) { writer.end(); continue; }

    const fieldsRef = reader.queryDictionaryObject(acroForm, 'Fields');
    if (!fieldsRef) { writer.end(); continue; }

    const fieldsArr = fieldsRef.toJSArray();
    const copyCtx = writer.createPDFCopyingContext(inputPath);
    const objCtx = writer.getObjectsContext();

    let fieldCount = 0;
    for (const fieldRef of fieldsArr) {
      const objId = fieldRef.getObjectID();
      const fieldObj = reader.parseNewObject(objId);

      const tObj = reader.queryDictionaryObject(fieldObj, 'T');
      if (!tObj) continue;
      const fieldName = tObj.toString();

      const ftObj = reader.queryDictionaryObject(fieldObj, 'FT');
      const fieldType = ftObj ? ftObj.toString() : 'Tx';

      // For checkboxes, write the field name as a text label instead
      // For text fields, write the field name as the value
      let label;
      if (fieldType === 'Btn') {
        label = `[CB] ${fieldName}`;
      } else {
        label = fieldName;
      }

      // Rewrite the field with its name as the value
      objCtx.startModifiedIndirectObject(objId);
      const pdfDict = fieldObj.toPDFDictionary();
      const allKeys = Object.keys(pdfDict.toJSObject());

      const dict = objCtx.startDictionary();
      for (const key of allKeys) {
        if (key === 'V' || key === 'AP') continue;
        dict.writeKey(key);
        copyCtx.copyDirectObjectAsIs(pdfDict.queryObject(key));
      }

      dict.writeKey('V');
      if (fieldType === 'Btn') {
        // For checkboxes, check them so they're visible
        objCtx.writeName('Yes');
      } else {
        objCtx.writeLiteralString(label);
      }

      objCtx.endDictionary(dict);
      objCtx.endIndirectObject();
      fieldCount++;
    }

    writer.end();
    totalForms++;
    totalFields += fieldCount;
    console.log(`${code}: ${fieldCount} fields labeled -> ${code}_field-map.pdf`);
  } catch (e) {
    console.log(`ERROR ${code}: ${e.message}`);
  }
}

console.log(`\nDone! ${totalForms} field-map PDFs generated with ${totalFields} labeled fields`);
console.log(`Output: ${outputDir}`);
