/* ============================================================
 *  TPS 行政室請假加班系統  ——  shared.js
 *  非 module 寫法：載入後掛在 window.TPS，可直接用 file:// 開
 *  改這支記得 bump SHARED_VERSION 並同步各 HTML 的 ?v=
 *  依賴：firebase-app-compat / auth-compat / firestore-compat
 * ============================================================ */
window.TPS = (function () {
'use strict';

var SHARED_VERSION = '4.0.0';

/* ---------- 0. Firebase ---------- */
var firebaseConfig = {
  apiKey:            'AIzaSyDI33EUxx1ZEqVdiLFMuNID4m7843gfQf8',
  authDomain:        'physics-b4c40.firebaseapp.com',
  projectId:         'physics-b4c40',
  storageBucket:     'physics-b4c40.firebasestorage.app',
  messagingSenderId: '494615768654',
  appId:             '1:494615768654:web:8d2e50ad3e32e97a199d1f',
  measurementId:     'G-HLXZNZ7WMJ'
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();

/* ---------- SHA-256（純 JS，不依賴瀏覽器的加密 API，離線也能跑） ---------- */
var sha256 = (function () {
  var K = [], H0 = [], p = 2, i = 0, j, ok;
  function frac(x, n) { return Math.floor((x - Math.floor(x)) * Math.pow(2, n)); }
  while (i < 64) {
    ok = true;
    for (j = 2; j * j <= p; j++) if (p % j === 0) { ok = false; break; }
    if (ok) { if (i < 8) H0[i] = frac(Math.pow(p, 1 / 2), 32); K[i] = frac(Math.pow(p, 1 / 3), 32); i++; }
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
    for (k = 7; k >= 0; k--) bytes.push((k < 4 ? Math.floor(len / Math.pow(2, k * 8)) : 0) & 255);

    var H = H0.slice(), w = new Array(64), t;
    for (var b = 0; b < bytes.length; b += 64) {
      for (t = 0; t < 16; t++)
        w[t] = (bytes[b+t*4]<<24) | (bytes[b+t*4+1]<<16) | (bytes[b+t*4+2]<<8) | bytes[b+t*4+3];
      for (t = 16; t < 64; t++) {
        var s0 = rr(w[t-15],7) ^ rr(w[t-15],18) ^ (w[t-15] >>> 3);
        var s1 = rr(w[t-2],17) ^ rr(w[t-2],19) ^ (w[t-2] >>> 10);
        w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
      }
      var a=H[0],bb=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22);
        var mj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + mj) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c; c=bb; bb=a; a=(t1+t2)|0;
      }
      H[0]=(H[0]+a)|0; H[1]=(H[1]+bb)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  };
})();
var FV   = firebase.firestore.FieldValue;
var TS   = firebase.firestore.Timestamp;
var serverTimestamp = function () { return FV.serverTimestamp(); };

/* ---------- 1. 常數 ---------- */
var HOURS_PER_DAY  = 7;
var MONTHLY_OT_CAP = 46;

var ROLES = { STAFF:'staff', VIEWER:'viewer', ADMIN:'admin' };
var ROLE_LABEL = { staff:'秘書', viewer:'檢視者', admin:'秘書長' };
var ADMIN_PASSWORD = 'asper0423';
var VIEW_PASSWORD  = 'physics2026';

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
  users:'users', leave:'leaveRequests', overtime:'overtimeRequests',
  staff:'staff', balances:'balances', audit:'auditLog', push:'pushSubscriptions'
};

function leaveTypeLabel(id) {
  for (var i = 0; i < LEAVE_TYPES.length; i++)
    if (LEAVE_TYPES[i].id === id) return LEAVE_TYPES[i].label;
  return id;
}

/* ---------- 2. 日期 / 時數 ---------- */
function toDate(v) {
  if (!v) return new Date(NaN);
  if (v.toDate) return v.toDate();
  return (v instanceof Date) ? v : new Date(v);
}
function pad(n) { return String(n).padStart(2, '0'); }
function ym(d) { var x = toDate(d); return x.getFullYear() + '-' + pad(x.getMonth() + 1); }
function fmtDate(d) { var x = toDate(d); return x.getFullYear() + '/' + (x.getMonth() + 1) + '/' + x.getDate(); }
function fmtDateTime(d) { var x = toDate(d); return fmtDate(x) + ' ' + pad(x.getHours()) + ':' + pad(x.getMinutes()); }
function roundHalf(n) { return Math.round(Number(n) * 2) / 2; }
function isWorkday(d) { var w = d.getDay(); return w >= 1 && w <= 5; }

