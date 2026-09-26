'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadTPS() {
  function firestore() {
    return {
      collection() {
        throw new Error('Firestore should not be used by pure core tests');
      }
    };
  }
  firestore.FieldValue = { serverTimestamp: () => ({ kind: 'serverTimestamp' }) };
  firestore.Timestamp = { fromDate: (date) => date };

  const firebase = {
    apps: [],
    initializeApp() { this.apps.push({}); },
    firestore
  };
  const sandbox = {
    window: {}, firebase, console,
    document: {}, navigator: {},
    setTimeout, clearTimeout, requestAnimationFrame() {}
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'shared.js'), 'utf8'),
    sandbox,
    { filename: 'shared.js' }
  );
  return sandbox.window.TPS;
}

function localDate(y, m, d, hh = 0, mm = 0) {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

const T = loadTPS();

assert.deepEqual(
  JSON.parse(JSON.stringify(T.splitByMonth(
    localDate(2026, 9, 30, 15),
    localDate(2026, 10, 1, 17),
    9
  ))),
  [
    { ym: '2026-09', hours: 2 },
    { ym: '2026-10', hours: 7 }
  ]
);

const threeMonths = T.splitByMonth(
  localDate(2026, 9, 30, 15),
  localDate(2026, 11, 2, 10),
  T.estimateHours(localDate(2026, 9, 30, 15), localDate(2026, 11, 2, 10))
);
assert.equal(
  threeMonths.reduce((sum, segment) => T.roundHalf(sum + segment.hours), 0),
  T.estimateHours(localDate(2026, 9, 30, 15), localDate(2026, 11, 2, 10))
);

const upgrade = T.nextUpgrade(localDate(2020, 1, 1), localDate(2023, 1, 2));
assert.equal(T.dateKey(upgrade.date), '2025-01-01');
assert.equal(upgrade.days, 15);
assert.equal(upgrade.hours, 105);
assert.equal(T.nextUpgrade(localDate(2000, 1, 1), localDate(2025, 1, 2)), null);

for (const file of ['index.html', 'admin.html', 'stats.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  scripts.forEach((source, index) => {
    new vm.Script(source, { filename: `${file}:inline-script-${index + 1}` });
  });
}

console.log('core tests passed');
