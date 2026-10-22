
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "firebase/auth";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore";

// ========================================
// ELEMEN HALAMAN
// ========================================

const $ = (id) => document.getElementById(id);

const employeeName = $("employeeName");
const employeePosition = $("employeePosition");
const accountStatus = $("accountStatus");

const todayDate = $("todayDate");
const currentTime = $("currentTime");

const attendanceIndicator = $("attendanceIndicator");
const attendanceStatus = $("attendanceStatus");
const attendanceTime = $("attendanceTime");

const locationStatus = $("locationStatus");
const attendanceBtn = $("attendanceBtn");
const attendanceMessage = $("attendanceMessage");
const logoutBtn = $("logoutBtn");

const historyMonth = $("historyMonth");
const historyMessage = $("historyMessage");
const historyPresent = $("historyPresent");
const historyOvertime = $("historyOvertime");
const historyCalendar = $("historyCalendar");
const historyOvertimeList = $("historyOvertimeList");

const noOvertimeSection = $("noOvertimeSection");
const noOvertimeBtn = $("noOvertimeBtn");
const noOvertimeMessage = $("noOvertimeMessage");

// ========================================
// KONFIGURASI DAN STATE
// ========================================

const TIME_ZONE = "Asia/Jakarta";

const steps = [
  {
    field: "checkInAt",
    location: "checkInLocation",
    label: "Absen Masuk"
  },
  {
    field: "checkOutAt",
    location: "checkOutLocation",
    label: "Absen Keluar"
  },
  {
    field: "overtimeCheckInAt",
    location: "overtimeCheckInLocation",
    label: "Absen Masuk Lembur"
  },
  {
    field: "overtimeCheckOutAt",
    location: "overtimeCheckOutLocation",
    label: "Absen Keluar Lembur"
  }
];

let currentUser = null;
let isProcessing = false;
let isVerifying = false;
let clockInterval = null;
let historyRequestId = 0;
let todayRecord = null;

// ========================================
// UTILITAS DEBUG
// ========================================

function logFirebaseError(context, error) {
  console.error(`[DEBUG] ${context}`, {
    code: error?.code || "unknown",
    message: error?.message || String(error)
  });
}

// ========================================
// TANGGAL DAN WAKTU WIB
// ========================================

function getDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function getCurrentMonthKey() {
  return getDateKey().slice(0, 7);
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatHours(hours) {
  return `${Number(hours).toLocaleString("id-ID", {
    maximumFractionDigits: 2
  })} jam`;
}

function updateClock() {
  if (todayDate) todayDate.textContent = formatDate();

  if (currentTime) {
    currentTime.textContent = `Waktu sekarang: ${formatTime()} WIB`;
  }
}

// ========================================
// PESAN DAN TOMBOL
// ========================================

function showMessage(message, type = "info") {
  if (!attendanceMessage) return;

  const colors = {
    info: "text-slate-400",
    success: "text-emerald-400",
    error: "text-red-400"
  };

  attendanceMessage.textContent = message;
  attendanceMessage.className =
    `mt-3 text-sm leading-6 ${colors[type] || colors.info}`;
}

function showNoOvertimeMessage(message, type = "info") {
  if (!noOvertimeMessage) return;

  const colors = {
    info: "text-slate-400",
    success: "text-emerald-400",
    error: "text-red-400"
  };

  noOvertimeMessage.textContent = message;
  noOvertimeMessage.className =
    `mt-2 text-sm ${colors[type] || colors.info}`;
}

function setAttendanceButton(enabled, label) {
  if (!attendanceBtn) return;

  attendanceBtn.disabled = !enabled;
  attendanceBtn.textContent = label;
}

// ========================================
// STATUS DAN URUTAN ABSENSI
// ========================================

function getNextStepIndex(data) {
  if (!data) return 0;

  if (data.overtimeStatus === "none") return 4;

  for (let i = 0; i < steps.length; i++) {
    if (!data[steps[i].field]) return i;
  }

  return 4;
}

function getAttendanceRef() {
  if (!currentUser) {
    throw new Error("Pengguna belum terautentikasi.");
  }

  return doc(
    db,
    "attendance",
    `${currentUser.uid}_${getDateKey()}`
  );
}

function updateAttendanceUI(data) {
  todayRecord = data || null;

  if (
    !attendanceIndicator ||
    !attendanceStatus ||
    !attendanceTime ||
    !locationStatus
  ) {
    return;
  }

  const index = getNextStepIndex(data);

  if (!data) {
    attendanceIndicator.textContent = "—";
    attendanceIndicator.className =
      "flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-xl text-slate-300";

    attendanceStatus.textContent = "Belum Absen";
    attendanceStatus.className = "font-semibold text-slate-100";

    attendanceTime.textContent =
      "Silakan lakukan Absen Masuk hari ini.";

    locationStatus.textContent = "Lokasi belum diambil.";

    setAttendanceButton(true, "Absen Masuk");

    if (noOvertimeSection) {
      noOvertimeSection.classList.add("hidden");
    }

    return;
  }

  attendanceIndicator.textContent =
    index === 4 ? "✓" : `${index}/4`;

  attendanceIndicator.className =
    "flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-xl text-emerald-400";

  if (index === 4) {
    attendanceStatus.textContent =
      data.overtimeStatus === "none"
        ? "Selesai — Tidak Lembur"
        : "Semua Tahap Selesai";

    attendanceTime.textContent =
      "Absensi hari ini telah selesai.";

    setAttendanceButton(false, "Absensi Selesai");
  } else {
    attendanceStatus.textContent = "Absensi Berjalan";
    attendanceTime.textContent =
      `Tahap berikutnya: ${steps[index].label}`;

    setAttendanceButton(true, steps[index].label);
  }

  const firstLocation = data.checkInLocation;

  if (
    firstLocation &&
    typeof firstLocation.latitude === "number" &&
    typeof firstLocation.longitude === "number"
  ) {
    locationStatus.textContent =
      `GPS masuk: ${firstLocation.latitude.toFixed(6)}, ${firstLocation.longitude.toFixed(6)}`;
  } else {
    locationStatus.textContent = "Data lokasi absensi tersimpan.";
  }

  if (noOvertimeSection) {
    const canChoose =
      Boolean(data.checkOutAt) &&
      !data.overtimeCheckInAt &&
      !data.overtimeCheckOutAt &&
      !data.overtimeStatus;

    noOvertimeSection.classList.toggle("hidden", !canChoose);

    if (data.overtimeStatus === "none") {
      showNoOvertimeMessage(
        "Pilihan tidak lembur sudah tercatat.",
        "success"
      );
    }
  }
}

async function loadTodayAttendance() {
  if (!currentUser) return;

  console.log("[DEBUG] Membaca absensi hari ini.");

  const snapshot = await getDoc(getAttendanceRef());

  updateAttendanceUI(
    snapshot.exists() ? snapshot.data() : null
  );
}

// ========================================
// GPS WAJIB
// ========================================

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error(
        "Browser tidak mendukung fitur lokasi GPS."
      ));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      error => {
        let message = "Lokasi gagal diambil.";

        if (error.code === error.PERMISSION_DENIED) {
          message =
            "Izin GPS ditolak. Aktifkan izin lokasi pada browser.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message =
            "Lokasi tidak tersedia. Periksa GPS perangkat.";
        } else if (error.code === error.TIMEOUT) {
          message =
            "Pengambilan GPS terlalu lama. Silakan coba lagi.";
        }

        reject(new Error(message));
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  });
}

function makeLocation(position) {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy
  };
}

// ========================================
// VALIDASI PROFIL KARYAWAN
// ========================================

async function validateCurrentEmployee() {
  if (!currentUser) {
    throw new Error("Sesi pengguna tidak ditemukan.");
  }

  const userRef = doc(db, "users", currentUser.uid);

  console.log("[DEBUG] Validasi profil:", currentUser.uid);

  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    throw new Error("Profil karyawan tidak ditemukan.");
  }

  const profile = snapshot.data();

  if (profile.isActive !== true || profile.role !== "user") {
    await signOut(auth);
    window.location.replace("./index.html");

    throw new Error("Akun tidak memiliki akses absensi.");
  }
}