/** 跨月假單依工作日比例拆成每月時數 */
function splitByMonth(startAt, endAt, totalHours) {
  var s = toDate(startAt), e = toDate(endAt), total = roundHalf(totalHours);
  if (!(total > 0)) return [];
  var perMonth = {}, keys = [], workdays = 0;
  var cur  = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  var last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  while (cur <= last) {
    if (isWorkday(cur)) {
      var k = ym(cur);
      if (!perMonth[k]) { perMonth[k] = 0; keys.push(k); }
      perMonth[k]++; workdays++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (workdays === 0 || keys.length <= 1) return [{ ym: ym(s), hours: total }];
  keys.sort();
  var out = [], used = 0;
  for (var i = 0; i < keys.length; i++) {
    var h = (i === keys.length - 1)
      ? roundHalf(total - used)
      : roundHalf(total * perMonth[keys[i]] / workdays);
    if (i !== keys.length - 1) used += h;
    if (h > 0) out.push({ ym: keys[i], hours: h });
  }
  return out;
}

/** 勞基法 §38 特休日數 */
function annualLeaveDays(hireDate, atDate) {
  var h = toDate(hireDate), a = toDate(atDate || new Date());
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

/* ---------- 3. 帳號（ID + 密碼，我們自己保管） ----------
   users/{loginId}  帳號：密碼加密後存這裡
   staff/{sid}      名單：姓名、到職日、在職與否，時數與歷史都綁在 sid 上
   帳號刪掉不影響名單與歷史，這樣離職的人資料還在。
------------------------------------------------------------ */
var SALT = 'tps.ps-taiwan.2026';
var SESSION_KEY = 'tps.session';
var _currentUser = null;

function hashPw(pw) { return sha256(SALT + '|' + String(pw)); }
function currentUser() { return _currentUser; }
function isAdmin()  { return !!_currentUser && _currentUser.role === ROLES.ADMIN; }
function isStaff()  { return !!_currentUser && _currentUser.role === ROLES.STAFF; }
function canApply() { return isStaff() || isAdmin(); }

function saveSession(loginId) {
  try { localStorage.setItem(SESSION_KEY, loginId); } catch (e) {}
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}
function readSession() {
  try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
}

/** 把帳號 + 名單 + 在職狀態組成登入後的使用者資料 */
function buildUser(loginId, acc) {
  var u = {
    loginId: loginId, sid: acc.sid || null, name: acc.name || '',
    role: acc.role || ROLES.STAFF, needsName: !acc.sid
  };
  if (!u.sid) { _currentUser = u; return Promise.resolve(u); }
  return db.collection(COL.staff).doc(u.sid).get().then(function (sn) {
    var st = sn.exists ? sn.data() : null;
    if (st) {
      u.name = st.name || u.name;
      u.hireDate = st.hireDate || null;
      u.active = st.active !== false;
    } else u.active = true;
    _currentUser = u;
    return u;
  });
}

/**
 * 一個畫面搞定：ID 沒人用過就直接建立並綁定，用過就當一般登入。
 * @returns Promise<{ isNew:boolean, user:object }>
 */
function loginOrRegister(id, password) {
  var loginId = String(id).trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,20}$/.test(loginId))
    return Promise.reject(new Error('ID 只能用英文、數字、. _ -，長度 2–20 個字元'));
  if (String(password).length < 4)
    return Promise.reject(new Error('密碼至少 4 個字元'));

  var ref = db.collection(COL.users).doc(loginId);
  return ref.get().then(function (snap) {
    if (snap.exists) {
      var acc = snap.data();
      if (acc.pwHash !== hashPw(password))
        throw new Error('這組 ID 已經被綁定過了，密碼不正確');
      return buildUser(loginId, acc).then(function (u) {
        if (u.active === false) { _currentUser = null; throw new Error('這個帳號已離職停用，請聯絡秘書長'); }
        saveSession(loginId);
        return { isNew: false, user: u };
      });
    }
    var fresh = { loginId: loginId, pwHash: hashPw(password), sid: null, name: '',
                  role: ROLES.STAFF, createdAt: serverTimestamp() };
    return ref.set(fresh).then(function () {
      saveSession(loginId);
      return buildUser(loginId, fresh).then(function (u) { return { isNew: true, user: u }; });
    });
  });
}

/**
 * 第一次進來填中文姓名。
 * 名字對得上名單 → 直接接上那個人的時數與歷史；對不上 → 建一筆新的名單。
 */
function setDisplayName(name) {
  var n = String(name || '').trim();
  if (!/^[\u4e00-\u9fa5]{2,10}$/.test(n))
    return Promise.reject(new Error('請填寫中文姓名（2–10 個字）'));
  if (!_currentUser) return Promise.reject(new Error('尚未登入'));
  var loginId = _currentUser.loginId;

  return db.collection(COL.staff).get().then(function (snap) {
    var hit = null;
    snap.forEach(function (d) { if ((d.data().name || '').trim() === n) hit = { sid: d.id, data: d.data() }; });

    if (hit) {
      if (hit.data.active === false)
        throw new Error('「' + n + '」在名單上是已離職狀態，請聯絡秘書長');
      return hit.sid;
    }
    var sid = 'p' + Date.now().toString(36);
    return db.collection(COL.staff).doc(sid).set({
      name: n, hireDate: null, active: true, createdAt: serverTimestamp()
    }).then(function () { return sid; });
  }).then(function (sid) {
    return db.collection(COL.users).doc(loginId)
      .set({ sid: sid, name: n, updatedAt: serverTimestamp() }, { merge: true })
      .then(function () {
        return db.collection(COL.users).doc(loginId).get();
      })
      .then(function (sn) { return buildUser(loginId, sn.data()); });
  });
}

function signOut() { _currentUser = null; clearSession(); return Promise.resolve(); }

/** 自己改密碼 */
function changePassword(oldPw, newPw) {
  if (!_currentUser) return Promise.reject(new Error('尚未登入'));
  if (String(newPw).length < 4) return Promise.reject(new Error('新密碼至少 4 個字元'));
  var ref = db.collection(COL.users).doc(_currentUser.loginId);
  return ref.get().then(function (sn) {
    if (sn.data().pwHash !== hashPw(oldPw)) throw new Error('舊密碼不正確');
    return ref.set({ pwHash: hashPw(newPw), updatedAt: serverTimestamp() }, { merge: true });
  });
}

/** 後台：輸入密碼就進去 */
function adminLogin(pw) {
  if (String(pw) !== ADMIN_PASSWORD) return false;
  _currentUser = { loginId: 'admin', sid: 'admin', name: '秘書長', role: ROLES.ADMIN, active: true };
  return true;
}
function adminLogout() { _currentUser = null; }

/** 檢視台：唯讀 */
function viewerLogin(pw) {
  if (String(pw) !== VIEW_PASSWORD) return false;
  _currentUser = { loginId: 'viewer', sid: 'viewer', name: '檢視者', role: ROLES.VIEWER, active: true };
  return true;
}
function viewerLogout() { _currentUser = null; }

/** 開頁時自動接回上次的登入（記在這支手機上） */
function restoreSession() {
  var loginId = readSession();
  if (!loginId) return Promise.resolve(null);
  return db.collection(COL.users).doc(loginId).get().then(function (sn) {
    if (!sn.exists) { clearSession(); return null; }
    return buildUser(loginId, sn.data()).then(function (u) {
      if (u.active === false) { _currentUser = null; clearSession(); return null; }
      return u;
    });
  }).catch(function (e) { _onError(e); return null; });
}

/* ---------- 4. 名單與帳號管理（後台用） ---------- */
/** 通用：合併寫入某個集合的文件 */
function setMerge(col, id, data) {
  return db.collection(col).doc(id).set(data, { merge: true });
}
function listStaff(opt) {
  return db.collection(COL.staff).get().then(function (snap) {
    var out = [];
    snap.forEach(function (d) { var o = d.data(); o.sid = d.id; out.push(o); });
    if (opt && opt.activeOnly) out = out.filter(function (x) { return x.active !== false; });
    return out.sort(function (a, b) {
      if ((a.active !== false) !== (b.active !== false)) return (a.active !== false) ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
    });
  });
}
function upsertStaff(sid, data) {
  data.updatedAt = serverTimestamp();
  return db.collection(COL.staff).doc(sid || ('p' + Date.now().toString(36))).set(data, { merge: true });
}
/** 後台新增名單，可同時填入初始時數 */
function createStaff(name, opt) {
  opt = opt || {};
  var n = String(name || '').trim();
  if (!n) return Promise.reject(new Error('請填姓名'));
  var sid = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 100);
  return db.collection(COL.staff).doc(sid).set({
    name: n,
    hireDate: opt.hireDate ? TS.fromDate(toDate(opt.hireDate)) : null,
    active: opt.active !== false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }).then(function () {
    return setMerge(COL.balances, sid, {
      annualCarry: roundHalf(opt.annualCarry || 0),
      annualCurrent: roundHalf(opt.annualCurrent || 0),
      annualRemaining: roundHalf((opt.annualCarry || 0) + (opt.annualCurrent || 0)),
      compRemaining: roundHalf(opt.compRemaining || 0),
      annualUsedYTD: 0, compUsedYTD: 0, compEarnedYTD: 0,
      updatedAt: serverTimestamp()
    });
  }).then(function () {
    return writeAudit('staff.create', sid, null, { name: n });
  }).then(function () { return sid; });
}

