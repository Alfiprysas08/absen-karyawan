
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "firebase/auth";

import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  updateDoc,
  Timestamp
} from "firebase/firestore";

// =====================================
// ELEMEN HALAMAN
// =====================================

const totalRecords = document.getElementById("totalRecords");
const totalEmployees = document.getElementById("totalEmployees");
const periodLabel = document.getElementById("periodLabel");

const periodFilter = document.getElementById("periodFilter");
const dailyDateField = document.getElementById("dailyDateField");
const dateFilter = document.getElementById("dateFilter");
const monthlyField = document.getElementById("monthlyField");
const monthFilter = document.getElementById("monthFilter");

const searchInput = document.getElementById("searchInput");
const resetFilterBtn = document.getElementById("resetFilterBtn");
const refreshBtn = document.getElementById("refreshBtn");

const pageMessage = document.getElementById("pageMessage");
const summaryTableBody = document.getElementById("summaryTableBody");
const attendanceTableBody = document.getElementById("attendanceTableBody");

// =====================================
// STATE
// =====================================

const TIME_ZONE = "Asia/Jakarta";

let attendanceData = [];
let employeeData = {};

let isAuthorized = false;
let isLoading = false;
let authCheckFinished = false;

// =====================================
// TANGGAL DAN WAKTU
// =====================================

function getTodayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(dateKey) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return "-";
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, 15, 12)));
}

function formatTime(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "Tidak tersedia";
  }

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(timestamp.toDate()) + " WIB";
}

function getTimeInputValue(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(timestamp.toDate());
}

// =====================================
// PESAN DAN TAMPILAN
// =====================================

function showMessage(message, type = "info") {
  const classes = {
    info: "mt-4 text-sm text-slate-400",
    success: "mt-4 text-sm text-emerald-400",
    error: "mt-4 text-sm text-red-400"
  };

  pageMessage.textContent = message;
  pageMessage.className = classes[type] || classes.info;
}

function setLoadingState(loading) {
  refreshBtn.disabled = loading;
  refreshBtn.textContent = loading ? "Memuat..." : "Muat Ulang";
}

function addCell(row, value, className = "px-5 py-4") {
  const cell = document.createElement("td");

  cell.className = className;
  cell.textContent = value ?? "-";

  row.appendChild(cell);
  return cell;
}

function showEmptyTable(tbody, colspan, message) {
  tbody.replaceChildren();

  const row = document.createElement("tr");
  const cell = document.createElement("td");

  cell.colSpan = colspan;
  cell.className = "px-5 py-8 text-center text-slate-400";
  cell.textContent = message;

  row.appendChild(cell);
  tbody.appendChild(row);
}

async function verifyActiveAdmin() {
  const currentAdmin = auth.currentUser;

  if (!currentAdmin) {
    throw new Error("Sesi Admin sudah berakhir. Silakan login kembali.");
  }

  const adminRef = doc(db, "users", currentAdmin.uid);
  const adminSnapshot = await getDoc(adminRef);

  if (
    !adminSnapshot.exists() ||
    adminSnapshot.data().role !== "admin" ||
    adminSnapshot.data().isActive !== true
  ) {
    throw new Error("Akun tidak memiliki akses Admin aktif.");
  }

  return currentAdmin;
}

// =====================================
// RENTANG REKAP
// =====================================

