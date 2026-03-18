const fs = require('fs');
const forms = JSON.parse(fs.readFileSync(__dirname + '/../data/forms.json', 'utf8'));
const tmap = JSON.parse(fs.readFileSync(__dirname + '/../data/template-map.json', 'utf8'));
const pdfFields = JSON.parse(fs.readFileSync(__dirname + '/pdf-fields.json', 'utf8'));

const keyCodes = Object.keys(tmap.templates);
for (const code of keyCodes) {
  const form = forms.find(f => f.code === code);
  const mapped = tmap.templates[code];
  if (!form || !mapped) continue;

  const mappedIds = new Set(Object.keys(mapped.fields));
  const mappedPdfNames = new Set(Object.values(mapped.fields));

  const unmappedFields = [];
  for (const sec of form.sections) {
    for (const f of sec.fields) {
      if (!mappedIds.has(f.id) && f.type !== 'signature') {
        unmappedFields.push({ id: f.id, label: f.label, type: f.type });
      }
    }
  }

  const pdf = pdfFields[code];
  const unusedPdf = pdf ? pdf.pdfFields.filter(f => !mappedPdfNames.has(f.name)) : [];

  const totalNonSig = form.sections.reduce((sum, s) => sum + s.fields.filter(f => f.type !== 'signature').length, 0);
  console.log('\n=== ' + code + ' === (' + mappedIds.size + '/' + totalNonSig + ' mapped, ' + unmappedFields.length + ' gaps)');
  console.log('UNMAPPED FORM FIELDS:');
  unmappedFields.forEach(f => console.log('  ' + f.id.padEnd(10) + f.type.padEnd(12) + f.label));
  console.log('UNUSED PDF FIELDS (' + unusedPdf.length + '):');
  unusedPdf.forEach(f => console.log('  ' + (f.type || 'unknown').padEnd(12) + f.name));
}