/** 列出所有帳號（含對應到名單上的哪個人） */
function listAccounts() {
  return db.collection(COL.users).get().then(function (snap) {
    var out = [];
    snap.forEach(function (d) { var o = d.data(); o.loginId = d.id; out.push(o); });
    return out.sort(function (a, b) { return String(a.loginId).localeCompare(String(b.loginId)); });
  });
}
/** 後台重設某個帳號的密碼 */
function resetPassword(loginId, newPw) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以重設密碼'));
  if (String(newPw).length < 4) return Promise.reject(new Error('密碼至少 4 個字元'));
  return db.collection(COL.users).doc(loginId)
    .set({ pwHash: hashPw(newPw), updatedAt: serverTimestamp() }, { merge: true })
    .then(function () { return writeAudit('account.resetPw', loginId, null, null); });
}
/** 後台刪除帳號。名單、時數、歷史紀錄都會保留。 */
function deleteAccount(loginId) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以刪除帳號'));
  return db.collection(COL.users).doc(loginId).delete()
    .then(function () { return writeAudit('account.delete', loginId, null, null); });
}

/** 相容用：舊程式碼呼叫的 listUsers 一律回名單 */
function listUsers(opt) {
  return listStaff(opt).then(function (l) {
    return l.map(function (x) { x.uid = x.sid; return x; });
  });
}
function upsertUser(sid, data) { return upsertStaff(sid, data); }

