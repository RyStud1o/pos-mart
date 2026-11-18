/* =========================================================
   KOPMA MART POS — FIREBASE AUTH, FIRESTORE REALTIME & POS ENGINE
   Zona Waktu: WITA (Asia/Makassar) | Bahasa: ES Module JS
========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-analytics.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

// 1. INISIALISASI FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyBx7iGNL2vCZ_dYs_K4-Au6LLX59PWIv84",
  authDomain: "pos-mart-c4c9a.firebaseapp.com",
  projectId: "pos-mart-c4c9a",
  storageBucket: "pos-mart-c4c9a.firebasestorage.app",
  messagingSenderId: "635106298497",
  appId: "1:635106298497:web:3c45642dc94ebc7c8d9b80",
  measurementId: "G-72Y1YB6GQQ"
};

const app = initializeApp(firebaseConfig);
let analytics = null;
try { analytics = getAnalytics(app); } catch (e) { console.warn("Analytics skip:", e); }
const auth = getAuth(app);
const db = getFirestore(app);

// 2. STATE APLIKASI TERPUSAT
const state = {
  user: null,
  cashierName: localStorage.getItem("kopma_cashier_name") || "",
  sessionCode: localStorage.getItem("kopma_session_code") || generateSessionCode(),
  products: [],
  transactions: [],
  pettyCash: [],
  heldOrders: JSON.parse(localStorage.getItem("kopma_held_orders") || "[]"),
  cart: [],
  memberCheckedMap: {},
  selectedCategory: "Semua",
  searchQuery: "",
  memberFilterOnly: false,
  sortBy: "default",
  paymentMethod: "CASH",
  extraDiscount: 0,
  orderNote: "",
  beepEnabled: localStorage.getItem("kopma_beep") !== "off",
  highContrast: localStorage.getItem("kopma_contrast") === "on",
  settings: {
    storeName: "KOPMA MART",
    storeAddress: "Gedung Pusat Kegiatan Mahasiswa (PKM)",
    storeFooter: "Terima kasih telah berbelanja di Koperasi Mahasiswa!"
  },
  lastReceiptTx: null,
  paidResetTimer: null,
  unsubProducts: null,
  unsubTx: null,
  unsubPetty: null,
  unsubCustomerSession: null
};

// 3. UTILITAS WAKTU WITA (Asia/Makassar) & FORMAT RUPIAH
function getWitaNow() {
  const now = new Date();
  const timeStr = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Makassar",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now).replace(/\./g, ":");

  const dateStr = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Makassar",
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(now);

  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now).replace(/-/g, "");

  return { timeStr: `${timeStr} WITA`, dateStr, ymd, fullStr: `${dateStr}, ${timeStr} WITA` };
}

function formatRupiah(num) {
  const n = Math.round(Number(num) || 0);
  return "Rp " + n.toLocaleString("id-ID");
}

function generateSessionCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "KPM";
  for (let i = 0; i < 3; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  localStorage.setItem("kopma_session_code", code);
  return code;
}

function playBeep(freq = 880, duration = 0.07) {
  if (!state.beepEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* Ignore audio block */ }
}

function showToast(msg) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  container.appendChild(el);
  const announcer = document.getElementById("ariaAnnouncer");
  if (announcer) announcer.textContent = msg;
  setTimeout(() => el.remove(), 3800);
}

function formatFirestoreError(err, fallbackMsg) {
  if (!err) return fallbackMsg;
  if (err.code === "permission-denied") {
    return "Akses Firestore ditolak (Permission Denied). Pastikan Firestore Rules sudah di-Publish di Firebase Console.";
  }
  if (err.code === "unavailable") {
    return "Koneksi ke server Firestore terputus. Periksa jaringan internet Anda.";
  }
  return `${fallbackMsg} (${err.code || err.message})`;
}

// =========================================================
// SISTEM POP-UP DIALOG KUSTOM PROFESIONAL (PENGGANTI ALERT/CONFIRM/PROMPT)
// =========================================================
function initCustomDialogSystem() {
  if (document.getElementById("kopmaCustomDialogOverlay")) return;

  const style = document.createElement("style");
  style.textContent = `
    #kopmaCustomDialogOverlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.62);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 99999;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.18s ease, visibility 0.18s ease;
    }
    #kopmaCustomDialogOverlay.open {
      opacity: 1;
      visibility: visible;
    }
    .kcd-card {
      background: #ffffff;
      color: #0f172a;
      width: 100%;
      max-width: 420px;
      border-radius: 16px;
      box-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.28);
      border: 1px solid #e2e8f0;
      overflow: hidden;
      transform: translateY(10px) scale(0.97);
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: inherit;
    }
    #kopmaCustomDialogOverlay.open .kcd-card {
      transform: translateY(0) scale(1);
    }
    .kcd-body {
      padding: 24px 24px 18px;
    }
    .kcd-header-row {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }
    .kcd-icon-wrap {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .kcd-icon-wrap.danger {
      background: #fef2f2;
      color: #dc2626;
      border: 1px solid #fecaca;
    }
    .kcd-icon-wrap.warning {
      background: #fffbeb;
      color: #d97706;
      border: 1px solid #fde68a;
    }
    .kcd-icon-wrap.emerald {
      background: #ecfdf5;
      color: #059669;
      border: 1px solid #a7f3d0;
    }
    .kcd-badge {
      display: inline-block;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 3px;
    }
    .kcd-title {
      font-size: 1.08rem;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 6px;
      line-height: 1.3;
    }
    .kcd-message {
      font-size: 0.88rem;
      color: #475569;
      line-height: 1.55;
      margin: 0;
    }
    .kcd-input-wrap {
      margin-top: 14px;
    }
    .kcd-input {
      width: 100%;
      padding: 10px 12px;
      border: 1.5px solid #cbd5e1;
      border-radius: 10px;
      font-size: 0.92rem;
      color: #0f172a;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      box-sizing: border-box;
    }
    .kcd-input:focus {
      border-color: #047857;
      box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.14);
    }
    .kcd-footer {
      background: #f8fafc;
      padding: 14px 24px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .kcd-btn {
      padding: 9px 16px;
      border-radius: 10px;
      font-size: 0.86rem;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }
    .kcd-btn-cancel {
      background: #ffffff;
      color: #475569;
      border-color: #cbd5e1;
    }
    .kcd-btn-cancel:hover {
      background: #f1f5f9;
      color: #0f172a;
    }
    .kcd-btn-emerald {
      background: #065f46;
      color: #ffffff;
    }
    .kcd-btn-emerald:hover {
      background: #047857;
    }
    .kcd-btn-danger {
      background: #dc2626;
      color: #ffffff;
    }
    .kcd-btn-danger:hover {
      background: #b91c1c;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "kopmaCustomDialogOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="kcd-card">
      <div class="kcd-body">
        <div class="kcd-header-row">
          <div id="kcdIconWrap" class="kcd-icon-wrap emerald"></div>
          <div style="flex:1; min-width:0;">
            <span class="kcd-badge">KOPMA MART POS • KONFIRMASI</span>
            <h3 id="kcdTitle" class="kcd-title">Konfirmasi Tindakan</h3>
            <p id="kcdMessage" class="kcd-message"></p>
            <div id="kcdInputWrap" class="kcd-input-wrap hidden">
              <input id="kcdInput" type="text" class="kcd-input" />
            </div>
          </div>
        </div>
      </div>
      <div class="kcd-footer">
        <button type="button" id="kcdBtnCancel" class="kcd-btn kcd-btn-cancel">Batal</button>
        <button type="button" id="kcdBtnConfirm" class="kcd-btn kcd-btn-emerald">Ya, Lanjutkan</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function showKopmaDialog({
  title = "Konfirmasi",
  message = "",
  variant = "emerald", // "emerald" | "danger" | "warning"
  confirmText = "Ya, Lanjutkan",
  cancelText = "Batal",
  withInput = false,
  inputPlaceholder = "",
  inputDefaultValue = ""
}) {
  initCustomDialogSystem();

  return new Promise((resolve) => {
    const overlay = document.getElementById("kopmaCustomDialogOverlay");
    const iconWrap = document.getElementById("kcdIconWrap");
    const titleEl = document.getElementById("kcdTitle");
    const msgEl = document.getElementById("kcdMessage");
    const inputWrap = document.getElementById("kcdInputWrap");
    const inputEl = document.getElementById("kcdInput");
    const btnCancel = document.getElementById("kcdBtnCancel");
    const btnConfirm = document.getElementById("kcdBtnConfirm");

    const icons = {
      danger: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      warning: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      emerald: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    };

    iconWrap.className = `kcd-icon-wrap ${variant}`;
    iconWrap.innerHTML = icons[variant] || icons.emerald;
    titleEl.textContent = title;
    msgEl.innerHTML = message;

    btnCancel.textContent = cancelText;
    btnConfirm.textContent = confirmText;
    btnConfirm.className = `kcd-btn ${variant === "danger" ? "kcd-btn-danger" : "kcd-btn-emerald"}`;

    if (withInput) {
      inputWrap.classList.remove("hidden");
      inputEl.placeholder = inputPlaceholder;
      inputEl.value = inputDefaultValue;
    } else {
      inputWrap.classList.add("hidden");
      inputEl.value = "";
    }

    overlay.classList.add("open");
    setTimeout(() => {
      if (withInput) {
        inputEl.focus();
        inputEl.select();
      } else {
        btnConfirm.focus();
      }
    }, 30);

    const cleanup = (result) => {
      overlay.classList.remove("open");
      btnCancel.removeEventListener("click", onCancel);
      btnConfirm.removeEventListener("click", onConfirm);
      overlay.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onCancel = () => cleanup(withInput ? null : false);
    const onConfirm = () => cleanup(withInput ? inputEl.value : true);
    const onBackdrop = (e) => {
      if (e.target === overlay) onCancel();
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && withInput) {
        e.preventDefault();
        onConfirm();
      }
    };

    btnCancel.addEventListener("click", onCancel);
    btnConfirm.addEventListener("click", onConfirm);
    overlay.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

// 4. JAM REALTIME WITA DI SEMUA VIEW
function startWitaClocks() {
  const update = () => {
    const { timeStr, dateStr } = getWitaNow();
    ["authWitaClock", "sidebarClockWita", "topbarClockWita", "custClockWita"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = timeStr;
    });
    const dashDate = document.getElementById("dashDateBadge");
    if (dashDate) dashDate.textContent = `${dateStr} • Zona WITA`;
  };
  update();
  setInterval(update, 1000);
}

// 5. FIREBASE AUTHENTICATION
function initAuthFlow() {
  const loginForm = document.getElementById("loginForm");
  const emailInput = document.getElementById("loginEmail");
  const passInput = document.getElementById("loginPassword");
  const cashierInput = document.getElementById("loginCashierName");
  const rememberCheck = document.getElementById("loginRememberMe");
  const errorBox = document.getElementById("loginErrorBox");

  const savedEmail = localStorage.getItem("kopma_remember_email");
  if (savedEmail) emailInput.value = savedEmail;
  if (state.cashierName) cashierInput.value = state.cashierName;

  document.getElementById("btnTogglePassword").addEventListener("click", () => {
    passInput.type = passInput.type === "password" ? "text" : "password";
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.classList.add("hidden");

    const email = emailInput.value.trim();
    const password = passInput.value;
    const cashierName = cashierInput.value.trim();

    if (!email || !password || !cashierName) {
      errorBox.textContent = "Harap isi Email, Password, dan Nama Kasir yang piket.";
      errorBox.classList.remove("hidden");
      return;
    }

    const btn = document.getElementById("btnLoginSubmit");
    btn.disabled = true;
    btn.innerHTML = `<span>Memverifikasi Akun Firebase...</span>`;

    try {
      await setPersistence(auth, rememberCheck.checked ? browserLocalPersistence : browserSessionPersistence);
      if (rememberCheck.checked) {
        localStorage.setItem("kopma_remember_email", email);
      } else {
        localStorage.removeItem("kopma_remember_email");
      }
      state.cashierName = cashierName;
      localStorage.setItem("kopma_cashier_name", cashierName);

      await signInWithEmailAndPassword(auth, email, password);
      playBeep(1040, 0.12);
      showToast(`Selamat bertugas, ${cashierName}!`);
    } catch (err) {
      let msg = "Gagal login ke Firebase. Periksa kembali Email & Password.";
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        msg = "Email atau Kata Sandi salah. Jika belum memiliki akun, silakan hubungi Operator Koperasi.";
      } else if (err.code === "auth/too-many-requests") {
        msg = "Terlalu banyak percobaan login gagal. Coba beberapa saat lagi atau hubungi Operator.";
      } else if (err.code === "auth/network-request-failed") {
        msg = "Koneksi internet terputus. Pastikan perangkat terhubung ke jaringan.";
      }
      errorBox.textContent = msg;
      errorBox.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="log-in" class="icon-sm"></i><span>Masuk & Mulai Shift Kasir</span>`;
      if (window.lucide) lucide.createIcons();
    }
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      state.user = user;
      if (!state.cashierName) {
        state.cashierName = user.email.split("@")[0];
      }
      enterCashierWorkspace();
    } else {
      state.user = null;
      exitCashierWorkspace();
    }
  });

  document.getElementById("btnLogout").addEventListener("click", async () => {
    const ok = await showKopmaDialog({
      title: "Keluar dari Sesi Kasir?",
      message: `Anda login sebagai <strong>${state.cashierName}</strong>. Pastikan seluruh transaksi shift telah direkap sebelum keluar.`,
      variant: "warning",
      confirmText: "Ya, Keluar Shift",
      cancelText: "Tetap di Kasir"
    });
    if (!ok) return;
    await signOut(auth);
    showToast("Berhasil keluar dari akun kasir.");
  });
}

