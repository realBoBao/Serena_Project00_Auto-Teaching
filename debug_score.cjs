const fs = require('fs');
const code = fs.readFileSync('pipeline_report_v2.js', 'utf8');
const lines = code.split('\n');
lines.forEach((line, i) => {
  if (line.includes('score') && !line.includes('let score') && !line.includes('const score') && !line.includes('var score') && !line.includes('function') && !line.includes('//') && !line.includes('calculateSourceScore')) {
    console.log(`Line ${i+1}: ${line.trim()}`);
  }
});