function getPeriodRange() {
  const mode = periodFilter.value;
  const anchor = dateFilter.value || getTodayKey();

  if (mode === "daily") {
    return {
      start: anchor,
      end: anchor,
      label: formatDate(anchor)
    };
  }

  if (mode === "weekly") {
    const [year, month, day] = anchor.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12));

    // Senin adalah hari pertama minggu.
    const dayOfWeek = date.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;

    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    const start = date.toISOString().slice(0, 10);

    date.setUTCDate(date.getUTCDate() + 6);
    const end = date.toISOString().slice(0, 10);

    return {
      start,
      end,
      label: `${formatDate(start)} – ${formatDate(end)}`
    };
  }

  const selectedMonth = monthFilter.value || getTodayKey().slice(0, 7);
  const [year, month] = selectedMonth.split("-").map(Number);

  const start = `${selectedMonth}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;

  return {
    start,
    end,
    label: formatMonth(selectedMonth)
  };
}

function updatePeriodControls() {
  const mode = periodFilter.value;

  dailyDateField.classList.toggle("hidden", mode === "monthly");
  monthlyField.classList.toggle("hidden", mode !== "monthly");

  if (!dateFilter.value) {
    dateFilter.value = getTodayKey();
  }

  if (!monthFilter.value) {
    monthFilter.value = getTodayKey().slice(0, 7);
  }

  renderTable();
}

// =====================================
// MEMUAT DATA FIRESTORE
// =====================================

async function loadAttendance() {
  if (!isAuthorized || isLoading) return;

  isLoading = true;
  setLoadingState(true);
  showMessage("Mengambil data dari Firestore...");

  try {
    const [attendanceSnapshot, usersSnapshot] = await Promise.all([
      getDocs(collection(db, "attendance")),
      getDocs(collection(db, "users"))
    ]);

    attendanceData = attendanceSnapshot.docs.map(snapshot => ({
      id: snapshot.id,
      ...snapshot.data()
    }));

    employeeData = {};

    usersSnapshot.docs.forEach(snapshot => {
      employeeData[snapshot.id] = snapshot.data();
    });

    renderTable();

    showMessage(
      `Data berhasil dimuat. Total ${attendanceData.length} catatan absensi.`,
      "success"
    );
  } catch (error) {
    console.error("Gagal memuat rekap:", error);
    console.error("Kode error:", error.code);

    showMessage(
      `Gagal memuat data: ${error.code || error.message}`,
      "error"
    );

    showEmptyTable(
      summaryTableBody,
      5,
      "Rekap gagal dimuat."
    );

    showEmptyTable(
      attendanceTableBody,
      8,
      "Data gagal dimuat. Periksa pesan error."
    );
  } finally {
    isLoading = false;
    setLoadingState(false);
  }
}

// =====================================
// MENAMPILKAN REKAP DAN DETAIL
// =====================================

function renderTable() {
  if (!isAuthorized) return;

  const range = getPeriodRange();
  const keyword = searchInput.value.trim().toLocaleLowerCase("id-ID");

  const filteredData = attendanceData.filter(item => {
    const profile = employeeData[item.userId] || {};
    const name = profile.name || "Profil tidak ditemukan";

    return (
      typeof item.dateKey === "string" &&
      item.dateKey >= range.start &&
      item.dateKey <= range.end &&
      name.toLocaleLowerCase("id-ID").includes(keyword)
    );
  });

  filteredData.sort((a, b) => {
    const dateComparison = (b.dateKey || "").localeCompare(a.dateKey || "");

    if (dateComparison !== 0) return dateComparison;

    return (b.timestamp?.toMillis?.() || 0)
      - (a.timestamp?.toMillis?.() || 0);
  });

  periodLabel.textContent = range.label;
  totalRecords.textContent = filteredData.length;

  const presentEmployeeIds = new Set(
    filteredData
      .filter(item => item.status === "present")
      .map(item => item.userId)
  );

  totalEmployees.textContent = presentEmployeeIds.size;

  renderSummary(filteredData);
  renderAttendanceDetails(filteredData);
}

function renderSummary(data) {
  const summaries = {};

  data.forEach(item => {
    const profile = employeeData[item.userId] || {};
    const id = item.userId;

    if (!summaries[id]) {
      summaries[id] = {
        name: profile.name || "Profil tidak ditemukan",
        position: profile.position || "-",
        dates: new Set()
      };
    }

    if (item.status === "present") {
      summaries[id].dates.add(item.dateKey);
    }
  });

  const entries = Object.values(summaries).sort(
    (a, b) => a.name.localeCompare(b.name, "id")
  );

  summaryTableBody.replaceChildren();

  if (entries.length === 0) {
    showEmptyTable(
      summaryTableBody,
      5,
      "Tidak ada data pada periode ini."
    );
    return;
  }

  entries.forEach((item, index) => {
    const row = document.createElement("tr");
    row.className = "hover:bg-slate-800/50";

    addCell(row, index + 1);
    addCell(row, item.name);
    addCell(row, item.position);
    addCell(row, item.dates.size);

    const dates = [...item.dates].sort();

    addCell(
      row,
      dates.length ? dates.map(formatDate).join(", ") : "-"
    );

    summaryTableBody.appendChild(row);
  });
}

function renderAttendanceDetails(data) {
  attendanceTableBody.replaceChildren();

  if (data.length === 0) {
    showEmptyTable(
      attendanceTableBody,
      8,
      "Tidak ada data absensi yang sesuai periode."
    );
    return;
  }

  data.forEach((item, index) => {
    const profile = employeeData[item.userId] || {};
    const row = document.createElement("tr");

    row.className = "hover:bg-slate-800/50";

    addCell(row, index + 1);
    addCell(row, profile.name || "Profil tidak ditemukan");
    addCell(row, profile.position || "-");
    addCell(row, formatDate(item.dateKey));
    addCell(row, formatTime(item.timestamp));

    const statusCell = addCell(row, "");
    const statusBadge = document.createElement("span");

    if (item.status === "present") {
      statusBadge.className =
        "inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400";
      statusBadge.textContent = "Hadir";
    } else {
      statusBadge.className =
        "inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400";
      statusBadge.textContent = item.status || "Tidak diketahui";
    }

    statusCell.appendChild(statusBadge);

    const gpsCell = addCell(row, "");

    if (
      typeof item.latitude === "number" &&
      typeof item.longitude === "number"
    ) {
      gpsCell.textContent =
        `${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}`;
      gpsCell.classList.add("whitespace-nowrap", "font-mono", "text-xs");
    } else {
      gpsCell.textContent = "Tidak tersedia";
    }

    const actionCell = addCell(row, "");
    const actionWrapper = document.createElement("div");
    actionWrapper.className = "flex flex-wrap gap-2";

    const editButton = document.createElement("button");

    editButton.type = "button";
    editButton.textContent = "Koreksi";
    editButton.className =
      "rounded-lg border border-blue-700 px-3 py-2 text-xs font-semibold text-blue-300 transition hover:bg-blue-950";

    editButton.addEventListener("click", () => {
      correctAttendance(item, editButton);
    });

    const deleteButton = document.createElement("button");

    deleteButton.type = "button";
    deleteButton.textContent = "Hapus";
    deleteButton.className =
      "rounded-lg border border-red-700 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-950 disabled:opacity-50";

    deleteButton.addEventListener("click", () => {
      deleteAttendance(item, deleteButton);
    });

    actionWrapper.append(editButton, deleteButton);
    actionCell.appendChild(actionWrapper);
    attendanceTableBody.appendChild(row);
  });
}

// =====================================
// KOREKSI ABSENSI
// =====================================

async function correctAttendance(item, button) {
  if (!isAuthorized || !auth.currentUser) {
    showMessage("Sesi Admin tidak tersedia. Login kembali.", "error");
    return;
  }

  if (button.disabled) return;

  if (!item.id || !item.userId || !item.dateKey) {
    showMessage("Data absensi tidak lengkap.", "error");
    return;
  }

  const initialTime = getTimeInputValue(item.timestamp);

  if (!initialTime) {
    showMessage("Waktu absensi tidak tersedia.", "error");
    return;
  }

  const newTime = prompt(
    "Masukkan waktu absensi baru (HH:MM WIB):",
    initialTime
  );

  if (newTime === null) return;

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(newTime)) {
    showMessage("Format waktu tidak valid. Contoh: 08:30.", "error");
    return;
  }

  const newStatus = prompt(
    "Masukkan status: present atau absent",
    item.status || "present"
  );

  if (newStatus === null) return;

  if (!["present", "absent"].includes(newStatus)) {
    showMessage("Status hanya boleh present atau absent.", "error");
    return;
  }

  const employeeName =
    employeeData[item.userId]?.name || item.userId;

  if (!confirm(
    `Koreksi absensi ${employeeName}?\n\n` +
    `Tanggal: ${formatDate(item.dateKey)}\n` +
    `Waktu baru: ${newTime} WIB\n` +
    `Status baru: ${newStatus === "present" ? "Hadir" : "Tidak hadir"}`
  )) {
    return;
  }

  button.disabled = true;
  button.textContent = "Menyimpan...";

  try {
    const currentAdmin = await verifyActiveAdmin();

    const latestRef = doc(db, "attendance", item.id);
    const latestSnapshot = await getDoc(latestRef);

    if (!latestSnapshot.exists()) {
      throw new Error("Catatan absensi sudah tidak ditemukan.");
    }

    const latest = latestSnapshot.data();

    if (
      latest.userId !== item.userId ||
      latest.dateKey !== item.dateKey
    ) {
      throw new Error(
        "Data berubah sejak terakhir dimuat. Muat ulang sebelum mengoreksi."
      );
    }

    const [year, month, day] = item.dateKey.split("-").map(Number);
    const [hours, minutes] = newTime.split(":").map(Number);

    // Konversi WIB ke UTC; tanggal dokumen tidak diubah.
    const correctedDate = new Date(
      Date.UTC(year, month - 1, day, hours - 7, minutes, 0)
    );

    await updateDoc(latestRef, {
      timestamp: Timestamp.fromDate(correctedDate),
      status: newStatus,
      correctedAt: Timestamp.now(),
      correctedBy: currentAdmin.uid
    });

    showMessage("Koreksi absensi berhasil disimpan.", "success");

    await loadAttendance();
  } catch (error) {
    console.error("Koreksi absensi gagal:", error);
    console.error("Kode error:", error.code);

    showMessage(
      `Koreksi gagal: ${error.code || error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Koreksi";
  }
}

