/* ============================================================
 *  TPS 行政室請假加班系統  ——  shared.js
 *  Single Source of Truth：常數 / 認證 / 資料存取 / 業務邏輯
 *  改這支的時候記得同步 bump SHARED_VERSION，
 *  並更新各 HTML 的 ?v= 查詢參數（快取破壞）
 * ============================================================ */

export const SHARED_VERSION = '1.1.0';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut as fbSignOut, onAuthStateChanged, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, query, where, orderBy, limit, onSnapshot, runTransaction,
  serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ------------------------------------------------------------
 *  0. Firebase 設定  ← Chen 把 console 的 web config 貼進來
 * ---------------------------------------------------------- */
export const firebaseConfig = {
  apiKey:            'AIzaSyDI33EUxx1ZEqVdiLFMuNID4m7843gfQf8',
  authDomain:        'physics-b4c40.firebaseapp.com',
  projectId:         'physics-b4c40',
  storageBucket:     'physics-b4c40.firebasestorage.app',
  messagingSenderId: '494615768654',
  appId:             '1:494615768654:web:8d2e50ad3e32e97a199d1f',
  measurementId:     'G-HLXZNZ7WMJ',
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

/* ------------------------------------------------------------
 *  1. 常數
 * ---------------------------------------------------------- */
export const HOURS_PER_DAY = 7;          // 1 天 = 7 小時（待你爸確認）
export const MONTHLY_OT_CAP = 46;        // 勞基法：單月延長工時上限

export const ROLES = {
  PENDING: 'pending',  // 剛註冊，等秘書長指派身分
  STAFF:  'staff',    // 4 位秘書：可申請、只看自己的餘額
  VIEWER: 'viewer',   // 6 位檢視者：唯讀
  ADMIN:  'admin',    // 秘書長：審核、人員、餘額
};

export const ROLE_LABEL = {
  pending: '待開通', staff: '秘書', viewer: '檢視者', admin: '秘書長',
};

export const LEAVE_TYPES = [
  { id: 'annual',   label: '特別休假', deducts: 'annual' },
  { id: 'comp',     label: '加班補休', deducts: 'comp'   },
  { id: 'personal', label: '事假',     deducts: null     },
  { id: 'sick',     label: '病假',     deducts: null     },
  { id: 'period',   label: '生理假',   deducts: null     },
  { id: 'family',   label: '家庭照顧假', deducts: null   },
  { id: 'other',    label: '其他',     deducts: null, needsText: true },
];

export const STATUS = {
  PENDING:   'pending',
  APPROVED:  'approved',
  REJECTED:  'rejected',
  CANCELLED: 'cancelled',
};

export const STATUS_LABEL = {
  pending:   '待審核',
  approved:  '同意',
  rejected:  '不同意',
  cancelled: '已撤銷',
};

export const COL = {
  users:    'users',
  leave:    'leaveRequests',
  overtime: 'overtimeRequests',
  balances: 'balances',
  audit:    'auditLog',
  push:     'pushSubscriptions',   // 預留給之後的 Web Push
};

export const leaveTypeLabel = id =>
  (LEAVE_TYPES.find(t => t.id === id) || {}).label || id;

/* ------------------------------------------------------------
 *  2. 日期 / 時數工具
 * ---------------------------------------------------------- */
export const toDate = v =>
  v instanceof Timestamp ? v.toDate() : (v instanceof Date ? v : new Date(v));

export const ym = d => {
  const x = toDate(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};

export const fmtDate = d => {
  const x = toDate(d);
  return `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`;
};

export const fmtDateTime = d => {
  const x = toDate(d);
  const hh = String(x.getHours()).padStart(2, '0');
  const mm = String(x.getMinutes()).padStart(2, '0');
  return `${fmtDate(x)} ${hh}:${mm}`;
};

/** 時數一律以 0.5 為單位 */
export const roundHalf = n => Math.round(Number(n) * 2) / 2;

/** 是否為週一～週五（不含國定假日，之後可外掛行事曆） */
const isWorkday = d => { const w = d.getDay(); return w >= 1 && w <= 5; };

/**
 * 把一筆跨月假單按「工作日比例」拆成每月時數。
 * 這就是舊 Excel 最痛的那件事：跨月無法分開統計。
 * @returns [{ ym:'2025-03', hours: 7 }, { ym:'2025-04', hours: 14 }]
 */
export function splitByMonth(startAt, endAt, totalHours) {
  const s = toDate(startAt), e = toDate(endAt);
  const total = roundHalf(totalHours);
  if (!(total > 0)) return [];

  // 逐日掃描，統計每個月份的工作日數
  const perMonth = new Map();
  let workdays = 0;
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  while (cur <= last) {
    if (isWorkday(cur)) {
      const k = ym(cur);
      perMonth.set(k, (perMonth.get(k) || 0) + 1);
      workdays++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  // 整段都在假日（極少數情況）→ 全部歸到起始月
  if (workdays === 0) return [{ ym: ym(s), hours: total }];
  if (perMonth.size === 1) return [{ ym: ym(s), hours: total }];

  // 依工作日比例分配，最後一個月吸收四捨五入的誤差
  const keys = [...perMonth.keys()].sort();
  const out = [];
  let used = 0;
  keys.forEach((k, i) => {
    let h;
    if (i === keys.length - 1) h = roundHalf(total - used);
    else { h = roundHalf(total * perMonth.get(k) / workdays); used += h; }
    if (h > 0) out.push({ ym: k, hours: h });
  });
  return out;
}

/**
 * 勞基法 §38 特別休假日數
 * 0.5y→3、1y→7、2y→10、3~4y→14、5~9y→15、10y起每年+1，上限 30
 */
export function annualLeaveDays(hireDate, atDate = new Date()) {
  const h = toDate(hireDate), a = toDate(atDate);
  let years = a.getFullYear() - h.getFullYear();
  const anniv = new Date(h); anniv.setFullYear(h.getFullYear() + years);
  if (anniv > a) years--;

  const halfYear = new Date(h); halfYear.setMonth(h.getMonth() + 6);
  if (a < halfYear) return 0;
  if (years < 1)  return 3;
  if (years < 2)  return 7;
  if (years < 3)  return 10;
  if (years < 5)  return 14;
  if (years < 10) return 15;
  return Math.min(30, 15 + (years - 9));
}

export const annualLeaveHours = (hireDate, atDate) =>
  annualLeaveDays(hireDate, atDate) * HOURS_PER_DAY;

/* ------------------------------------------------------------
 *  3. 認證
 * ---------------------------------------------------------- */
let _currentUser = null;              // { uid, email, ...userDoc }
export const currentUser = () => _currentUser;
export const isAdmin   = () => _currentUser?.role === ROLES.ADMIN;
export const isStaff   = () => _currentUser?.role === ROLES.STAFF;
export const isPending = () => _currentUser?.role === ROLES.PENDING;
export const canApply  = () => isStaff() || isAdmin();

/** 使用者只輸入 ID，內部組成 Auth 用的 email。介面上不會出現這個網域。 */
const ID_DOMAIN = '@tps.local';
export const idToEmail = id => `${String(id).trim().toLowerCase()}${ID_DOMAIN}`;
export const emailToId = em => String(em || '').replace(ID_DOMAIN, '');

export const signInWithId = (id, password) =>
  signInWithEmailAndPassword(auth, idToEmail(id), password);

/**
 * 註冊：ID + 密碼 + 中文全名。
 * 建檔身分一律 pending，要秘書長在後台指派才能用。
 */
export async function registerAccount(id, password, fullName) {
  const cleanId = String(id).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,20}$/.test(cleanId))
    throw new Error('ID 只能用英文、數字、. _ -，長度 3–20 個字元');
  if (String(password).length < 6) throw new Error('密碼至少 6 個字元');
  const name = String(fullName).trim();
  if (!/^[\u4e00-\u9fa5]{2,10}$/.test(name))
    throw new Error('請填寫中文全名（2–10 個字）');

  const cred = await createUserWithEmailAndPassword(auth, idToEmail(cleanId), password);
  await setDoc(doc(db, COL.users, cred.user.uid), {
    loginId: cleanId,
    name,
    role: ROLES.PENDING,
    active: true,
    hireDate: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return cred.user.uid;
}

export const signOut = () => { _currentUser = null; return fbSignOut(auth); };

export const changePassword = newPw => updatePassword(auth.currentUser, newPw);

/**
 * 監聽登入狀態，並自動載入 users/{uid} 取得 role。
 * @param {(user:object|null)=>void} cb
 */
export function watchAuth(cb) {
  return onAuthStateChanged(auth, async fbUser => {
    if (!fbUser) { _currentUser = null; cb(null); return; }
    const snap = await getDoc(doc(db, COL.users, fbUser.uid));
    if (!snap.exists()) {          // 帳號存在但尚未被 admin 建檔
      _currentUser = null;
      cb({ uid: fbUser.uid, email: fbUser.email, role: null, orphan: true });
      return;
    }
    _currentUser = { uid: fbUser.uid, email: fbUser.email, ...snap.data() };
    cb(_currentUser);
  });
}

/* ------------------------------------------------------------
 *  4. 人員
 * ---------------------------------------------------------- */
export async function listUsers({ activeOnly = false } = {}) {
  const snap = await getDocs(collection(db, COL.users));
  let out = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  if (activeOnly) out = out.filter(u => u.active !== false);
  return out.sort((a, b) => (a.name || '').localeCompare(b.name, 'zh-Hant'));
}

export const getUser = async uid => {
  const s = await getDoc(doc(db, COL.users, uid));
  return s.exists() ? { uid, ...s.data() } : null;
};

export const upsertUser = (uid, data) =>
  setDoc(doc(db, COL.users, uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });

/* ------------------------------------------------------------
 *  5. 餘額
 * ---------------------------------------------------------- */
export async function getBalance(uid) {
  const s = await getDoc(doc(db, COL.balances, uid));
  return s.exists()
    ? s.data()
    : { annualRemaining: 0, compRemaining: 0, annualUsedYTD: 0, compUsedYTD: 0, carryOver: 0 };
}

export const watchBalance = (uid, cb) =>
  onSnapshot(doc(db, COL.balances, uid), s => cb(s.exists() ? s.data() : null));

/* ------------------------------------------------------------
 *  6. 請假
 * ---------------------------------------------------------- */
/**
 * 送出請假申請（不扣餘額，核准時才扣）
 */
export async function submitLeave({
  type, otherType = '', startAt, endAt, hours,
  annualHours = 0, compHours = 0,
  isLate = false, lateReason = '',
  needsProxy = false, proxyName = '',
}) {
  const u = currentUser();
  if (!u) throw new Error('尚未登入');
  if (!canApply()) throw new Error('此帳號沒有申請權限');

  const s = toDate(startAt), e = toDate(endAt);
  if (e <= s) throw new Error('結束時間必須晚於開始時間');

  const h = roundHalf(hours);
  if (!(h > 0)) throw new Error('請假時數必須大於 0');

  const def = LEAVE_TYPES.find(t => t.id === type);
  if (!def) throw new Error('假別不存在');
  if (def.needsText && !otherType.trim()) throw new Error('請填寫其他假別名稱');

  // 動用特休/補休時，時數必須等於總時數
  const a = def.deducts === 'annual' ? h : roundHalf(annualHours);
  const c = def.deducts === 'comp'   ? h : roundHalf(compHours);

  // 送出前先擋一次餘額不足（真正的把關在核准時的 transaction）
  if (a > 0 || c > 0) {
    const bal = await getBalance(u.uid);
    if (a > bal.annualRemaining) throw new Error(`特休不足，目前剩 ${bal.annualRemaining} 小時`);
    if (c > bal.compRemaining)   throw new Error(`補休不足，目前剩 ${bal.compRemaining} 小時`);
  }

  const ref = await addDoc(collection(db, COL.leave), {
    uid: u.uid, name: u.name, email: u.email,
    type, otherType: otherType.trim(),
    startAt: Timestamp.fromDate(s),
    endAt:   Timestamp.fromDate(e),
    hours: h,
    annualHours: a, compHours: c,
    segments: splitByMonth(s, e, h),
    isLate, lateReason, needsProxy, proxyName,
    status: STATUS.PENDING,
    reviewedBy: null, reviewedAt: null, adminNote: '',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

  await writeAudit('leave.submit', ref.id, null, { type, hours: h });
  return ref.id;
}

/**
 * 審核請假：核准時以 transaction 扣餘額（先讀後寫）
 */
export async function reviewLeave(leaveId, decision, adminNote = '') {
  if (!isAdmin()) throw new Error('只有秘書長可以審核');
  if (![STATUS.APPROVED, STATUS.REJECTED].includes(decision))
    throw new Error('決議不合法');

  const admin = currentUser();
  const leaveRef = doc(db, COL.leave, leaveId);

  await runTransaction(db, async tx => {
    /* ---- 先讀 ---- */
    const lSnap = await tx.get(leaveRef);
    if (!lSnap.exists()) throw new Error('假單不存在');
    const L = lSnap.data();
    if (L.status !== STATUS.PENDING) throw new Error('這張假單已經處理過了');

    let balRef = null, B = null;
    const needsDeduct = decision === STATUS.APPROVED
                        && (L.annualHours > 0 || L.compHours > 0);
    if (needsDeduct) {
      balRef = doc(db, COL.balances, L.uid);
      const bSnap = await tx.get(balRef);
      B = bSnap.exists()
        ? bSnap.data()
        : { annualRemaining: 0, compRemaining: 0, annualUsedYTD: 0, compUsedYTD: 0 };
      if (L.annualHours > B.annualRemaining)
        throw new Error(`特休不足：需要 ${L.annualHours}，剩 ${B.annualRemaining}`);
      if (L.compHours > B.compRemaining)
        throw new Error(`補休不足：需要 ${L.compHours}，剩 ${B.compRemaining}`);
    }

    /* ---- 後寫 ---- */
    tx.update(leaveRef, {
      status: decision,
      reviewedBy: admin.name,
      reviewedAt: serverTimestamp(),
      adminNote,
      updatedAt: serverTimestamp(),
    });

    if (needsDeduct) {
      tx.set(balRef, {
        annualRemaining: roundHalf(B.annualRemaining - L.annualHours),
        compRemaining:   roundHalf(B.compRemaining   - L.compHours),
        annualUsedYTD:   roundHalf((B.annualUsedYTD || 0) + L.annualHours),
        compUsedYTD:     roundHalf((B.compUsedYTD   || 0) + L.compHours),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  });

  await writeAudit('leave.review', leaveId, null, { decision, adminNote });
}

/**
 * 撤銷假單。本人只能撤 pending；admin 可撤已核准的並自動回補餘額。
 */
export async function cancelLeave(leaveId, reason = '') {
  const u = currentUser();
  const leaveRef = doc(db, COL.leave, leaveId);

  await runTransaction(db, async tx => {
    const lSnap = await tx.get(leaveRef);
    if (!lSnap.exists()) throw new Error('假單不存在');
    const L = lSnap.data();

    const mine = L.uid === u.uid;
    if (!isAdmin() && !(mine && L.status === STATUS.PENDING))
      throw new Error('沒有權限撤銷這張假單');
    if (L.status === STATUS.CANCELLED) throw new Error('已經撤銷過了');

    let balRef = null, B = null;
    const needsRefund = L.status === STATUS.APPROVED
                        && (L.annualHours > 0 || L.compHours > 0);
    if (needsRefund) {
      balRef = doc(db, COL.balances, L.uid);
      const bSnap = await tx.get(balRef);
      B = bSnap.exists() ? bSnap.data()
                         : { annualRemaining: 0, compRemaining: 0, annualUsedYTD: 0, compUsedYTD: 0 };
    }

    tx.update(leaveRef, {
      status: STATUS.CANCELLED,
      adminNote: reason || L.adminNote,
      cancelledBy: u.name,
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (needsRefund) {
      tx.set(balRef, {
        annualRemaining: roundHalf(B.annualRemaining + L.annualHours),
        compRemaining:   roundHalf(B.compRemaining   + L.compHours),
        annualUsedYTD:   roundHalf((B.annualUsedYTD || 0) - L.annualHours),
        compUsedYTD:     roundHalf((B.compUsedYTD   || 0) - L.compHours),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  });

  await writeAudit('leave.cancel', leaveId, null, { reason });
}

/* ------------------------------------------------------------
 *  7. 加班
 * ---------------------------------------------------------- */
export async function submitOvertime({
  date, startAt, endAt, hours, bonusHours = 0, reason = '',
}) {
  const u = currentUser();
  if (!u) throw new Error('尚未登入');

  const h = roundHalf(hours);
  if (!(h > 0)) throw new Error('加班時數必須大於 0');

  // 勞基法單月上限提醒（不硬擋，交給秘書長判斷）
  const used = await monthlyOvertimeHours(u.uid, ym(date));
  const overCap = used + h > MONTHLY_OT_CAP;

  const ref = await addDoc(collection(db, COL.overtime), {
    uid: u.uid, name: u.name, email: u.email,
    date: Timestamp.fromDate(toDate(date)),
    startAt: Timestamp.fromDate(toDate(startAt)),
    endAt:   Timestamp.fromDate(toDate(endAt)),
    hours: h,
    bonusHours: roundHalf(bonusHours),   // 核派加班增額
    ym: ym(date),
    reason,
    overCapWarning: overCap,
    status: STATUS.PENDING,
    reviewedBy: null, reviewedAt: null, adminNote: '',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

  await writeAudit('overtime.submit', ref.id, null, { hours: h, bonusHours });
  return { id: ref.id, overCapWarning: overCap };
}

/** 核准加班 → 補休餘額增加 (hours + bonusHours) */
export async function reviewOvertime(otId, decision, adminNote = '') {
  if (!isAdmin()) throw new Error('只有秘書長可以審核');
  const admin = currentUser();
  const otRef = doc(db, COL.overtime, otId);

  await runTransaction(db, async tx => {
    const oSnap = await tx.get(otRef);
    if (!oSnap.exists()) throw new Error('加班單不存在');
    const O = oSnap.data();
    if (O.status !== STATUS.PENDING) throw new Error('這張加班單已經處理過了');

    let balRef = null, B = null;
    if (decision === STATUS.APPROVED) {
      balRef = doc(db, COL.balances, O.uid);
      const bSnap = await tx.get(balRef);
      B = bSnap.exists() ? bSnap.data() : { compRemaining: 0, compEarnedYTD: 0 };
    }

    tx.update(otRef, {
      status: decision,
      reviewedBy: admin.name,
      reviewedAt: serverTimestamp(),
      adminNote,
      updatedAt: serverTimestamp(),
    });

    if (decision === STATUS.APPROVED) {
      const gain = roundHalf(O.hours + (O.bonusHours || 0));
      tx.set(balRef, {
        compRemaining: roundHalf((B.compRemaining || 0) + gain),
        compEarnedYTD: roundHalf((B.compEarnedYTD || 0) + gain),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  });

  await writeAudit('overtime.review', otId, null, { decision, adminNote });
}

async function monthlyOvertimeHours(uid, month) {
  const q = query(
    collection(db, COL.overtime),
    where('uid', '==', uid),
    where('ym', '==', month),
    where('status', 'in', [STATUS.PENDING, STATUS.APPROVED]),
  );
  const snap = await getDocs(q);
  return snap.docs.reduce((s, d) => s + (d.data().hours || 0), 0);
}

/* ------------------------------------------------------------
 *  8. 查詢 / 即時監聽
 * ---------------------------------------------------------- */
export const watchMyLeaves = (cb, n = 50) => onSnapshot(
  query(collection(db, COL.leave),
        where('uid', '==', currentUser().uid),
        orderBy('createdAt', 'desc'), limit(n)),
  s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
);

export const watchPending = cb => onSnapshot(
  query(collection(db, COL.leave),
        where('status', '==', STATUS.PENDING),
        orderBy('createdAt', 'asc')),
  s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
);

export const watchPendingOvertime = cb => onSnapshot(
  query(collection(db, COL.overtime),
        where('status', '==', STATUS.PENDING),
        orderBy('createdAt', 'asc')),
  s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
);

export async function fetchLeavesByYear(year) {
  const from = Timestamp.fromDate(new Date(year, 0, 1));
  const to   = Timestamp.fromDate(new Date(year + 1, 0, 1));
  const snap = await getDocs(query(
    collection(db, COL.leave),
    where('startAt', '>=', from), where('startAt', '<', to),
    orderBy('startAt', 'asc'),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchOvertimeByYear(year) {
  const from = Timestamp.fromDate(new Date(year, 0, 1));
  const to   = Timestamp.fromDate(new Date(year + 1, 0, 1));
  const snap = await getDocs(query(
    collection(db, COL.overtime),
    where('date', '>=', from), where('date', '<', to),
    orderBy('date', 'asc'),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ------------------------------------------------------------
 *  9. 統計（取代舊主表的所有公式）
 * ---------------------------------------------------------- */
/**
 * 產生 stats.html 用的年度矩陣。
 * @returns {
 *   months: ['2026-01', ...],
 *   leave:    { [uid]: { [typeId]: { [ym]: hours }, total } },
 *   overtime: { [uid]: { withBonus:{[ym]:h}, withoutBonus:{[ym]:h}, total, totalNoBonus } }
 * }
 */
export async function buildYearMatrix(year) {
  const [leaves, overtimes, users] = await Promise.all([
    fetchLeavesByYear(year), fetchOvertimeByYear(year), listUsers(),
  ]);

  const months = Array.from({ length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  const leaveOut = {}, otOut = {};
  users.forEach(u => {
    leaveOut[u.uid] = { name: u.name, total: 0 };
    LEAVE_TYPES.forEach(t => { leaveOut[u.uid][t.id] = {}; });
    otOut[u.uid] = { name: u.name, withBonus: {}, withoutBonus: {}, total: 0, totalNoBonus: 0 };
  });

  leaves.filter(l => l.status === STATUS.APPROVED).forEach(l => {
    const bucket = leaveOut[l.uid]; if (!bucket) return;
    // 用 segments 分月，跨月自動拆開 —— 這就是舊 Excel 做不到的地方
    (l.segments?.length ? l.segments : [{ ym: ym(l.startAt), hours: l.hours }])
      .forEach(seg => {
        if (!months.includes(seg.ym)) return;
        bucket[l.type][seg.ym] = roundHalf((bucket[l.type][seg.ym] || 0) + seg.hours);
        bucket.total = roundHalf(bucket.total + seg.hours);
      });
  });

  overtimes.filter(o => o.status === STATUS.APPROVED).forEach(o => {
    const b = otOut[o.uid]; if (!b || !months.includes(o.ym)) return;
    const withB = roundHalf(o.hours + (o.bonusHours || 0));
    b.withBonus[o.ym]    = roundHalf((b.withBonus[o.ym]    || 0) + withB);
    b.withoutBonus[o.ym] = roundHalf((b.withoutBonus[o.ym] || 0) + o.hours);
    b.total        = roundHalf(b.total + withB);
    b.totalNoBonus = roundHalf(b.totalNoBonus + o.hours);
  });

  return { year, months, leave: leaveOut, overtime: otOut, users };
}

/* ------------------------------------------------------------
 * 10. 稽核軌跡（假單永不刪除，只留軌跡）
 * ---------------------------------------------------------- */
export async function writeAudit(action, targetId, before, after) {
  const u = currentUser();
  if (!u) return;
  try {
    await addDoc(collection(db, COL.audit), {
      actorUid: u.uid, actorName: u.name,
      action, targetId, before: before || null, after: after || null,
      at: serverTimestamp(),
    });
  } catch (e) { console.warn('[audit] 寫入失敗（不影響主流程）', e); }
}

/* ------------------------------------------------------------
 * 11. 小工具
 * ---------------------------------------------------------- */
export const el = (sel, root = document) => root.querySelector(sel);
export const els = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-in'));
  setTimeout(() => { t.classList.remove('is-in'); setTimeout(() => t.remove(), 300); }, 2800);
}

console.info(`[TPS] shared.js v${SHARED_VERSION} loaded`);
