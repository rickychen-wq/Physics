'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const staff = fs.readFileSync('index.html', 'utf8');
const admin = fs.readFileSync('admin.html', 'utf8');
const stats = fs.readFileSync('stats.html', 'utf8');

for (const [name, source] of [['index.html', staff], ['admin.html', admin], ['stats.html', stats]]) {
  assert.match(source, /source === 'legacy-import'/, `${name} must detect legacy monthly summaries`);
  assert.match(source, /source === 'legacy-detail-import'/, `${name} must detect legacy detailed imports`);
  assert.match(source, /summaryYm/, `${name} must display the source year-month`);
  assert.match(source, /原試算表缺少逐筆日期、時段與原因/, `${name} must disclose missing source detail`);
}

assert.match(admin, /一般紀錄向左滑可以刪除；原表匯入紀錄/);
assert.match(admin, /if\(\/\^legacy-\/\.test\(r\.source \|\| ''\)\)\{[\s\S]*?return wrap;/);
assert.match(stats, /legacyDetail \? '原 Google 表單逐筆明細' : '線上系統'/);
assert.match(stats, /legacyMonthly \? x\.summaryYm \+ '（月統計）'/);
assert.match(stats, /legacyMonthly \? '原表缺少逐筆事由'/);

console.log('legacy import tests passed');