// =====================================
// HAPUS ABSENSI
// =====================================

async function deleteAttendance(item, button) {
  if (!isAuthorized || !auth.currentUser) {
    showMessage("Sesi Admin tidak tersedia. Login kembali.", "error");
    return;
  }

  if (button.disabled) return;

  if (!item.id || !item.userId || !item.dateKey) {
    showMessage("Data absensi tidak lengkap.", "error");
    return;
  }

  const employeeName =
    employeeData[item.userId]?.name || item.userId;
  const attendanceDate = formatDate(item.dateKey);

  const confirmed = confirm(
    `Hapus permanen absensi ${employeeName}?\n\n` +
    `Tanggal: ${attendanceDate}\n\n` +
    `Data absensi akan dihapus dari Firestore dan tidak dapat dikembalikan. ` +
    `Data penggajian yang sudah tersimpan tidak akan diubah.`
  );

  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Menghapus...";

  try {
    await verifyActiveAdmin();

    const attendanceRef = doc(db, "attendance", item.id);
    const latestSnapshot = await getDoc(attendanceRef);

    if (!latestSnapshot.exists()) {
      throw new Error("Catatan absensi sudah tidak ditemukan.");
    }

    const latest = latestSnapshot.data();

    if (
      latest.userId !== item.userId ||
      latest.dateKey !== item.dateKey
    ) {
      throw new Error(
        "Data berubah sejak terakhir dimuat. Muat ulang sebelum menghapus."
      );
    }

    await deleteDoc(attendanceRef);
    await loadAttendance();

    showMessage(
      `Absensi ${employeeName} pada ${attendanceDate} berhasil dihapus permanen.`,
      "success"
    );
  } catch (error) {
    console.error("Hapus absensi gagal:", error);
    console.error("Kode error:", error.code);

    showMessage(
      error.code === "permission-denied"
        ? "Hapus gagal: akses ditolak. Hanya Admin aktif yang boleh menghapus absensi."
        : `Hapus gagal: ${error.code || error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Hapus";
  }
}

// =====================================
// FILTER
// =====================================

dateFilter.addEventListener("change", renderTable);
monthFilter.addEventListener("change", renderTable);
searchInput.addEventListener("input", renderTable);
periodFilter.addEventListener("change", updatePeriodControls);

resetFilterBtn.addEventListener("click", () => {
  dateFilter.value = getTodayKey();
  monthFilter.value = getTodayKey().slice(0, 7);
  searchInput.value = "";
  updatePeriodControls();
});

refreshBtn.addEventListener("click", loadAttendance);

// =====================================
// VERIFIKASI ADMIN
// =====================================

onAuthStateChanged(auth, async user => {
  if (authCheckFinished) return;
  authCheckFinished = true;

  if (!user) {
    window.location.replace("./index.html");
    return;
  }

  try {
    const profileRef = doc(db, "users", user.uid);
    const profileSnapshot = await getDoc(profileRef);

    if (
      !profileSnapshot.exists() ||
      profileSnapshot.data().role !== "admin" ||
      profileSnapshot.data().isActive !== true
    ) {
      await signOut(auth);
      window.location.replace("./index.html");
      return;
    }

    isAuthorized = true;

    dateFilter.value = getTodayKey();
    monthFilter.value = getTodayKey().slice(0, 7);

    updatePeriodControls();
    await loadAttendance();
  } catch (error) {
    console.error("Verifikasi Admin gagal:", error);
    console.error("Kode error:", error.code);

    showMessage(
      `Verifikasi Admin gagal: ${error.code || error.message}`,
      "error"
    );
  }
});
