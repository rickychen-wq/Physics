'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTPS() {
  function firestore() { return {}; }
  firestore.FieldValue = { serverTimestamp: () => ({}) };
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
    fs.readFileSync(path.resolve(__dirname, '..', 'shared.js'), 'utf8'),
    sandbox,
    { filename: 'shared.js' }
  );
  return sandbox.window.TPS;
}

function d(y, m, day, hour = 0) {
  return new Date(y, m - 1, day, hour, 0, 0, 0);
}

const T = loadTPS();

assert.equal(
  T.checkLeaveLimit([], 'period', d(2026, 12, 31, 9), 14, null, d(2027, 1, 1, 17)),
  null
);

assert.match(
  T.checkLeaveLimit(
    [{ id: 'old', type: 'period', segments: [{ ym: '2027-01', hours: 7 }] }],
    'period', d(2027, 1, 4, 9), 1, null, d(2027, 1, 4, 10)
  ),
  /每個月最多/
);

assert.match(T.validateOvertime(1.25, d(2026, 9, 28), 0), /0\.5/);
assert.equal(T.validateOvertime(1.5, d(2026, 9, 28), 0), null);

const oldFour = { status: 'approved', hours: 4, bonusHours: 0 };
const newFour = { status: 'approved', hours: 4, bonusHours: 0 };
const newTwo = { status: 'approved', hours: 2, bonusHours: 0 };

assert.equal(
  T._adjustOvertimeCredit({ compCurrent: 0, compCarry: 0, compEarnedYTD: 4 }, oldFour, newFour).compCurrent,
  0
);

assert.throws(
  () => T._adjustOvertimeCredit({ compCurrent: 0, compCarry: 0, compEarnedYTD: 4 }, oldFour, newTwo),
  /已有部分被使用/
);
assert.throws(
  () => T._adjustOvertimeCredit({ compCurrent: 2, compCarry: 0, compEarnedYTD: 4 }, oldFour, null),
  /已有部分被使用/
);

assert.equal(
  T._adjustOvertimeCredit({ compCurrent: 3, compCarry: 0, compEarnedYTD: 4 }, oldFour, newTwo).compCurrent,
  1
);

console.log('regression tests passed');
