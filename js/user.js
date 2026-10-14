
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "firebase/auth";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore";

// ========================================
// ELEMEN HALAMAN
// ========================================

const employeeName = document.getElementById("employeeName");
const employeePosition = document.getElementById("employeePosition");
const accountStatus = document.getElementById("accountStatus");

const todayDate = document.getElementById("todayDate");
const currentTime = document.getElementById("currentTime");

const attendanceIndicator = document.getElementById("attendanceIndicator");
const attendanceStatus = document.getElementById("attendanceStatus");
const attendanceTime = document.getElementById("attendanceTime");

const locationStatus = document.getElementById("locationStatus");
const attendanceBtn = document.getElementById("attendanceBtn");
const attendanceMessage = document.getElementById("attendanceMessage");
const logoutBtn = document.getElementById("logoutBtn");

const historyMonth = document.getElementById("historyMonth");
const historyMessage = document.getElementById("historyMessage");
const historyPresent = document.getElementById("historyPresent");
const historyOvertime = document.getElementById("historyOvertime");
const historyCalendar = document.getElementById("historyCalendar");
const historyOvertimeList = document.getElementById("historyOvertimeList");

// ========================================
// STATE DAN PENGATURAN
// ========================================

const timeZone = "Asia/Jakarta";

let currentUser = null;
let isProcessing = false;
let isVerifying = false;
let clockInterval = null;
let historyRequestId = 0;

// ========================================
// TANGGAL DAN WAKTU WIB
// ========================================

function getDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
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
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Intl.DateTimeFormat("id-ID", {
    timeZone,
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
  const now = new Date();

  todayDate.textContent = formatDate(now);
  currentTime.textContent = `Waktu sekarang: ${formatTime(now)} WIB`;
}

// ========================================
// PESAN DAN TOMBOL
// ========================================

function showMessage(message, type = "info") {
  attendanceMessage.textContent = message;

  const colors = {
    info: "text-slate-400",
    success: "text-emerald-400",
    error: "text-red-400"
  };

  attendanceMessage.className =
    `mt-3 text-sm leading-6 ${colors[type] || colors.info}`;
}

function setAttendanceButton(enabled, text) {
  attendanceBtn.disabled = !enabled;
  attendanceBtn.textContent = text;
}

// ========================================
// STATUS ABSENSI HARI INI
// ========================================

function showAlreadyAttended(data) {
  attendanceIndicator.textContent =
    data.status === "absent" ? "!" : "✓";

  attendanceIndicator.className =
    data.status === "absent"
      ? "flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-xl text-red-400"
      : "flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-xl text-emerald-400";

  attendanceStatus.textContent =
    data.status === "absent" ? "Tidak Hadir" : "Sudah Absen";

  attendanceStatus.className =
    data.status === "absent"
      ? "font-semibold text-red-400"
      : "font-semibold text-emerald-400";

  if (data.timestamp && typeof data.timestamp.toDate === "function") {
    attendanceTime.textContent =
      `Waktu absen: ${formatTime(data.timestamp.toDate())} WIB`;
  } else {
    attendanceTime.textContent = "Catatan absensi hari ini tersedia.";
  }

  locationStatus.textContent =
    typeof data.latitude === "number" &&
    typeof data.longitude === "number"
      ? `Latitude: ${data.latitude.toFixed(6)}, Longitude: ${data.longitude.toFixed(6)}`
      : "Koordinat tersimpan pada data absensi.";

  setAttendanceButton(false, "Absensi Sudah Tercatat");
}

function showNotAttended() {
  attendanceIndicator.textContent = "—";
  attendanceIndicator.className =
    "flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-xl text-slate-300";

  attendanceStatus.textContent = "Belum Absen";
  attendanceStatus.className = "font-semibold text-slate-100";

  attendanceTime.textContent = "Silakan lakukan absensi hari ini.";

  locationStatus.textContent = "Lokasi belum diambil.";

  setAttendanceButton(true, "Absen Sekarang");
}

async function loadTodayAttendance() {
  if (!currentUser) return;

  const dateKey = getDateKey();
  const attendanceId = `${currentUser.uid}_${dateKey}`;
  const attendanceRef = doc(db, "attendance", attendanceId);
  const attendanceSnapshot = await getDoc(attendanceRef);

  if (attendanceSnapshot.exists()) {
    showAlreadyAttended(attendanceSnapshot.data());
  } else {
    showNotAttended();
  }
}

// ========================================
// KALENDER RIWAYAT ABSENSI
// ========================================

function renderHistoryCalendar(year, month, attendanceByDate) {
  historyCalendar.replaceChildren();

  // Menggunakan CSS Grid langsung agar selalu 7 kolom.
  historyCalendar.style.display = "grid";
  historyCalendar.style.gridTemplateColumns =
    "repeat(7, minmax(0, 1fr))";
  historyCalendar.style.gap = "8px";

  const firstDay = new Date(
    Date.UTC(year, month - 1, 1)
  ).getUTCDay();

  const daysInMonth = new Date(
    Date.UTC(year, month, 0)
  ).getUTCDate();

  const todayKey = getDateKey();

  // Sel kosong sebelum tanggal pertama.
  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement("div");

    blank.style.aspectRatio = "1 / 1";
    blank.setAttribute("aria-hidden", "true");

    historyCalendar.appendChild(blank);
  }

  // Kotak tanggal.
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey =
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const record = attendanceByDate.get(dateKey);
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
    cell.style.transition = "background-color 0.2s";

    if (record?.status === "present") {
      cell.style.backgroundColor = "#064e3b";
      cell.style.borderColor = "#059669";
      cell.style.color = "#6ee7b7";
      cell.style.fontWeight = "600";
      cell.title = `${dateKey}: Hadir`;
    } else if (record?.status === "absent") {
      cell.style.backgroundColor = "#450a0a";
      cell.style.borderColor = "#dc2626";
      cell.style.color = "#fca5a5";
      cell.style.fontWeight = "600";
      cell.title = `${dateKey}: Tidak hadir`;
    } else {
      cell.title = `${dateKey}: Belum ada catatan`;
    }

    // Tandai hari ini.
    if (dateKey === todayKey) {
      cell.style.outline = "2px solid #10b981";
      cell.style.outlineOffset = "-2px";
    }

    cell.textContent = day;
    cell.setAttribute(
      "aria-label",
      `${day}, ${
        record?.status === "present"
          ? "hadir"
          : record?.status === "absent"
            ? "tidak hadir"
            : "belum ada catatan"
      }`
    );

    historyCalendar.appendChild(cell);
  }
}

