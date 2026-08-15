/* ============================================================
 *  TPS 行政室請假加班系統  ——  shared.js
 *  以「職位信箱」為識別：秘書換人，信箱不變，資料照樣接下去
 *  非 module 寫法，載入後掛在 window.TPS
 *  依賴：firebase-app-compat / firestore-compat
 * ============================================================ */
window.TPS = (function () {
'use strict';

var SHARED_VERSION = '7.0.0';

/* ---------- 0. Firebase ---------- */
var firebaseConfig = {
  apiKey:            'AIzaSyDI33EUxx1ZEqVdiLFMuNID4m7843gfQf8',
  authDomain:        'physics-b4c40.firebaseapp.com',
  projectId:         'physics-b4c40',
  storageBucket:     'physics-b4c40.firebasestorage.app',
  messagingSenderId: '494615768654',
  appId:             '1:494615768654:web:8d2e50ad3e32e97a199d1f'
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();
var FV = firebase.firestore.FieldValue;
var TS = firebase.firestore.Timestamp;
function serverTimestamp() { return FV.serverTimestamp(); }

/* ---------- SHA-256（純 JS，離線可用） ---------- */
var sha256 = (function () {
  var K = [], H0 = [], p = 2, i = 0, j, okp;
  function frac(x, n) { return Math.floor((x - Math.floor(x)) * Math.pow(2, n)); }
  while (i < 64) {
    okp = true;
    for (j = 2; j * j <= p; j++) if (p % j === 0) { okp = false; break; }
    if (okp) { if (i < 8) H0[i] = frac(Math.pow(p, 1/2), 32); K[i] = frac(Math.pow(p, 1/3), 32); i++; }
    p++;
  }
  function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
  return function (msg) {
    var bytes = [], k;
    for (k = 0; k < msg.length; k++) {
      var c = msg.charCodeAt(k);
      if (c < 128) bytes.push(c);
      else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
      else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    var len = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (k = 7; k >= 0; k--) bytes.push((k < 4 ? Math.floor(len / Math.pow(2, k*8)) : 0) & 255);
    var H = H0.slice(), w = new Array(64), t;
    for (var b = 0; b < bytes.length; b += 64) {
      for (t = 0; t < 16; t++)
        w[t] = (bytes[b+t*4]<<24) | (bytes[b+t*4+1]<<16) | (bytes[b+t*4+2]<<8) | bytes[b+t*4+3];
      for (t = 16; t < 64; t++) {
        var s0 = rr(w[t-15],7) ^ rr(w[t-15],18) ^ (w[t-15] >>> 3);
        var s1 = rr(w[t-2],17) ^ rr(w[t-2],19) ^ (w[t-2] >>> 10);
        w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
      }
      var a=H[0],bb=H[1],c2=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22);
        var mj = (a & bb) ^ (a & c2) ^ (bb & c2);
        var t2 = (S0 + mj) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c2; c2=bb; bb=a; a=(t1+t2)|0;
      }
      H[0]=(H[0]+a)|0; H[1]=(H[1]+bb)|0; H[2]=(H[2]+c2)|0; H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  };
})();

/* ---------- 1. 常數 ---------- */
var HOURS_PER_DAY  = 7;              // 09:00–17:00 扣中午 12:00–13:00
var MONTHLY_OT_CAP = 46;
var WORK_WINDOWS   = [[9, 12], [13, 17]];
var DEFAULT_PW     = '123456';
var ADMIN_PASSWORD = '0423';
var STATS_DEFAULT_PW = 'physics';   // stats 第一層預設密碼，之後可在後台改

/* 後台密鑰。
   刻意不寫在這裡 —— shared.js 是所有頁面都會載入的，
   寫在這裡等於四位秘書打開開發者工具就拿得到。
   改由 admin.html / stats.html 用 setAdminKey() 注入，
   前台 index.html 永遠拿不到這把鑰匙。 */
var ADMIN_KEY = null;
function setAdminKey(k) { ADMIN_KEY = k || null; }
var SALT           = 'tps.ps-taiwan.2026';

var LEAVE_TYPES = [
  { id:'annual',   label:'特別休假',   deducts:'annual' },
  { id:'comp',     label:'加班補休',   deducts:'comp'   },
  { id:'personal', label:'事假',       deducts:null     },
  { id:'sick',     label:'病假',       deducts:null     },
  { id:'period',   label:'生理假',     deducts:null     },
  { id:'family',   label:'家庭照顧假', deducts:null     },
  { id:'other',    label:'其他',       deducts:null, needsText:true }
];
var STATUS = { PENDING:'pending', APPROVED:'approved', REJECTED:'rejected', CANCELLED:'cancelled' };
var STATUS_LABEL = { pending:'待審核', approved:'同意', rejected:'不同意', cancelled:'已撤銷' };
var COL = {
  accounts:'accounts', balances:'balances',
  leave:'leaveRequests', overtime:'overtimeRequests', audit:'auditLog',
  calendar:'calendar',      // 國定假日與補班日
  notices:'notices',        // 站內通知
  settlements:'settlements',// 到期折算薪資的紀錄
  deleted:'deletedRecords', // 刪掉的紀錄留一份副本，匯出時要標注
  push:'pushSubs',          // 手機推播訂閱
  config:'config'           // 系統設定（stats 密碼等）
};

/* ---------- 薪資規則（秘書長 2026/08 說明） ----------
   底薪 = 時薪 × 7 小時 × 23 天（固定天數，不隨當月上班日變動）
   事假：扣全薪
   病假：一年累計 210 小時以內扣半薪，超過的部分扣全薪
   特休、補休、生理假、家庭照顧假：不扣薪                        */
var SALARY = {
  defaultRate: 300,        // 每小時，後台可個別調整
  hoursPerDay: 7,
  daysPerMonth: 23,
  sickHalfPayCapHours: 210 // 一年 30 天 × 7 小時
};

/* ---------- 假別上限 ----------
   生理假：每月 7 小時、每年 21 小時，超過直接擋下來            */
var LEAVE_LIMITS = {
  period: { monthHours: 7, yearHours: 21, label: '生理假' }
};

/* 加班事由至少要寫幾個字 */
var OT_REASON_MIN = 10;

/* 加班規則（依秘書長 2026/08 說明）
   ─ 第一小時必須整數，之後才能以 0.5 為單位
   ─ 工作日一天最多 4 小時
   ─ 一個月總時數不得超過 46（以實際時數計，不含核派加倍的部分）
   ─ 核派加班補休加倍，由秘書長審核時決定 */
var OT_RULES = { minHours:1, weekdayDailyCap:4, monthlyCap:46, dispatchMultiplier:2 };
function leaveTypeLabel(id) {
  for (var i = 0; i < LEAVE_TYPES.length; i++)
    if (LEAVE_TYPES[i].id === id) return LEAVE_TYPES[i].label;
  return id;
}
function leaveTypeDef(id) {
  for (var i = 0; i < LEAVE_TYPES.length; i++)
    if (LEAVE_TYPES[i].id === id) return LEAVE_TYPES[i];
  return null;
}

/* ---------- 2. 日期與時數 ---------- */
function toDate(v) {
  if (!v) return new Date(NaN);
  if (v.toDate) return v.toDate();
  return (v instanceof Date) ? v : new Date(v);
}
function pad(n) { return String(n).padStart(2, '0'); }
function ym(d) { var x = toDate(d); return x.getFullYear() + '-' + pad(x.getMonth() + 1); }
function fmtDate(d) { var x = toDate(d); return x.getFullYear() + '/' + (x.getMonth()+1) + '/' + x.getDate(); }
function fmtTime(d) { var x = toDate(d); return pad(x.getHours()) + ':' + pad(x.getMinutes()); }
function fmtDateTime(d) { return fmtDate(d) + ' ' + fmtTime(d); }
function fmtStamp(d) {
  var x = toDate(d);
  if (isNaN(x)) return '—';
  return x.getFullYear() + '/' + pad(x.getMonth()+1) + '/' + pad(x.getDate()) + ' ' + fmtTime(x);
}
function roundHalf(n) { return Math.round(Number(n) * 2) / 2; }
function ms(v) { return (v && v.toMillis) ? v.toMillis() : 0; }

/* ---------- 行事曆：國定假日與補班日 ----------
   dayType(d) 回傳 'holiday'（放假，不算時數）
                 'workday'（上班，即使是週末也算）
                 null（照星期判斷）                       */
var _cal = {};          // { '2026-02-16': 'holiday', ... }
var _calLoaded = false;

function dateKey(d) {
  var x = toDate(d);
  return x.getFullYear() + '-' + pad(x.getMonth()+1) + '-' + pad(x.getDate());
}
function loadCalendar() {
  return db.collection(COL.calendar).get().then(function (snap) {
    _cal = {};
    snap.forEach(function (d) { _cal[d.id] = (d.data() || {}).type || 'holiday'; });
    _calLoaded = true;
    return _cal;
  }).catch(function (e) { _onError(e); _calLoaded = true; return _cal; });
}
function calendarReady() { return _calLoaded; }
function dayType(d) { return _cal[dateKey(d)] || null; }
/** 這天要不要算時數 */
function isWorkingDay(d) {
  var t = dayType(d);
  if (t === 'holiday') return false;   // 國定假日：不算
  if (t === 'workday') return true;    // 補班日：算，即使是週六
  var w = d.getDay();
  return w >= 1 && w <= 5;
}
function listCalendar(year) {
  return db.collection(COL.calendar).get().then(function (snap) {
    var out = [];
    snap.forEach(function (d) {
      var o = d.data(); o.date = d.id;
      if (!year || d.id.slice(0,4) === String(year)) out.push(o);
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  });
}
function setCalendarDay(dateStr, type, label) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以修改行事曆'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr))
    return Promise.reject(new Error('日期格式要像 2027-02-16'));
  if (type !== 'holiday' && type !== 'workday')
    return Promise.reject(new Error('類型只能是 holiday 或 workday'));
  return db.collection(COL.calendar).doc(dateStr)
    .set(stamp({ type: type, label: label || '', updatedAt: serverTimestamp() }))
    .then(function () { _cal[dateStr] = type; })
    .then(function () { return writeAudit('calendar.set', dateStr, null, { type:type, label:label }); });
}
function deleteCalendarDay(dateStr) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以修改行事曆'));
  return db.collection(COL.calendar).doc(dateStr).delete()
    .then(function () { delete _cal[dateStr]; })
    .then(function () { return writeAudit('calendar.delete', dateStr, null, null); });
}

/** 依上班時段自動算時數：平日 09–12、13–17 */
function estimateHours(startAt, endAt) {
  var s = toDate(startAt), e = toDate(endAt);
  if (!(s < e)) return 0;
  var total = 0;
  var cur  = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  var last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  while (cur <= last) {
    if (isWorkingDay(cur)) {
      for (var i = 0; i < WORK_WINDOWS.length; i++) {
        var ws = new Date(cur); ws.setHours(WORK_WINDOWS[i][0], 0, 0, 0);
        var we = new Date(cur); we.setHours(WORK_WINDOWS[i][1], 0, 0, 0);
        var from = Math.max(ws.getTime(), s.getTime());
        var to   = Math.min(we.getTime(), e.getTime());
        if (to > from) total += (to - from) / 36e5;
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return roundHalf(total);
}

/** 跨月假單依工作日比例拆成每月時數 */
function splitByMonth(startAt, endAt, totalHours) {
  var s = toDate(startAt), e = toDate(endAt), total = roundHalf(totalHours);
  if (!(total > 0)) return [];
  var per = {}, keys = [], workdays = 0;
  var cur  = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  var last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  while (cur <= last) {
    if (isWorkingDay(cur)) {
      var k = ym(cur);
      if (!per[k]) { per[k] = 0; keys.push(k); }
      per[k]++; workdays++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (workdays === 0 || keys.length <= 1) return [{ ym: ym(s), hours: total }];
  keys.sort();
  var out = [], used = 0;
  for (var i = 0; i < keys.length; i++) {
    var h = (i === keys.length - 1) ? roundHalf(total - used)
                                    : roundHalf(total * per[keys[i]] / workdays);
    if (i !== keys.length - 1) used += h;
    if (h > 0) out.push({ ym: keys[i], hours: h });
  }
  return out;
}

/** 勞基法 §38 特休日數 */
function annualLeaveDays(hireDate, atDate) {
  var h = toDate(hireDate), a = toDate(atDate || new Date());
  if (isNaN(h) || isNaN(a)) return 0;
  var years = a.getFullYear() - h.getFullYear();
  var anniv = new Date(h); anniv.setFullYear(h.getFullYear() + years);
  if (anniv > a) years--;
  var half = new Date(h); half.setMonth(h.getMonth() + 6);
  if (a < half)   return 0;
  if (years < 1)  return 3;
  if (years < 2)  return 7;
  if (years < 3)  return 10;
  if (years < 5)  return 14;
  if (years < 10) return 15;
  return Math.min(30, 15 + (years - 9));
}
function annualLeaveHours(h, a) { return annualLeaveDays(h, a) * HOURS_PER_DAY; }

function seniority(hireDate, atDate) {
  var h = toDate(hireDate), a = toDate(atDate || new Date());
  if (isNaN(h) || isNaN(a) || a < h) return { years:0, months:0, totalMonths:0 };
  var m = (a.getFullYear() - h.getFullYear()) * 12 + (a.getMonth() - h.getMonth());
  if (a.getDate() < h.getDate()) m--;
  if (m < 0) m = 0;
  return { years: Math.floor(m/12), months: m % 12, totalMonths: m };
}
/** 下次特休調升的日子（週年制） */
function nextUpgrade(hireDate, atDate) {
  var h = toDate(hireDate), a = toDate(atDate || new Date());
  if (isNaN(h)) return null;
  var now = annualLeaveDays(h, a), probe = new Date(a);
  for (var i = 0; i < 400; i++) {
    probe.setDate(probe.getDate() + 1);
    var d = annualLeaveDays(h, probe);
    if (d > now) return { date: new Date(probe), days: d, hours: d * HOURS_PER_DAY };
  }
  return null;
}

/* ---------- 3. 錯誤處理 ---------- */
var _onError = function (e) { console.error('[TPS]', e); };
function setErrorHandler(fn) { _onError = fn; }

/* ---------- 4. 登入 ---------- */
var SESSION_KEY = 'tps.session';
var _me = null;

function hashPw(pw) { return sha256(SALT + '|' + String(pw)); }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function currentUser() { return _me; }
function isAdmin() { return !!_me && _me.role === 'admin'; }
function canApply() { return !!_me && _me.role === 'staff' && _me.active !== false; }

function saveSession(email) { try { localStorage.setItem(SESSION_KEY, email); } catch (e) {} }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
function readSession() { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } }

function buildMe(email, acc) {
  return {
    email: email, name: acc.name || '', role: 'staff',
    hireDate: acc.hireDate || null, resignDate: acc.resignDate || null,
    active: acc.active !== false, term: acc.term || 1,
    isDefaultPw: acc.pwHash === hashPw(DEFAULT_PW)
  };
}

/** 只有名單上的信箱能登入 */
function login(email, password) {
  var em = normEmail(email);
  if (!em) return Promise.reject(new Error('請輸入信箱'));
  return db.collection(COL.accounts).doc(em).get().then(function (snap) {
    if (!snap.exists) throw new Error('這個信箱沒有使用權限，請聯絡秘書長');
    var acc = snap.data();
    if (acc.active === false) throw new Error('這個信箱已停用，請聯絡秘書長');
    if (acc.pwHash !== hashPw(password)) throw new Error('密碼不正確');
    _me = buildMe(em, acc);
    saveSession(em);
    afterLogin(em);          // 不等它跑完，畫面先進去，資料變動會靠監聽自己更新
    return _me;
  });
}
/**
 * 登入後的例行事情。
 * 注意：遞延到期與自動發特休都會改到「時數」，
 * 而安全規則只允許後台改時數，所以那兩件事挪到秘書長開後台時才跑
 * （admin.html 開啟時會對全部人跑一次）。
 * 這裡只載入行事曆。
 */
function afterLogin(em) {
  return loadCalendar()
    .then(function () { return db.collection(COL.accounts).doc(em).get(); })
    .then(function (sn) {
      // 背景跑完才回來，如果中間已經登出或換成別的身分就不要蓋掉
      if (sn.exists && _me && _me.email === em) _me = buildMe(em, sn.data());
      return _me;
    })
    .catch(function (e) { console.warn('[TPS] 例行檢查', e); return _me; });
}

function logout() { _me = null; clearSession(); return Promise.resolve(); }

function restoreSession() {
  var em = readSession();
  if (!em) return Promise.resolve(null);
  return db.collection(COL.accounts).doc(em).get().then(function (snap) {
    if (!snap.exists || snap.data().active === false) { clearSession(); return null; }
    _me = buildMe(em, snap.data());
    afterLogin(em);
    return _me;
  }).catch(function (e) { _onError(e); return null; });
}

/** 自己改密碼：舊密碼 + 新密碼兩次 */
function changePassword(oldPw, newPw, confirmPw) {
  if (!_me) return Promise.reject(new Error('尚未登入'));
  if (String(newPw).length < 4) return Promise.reject(new Error('新密碼至少 4 個字元'));
  if (String(newPw) !== String(confirmPw)) return Promise.reject(new Error('兩次輸入的新密碼不一樣'));
  if (String(newPw) === String(oldPw)) return Promise.reject(new Error('新密碼不能跟舊密碼一樣'));
  var ref = db.collection(COL.accounts).doc(_me.email);
  return ref.get().then(function (sn) {
    if (!sn.exists) throw new Error('找不到這個帳號');
    if (sn.data().pwHash !== hashPw(oldPw)) throw new Error('目前的密碼不正確');
    return ref.set({ pwHash: hashPw(newPw), updatedAt: serverTimestamp() }, { merge: true });
  }).then(function () {
    _me.isDefaultPw = false;
    return writeAudit('account.changePw', _me.email, null, null);
  });
}

/* 後台密碼：以資料庫為準，讀不到就退回預設值。
   loadAdminPassword() 要在頁面載入時先呼叫一次。 */
var _adminPw = ADMIN_PASSWORD;
function loadAdminPassword() {
  return getConfig('admin').then(function (c) {
    if (c && c.pw) _adminPw = c.pw;
    return _adminPw;
  }).catch(function () { return _adminPw; });
}
function currentAdminPassword() { return _adminPw; }

/** 秘書長改自己的後台密碼 */
function setAdminPassword(oldPw, newPw, confirmPw) {
  if (String(oldPw) !== _adminPw) return Promise.reject(new Error('目前的密碼不正確'));
  var p = String(newPw || '').trim();
  if (p.length < 4) return Promise.reject(new Error('新密碼至少 4 個字元'));
  if (p !== String(confirmPw)) return Promise.reject(new Error('兩次輸入的新密碼不一樣'));
  if (p === _adminPw) return Promise.reject(new Error('新密碼不能跟舊密碼一樣'));
  return setMerge(COL.config, 'admin', { pw: p, changedAt: serverTimestamp() })
    .then(function () { _adminPw = p; })
    .then(function () { return writeAudit('config.adminPw', 'admin', null, null); });
}

function adminLogin(pw) {
  if (String(pw) !== _adminPw) return false;
  _me = { email: 'admin', name: '秘書長', role: 'admin', active: true, term: 0 };
  return true;
}
function adminLogout() { _me = null; }

/* ---------- 5. 帳號 ---------- */
function listAccounts() {
  return db.collection(COL.accounts).get().then(function (snap) {
    var out = [];
    snap.forEach(function (d) { var o = d.data(); o.email = d.id; out.push(o); });
    return out.sort(function (a, b) {
      if ((a.active !== false) !== (b.active !== false)) return (a.active !== false) ? -1 : 1;
      return String(a.email).localeCompare(String(b.email));
    });
  });
}
function getAccount(email) {
  return db.collection(COL.accounts).doc(normEmail(email)).get().then(function (s) {
    if (!s.exists) return null;
    var o = s.data(); o.email = normEmail(email); return o;
  });
}
function upsertAccount(email, data) {
  var em = normEmail(email);
  if (!em) return Promise.reject(new Error('缺少信箱'));
  data.updatedAt = serverTimestamp();
  return db.collection(COL.accounts).doc(em).set(stamp(data), { merge: true });
}
/** 後台身分寫入時自動附上密鑰，一般使用者不附 */
function withKey(data) {
  var d = data || {};
  if (isAdmin() && ADMIN_KEY) d.adminKey = ADMIN_KEY;
  return d;
}
function stamp(data) { return withKey(data); }
function setMerge(col, id, data) {
  return db.collection(col).doc(id).set(stamp(data), { merge: true });
}

/** 後台重設密碼，一律回到預設 123456 */
function resetPassword(email) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以重設密碼'));
  return upsertAccount(email, { pwHash: hashPw(DEFAULT_PW) })
    .then(function () { return writeAudit('account.resetPw', normEmail(email), null, null); })
    .then(function () { return DEFAULT_PW; });
}

/**
 * 換人接手：同一個信箱換新秘書。
 * 任期 +1、時數全部歸零、密碼回預設。
 * 舊紀錄留在資料庫（任期較小），前台看不到，後台查得到。
 */
function handoverAccount(email, newName, hireDate) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以執行換人'));
  var em = normEmail(email);
  var name = String(newName || '').trim();
  if (!name) return Promise.reject(new Error('請填新任秘書的姓名'));
  return getAccount(em).then(function (acc) {
    if (!acc) throw new Error('找不到這個信箱');
    var newTerm = (acc.term || 1) + 1;
    return upsertAccount(em, {
      name: name,
      term: newTerm,
      hireDate: hireDate ? TS.fromDate(toDate(hireDate)) : null,
      resignDate: null,
      active: true,
      pwHash: hashPw(DEFAULT_PW),
      prevName: acc.name || '',
      termStartAt: serverTimestamp()
    }).then(function () {
      // 兩袋都要歸零，漏一個新秘書就會繼承前任的時數
      return setMerge(COL.balances, em, {
        annualCarry: 0, annualCarryExpire: null, annualCurrent: 0, annualRemaining: 0,
        compCarry: 0,   compCarryExpire: null,   compCurrent: 0,   compRemaining: 0,
        annualUsedYTD: 0, compUsedYTD: 0, compEarnedYTD: 0,
        expiredAnnualHours: 0, expiredCompHours: 0,
        updatedAt: serverTimestamp()
      });
    }).then(function () {
      return writeAudit('account.handover', em,
        { name: acc.name, term: acc.term || 1 }, { name: name, term: newTerm });
    }).then(function () { return { term: newTerm, password: DEFAULT_PW }; });
  });
}

/* ---------- 6. 時數 ---------- */
/* 特休和補休都分兩袋：
   xxxCarry   = 去年遞延過來的，有到期日，請假優先扣
   xxxCurrent = 今年新增的
   到期沒用完 → 強制折算薪資（勞基法 §38、學會補休規定） */
var EMPTY_BAL = {
  annualCarry:0, annualCarryExpire:null, annualCurrent:0, annualRemaining:0,
  compCarry:0,   compCarryExpire:null,   compCurrent:0,   compRemaining:0,
  annualUsedYTD:0, compUsedYTD:0, compEarnedYTD:0,
  expiredAnnualHours:0, expiredCompHours:0
};
function normalizeBal(b) {
  var o = Object.assign({}, EMPTY_BAL, b || {});
  // 舊資料只有 compRemaining 沒有兩袋時，全部當成今年的
  if (b && b.compCurrent === undefined && b.compRemaining !== undefined)
    o.compCurrent = roundHalf((b.compRemaining || 0) - (b.compCarry || 0));
  o.annualRemaining = roundHalf((o.annualCarry || 0) + (o.annualCurrent || 0));
  o.compRemaining   = roundHalf((o.compCarry   || 0) + (o.compCurrent   || 0));
  return o;
}
/** 先扣遞延、再扣今年 */
function splitPool(bal, need, kind) {
  var b = normalizeBal(bal);
  var carry = kind === 'annual' ? b.annualCarry   : b.compCarry;
  var cur   = kind === 'annual' ? b.annualCurrent : b.compCurrent;
  var fromCarry   = Math.min(roundHalf(need), carry || 0);
  var fromCurrent = roundHalf(need - fromCarry);
  return { fromCarry: fromCarry, fromCurrent: fromCurrent, enough: fromCurrent <= (cur || 0) };
}
function splitAnnual(bal, need) { return splitPool(bal, need, 'annual'); }
function splitComp(bal, need)   { return splitPool(bal, need, 'comp'); }
function getBalance(email) {
  return db.collection(COL.balances).doc(normEmail(email)).get().then(function (s) {
    return normalizeBal(s.exists ? s.data() : null);
  });
}
function watchBalance(email, cb) {
  return db.collection(COL.balances).doc(normEmail(email)).onSnapshot(function (s) {
    cb(normalizeBal(s.exists ? s.data() : null));
  }, function (e) { _onError(e); });
}

/**
 * 遞延到期檢查。
 * 2025 沒休完的假遞延到 2026，到 2026/12/31 為止；
 * 2027/1/1 一開頁就會自動歸零，並記下應折發工資的時數。
 */
/**
 * 遞延到期檢查（特休與補休各自判斷）。
 * 到期沒用完的 → 歸零、寫一筆結算紀錄、發通知，不會靜悄悄扣掉。
 */
function checkCarryExpiry(email, now) {
  var em = normEmail(email);
  var at = now ? toDate(now) : new Date();
  return getBalance(em).then(function (b) {
    var patch = {}, settle = [], expiredA = 0, expiredC = 0;

    if ((b.annualCarry > 0) && b.annualCarryExpire) {
      var ea = toDate(b.annualCarryExpire);
      if (!isNaN(ea) && at > ea) {
        expiredA = roundHalf(b.annualCarry);
        patch.annualCarry = 0; patch.annualCarryExpire = null;
        patch.annualRemaining = roundHalf(b.annualCurrent || 0);
        patch.expiredAnnualHours = roundHalf((b.expiredAnnualHours || 0) + expiredA);
        settle.push({ kind:'annual', hours:expiredA, expiredAt:ea });
      }
    }
    if ((b.compCarry > 0) && b.compCarryExpire) {
      var ec = toDate(b.compCarryExpire);
      if (!isNaN(ec) && at > ec) {
        expiredC = roundHalf(b.compCarry);
        patch.compCarry = 0; patch.compCarryExpire = null;
        patch.compRemaining = roundHalf(b.compCurrent || 0);
        patch.expiredCompHours = roundHalf((b.expiredCompHours || 0) + expiredC);
        settle.push({ kind:'comp', hours:expiredC, expiredAt:ec });
      }
    }
    if (!settle.length) return { annual:0, comp:0 };

    patch.updatedAt = serverTimestamp();
    return setMerge(COL.balances, em, patch).then(function () {
      return Promise.all(settle.map(function (x) {
        return db.collection(COL.settlements).add({
          email: em, kind: x.kind, hours: x.hours,
          year: toDate(x.expiredAt).getFullYear(),
          expiredAt: TS.fromDate(toDate(x.expiredAt)),
          reason: '遞延期滿未休完，依規定折算薪資',
          paid: false, createdAt: serverTimestamp()
        });
      }));
    }).then(function () {
      var txt = settle.map(function (x) {
        return (x.kind === 'annual' ? '特休' : '補休') + ' ' + x.hours + ' 小時';
      }).join('、');
      return pushNotice(em, '時數到期折算薪資',
        '你遞延的 ' + txt + ' 已到期，依規定折算為薪資。詳情可詢問秘書長。');
    }).then(function () { return { annual: expiredA, comp: expiredC }; });
  });
}

/** 全部人跑一次到期檢查（後台開啟時執行） */
function checkAllExpiry(now) {
  return listAccounts().then(function (list) {
    return Promise.all(list.map(function (a) { return checkCarryExpiry(a.email, now); }))
      .then(function (rs) {
        return list.map(function (a, i) { return { email:a.email, name:a.name, r:rs[i] }; })
          .filter(function (x) { return x.r.annual > 0 || x.r.comp > 0; });
      });
  });
}

/** 結算紀錄（後台結算分頁用） */
function listSettlements() {
  return db.collection(COL.settlements).get().then(function (snap) {
    var out = [];
    snap.forEach(function (d) { var o = d.data(); o.id = d.id; out.push(o); });
    return out.sort(function (a, b) { return ms(b.createdAt) - ms(a.createdAt); });
  });
}
function markSettlementPaid(id, paid) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以標記'));
  return setMerge(COL.settlements, id, { paid: !!paid, paidAt: serverTimestamp() })
    .then(function () { return writeAudit('settlement.paid', id, null, { paid: !!paid }); });
}

/**
 * 自動發特休：任何人開網頁時檢查，過了到職週年就自動發。
 * 用 lastGrantAnniv 記錄「已經發過哪一個週年」，避免重複發。
 */
function autoGrantIfDue(email, now) {
  var em = normEmail(email);
  var at = now ? toDate(now) : new Date();
  return Promise.all([getAccount(em), getBalance(em)]).then(function (r) {
    var acc = r[0], b = r[1];
    if (!acc || !acc.hireDate || acc.active === false) return { granted: false };

    var h = toDate(acc.hireDate);
    var days = annualLeaveDays(h, at);
    if (days <= 0) return { granted: false };

    // 這次符合的是「第幾個週年」：用年資判斷發放的基準日
    var anniv = new Date(h);
    anniv.setMonth(h.getMonth() + 6);          // 滿半年那次
    var mark = dateKey(anniv);
    var yrs = at.getFullYear() - h.getFullYear();
    for (var i = yrs; i >= 1; i--) {
      var d = new Date(h); d.setFullYear(h.getFullYear() + i);
      if (d <= at) { mark = dateKey(d); break; }
    }
    if (acc.lastGrantAnniv === mark) return { granted: false };
    if (toDate(mark + 'T00:00:00') > at) return { granted: false };

    var newHours = roundHalf(days * HOURS_PER_DAY);
    var carry    = roundHalf(b.annualCurrent || 0);
    var mustPay  = roundHalf(b.annualCarry || 0);   // 上一批遞延還沒用完 → 折算薪資
    var expire   = new Date(at.getFullYear(), 11, 31, 23, 59, 59);

    var jobs = [];
    if (mustPay > 0) {
      jobs.push(db.collection(COL.settlements).add({
        email: em, kind:'annual', hours: mustPay, year: at.getFullYear(),
        expiredAt: TS.fromDate(at), paid: false,
        reason: '新年度發放時，前一批遞延特休尚未休完，依規定折算薪資',
        createdAt: serverTimestamp()
      }));
    }
    jobs.push(setMerge(COL.balances, em, {
      annualCarry: carry,
      annualCarryExpire: carry > 0 ? TS.fromDate(expire) : null,
      annualCurrent: newHours,
      annualRemaining: roundHalf(carry + newHours),
      annualUsedYTD: 0,
      expiredAnnualHours: roundHalf((b.expiredAnnualHours || 0) + mustPay),
      updatedAt: serverTimestamp()
    }));
    jobs.push(upsertAccount(em, { lastGrantAnniv: mark }));

    return Promise.all(jobs).then(function () {
      return pushNotice(em, '特休已更新',
        '你的年資已滿，本年度特休 ' + newHours + ' 小時已發放。' +
        (carry > 0 ? '去年沒休完的 ' + carry + ' 小時已遞延，' + fmtDate(expire) + ' 前要用完。' : '') +
        (mustPay > 0 ? '另有 ' + mustPay + ' 小時遞延到期，已折算薪資。' : ''), 'grant');
    }).then(function () {
      return writeAudit('balance.autoGrant', em,
        { current: b.annualCurrent, carry: b.annualCarry },
        { granted: newHours, carried: carry, mustPayHours: mustPay, anniv: mark });
    }).then(function () {
      return { granted: true, hours: newHours, carried: carry, mustPayHours: mustPay, anniv: mark };
    });
  }).catch(function (e) { console.warn('[TPS] 自動發特休失敗', e); return { granted: false }; });
}

/** 全部人跑一次（後台開啟時） */
function autoGrantAll(now) {
  return listAccounts().then(function (list) {
    return Promise.all(list.map(function (a) {
      return autoGrantIfDue(a.email, now).then(function (r) {
        r.email = a.email; r.name = a.name; return r;
      });
    })).then(function (rs) { return rs.filter(function (x) { return x.granted; }); });
  });
}

/** 年度發特休（到職週年那天）：今年沒休完的轉成遞延，再給新的一年份 */
function grantAnnual(email, newHours, carryExpire) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以發特休'));
  var em = normEmail(email);
  return getBalance(em).then(function (b) {
    var mustPay = b.annualCarry || 0;
    var carry   = roundHalf(b.annualCurrent || 0);
    return setMerge(COL.balances, em, {
      annualCarry: carry,
      annualCarryExpire: carryExpire ? TS.fromDate(toDate(carryExpire)) : null,
      annualCurrent: roundHalf(newHours),
      annualRemaining: roundHalf(carry + roundHalf(newHours)),
      annualUsedYTD: 0,
      updatedAt: serverTimestamp()
    }).then(function () {
      return writeAudit('balance.grant', em,
        { carry: b.annualCarry, current: b.annualCurrent },
        { carry: carry, current: roundHalf(newHours), mustPayHours: mustPay });
    }).then(function () { return { carried: carry, mustPayHours: mustPay }; });
  });
}

/* ---------- 7. 請假 ---------- */

/** 抓某人某年所有已核准／待審核的假單，用來算上限 */
function myLeavesForLimit(email) {
  return db.collection(COL.leave).where('email', '==', normEmail(email)).get()
    .then(function (snap) {
      return snapList(snap).filter(function (x) {
        return x.status === STATUS.PENDING || x.status === STATUS.APPROVED;
      });
    }).catch(function () { return []; });
}

/**
 * 假別上限檢查（目前只有生理假）。
 * @returns null 代表可以送，否則回傳擋下來的原因
 */
function checkLeaveLimit(list, type, startAt, hours, excludeId) {
  var rule = LEAVE_LIMITS[type];
  if (!rule) return null;
  var d = toDate(startAt);
  var yKey = d.getFullYear(), mKey = ym(d);
  var monthUsed = 0, yearUsed = 0;

  list.forEach(function (x) {
    if (x.type !== type) return;
    if (excludeId && x.id === excludeId) return;
    var segs = (x.segments && x.segments.length) ? x.segments
             : [{ ym: ym(x.startAt), hours: x.hours }];
    segs.forEach(function (sg) {
      if (String(sg.ym).slice(0,4) !== String(yKey)) return;
      yearUsed = roundHalf(yearUsed + sg.hours);
      if (sg.ym === mKey) monthUsed = roundHalf(monthUsed + sg.hours);
    });
  });

  var h = roundHalf(hours);
  if (monthUsed + h > rule.monthHours)
    return rule.label + '每個月最多 ' + rule.monthHours + ' 小時，' +
      mKey.replace('-', ' 年 ') + ' 月已經用掉 ' + monthUsed + ' 小時，' +
      '這次再請 ' + h + ' 小時會超過。請改請其他假別。';
  if (yearUsed + h > rule.yearHours)
    return rule.label + '每年最多 ' + rule.yearHours + ' 小時，' +
      yKey + ' 年已經用掉 ' + yearUsed + ' 小時，' +
      '這次再請 ' + h + ' 小時會超過。請改請其他假別。';
  return null;
}

/** 可以當代理人的同事：在職、不是自己、不是測試帳號 */
function proxyCandidates() {
  var me = currentUser();
  return listAccounts().then(function (list) {
    return list.filter(function (a) {
      return a.active !== false && a.isTest !== true &&
             (!me || a.email !== me.email);
    });
  });
}
function submitLeave(o) {
  var u = currentUser();
  if (!u) return Promise.reject(new Error('尚未登入'));
  if (!canApply()) return Promise.reject(new Error('這個帳號沒有申請權限'));

  var s = toDate(o.startAt), e = toDate(o.endAt);
  if (!(e > s)) return Promise.reject(new Error('結束時間必須晚於開始時間'));
  var h = roundHalf(o.hours);
  if (!(h > 0)) return Promise.reject(new Error('這段期間算不出時數，請確認是不是選到假日或非上班時間'));

  var def = leaveTypeDef(o.type);
  if (!def) return Promise.reject(new Error('假別不存在'));
  var otherType = String(o.otherType || '').trim();
  if (def.needsText && !otherType) return Promise.reject(new Error('請填寫假別名稱'));

  var a = def.deducts === 'annual' ? h : 0;
  var c = def.deducts === 'comp'   ? h : 0;

  var needsProxy = !!o.needsProxy;
  var proxyEmail = normEmail(o.proxyEmail || '');
  if (needsProxy && !proxyEmail)
    return Promise.reject(new Error('請選擇職務代理人'));
  if (needsProxy && proxyEmail === u.email)
    return Promise.reject(new Error('不能選自己當代理人'));

  return myLeavesForLimit(u.email)
    .then(function (mine) {
      var bad = checkLeaveLimit(mine, o.type, s, h);
      if (bad) throw new Error(bad);
      return (a > 0 || c > 0) ? getBalance(u.email) : EMPTY_BAL;
    })
    .then(function (bal) {
      if (a > 0 && !splitAnnual(bal, a).enough)
        throw new Error('特休不足，目前剩 ' + (bal.annualRemaining || 0) + ' 小時');
      if (c > 0 && !splitComp(bal, c).enough)
        throw new Error('補休不足，目前剩 ' + (bal.compRemaining || 0) + ' 小時');
      return db.collection(COL.leave).add({
        email: u.email, name: u.name, term: u.term || 1,
        type: o.type, otherType: otherType,
        startAt: TS.fromDate(s), endAt: TS.fromDate(e),
        hours: h, annualHours: a, compHours: c,
        segments: splitByMonth(s, e, h),
        isLate: !!o.isLate, lateReason: o.lateReason || '',
        needsProxy: needsProxy,
        proxyEmail: needsProxy ? proxyEmail : null,
        proxyName: o.proxyName || '',
        /* 代理人要先確認，確認過才輪到秘書長 */
        proxyStatus: needsProxy ? 'waiting' : null,
        proxyRespondedAt: null, proxyNote: '',
        status: STATUS.PENDING,
        reviewedBy: null, reviewedAt: null, adminNote: '',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    })
    .then(function (ref) {
      writeAudit('leave.submit', ref.id, null, { type: o.type, hours: h });
      pushNotice('admin', '有新的請假申請',
        u.name + ' 申請 ' + leaveTypeLabel(o.type) + ' ' + h + ' 小時（' +
        fmtDate(s) + '）', 'leave');
      /* 檢視者只知道誰要請假、哪一天，不揭露假別與時數 */
      pushNotice('stats', '有新的請假申請',
        u.name + ' 申請請假 ' + fmtDate(s) +
        (fmtDate(s) !== fmtDate(e) ? ' – ' + fmtDate(e) : ''), 'leave');
      if (needsProxy) {
        pushNotice(proxyEmail, '有一張假單需要你確認代理',
          u.name + ' 申請 ' + leaveTypeLabel(o.type) + ' ' + h + ' 小時（' +
          fmtDate(s) + ' – ' + fmtDate(e) + '），指定你為職務代理人。' +
          '請到「通知」頁確認或駁回。', 'proxy');
      }
      return ref.id;
    });
}

/**
 * 代理人回覆。
 * 確認 → 假單繼續往秘書長那邊送
 * 駁回 → 整張作廢，申請人要重開一張
 */
function respondProxy(leaveId, accept, note) {
  var u = currentUser();
  if (!u) return Promise.reject(new Error('尚未登入'));
  var ref = db.collection(COL.leave).doc(leaveId);
  return ref.get().then(function (sn) {
    if (!sn.exists) throw new Error('假單不存在');
    var L = sn.data();
    if (L.proxyEmail !== u.email) throw new Error('這張假單不是指定你當代理人');
    if (L.proxyStatus !== 'waiting') throw new Error('這張假單已經回覆過了');
    if (L.status !== STATUS.PENDING) throw new Error('這張假單已經不在審核中');

    var patch = {
      proxyStatus: accept ? 'accepted' : 'declined',
      proxyRespondedAt: serverTimestamp(),
      proxyNote: note || '',
      updatedAt: serverTimestamp()
    };
    if (!accept) {
      patch.status = STATUS.CANCELLED;
      patch.cancelledBy = u.name + '（代理人駁回）';
      patch.cancelledAt = serverTimestamp();
    }
    return ref.set(patch, { merge: true }).then(function () {
      return pushNotice(L.email,
        accept ? '代理人已確認' : '代理人駁回了你的假單',
        accept
          ? u.name + ' 已確認擔任你的職務代理人（' + leaveTypeLabel(L.type) + ' ' +
            fmtDate(L.startAt) + '），假單已送交秘書長審核。'
          : u.name + ' 駁回了代理請求，這張假單已作廢。' +
            (note ? '原因：' + note + '　' : '') + '請重新申請並選擇其他代理人。',
        accept ? 'info' : 'proxy-declined');
    }).then(function () {
      return writeAudit('leave.proxy', leaveId, null,
        { accept: !!accept, note: note || '', by: u.email });
    });
  });
}

/** 指定我當代理人、還在等我回覆的假單 */
function watchProxyRequests(cb) {
  var u = currentUser();
  return db.collection(COL.leave).where('proxyEmail', '==', u.email)
    .onSnapshot(function (s) {
      cb(snapList(s).filter(function (x) {
        return x.proxyStatus === 'waiting' && x.status === STATUS.PENDING;
      }).sort(byOldest));
    }, function (e) { _onError(e); });
}

function reviewLeave(leaveId, decision, adminNote) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以審核'));
  if (decision !== STATUS.APPROVED && decision !== STATUS.REJECTED)
    return Promise.reject(new Error('決議不合法'));
  var admin = currentUser();
  var ref = db.collection(COL.leave).doc(leaveId);

  return db.runTransaction(function (tx) {
    return tx.get(ref).then(function (sn) {
      if (!sn.exists) throw new Error('假單不存在');
      var L = sn.data();
      if (L.status !== STATUS.PENDING) throw new Error('這張假單已經處理過了');
      if (L.needsProxy && L.proxyStatus === 'waiting')
        throw new Error('職務代理人還沒確認，等代理人回覆後才能審核');
      var stamp = {
        status: decision, reviewedBy: admin.name, reviewedAt: serverTimestamp(),
        adminNote: adminNote || '', updatedAt: serverTimestamp()
      };
      var needs = decision === STATUS.APPROVED &&
                  ((L.annualHours || 0) > 0 || (L.compHours || 0) > 0);
      if (!needs) { tx.update(ref, withKey(stamp)); return; }

      var balRef = db.collection(COL.balances).doc(L.email);
      return tx.get(balRef).then(function (bs) {
        var B = normalizeBal(bs.exists ? bs.data() : null);
        var sa = splitAnnual(B, L.annualHours || 0);
        var sc = splitComp(B,  L.compHours   || 0);
        if ((L.annualHours || 0) > 0 && !sa.enough)
          throw new Error('特休不足：需要 ' + L.annualHours + '，剩 ' + B.annualRemaining);
        if ((L.compHours || 0) > 0 && !sc.enough)
          throw new Error('補休不足：需要 ' + L.compHours + '，剩 ' + B.compRemaining);
        stamp.annualFromCarry   = sa.fromCarry;
        stamp.annualFromCurrent = sa.fromCurrent;
        stamp.compFromCarry     = sc.fromCarry;
        stamp.compFromCurrent   = sc.fromCurrent;
        tx.update(ref, withKey(stamp));
        var nAC = roundHalf(B.annualCarry   - sa.fromCarry);
        var nAU = roundHalf(B.annualCurrent - sa.fromCurrent);
        var nCC = roundHalf(B.compCarry     - sc.fromCarry);
        var nCU = roundHalf(B.compCurrent   - sc.fromCurrent);
        tx.set(balRef, withKey({
          annualCarry: nAC, annualCurrent: nAU, annualRemaining: roundHalf(nAC + nAU),
          compCarry: nCC,   compCurrent: nCU,   compRemaining:   roundHalf(nCC + nCU),
          annualUsedYTD: roundHalf((B.annualUsedYTD || 0) + (L.annualHours || 0)),
          compUsedYTD:   roundHalf((B.compUsedYTD   || 0) + (L.compHours   || 0)),
          updatedAt: serverTimestamp()
        }), { merge: true });
      });
    });
  }).then(function () {
    writeAudit('leave.review', leaveId, null, { decision: decision, adminNote: adminNote || '' });
    return db.collection(COL.leave).doc(leaveId).get().then(function (sn) {
      if (!sn.exists) return;
      var L = sn.data();
      pushNotice(L.email,
        decision === STATUS.APPROVED ? '請假已核准' : '請假被駁回',
        leaveTypeLabel(L.type) + ' ' + L.hours + ' 小時（' + fmtDate(L.startAt) + '）' +
        (decision === STATUS.APPROVED ? ' 已核准。' : ' 沒有通過。') +
        (adminNote ? '　' + adminNote : ''), 'result');
      pushNotice('stats',
        decision === STATUS.APPROVED ? '請假已核准' : '請假被駁回',
        L.name + ' ' + fmtDate(L.startAt) +
        (fmtDate(L.startAt) !== fmtDate(L.endAt) ? ' – ' + fmtDate(L.endAt) : '') +
        ' 的請假' + (decision === STATUS.APPROVED ? '已核准。' : '被駁回。'), 'result');
    });
  });
}

function cancelLeave(leaveId, reason) {
  var u = currentUser();
  if (!u) return Promise.reject(new Error('尚未登入'));
  var ref = db.collection(COL.leave).doc(leaveId);
  return db.runTransaction(function (tx) {
    return tx.get(ref).then(function (sn) {
      if (!sn.exists) throw new Error('假單不存在');
      var L = sn.data();
      var mine = L.email === u.email;
      if (!isAdmin() && !(mine && L.status === STATUS.PENDING))
        throw new Error('沒有權限撤銷這張假單');
      if (L.status === STATUS.CANCELLED) throw new Error('已經撤銷過了');
      var stamp = {
        status: STATUS.CANCELLED, cancelledBy: u.name,
        cancelledAt: serverTimestamp(), updatedAt: serverTimestamp(),
        adminNote: reason || L.adminNote || ''
      };
      var needs = L.status === STATUS.APPROVED &&
                  ((L.annualHours || 0) > 0 || (L.compHours || 0) > 0);
      if (!needs) { tx.update(ref, withKey(stamp)); return; }
      var balRef = db.collection(COL.balances).doc(L.email);
      return tx.get(balRef).then(function (bs) {
        var B = normalizeBal(bs.exists ? bs.data() : null);
        var aC = (L.annualFromCarry   !== undefined) ? L.annualFromCarry   : 0;
        var aU = (L.annualFromCurrent !== undefined) ? L.annualFromCurrent : (L.annualHours || 0);
        var cC = (L.compFromCarry     !== undefined) ? L.compFromCarry     : 0;
        var cU = (L.compFromCurrent   !== undefined) ? L.compFromCurrent   : (L.compHours || 0);
        tx.update(ref, withKey(stamp));
        var rAC = roundHalf(B.annualCarry + aC), rAU = roundHalf(B.annualCurrent + aU);
        var rCC = roundHalf(B.compCarry   + cC), rCU = roundHalf(B.compCurrent   + cU);
        tx.set(balRef, withKey({
          annualCarry: rAC, annualCurrent: rAU, annualRemaining: roundHalf(rAC + rAU),
          compCarry: rCC,   compCurrent: rCU,   compRemaining:   roundHalf(rCC + rCU),
          annualUsedYTD: roundHalf((B.annualUsedYTD || 0) - (L.annualHours || 0)),
          compUsedYTD:   roundHalf((B.compUsedYTD   || 0) - (L.compHours   || 0)),
          updatedAt: serverTimestamp()
        }), { merge: true });
      });
    });
  }).then(function () { writeAudit('leave.cancel', leaveId, null, { reason: reason || '' }); });
}

/**
 * 修改待審中的假單（申請人自己改，不用撤銷重開）。
 * 只有 pending 而且還沒被代理人處理過的才能改。
 */
function editMyPendingLeave(leaveId, patch) {
  var u = currentUser();
  if (!u) return Promise.reject(new Error('尚未登入'));
  var ref = db.collection(COL.leave).doc(leaveId);

  return ref.get().then(function (sn) {
    if (!sn.exists) throw new Error('假單不存在');
    var L = sn.data();
    if (L.email !== u.email) throw new Error('這不是你的假單');
    if (L.status !== STATUS.PENDING) throw new Error('只有還在等審核的假單可以修改');
    if (L.needsProxy && L.proxyStatus === 'accepted')
      throw new Error('代理人已經確認過了，要修改請先撤銷再重新申請');

    var st = toDate(patch.startAt || L.startAt);
    var en = toDate(patch.endAt   || L.endAt);
    if (!(en > st)) throw new Error('結束時間必須晚於開始時間');
    var h = roundHalf(patch.hours !== undefined ? patch.hours : L.hours);
    if (!(h > 0)) throw new Error('時數必須大於 0');
    var type = patch.type || L.type;
    var def = leaveTypeDef(type);
    if (!def) throw new Error('假別不存在');

    return myLeavesForLimit(u.email).then(function (mine) {
      var bad = checkLeaveLimit(mine, type, st, h, leaveId);
      if (bad) throw new Error(bad);
      var a = def.deducts === 'annual' ? h : 0;
      var c = def.deducts === 'comp'   ? h : 0;
      return getBalance(u.email).then(function (bal) {
        if (a > 0 && !splitAnnual(bal, a).enough)
          throw new Error('特休不足，目前剩 ' + bal.annualRemaining + ' 小時');
        if (c > 0 && !splitComp(bal, c).enough)
          throw new Error('補休不足，目前剩 ' + bal.compRemaining + ' 小時');
        return ref.set({
          type: type, otherType: patch.otherType !== undefined ? patch.otherType : L.otherType,
          startAt: TS.fromDate(st), endAt: TS.fromDate(en),
          hours: h, annualHours: a, compHours: c,
          segments: splitByMonth(st, en, h),
          editedByOwner: true, editedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
    }).then(function () {
      return writeAudit('leave.editOwn', leaveId, { hours: L.hours, type: L.type },
        { hours: h, type: type });
    });
  });
}

/**
 * 已核准的假單，申請人提出撤銷申請（不是直接撤，要秘書長同意）。
 */
function requestCancel(leaveId, reason) {
  var u = currentUser();
  if (!u) return Promise.reject(new Error('尚未登入'));
  var r = String(reason || '').trim();
  if (!r) return Promise.reject(new Error('請說明為什麼要撤銷'));
  var ref = db.collection(COL.leave).doc(leaveId);
  return ref.get().then(function (sn) {
    if (!sn.exists) throw new Error('假單不存在');
    var L = sn.data();
    if (L.email !== u.email) throw new Error('這不是你的假單');
    if (L.status !== STATUS.APPROVED) throw new Error('只有已核准的假單需要申請撤銷');
    if (L.cancelRequest === 'waiting') throw new Error('已經提出過撤銷申請了');
    return ref.set({
      cancelRequest: 'waiting', cancelReason: r,
      cancelRequestedAt: serverTimestamp(), updatedAt: serverTimestamp()
    }, { merge: true });
  }).then(function () {
    return writeAudit('leave.requestCancel', leaveId, null, { reason: r });
  });
}

/** 秘書長處理撤銷申請 */
function reviewCancelRequest(leaveId, approve, note) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以處理'));
  var ref = db.collection(COL.leave).doc(leaveId);
  return ref.get().then(function (sn) {
    if (!sn.exists) throw new Error('假單不存在');
    var L = sn.data();
    if (L.cancelRequest !== 'waiting') throw new Error('這張沒有待處理的撤銷申請');
    if (!approve) {
      return setMerge(COL.leave, leaveId, {
        cancelRequest: 'rejected', cancelReviewNote: note || '',
        updatedAt: serverTimestamp()
      }).then(function () {
        return pushNotice(L.email, '撤銷申請被駁回',
          '你申請撤銷 ' + fmtDate(L.startAt) + ' 的' + leaveTypeLabel(L.type) +
          '，秘書長沒有同意。' + (note ? '原因：' + note : ''), 'info');
      });
    }
    /* 同意 → 走既有的撤銷流程，時數會自動退回 */
    return cancelLeave(leaveId, '秘書長同意撤銷：' + (L.cancelReason || ''))
      .then(function () {
        return setMerge(COL.leave, leaveId, {
          cancelRequest: 'approved', cancelReviewNote: note || ''
        });
      })
      .then(function () {
        return pushNotice(L.email, '撤銷申請已同意',
          fmtDate(L.startAt) + ' 的' + leaveTypeLabel(L.type) + ' 已撤銷，時數已退回。', 'info');
      });
  }).then(function () {
    return writeAudit('leave.reviewCancel', leaveId, null, { approve: !!approve, note: note || '' });
  });
}

/** 待處理的撤銷申請（後台用） */
function watchCancelRequests(cb) {
  return db.collection(COL.leave).where('cancelRequest', '==', 'waiting')
    .onSnapshot(function (s) { cb(snapList(s).sort(byOldest)); }, function (e) { _onError(e); });
}

/** 今天誰不在 */
function whoIsOutToday(leaves, day) {
  var d = toDate(day || new Date());
  var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var d1 = new Date(d0.getTime() + 86399000);
  return (leaves || []).filter(function (x) {
    if (x.status !== STATUS.APPROVED) return false;
    return toDate(x.startAt) <= d1 && toDate(x.endAt) >= d0;
  });
}

/* ---------- 8. 加班 ---------- */
/**
 * 加班時數規則檢查（秘書長 2026/08 說明）
 * ① 至少 1 小時，第一小時必須是整數 → 合法值為 1, 1.5, 2, 2.5 …
 * ② 工作日一天最多 4 小時（假日不限）
 * @returns null 表示合法，否則回傳錯誤訊息
 */
function validateOvertime(hours, date, sameDayHours) {
  var h = roundHalf(hours);
  if (!(h >= OT_RULES.minHours))
    return '加班至少要 ' + OT_RULES.minHours + ' 小時（第一小時以整數計）';
  var d = toDate(date);
  var weekend = !isWorkingDay(d);
  if (!weekend) {
    var total = roundHalf(h + (sameDayHours || 0));
    if (total > OT_RULES.weekdayDailyCap)
      return '工作日一天最多 ' + OT_RULES.weekdayDailyCap + ' 小時' +
        (sameDayHours ? '（這天已經有 ' + sameDayHours + ' 小時）' : '');
  }
  return null;
}

function submitOvertime(o) {
  var u = currentUser();
  if (!u) return Promise.reject(new Error('尚未登入'));
  if (!canApply()) return Promise.reject(new Error('這個帳號沒有申請權限'));
  var h = roundHalf(o.hours);
  var reason = String(o.reason || '').trim();
  if (reason.length < OT_REASON_MIN)
    return Promise.reject(new Error('加班事由至少要寫 ' + OT_REASON_MIN +
      ' 個字，目前只有 ' + reason.length + ' 個字。請具體說明處理什麼工作。'));
  var month = ym(o.date);
  return dayOvertimeHours(u.email, dateKey(o.date)).then(function (sameDay) {
    var bad = validateOvertime(h, o.date, sameDay);
    if (bad) throw new Error(bad);
    return monthlyOvertimeHours(u.email, month);
  }).then(function (used) {
    var over = used + h > MONTHLY_OT_CAP;
    return db.collection(COL.overtime).add({
      email: u.email, name: u.name, term: u.term || 1,
      date: TS.fromDate(toDate(o.date)),
      startAt: TS.fromDate(toDate(o.startAt)),
      endAt: TS.fromDate(toDate(o.endAt)),
      hours: h, bonusHours: 0, isDispatch: false, ym: month,
      dateKey: dateKey(o.date),
      isWeekend: !isWorkingDay(toDate(o.date)),
      reason: reason, overCapWarning: over,
      status: STATUS.PENDING, reviewedBy: null, reviewedAt: null, adminNote: '',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }).then(function (ref) {
      writeAudit('overtime.submit', ref.id, null, { hours: h });
      pushNotice('admin', '有新的加班申請',
        u.name + ' 申請加班 ' + h + ' 小時（' + fmtDate(o.date) + '）' +
        (over ? '　本月已超過 46 小時' : ''), 'overtime');
      pushNotice('stats', '有新的加班申請',
        u.name + ' 申請加班 ' + fmtDate(o.date), 'overtime');
      return { id: ref.id, overCapWarning: over, monthlyUsed: used + h };
    });
  });
}

/** 同一天已經送出／核准的加班時數 */
function dayOvertimeHours(email, dk) {
  return db.collection(COL.overtime).where('email', '==', normEmail(email)).get()
    .then(function (snap) {
      var sum = 0;
      snap.forEach(function (d) {
        var o = d.data();
        if ((o.dateKey || dateKey(o.date)) !== dk) return;
        if (o.status === STATUS.PENDING || o.status === STATUS.APPROVED) sum += (o.hours || 0);
      });
      return sum;
    }).catch(function () { return 0; });
}

/**
 * 審核加班。
 * @param opt.isDispatch 是否為核派加班 → 補休加倍（由秘書長決定，秘書不能自己勾）
 */
function reviewOvertime(otId, decision, adminNote, opt) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以審核'));
  opt = opt || {};
  var admin = currentUser();
  var ref = db.collection(COL.overtime).doc(otId);
  return db.runTransaction(function (tx) {
    return tx.get(ref).then(function (sn) {
      if (!sn.exists) throw new Error('加班單不存在');
      var O = sn.data();
      if (O.status !== STATUS.PENDING) throw new Error('這張加班單已經處理過了');
      var stamp = {
        status: decision, reviewedBy: admin.name, reviewedAt: serverTimestamp(),
        adminNote: adminNote || '', updatedAt: serverTimestamp()
      };
      if (decision !== STATUS.APPROVED) { tx.update(ref, withKey(stamp)); return; }
      var dispatch = !!opt.isDispatch;
      var bonus = dispatch ? roundHalf(O.hours * (OT_RULES.dispatchMultiplier - 1)) : 0;
      stamp.isDispatch = dispatch;
      stamp.bonusHours = bonus;
      var balRef = db.collection(COL.balances).doc(O.email);
      return tx.get(balRef).then(function (bs) {
        var B = normalizeBal(bs.exists ? bs.data() : null);
        var gain = roundHalf(O.hours + bonus);
        tx.update(ref, withKey(stamp));
        var nCU = roundHalf((B.compCurrent || 0) + gain);
        tx.set(balRef, withKey({
          compCurrent: nCU,
          compRemaining: roundHalf((B.compCarry || 0) + nCU),
          compEarnedYTD: roundHalf((B.compEarnedYTD || 0) + gain),
          updatedAt: serverTimestamp()
        }), { merge: true });
      });
    });
  }).then(function () {
    writeAudit('overtime.review', otId, null, { decision: decision, adminNote: adminNote || '' });
    return db.collection(COL.overtime).doc(otId).get().then(function (sn) {
      if (!sn.exists) return;
      var O = sn.data();
      pushNotice(O.email,
        decision === STATUS.APPROVED ? '加班已核准' : '加班被駁回',
        fmtDate(O.date) + ' 加班 ' + O.hours + ' 小時' +
        (decision === STATUS.APPROVED
          ? '，補休增加 ' + roundHalf(O.hours + (O.bonusHours || 0)) + ' 小時。'
          : ' 沒有通過。') + (adminNote ? '　' + adminNote : ''), 'result');
      pushNotice('stats',
        decision === STATUS.APPROVED ? '加班已核准' : '加班被駁回',
        O.name + ' ' + fmtDate(O.date) + ' 的加班' +
        (decision === STATUS.APPROVED ? '已核准。' : '被駁回。'), 'result');
    });
  });
}

function monthlyOvertimeHours(email, month) {
  return db.collection(COL.overtime).where('email', '==', normEmail(email)).get()
    .then(function (snap) {
      var sum = 0;
      snap.forEach(function (d) {
        var o = d.data();
        if (o.ym !== month) return;
        if (o.status === STATUS.PENDING || o.status === STATUS.APPROVED) sum += (o.hours || 0);
      });
      return sum;
    }).catch(function () { return 0; });
}

/* ---------- 9. 查詢（全部只用單一 where，不需要任何索引） ---------- */
function snapList(snap) {
  var out = [];
  snap.forEach(function (d) { var o = d.data(); o.id = d.id; out.push(o); });
  return out;
}
function byNewest(a, b) { return ms(b.createdAt) - ms(a.createdAt); }
function byOldest(a, b) { return ms(a.createdAt) - ms(b.createdAt); }

/** 前台只看得到「這一任」的紀錄 */
function watchMyLeaves(cb) {
  var u = currentUser();
  return db.collection(COL.leave).where('email', '==', u.email)
    .onSnapshot(function (s) {
      cb(snapList(s).filter(function (x) { return (x.term || 1) === (u.term || 1); }).sort(byNewest));
    }, function (e) { _onError(e); });
}
function watchMyOvertime(cb) {
  var u = currentUser();
  return db.collection(COL.overtime).where('email', '==', u.email)
    .onSnapshot(function (s) {
      cb(snapList(s).filter(function (x) { return (x.term || 1) === (u.term || 1); }).sort(byNewest));
    }, function (e) { _onError(e); });
}
function watchPendingLeaves(cb) {
  return db.collection(COL.leave).where('status', '==', STATUS.PENDING)
    .onSnapshot(function (s) { cb(snapList(s).sort(byOldest)); }, function (e) { _onError(e); });
}
function watchPendingOvertime(cb) {
  return db.collection(COL.overtime).where('status', '==', STATUS.PENDING)
    .onSnapshot(function (s) { cb(snapList(s).sort(byOldest)); }, function (e) { _onError(e); });
}
/** 後台全紀錄，可依信箱、期間、類型、狀態篩選 */
function fetchAllRecords(filter) {
  filter = filter || {};
  var jobs = [];
  if (filter.kind !== 'overtime') jobs.push(db.collection(COL.leave).get().then(snapList));
  else jobs.push(Promise.resolve([]));
  if (filter.kind !== 'leave') jobs.push(db.collection(COL.overtime).get().then(snapList));
  else jobs.push(Promise.resolve([]));

  return Promise.all(jobs).then(function (r) {
    var list = r[0].map(function (x) { x.kind = 'leave'; return x; })
      .concat(r[1].map(function (x) { x.kind = 'overtime'; return x; }));
    return list.filter(function (x) {
      if (filter.email && x.email !== filter.email) return false;
      if (filter.status && x.status !== filter.status) return false;
      var when = toDate(x.kind === 'leave' ? x.startAt : x.date);
      if (filter.from && when < toDate(filter.from)) return false;
      if (filter.to) { var t = toDate(filter.to); t.setHours(23,59,59,999); if (when > t) return false; }
      return true;
    }).sort(byNewest);
  });
}

/** 後台刪除單筆紀錄。已核准的會先把時數還回去，不然帳會對不起來。 */
function deleteRecord(kind, id) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以刪除紀錄'));
  var col = kind === 'overtime' ? COL.overtime : COL.leave;
  var ref = db.collection(col).doc(id);
  return ref.get().then(function (sn) {
    if (!sn.exists) throw new Error('這筆紀錄不存在');
    var R = sn.data();
    if (R.status !== STATUS.APPROVED) return null;   // 沒核准過就沒動到時數
    return getBalance(R.email).then(function (B) {
      if (kind === 'overtime') {
        var gain = roundHalf(R.hours + (R.bonusHours || 0));
        var nCU = roundHalf(Math.max(0, (B.compCurrent || 0) - gain));
        return setMerge(COL.balances, R.email, {
          compCurrent: nCU,
          compRemaining: roundHalf((B.compCarry || 0) + nCU),
          compEarnedYTD: roundHalf(Math.max(0, (B.compEarnedYTD || 0) - gain)),
          updatedAt: serverTimestamp()
        });
      }
      var aC = (R.annualFromCarry   !== undefined) ? R.annualFromCarry   : 0;
      var aU = (R.annualFromCurrent !== undefined) ? R.annualFromCurrent : (R.annualHours || 0);
      var cC = (R.compFromCarry     !== undefined) ? R.compFromCarry     : 0;
      var cU = (R.compFromCurrent   !== undefined) ? R.compFromCurrent   : (R.compHours || 0);
      var rAC = roundHalf(B.annualCarry + aC), rAU = roundHalf(B.annualCurrent + aU);
      var rCC = roundHalf(B.compCarry   + cC), rCU = roundHalf(B.compCurrent   + cU);
      return setMerge(COL.balances, R.email, {
        annualCarry: rAC, annualCurrent: rAU, annualRemaining: roundHalf(rAC + rAU),
        compCarry: rCC,   compCurrent: rCU,   compRemaining:   roundHalf(rCC + rCU),
        annualUsedYTD: roundHalf(Math.max(0, (B.annualUsedYTD || 0) - (R.annualHours || 0))),
        compUsedYTD:   roundHalf(Math.max(0, (B.compUsedYTD   || 0) - (R.compHours   || 0))),
        updatedAt: serverTimestamp()
      });
    }).then(function () { return R; });
  }).then(function (R) {
    /* 留一份副本，匯出時才知道哪些被刪過 */
    return ref.get().then(function (sn2) {
      var data = sn2.exists ? sn2.data() : (R || {});
      data.originalId = id;
      data.recordKind = kind;
      data.deletedAt = serverTimestamp();
      data.deletedBy = currentUser().name;
      return db.collection(COL.deleted).add(stamp(data));
    }).then(function () {
      return writeAudit('record.delete', id, R || null, { kind: kind });
    });
  }).then(function () { return ref.delete(); });
}

/** 已刪除紀錄的副本 */
function listDeleted() {
  return db.collection(COL.deleted).get().then(function (s) {
    return snapList(s).sort(function (a, b) { return ms(b.deletedAt) - ms(a.deletedAt); });
  }).catch(function () { return []; });
}

/**
 * 修改一筆紀錄。時數或狀態變動時會自動把餘額調整到正確值。
 * 做法：先把舊的影響整個還原，再照新的重新扣一次，這樣不會算錯。
 */
function editRecord(kind, id, patch) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以修改紀錄'));
  var col = kind === 'overtime' ? COL.overtime : COL.leave;
  var ref = db.collection(col).doc(id);

  return ref.get().then(function (sn) {
    if (!sn.exists) throw new Error('這筆紀錄不存在');
    var O = sn.data();                       // 舊的
    var N = Object.assign({}, O, patch);     // 新的

    /* 重新計算衍生欄位 */
    if (kind === 'leave') {
      var st = toDate(N.startAt), en = toDate(N.endAt);
      if (!(en > st)) throw new Error('結束時間必須晚於開始時間');
      N.hours = roundHalf(N.hours);
      if (!(N.hours > 0)) throw new Error('時數必須大於 0');
      var def = leaveTypeDef(N.type);
      if (!def) throw new Error('假別不存在');
      N.annualHours = def.deducts === 'annual' ? N.hours : 0;
      N.compHours   = def.deducts === 'comp'   ? N.hours : 0;
      N.segments = splitByMonth(st, en, N.hours);
      N.startAt = TS.fromDate(st);
      N.endAt   = TS.fromDate(en);
    } else {
      N.hours = roundHalf(N.hours);
      if (!(N.hours > 0)) throw new Error('時數必須大於 0');
      var d = toDate(N.date);
      N.date = TS.fromDate(d);
      N.ym = ym(d);
      N.dateKey = dateKey(d);
      N.isWeekend = !isWorkingDay(d);
      N.bonusHours = N.isDispatch
        ? roundHalf(N.hours * (OT_RULES.dispatchMultiplier - 1))
        : 0;
    }
    N.updatedAt = serverTimestamp();
    N.editedBy = currentUser().name;
    N.editedAt = serverTimestamp();

    return getBalance(O.email).then(function (B) {
      var b = normalizeBal(B);

      /* ① 先還原舊紀錄的影響 */
      if (O.status === STATUS.APPROVED) {
        if (kind === 'overtime') {
          var oldGain = roundHalf((O.hours || 0) + (O.bonusHours || 0));
          b.compCurrent = roundHalf(b.compCurrent - oldGain);
          b.compEarnedYTD = roundHalf((b.compEarnedYTD || 0) - oldGain);
        } else {
          b.annualCarry   = roundHalf(b.annualCarry   + (O.annualFromCarry   || 0));
          b.annualCurrent = roundHalf(b.annualCurrent +
            (O.annualFromCurrent !== undefined ? O.annualFromCurrent : (O.annualHours || 0)));
          b.compCarry     = roundHalf(b.compCarry     + (O.compFromCarry     || 0));
          b.compCurrent   = roundHalf(b.compCurrent   +
            (O.compFromCurrent   !== undefined ? O.compFromCurrent   : (O.compHours   || 0)));
          b.annualUsedYTD = roundHalf((b.annualUsedYTD || 0) - (O.annualHours || 0));
          b.compUsedYTD   = roundHalf((b.compUsedYTD   || 0) - (O.compHours   || 0));
        }
      }

      /* ② 再套用新紀錄的影響 */
      if (N.status === STATUS.APPROVED) {
        if (kind === 'overtime') {
          var gain = roundHalf(N.hours + (N.bonusHours || 0));
          b.compCurrent = roundHalf(b.compCurrent + gain);
          b.compEarnedYTD = roundHalf((b.compEarnedYTD || 0) + gain);
        } else {
          var sa = splitPool(b, N.annualHours || 0, 'annual');
          var sc = splitPool(b, N.compHours   || 0, 'comp');
          if ((N.annualHours || 0) > 0 && !sa.enough)
            throw new Error('特休不足：改成這樣會超支，目前可用 ' +
              roundHalf(b.annualCarry + b.annualCurrent) + ' 小時');
          if ((N.compHours || 0) > 0 && !sc.enough)
            throw new Error('補休不足：改成這樣會超支，目前可用 ' +
              roundHalf(b.compCarry + b.compCurrent) + ' 小時');
          N.annualFromCarry   = sa.fromCarry;
          N.annualFromCurrent = sa.fromCurrent;
          N.compFromCarry     = sc.fromCarry;
          N.compFromCurrent   = sc.fromCurrent;
          b.annualCarry   = roundHalf(b.annualCarry   - sa.fromCarry);
          b.annualCurrent = roundHalf(b.annualCurrent - sa.fromCurrent);
          b.compCarry     = roundHalf(b.compCarry     - sc.fromCarry);
          b.compCurrent   = roundHalf(b.compCurrent   - sc.fromCurrent);
          b.annualUsedYTD = roundHalf((b.annualUsedYTD || 0) + (N.annualHours || 0));
          b.compUsedYTD   = roundHalf((b.compUsedYTD   || 0) + (N.compHours   || 0));
        }
      } else {
        N.annualFromCarry = 0; N.annualFromCurrent = 0;
        N.compFromCarry = 0;   N.compFromCurrent = 0;
      }

      /* 餘額不該變成負的 */
      ['annualCarry','annualCurrent','compCarry','compCurrent',
       'annualUsedYTD','compUsedYTD','compEarnedYTD'].forEach(function (k) {
        if (b[k] < 0) b[k] = 0;
      });

      return setMerge(COL.balances, O.email, {
        annualCarry: b.annualCarry, annualCurrent: b.annualCurrent,
        annualRemaining: roundHalf(b.annualCarry + b.annualCurrent),
        compCarry: b.compCarry, compCurrent: b.compCurrent,
        compRemaining: roundHalf(b.compCarry + b.compCurrent),
        annualUsedYTD: b.annualUsedYTD, compUsedYTD: b.compUsedYTD,
        compEarnedYTD: b.compEarnedYTD, updatedAt: serverTimestamp()
      }).then(function () { return ref.set(stamp(N)); });
    }).then(function () {
      return writeAudit('record.edit', id, O, patch);
    });
  });
}

/* ---------- 10. 本月時數 ---------- */
function monthLeaveHours(leaves, month) {
  var sum = 0;
  leaves.forEach(function (l) {
    if (l.status !== STATUS.APPROVED) return;
    var segs = (l.segments && l.segments.length) ? l.segments
             : [{ ym: ym(l.startAt), hours: l.hours }];
    segs.forEach(function (sg) { if (sg.ym === month) sum = roundHalf(sum + sg.hours); });
  });
  return sum;
}
function monthOvertimeHours(ots, month) {
  var sum = 0;
  ots.forEach(function (o) {
    if (o.status !== STATUS.APPROVED) return;
    if ((o.ym || ym(o.date)) !== month) return;
    sum = roundHalf(sum + o.hours + (o.bonusHours || 0));
  });
  return sum;
}

/* ---------- 手機推播 ----------
   流程：手機訂閱 → 訂閱資料存進 Firestore →
        有事發生時呼叫 Cloudflare Worker → Worker 簽章後送到 Apple/Google → 手機跳通知
   iOS 限制：必須「加入主畫面」後從圖示開啟，而且要 iOS 16.4 以上。   */
var PUSH_ENDPOINT = 'https://tps-push.chenfdhs453.workers.dev';
var VAPID_PUBLIC_KEY = 'BL3w2npcbn59QATyEsVyimcceYaPTzjgew85L5K7AWMHOHCl06QCgz6E3oZITpGvGNl8TPdwFh0fGbzG1F1_0ZM';

/** 這台裝置能不能收推播，回傳原因才能告訴使用者要怎麼做 */
function pushSupport() {
  var hasApi = ('serviceWorker' in navigator)
            && (typeof PushManager !== 'undefined')
            && (typeof Notification !== 'undefined');
  var standalone = (navigator.standalone === true)
            || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!hasApi)            return { ok:false, why:'unsupported' };
  if (ios && !standalone) return { ok:false, why:'needHomeScreen' };
  return { ok:true };
}

function b64uToU8(s) {
  var pad = '='.repeat((4 - s.length % 4) % 4);
  var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * 開啟推播。一定要從使用者的點擊事件裡呼叫，否則 iOS 會靜默失敗。
 * @param scope 收件對象：秘書填自己的信箱、後台填 'admin'、檢視台填 'stats'
 */
function subscribePush(scope, label) {
  var sup = pushSupport();
  if (!sup.ok) {
    return Promise.reject(new Error(sup.why === 'needHomeScreen'
      ? '請先用 Safari 的「分享 → 加入主畫面」，再從主畫面的圖示打開這個網站，才能開啟通知。'
      : '這個瀏覽器不支援通知功能。'));
  }
  return navigator.serviceWorker.register('sw.js', { scope: './' })
    .then(function () { return navigator.serviceWorker.ready; })
    .then(function (reg) {
      return Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error(perm === 'denied'
          ? '通知被拒絕了。要重新開啟請到「設定 → 通知」找這個 App 打開。'
          : '沒有取得通知權限。');
        return reg.pushManager.getSubscription().then(function (sub) {
          return sub || reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: b64uToU8(VAPID_PUBLIC_KEY)
          });
        });
      });
    })
    .then(function (sub) {
      var j = sub.toJSON();
      var id = sha256(j.endpoint).slice(0, 24);     // 同一台裝置不會重複建立
      return setMerge(COL.push, id, {
        scope: normEmail(scope), endpoint: j.endpoint, keys: j.keys,
        label: label || '', at: serverTimestamp()
      }).then(function () { return id; });
    });
}