// ========================================
// SIMPAN TAHAP ABSENSI
// ========================================

async function submitAttendance() {
  if (!currentUser || isProcessing) return;

  isProcessing = true;
  setAttendanceButton(false, "Memeriksa akun...");
  showMessage("Memeriksa akun dan mengambil GPS...", "info");

  try {
    await validateCurrentEmployee();

    const attendanceRef = getAttendanceRef();
    const snapshot = await getDoc(attendanceRef);
    const data = snapshot.exists() ? snapshot.data() : null;

    const index = getNextStepIndex(data);

    if (index >= 4) {
      updateAttendanceUI(data);
      showMessage("Absensi hari ini sudah selesai.", "info");
      return;
    }

    const step = steps[index];

    if (index > 0 && !data?.[steps[index - 1].field]) {
      throw new Error("Tahap sebelumnya belum selesai.");
    }

    showMessage(`Mengambil GPS untuk ${step.label}...`, "info");

    locationStatus.textContent = "Mengambil lokasi GPS...";

    const position = await getCurrentPosition();
    const location = makeLocation(position);

    if (
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude)
    ) {
      throw new Error("Koordinat GPS tidak valid.");
    }

    const latestSnapshot = await getDoc(attendanceRef);
    const latestData = latestSnapshot.exists()
      ? latestSnapshot.data()
      : null;

    if (getNextStepIndex(latestData) !== index) {
      updateAttendanceUI(latestData);
      showMessage(
        "Data absensi berubah. Periksa tahap berikutnya.",
        "info"
      );
      return;
    }

    const timestampField = step.field;
    const locationField = step.location;

    if (index === 0) {
      await setDoc(attendanceRef, {
        userId: currentUser.uid,
        dateKey: getDateKey(),
        status: "present",
        timestamp: serverTimestamp(),
        latitude: location.latitude,
        longitude: location.longitude,
        checkInAt: serverTimestamp(),
        checkInLocation: location,
        updatedAt: serverTimestamp()
      });
    } else {
      const changes = {
        [timestampField]: serverTimestamp(),
        [locationField]: location,
        updatedAt: serverTimestamp()
      };

      if (index === 3) {
        changes.overtimeStatus = "completed";
      }

      await updateDoc(attendanceRef, changes);
    }

    await loadTodayAttendance();
    await loadMonthlyHistory();

    locationStatus.textContent =
      `GPS: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;

    showMessage(`${step.label} berhasil dicatat.`, "success");
  } catch (error) {
    logFirebaseError("Gagal mencatat absensi", error);

    showMessage(
      error.message || "Absensi gagal disimpan. Silakan coba kembali.",
      "error"
    );

    try {
      await loadTodayAttendance();
    } catch (reloadError) {
      logFirebaseError("Gagal memuat ulang absensi", reloadError);
    }
  } finally {
    isProcessing = false;

    if (currentUser) {
      try {
        const snapshot = await getDoc(getAttendanceRef());
        updateAttendanceUI(
          snapshot.exists() ? snapshot.data() : null
        );
      } catch (error) {
        logFirebaseError("Gagal memperbarui tombol", error);
      }
    }
  }
}

// ========================================
// PILIHAN TIDAK LEMBUR — GPS WAJIB
// ========================================

async function chooseNoOvertime() {
  if (!currentUser || isProcessing) return;

  isProcessing = true;

  if (noOvertimeBtn) {
    noOvertimeBtn.disabled = true;
    noOvertimeBtn.textContent = "Mengambil GPS...";
  }

  showNoOvertimeMessage(
    "Mengambil lokasi untuk konfirmasi...",
    "info"
  );

  try {
    await validateCurrentEmployee();

    const attendanceRef = getAttendanceRef();
    const snapshot = await getDoc(attendanceRef);

    if (!snapshot.exists()) {
      throw new Error("Data absensi hari ini belum tersedia.");
    }

    const data = snapshot.data();

    if (
      !data.checkOutAt ||
      data.overtimeCheckInAt ||
      data.overtimeCheckOutAt ||
      data.overtimeStatus
    ) {
      throw new Error(
        "Pilihan tidak lembur tidak tersedia pada tahap ini."
      );
    }

    const position = await getCurrentPosition();
    const location = makeLocation(position);

    const latestSnapshot = await getDoc(attendanceRef);

    if (!latestSnapshot.exists()) {
      throw new Error("Data absensi tidak ditemukan.");
    }

    const latest = latestSnapshot.data();

    if (
      !latest.checkOutAt ||
      latest.overtimeCheckInAt ||
      latest.overtimeCheckOutAt ||
      latest.overtimeStatus
    ) {
      throw new Error(
        "Tahap absensi berubah. Muat ulang halaman."
      );
    }

    await updateDoc(attendanceRef, {
      overtimeStatus: "none",
      noOvertimeAt: serverTimestamp(),
      noOvertimeLocation: location,
      updatedAt: serverTimestamp()
    });

    await loadTodayAttendance();
    await loadMonthlyHistory();

    showNoOvertimeMessage(
      "Pilihan tidak lembur berhasil dicatat.",
      "success"
    );

    showMessage(
      "Absensi hari ini selesai. Status: tidak lembur.",
      "success"
    );
  } catch (error) {
    logFirebaseError(
      "Gagal menyimpan pilihan tidak lembur",
      error
    );

    showNoOvertimeMessage(
      error.message || "Pilihan tidak lembur gagal disimpan.",
      "error"
    );
  } finally {
    isProcessing = false;

    if (noOvertimeBtn) {
      noOvertimeBtn.disabled = false;
      noOvertimeBtn.textContent = "Tidak Lembur";
    }

    try {
      await loadTodayAttendance();
    } catch (error) {
      logFirebaseError(
        "Gagal memperbarui status absensi",
        error
      );
    }
  }
}

// ========================================
// KALENDER RIWAYAT ABSENSI
// ========================================

function renderHistoryCalendar(year, month, records) {
  if (!historyCalendar) return;

  historyCalendar.replaceChildren();
  historyCalendar.style.display = "grid";
  historyCalendar.style.gridTemplateColumns =
    "repeat(7, minmax(0, 1fr))";
  historyCalendar.style.gap = "8px";

  const firstDay =
    new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  const daysInMonth =
    new Date(Date.UTC(year, month, 0)).getUTCDate();

  const todayKey = getDateKey();

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement("div");
    blank.style.aspectRatio = "1 / 1";
    historyCalendar.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key =
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const record = records.get(key);
    const cell = document.createElement("div");

    cell.style.aspectRatio = "1 / 1";
    cell.style.minWidth = "0";
    cell.style.display = "flex";
    cell.style.alignItems = "center";
    cell.style.justifyContent = "center";
    cell.style.borderRadius = "10px";
    cell.style.border = "1px solid #273449";
    cell.style.backgroundColor = "#020617";
    cell.style.color = "#94a3b8";
    cell.style.fontSize = "14px";

    if (record?.status === "present") {
      cell.style.backgroundColor = "#064e3b";
      cell.style.borderColor = "#059669";
      cell.style.color = "#6ee7b7";
    } else if (record?.status === "absent") {
      cell.style.backgroundColor = "#450a0a";
      cell.style.borderColor = "#dc2626";
      cell.style.color = "#fca5a5";
    }

    if (key === todayKey) {
      cell.style.outline = "2px solid #10b981";
    }

    cell.textContent = String(day);
    cell.title = `${key}: ${
      record?.status === "present"
        ? "Hadir"
        : record?.status === "absent"
          ? "Tidak hadir"
          : "Belum ada catatan"
    }`;

    historyCalendar.appendChild(cell);
  }
}

// ========================================
// RIWAYAT BULANAN DAN LEMBUR
// ========================================

async function loadMonthlyHistory() {
  if (!currentUser || !historyMonth?.value) return;

  const requestId = ++historyRequestId;
  const uid = currentUser.uid;
  const monthKey = historyMonth.value;
  const [year, month] = monthKey.split("-").map(Number);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    if (historyMessage) historyMessage.textContent = "Bulan tidak valid.";
    return;
  }

  const startDate = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const endDate =
    `${monthKey}-${String(lastDay).padStart(2, "0")}`;

  if (historyMessage) historyMessage.textContent = "Memuat riwayat...";
  if (historyPresent) historyPresent.textContent = "—";
  if (historyOvertime) historyOvertime.textContent = "—";

  historyCalendar?.replaceChildren();
  historyOvertimeList?.replaceChildren();

  try {
    console.log("[DEBUG] Membaca koleksi attendance.");

    const attendanceQuery = query(
      collection(db, "attendance"),
      where("userId", "==", uid)
    );

    console.log("[DEBUG] Membaca koleksi overtime.");

    const overtimeQuery = query(
      collection(db, "overtime"),
      where("userId", "==", uid)
    );

    let attendanceSnapshot;
    let overtimeSnapshot;

    try {
      attendanceSnapshot = await getDocs(attendanceQuery);
      console.log("[DEBUG] Koleksi attendance berhasil dibaca.");
    } catch (error) {
      logFirebaseError("Gagal membaca koleksi attendance", error);
      throw error;
    }

    try {
      overtimeSnapshot = await getDocs(overtimeQuery);
      console.log("[DEBUG] Koleksi overtime berhasil dibaca.");
    } catch (error) {
      logFirebaseError("Gagal membaca koleksi overtime", error);
      throw error;
    }

    if (
      requestId !== historyRequestId ||
      currentUser?.uid !== uid
    ) {
      return;
    }

    const records = new Map();

    attendanceSnapshot.forEach(item => {
      const data = item.data();

      if (
        typeof data.dateKey === "string" &&
        data.dateKey >= startDate &&
        data.dateKey <= endDate
      ) {
        records.set(data.dateKey, data);
      }
    });

    const presentCount = [...records.values()].filter(
      item => item.status === "present"
    ).length;

    const overtimeRecords = [];

    overtimeSnapshot.forEach(item => {
      const data = item.data();

      if (
        typeof data.dateKey === "string" &&
        data.dateKey >= startDate &&
        data.dateKey <= endDate &&
        typeof data.hours === "number" &&
        Number.isFinite(data.hours) &&
        data.hours >= 0
      ) {
        overtimeRecords.push({
          dateKey: data.dateKey,
          hours: data.hours
        });
      }
    });

    overtimeRecords.sort((a, b) =>
      b.dateKey.localeCompare(a.dateKey)
    );

    const totalHours = overtimeRecords.reduce(
      (sum, item) => sum + item.hours,
      0
    );

    if (historyPresent) {
      historyPresent.textContent = `${presentCount} hari`;
    }

    if (historyOvertime) {
      historyOvertime.textContent = formatHours(totalHours);
    }

    renderHistoryCalendar(year, month, records);

    if (historyOvertimeList) {
      if (overtimeRecords.length === 0) {
        const empty = document.createElement("p");
        empty.className = "text-sm text-slate-400";
        empty.textContent =
          "Belum ada catatan lembur pada bulan ini.";

        historyOvertimeList.appendChild(empty);
      } else {
        overtimeRecords.forEach(item => {
          const row = document.createElement("div");

          row.className =
            "flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4";

          const date = document.createElement("p");
          date.className = "text-sm text-slate-300";
          date.textContent = formatDateKey(item.dateKey);

          const hours = document.createElement("p");
          hours.className = "shrink-0 font-semibold text-sky-400";
          hours.textContent = formatHours(item.hours);

          row.append(date, hours);
          historyOvertimeList.appendChild(row);
        });
      }
    }

    const label = new Intl.DateTimeFormat("id-ID", {
      month: "long",
      year: "numeric",
      timeZone: TIME_ZONE
    }).format(new Date(Date.UTC(year, month - 1, 1, 12)));

    if (historyMessage) {
      historyMessage.textContent =
        `Menampilkan riwayat ${label}.`;
    }
  } catch (error) {
    logFirebaseError("Gagal memuat riwayat bulanan", error);

    if (requestId !== historyRequestId) return;

    if (historyMessage) {
      historyMessage.textContent =
        error.code === "permission-denied"
          ? "Akses riwayat ditolak. Periksa Firestore Rules."
          : "Riwayat gagal dimuat. Silakan coba lagi.";
    }

    if (historyPresent) historyPresent.textContent = "—";
    if (historyOvertime) historyOvertime.textContent = "—";
  }
}

// ========================================
// VERIFIKASI AKUN
// ========================================

async function verifyEmployee(user) {
  console.log("[DEBUG] UID login:", user.uid);

  const userRef = doc(db, "users", user.uid);

  let snapshot;

  try {
    snapshot = await getDoc(userRef);
    console.log(
      "[DEBUG] Baca profil berhasil:",
      snapshot.exists()
    );
  } catch (error) {
    logFirebaseError("Gagal membaca profil users", error);
    throw error;
  }

  if (!snapshot.exists()) {
    throw new Error(
      "Profil akun tidak ditemukan. Hubungi Admin."
    );
  }

  const profile = snapshot.data();

  console.log("[DEBUG] Role:", profile.role);
  console.log("[DEBUG] Status aktif:", profile.isActive);

  if (profile.isActive !== true) {
    throw new Error("Akun dinonaktifkan oleh Admin.");
  }

  if (profile.role === "admin") {
    window.location.replace("./admin.html");
    return;
  }

  if (profile.role !== "user") {
    throw new Error("Akun tidak memiliki akses karyawan.");
  }

  if (employeeName) {
    employeeName.textContent = profile.name || "Karyawan";
  }

  if (employeePosition) {
    employeePosition.textContent =
      profile.position || "Jabatan belum diisi";
  }

  if (accountStatus) {
    accountStatus.textContent = "Akun Aktif";
  }

  currentUser = user;

  if (historyMonth) {
    historyMonth.value = getCurrentMonthKey();
  }

  try {
    await loadTodayAttendance();
    console.log("[DEBUG] Baca absensi hari ini berhasil.");
  } catch (error) {
    logFirebaseError("Gagal membaca absensi hari ini", error);
    throw error;
  }

  // Fungsi ini menangani error riwayat sendiri agar
  // kegagalan riwayat tidak menggagalkan validasi profil.
  await loadMonthlyHistory();

  showMessage("Akun aktif. Silakan lakukan absensi.", "success");
}

// ========================================
// EVENT LISTENERS
// ========================================

attendanceBtn?.addEventListener("click", submitAttendance);
historyMonth?.addEventListener("change", loadMonthlyHistory);

noOvertimeBtn?.addEventListener("click", chooseNoOvertime);

logoutBtn?.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  try {
    await signOut(auth);
    window.location.replace("./index.html");
  } catch (error) {
    logFirebaseError("Gagal keluar", error);

    logoutBtn.disabled = false;

    showMessage(
      "Gagal keluar. Silakan coba kembali.",
      "error"
    );
  }
});

// ========================================
// SESI LOGIN
// ========================================

onAuthStateChanged(auth, async user => {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }

  currentUser = null;
  todayRecord = null;
  historyRequestId++;

  setAttendanceButton(false, "Memeriksa akun...");

  if (!user) {
    window.location.replace("./index.html");
    return;
  }

  updateClock();
  clockInterval = setInterval(updateClock, 1000);

  if (isVerifying) return;

  isVerifying = true;

  try {
    await verifyEmployee(user);
  } catch (error) {
    logFirebaseError("Pemeriksaan akun gagal", error);

    if (accountStatus) {
      accountStatus.textContent = "Pemeriksaan gagal";
    }

    showMessage(
      error.message || "Gagal memeriksa akun.",
      "error"
    );

    if (historyMessage) {
      historyMessage.textContent =
        "Riwayat belum dapat dimuat.";
    }

    setAttendanceButton(false, "Absensi Belum Tersedia");
  } finally {
    isVerifying = false;
  }
});
