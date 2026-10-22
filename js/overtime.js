
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "firebase/auth";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp
} from "firebase/firestore";

const $ = (id) => document.getElementById(id);

const form = $("reviewForm");
const tableBody = $("overtimeTableBody");
const messageBox = $("pageMessage");
const approveButton = $("approveButton");
const cancelButton = $("cancelReviewButton");

let currentAdmin = null;
let attendanceRecords = [];
let overtimeRecords = [];
let employeeMap = new Map();
let selectedRecord = null;
let busy = false;

const rupiah = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

function showMessage(message, type = "success") {
  messageBox.textContent = message;
  messageBox.className =
    "rounded-xl border p-4 text-sm " +
    (type === "error"
      ? "border-red-800 bg-red-950/50 text-red-300"
      : "border-emerald-800 bg-emerald-950/50 text-emerald-300");

  messageBox.classList.remove("hidden");
}

function hideMessage() {
  messageBox.classList.add("hidden");
}

function timestampDate(value) {
  if (value && typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) return value;

  return null;
}

function formatDate(dateKey) {
  if (!dateKey) return "-";

  const parts = dateKey.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return dateKey;
  }

  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta"
  }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)));
}

function formatTime(value) {
  const date = timestampDate(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta"
  }).format(date);
}

function formatDuration(minutes) {
  const value = Number(minutes);

  if (!Number.isFinite(value) || value < 0) return "-";

  const wholeMinutes = Math.floor(value);
  const hours = Math.floor(wholeMinutes / 60);
  const remainder = wholeMinutes % 60;

  return `${hours} jam ${remainder} menit`;
}

function actualDurationMinutes(attendance) {
  const start = timestampDate(attendance.overtimeCheckInAt);
  const end = timestampDate(attendance.overtimeCheckOutAt);

  if (!start || !end) return null;

  const difference = Math.floor((end.getTime() - start.getTime()) / 60000);

  if (difference <= 0 || difference > 24 * 60) return null;

  return difference;
}

function getEmployeeName(userId) {
  const employee = employeeMap.get(userId);

  return employee?.name || employee?.email || "Karyawan tidak ditemukan";
}

function getOvertimeForAttendance(attendanceId) {
  return overtimeRecords.find(
    (record) => record.attendanceId === attendanceId
  ) || null;
}

function calculateTotal() {
  const hours = Number($("approvedHours").value);
  const rate = Number($("hourlyRate").value);

  const total =
    Number.isFinite(hours) &&
    Number.isFinite(rate) &&
    hours > 0 &&
    rate > 0
      ? Math.round(hours * rate)
      : 0;

  $("calculatedTotal").textContent = rupiah(total);

  return total;
}

function setBusy(value) {
  busy = value;
  approveButton.disabled = value;
  cancelButton.disabled = value;

  approveButton.textContent = value
    ? "Memproses..."
    : selectedRecord?.approved
      ? "Simpan Perubahan"
      : "Setujui Lembur";
}

async function loadData() {
  tableBody.innerHTML = `
    <tr>
      <td colspan="8" class="px-3 py-8 text-center text-slate-400">
        Memuat data absensi lembur...
      </td>
    </tr>
  `;

  const [attendanceSnapshot, overtimeSnapshot, usersSnapshot] =
    await Promise.all([
      getDocs(collection(db, "attendance")),
      getDocs(collection(db, "overtime")),
      getDocs(collection(db, "users"))
    ]);

  employeeMap = new Map(
    usersSnapshot.docs.map((item) => [
      item.id,
      { id: item.id, ...item.data() }
    ])
  );

  attendanceRecords = attendanceSnapshot.docs
    .map((item) => ({
      id: item.id,
      ...item.data()
    }))
    .filter((item) => {
      const hasCompletedStatus = item.overtimeStatus === "completed";
      const hasBothTimes =
        item.overtimeCheckInAt &&
        item.overtimeCheckOutAt;

      return hasCompletedStatus && hasBothTimes;
    })
    .map((item) => ({
      ...item,
      actualMinutes: actualDurationMinutes(item)
    }))
    .filter((item) => item.actualMinutes !== null)
    .sort((a, b) =>
      String(b.dateKey || "").localeCompare(String(a.dateKey || ""))
    );

  overtimeRecords = overtimeSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  renderTable();
}