/** 關閉這台裝置的推播 */
function unsubscribePush() {
  if (!('serviceWorker' in navigator)) return Promise.resolve();
  return navigator.serviceWorker.ready.then(function (reg) {
    return reg.pushManager.getSubscription();
  }).then(function (sub) {
    if (!sub) return null;
    var id = sha256(sub.toJSON().endpoint).slice(0, 24);
    return db.collection(COL.push).doc(id).delete()
      .then(function () { return sub.unsubscribe(); });
  }).catch(function (e) { console.warn('[TPS] 取消訂閱', e); });
}

/** 這台裝置目前有沒有訂閱 */
function pushStatus() {
  if (!('serviceWorker' in navigator)) return Promise.resolve({ on:false });
  return navigator.serviceWorker.getRegistration().then(function (reg) {
    if (!reg) return { on:false };
    return reg.pushManager.getSubscription().then(function (sub) {
      return { on: !!sub };
    });
  }).catch(function () { return { on:false }; });
}

function getSubs(scope) {
  return db.collection(COL.push).where('scope', '==', normEmail(scope)).get()
    .then(function (s) {
      return snapList(s).filter(function (x) { return x.endpoint && x.keys; });
    }).catch(function () { return []; });
}

/**
 * 送推播。絕不 throw —— 推播失敗不可以害到請假流程失敗。
 */
