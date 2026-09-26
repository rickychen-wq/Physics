'use strict';

/* 前台「今天行政室」只能抓今天以後的假單，不能把整個集合讀下來。
 * stats 則必須保留完整歷史（年度總表、明細、匯出都靠它）。 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function loadWithFakeDb(docs) {
  const calls = [];
  function query(col, filters) {
    return {
      where(field, op, value) {
        calls.push({ col, field, op, value });
        return query(col, filters.concat([{ field, op, value }]));
      },
      orderBy() { throw new Error('不可以用 orderBy：會要求建複合索引'); },
      onSnapshot(cb) {
        const rows = docs.filter(d => filters.every(f => {
          const v = d[f.field];
          if (f.op === '>') return v > f.value;
          if (f.op === '>=') return v >= f.value;
          if (f.op === '==') return v === f.value;
          throw new Error('測試不支援的運算子 ' + f.op);
        }));
        cb({ forEach: fn => rows.forEach((r, i) => fn({ id: 'd' + i, data: () => r })) });
        return () => {};
      }
    };
  }
  function firestore() {
    return { collection: col => query(col, []) };
  }
  firestore.FieldValue = { serverTimestamp: () => ({ kind: 'serverTimestamp' }) };
  firestore.Timestamp = { fromDate: date => date };
  const sandbox = {
    window: {}, console, document: {}, navigator: {},
    firebase: { apps: [], initializeApp() { this.apps.push({}); }, firestore },
    setTimeout, clearTimeout, requestAnimationFrame() {}
  };
  vm.runInNewContext(read('shared.js'), sandbox, { filename: 'shared.js' });
  return { T: sandbox.window.TPS, calls };
}

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const day = n => new Date(today.getTime() + n * 86400000);

const docs = [
  { name: '去年請的', endAt: day(-400), startAt: day(-401) },
  { name: '上週請的', endAt: day(-6),   startAt: day(-7) },
  { name: '昨天結束', endAt: day(-1),   startAt: day(-1) },
  { name: '今天請假', endAt: new Date(today.getTime() + 17 * 3600000),
                      startAt: new Date(today.getTime() + 9 * 3600000) },
  { name: '下週請假', endAt: day(8),    startAt: day(7) }
];

const { T, calls } = loadWithFakeDb(docs);
assert.equal(typeof T.watchTodayLeaves, 'function', 'watchTodayLeaves 必須匯出');

let got = null;
// 沙盒裡建立的陣列跟這裡不同環境，用 Array.from 轉成本地陣列再比對
T.watchTodayLeaves(list => { got = Array.from(list, x => x.name).sort(); });

assert.equal(calls.length, 1, '只能有一個 where 條件（多個會要求建索引）');
assert.equal(calls[0].col, 'leaveRequests');
assert.equal(calls[0].field, 'endAt');
assert.equal(calls[0].op, '>');
assert.equal(calls[0].value.getTime(), today.getTime(), '邊界必須是今天 00:00');
assert.deepEqual(got, ['下週請假', '今天請假'], '舊假單不應該被讀進來');

/* 頁面怎麼用：前台只抓今天，stats 要完整歷史 */
const staff = read('index.html');
const stats = read('stats.html');
assert.match(staff, /T\.watchTodayLeaves\(/, '前台必須用 watchTodayLeaves');
assert.doesNotMatch(staff, /T\.watchOfficeLeaves\(/, '前台不可以讀整個假單集合');
assert.match(stats, /T\.watchOfficeLeaves\(/, 'stats 需要完整歷史，必須保留 watchOfficeLeaves');

console.log('today leaves tests passed');
