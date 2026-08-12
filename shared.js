/* ============================================================
 *  TPS 行政室請假加班系統  ——  shared.js
 *  非 module 寫法：載入後掛在 window.TPS，可直接用 file:// 開
 *  改這支記得 bump SHARED_VERSION 並同步各 HTML 的 ?v=
 *  依賴：firebase-app-compat / auth-compat / firestore-compat
 * ============================================================ */
window.TPS = (function () {
'use strict';

var SHARED_VERSION = '2.1.0';

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
var auth = firebase.auth();
var db   = firebase.firestore();
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
  balances:'balances', audit:'auditLog', push:'pushSubscriptions', ids:'loginIds'
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

/* ---------- 3. 認證（ID + 密碼，一個畫面搞定） ---------- */
var ID_DOMAIN = '@tps.local';
var _currentUser = null;

function idToEmail(id) { return String(id).trim().toLowerCase() + ID_DOMAIN; }
function currentUser() { return _currentUser; }
function isAdmin()  { return !!_currentUser && _currentUser.role === ROLES.ADMIN; }
function isStaff()  { return !!_currentUser && _currentUser.role === ROLES.STAFF; }
function canApply() { return isStaff() || isAdmin(); }

/**
 * 一個輸入框搞定：ID 沒人綁過就直接建立，綁過就當一般登入。
 * @returns Promise<{ isNew:boolean }>
 * 密碼錯誤時 throw 的 message 已經寫好給使用者看。
 */
function loginOrRegister(id, password) {
  var cleanId = String(id).trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,20}$/.test(cleanId))
    return Promise.reject(new Error('ID 只能用英文、數字、. _ -，長度 2–20 個字元'));
  if (String(password).length < 4)
    return Promise.reject(new Error('密碼至少 4 個字元'));

  var idRef = db.collection(COL.ids).doc(cleanId);

  return idRef.get().then(function (snap) {
    if (snap.exists) {
      // 已經有人綁過 → 當成登入
      return auth.signInWithEmailAndPassword(idToEmail(cleanId), password)
        .then(function () { return { isNew: false }; })
        .catch(function (e) {
          if (e.code === 'auth/wrong-password' ||
              e.code === 'auth/invalid-credential' ||
              e.code === 'auth/user-not-found')
            throw new Error('這組 ID 已經被綁定過了，密碼不正確');
          if (e.code === 'auth/too-many-requests')
            throw new Error('嘗試次數太多，等一下再試');
          throw e;
        });
    }
    // 沒人綁過 → 建立並綁定
    return auth.createUserWithEmailAndPassword(idToEmail(cleanId), password)
      .then(function (cred) {
        return Promise.all([
          idRef.set({ uid: cred.user.uid, createdAt: serverTimestamp() }),
          db.collection(COL.users).doc(cred.user.uid).set({
            loginId: cleanId, name: '', role: ROLES.STAFF, active: true,
            hireDate: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
          })
        ]).then(function () { return { isNew: true }; });
      })
      .catch(function (e) {
        if (e.code === 'auth/email-already-in-use')
          throw new Error('這組 ID 已經被綁定過了，密碼不正確');
        if (e.code === 'auth/weak-password')
          throw new Error('密碼太短，至少 6 個字元');
        throw e;
      });
  });
}

/** 第一次進來填中文姓名 */
function setDisplayName(name) {
  var n = String(name || '').trim();
  if (!/^[\u4e00-\u9fa5]{2,10}$/.test(n))
    return Promise.reject(new Error('請填寫中文姓名（2–10 個字）'));
  var uid = auth.currentUser.uid;
  return db.collection(COL.users).doc(uid).set(
    { name: n, updatedAt: serverTimestamp() }, { merge: true }
  ).then(function () { if (_currentUser) _currentUser.name = n; return n; });
}

function signOut() { _currentUser = null; return auth.signOut(); }
function changePassword(pw) { return auth.currentUser.updatePassword(pw); }

/** 後台：輸入密碼就進去，不走帳號 */
function adminLogin(pw) {
  if (String(pw) !== ADMIN_PASSWORD) return false;
  _currentUser = { uid: 'admin', name: '秘書長', loginId: 'admin', role: ROLES.ADMIN };
  return true;
}
function adminLogout() { _currentUser = null; }

/** 檢視台：輸入密碼進入，只能讀不能改 */
function viewerLogin(pw) {
  if (String(pw) !== VIEW_PASSWORD) return false;
  _currentUser = { uid: 'viewer', name: '檢視者', loginId: 'viewer', role: ROLES.VIEWER };
  return true;
}
function viewerLogout() { _currentUser = null; }