function sendPush(scope, title, body, url, tag) {
  return getSubs(scope).then(function (subs) {
    if (!subs.length) return { ok:false, skipped:true };
    return fetch(PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriptions: subs.map(function (s) { return { endpoint:s.endpoint, keys:s.keys }; }),
        title: title, body: body, url: url || 'index.html', tag: tag || 'tps'
      })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        /* 對方已取消訂閱的，順手清掉 */
        (res.results || []).forEach(function (x) {
          if (!x.gone) return;
          var dead = subs.filter(function (s) { return s.endpoint === x.endpoint; })[0];
          if (dead) db.collection(COL.push).doc(dead.id).delete().catch(function(){});
        });
        return res;
      });
  }).catch(function (e) {
    console.warn('[TPS] 推播失敗（不影響主流程）', e);
    return { ok:false, error:String(e) };
  });
}

/* ---------- 站內通知 ---------- */
function pushNotice(email, title, body, kind) {
  var em = normEmail(email);
  /* 站內通知一定要寫進去；手機推播是加分的，失敗不影響 */
  return db.collection(COL.notices).add({
    email: em, title: title, body: body || '',
    kind: kind || 'info', read: false, createdAt: serverTimestamp()
  }).then(function () {
    var url = (em === 'admin') ? 'admin.html' : (em === 'stats' ? 'stats.html' : 'index.html');
    sendPush(em, title, body || '', url, kind || 'tps');
  }).catch(function (e) { console.warn('[TPS] 通知寫入失敗', e); });
}
function watchMyNotices(cb) {
  var u = currentUser();
  return db.collection(COL.notices).where('email', '==', u.email)
    .onSnapshot(function (s) { cb(snapList(s).sort(byNewest)); }, function (e) { _onError(e); });
}
function markNoticeRead(id) {
  return setMerge(COL.notices, id, { read: true, readAt: serverTimestamp() });
}
function markAllNoticesRead(list) {
  return Promise.all((list || []).filter(function (n) { return !n.read; })
    .map(function (n) { return markNoticeRead(n.id); }));
}

