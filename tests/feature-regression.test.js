const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

for (const name of ['index.html', 'admin.html', 'stats.html']) {
  const html = read(name);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new Function(source), `${name} inline script ${index + 1} has invalid syntax`);
  });
}

const shared = read('shared.js');
const admin = read('admin.html');
const staff = read('index.html');
const stats = read('stats.html');
const calendar = read('calendar-data.js');
const rules = read('firestore.rules');
assert.match(shared, /tps\.session\.v2/);
assert.match(shared, /acc\.pwHash !== saved\.pwHash/);
assert.match(shared, /saveSession\(_me\.email, newHash\)/);
assert.match(shared, /MIN_PASSWORD_LENGTH = 8/);
assert.match(admin, /p\.length < 8/);
assert.match(admin, /id="credentialCenter"/);
assert.match(admin, /管理員後台密碼/);
assert.match(admin, /檢視系統第一層密碼/);
assert.match(admin, /完整資料第二層密碼/);

for (const api of ['createAccount', 'setAccountActive', 'importCalendarDays', 'watchOfficeLeaves', 'watchScopeNotices']) {
  assert.match(shared, new RegExp(`${api}\\s*:`), `${api} must be exported`);
}
assert.match(admin, /id="accAdd"/);
assert.match(admin, /id="calImport"/);
assert.match(admin, /calendar-data\.js/);
assert.doesNotMatch(admin, /function doRate\s*\(/);
assert.match(staff, /id="officeToday"/);
assert.match(staff, /watchTodayLeaves/);   // 前台只抓今天的，詳見 today-leaves.test.js
assert.match(stats, /加班休假檢視系統/);
assert.match(stats, /id="todayBoard"/);
assert.match(stats, /id="upcomingBoard"/);
assert.match(stats, /id="statsNotiList"/);
assert.match(stats, /var LV2_PW/);
assert.match(stats, /id="lockBtn"/);
assert.match(stats, /id="lv2Sheet"/);
assert.doesNotMatch(stats, /tps-admin-[a-z0-9]+/i, 'stats must not contain the admin key');
assert.match(rules, /rules_version = '2'/);
assert.match(shared, /ref\.set\(stamp\(\{ updatedAt: serverTimestamp\(\) \}\), \{ merge: true \}\)/);
assert.doesNotMatch(rules, /allow delete: if wasAdmin\(\) \|\| isAdmin\(\)/);
assert.match(rules, /allow delete: if wasAdmin\(\)/);
assert.match(stats, /sessionStorage\.getItem\(LV2_KEY\)/);
assert.match(stats, /xlsx\.full\.min\.js/);
assert.match(stats, /id="expBtn"/);
assert.match(read('premium.css'), /Premium Glass UI/);
assert.match(calendar, /'2026'/);
assert.match(calendar, /2026-09-25/);
assert.match(calendar, /'2027'/);

console.log('feature regression tests passed');