/** 監聽登入狀態，補上 users/{uid}。user.needsName 代表還沒填中文姓名 */
function watchAuth(cb) {
  return auth.onAuthStateChanged(function (fbUser) {
    if (!fbUser) { _currentUser = null; cb(null); return; }
    db.collection(COL.users).doc(fbUser.uid).get().then(function (snap) {
      var d = snap.exists ? snap.data() : { loginId: '', name: '', role: ROLES.STAFF, active: true };
      d.uid = fbUser.uid;
      d.needsName = !d.name;
      _currentUser = d;
      cb(d);
    }).catch(function (e) {
      console.error('[TPS] 讀取使用者資料失敗', e);
      cb({ uid: fbUser.uid, role: null, error: e.message });
    });
  });
}

/* ---------- 4. 人員 ---------- */
function listUsers(opt) {
  return db.collection(COL.users).get().then(function (snap) {
    var out = [];
    snap.forEach(function (d) { var o = d.data(); o.uid = d.id; out.push(o); });
    if (opt && opt.activeOnly) out = out.filter(function (u) { return u.active !== false; });
    return out.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
    });
  });
}
function getUser(uid) {
  return db.collection(COL.users).doc(uid).get().then(function (s) {
    if (!s.exists) return null;
    var o = s.data(); o.uid = uid; return o;
  });
}
function upsertUser(uid, data) {
  data.updatedAt = serverTimestamp();
  return db.collection(COL.users).doc(uid).set(data, { merge: true });
}
/** 通用：合併寫入某個 collection 的文件 */
function setMerge(col, id, data) {
  return db.collection(col).doc(id).set(data, { merge: true });
}

/* ---------- 5. 餘額 ---------- */
var EMPTY_BAL = { annualRemaining:0, compRemaining:0, annualUsedYTD:0, compUsedYTD:0, compEarnedYTD:0 };

