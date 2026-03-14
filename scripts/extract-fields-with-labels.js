// Extract PDF form field names + their nearby page text (the printed labels)
// Uses pdfjs-dist to get both field positions and page text content
// Then matches nearby text to each field as its "visual label"

// Suppress ALL console output during require + processing, restore only for our output
const _w = console.warn; const _l = console.log;
console.warn = () => {}; console.log = () => {};
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
// Keep warn suppressed (pdfjs emits async font warnings), restore log later

const fs = require('fs');
const path = require('path');

const formsDir = path.join(__dirname, '..', 'Forms');

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

// Find the closest text items to a given field rectangle
function findNearbyLabels(fieldRect, textItems, maxDistance) {
  // fieldRect = [x1, y1, x2, y2] in PDF coordinates (bottom-left origin)
  const fx = fieldRect[0];                    // field left edge
  const fy = fieldRect[1];                    // field bottom edge
  const fw = fieldRect[2] - fieldRect[0];     // field width
  const fyt = fieldRect[3];                   // field top edge
  const fcx = (fieldRect[0] + fieldRect[2]) / 2;  // field center x
  const fcy = (fieldRect[1] + fieldRect[3]) / 2;  // field center y

  const candidates = [];

  for (const item of textItems) {
    const str = item.str.trim();
    if (!str || str.length < 1) continue;

    const tx = item.x;
    const ty = item.y;
    const tw = item.width;

    // Calculate distance from text to field
    // Prefer text that is: below the field, to the left, or directly above
    const dx = Math.abs(tx - fx);
    const dy_below = fy - (ty + item.height);  // positive = text is below field
    const dy_above = ty - fyt;                 // positive = text is above field
    const dy_left = Math.abs(ty - fcy);        // vertical alignment if text is to the left

    let distance;
    let bonus = 0;

    // Text directly below the field (most common label position)
    if (dy_below >= -2 && dy_below < maxDistance && dx < fw + 20) {
      distance = dy_below + dx * 0.3;
      bonus = -10; // prefer below
    }
    // Text to the left of the field, vertically aligned
    else if (tx < fx && (fx - tx - tw) < maxDistance && dy_left < 15) {
      distance = (fx - tx - tw) + dy_left * 0.5;
      bonus = -5; // prefer left
    }
    // Text directly above the field
    else if (dy_above >= -2 && dy_above < maxDistance && dx < fw + 20) {
      distance = dy_above + dx * 0.3;
      bonus = 0;
    }
    // Any nearby text
    else {
      const cdx = Math.abs(tx - fcx);
      const cdy = Math.abs(ty - fcy);
      distance = Math.sqrt(cdx * cdx + cdy * cdy);
      if (distance > maxDistance) continue;
    }

    candidates.push({ str, distance: distance + bonus, x: tx, y: ty });
  }

  // Sort by distance and return closest
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.slice(0, 3).map(c => c.str);
}

(async () => {
  const allData = {};

  for (const [code, file] of Object.entries(formToFile)) {
    const fp = path.join(formsDir, file);
    if (!fs.existsSync(fp)) { console.error(`SKIP ${code}: not found`); continue; }

    try {
      const data = new Uint8Array(fs.readFileSync(fp));
      const doc = await pdfjsLib.getDocument({ data }).promise;

      // Get all annotations (form fields) with their positions, grouped by page
      const pageData = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 1 });

        // Get text content
        const textContent = await page.getTextContent();
        const textItems = textContent.items.map(item => {
          const tx = item.transform[4];
          const ty = item.transform[5];
          return {
            str: item.str,
            x: tx,
            y: ty,
            width: item.width,
            height: item.height || 10
          };
        });

        // Get annotations (form fields)
        const annotations = await page.getAnnotations();
        const fields = annotations
          .filter(a => a.fieldType && a.fieldName)
          .map(a => ({
            name: a.fieldName,
            type: a.fieldType,
            rect: a.rect, // [x1, y1, x2, y2]
            page: p
          }));

        pageData.push({ page: p, textItems, fields });
      }

      // For each field, find its nearby text labels
      const fieldLabels = [];
      for (const pd of pageData) {
        for (const field of pd.fields) {
          const nearbyText = findNearbyLabels(field.rect, pd.textItems, 50);
          const label = nearbyText.join(' ').trim();
          fieldLabels.push({
            name: field.name,
            type: field.type === 'Tx' ? 'text' : field.type === 'Btn' ? 'checkbox' : field.type,
            page: field.page,
            visualLabel: label || '(no label found)'
          });
        }
      }

      allData[code] = { file, fields: fieldLabels };
      console.error(`${code}: ${fieldLabels.length} fields with visual labels`);

    } catch (e) {
      console.error(`ERROR ${code}: ${e.message}`);
    }
  }

  // Restore original console.log for final output
  console.log = _l;
  console.warn = _w;
  console.log(JSON.stringify(allData, null, 2));
})().catch(e => console.error('FATAL:', e.message));
