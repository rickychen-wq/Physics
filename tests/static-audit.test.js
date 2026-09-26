const fs = require('fs');
const assert = require('assert');

for (const file of ['manifest.json', 'manifest-admin.json', 'manifest-stats.json']) {
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')), `${file} must be valid JSON`);
}

for (const file of ['index.html', 'admin.html', 'stats.html']) {
  const source = fs.readFileSync(file, 'utf8');
  const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepStrictEqual(duplicates, [], `${file} contains duplicate ids`);
  assert.match(source, /premium\.css\?v=\d+/, `${file} must load the versioned premium theme`);
}

console.log('static audit tests passed');