function enterCashierWorkspace() {
  document.getElementById("authGateView").classList.add("hidden");
  document.getElementById("customerDisplayView").classList.add("hidden");
  document.getElementById("posAppShell").classList.remove("hidden");

  document.getElementById("activeCashierName").textContent = state.cashierName;
  document.getElementById("activeCashierEmail").textContent = state.user?.email || "-";
  document.getElementById("cashierAvatar").textContent = state.cashierName.charAt(0).toUpperCase();
  updateSessionCodeUI();

  startFirestoreListeners();
  syncLiveSessionToFirestore("IDLE");
}

function exitCashierWorkspace() {
  if (state.unsubProducts) state.unsubProducts();
  if (state.unsubTx) state.unsubTx();
  if (state.unsubPetty) state.unsubPetty();

  document.getElementById("posAppShell").classList.add("hidden");
  document.getElementById("customerDisplayView").classList.add("hidden");
  document.getElementById("authGateView").classList.remove("hidden");
}

// 6. FIRESTORE REALTIME LISTENERS
function startFirestoreListeners() {
  if (state.unsubProducts) state.unsubProducts();
  if (state.unsubTx) state.unsubTx();
  if (state.unsubPetty) state.unsubPetty();

  const productsRef = collection(db, "kopma_products");
  state.unsubProducts = onSnapshot(productsRef, (snap) => {
    const items = [];
    snap.forEach((docSnap) => {
      items.push({ id: docSnap.id, ...docSnap.data() });
    });
    items.sort((a, b) => (a.sku || a.id).localeCompare(b.sku || b.id));
    state.products = items;

    const banner = document.getElementById("emptyCatalogBanner");
    if (banner) {
      banner.classList.toggle("hidden", items.length > 0);
    }

    renderCategoryPills();
    renderProductGrid();
    renderInventoryTable();
    renderDashboard();
  }, (err) => {
    console.error("Firestore products error:", err);
    showToast(formatFirestoreError(err, "Gagal menyinkronkan produk Firestore"));
  });

  const txQuery = query(collection(db, "kopma_transactions"), orderBy("createdAtMs", "desc"), limit(200));
  state.unsubTx = onSnapshot(txQuery, (snap) => {
    const list = [];
    snap.forEach((docSnap) => {
      list.push({ id: docSnap.id, ...docSnap.data() });
    });
    state.transactions = list;
    renderTransactionsTable();
    renderDashboard();
  }, (err) => {
    console.error("Firestore transactions error:", err);
  });

  const pettyQuery = query(collection(db, "kopma_petty_cash"), orderBy("createdAtMs", "desc"), limit(100));
  state.unsubPetty = onSnapshot(pettyQuery, (snap) => {
    const list = [];
    snap.forEach((docSnap) => {
      list.push({ id: docSnap.id, ...docSnap.data() });
    });
    state.pettyCash = list;
    renderPettyCashList();
    renderDashboard();
  }, (err) => {
    console.error("Firestore petty cash error:", err);
  });

  getDoc(doc(db, "kopma_config", "store_profile"))
    .then((docSnap) => {
      if (docSnap.exists()) {
        state.settings = { ...state.settings, ...docSnap.data() };
        applySettingsToUI();
      }
    })
    .catch((err) => console.warn("Store config read skip:", err.code));
}

function applySettingsToUI() {
  document.getElementById("sidebarStoreName").textContent = state.settings.storeName;
  document.getElementById("setStoreName").value = state.settings.storeName;
  document.getElementById("setStoreAddress").value = state.settings.storeAddress;
  document.getElementById("setStoreFooter").value = state.settings.storeFooter;
}

// 7. REALTIME SYNC ANTARA KASIR UTAMA & LAYAR PEMBELI
function updateSessionCodeUI() {
  document.getElementById("sessionCodeDisplay").textContent = state.sessionCode;
  document.getElementById("topbarSessionCode").textContent = state.sessionCode;
}

async function syncLiveSessionToFirestore(stage = "SHOPPING", extraPayload = {}) {
  if (!state.user) return;

  // Jika kasir memulai transaksi baru atau kembali IDLE, batalkan timer reset sebelumnya
  if (stage !== "PAID" && state.paidResetTimer) {
    clearTimeout(state.paidResetTimer);
    state.paidResetTimer = null;
  }

  const isIdleReset = stage === "IDLE" && state.cart.length === 0;
  const totals = calculateCartTotals();

  try {
    await setDoc(doc(db, "kopma_live_sessions", state.sessionCode), {
      sessionCode: state.sessionCode,
      storeName: state.settings.storeName,
      cashierName: state.cashierName,
      stage,
      items: isIdleReset ? [] : state.cart.map(item => ({
        name: item.name,
        qty: item.qty,
        isMember: item.isMember,
        unitPrice: item.isMember && item.memberPrice ? item.memberPrice : item.price,
        normalPrice: item.price
      })),
      subtotal: isIdleReset ? 0 : totals.subtotalNormal,
      memberSaved: isIdleReset ? 0 : totals.memberSaved,
      extraDiscount: isIdleReset ? 0 : totals.extraDiscount,
      grandTotal: isIdleReset ? 0 : totals.grandTotal,
      paymentMethod: isIdleReset ? "CASH" : state.paymentMethod,
      lastMethod: isIdleReset ? null : (extraPayload.lastMethod ?? null),
      lastChange: isIdleReset ? 0 : (extraPayload.lastChange ?? 0),
      lastInvoice: isIdleReset ? null : (extraPayload.lastInvoice ?? null),
      updatedAtWita: getWitaNow().fullStr
    }, { merge: true });
  } catch (err) {
    console.error("Live session sync error:", err);
    if (err.code === "permission-denied") {
      showToast("Gagal membuat sesi Layar Pembeli: Firestore Rules belum di-Publish.");
    }
  }
}