/* ---------- 5. 餘額 ---------- */
/* 特休分兩池：
   annualCarry   = 去年遞延過來的，會過期，請假時優先扣（勞基法施行細則 24-1）
   annualCurrent = 今年新給的
   annualRemaining = 兩池總和，只是方便顯示用，不是真正的來源 */
var EMPTY_BAL = {
  annualCarry:0, annualCarryExpire:null, annualCurrent:0,
  annualRemaining:0, compRemaining:0,
  annualUsedYTD:0, compUsedYTD:0, compEarnedYTD:0
};

/** 舊資料只有 annualRemaining 沒有兩池時，把它當成今年的 */
function normalizeBal(b) {
  var o = Object.assign({}, EMPTY_BAL, b || {});
  if (o.annualCarry === undefined) o.annualCarry = 0;
  if (b && b.annualCurrent === undefined && b.annualRemaining !== undefined) {
    o.annualCurrent = roundHalf((b.annualRemaining || 0) - (b.annualCarry || 0));
  }
  o.annualRemaining = roundHalf((o.annualCarry || 0) + (o.annualCurrent || 0));
  return o;
}

/** 依「先扣遞延、再扣今年」算出這次要從哪一池扣多少 */
function splitAnnual(bal, need) {
  var b = normalizeBal(bal);
  var fromCarry = Math.min(roundHalf(need), b.annualCarry || 0);
  var fromCurrent = roundHalf(need - fromCarry);
  return { fromCarry: fromCarry, fromCurrent: fromCurrent, enough: fromCurrent <= (b.annualCurrent || 0) };
}

function getBalance(uid) {
  return db.collection(COL.balances).doc(uid).get().then(function (s) {
    return normalizeBal(s.exists ? s.data() : null);
  });
}
function watchBalance(uid, cb) {
  return db.collection(COL.balances).doc(uid).onSnapshot(function (s) {
    cb(s.exists ? normalizeBal(s.data()) : normalizeBal(null));
  }, function (e) { _onError(e); });
}

/**
 * 年度發特休：今年沒用完的轉成遞延，再給新的一年份。
 * 遞延只能一次，所以原本就有的遞延如果還沒用完，要折發工資（回傳提醒）。
 */
function grantAnnualYear(uid, newHours, expireDate) {
  return getBalance(uid).then(function (b) {
    var mustPay = b.annualCarry || 0;          // 上一批遞延到期沒休完 → 應折發工資
    var carry   = roundHalf(b.annualCurrent || 0);
    return setMerge(COL.balances, uid, {
      annualCarry: carry,
      annualCarryExpire: expireDate ? TS.fromDate(toDate(expireDate)) : null,
      annualCurrent: roundHalf(newHours),
      annualRemaining: roundHalf(carry + roundHalf(newHours)),
      annualUsedYTD: 0,
      updatedAt: serverTimestamp()
    }).then(function () {
      return writeAudit('balance.grantYear', uid, { carry: b.annualCarry, current: b.annualCurrent },
        { carry: carry, current: roundHalf(newHours), mustPayHours: mustPay });
    }).then(function () { return { carried: carry, mustPayHours: mustPay }; });
  });
}

/** 遞延到期：清掉並回報應折發工資的時數 */
function expireCarry(uid) {
  return getBalance(uid).then(function (b) {
    var pay = b.annualCarry || 0;
    if (!pay) return { mustPayHours: 0 };
    return setMerge(COL.balances, uid, {
      annualCarry: 0, annualCarryExpire: null,
      annualRemaining: roundHalf(b.annualCurrent || 0),
      updatedAt: serverTimestamp()
    }).then(function () {
      return writeAudit('balance.expireCarry', uid, { annualCarry: pay }, { mustPayHours: pay });
    }).then(function () { return { mustPayHours: pay }; });
  });
}

