// ============================================================================
// PDF GENERATOR - Two modes:
//   1. Template fill: Fill actual AREA PDF form fields (when template exists)
//   2. Data sheet: Generate clean summary PDF (always available)
// ============================================================================

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const forms = require(path.join(__dirname, '..', 'data', 'forms.json'));
const templateMap = require(path.join(__dirname, '..', 'data', 'template-map.json'));
const overlayMaps = require(path.join(__dirname, '..', 'data', 'overlay-maps.json'));

const FORM_INDEX = new Map();
for (const form of forms) FORM_INDEX.set(form.code, form);

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// ============================================================================
// MODE 1: TEMPLATE FILL - Fill actual AREA PDF form fields via muhammara
// Handles encrypted PDFs with compressed object streams that pdf-lib cannot parse
// ============================================================================

const muhammara = require('muhammara');
const os = require('os');
const crypto = require('crypto');

async function fillTemplate(formCode, values, signatures = {}) {
  const mapping = templateMap.templates[formCode];
  if (!mapping) return null;

  const templatePath = path.join(TEMPLATES_DIR, mapping.file);
  if (!fs.existsSync(templatePath)) return null;

  // Build a reverse map: pdfFieldName -> our fieldId
  const reverseMap = {};
  for (const [fieldId, pdfFieldName] of Object.entries(mapping.fields)) {
    reverseMap[pdfFieldName] = fieldId;
  }

  // Work on a temp copy (muhammara modifies in-place)
  const tmpPath = path.join(os.tmpdir(), `noralta-fill-${crypto.randomBytes(6).toString('hex')}.pdf`);
  fs.copyFileSync(templatePath, tmpPath);

  try {
    const writer = muhammara.createWriterToModify(tmpPath);
    const reader = writer.getModifiedFileParser();

    // Navigate to AcroForm fields
    const catalog = reader.queryDictionaryObject(reader.getTrailer(), 'Root');
    const acroForm = reader.queryDictionaryObject(catalog, 'AcroForm');
    if (!acroForm) { writer.end(); return null; }

    const fieldsRef = reader.queryDictionaryObject(acroForm, 'Fields');
    if (!fieldsRef) { writer.end(); return null; }

    const fieldsArr = fieldsRef.toJSArray();
    const copyCtx = writer.createPDFCopyingContext(templatePath);
    const objCtx = writer.getObjectsContext();

    let filled = 0;
    for (const fieldRef of fieldsArr) {
      const objId = fieldRef.getObjectID();
      const fieldObj = reader.parseNewObject(objId);

      // Get field name
      const tObj = reader.queryDictionaryObject(fieldObj, 'T');
      if (!tObj) continue;
      const pdfFieldName = tObj.toString();

      // Check if we have a mapping for this field
      const fieldId = reverseMap[pdfFieldName];
      if (!fieldId) continue;

      const value = values[fieldId];
      if (value === null || value === undefined) continue;

      // Get field type
      const ftObj = reader.queryDictionaryObject(fieldObj, 'FT');
      const fieldType = ftObj ? ftObj.toString() : 'Tx';

      // Determine the string value to write
      let strValue;
      if (fieldType === 'Btn') {
        // Checkbox: only fill if truthy
        if (value !== true && value !== 'true' && value !== '1') continue;
        strValue = 'Yes';
      } else {
        strValue = String(value);
      }

      // Rewrite the field object with the new /V value
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
        objCtx.writeName(strValue);
      } else {
        objCtx.writeLiteralString(strValue);
      }

      objCtx.endDictionary(dict);
      objCtx.endIndirectObject();
      filled++;
    }

    writer.end();

    const pdfBytes = fs.readFileSync(tmpPath);
    const total = Object.keys(mapping.fields).length;
    const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
    return { bytes: Buffer.from(pdfBytes), filled, total, pct, mode: 'template' };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ============================================================================
// MODE 2: TEXT OVERLAY - Draw text on flat AREA PDF at mapped coordinates
// ============================================================================

async function overlayTemplate(formCode, values, signatures = {}) {
  const map = overlayMaps[formCode];
  if (!map || !map.file || !map.fields || Object.keys(map.fields).length === 0) return null;

  const templatePath = path.join(TEMPLATES_DIR, map.file);
  if (!fs.existsSync(templatePath)) return null;

  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  const fontSize = map.fontSize || 9;
  const textColor = rgb(0.05, 0.05, 0.45); // Dark blue so it's clearly filled-in data

  let filled = 0;
  let total = 0;

  for (const [fieldId, coords] of Object.entries(map.fields)) {
    total++;

    // Resolve value: direct match, or sub-field (radio option / line overflow)
    let value = values[fieldId];
    let isSubField = false;

    if (value === null || value === undefined || value === '') {
      // Try sub-field patterns: FIELD_Suffix (radio option) or FIELD_line2 (overflow)
      const underIdx = fieldId.lastIndexOf('_');
      if (underIdx > 0) {
        const baseId = fieldId.substring(0, underIdx);
        const suffix = fieldId.substring(underIdx + 1);
        const baseValue = values[baseId];

        if (baseValue !== null && baseValue !== undefined && baseValue !== '') {
          if (suffix.match(/^line\d+$/)) {
            // Multi-line overflow: split base value into lines, use the Nth line
            const lineNum = parseInt(suffix.replace('line', ''), 10);
            const maxCharsPerLine = coords.maxW ? Math.floor(coords.maxW / (fontSize * 0.52)) : 60;
            const words = String(baseValue).split(/\s+/);
            const lines = [];
            let currentLine = '';
            for (const word of words) {
              if ((currentLine + ' ' + word).trim().length > maxCharsPerLine) {
                lines.push(currentLine.trim());
                currentLine = word;
              } else {
                currentLine = currentLine ? currentLine + ' ' + word : word;
              }
            }
            if (currentLine.trim()) lines.push(currentLine.trim());
            value = lines[lineNum - 1] || null; // line2 = index 1
            isSubField = true;
          } else if (coords.check) {
            // Radio option: check if base value matches the suffix
            value = (String(baseValue) === suffix) ? true : null;
            isSubField = true;
          }
        }
      }
    }

    // Support field copies (same value on multiple pages, e.g., contract number on every page)
    if ((value === null || value === undefined || value === '') && coords.copyOf) {
      value = values[coords.copyOf];
    }

    if (value === null || value === undefined || value === '') continue;

    const pageIdx = coords.p || 0;
    if (pageIdx >= pages.length) continue;
    const page = pages[pageIdx];

    filled++;

    // Checkbox fields
    if (coords.check) {
      if (value === 'true' || value === true) {
        page.drawText('X', {
          x: coords.x,
          y: coords.y,
          size: fontSize + 1,
          font: fontBold,
          color: textColor
        });
      }
      continue;
    }

    let displayValue;

    // Format dates - handle JS Date objects, ISO strings, and raw date strings
    if (value instanceof Date) {
      // PostgreSQL returns Date objects for date/timestamp columns — use UTC to avoid timezone shift
      const yr = value.getUTCFullYear();
      const mo = String(value.getUTCMonth() + 1).padStart(2, '0');
      const dy = String(value.getUTCDate()).padStart(2, '0');
      displayValue = `${yr}-${mo}-${dy}`;
    } else {
      displayValue = String(value);
      // Strip time from ISO strings: "2026-03-01T00:00:00.000Z" → "2026-03-01"
      if (/^\d{4}-\d{2}-\d{2}T/.test(displayValue)) {
        displayValue = displayValue.split('T')[0];
      }
      // Catch ugly Date.toString() like "Sun Mar 01 2026 00:00:00 GMT..."
      else if (/^\w{3} \w{3} \d{2} \d{4}/.test(displayValue)) {
        const d = new Date(displayValue);
        if (!isNaN(d.getTime())) {
          const yr = d.getUTCFullYear();
          const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dy = String(d.getUTCDate()).padStart(2, '0');
          displayValue = `${yr}-${mo}-${dy}`;
        }
      }
    }

    // Multiline fields
    if (coords.lines && coords.lines > 1 && coords.maxW) {
      const maxCharsPerLine = Math.floor(coords.maxW / (fontSize * 0.52));
      const words = displayValue.split(/\s+/);
      const lines = [];
      let currentLine = '';

      for (const word of words) {
        if ((currentLine + ' ' + word).trim().length > maxCharsPerLine) {
          lines.push(currentLine.trim());
          currentLine = word;
        } else {
          currentLine = currentLine ? currentLine + ' ' + word : word;
        }
      }
      if (currentLine.trim()) lines.push(currentLine.trim());

      for (let i = 0; i < Math.min(lines.length, coords.lines); i++) {
        page.drawText(lines[i], {
          x: coords.x,
          y: coords.y - (i * (fontSize + 2)),
          size: fontSize,
          font,
          color: textColor
        });
      }
      continue;
    }

    // Single-line: truncate if needed
    if (coords.maxW) {
      const maxChars = Math.floor(coords.maxW / (fontSize * 0.52));
      if (displayValue.length > maxChars) {
        displayValue = displayValue.substring(0, maxChars - 2) + '..';
      }
    }

    page.drawText(displayValue, {
      x: coords.x,
      y: coords.y,
      size: fontSize,
      font,
      color: textColor
    });
  }

  // Embed signature images
  if (signatures && Object.keys(signatures).length > 0) {
    for (const [fieldId, sigData] of Object.entries(signatures)) {
      if (!sigData) continue;
      const sigCoords = map.fields[fieldId];
      if (!sigCoords || !sigCoords.sig) continue;

      const pageIdx = sigCoords.p || 0;
      if (pageIdx >= pages.length) continue;

      try {
        // sigData is base64 PNG (with or without data:image/png;base64, prefix)
        const base64 = sigData.replace(/^data:image\/png;base64,/, '');
        const sigImage = await pdfDoc.embedPng(Buffer.from(base64, 'base64'));
        const sigW = sigCoords.w || 150;
        const sigH = sigCoords.h || 40;

        pages[pageIdx].drawImage(sigImage, {
          x: sigCoords.x,
          y: sigCoords.y,
          width: sigW,
          height: sigH,
        });
        filled++;
      } catch (e) {
        console.error(`Signature embed error [${fieldId}]:`, e.message);
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  return {
    bytes: Buffer.from(pdfBytes),
    filled,
    total,
    pct,
    mode: 'overlay'
  };
}

// ============================================================================
// MODE 3: DATA SHEET - Generate clean summary PDF
// ============================================================================

async function generateDataSheet(formCode, formName, values, dealInfo) {
  const formDef = FORM_INDEX.get(formCode);
  if (!formDef) throw new Error(`Unknown form: ${formCode}`);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 9;
  const headerSize = 11;
  const titleSize = 14;
  const lineHeight = 14;
  const margin = 50;
  const pageWidth = 612; // Letter
  const pageHeight = 792;
  const contentWidth = pageWidth - 2 * margin;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function ensureSpace(needed) {
    if (y - needed < margin + 30) {
      // Add footer to current page
      drawFooter(page);
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  }

  function drawFooter(pg) {
    const pageNum = pdfDoc.getPageCount();
    const footerText = `${formCode} - ${formName} | Deal #${dealInfo.id} | Generated ${new Date().toLocaleDateString('en-CA')}`;
    pg.drawText(footerText, {
      x: margin,
      y: 25,
      size: 7,
      font,
      color: rgb(0.5, 0.5, 0.5)
    });
    pg.drawText(`Page ${pageNum}`, {
      x: pageWidth - margin - 30,
      y: 25,
      size: 7,
      font,
      color: rgb(0.5, 0.5, 0.5)
    });
  }

  // === HEADER ===
  // Blue header bar
  page.drawRectangle({
    x: margin - 10,
    y: y - 5,
    width: contentWidth + 20,
    height: 45,
    color: rgb(0.082, 0.396, 0.753) // #1565C0
  });

  page.drawText('NORALTA TRANSACTION MASTER', {
    x: margin,
    y: y + 22,
    size: 8,
    font,
    color: rgb(1, 1, 1)
  });

  page.drawText(formName, {
    x: margin,
    y: y + 5,
    size: titleSize,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  // Form code + deal info on right
  const codeText = `${formCode} | Deal #${dealInfo.id}`;
  const codeWidth = font.widthOfTextAtSize(codeText, 9);
  page.drawText(codeText, {
    x: pageWidth - margin - codeWidth,
    y: y + 10,
    size: 9,
    font,
    color: rgb(0.8, 0.9, 1)
  });

  y -= 60;

  // === DEAL SUMMARY LINE ===
  const summaryParts = [];
  if (dealInfo.transaction_type) summaryParts.push(`Type: ${dealInfo.transaction_type}`);
  if (dealInfo.property_address) summaryParts.push(`Property: ${dealInfo.property_address}`);
  if (dealInfo.status) summaryParts.push(`Status: ${dealInfo.status}`);

  if (summaryParts.length > 0) {
    page.drawText(summaryParts.join('  |  '), {
      x: margin,
      y,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4)
    });
    y -= 20;
  }

  // Thin separator
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8)
  });
  y -= 15;

  // === SECTIONS & FIELDS ===
  let totalFields = 0;
  let filledFields = 0;

  for (const section of formDef.sections) {
    // Filter out signature-only fields
    const dataFields = section.fields.filter(f => f.db && f.type !== 'signature');
    if (dataFields.length === 0) continue;

    ensureSpace(lineHeight * 3);

    // Section header
    page.drawRectangle({
      x: margin - 5,
      y: y - 3,
      width: contentWidth + 10,
      height: lineHeight + 4,
      color: rgb(0.94, 0.94, 0.94)
    });

    page.drawText(section.name, {
      x: margin,
      y,
      size: headerSize,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2)
    });
    y -= lineHeight + 8;

    // Fields in two-column layout
    const labelWidth = 200;
    const valueX = margin + labelWidth + 10;
    const valueWidth = contentWidth - labelWidth - 10;

    for (const field of dataFields) {
      totalFields++;
      const value = values[field.id];
      const hasValue = value !== null && value !== undefined && value !== '';
      if (hasValue) filledFields++;

      ensureSpace(lineHeight + 4);

      // Label
      page.drawText(field.label, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0.35, 0.35, 0.35)
      });

      // Value (or placeholder)
      if (hasValue) {
        // Format value based on type
        let displayValue;
        if (value instanceof Date) {
          const yr = value.getUTCFullYear();
          const mo = String(value.getUTCMonth() + 1).padStart(2, '0');
          const dy = String(value.getUTCDate()).padStart(2, '0');
          displayValue = `${yr}-${mo}-${dy}`;
        } else {
          displayValue = String(value);
        }
        if (field.type === 'boolean') {
          displayValue = value === true || value === 'true' ? 'Yes' : 'No';
        } else if (field.type === 'currency' && !isNaN(value)) {
          displayValue = '$' + Number(value).toLocaleString('en-CA', { minimumFractionDigits: 2 });
        } else if (field.type === 'date' && /^\d{4}-\d{2}-\d{2}T/.test(displayValue)) {
          displayValue = displayValue.split('T')[0];
        } else if (/^\w{3} \w{3} \d{2} \d{4}/.test(displayValue)) {
          const d = new Date(displayValue);
          if (!isNaN(d.getTime())) {
            displayValue = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
          }
        }

        // Truncate long values
        const maxChars = Math.floor(valueWidth / (fontSize * 0.5));
        if (displayValue.length > maxChars) {
          displayValue = displayValue.substring(0, maxChars - 3) + '...';
        }

        page.drawText(displayValue, {
          x: valueX,
          y,
          size: fontSize,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1)
        });
      } else {
        // Draw underline placeholder
        page.drawLine({
          start: { x: valueX, y: y - 2 },
          end: { x: valueX + Math.min(valueWidth, 200), y: y - 2 },
          thickness: 0.5,
          color: rgb(0.85, 0.85, 0.85)
        });
      }

      y -= lineHeight + 2;
    }

    y -= 8; // Section spacing
  }

  // === COMPLETION SUMMARY ===
  ensureSpace(50);
  y -= 10;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8)
  });
  y -= 18;

  const pct = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0;
  const summaryText = `Completion: ${filledFields}/${totalFields} fields (${pct}%)`;
  page.drawText(summaryText, {
    x: margin,
    y,
    size: 10,
    font: fontBold,
    color: pct === 100 ? rgb(0.2, 0.6, 0.2) : rgb(0.6, 0.3, 0)
  });

  const genText = `Generated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC`;
  const genWidth = font.widthOfTextAtSize(genText, 8);
  page.drawText(genText, {
    x: pageWidth - margin - genWidth,
    y,
    size: 8,
    font,
    color: rgb(0.5, 0.5, 0.5)
  });

  // Add footer to last page
  drawFooter(page);

  const pdfBytes = await pdfDoc.save();
  return {
    bytes: Buffer.from(pdfBytes),
    filled: filledFields,
    total: totalFields,
    pct,
    mode: 'datasheet'
  };
}

// ============================================================================
// MAIN ENTRY POINT - Try template first, fall back to data sheet
// ============================================================================

async function generateFormPDF(formCode, values, dealInfo, signatures = {}) {
  const formDef = FORM_INDEX.get(formCode);
  if (!formDef) throw new Error(`Unknown form: ${formCode}`);

  // Try template fill first (fillable PDFs)
  const templateResult = await fillTemplate(formCode, values, signatures);
  if (templateResult) return templateResult;

  // Try text overlay (flat PDFs with coordinate maps)
  const overlayResult = await overlayTemplate(formCode, values, signatures);
  if (overlayResult) return overlayResult;

  // Fall back to data sheet
  return generateDataSheet(formCode, formDef.name, values, dealInfo);
}

module.exports = {
  generateFormPDF,
  fillTemplate,
  overlayTemplate,
  generateDataSheet,
  FORM_INDEX
};