function initCustomerDisplayPortal() {
  const authGate = document.getElementById("authGateView");
  const custView = document.getElementById("customerDisplayView");
  const pairingScreen = document.getElementById("pairingScreen");
  const activeScreen = document.getElementById("activeCustomerScreen");
  const pairingForm = document.getElementById("pairingForm");

  document.getElementById("btnOpenCustomerPortal").addEventListener("click", () => {
    authGate.classList.add("hidden");
    custView.classList.remove("hidden");
    pairingScreen.classList.remove("hidden");
    activeScreen.classList.add("hidden");
    document.getElementById("pairingError").classList.add("hidden");
    document.getElementById("pairingCodeInput").focus();
  });

  document.getElementById("btnBackToLogin").addEventListener("click", () => {
    if (state.unsubCustomerSession) state.unsubCustomerSession();
    custView.classList.add("hidden");
    authGate.classList.remove("hidden");
  });

  pairingForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("pairingCodeInput").value.trim().toUpperCase();
    const errEl = document.getElementById("pairingError");
    const submitBtn = pairingForm.querySelector('button[type="submit"]');
    errEl.classList.add("hidden");

    if (code.length < 4) {
      errEl.textContent = "Masukkan 6 digit kode sesi yang tampil di layar Kasir Utama.";
      errEl.classList.remove("hidden");
      return;
    }

    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>Menghubungkan ke Sesi ${code}...</span>`;
    }

    try {
      const sessionRef = doc(db, "kopma_live_sessions", code);
      const snap = await getDoc(sessionRef);

      if (!snap.exists()) {
        errEl.textContent = `Kode sesi "${code}" belum ditemukan. Pastikan perangkat Kasir Utama sudah login dan kode sesinya cocok.`;
        errEl.classList.remove("hidden");
        return;
      }

      pairingScreen.classList.add("hidden");
      activeScreen.classList.remove("hidden");
      document.getElementById("custSessionBadge").textContent = code;
      renderCustomerDisplayData(snap.data());

      if (state.unsubCustomerSession) state.unsubCustomerSession();
      state.unsubCustomerSession = onSnapshot(sessionRef, (liveSnap) => {
        if (!liveSnap.exists()) return;
        renderCustomerDisplayData(liveSnap.data());
      }, (snapErr) => {
        console.error("Realtime listener error:", snapErr);
        errEl.textContent = formatFirestoreError(snapErr, "Sinkronisasi realtime terputus");
        errEl.classList.remove("hidden");
      });
    } catch (err) {
      console.error("Pairing failed:", err);
      errEl.textContent = formatFirestoreError(err, "Gagal menghubungkan ke perangkat Kasir Utama");
      errEl.classList.remove("hidden");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
        if (window.lucide) lucide.createIcons();
      }
    }
  });

  document.getElementById("btnDisconnectCustomer").addEventListener("click", () => {
    if (state.unsubCustomerSession) state.unsubCustomerSession();
    activeScreen.classList.add("hidden");
    pairingScreen.classList.remove("hidden");
  });
}

function renderCustomerDisplayData(data) {
  document.getElementById("custStoreName").textContent = data.storeName || "KOPMA MART";
  document.getElementById("custCashierInfo").innerHTML =
    `Kasir Piket: <strong>${data.cashierName || "-"}</strong> • Sesi: <strong id="custSessionBadge">${data.sessionCode}</strong>`;

  const isIdle = data.stage === "IDLE";
  const items = isIdle ? [] : (data.items || []);
  const totalQty = items.reduce((sum, i) => sum + i.qty, 0);
  document.getElementById("custItemCount").textContent = `${totalQty} Item`;

  const listEl = document.getElementById("custItemsList");
  if (items.length === 0 && data.stage !== "PAID") {
    listEl.innerHTML = `
      <div class="empty-state">
        <i data-lucide="shopping-bag" class="icon-xl"></i>
        <h3>Selamat Datang di ${data.storeName || "KOPMA MART"}</h3>
        <p>Daftar belanjaan Anda akan muncul di layar ini secara realtime saat kasir memindai produk.</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
  } else if (items.length > 0) {
    listEl.innerHTML = items.map(item => `
      <div class="cust-item-row">
        <div>
          <strong style="font-size:1.05rem;">${item.name}</strong>
          <div style="font-size:0.82rem; color:#94a3b8;">
            ${item.qty} x ${formatRupiah(item.unitPrice)}
            ${item.isMember ? `<span style="color:#34d399; font-weight:700; margin-left:6px;">[HARGA ANGGOTA]</span>` : ""}
          </div>
        </div>
        <strong class="mono-text" style="font-size:1.15rem; color:#fbbf24;">${formatRupiah(item.qty * item.unitPrice)}</strong>
      </div>
    `).join("");
  }

  document.getElementById("custGrandTotal").textContent = formatRupiah(isIdle ? 0 : (data.grandTotal || 0));
  document.getElementById("custSubtotal").textContent = formatRupiah(isIdle ? 0 : (data.subtotal || 0));
  document.getElementById("custMemberSaved").textContent = `- ${formatRupiah(isIdle ? 0 : (data.memberSaved || 0))}`;

  const extraRow = document.getElementById("custExtraDiscRow");
  if (!isIdle && (data.extraDiscount || 0) > 0) {
    extraRow.classList.remove("hidden");
    document.getElementById("custExtraDisc").textContent = `- ${formatRupiah(data.extraDiscount)}`;
  } else {
    extraRow.classList.add("hidden");
  }

  const stageBox = document.getElementById("custPaymentStage");
  if (data.stage === "PAID") {
    stageBox.innerHTML = `
      <div style="padding:16px;">
        <div style="font-size:2.4rem; color:#34d399; margin-bottom:8px;">✓ LUNAS</div>
        <h3 style="font-size:1.35rem; margin-bottom:6px;">Terima Kasih Telah Berbelanja!</h3>
        <p style="color:#cbd5e1; font-size:0.92rem;">Metode: <strong>${data.lastMethod || "CASH"}</strong></p>
        ${data.lastMethod === "CASH" ? `
          <div style="margin-top:12px; background:#064e3b; padding:12px; border-radius:10px;">
            <span style="font-size:0.8rem; color:#a7f3d0;">KEMBALIAN ANDA</span>
            <div class="mono-text" style="font-size:1.8rem; font-weight:800; color:#fbbf24;">${formatRupiah(data.lastChange || 0)}</div>
          </div>` : `<p style="color:#6ee7b7; margin-top:8px;">Pembayaran QRIS Terverifikasi Lunas</p>`}
        <p style="color:#94a3b8; font-size:0.76rem; margin-top:12px;">Layar otomatis kembali kosong untuk pembeli berikutnya...</p>
      </div>`;
  } else if (!isIdle && data.paymentMethod === "QRIS" && (data.grandTotal || 0) > 0) {
    stageBox.innerHTML = `
      <div style="padding:12px;">
        <span style="background:#f59e0b; color:#020617; font-weight:800; font-size:0.75rem; padding:4px 10px; border-radius:999px;">PEMBAYARAN QRIS</span>
        <h3 style="margin:10px 0 6px; font-size:1.2rem;">Silakan Scan QRIS Koperasi</h3>
        <p style="color:#cbd5e1; font-size:0.88rem;">Nominal transfer tepat sebesar:</p>
        <div class="mono-text" style="font-size:1.9rem; font-weight:800; color:#fbbf24; margin-top:4px;">${formatRupiah(data.grandTotal)}</div>
      </div>`;
  } else {
    stageBox.innerHTML = `
      <div class="stage-idle">
        <i data-lucide="scan-line" class="icon-lg" style="color:#34d399;"></i>
        <h3 style="margin:8px 0 4px;">Menunggu Konfirmasi Kasir</h3>
        <p style="color:#94a3b8; font-size:0.85rem;">Sebutkan status keanggotaan Koperasi Anda untuk menikmati potongan harga khusus anggota.</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
  }
}

// 8. UPLOAD FILE JSON KE FIREBASE FIRESTORE (BATCH WRITE)
function initJsonImportExport() {
  const fileInput = document.getElementById("jsonFileInput");
  const triggerUpload = () => fileInput.click();

  ["btnQuickUploadJsonTop", "btnDashUploadJson", "btnBannerUploadJson", "btnInvUploadJson"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", triggerUpload);
  });

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!state.user) {
      showToast("Harap login sebagai kasir terlebih dahulu sebelum mengunggah data JSON.");
      fileInput.value = "";
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed.products;

      if (!Array.isArray(list) || list.length === 0) {
        showToast("Format JSON tidak valid atau daftar produk kosong.");
        return;
      }

      showToast(`Mengunggah ${list.length} produk ke Firebase Firestore...`);

      const chunkSize = 400;
      for (let i = 0; i < list.length; i += chunkSize) {
        const batch = writeBatch(db);
        const chunk = list.slice(i, i + chunkSize);
        chunk.forEach((item, idx) => {
          const rawId = String(item.id || item.sku || `PRD-${String(i + idx + 1).padStart(3, "0")}`).trim();
          const docId = rawId.replace(/\//g, "-");
          const ref = doc(db, "kopma_products", docId);
          batch.set(ref, {
            sku: item.sku || docId,
            name: String(item.name || "Produk Tanpa Nama").trim(),
            price: Number(item.price) || 0,
            memberPrice: item.memberPrice !== null && item.memberPrice !== undefined && item.memberPrice !== ""
              ? Number(item.memberPrice)
              : null,
            category: item.category || "Snack & Permen",
            stock: Number(item.stock ?? 25),
            minStock: Number(item.minStock ?? 5),
            pinned: Boolean(item.pinned),
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
      }

      playBeep(1100, 0.14);
      showToast(`Berhasil memuat ${list.length} produk ke Firestore!`);
    } catch (err) {
      console.error("JSON upload error:", err);
      if (err instanceof SyntaxError) {
        showToast("Format file JSON rusak/tidak valid. Periksa tanda koma atau kurung di file JSON.");
      } else {
        showToast(formatFirestoreError(err, "Gagal menyimpan produk JSON ke Firestore"));
      }
    } finally {
      fileInput.value = "";
    }
  });

  document.getElementById("btnDownloadTemplateJson").addEventListener("click", () => {
    const payload = {
      meta: {
        exportedAtWita: getWitaNow().fullStr,
        totalItems: state.products.length
      },
      products: state.products
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-kopma-mart-${getWitaNow().ymd}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// 9. RENDER KATALOG PRODUK & CHECKBOX ANGGOTA PER ITEM
function renderCategoryPills() {
  const categories = ["Semua", ...new Set(state.products.map(p => p.category || "Lainnya"))];
  const container = document.getElementById("categoryTabs");
  container.innerHTML = categories.map(cat => `
    <button type="button" class="cat-pill ${state.selectedCategory === cat ? "active" : ""}" data-cat="${cat}">
      ${cat}
    </button>
  `).join("");

  container.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedCategory = btn.dataset.cat;
      renderCategoryPills();
      renderProductGrid();
    });
  });
}

function getFilteredProducts() {
  let list = [...state.products];

  if (state.selectedCategory !== "Semua") {
    list = list.filter(p => p.category === state.selectedCategory);
  }
  if (state.memberFilterOnly) {
    list = list.filter(p => p.memberPrice !== null && p.memberPrice < p.price);
  }
  if (state.searchQuery.trim() !== "") {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q))
    );
  }

  if (state.sortBy === "price-asc") list.sort((a, b) => a.price - b.price);
  else if (state.sortBy === "price-desc") list.sort((a, b) => b.price - a.price);
  else if (state.sortBy === "stock-asc") list.sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
  else {
    list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }
  return list;
}

function renderProductGrid() {
  const grid = document.getElementById("productGrid");
  const filtered = getFilteredProducts();
  document.getElementById("catalogResultInfo").textContent =
    `Menampilkan ${filtered.length} dari ${state.products.length} produk`;

  if (state.products.length === 0) {
    grid.innerHTML = `
      <div class="card" style="grid-column: 1 / -1; text-align:center; padding:42px 20px;">
        <h3>Katalog Produk Masih Kosong</h3>
        <p style="color:var(--slate-500); margin:6px 0 16px;">Unggah file <strong>produk-kopma-mart.json</strong> untuk mengisi seluruh database produk.</p>
        <button type="button" class="btn btn-emerald" onclick="document.getElementById('jsonFileInput').click()">Upload File JSON</button>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="card" style="grid-column: 1 / -1; text-align:center; padding:32px;">Tidak ada barang yang cocok dengan pencarian Anda.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(prod => {
    const hasMember = prod.memberPrice !== null && prod.memberPrice < prod.price;
    const isChecked = Boolean(state.memberCheckedMap[prod.id]);
    const activePrice = hasMember && isChecked ? prod.memberPrice : prod.price;
    const isLowStock = (prod.stock ?? 0) <= (prod.minStock ?? 5);

    return `
      <article class="product-card ${hasMember ? "has-member" : ""}" role="listitem">
        <div>
          <div class="pc-top">
            <span class="pc-cat">${prod.category || "Umum"}</span>
            <span class="pc-stock ${isLowStock ? "low" : ""}">Stok: ${prod.stock ?? 0}</span>
            <button type="button" class="btn-pin ${prod.pinned ? "pinned" : ""}" data-pin-id="${prod.id}" title="Sematkan Produk Favorit">★</button>
          </div>
          <h3 class="pc-name" style="margin-top:6px;">${prod.name}</h3>
        </div>

        <div>
          <div class="pc-price-row">
            <span class="pc-price">${formatRupiah(prod.price)}</span>
            ${hasMember ? `<span class="pc-member-badge">Anggota: ${formatRupiah(prod.memberPrice)}</span>` : ""}
          </div>

          <div style="margin:8px 0;">
            ${hasMember ? `
              <label class="pc-member-check">
                <input type="checkbox" data-member-toggle="${prod.id}" ${isChecked ? "checked" : ""} />
                <span>Pembeli Anggota (${formatRupiah(prod.memberPrice)})</span>
              </label>
            ` : `<div class="pc-no-member">Harga Umum &amp; Anggota Sama</div>`}
          </div>

          <button type="button" class="btn btn-emerald btn-sm btn-full touch-target" data-add-id="${prod.id}">
            + Tambah • ${formatRupiah(activePrice)}
          </button>
        </div>
      </article>
    `;
  }).join("");

  grid.querySelectorAll("[data-member-toggle]").forEach(chk => {
    chk.addEventListener("change", (e) => {
      state.memberCheckedMap[chk.dataset.memberToggle] = e.target.checked;
      renderProductGrid();
    });
  });

  grid.querySelectorAll("[data-add-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const prod = state.products.find(p => p.id === btn.dataset.addId);
      if (prod) addToCart(prod, Boolean(state.memberCheckedMap[prod.id]));
    });
  });

  grid.querySelectorAll("[data-pin-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const prod = state.products.find(p => p.id === btn.dataset.pinId);
      if (prod) {
        try {
          await updateDoc(doc(db, "kopma_products", prod.id), { pinned: !prod.pinned });
        } catch (err) {
          showToast(formatFirestoreError(err, "Gagal menyematkan produk"));
        }
      }
    });
  });
}