/* ---------- 薪資 ---------- */
/** 這個月有幾個上班日、到今天為止過了幾天（依行事曆，補班日算上班） */
function workdaysOfMonth(y, m, until) {
  var days = new Date(y, m + 1, 0).getDate(), total = 0, passed = 0;
  var stop = until ? toDate(until) : null;
  for (var d = 1; d <= days; d++) {
    var dt = new Date(y, m, d);
    if (!isWorkingDay(dt)) continue;
    total++;
    if (stop && dt <= stop) passed++;
  }
  return { total: total, passed: passed };
}

/**
 * 算某人某個月的薪水。
 * 底薪固定 = 時薪 × 7 × 23（不隨當月上班日變動，依秘書長說明）
 * 事假扣全薪；病假一年 210 小時內扣半薪、超過扣全薪。
 */
function computeMonthSalary(email, year, month, allLeaves, account) {
  var em = normEmail(email);
  var rate = (account && account.hourlyRate) || SALARY.defaultRate;
  var base = roundHalf(rate * SALARY.hoursPerDay * SALARY.daysPerMonth);
  var mKey = year + '-' + pad(month + 1);

  /* 這個月各假別用了幾小時（只算已核准，跨月依 segments） */
  var byType = {}, mine = [];
  (allLeaves || []).forEach(function (x) {
    if (x.email !== em || x.status !== STATUS.APPROVED) return;
    mine.push(x);
    var segs = (x.segments && x.segments.length) ? x.segments
             : [{ ym: ym(x.startAt), hours: x.hours }];
    segs.forEach(function (sg) {
      if (sg.ym !== mKey) return;
      byType[x.type] = roundHalf((byType[x.type] || 0) + sg.hours);
    });
  });

  /* 病假要看整年累計，才知道哪些落在半薪、哪些超過 210 小時 */
  var sickBefore = 0;
  mine.forEach(function (x) {
    if (x.type !== 'sick') return;
    var segs = (x.segments && x.segments.length) ? x.segments
             : [{ ym: ym(x.startAt), hours: x.hours }];
    segs.forEach(function (sg) {
      if (String(sg.ym).slice(0,4) !== String(year)) return;
      if (sg.ym < mKey) sickBefore = roundHalf(sickBefore + sg.hours);
    });
  });

  var sickThis = byType.sick || 0;
  var cap = SALARY.sickHalfPayCapHours;
  var halfHours = Math.max(0, Math.min(sickThis, cap - sickBefore));
  var fullHours = roundHalf(sickThis - halfHours);

  var personal = byType.personal || 0;
  var deductPersonal = roundHalf(personal * rate);
  var deductSickHalf = roundHalf(halfHours * rate * 0.5);
  var deductSickFull = roundHalf(fullHours * rate);
  var deduct = roundHalf(deductPersonal + deductSickHalf + deductSickFull);

  /* 到今天為止已經做了幾天（跨月時只算本月） */
  var now = new Date();
  var isThisMonth = (now.getFullYear() === year && now.getMonth() === month);
  var wd = workdaysOfMonth(year, month, isThisMonth ? now : null);
  var ratio = isThisMonth ? (wd.total ? wd.passed / wd.total : 0) : 1;

  return {
    email: em,
    name: account ? account.name : em,
    year: year, month: month + 1,
    rate: rate,
    baseSalary: base,
    workdays: wd.total,
    workdaysPassed: isThisMonth ? wd.passed : wd.total,
    hours: {
      personal: personal, sick: sickThis,
      annual: byType.annual || 0, comp: byType.comp || 0,
      period: byType.period || 0, family: byType.family || 0,
      other: byType.other || 0
    },
    sickHalfHours: halfHours,
    sickFullHours: fullHours,
    sickYearBefore: sickBefore,
    deductPersonal: deductPersonal,
    deductSickHalf: deductSickHalf,
    deductSickFull: deductSickFull,
    deductTotal: deduct,
    /* 到今天為止累積（照已過的上班日比例，再扣掉已發生的扣款） */
    accruedNow: roundHalf(Math.max(0, base * ratio - deduct)),
    /* 從現在起都不再請假的話，月底可領 */
    ifNoMoreLeave: roundHalf(Math.max(0, base - deduct)),
    /* 這個月最後實領（整月結算） */
    finalPay: roundHalf(Math.max(0, base - deduct))
  };
}

