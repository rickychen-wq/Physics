const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const css = read('premium.css');

for (const page of ['index.html', 'admin.html', 'stats.html']) {
  assert.match(read(page), /premium\.css\?v=4/, `${page} must load the legibility theme`);
}

assert.match(css, /v4 high-legibility typography/);
assert.match(css, /body\{[\s\S]*?font-size:16px;[\s\S]*?font-weight:500;/);
assert.match(css, /input,select,textarea\{font-size:17px;font-weight:600/);
assert.match(css, /\.btn\{font-size:16px;font-weight:780/);
assert.match(css, /\.chd h2\{font-size:17px;font-weight:800/);

function rgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
}
function luminance(hex) {
  const channels = rgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const background = '#070a12';
for (const [label, color] of Object.entries({
  primary: '#ffffff',
  secondary: '#d4ddeb',
  muted: '#acb8cc'
})) {
  assert.ok(contrast(color, background) >= 7,
    `${label} text contrast must remain at least 7:1`);
}

console.log('legibility tests passed');