// 10. KERANJANG BELANJA & SINKRONISASI REALTIME KE LAYAR PEMBELI
function addToCart(prod, isMember = false) {
  const canMember = prod.memberPrice !== null && prod.memberPrice < prod.price;
  const applyMember = canMember && isMember;

  const existing = state.cart.find(c => c.id === prod.id && c.isMember === applyMember);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      id: prod.id,
      sku: prod.sku,
      name: prod.name,
      price: prod.price,
      memberPrice: prod.memberPrice,
      isMember: applyMember,
      qty: 1
    });
  }

  playBeep(880, 0.06);
  updateAllCartUI();
  syncLiveSessionToFirestore("SHOPPING");
  showToast(`+1 ${prod.name}${applyMember ? " (Harga Anggota)" : ""}`);
}

function calculateCartTotals() {
  let subtotalNormal = 0;
  let totalAfterMember = 0;
  let totalQty = 0;

  state.cart.forEach(item => {
    const unit = item.isMember && item.memberPrice !== null ? item.memberPrice : item.price;
    subtotalNormal += item.price * item.qty;
    totalAfterMember += unit * item.qty;
    totalQty += item.qty;
  });

  const memberSaved = subtotalNormal - totalAfterMember;
  const extraDiscount = Math.min(Number(state.extraDiscount) || 0, totalAfterMember);
  const grandTotal = Math.max(0, totalAfterMember - extraDiscount);

  return { subtotalNormal, memberSaved, extraDiscount, grandTotal, totalQty };
}