function renderTable() {
  const keyword = $("searchInput").value.trim().toLowerCase();
  const selectedDate = $("filterDate").value;

  const rows = attendanceRecords.filter((attendance) => {
    const name = getEmployeeName(attendance.userId).toLowerCase();

    return (
      name.includes(keyword) &&
      (!selectedDate || attendance.dateKey === selectedDate)
    );
  });

  tableBody.replaceChildren();

  let pendingCount = 0;
  let approvedCount = 0;
  let totalVisible = 0;

  for (const attendance of rows) {
    const overtime = getOvertimeForAttendance(attendance.id);
    const isApproved = overtime?.status === "approved";

    if (isApproved) {
      approvedCount += 1;
      totalVisible += Number(overtime.total) || 0;
    } else {
      pendingCount += 1;
    }

    const name = getEmployeeName(attendance.userId);
    const row = document.createElement("tr");
    row.className = "hover:bg-slate-800/50";

    const values = [
      formatDate(attendance.dateKey),
      name,
      formatDuration(attendance.actualMinutes),
      isApproved
        ? formatDuration(overtime.approvedDurationMinutes ?? Math.round(Number(overtime.hours) * 60))
        : "-",
      isApproved ? rupiah(overtime.hourlyRate) : "-",
      isApproved ? rupiah(overtime.total) : "-"
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.className = "px-3 py-4";
      cell.textContent = value;
      row.appendChild(cell);
    }

    const statusCell = document.createElement("td");
    statusCell.className = "px-3 py-4";

    const status = document.createElement("span");
    status.className = isApproved
      ? "rounded-full bg-emerald-950 px-3 py-1 text-xs text-emerald-300"
      : "rounded-full bg-amber-950 px-3 py-1 text-xs text-amber-300";
    status.textContent = isApproved ? "Disetujui" : "Menunggu";

    statusCell.appendChild(status);
    row.appendChild(statusCell);

    const actionCell = document.createElement("td");
    actionCell.className = "px-3 py-4";

    const reviewButton = document.createElement("button");
    reviewButton.type = "button";
    reviewButton.textContent = isApproved ? "Lihat / Edit" : "Periksa";
    reviewButton.className =
      "rounded-lg border border-blue-800 px-3 py-2 text-blue-300 hover:bg-blue-950";

    reviewButton.addEventListener("click", () => {
      openReview(attendance, overtime);
    });

    actionCell.appendChild(reviewButton);
    row.appendChild(actionCell);

    tableBody.appendChild(row);
  }

  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 8;
    cell.className = "px-3 py-10 text-center text-slate-400";
    cell.textContent =
      "Belum ada absensi lembur lengkap yang cocok dengan filter.";

    row.appendChild(cell);
    tableBody.appendChild(row);
  }

  $("recordCount").textContent = `${rows.length} catatan`;
  $("pendingCount").textContent = String(pendingCount);
  $("approvedCount").textContent = String(approvedCount);
  $("totalOvertime").textContent = rupiah(totalVisible);
}