/* ---------- 6. 請假 ---------- */
function submitLeave(o) {
  var u = currentUser();
  if (!u) return Promise.reject(new Error('尚未登入'));
  if (!canApply()) return Promise.reject(new Error('此帳號沒有申請權限'));

  var s = toDate(o.startAt), e = toDate(o.endAt);
  if (!(e > s)) return Promise.reject(new Error('結束時間必須晚於開始時間'));
  var h = roundHalf(o.hours);
  if (!(h > 0)) return Promise.reject(new Error('請假時數必須大於 0'));

  var def = null;
  for (var i = 0; i < LEAVE_TYPES.length; i++)
    if (LEAVE_TYPES[i].id === o.type) def = LEAVE_TYPES[i];
  if (!def) return Promise.reject(new Error('假別不存在'));
  var otherType = String(o.otherType || '').trim();
  if (def.needsText && !otherType) return Promise.reject(new Error('請填寫假別名稱'));

  var a = def.deducts === 'annual' ? h : 0;
  var c = def.deducts === 'comp'   ? h : 0;

  return (a > 0 || c > 0 ? getBalance(u.sid) : Promise.resolve(EMPTY_BAL))
    .then(function (bal) {
      if (a > 0) {
        var sp = splitAnnual(bal, a);
        if (!sp.enough)
          throw new Error('特休不足，目前剩 ' + (bal.annualRemaining || 0) + ' 小時');
      }
      if (c > (bal.compRemaining || 0))
        throw new Error('補休不足，目前剩 ' + (bal.compRemaining || 0) + ' 小時');

      return db.collection(COL.leave).add({
        uid: u.sid, name: u.name, loginId: u.loginId || '',
        type: o.type, otherType: otherType,
        startAt: TS.fromDate(s), endAt: TS.fromDate(e),
        hours: h, annualHours: a, compHours: c,
        segments: splitByMonth(s, e, h),
        isLate: !!o.isLate, lateReason: o.lateReason || '',
        needsProxy: !!o.needsProxy, proxyName: o.proxyName || '',
        status: STATUS.PENDING,
        reviewedBy: null, reviewedAt: null, adminNote: '',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    })
    .then(function (ref) {
      writeAudit('leave.submit', ref.id, null, { type: o.type, hours: h });
      return ref.id;
    });
}

/** 審核請假：核准時以 transaction 扣餘額（先讀後寫） */
function reviewLeave(leaveId, decision, adminNote) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以審核'));
  if (decision !== STATUS.APPROVED && decision !== STATUS.REJECTED)
    return Promise.reject(new Error('決議不合法'));

  var admin = currentUser();
  var leaveRef = db.collection(COL.leave).doc(leaveId);

  return db.runTransaction(function (tx) {
    return tx.get(leaveRef).then(function (lSnap) {
      if (!lSnap.exists) throw new Error('假單不存在');
      var L = lSnap.data();
      if (L.status !== STATUS.PENDING) throw new Error('這張假單已經處理過了');

      var needsDeduct = decision === STATUS.APPROVED &&
                        ((L.annualHours || 0) > 0 || (L.compHours || 0) > 0);
      if (!needsDeduct) {
        tx.update(leaveRef, {
          status: decision, reviewedBy: admin.name, reviewedAt: serverTimestamp(),
          adminNote: adminNote || '', updatedAt: serverTimestamp()
        });
        return;
      }

      var balRef = db.collection(COL.balances).doc(L.uid);
      return tx.get(balRef).then(function (bSnap) {
        var B = normalizeBal(bSnap.exists ? bSnap.data() : null);
        var sp = splitAnnual(B, L.annualHours || 0);
        if ((L.annualHours || 0) > 0 && !sp.enough)
          throw new Error('特休不足：需要 ' + L.annualHours + '，剩 ' + B.annualRemaining);
        if ((L.compHours || 0) > (B.compRemaining || 0))
          throw new Error('補休不足：需要 ' + L.compHours + '，剩 ' + (B.compRemaining || 0));

        // 記在假單上，撤銷時才知道要還回哪一池
        tx.update(leaveRef, {
          status: decision, reviewedBy: admin.name, reviewedAt: serverTimestamp(),
          adminNote: adminNote || '', updatedAt: serverTimestamp(),
          annualFromCarry: sp.fromCarry, annualFromCurrent: sp.fromCurrent
        });
        var nCarry   = roundHalf(B.annualCarry   - sp.fromCarry);
        var nCurrent = roundHalf(B.annualCurrent - sp.fromCurrent);
        tx.set(balRef, {
          annualCarry:     nCarry,
          annualCurrent:   nCurrent,
          annualRemaining: roundHalf(nCarry + nCurrent),
          compRemaining:   roundHalf((B.compRemaining || 0) - (L.compHours || 0)),
          annualUsedYTD:   roundHalf((B.annualUsedYTD || 0) + (L.annualHours || 0)),
          compUsedYTD:     roundHalf((B.compUsedYTD   || 0) + (L.compHours   || 0)),
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
    });
  }).then(function () {
    writeAudit('leave.review', leaveId, null, { decision: decision, adminNote: adminNote || '' });
  });
}

/** 撤銷假單：本人只能撤 pending；admin 撤已核准的會自動回補餘額 */
function cancelLeave(leaveId, reason) {
  var u = currentUser();
  var leaveRef = db.collection(COL.leave).doc(leaveId);

  return db.runTransaction(function (tx) {
    return tx.get(leaveRef).then(function (lSnap) {
      if (!lSnap.exists) throw new Error('假單不存在');
      var L = lSnap.data();
      var mine = L.uid === u.sid;
      if (!isAdmin() && !(mine && L.status === STATUS.PENDING))
        throw new Error('沒有權限撤銷這張假單');
      if (L.status === STATUS.CANCELLED) throw new Error('已經撤銷過了');

      var needsRefund = L.status === STATUS.APPROVED &&
                        ((L.annualHours || 0) > 0 || (L.compHours || 0) > 0);
      if (!needsRefund) {
        tx.update(leaveRef, {
          status: STATUS.CANCELLED, cancelledBy: u.name,
          cancelledAt: serverTimestamp(), updatedAt: serverTimestamp(),
          adminNote: reason || L.adminNote || ''
        });
        return;
      }

      var balRef = db.collection(COL.balances).doc(L.uid);
      return tx.get(balRef).then(function (bSnap) {
        var B = normalizeBal(bSnap.exists ? bSnap.data() : null);
        // 原路退回：當初從哪一池扣的，就還回哪一池
        var backCarry   = (L.annualFromCarry   !== undefined) ? L.annualFromCarry   : 0;
        var backCurrent = (L.annualFromCurrent !== undefined) ? L.annualFromCurrent
                                                             : (L.annualHours || 0);
        tx.update(leaveRef, {
          status: STATUS.CANCELLED, cancelledBy: u.name,
          cancelledAt: serverTimestamp(), updatedAt: serverTimestamp(),
          adminNote: reason || L.adminNote || ''
        });
        var rCarry   = roundHalf(B.annualCarry   + backCarry);
        var rCurrent = roundHalf(B.annualCurrent + backCurrent);
        tx.set(balRef, {
          annualCarry:     rCarry,
          annualCurrent:   rCurrent,
          annualRemaining: roundHalf(rCarry + rCurrent),
          compRemaining:   roundHalf((B.compRemaining || 0) + (L.compHours   || 0)),
          annualUsedYTD:   roundHalf((B.annualUsedYTD || 0) - (L.annualHours || 0)),
          compUsedYTD:     roundHalf((B.compUsedYTD   || 0) - (L.compHours   || 0)),
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
    });
  }).then(function () {
    writeAudit('leave.cancel', leaveId, null, { reason: reason || '' });
  });
}

/* ---------- 7. 加班 ---------- */
function submitOvertime(o) {
  var u = currentUser();
  if (!u) return Promise.reject(new Error('尚未登入'));
  var h = roundHalf(o.hours);
  if (!(h > 0)) return Promise.reject(new Error('加班時數必須大於 0'));
  var month = ym(o.date);

  return monthlyOvertimeHours(u.sid, month).then(function (used) {
    var overCap = used + h > MONTHLY_OT_CAP;
    return db.collection(COL.overtime).add({
      uid: u.sid, name: u.name, loginId: u.loginId || '',
      date:    TS.fromDate(toDate(o.date)),
      startAt: TS.fromDate(toDate(o.startAt)),
      endAt:   TS.fromDate(toDate(o.endAt)),
      hours: h, bonusHours: roundHalf(o.bonusHours || 0),
      ym: month, reason: o.reason || '',
      overCapWarning: overCap, status: STATUS.PENDING,
      reviewedBy: null, reviewedAt: null, adminNote: '',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }).then(function (ref) {
      writeAudit('overtime.submit', ref.id, null, { hours: h });
      return { id: ref.id, overCapWarning: overCap };
    });
  });
}

/** 核准加班 → 補休增加 (hours + bonusHours) */
function reviewOvertime(otId, decision, adminNote) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以審核'));
  var admin = currentUser();
  var otRef = db.collection(COL.overtime).doc(otId);

  return db.runTransaction(function (tx) {
    return tx.get(otRef).then(function (oSnap) {
      if (!oSnap.exists) throw new Error('加班單不存在');
      var O = oSnap.data();
      if (O.status !== STATUS.PENDING) throw new Error('這張加班單已經處理過了');

      if (decision !== STATUS.APPROVED) {
        tx.update(otRef, {
          status: decision, reviewedBy: admin.name, reviewedAt: serverTimestamp(),
          adminNote: adminNote || '', updatedAt: serverTimestamp()
        });
        return;
      }

      var balRef = db.collection(COL.balances).doc(O.uid);
      return tx.get(balRef).then(function (bSnap) {
        var B = normalizeBal(bSnap.exists ? bSnap.data() : null);
        var gain = roundHalf(O.hours + (O.bonusHours || 0));
        tx.update(otRef, {
          status: decision, reviewedBy: admin.name, reviewedAt: serverTimestamp(),
          adminNote: adminNote || '', updatedAt: serverTimestamp()
        });
        tx.set(balRef, {
          compRemaining: roundHalf((B.compRemaining || 0) + gain),
          compEarnedYTD: roundHalf((B.compEarnedYTD || 0) + gain),
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
    });
  }).then(function () {
    writeAudit('overtime.review', otId, null, { decision: decision, adminNote: adminNote || '' });
  });
}

function monthlyOvertimeHours(uid, month) {
  return db.collection(COL.overtime)
    .where('uid', '==', uid).where('ym', '==', month)
    .get().then(function (snap) {
      var sum = 0;
      snap.forEach(function (d) {
        var o = d.data();
        if (o.status === STATUS.PENDING || o.status === STATUS.APPROVED) sum += (o.hours || 0);
      });
      return sum;
    }).catch(function () { return 0; });
}

/* ---------- 8. 查詢 / 監聽 ---------- */
function snapList(snap) {
  var out = [];
  snap.forEach(function (d) { var o = d.data(); o.id = d.id; out.push(o); });
  return out;
}
/** 錯誤統一往外丟，頁面自己決定怎麼顯示 */
var _onError = function (e) { console.error('[TPS]', e); };
function setErrorHandler(fn) { _onError = fn; }
function ms(v) { return (v && v.toMillis) ? v.toMillis() : 0; }

/* 注意：全部只用單一 where，排序在前端做。
   where + 不同欄位的 orderBy 會要求建複合索引，沒建就整個查詢失敗。 */
function watchMyLeaves(cb, n) {
  var limit = n || 50;
  return db.collection(COL.leave)
    .where('uid', '==', currentUser().sid)
    .onSnapshot(function (s) {
      var list = snapList(s).sort(function (a, b) { return ms(b.createdAt) - ms(a.createdAt); });
      cb(list.slice(0, limit));
    }, function (e) { _onError(e); });
}
function watchMyOvertime(cb, n) {
  var limit = n || 100;
  return db.collection(COL.overtime)
    .where('uid', '==', currentUser().sid)
    .onSnapshot(function (s) {
      var list = snapList(s).sort(function (a, b) { return ms(b.createdAt) - ms(a.createdAt); });
      cb(list.slice(0, limit));
    }, function (e) { _onError(e); });
}
function watchPending(cb) {
  return db.collection(COL.leave)
    .where('status', '==', STATUS.PENDING)
    .onSnapshot(function (s) {
      cb(snapList(s).sort(function (a, b) { return ms(a.createdAt) - ms(b.createdAt); }));
    }, function (e) { _onError(e); });
}
function watchPendingOvertime(cb) {
  return db.collection(COL.overtime)
    .where('status', '==', STATUS.PENDING)
    .onSnapshot(function (s) {
      cb(snapList(s).sort(function (a, b) { return ms(a.createdAt) - ms(b.createdAt); }));
    }, function (e) { _onError(e); });
}
function fetchLeavesByYear(y) {
  return db.collection(COL.leave)
    .where('startAt', '>=', TS.fromDate(new Date(y, 0, 1)))
    .where('startAt', '<',  TS.fromDate(new Date(y + 1, 0, 1)))
    .get().then(snapList).then(function(l){ return l.sort(function(a,b){ return toDate(a.startAt)-toDate(b.startAt); }); });
}
function fetchOvertimeByYear(y) {
  return db.collection(COL.overtime)
    .where('date', '>=', TS.fromDate(new Date(y, 0, 1)))
    .where('date', '<',  TS.fromDate(new Date(y + 1, 0, 1)))
    .get().then(snapList).then(function(l){ return l.sort(function(a,b){ return toDate(a.date)-toDate(b.date); }); });
}

/* ---------- 9. 年度統計 ---------- */
function buildYearMatrix(year) {
  return Promise.all([fetchLeavesByYear(year), fetchOvertimeByYear(year), listUsers()])
    .then(function (r) {
      var leaves = r[0], overtimes = r[1], users = r[2];
      var months = [];
      for (var m = 1; m <= 12; m++) months.push(year + '-' + pad(m));

      var leaveOut = {}, otOut = {};
      users.forEach(function (u) {
        leaveOut[u.uid] = { name: u.name, total: 0 };
        LEAVE_TYPES.forEach(function (t) { leaveOut[u.uid][t.id] = {}; });
        otOut[u.uid] = { name: u.name, withBonus:{}, withoutBonus:{}, total:0, totalNoBonus:0 };
      });

      leaves.forEach(function (l) {
        if (l.status !== STATUS.APPROVED) return;
        var b = leaveOut[l.uid]; if (!b) return;
        var segs = (l.segments && l.segments.length)
          ? l.segments : [{ ym: ym(l.startAt), hours: l.hours }];
        segs.forEach(function (sg) {
          if (months.indexOf(sg.ym) < 0) return;
          b[l.type][sg.ym] = roundHalf((b[l.type][sg.ym] || 0) + sg.hours);
          b.total = roundHalf(b.total + sg.hours);
        });
      });

      overtimes.forEach(function (o) {
        if (o.status !== STATUS.APPROVED) return;
        var b = otOut[o.uid]; if (!b || months.indexOf(o.ym) < 0) return;
        var withB = roundHalf(o.hours + (o.bonusHours || 0));
        b.withBonus[o.ym]    = roundHalf((b.withBonus[o.ym]    || 0) + withB);
        b.withoutBonus[o.ym] = roundHalf((b.withoutBonus[o.ym] || 0) + o.hours);
        b.total        = roundHalf(b.total + withB);
        b.totalNoBonus = roundHalf(b.totalNoBonus + o.hours);
      });

      return { year: year, months: months, leave: leaveOut, overtime: otOut, users: users };
    });
}

/** 某人某月已核准的請假時數（跨月假單依 segments 計入） */
function monthLeaveHours(leaves, month) {
  var sum = 0;
  leaves.forEach(function (l) {
    if (l.status !== STATUS.APPROVED) return;
    var segs = (l.segments && l.segments.length)
      ? l.segments : [{ ym: ym(l.startAt), hours: l.hours }];
    segs.forEach(function (sg) { if (sg.ym === month) sum = roundHalf(sum + sg.hours); });
  });
  return sum;
}
/** 某人某月已核准的加班時數（含核派增額） */
function monthOvertimeHours(ots, month) {
  var sum = 0;
  ots.forEach(function (o) {
    if (o.status !== STATUS.APPROVED) return;
    if ((o.ym || ym(o.date)) !== month) return;
    sum = roundHalf(sum + o.hours + (o.bonusHours || 0));
  });
  return sum;
}

/* ---------- 10. 稽核 ---------- */
function writeAudit(action, targetId, before, after) {
  var u = currentUser();
  if (!u) return Promise.resolve();
  return db.collection(COL.audit).add({
    actorUid: u.loginId || u.sid, actorName: u.name, action: action,
    targetId: targetId, before: before || null, after: after || null,
    at: serverTimestamp()
  }).catch(function (e) { console.warn('[TPS] audit 寫入失敗（不影響主流程）', e); });
}

/* ---------- 11. 小工具 ---------- */
function el(sel, root) { return (root || document).querySelector(sel); }
function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
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
  }, 2800);
}

console.info('[TPS] shared.js v' + SHARED_VERSION + ' loaded');

return {
  SHARED_VERSION: SHARED_VERSION, firebaseConfig: firebaseConfig,
  db: db, serverTimestamp: serverTimestamp, Timestamp: TS,
  HOURS_PER_DAY: HOURS_PER_DAY, MONTHLY_OT_CAP: MONTHLY_OT_CAP,
  ROLES: ROLES, ROLE_LABEL: ROLE_LABEL,
  LEAVE_TYPES: LEAVE_TYPES, STATUS: STATUS, STATUS_LABEL: STATUS_LABEL, COL: COL,
  leaveTypeLabel: leaveTypeLabel,
  toDate: toDate, ym: ym, fmtDate: fmtDate, fmtDateTime: fmtDateTime,
  roundHalf: roundHalf, splitByMonth: splitByMonth,
  annualLeaveDays: annualLeaveDays, annualLeaveHours: annualLeaveHours,
  currentUser: currentUser, ADMIN_PASSWORD: ADMIN_PASSWORD, VIEW_PASSWORD: VIEW_PASSWORD,
  isAdmin: isAdmin, isStaff: isStaff, canApply: canApply,
  loginOrRegister: loginOrRegister, setDisplayName: setDisplayName,
  adminLogin: adminLogin, adminLogout: adminLogout,
  viewerLogin: viewerLogin, viewerLogout: viewerLogout,
  signOut: signOut, changePassword: changePassword, restoreSession: restoreSession,
  listStaff: listStaff, createStaff: createStaff, upsertStaff: upsertStaff,
  listAccounts: listAccounts, resetPassword: resetPassword, deleteAccount: deleteAccount,
  listUsers: listUsers, upsertUser: upsertUser, setMerge: setMerge,
  getBalance: getBalance, watchBalance: watchBalance,
  normalizeBal: normalizeBal, splitAnnual: splitAnnual,
  grantAnnualYear: grantAnnualYear, expireCarry: expireCarry,
  submitLeave: submitLeave, reviewLeave: reviewLeave, cancelLeave: cancelLeave,
  submitOvertime: submitOvertime, reviewOvertime: reviewOvertime,
  watchMyLeaves: watchMyLeaves, watchMyOvertime: watchMyOvertime, watchPending: watchPending,
  monthLeaveHours: monthLeaveHours, monthOvertimeHours: monthOvertimeHours,
  watchPendingOvertime: watchPendingOvertime,
  fetchLeavesByYear: fetchLeavesByYear, fetchOvertimeByYear: fetchOvertimeByYear,
  buildYearMatrix: buildYearMatrix, writeAudit: writeAudit,
  setErrorHandler: setErrorHandler,
  _sha256: sha256,
  el: el, els: els, esc: esc, toast: toast
};
})();