function updateAllCartUI() {
  const totals = calculateCartTotals();

  document.getElementById("navCartBadge").textContent = totals.totalQty;
  document.getElementById("mobileCartBadge").textContent = totals.totalQty;
  document.getElementById("checkoutItemBadge").textContent = totals.totalQty;

  const mcList = document.getElementById("miniCartItems");
  if (state.cart.length === 0) {
    mcList.innerHTML = `<div style="text-align:center; padding:32px 12px; color:var(--slate-400); font-size:0.84rem;">Belum ada item dipilih.<br/>Klik barang di katalog untuk menambah.</div>`;
  } else {
    mcList.innerHTML = state.cart.map((item, idx) => {
      const unit = item.isMember && item.memberPrice !== null ? item.memberPrice : item.price;
      return `
        <div class="mc-item">
          <div class="mc-item-top">
            <span>${item.name} ${item.isMember ? `<small style="color:var(--emerald-700);">[Anggota]</small>` : ""}</span>
            <span class="mono-text">${formatRupiah(unit * item.qty)}</span>
          </div>
          <div class="mc-item-bottom">
            <span style="font-size:0.74rem; color:var(--slate-500);">${formatRupiah(unit)} / pcs</span>
            <div class="qty-stepper">
              <button type="button" data-mc-dec="${idx}">-</button>
              <span>${item.qty}</span>
              <button type="button" data-mc-inc="${idx}">+</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    mcList.querySelectorAll("[data-mc-dec]").forEach(b => b.addEventListener("click", () => changeCartQty(Number(b.dataset.mcDec), -1)));
    mcList.querySelectorAll("[data-mc-inc]").forEach(b => b.addEventListener("click", () => changeCartQty(Number(b.dataset.mcInc), 1)));
  }

  document.getElementById("mcSubtotal").textContent = formatRupiah(totals.subtotalNormal);
  document.getElementById("mcMemberDisc").textContent = `- ${formatRupiah(totals.memberSaved)}`;
  document.getElementById("mcGrandTotal").textContent = formatRupiah(totals.grandTotal);
  document.getElementById("btnProceedToCheckout").disabled = state.cart.length === 0;

  const chkList = document.getElementById("checkoutCartList");
  if (state.cart.length === 0) {
    chkList.innerHTML = `<div style="text-align:center; padding:32px; color:var(--slate-400);">Keranjang belanja masih kosong.</div>`;
  } else {
    chkList.innerHTML = state.cart.map((item, idx) => {
      const canMember = item.memberPrice !== null && item.memberPrice < item.price;
      const unit = item.isMember && canMember ? item.memberPrice : item.price;
      return `
        <div class="chk-row">
          <div style="flex:1; min-width:180px;">
            <strong>${item.name}</strong>
            <div style="font-size:0.8rem; color:var(--slate-500);">
              Harga satuan: <strong>${formatRupiah(unit)}</strong>
              ${item.isMember ? ` <span style="text-decoration:line-through;">${formatRupiah(item.price)}</span>` : ""}
            </div>
            ${canMember ? `
              <label class="checkbox-label" style="margin-top:4px; font-size:0.78rem;">
                <input type="checkbox" data-chk-member="${idx}" ${item.isMember ? "checked" : ""} />
                <span>Harga Anggota (${formatRupiah(item.memberPrice)})</span>
              </label>
            ` : ""}
          </div>
          <div class="qty-stepper">
            <button type="button" data-chk-dec="${idx}">-</button>
            <span>${item.qty}</span>
            <button type="button" data-chk-inc="${idx}">+</button>
          </div>
          <div class="mono-text" style="font-weight:800; min-width:95px; text-align:right;">
            ${formatRupiah(unit * item.qty)}
          </div>
        </div>
      `;
    }).join("");

    chkList.querySelectorAll("[data-chk-dec]").forEach(b => b.addEventListener("click", () => changeCartQty(Number(b.dataset.chkDec), -1)));
    chkList.querySelectorAll("[data-chk-inc]").forEach(b => b.addEventListener("click", () => changeCartQty(Number(b.dataset.chkInc), 1)));
    chkList.querySelectorAll("[data-chk-member]").forEach(chk => {
      chk.addEventListener("change", (e) => {
        state.cart[Number(chk.dataset.chkMember)].isMember = e.target.checked;
        updateAllCartUI();
        syncLiveSessionToFirestore("SHOPPING");
      });
    });
  }

  document.getElementById("paySubtotal").textContent = formatRupiah(totals.subtotalNormal);
  document.getElementById("payMemberSaved").textContent = `- ${formatRupiah(totals.memberSaved)}`;
  document.getElementById("payExtraSaved").textContent = `- ${formatRupiah(totals.extraDiscount)}`;
  document.getElementById("payGrandTotal").textContent = formatRupiah(totals.grandTotal);
  document.getElementById("qrisExactAmount").textContent = formatRupiah(totals.grandTotal);

  recalculatePaymentValidation();
}

function changeCartQty(index, delta) {
  if (!state.cart[index]) return;
  state.cart[index].qty += delta;
  if (state.cart[index].qty <= 0) {
    state.cart.splice(index, 1);
  }
  updateAllCartUI();
  syncLiveSessionToFirestore(state.cart.length === 0 ? "IDLE" : "SHOPPING");
}

function applyBulkMemberDiscount() {
  let changed = 0;
  state.cart.forEach(item => {
    if (item.memberPrice !== null && item.memberPrice < item.price && !item.isMember) {
      item.isMember = true;
      changed++;
    }
  });
  updateAllCartUI();
  syncLiveSessionToFirestore("SHOPPING");
  showToast(changed > 0 ? `Harga anggota diterapkan ke ${changed} item di keranjang.` : "Semua item berdiskon sudah memakai harga anggota.");
}

// 11. PEMBAYARAN CASH / QRIS, CHECKOUT KE FIRESTORE & KIRIM WHATSAPP
function initCheckoutPayment() {
  document.querySelectorAll(".pm-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".pm-tab").forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-checked", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-checked", "true");
      state.paymentMethod = tab.dataset.method;

      if (state.paymentMethod === "CASH") {
        document.getElementById("cashPaymentBox").classList.remove("hidden");
        document.getElementById("qrisPaymentBox").classList.add("hidden");
      } else {
        document.getElementById("cashPaymentBox").classList.add("hidden");
        document.getElementById("qrisPaymentBox").classList.remove("hidden");
      }
      recalculatePaymentValidation();
      if (state.cart.length > 0) syncLiveSessionToFirestore("SHOPPING");
    });
  });

  const cashInput = document.getElementById("cashReceivedInput");
  cashInput.addEventListener("input", recalculatePaymentValidation);

  document.querySelectorAll(".btn-cash-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const { grandTotal } = calculateCartTotals();
      cashInput.value = btn.dataset.preset === "exact" ? grandTotal : Number(btn.dataset.preset);
      recalculatePaymentValidation();
    });
  });

  document.getElementById("extraDiscountInput").addEventListener("input", (e) => {
    state.extraDiscount = Math.max(0, Number(e.target.value) || 0);
    updateAllCartUI();
    if (state.cart.length > 0) syncLiveSessionToFirestore("SHOPPING");
  });

  document.getElementById("orderNoteInput").addEventListener("input", (e) => {
    state.orderNote = e.target.value;
  });

  document.getElementById("btnCompleteTransaction").addEventListener("click", processTransactionCheckout);
}

function recalculatePaymentValidation() {
  const { grandTotal } = calculateCartTotals();
  const btnComplete = document.getElementById("btnCompleteTransaction");
  const changeBox = document.getElementById("changeResultBox");
  const changeDisplay = document.getElementById("cashChangeDisplay");

  if (state.cart.length === 0) {
    btnComplete.disabled = true;
    changeDisplay.textContent = "Rp 0";
    return;
  }

  if (state.paymentMethod === "QRIS") {
    btnComplete.disabled = false;
    return;
  }

  const received = Number(document.getElementById("cashReceivedInput").value) || 0;
  const diff = received - grandTotal;

  if (diff >= 0) {
    changeBox.classList.remove("kurang");
    changeDisplay.textContent = formatRupiah(diff);
    btnComplete.disabled = false;
  } else {
    changeBox.classList.add("kurang");
    changeDisplay.textContent = `Kurang ${formatRupiah(Math.abs(diff))}`;
    btnComplete.disabled = true;
  }
}

async function processTransactionCheckout() {
  if (state.cart.length === 0) return;

  const btnComplete = document.getElementById("btnCompleteTransaction");
  const origBtnHtml = btnComplete.innerHTML;
  btnComplete.disabled = true;
  btnComplete.innerHTML = `<span>Memproses Transaksi...</span>`;

  const totals = calculateCartTotals();
  const wita = getWitaNow();
  const invNumber = `INV-${wita.ymd}-${String(Math.floor(1000 + Math.random() * 9000))}`;

  const cashReceived = state.paymentMethod === "CASH"
    ? Number(document.getElementById("cashReceivedInput").value) || totals.grandTotal
    : totals.grandTotal;
  const changeAmount = state.paymentMethod === "CASH" ? Math.max(0, cashReceived - totals.grandTotal) : 0;
  const waNumber = document.getElementById("customerWaInput").value.trim();

  const txRecord = {
    invoice: invNumber,
    createdAtWita: wita.fullStr,
    dateYmd: wita.ymd,
    createdAtMs: Date.now(),
    cashierName: state.cashierName,
    cashierEmail: state.user?.email || "",
    items: state.cart.map(item => ({
      id: item.id,
      name: item.name,
      qty: item.qty,
      isMember: item.isMember,
      normalPrice: item.price,
      unitPrice: item.isMember && item.memberPrice !== null ? item.memberPrice : item.price,
      subtotal: (item.isMember && item.memberPrice !== null ? item.memberPrice : item.price) * item.qty
    })),
    totalQty: totals.totalQty,
    subtotalNormal: totals.subtotalNormal,
    memberSaved: totals.memberSaved,
    extraDiscount: totals.extraDiscount,
    grandTotal: totals.grandTotal,
    paymentMethod: state.paymentMethod,
    cashReceived,
    changeAmount,
    note: state.orderNote.trim(),
    customerWa: waNumber,
    status: "PAID"
  };

  try {
    // 1. Simpan transaksi ke Firestore
    await setDoc(doc(db, "kopma_transactions", invNumber), txRecord);

    // 2. Kurangi stok produk di Firestore
    const batch = writeBatch(db);
    state.cart.forEach(item => {
      const prod = state.products.find(p => p.id === item.id);
      if (prod) {
        const newStock = Math.max(0, (prod.stock ?? 0) - item.qty);
        batch.set(doc(db, "kopma_products", prod.id), { stock: newStock }, { merge: true });
      }
    });
    await batch.commit();

    // 3. Tampilkan status LUNAS di Layar Pembeli sejenak, lalu auto-reset kembali kosong
    await syncLiveSessionToFirestore("PAID", {
      lastMethod: state.paymentMethod,
      lastChange: changeAmount,
      lastInvoice: invNumber
    });

    // 4. Tampilkan Struk & Kirim WhatsApp jika aktif
    state.lastReceiptTx = txRecord;
    openReceiptModal(txRecord);
    playBeep(1200, 0.16);

    if (waNumber && document.getElementById("autoSendWaCheck").checked) {
      sendReceiptToWhatsApp(txRecord, waNumber);
    }

    // 5. Reset keranjang aktif kasir
    state.cart = [];
    state.extraDiscount = 0;
    state.orderNote = "";
    document.getElementById("extraDiscountInput").value = "0";
    document.getElementById("orderNoteInput").value = "";
    document.getElementById("cashReceivedInput").value = "";
    updateAllCartUI();

    // 6. Jadwalkan Layar Pembeli kembali ke layar kosong (IDLE) setelah 6 detik
    if (state.paidResetTimer) clearTimeout(state.paidResetTimer);
    state.paidResetTimer = setTimeout(() => {
      if (state.cart.length === 0) {
        syncLiveSessionToFirestore("IDLE");
      }
      state.paidResetTimer = null;
    }, 6000);
  } catch (err) {
    console.error("Checkout error:", err);
    showToast(formatFirestoreError(err, "Gagal memproses transaksi ke Firestore"));
  } finally {
    btnComplete.innerHTML = origBtnHtml;
    recalculatePaymentValidation();
    if (window.lucide) lucide.createIcons();
  }
}

// 12. STRUK THERMAL REALISTIK & FORMAT WHATSAPP
function buildReceiptPlainText(tx) {
  const line = "--------------------------------";
  const header = [
    `       ${state.settings.storeName.toUpperCase()}`,
    `  ${state.settings.storeAddress}`,
    line,
    `No. Struk : ${tx.invoice}`,
    `Waktu     : ${tx.createdAtWita}`,
    `Kasir     : ${tx.cashierName}`,
    line
  ];

  const itemLines = tx.items.map(it => {
    const tag = it.isMember ? " [ANGGOTA]" : "";
    return `${it.name}${tag}\n  ${it.qty} x ${formatRupiah(it.unitPrice)} = ${formatRupiah(it.subtotal)}`;
  });

  const footer = [
    line,
    `Subtotal Normal : ${formatRupiah(tx.subtotalNormal)}`,
    tx.memberSaved > 0 ? `Hemat Anggota   : -${formatRupiah(tx.memberSaved)}` : null,
    tx.extraDiscount > 0 ? `Diskon Ekstra   : -${formatRupiah(tx.extraDiscount)}` : null,
    `TOTAL BAYAR     : ${formatRupiah(tx.grandTotal)}`,
    `Metode Bayar    : ${tx.paymentMethod} (LUNAS)`,
    tx.paymentMethod === "CASH" ? `Tunai Diterima  : ${formatRupiah(tx.cashReceived)}` : null,
    tx.paymentMethod === "CASH" ? `Kembalian       : ${formatRupiah(tx.changeAmount)}` : null,
    tx.note ? `Catatan         : ${tx.note}` : null,
    line,
    state.settings.storeFooter
  ].filter(Boolean);

  return [...header, ...itemLines, ...footer].join("\n");
}

function openReceiptModal(tx) {
  state.lastReceiptTx = tx;
  document.getElementById("printableReceiptArea").textContent = buildReceiptPlainText(tx);
  document.getElementById("receiptModal").classList.remove("hidden");
}

async function sendReceiptToWhatsApp(tx, rawPhone) {
  let phone = (rawPhone || tx.customerWa || "").replace(/[^0-9]/g, "");
  if (!phone) {
    const inputPhone = await showKopmaDialog({
      title: "Kirim Struk ke WhatsApp",
      message: `Masukkan nomor WhatsApp pembeli untuk invoice <strong>${tx.invoice}</strong> (contoh: 081234567890):`,
      variant: "emerald",
      confirmText: "Buka WhatsApp",
      cancelText: "Batal",
      withInput: true,
      inputPlaceholder: "081234567890"
    });
    if (!inputPhone) return;
    phone = inputPhone.replace(/[^0-9]/g, "");
  }
  if (!phone) return;
  if (phone.startsWith("0")) phone = "62" + phone.slice(1);

  const text = encodeURIComponent(buildReceiptPlainText(tx));
  window.open(`https://wa.me/${phone}?text=${text}`, "_blank", "noopener");
}

// 13. DASHBOARD ANALITIK & INVENTARIS
function renderDashboard() {
  const paidTx = state.transactions.filter(t => t.status !== "VOID");
  const totalRevenue = paidTx.reduce((s, t) => s + (t.grandTotal || 0), 0);
  const cashRevenue = paidTx.filter(t => t.paymentMethod === "CASH").reduce((s, t) => s + (t.grandTotal || 0), 0);
  const qrisCount = paidTx.filter(t => t.paymentMethod === "QRIS").length;
  const cashCount = paidTx.filter(t => t.paymentMethod === "CASH").length;
  const memberSavings = paidTx.reduce((s, t) => s + (t.memberSaved || 0), 0);
  const totalItemsSold = paidTx.reduce((s, t) => s + (t.totalQty || 0), 0);
  const totalPetty = state.pettyCash.reduce((s, p) => s + (p.amount || 0), 0);
  const netCash = Math.max(0, cashRevenue - totalPetty);
  const lowStockCount = state.products.filter(p => (p.stock ?? 0) <= (p.minStock ?? 5)).length;

  document.getElementById("kpiTotalRevenue").textContent = formatRupiah(totalRevenue);
  document.getElementById("kpiTxCount").textContent = `${paidTx.length} transaksi selesai`;
  document.getElementById("kpiNetCash").textContent = formatRupiah(netCash);
  document.getElementById("kpiCashBreakdown").textContent = `Tunai ${formatRupiah(cashRevenue)} • Keluar ${formatRupiah(totalPetty)}`;
  document.getElementById("kpiMemberSavings").textContent = formatRupiah(memberSavings);
  document.getElementById("kpiItemsSold").textContent = `${totalItemsSold} item terjual total`;
  document.getElementById("kpiTotalProducts").textContent = `${state.products.length} Produk`;
  document.getElementById("kpiLowStockCount").textContent = `${lowStockCount} stok menipis • ${qrisCount} QRIS`;
  document.getElementById("dashPaymentRatio").textContent = `Cash ${cashCount} • QRIS ${qrisCount}`;

  const catMap = {};
  state.products.forEach(p => {
    const c = p.category || "Lainnya";
    catMap[c] = (catMap[c] || 0) + 1;
  });
  const catContainer = document.getElementById("categoryBreakdownList");
  const totalP = state.products.length || 1;
  const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  catContainer.innerHTML = catEntries.length === 0
    ? `<p style="color:var(--slate-400); font-size:0.85rem;">Katalog masih kosong. Upload file JSON untuk memuat produk.</p>`
    : catEntries.map(([cat, count]) => {
        const pct = Math.round((count / totalP) * 100);
        return `
          <div class="cat-bar-item">
            <div class="cat-bar-head"><span>${cat}</span><span>${count} item (${pct}%)</span></div>
            <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%"></div></div>
          </div>`;
      }).join("");

  const salesMap = {};
  paidTx.forEach(tx => {
    (tx.items || []).forEach(it => {
      if (!salesMap[it.name]) salesMap[it.name] = { qty: 0, rev: 0 };
      salesMap[it.name].qty += it.qty;
      salesMap[it.name].rev += it.subtotal;
    });
  });
  const topList = Object.entries(salesMap).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);
  const topEl = document.getElementById("topProductsList");
  topEl.innerHTML = topList.length === 0
    ? `<p style="color:var(--slate-400); font-size:0.85rem;">Belum ada penjualan tercatat pada shift ini.</p>`
    : topList.map(([name, info], idx) => `
        <div class="top-prod-row">
          <div><strong>#${idx + 1} ${name}</strong><div style="font-size:0.75rem; color:var(--slate-500);">${info.qty} terjual</div></div>
          <strong class="mono-text" style="color:var(--emerald-800);">${formatRupiah(info.rev)}</strong>
        </div>`).join("");
}

function renderInventoryTable() {
  const q = (document.getElementById("invSearchInput").value || "").toLowerCase();
  const filtered = state.products.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.sku || "").toLowerCase().includes(q) ||
    (p.category || "").toLowerCase().includes(q)
  );
  document.getElementById("invProductCount").textContent = state.products.length;

  const tbody = document.getElementById("inventoryTableBody");
  tbody.innerHTML = filtered.slice(0, 150).map(p => `
    <tr>
      <td class="mono-text">${p.sku || p.id}</td>
      <td><strong>${p.name}</strong></td>
      <td>${p.category}</td>
      <td class="mono-text">${formatRupiah(p.price)}</td>
      <td class="mono-text">${p.memberPrice ? formatRupiah(p.memberPrice) : "-"}</td>
      <td><strong>${p.stock ?? 0}</strong></td>
      <td>
        <button type="button" class="btn btn-outline btn-sm" data-restock-id="${p.id}">+10 Stok</button>
        <button type="button" class="btn btn-danger-outline btn-sm" data-del-prod="${p.id}">Hapus</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-restock-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const p = state.products.find(x => x.id === btn.dataset.restockId);
      if (p) {
        try {
          await updateDoc(doc(db, "kopma_products", p.id), { stock: (p.stock ?? 0) + 10 });
          showToast(`Stok ${p.name} ditambah +10.`);
        } catch (err) {
          showToast(formatFirestoreError(err, "Gagal menambah stok"));
        }
      }
    });
  });

  tbody.querySelectorAll("[data-del-prod]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const p = state.products.find(x => x.id === btn.dataset.delProd);
      const ok = await showKopmaDialog({
        title: "Hapus Produk dari Katalog?",
        message: `Produk <strong>${p ? p.name : btn.dataset.delProd}</strong> akan dihapus permanen dari database Cloud Firestore.`,
        variant: "danger",
        confirmText: "Ya, Hapus Produk",
        cancelText: "Batal"
      });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "kopma_products", btn.dataset.delProd));
        showToast("Barang dihapus dari Firestore.");
      } catch (err) {
        showToast(formatFirestoreError(err, "Gagal menghapus barang"));
      }
    });
  });
}

function renderTransactionsTable() {
  document.getElementById("invTxCount").textContent = state.transactions.length;
  const tbody = document.getElementById("transactionsTableBody");
  tbody.innerHTML = state.transactions.map(tx => `
    <tr>
      <td class="mono-text"><strong>${tx.invoice}</strong></td>
      <td>${tx.createdAtWita}</td>
      <td>${tx.cashierName}</td>
      <td>${tx.totalQty} item</td>
      <td>${tx.paymentMethod}</td>
      <td class="mono-text"><strong>${formatRupiah(tx.grandTotal)}</strong></td>
      <td>${tx.status === "VOID" ? `<span style="color:var(--rose-600); font-weight:700;">VOID</span>` : `<span style="color:var(--emerald-700); font-weight:700;">LUNAS</span>`}</td>
      <td>
        <button type="button" class="btn btn-outline btn-sm" data-view-tx="${tx.invoice}">Struk</button>
        <button type="button" class="btn btn-emerald btn-sm" data-wa-tx="${tx.invoice}">WA</button>
        ${tx.status !== "VOID" ? `<button type="button" class="btn btn-danger-outline btn-sm" data-void-tx="${tx.invoice}">Void</button>` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-view-tx]").forEach(b => {
    b.addEventListener("click", () => {
      const tx = state.transactions.find(t => t.invoice === b.dataset.viewTx);
      if (tx) openReceiptModal(tx);
    });
  });

  tbody.querySelectorAll("[data-wa-tx]").forEach(b => {
    b.addEventListener("click", () => {
      const tx = state.transactions.find(t => t.invoice === b.dataset.waTx);
      if (tx) sendReceiptToWhatsApp(tx, tx.customerWa);
    });
  });

  tbody.querySelectorAll("[data-void-tx]").forEach(b => {
    b.addEventListener("click", async () => {
      const tx = state.transactions.find(t => t.invoice === b.dataset.voidTx);
      if (!tx) return;
      const ok = await showKopmaDialog({
        title: "Batalkan (Void) Transaksi?",
        message: `Anda akan membatalkan transaksi <strong>${tx.invoice}</strong> senilai <strong>${formatRupiah(tx.grandTotal)}</strong>. Stok barang akan dikembalikan otomatis ke katalog.`,
        variant: "danger",
        confirmText: "Ya, Void Transaksi",
        cancelText: "Batal"
      });
      if (!ok) return;
      try {
        await updateDoc(doc(db, "kopma_transactions", tx.invoice), { status: "VOID" });

        // Kembalikan stok barang yang dibatalkan
        const batch = writeBatch(db);
        (tx.items || []).forEach(it => {
          const prod = state.products.find(p => p.id === it.id);
          if (prod) {
            batch.set(doc(db, "kopma_products", prod.id), { stock: (prod.stock ?? 0) + (it.qty || 0) }, { merge: true });
          }
        });
        await batch.commit();

        showToast(`Transaksi ${tx.invoice} dibatalkan (VOID) & stok dikembalikan.`);
      } catch (err) {
        showToast(formatFirestoreError(err, "Gagal membatalkan transaksi"));
      }
    });
  });
}