// ========================================
// MEMUAT RIWAYAT BULANAN
// ========================================

async function loadMonthlyHistory() {
  if (!currentUser || !historyMonth.value) return;

  const requestId = ++historyRequestId;
  const uid = currentUser.uid;
  const monthKey = historyMonth.value;
  const [year, month] = monthKey.split("-").map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    historyMessage.textContent = "Bulan yang dipilih tidak valid.";
    return;
  }

  const startDate = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate =
    `${monthKey}-${String(lastDay).padStart(2, "0")}`;

  historyMessage.textContent = "Memuat riwayat...";
  historyPresent.textContent = "—";
  historyOvertime.textContent = "—";
  historyCalendar.replaceChildren();
  historyOvertimeList.replaceChildren();

  try {
    // Query dibatasi ke akun karyawan yang sedang login.
    const attendanceQuery = query(
      collection(db, "attendance"),
      where("userId", "==", uid)
    );

    const overtimeQuery = query(
      collection(db, "overtime"),
      where("userId", "==", uid)
    );

    const [attendanceSnapshot, overtimeSnapshot] =
      await Promise.all([
        getDocs(attendanceQuery),
        getDocs(overtimeQuery)
      ]);

    // Abaikan hasil lama jika pengguna mengganti bulan
    // saat permintaan sebelumnya belum selesai.
    if (
      requestId !== historyRequestId ||
      currentUser?.uid !== uid
    ) {
      return;
    }

    // ----------------------------
    // DATA ABSENSI
    // ----------------------------

    const attendanceByDate = new Map();

    attendanceSnapshot.forEach(snapshot => {
      const data = snapshot.data();

      if (
        typeof data.dateKey === "string" &&
        data.dateKey >= startDate &&
        data.dateKey <= endDate
      ) {
        attendanceByDate.set(data.dateKey, data);
      }
    });

    const attendanceRecords = [...attendanceByDate.values()];

    const presentCount = attendanceRecords.filter(
      record => record.status === "present"
    ).length;

    // ----------------------------
    // DATA LEMBUR
    // ----------------------------

    const overtimeRecords = [];

    overtimeSnapshot.forEach(snapshot => {
      const data = snapshot.data();

      if (
        typeof data.dateKey === "string" &&
        data.dateKey >= startDate &&
        data.dateKey <= endDate &&
        typeof data.hours === "number" &&
        Number.isFinite(data.hours) &&
        data.hours >= 0
      ) {
        // Hanya simpan tanggal dan durasi.
        // Jangan tampilkan tarif atau nominal pembayaran.
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
      (sum, record) => sum + record.hours,
      0
    );

    // ----------------------------
    // TAMPILKAN RINGKASAN
    // ----------------------------

    historyPresent.textContent = `${presentCount} hari`;
    historyOvertime.textContent = formatHours(totalHours);

    renderHistoryCalendar(year, month, attendanceByDate);

    // ----------------------------
    // TAMPILKAN RINCIAN LEMBUR
    // ----------------------------

    if (overtimeRecords.length === 0) {
      const empty = document.createElement("p");

      empty.className = "text-sm text-slate-400";
      empty.textContent =
        "Belum ada catatan lembur pada bulan ini.";

      historyOvertimeList.appendChild(empty);
    } else {
      overtimeRecords.forEach(record => {
        const item = document.createElement("div");

        item.className =
          "flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4";

        const date = document.createElement("p");

        date.className = "text-sm text-slate-300";
        date.textContent = formatDateKey(record.dateKey);

        const hours = document.createElement("p");

        hours.className = "shrink-0 font-semibold text-sky-400";
        hours.textContent = formatHours(record.hours);

        item.append(date, hours);
        historyOvertimeList.appendChild(item);
      });
    }

    const monthLabel = new Intl.DateTimeFormat("id-ID", {
      month: "long",
      year: "numeric",
      timeZone
    }).format(new Date(Date.UTC(year, month - 1, 1, 12)));

    historyMessage.textContent =
      `Menampilkan riwayat ${monthLabel}.`;
  } catch (error) {
    console.error("Gagal memuat riwayat:", error);

    if (
      requestId !== historyRequestId ||
      currentUser?.uid !== uid
    ) {
      return;
    }

    historyMessage.textContent =
      error.code === "permission-denied"
        ? "Akses riwayat ditolak. Periksa Firestore Security Rules."
        : "Riwayat gagal dimuat. Silakan coba kembali.";

    historyPresent.textContent = "—";
    historyOvertime.textContent = "—";

    const errorItem = document.createElement("p");

    errorItem.className = "text-sm text-red-400";
    errorItem.textContent = "Data belum dapat ditampilkan.";

    historyOvertimeList.appendChild(errorItem);
  }
}

// ========================================
// VERIFIKASI AKUN KARYAWAN
// ========================================

async function verifyEmployee(user) {
  const userRef = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userRef);

  if (!userSnapshot.exists()) {
    throw new Error("Profil akun tidak ditemukan. Hubungi Admin.");
  }

  const profile = userSnapshot.data();

  if (profile.isActive !== true) {
    throw new Error("Akun kamu sudah dinonaktifkan oleh Admin.");
  }

  if (profile.role !== "user") {
    if (profile.role === "admin") {
      window.location.replace("./admin.html");
      return false;
    }

    throw new Error(
      "Akun ini tidak memiliki akses ke halaman karyawan."
    );
  }

  employeeName.textContent = profile.name || "Karyawan";

  employeePosition.textContent =
    profile.position || "Jabatan belum diisi";

  accountStatus.textContent = "Akun Aktif";

  currentUser = user;
  historyMonth.value = getCurrentMonthKey();

  await loadTodayAttendance();
  await loadMonthlyHistory();

  showMessage(
    "Akun aktif. Kamu dapat melakukan absensi hari ini.",
    "success"
  );

  return true;
}

