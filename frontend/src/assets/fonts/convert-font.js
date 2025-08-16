import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the TTF file
const fontPath = path.join(__dirname, 'NotoSans-Bold.ttf');
const fontBuffer = fs.readFileSync(fontPath);
const base64Font = fontBuffer.toString('base64');

// Generate the jsPDF font file
const fontJS = `
// NotoSans-Bold font for jsPDF
// Supports Czech characters: áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ

export const NotoSansBold = '${base64Font}';

export const addNotoSansFont = (jsPDF) => {
  jsPDF.API.addFileToVFS('NotoSans-Bold.ttf', NotoSansBold);
  jsPDF.API.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
};
`;

// Write the font file
fs.writeFileSync(path.join(__dirname, 'NotoSans-Bold.js'), fontJS);
console.log('Font converted successfully! File: NotoSans-Bold.js');