function openReview(attendance, overtime = null) {
  if (busy) return;

  selectedRecord = {
    attendance,
    overtime,
    approved: overtime?.status === "approved"
  };

  $("selectedAttendanceId").value = attendance.id;
  $("employeeName").value = getEmployeeName(attendance.userId);
  $("dateKey").value = attendance.dateKey || "";

  $("actualCheckIn").textContent = formatTime(attendance.overtimeCheckInAt);
  $("actualCheckOut").textContent = formatTime(attendance.overtimeCheckOutAt);

  $("actualDuration").textContent =
    formatDuration(attendance.actualMinutes);

  const checkInLocation = attendance.overtimeCheckInLocation;
  const checkOutLocation = attendance.overtimeCheckOutLocation;

  $("checkInLocation").textContent =
    `Lokasi: ${formatLocation(checkInLocation)}`;

  $("checkOutLocation").textContent =
    `Lokasi: ${formatLocation(checkOutLocation)}`;

  $("approvedHours").value = selectedRecord.approved
    ? (Number(overtime.approvedDurationMinutes ?? Math.round(Number(overtime.hours) * 60)) / 60).toFixed(2)
    : (attendance.actualMinutes / 60).toFixed(2);

  $("hourlyRate").value = selectedRecord.approved
    ? overtime.hourlyRate ?? ""
    : "";

  $("formTitle").textContent = selectedRecord.approved
    ? "Edit Persetujuan Lembur"
    : "Periksa Absensi Lembur";

  approveButton.textContent = selectedRecord.approved
    ? "Simpan Perubahan"
    : "Setujui Lembur";

  $("reviewPanel").classList.remove("hidden");
  calculateTotal();
  hideMessage();

  $("reviewPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function formatLocation(location) {
  if (!location || typeof location !== "object") return "Tidak tersedia";

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "Tidak tersedia";
  }

  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function closeReview() {
  if (busy) return;

  selectedRecord = null;
  form.reset();
  $("reviewPanel").classList.add("hidden");
  $("calculatedTotal").textContent = rupiah(0);
}

async function handleSubmit(event) {
  event.preventDefault();
  hideMessage();

  if (busy || !currentAdmin || !selectedRecord) return;

  const { attendance, overtime, approved } = selectedRecord;

  const hours = Number($("approvedHours").value);
  const hourlyRate = Number($("hourlyRate").value);
  const total = calculateTotal();

  if (
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 24 ||
    !Number.isFinite(hourlyRate) ||
    hourlyRate <= 0 ||
    !Number.isSafeInteger(hourlyRate) ||
    !Number.isSafeInteger(total) ||
    total <= 0
  ) {
    showMessage(
      "Periksa durasi resmi dan tarif. Gunakan tarif rupiah bulat yang lebih besar dari nol.",
      "error"
    );
    return;
  }

  const approvedDurationMinutes = Math.round(hours * 60);
  const normalizedHours = approvedDurationMinutes / 60;

  setBusy(true);

  try {
    const overtimeRef = doc(db, "overtime", attendance.id);

    await runTransaction(db, async (transaction) => {
      const attendanceSnapshot = await transaction.get(
        doc(db, "attendance", attendance.id)
      );

      if (!attendanceSnapshot.exists()) {
        throw new Error("ABSENCE_NOT_FOUND");
      }

      const freshAttendance = attendanceSnapshot.data();

      if (
        freshAttendance.overtimeStatus !== "completed" ||
        !freshAttendance.overtimeCheckInAt ||
        !freshAttendance.overtimeCheckOutAt
      ) {
        throw new Error("ABSENCE_NOT_COMPLETED");
      }

      const freshMinutes = actualDurationMinutes(freshAttendance);

      if (freshMinutes === null) {
        throw new Error("INVALID_ACTUAL_DURATION");
      }

      const existingSnapshot = await transaction.get(overtimeRef);

      if (existingSnapshot.exists()) {
        const existing = existingSnapshot.data();

        if (existing.attendanceId !== attendance.id) {
          throw new Error("LEGACY_RECORD_CONFLICT");
        }
      }

      const recordData = {
        attendanceId: attendance.id,
        userId: freshAttendance.userId,
        employeeName: getEmployeeName(freshAttendance.userId),
        dateKey: freshAttendance.dateKey,
        actualDurationMinutes: freshMinutes,
        approvedDurationMinutes,
        hours: normalizedHours,
        hourlyRate,
        total,
        status: "approved",
        updatedAt: serverTimestamp(),
        updatedBy: currentAdmin.uid,
        approvedAt: serverTimestamp(),
        approvedBy: currentAdmin.uid
      };

      if (!existingSnapshot.exists()) {
        transaction.set(overtimeRef, {
          ...recordData,
          createdAt: serverTimestamp(),
          createdBy: currentAdmin.uid
        });
      } else {
        transaction.update(overtimeRef, recordData);
      }
    });

    showMessage(
      approved
        ? "Persetujuan lembur berhasil diperbarui."
        : "Lembur berhasil disetujui."
    );

    selectedRecord = null;
    form.reset();
    $("reviewPanel").classList.add("hidden");

    await loadData();
  } catch (error) {
    console.error("Gagal menyimpan persetujuan lembur:", error);

    const messages = {
      "ABSENCE_NOT_FOUND": "Data absensi tidak ditemukan.",
      "ABSENCE_NOT_COMPLETED": "Absensi lembur belum lengkap. Muat ulang data.",
      "INVALID_ACTUAL_DURATION": "Durasi aktual tidak valid. Periksa timestamp absensi.",
      "LEGACY_RECORD_CONFLICT":
        "ID absensi ini sudah bertabrakan dengan catatan lembur lama. Periksa data lama terlebih dahulu."
    };

    showMessage(
      messages[error.message] ||
        (error.code === "permission-denied"
          ? "Akses ditolak. Firestore Security Rules perlu disesuaikan dengan skema persetujuan lembur."
          : "Persetujuan gagal disimpan. Periksa koneksi dan log konsol."),
      "error"
    );
  } finally {
    setBusy(false);
  }
}

async function initializePage(user) {
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));

  if (
    !profileSnapshot.exists() ||
    profileSnapshot.data().role !== "admin" ||
    profileSnapshot.data().isActive !== true
  ) {
    await signOut(auth);
    window.location.replace("./index.html");
    return;
  }

  currentAdmin = user;
  await loadData();
}

form.addEventListener("submit", handleSubmit);

$("approvedHours").addEventListener("input", calculateTotal);
$("hourlyRate").addEventListener("input", calculateTotal);

$("cancelReviewButton").addEventListener("click", closeReview);

$("searchInput").addEventListener("input", renderTable);
$("filterDate").addEventListener("change", renderTable);

$("resetFilterButton").addEventListener("click", () => {
  $("searchInput").value = "";
  $("filterDate").value = "";
  renderTable();
});

$("refreshButton").addEventListener("click", async () => {
  if (busy) return;

  hideMessage();
  setBusy(true);

  try {
    await loadData();
    showMessage("Data absensi lembur berhasil dimuat ulang.");
  } catch (error) {
    console.error("Gagal memuat data lembur:", error);
    showMessage("Gagal memuat data. Periksa Firestore Security Rules.", "error");
  } finally {
    setBusy(false);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("./index.html");
    return;
  }

  try {
    await initializePage(user);
  } catch (error) {
    console.error("Gagal membuka halaman persetujuan lembur:", error);
    showMessage(
      "Halaman gagal dimuat. Periksa profil Admin dan Firestore Security Rules.",
      "error"
    );
  }
});