/** 一次算全部人 */
function computeAllSalary(year, month) {
  return Promise.all([
    listAccounts(),
    db.collection(COL.leave).get().then(snapList)
  ]).then(function (r) {
    var accs = r[0], leaves = r[1];
    return accs.map(function (a) {
      return computeMonthSalary(a.email, year, month, leaves, a);
    });
  });
}

/* ---------- 系統設定（stats 密碼） ---------- */
function getConfig(key) {
  return db.collection(COL.config).doc(key).get().then(function (s) {
    return s.exists ? s.data() : null;
  }).catch(function () { return null; });
}
/** stats 第一層密碼，沒設定過就用預設的 physics */
function getStatsPassword() {
  return getConfig('stats').then(function (c) {
    return { pw: (c && c.pw) || STATS_DEFAULT_PW, epoch: (c && c.epoch) || 0 };
  });
}
/**
 * 改 stats 密碼。改完 epoch +1，
 * 所有裝置的通知會被強制關閉，要重新輸入新密碼才會再開。
 */
function setStatsPassword(newPw) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以修改'));
  var p = String(newPw || '').trim();
  if (p.length < 4) return Promise.reject(new Error('密碼至少 4 個字元'));
  return getStatsPassword().then(function (c) {
    return setMerge(COL.config, 'stats', {
      pw: p, epoch: (c.epoch || 0) + 1, changedAt: serverTimestamp()
    }).then(function () {
      /* 密碼換了就要真的把所有檢視者的推播訂閱刪掉，
         不然畫面顯示「已關閉」但手機還是會繼續收到。 */
      return getSubs('stats').then(function (subs) {
        return Promise.all(subs.map(function (x) {
          return db.collection(COL.push).doc(x.id).delete().catch(function(){});
        })).then(function () { return subs.length; });
      });
    }).then(function (removed) {
      return writeAudit('config.statsPw', 'stats', { epoch: c.epoch },
        { epoch: (c.epoch||0)+1, removedSubs: removed })
        .then(function () { return removed; });
    }).then(function (removed) {
      return { epoch: (c.epoch || 0) + 1, removedSubs: removed };
    });
  });
}