function getBalance(uid) {
  return db.collection(COL.balances).doc(uid).get().then(function (s) {
    return s.exists ? s.data() : Object.assign({}, EMPTY_BAL);
  });
}
function watchBalance(uid, cb) {
  return db.collection(COL.balances).doc(uid).onSnapshot(function (s) {
    cb(s.exists ? s.data() : null);
  }, function (e) { console.error('[TPS] watchBalance', e); });
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

  return (a > 0 || c > 0 ? getBalance(u.uid) : Promise.resolve(EMPTY_BAL))
    .then(function (bal) {
      if (a > (bal.annualRemaining || 0))
        throw new Error('特休不足，目前剩 ' + (bal.annualRemaining || 0) + ' 小時');
      if (c > (bal.compRemaining || 0))
        throw new Error('補休不足，目前剩 ' + (bal.compRemaining || 0) + ' 小時');

      return db.collection(COL.leave).add({
        uid: u.uid, name: u.name, loginId: u.loginId || '',
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
        var B = bSnap.exists ? bSnap.data() : Object.assign({}, EMPTY_BAL);
        if ((L.annualHours || 0) > (B.annualRemaining || 0))
          throw new Error('特休不足：需要 ' + L.annualHours + '，剩 ' + (B.annualRemaining || 0));
        if ((L.compHours || 0) > (B.compRemaining || 0))
          throw new Error('補休不足：需要 ' + L.compHours + '，剩 ' + (B.compRemaining || 0));

        tx.update(leaveRef, {
          status: decision, reviewedBy: admin.name, reviewedAt: serverTimestamp(),
          adminNote: adminNote || '', updatedAt: serverTimestamp()
        });
        tx.set(balRef, {
          annualRemaining: roundHalf((B.annualRemaining || 0) - (L.annualHours || 0)),
          compRemaining:   roundHalf((B.compRemaining   || 0) - (L.compHours   || 0)),
          annualUsedYTD:   roundHalf((B.annualUsedYTD   || 0) + (L.annualHours || 0)),
          compUsedYTD:     roundHalf((B.compUsedYTD     || 0) + (L.compHours   || 0)),
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
      var mine = L.uid === u.uid;
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
        var B = bSnap.exists ? bSnap.data() : Object.assign({}, EMPTY_BAL);
        tx.update(leaveRef, {
          status: STATUS.CANCELLED, cancelledBy: u.name,
          cancelledAt: serverTimestamp(), updatedAt: serverTimestamp(),
          adminNote: reason || L.adminNote || ''
        });
        tx.set(balRef, {
          annualRemaining: roundHalf((B.annualRemaining || 0) + (L.annualHours || 0)),
          compRemaining:   roundHalf((B.compRemaining   || 0) + (L.compHours   || 0)),
          annualUsedYTD:   roundHalf((B.annualUsedYTD   || 0) - (L.annualHours || 0)),
          compUsedYTD:     roundHalf((B.compUsedYTD     || 0) - (L.compHours   || 0)),
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

  return monthlyOvertimeHours(u.uid, month).then(function (used) {
    var overCap = used + h > MONTHLY_OT_CAP;
    return db.collection(COL.overtime).add({
      uid: u.uid, name: u.name, loginId: u.loginId || '',
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
        var B = bSnap.exists ? bSnap.data() : Object.assign({}, EMPTY_BAL);
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
function watchMyLeaves(cb, n) {
  return db.collection(COL.leave)
    .where('uid', '==', currentUser().uid)
    .orderBy('createdAt', 'desc').limit(n || 50)
    .onSnapshot(function (s) { cb(snapList(s)); },
                function (e) { console.error('[TPS] watchMyLeaves', e); });
}
function watchPending(cb) {
  return db.collection(COL.leave)
    .where('status', '==', STATUS.PENDING).orderBy('createdAt', 'asc')
    .onSnapshot(function (s) { cb(snapList(s)); },
                function (e) { console.error('[TPS] watchPending', e); });
}
function watchPendingOvertime(cb) {
  return db.collection(COL.overtime)
    .where('status', '==', STATUS.PENDING).orderBy('createdAt', 'asc')
    .onSnapshot(function (s) { cb(snapList(s)); },
                function (e) { console.error('[TPS] watchPendingOvertime', e); });
}
function fetchLeavesByYear(y) {
  return db.collection(COL.leave)
    .where('startAt', '>=', TS.fromDate(new Date(y, 0, 1)))
    .where('startAt', '<',  TS.fromDate(new Date(y + 1, 0, 1)))
    .orderBy('startAt', 'asc').get().then(snapList);
}
function fetchOvertimeByYear(y) {
  return db.collection(COL.overtime)
    .where('date', '>=', TS.fromDate(new Date(y, 0, 1)))
    .where('date', '<',  TS.fromDate(new Date(y + 1, 0, 1)))
    .orderBy('date', 'asc').get().then(snapList);
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

/* ---------- 10. 稽核 ---------- */
function writeAudit(action, targetId, before, after) {
  var u = currentUser();
  if (!u) return Promise.resolve();
  return db.collection(COL.audit).add({
    actorUid: u.uid, actorName: u.name, action: action,
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
  auth: auth, db: db, serverTimestamp: serverTimestamp, Timestamp: TS,
  HOURS_PER_DAY: HOURS_PER_DAY, MONTHLY_OT_CAP: MONTHLY_OT_CAP,
  ROLES: ROLES, ROLE_LABEL: ROLE_LABEL,
  LEAVE_TYPES: LEAVE_TYPES, STATUS: STATUS, STATUS_LABEL: STATUS_LABEL, COL: COL,
  leaveTypeLabel: leaveTypeLabel,
  toDate: toDate, ym: ym, fmtDate: fmtDate, fmtDateTime: fmtDateTime,
  roundHalf: roundHalf, splitByMonth: splitByMonth,
  annualLeaveDays: annualLeaveDays, annualLeaveHours: annualLeaveHours,
  idToEmail: idToEmail, currentUser: currentUser,
  ADMIN_PASSWORD: ADMIN_PASSWORD, VIEW_PASSWORD: VIEW_PASSWORD,
  isAdmin: isAdmin, isStaff: isStaff, canApply: canApply,
  loginOrRegister: loginOrRegister, setDisplayName: setDisplayName,
  adminLogin: adminLogin, adminLogout: adminLogout,
  viewerLogin: viewerLogin, viewerLogout: viewerLogout,
  signOut: signOut, changePassword: changePassword, watchAuth: watchAuth,
  listUsers: listUsers, getUser: getUser, upsertUser: upsertUser, setMerge: setMerge,
  getBalance: getBalance, watchBalance: watchBalance,
  submitLeave: submitLeave, reviewLeave: reviewLeave, cancelLeave: cancelLeave,
  submitOvertime: submitOvertime, reviewOvertime: reviewOvertime,
  watchMyLeaves: watchMyLeaves, watchPending: watchPending,
  watchPendingOvertime: watchPendingOvertime,
  fetchLeavesByYear: fetchLeavesByYear, fetchOvertimeByYear: fetchOvertimeByYear,
  buildYearMatrix: buildYearMatrix, writeAudit: writeAudit,
  el: el, els: els, esc: esc, toast: toast
};
})();
