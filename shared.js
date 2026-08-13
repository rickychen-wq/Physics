/* ============================================================
 *  TPS 行政室請假加班系統  ——  shared.js
 *  以「職位信箱」為識別：秘書換人，信箱不變，資料照樣接下去
 *  非 module 寫法，載入後掛在 window.TPS
 *  依賴：firebase-app-compat / firestore-compat
 * ============================================================ */
window.TPS = (function () {
'use strict';

var SHARED_VERSION = '5.0.0';

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
  leave:'leaveRequests', overtime:'overtimeRequests', audit:'auditLog'
};
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
function isWorkday(d) { var w = d.getDay(); return w >= 1 && w <= 5; }
function ms(v) { return (v && v.toMillis) ? v.toMillis() : 0; }

/** 依上班時段自動算時數：平日 09–12、13–17 */
function estimateHours(startAt, endAt) {
  var s = toDate(startAt), e = toDate(endAt);
  if (!(s < e)) return 0;
  var total = 0;
  var cur  = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  var last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  while (cur <= last) {
    if (isWorkday(cur)) {
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
    if (isWorkday(cur)) {
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
    return checkCarryExpiry(em).then(function () { return _me; });
  });
}
function logout() { _me = null; clearSession(); return Promise.resolve(); }

function restoreSession() {
  var em = readSession();
  if (!em) return Promise.resolve(null);
  return db.collection(COL.accounts).doc(em).get().then(function (snap) {
    if (!snap.exists || snap.data().active === false) { clearSession(); return null; }
    _me = buildMe(em, snap.data());
    return checkCarryExpiry(em).then(function () { return _me; });
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

function adminLogin(pw) {
  if (String(pw) !== ADMIN_PASSWORD) return false;
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
  return db.collection(COL.accounts).doc(em).set(data, { merge: true });
}
function setMerge(col, id, data) {
  return db.collection(col).doc(id).set(data, { merge: true });
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
      return setMerge(COL.balances, em, {
        annualCarry: 0, annualCarryExpire: null, annualCurrent: 0, annualRemaining: 0,
        compRemaining: 0, annualUsedYTD: 0, compUsedYTD: 0, compEarnedYTD: 0,
        expiredCarryHours: 0, updatedAt: serverTimestamp()
      });
    }).then(function () {
      return writeAudit('account.handover', em,
        { name: acc.name, term: acc.term || 1 }, { name: name, term: newTerm });
    }).then(function () { return { term: newTerm, password: DEFAULT_PW }; });
  });
}

/* ---------- 6. 時數 ---------- */
var EMPTY_BAL = {
  annualCarry:0, annualCarryExpire:null, annualCurrent:0, annualRemaining:0,
  compRemaining:0, annualUsedYTD:0, compUsedYTD:0, compEarnedYTD:0, expiredCarryHours:0
};
function normalizeBal(b) {
  var o = Object.assign({}, EMPTY_BAL, b || {});
  o.annualRemaining = roundHalf((o.annualCarry || 0) + (o.annualCurrent || 0));
  return o;
}
/** 先扣遞延、再扣今年 */
function splitAnnual(bal, need) {
  var b = normalizeBal(bal);
  var fromCarry   = Math.min(roundHalf(need), b.annualCarry || 0);
  var fromCurrent = roundHalf(need - fromCarry);
  return { fromCarry: fromCarry, fromCurrent: fromCurrent,
           enough: fromCurrent <= (b.annualCurrent || 0) };
}
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
function checkCarryExpiry(email, now) {
  var em = normEmail(email);
  var at = now ? toDate(now) : new Date();
  return getBalance(em).then(function (b) {
    if (!(b.annualCarry > 0) || !b.annualCarryExpire) return { expired: 0 };
    var exp = toDate(b.annualCarryExpire);
    if (isNaN(exp) || at <= exp) return { expired: 0 };
    var pay = roundHalf(b.annualCarry);
    return setMerge(COL.balances, em, {
      annualCarry: 0, annualCarryExpire: null,
      annualRemaining: roundHalf(b.annualCurrent || 0),
      expiredCarryHours: roundHalf((b.expiredCarryHours || 0) + pay),
      updatedAt: serverTimestamp()
    }).then(function () {
      return writeAudit('balance.carryExpired', em,
        { annualCarry: pay }, { mustPayHours: pay, expiredAt: fmtDate(exp) });
    }).then(function () { return { expired: pay }; });
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

  return (a > 0 || c > 0 ? getBalance(u.email) : Promise.resolve(EMPTY_BAL))
    .then(function (bal) {
      if (a > 0 && !splitAnnual(bal, a).enough)
        throw new Error('特休不足，目前剩 ' + (bal.annualRemaining || 0) + ' 小時');
      if (c > (bal.compRemaining || 0))
        throw new Error('補休不足，目前剩 ' + (bal.compRemaining || 0) + ' 小時');
      return db.collection(COL.leave).add({
        email: u.email, name: u.name, term: u.term || 1,
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
      var stamp = {
        status: decision, reviewedBy: admin.name, reviewedAt: serverTimestamp(),
        adminNote: adminNote || '', updatedAt: serverTimestamp()
      };
      var needs = decision === STATUS.APPROVED &&
                  ((L.annualHours || 0) > 0 || (L.compHours || 0) > 0);
      if (!needs) { tx.update(ref, stamp); return; }

      var balRef = db.collection(COL.balances).doc(L.email);
      return tx.get(balRef).then(function (bs) {
        var B = normalizeBal(bs.exists ? bs.data() : null);
        var sp = splitAnnual(B, L.annualHours || 0);
        if ((L.annualHours || 0) > 0 && !sp.enough)
          throw new Error('特休不足：需要 ' + L.annualHours + '，剩 ' + B.annualRemaining);
        if ((L.compHours || 0) > (B.compRemaining || 0))
          throw new Error('補休不足：需要 ' + L.compHours + '，剩 ' + B.compRemaining);
        stamp.annualFromCarry   = sp.fromCarry;
        stamp.annualFromCurrent = sp.fromCurrent;
        tx.update(ref, stamp);
        var nC = roundHalf(B.annualCarry   - sp.fromCarry);
        var nU = roundHalf(B.annualCurrent - sp.fromCurrent);
        tx.set(balRef, {
          annualCarry: nC, annualCurrent: nU, annualRemaining: roundHalf(nC + nU),
          compRemaining: roundHalf((B.compRemaining || 0) - (L.compHours || 0)),
          annualUsedYTD: roundHalf((B.annualUsedYTD || 0) + (L.annualHours || 0)),
          compUsedYTD:   roundHalf((B.compUsedYTD   || 0) + (L.compHours   || 0)),
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
    });
  }).then(function () {
    writeAudit('leave.review', leaveId, null, { decision: decision, adminNote: adminNote || '' });
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
      if (!needs) { tx.update(ref, stamp); return; }
      var balRef = db.collection(COL.balances).doc(L.email);
      return tx.get(balRef).then(function (bs) {
        var B = normalizeBal(bs.exists ? bs.data() : null);
        var backC = (L.annualFromCarry   !== undefined) ? L.annualFromCarry : 0;
        var backU = (L.annualFromCurrent !== undefined) ? L.annualFromCurrent : (L.annualHours || 0);
        tx.update(ref, stamp);
        var rC = roundHalf(B.annualCarry + backC), rU = roundHalf(B.annualCurrent + backU);
        tx.set(balRef, {
          annualCarry: rC, annualCurrent: rU, annualRemaining: roundHalf(rC + rU),
          compRemaining: roundHalf((B.compRemaining || 0) + (L.compHours || 0)),
          annualUsedYTD: roundHalf((B.annualUsedYTD || 0) - (L.annualHours || 0)),
          compUsedYTD:   roundHalf((B.compUsedYTD   || 0) - (L.compHours   || 0)),
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
    });
  }).then(function () { writeAudit('leave.cancel', leaveId, null, { reason: reason || '' }); });
}

/* ---------- 8. 加班 ---------- */
function submitOvertime(o) {
  var u = currentUser();
  if (!u) return Promise.reject(new Error('尚未登入'));
  if (!canApply()) return Promise.reject(new Error('這個帳號沒有申請權限'));
  var h = roundHalf(o.hours);
  if (!(h > 0)) return Promise.reject(new Error('加班時數必須大於 0'));
  var month = ym(o.date);
  return monthlyOvertimeHours(u.email, month).then(function (used) {
    var over = used + h > MONTHLY_OT_CAP;
    return db.collection(COL.overtime).add({
      email: u.email, name: u.name, term: u.term || 1,
      date: TS.fromDate(toDate(o.date)),
      startAt: TS.fromDate(toDate(o.startAt)),
      endAt: TS.fromDate(toDate(o.endAt)),
      hours: h, bonusHours: roundHalf(o.bonusHours || 0), ym: month,
      reason: o.reason || '', overCapWarning: over,
      status: STATUS.PENDING, reviewedBy: null, reviewedAt: null, adminNote: '',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }).then(function (ref) {
      writeAudit('overtime.submit', ref.id, null, { hours: h });
      return { id: ref.id, overCapWarning: over };
    });
  });
}

function reviewOvertime(otId, decision, adminNote) {
  if (!isAdmin()) return Promise.reject(new Error('只有秘書長可以審核'));
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
      if (decision !== STATUS.APPROVED) { tx.update(ref, stamp); return; }
      var balRef = db.collection(COL.balances).doc(O.email);
      return tx.get(balRef).then(function (bs) {
        var B = normalizeBal(bs.exists ? bs.data() : null);
        var gain = roundHalf(O.hours + (O.bonusHours || 0));
        tx.update(ref, stamp);
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
  DEFAULT_PW: DEFAULT_PW, ADMIN_PASSWORD: ADMIN_PASSWORD,
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
  listAccounts: listAccounts, getAccount: getAccount, upsertAccount: upsertAccount,
  resetPassword: resetPassword, handoverAccount: handoverAccount, setMerge: setMerge,
  getBalance: getBalance, watchBalance: watchBalance, normalizeBal: normalizeBal,
  splitAnnual: splitAnnual, checkCarryExpiry: checkCarryExpiry, grantAnnual: grantAnnual,
  submitLeave: submitLeave, reviewLeave: reviewLeave, cancelLeave: cancelLeave,
  submitOvertime: submitOvertime, reviewOvertime: reviewOvertime,
  watchMyLeaves: watchMyLeaves, watchMyOvertime: watchMyOvertime,
  watchPendingLeaves: watchPendingLeaves, watchPendingOvertime: watchPendingOvertime,
  fetchAllRecords: fetchAllRecords, fetchAudit: fetchAudit,
  monthLeaveHours: monthLeaveHours, monthOvertimeHours: monthOvertimeHours,
  writeAudit: writeAudit, setErrorHandler: setErrorHandler,
  _sha256: sha256, _hashPw: hashPw,
  el: el, esc: esc, toast: toast
};
})();