// ========================================
// GPS
// ========================================

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Browser tidak mendukung fitur GPS."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      error => {
        let message = "Lokasi tidak berhasil diambil.";

        if (error.code === error.PERMISSION_DENIED) {
          message =
            "Izin lokasi ditolak. Aktifkan izin lokasi di browser.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message =
            "Lokasi belum tersedia. Periksa GPS perangkat.";
        } else if (error.code === error.TIMEOUT) {
          message =
            "Pengambilan lokasi terlalu lama. Silakan coba lagi.";
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

// ========================================
// PROSES ABSENSI
// ========================================

async function submitAttendance() {
  if (!currentUser || isProcessing) return;

  isProcessing = true;

  setAttendanceButton(false, "Mengambil lokasi GPS...");
  showMessage(
    "Mohon izinkan akses lokasi pada browser.",
    "info"
  );

  locationStatus.textContent = "Sedang mengambil lokasi...";

  try {
    // Verifikasi ulang akun sebelum menyimpan.
    const userRef = doc(db, "users", currentUser.uid);
    const userSnapshot = await getDoc(userRef);

    if (
      !userSnapshot.exists() ||
      userSnapshot.data().isActive !== true ||
      userSnapshot.data().role !== "user"
    ) {
      await signOut(auth);
      window.location.replace("./index.html");
      return;
    }

    const dateKey = getDateKey();
    const attendanceId = `${currentUser.uid}_${dateKey}`;
    const attendanceRef = doc(db, "attendance", attendanceId);

    // Cegah absensi kedua pada tanggal yang sama.
    const existingAttendance = await getDoc(attendanceRef);

    if (existingAttendance.exists()) {
      showAlreadyAttended(existingAttendance.data());
      showMessage("Absensi hari ini sudah tercatat.", "info");
      return;
    }

    const position = await getCurrentPosition();

    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    locationStatus.textContent =
      `Latitude: ${latitude.toFixed(6)}, Longitude: ${longitude.toFixed(6)}`;

    setAttendanceButton(false, "Menyimpan absensi...");
    showMessage(
      "Menyimpan data absensi ke Firebase...",
      "info"
    );

    await setDoc(attendanceRef, {
      userId: currentUser.uid,
      dateKey,
      timestamp: serverTimestamp(),
      latitude,
      longitude,
      status: "present"
    });

    await loadTodayAttendance();
    await loadMonthlyHistory();

    showMessage(
      "Absensi berhasil dicatat. Terima kasih!",
      "success"
    );
  } catch (error) {
    console.error("Kesalahan absensi:", error);

    if (error.code === "permission-denied") {
      showMessage(
        "Akses ditolak oleh Firestore. Periksa status akun dan Security Rules.",
        "error"
      );
    } else {
      showMessage(
        error.message ||
          "Terjadi kesalahan saat melakukan absensi.",
        "error"
      );
    }

    if (currentUser) {
      try {
        await loadTodayAttendance();
      } catch (reloadError) {
        console.error(
          "Gagal memuat ulang absensi:",
          reloadError
        );
      }
    }
  } finally {
    isProcessing = false;

    if (
      currentUser &&
      attendanceBtn.textContent !== "Absensi Sudah Tercatat"
    ) {
      setAttendanceButton(true, "Absen Sekarang");
    }
  }
}

// ========================================
// EVENT LISTENERS
// ========================================

attendanceBtn.addEventListener("click", submitAttendance);

historyMonth.addEventListener("change", loadMonthlyHistory);

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  try {
    await signOut(auth);
    window.location.replace("./index.html");
  } catch (error) {
    console.error("Gagal keluar:", error);

    logoutBtn.disabled = false;

    showMessage(
      "Gagal keluar. Silakan coba kembali.",
      "error"
    );
  }
});

// ========================================
// PEMERIKSAAN SESI LOGIN
// ========================================

onAuthStateChanged(auth, async user => {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }

  currentUser = null;
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
    console.error("Pemeriksaan akun gagal:", error);

    accountStatus.textContent = "Pemeriksaan gagal";

    showMessage(
      `Error: ${error.code || "tidak diketahui"} — ${
        error.message || "Gagal memeriksa akun."
      }`,
      "error"
    );

    historyMessage.textContent =
      "Riwayat belum dapat dimuat.";

    setAttendanceButton(
      false,
      "Absensi Belum Tersedia"
    );
  } finally {
    isVerifying = false;
  }
});