/* ---------- 11. 稽核 ---------- */
function writeAudit(action, targetId, before, after) {
  var u = currentUser();
  if (!u) return Promise.resolve();
  return db.collection(COL.audit).add({
    actor: u.email, actorName: u.name, action: action, targetId: targetId,
    before: before || null, after: after || null, at: serverTimestamp()
  }).catch(function (e) { console.warn('[TPS] audit 寫入失敗（不影響主流程）', e); });
}
function fetchAudit(n) {
  return db.collection(COL.audit).get().then(function (s) {
    return snapList(s).sort(function (a, b) { return ms(b.at) - ms(a.at); }).slice(0, n || 200);
  });
}

/* ---------- 12. 小工具 ---------- */
function el(sel, root) { return (root || document).querySelector(sel); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
function toast(msg, type) {
  var t = document.createElement('div');
  t.className = 'toast toast--' + (type || 'info');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function () { t.classList.add('is-in'); });
  setTimeout(function () {
    t.classList.remove('is-in');
    setTimeout(function () { t.remove(); }, 300);
  }, 3000);
}

console.info('[TPS] shared.js v' + SHARED_VERSION + ' loaded');

return {
  SHARED_VERSION: SHARED_VERSION, db: db, serverTimestamp: serverTimestamp, Timestamp: TS,
  HOURS_PER_DAY: HOURS_PER_DAY, MONTHLY_OT_CAP: MONTHLY_OT_CAP,
  DEFAULT_PW: DEFAULT_PW, ADMIN_PASSWORD: ADMIN_PASSWORD, STATS_DEFAULT_PW: STATS_DEFAULT_PW,
  LEAVE_TYPES: LEAVE_TYPES, STATUS: STATUS, STATUS_LABEL: STATUS_LABEL, COL: COL,
  leaveTypeLabel: leaveTypeLabel, leaveTypeDef: leaveTypeDef,
  toDate: toDate, ym: ym, fmtDate: fmtDate, fmtTime: fmtTime,
  fmtDateTime: fmtDateTime, fmtStamp: fmtStamp, roundHalf: roundHalf,
  estimateHours: estimateHours, splitByMonth: splitByMonth,
  annualLeaveDays: annualLeaveDays, annualLeaveHours: annualLeaveHours,
  seniority: seniority, nextUpgrade: nextUpgrade,
  login: login, logout: logout, restoreSession: restoreSession,
  currentUser: currentUser, isAdmin: isAdmin, canApply: canApply,
  changePassword: changePassword, adminLogin: adminLogin, adminLogout: adminLogout,
  loadAdminPassword: loadAdminPassword, currentAdminPassword: currentAdminPassword,
  setAdminPassword: setAdminPassword,
  listAccounts: listAccounts, getAccount: getAccount, upsertAccount: upsertAccount,
  resetPassword: resetPassword, handoverAccount: handoverAccount, setMerge: setMerge,
  getBalance: getBalance, watchBalance: watchBalance, normalizeBal: normalizeBal,
  splitAnnual: splitAnnual, splitComp: splitComp, splitPool: splitPool,
  checkCarryExpiry: checkCarryExpiry, checkAllExpiry: checkAllExpiry,
  listSettlements: listSettlements, markSettlementPaid: markSettlementPaid,
  grantAnnual: grantAnnual, autoGrantIfDue: autoGrantIfDue, autoGrantAll: autoGrantAll,
  OT_RULES: OT_RULES, validateOvertime: validateOvertime,
  loadCalendar: loadCalendar, calendarReady: calendarReady, dayType: dayType,
  isWorkingDay: isWorkingDay, listCalendar: listCalendar,
  setCalendarDay: setCalendarDay, deleteCalendarDay: deleteCalendarDay, dateKey: dateKey,
  pushNotice: pushNotice, watchMyNotices: watchMyNotices,
  pushSupport: pushSupport, subscribePush: subscribePush,
  unsubscribePush: unsubscribePush, pushStatus: pushStatus,
  sendPush: sendPush, getSubs: getSubs, PUSH_ENDPOINT: PUSH_ENDPOINT,
  markNoticeRead: markNoticeRead, markAllNoticesRead: markAllNoticesRead,
  dayOvertimeHours: dayOvertimeHours,
  submitLeave: submitLeave, reviewLeave: reviewLeave, cancelLeave: cancelLeave,
  checkLeaveLimit: checkLeaveLimit, myLeavesForLimit: myLeavesForLimit,
  proxyCandidates: proxyCandidates, respondProxy: respondProxy,
  editMyPendingLeave: editMyPendingLeave, requestCancel: requestCancel,
  reviewCancelRequest: reviewCancelRequest, watchCancelRequests: watchCancelRequests,
  whoIsOutToday: whoIsOutToday,
  watchProxyRequests: watchProxyRequests,
  LEAVE_LIMITS: LEAVE_LIMITS, SALARY: SALARY, OT_REASON_MIN: OT_REASON_MIN,
  submitOvertime: submitOvertime, reviewOvertime: reviewOvertime,
  watchMyLeaves: watchMyLeaves, watchMyOvertime: watchMyOvertime,
  watchPendingLeaves: watchPendingLeaves, watchPendingOvertime: watchPendingOvertime,
  fetchAllRecords: fetchAllRecords, fetchAudit: fetchAudit,
  deleteRecord: deleteRecord, editRecord: editRecord, listDeleted: listDeleted,
  computeMonthSalary: computeMonthSalary, computeAllSalary: computeAllSalary,
  workdaysOfMonth: workdaysOfMonth,
  getConfig: getConfig, getStatsPassword: getStatsPassword, setStatsPassword: setStatsPassword,
  monthLeaveHours: monthLeaveHours, monthOvertimeHours: monthOvertimeHours,
  writeAudit: writeAudit, setErrorHandler: setErrorHandler,
  _sha256: sha256, _hashPw: hashPw, setAdminKey: setAdminKey,
  el: el, esc: esc, toast: toast
};
})();