// 14. HOLD CART, PETTY CASH, SHIFT CALCULATOR & NAVIGASI
function initExtraTools() {
  const switchSection = (secName) => {
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
    const target = document.getElementById(`section-${secName}`);
    if (target) target.classList.add("active");

    document.querySelectorAll(".nav-item[data-section], .mb-item[data-section]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.section === secName);
    });
  };

  document.querySelectorAll("[data-section]").forEach(btn => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
  });
  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => switchSection(btn.dataset.goto));
  });

  document.querySelectorAll(".subtab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".subtab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("subtab-products").classList.toggle("hidden", tab.dataset.subtab !== "products");
      document.getElementById("subtab-transactions").classList.toggle("hidden", tab.dataset.subtab !== "transactions");
    });
  });

  document.getElementById("btnToggleSidebar").addEventListener("click", () => {
    document.getElementById("appSidebar").classList.toggle("collapsed");
  });

  document.getElementById("btnCopySessionCode").addEventListener("click", () => {
    navigator.clipboard?.writeText(state.sessionCode);
    showToast(`Kode Layar Pembeli "${state.sessionCode}" disalin!`);
  });
  document.getElementById("btnRegenerateSession").addEventListener("click", () => {
    state.sessionCode = generateSessionCode();
    updateSessionCodeUI();
    syncLiveSessionToFirestore(state.cart.length === 0 ? "IDLE" : "SHOPPING");
    showToast(`Kode sesi baru dibuat: ${state.sessionCode}`);
  });

  const searchInput = document.getElementById("posSearchInput");
  searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    document.getElementById("btnClearSearch").classList.toggle("hidden", !state.searchQuery);
    renderProductGrid();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const firstMatch = getFilteredProducts()[0];
      if (firstMatch) addToCart(firstMatch, Boolean(state.memberCheckedMap[firstMatch.id]));
    }
  });
  document.getElementById("btnClearSearch").addEventListener("click", () => {
    state.searchQuery = "";
    searchInput.value = "";
    document.getElementById("btnClearSearch").classList.add("hidden");
    renderProductGrid();
  });

  document.getElementById("filterMemberOnly").addEventListener("change", (e) => {
    state.memberFilterOnly = e.target.checked;
    renderProductGrid();
  });
  document.getElementById("posSortSelect").addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    renderProductGrid();
  });

  document.getElementById("btnBulkMemberOn").addEventListener("click", applyBulkMemberDiscount);
  document.getElementById("btnCartBulkMember").addEventListener("click", applyBulkMemberDiscount);
  document.getElementById("btnProceedToCheckout").addEventListener("click", () => switchSection("cart"));

  const clearCartFn = () => {
    if (state.cart.length === 0) return;
    state.cart = [];
    updateAllCartUI();
    syncLiveSessionToFirestore("IDLE");
    showToast("Keranjang dikosongkan.");
  };
  document.getElementById("btnClearCartMini").addEventListener("click", clearCartFn);
  document.getElementById("btnClearCartFull").addEventListener("click", clearCartFn);

  document.getElementById("navHoldBadge").textContent = state.heldOrders.length;
  document.getElementById("btnHoldCurrentCart").addEventListener("click", async () => {
    if (state.cart.length === 0) return showToast("Keranjang masih kosong.");
    const inputLabel = await showKopmaDialog({
      title: "Tahan Sementara Pesanan (Hold)",
      message: "Masukkan nama atau label antrian pembeli agar mudah dipanggil kembali:",
      variant: "emerald",
      confirmText: "Simpan Antrian",
      cancelText: "Batal",
      withInput: true,
      inputPlaceholder: "Contoh: Kak Budi / Baju Biru",
      inputDefaultValue: `Antrian ${getWitaNow().timeStr}`
    });
    if (inputLabel === null) return;
    const label = inputLabel.trim() || "Pesanan Ditahan";
    state.heldOrders.push({ label, items: [...state.cart], time: getWitaNow().timeStr });
    localStorage.setItem("kopma_held_orders", JSON.stringify(state.heldOrders));
    document.getElementById("navHoldBadge").textContent = state.heldOrders.length;
    state.cart = [];
    updateAllCartUI();
    syncLiveSessionToFirestore("IDLE");
    showToast(`Pesanan "${label}" ditahan.`);
  });

  document.getElementById("btnOpenHeldModal").addEventListener("click", () => {
    const listEl = document.getElementById("heldOrdersList");
    listEl.innerHTML = state.heldOrders.length === 0
      ? `<p style="color:var(--slate-500);">Tidak ada pesanan yang sedang ditahan.</p>`
      : state.heldOrders.map((h, i) => `
          <div class="chk-row" style="margin-bottom:8px;">
            <div><strong>${h.label}</strong><div style="font-size:0.78rem; color:var(--slate-500);">${h.items.length} jenis barang • ${h.time}</div></div>
            <button type="button" class="btn btn-emerald btn-sm" data-recall-hold="${i}">Panggil</button>
          </div>`).join("");
    listEl.querySelectorAll("[data-recall-hold]").forEach(b => {
      b.addEventListener("click", () => {
        const idx = Number(b.dataset.recallHold);
        state.cart = state.heldOrders[idx].items;
        state.heldOrders.splice(idx, 1);
        localStorage.setItem("kopma_held_orders", JSON.stringify(state.heldOrders));
        document.getElementById("navHoldBadge").textContent = state.heldOrders.length;
        updateAllCartUI();
        syncLiveSessionToFirestore("SHOPPING");
        document.getElementById("heldOrdersModal").classList.add("hidden");
        switchSection("cart");
      });
    });
    document.getElementById("heldOrdersModal").classList.remove("hidden");
  });

  ["btnOpenAddProductModal", "btnInvAddProduct"].forEach(id => {
    document.getElementById(id).addEventListener("click", () => {
      document.getElementById("productForm").reset();
      document.getElementById("productFormModal").classList.remove("hidden");
    });
  });

  document.getElementById("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newId = `PRD-${Date.now().toString().slice(-5)}`;
    const name = document.getElementById("prodNameInput").value.trim();
    const category = document.getElementById("prodCategoryInput").value;
    const stock = Number(document.getElementById("prodStockInput").value) || 0;
    const price = Number(document.getElementById("prodPriceInput").value) || 0;
    const rawMem = document.getElementById("prodMemberPriceInput").value;
    const memberPrice = rawMem !== "" ? Number(rawMem) : null;

    try {
      await setDoc(doc(db, "kopma_products", newId), {
        sku: newId,
        name,
        category,
        stock,
        minStock: 5,
        price,
        memberPrice,
        pinned: false,
        updatedAt: serverTimestamp()
      });
      document.getElementById("productFormModal").classList.add("hidden");
      showToast(`Produk "${name}" disimpan ke Firestore.`);
    } catch (err) {
      showToast(formatFirestoreError(err, "Gagal menambah produk baru"));
    }
  });

  document.getElementById("btnModalSendWa").addEventListener("click", () => {
    if (state.lastReceiptTx) sendReceiptToWhatsApp(state.lastReceiptTx);
  });
  document.getElementById("btnPrintReceipt").addEventListener("click", () => window.print());
  document.getElementById("btnCopyReceiptText").addEventListener("click", () => {
    if (state.lastReceiptTx) {
      navigator.clipboard?.writeText(buildReceiptPlainText(state.lastReceiptTx));
      showToast("Teks struk berhasil disalin!");
    }
  });

  document.getElementById("btnOpenShiftModal").addEventListener("click", () => {
    const denoms = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500];
    const grid = document.getElementById("denominationGrid");
    grid.innerHTML = denoms.map(d => `
      <div class="denom-row">
        <span>${formatRupiah(d)}</span>
        <input type="number" min="0" value="0" data-denom="${d}" />
      </div>`).join("");

    const paidTx = state.transactions.filter(t => t.status !== "VOID");
    const cashIn = paidTx.filter(t => t.paymentMethod === "CASH").reduce((s, t) => s + t.grandTotal, 0);
    const pettyOut = state.pettyCash.reduce((s, p) => s + p.amount, 0);
    const expected = Math.max(0, cashIn - pettyOut);

    document.getElementById("shiftSummaryBox").innerHTML = `
      <div style="font-size:0.84rem; background:var(--slate-50); padding:10px; border-radius:8px;">
        Kasir Piket: <strong>${state.cashierName}</strong> • Saldo Sistem Seharusnya: <strong>${formatRupiah(expected)}</strong>
      </div>`;

    const calcDenom = () => {
      let phys = 0;
      grid.querySelectorAll("input").forEach(inp => {
        phys += Number(inp.dataset.denom) * (Number(inp.value) || 0);
      });
      document.getElementById("denomPhysicalTotal").textContent = formatRupiah(phys);
      const diff = phys - expected;
      document.getElementById("denomVarianceTotal").textContent = (diff >= 0 ? "+" : "") + formatRupiah(diff);
    };
    grid.querySelectorAll("input").forEach(inp => inp.addEventListener("input", calcDenom));
    calcDenom();
    document.getElementById("shiftModal").classList.remove("hidden");
  });

  document.getElementById("btnOpenPettyCashModal").addEventListener("click", () => {
    document.getElementById("pettyCashModal").classList.remove("hidden");
  });
  document.getElementById("pettyCashForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const desc = document.getElementById("pettyDescInput").value.trim();
    const amount = Number(document.getElementById("pettyAmountInput").value) || 0;
    if (!desc || amount <= 0) return;

    try {
      const id = `PC-${Date.now()}`;
      await setDoc(doc(db, "kopma_petty_cash", id), {
        desc,
        amount,
        cashierName: state.cashierName,
        timeWita: getWitaNow().fullStr,
        createdAtMs: Date.now()
      });
      e.target.reset();
      showToast("Pengeluaran kas berhasil dicatat ke Firestore.");
    } catch (err) {
      showToast(formatFirestoreError(err, "Gagal mencatat kas keluar"));
    }
  });

  document.getElementById("btnOpenSettingsModal").addEventListener("click", () => {
    document.getElementById("settingsModal").classList.remove("hidden");
  });
  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    state.settings.storeName = document.getElementById("setStoreName").value.trim();
    state.settings.storeAddress = document.getElementById("setStoreAddress").value.trim();
    state.settings.storeFooter = document.getElementById("setStoreFooter").value.trim();
    try {
      await setDoc(doc(db, "kopma_config", "store_profile"), state.settings);
      applySettingsToUI();
      document.getElementById("settingsModal").classList.add("hidden");
      showToast("Pengaturan identitas koperasi diperbarui.");
    } catch (err) {
      showToast(formatFirestoreError(err, "Gagal menyimpan pengaturan toko"));
    }
  });

  document.getElementById("btnExportCsv").addEventListener("click", () => {
    const rows = [["Invoice", "Waktu WITA", "Kasir", "Total Item", "Metode", "Total Bayar", "Status"]];
    state.transactions.forEach(t => {
      rows.push([t.invoice, `"${t.createdAtWita}"`, `"${t.cashierName}"`, t.totalQty, t.paymentMethod, t.grandTotal, t.status]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-kopma-${getWitaNow().ymd}.csv`;
    a.click();
  });

  document.getElementById("btnClearAllProducts").addEventListener("click", async () => {
    const ok = await showKopmaDialog({
      title: "Kosongkan Seluruh Katalog Barang?",
      message: `Tindakan ini akan menghapus <strong>${state.products.length} produk</strong> dari database Cloud Firestore. Pastikan Anda sudah mengunduh Backup JSON terlebih dahulu.`,
      variant: "danger",
      confirmText: "Ya, Hapus Semua Barang",
      cancelText: "Batal"
    });
    if (!ok) return;
    try {
      const batch = writeBatch(db);
      state.products.forEach(p => batch.delete(doc(db, "kopma_products", p.id)));
      await batch.commit();
      showToast("Seluruh produk di Firestore telah dikosongkan.");
    } catch (err) {
      showToast(formatFirestoreError(err, "Gagal mengosongkan produk"));
    }
  });

  document.getElementById("invSearchInput").addEventListener("input", renderInventoryTable);

  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      const modalId = btn.dataset.closeModal;
      document.getElementById(modalId).classList.add("hidden");

      // Jika kasir menutup modal struk setelah pembayaran, langsung segarkan Layar Pembeli ke IDLE
      if (modalId === "receiptModal" && state.cart.length === 0) {
        syncLiveSessionToFirestore("IDLE");
      }
    });
  });

  if (state.highContrast) document.body.classList.add("high-contrast");
  document.getElementById("btnToggleContrast").addEventListener("click", () => {
    state.highContrast = !state.highContrast;
    document.body.classList.toggle("high-contrast", state.highContrast);
    localStorage.setItem("kopma_contrast", state.highContrast ? "on" : "off");
  });
  document.getElementById("btnToggleBeep").addEventListener("click", () => {
    state.beepEnabled = !state.beepEnabled;
    localStorage.setItem("kopma_beep", state.beepEnabled ? "on" : "off");
    showToast(state.beepEnabled ? "Suara beep kasir aktif." : "Suara beep kasir dimatikan.");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "F2") {
      e.preventDefault();
      switchSection("pos");
      searchInput.focus();
    } else if (e.key === "F4") {
      e.preventDefault();
      switchSection("cart");
    }
  });
}

function renderPettyCashList() {
  const el = document.getElementById("pettyCashList");
  el.innerHTML = state.pettyCash.length === 0
    ? `<p style="color:var(--slate-400); font-size:0.84rem;">Belum ada catatan pengeluaran kas.</p>`
    : state.pettyCash.map(p => `
        <div class="chk-row" style="margin-bottom:6px; padding:8px 12px;">
          <div><strong>${p.desc}</strong><div style="font-size:0.74rem; color:var(--slate-500);">${p.cashierName} • ${p.timeWita}</div></div>
          <strong class="mono-text" style="color:var(--rose-600);">- ${formatRupiah(p.amount)}</strong>
        </div>`).join("");
}

// BOOTSTRAP APLIKASI
document.addEventListener("DOMContentLoaded", () => {
  initCustomDialogSystem();
  if (window.lucide) lucide.createIcons();
  startWitaClocks();
  initAuthFlow();
  initCustomerDisplayPortal();
  initJsonImportExport();
  initCheckoutPayment();
  initExtraTools();
  updateAllCartUI();
});