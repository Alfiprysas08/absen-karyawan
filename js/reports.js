
import { auth, db } from "./firebase.js";

import { onAuthStateChanged, signOut } from "firebase/auth";

import {
  collection,
  doc,
  getDoc,
  getDocs
} from "firebase/firestore";

const $ = (id) => document.getElementById(id);

const reportForm = $("reportForm");
const reportType = $("reportType");
const startDateInput = $("startDate");
const endDateInput = $("endDate");
const employeeFilter = $("employeeFilter");
const previewButton = $("previewButton");
const resetButton = $("resetButton");
const exportPdfButton = $("exportPdfButton");
const pageMessage = $("pageMessage");
const periodLabel = $("periodLabel");
const totalEmployees = $("totalEmployees");
const totalAttendance = $("totalAttendance");
const totalOvertimeHours = $("totalOvertimeHours");
const totalPayroll = $("totalPayroll");
const reportTableHead = $("reportTableHead");
const reportTableBody = $("reportTableBody");
const recordCount = $("recordCount");

const TIME_ZONE = "Asia/Jakarta";

let currentAdmin = null;
let employees = [];
let attendanceRecords = [];
let overtimeRecords = [];
let payrollRecords = [];
let currentReport = null;
let busy = false;

const rupiah = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

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

  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: TIME_ZONE
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatPeriod(start, end) {
  return start === end
    ? formatDate(start)
    : `${formatDate(start)} – ${formatDate(end)}`;
}

function showMessage(message, type = "info") {
  pageMessage.textContent = message;

  const styles = {
    info: "border-slate-700 bg-slate-900 text-slate-300",
    success: "border-emerald-800 bg-emerald-950/50 text-emerald-300",
    error: "border-red-800 bg-red-950/50 text-red-300"
  };

  pageMessage.className =
    `rounded-xl border p-4 text-sm ${styles[type] || styles.info}`;

  pageMessage.classList.remove("hidden");
}

function setBusy(value) {
  busy = value;
  previewButton.disabled = value;
  resetButton.disabled = value;
  exportPdfButton.disabled = value || !currentReport;

  previewButton.textContent = value
    ? "Memproses..."
    : "Tampilkan Laporan";
}

function showEmptyTable(message, colspan = 3) {
  reportTableBody.replaceChildren();

  const row = document.createElement("tr");
  const cell = document.createElement("td");

  cell.colSpan = colspan;
  cell.className = "px-5 py-10 text-center text-slate-500";
  cell.textContent = message;

  row.appendChild(cell);
  reportTableBody.appendChild(row);
}

function addCell(row, value, className = "px-5 py-4") {
  const cell = document.createElement("td");

  cell.className = className;
  cell.textContent = value ?? "-";

  row.appendChild(cell);
  return cell;
}

function resetSummary() {
  totalEmployees.textContent = "-";
  totalAttendance.textContent = "-";
  totalOvertimeHours.textContent = "-";
  totalPayroll.textContent = "-";
  recordCount.textContent = "0 catatan";
}

function renderEmployeeOptions() {
  employeeFilter.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "Semua karyawan";
  employeeFilter.appendChild(allOption);

  employees
    .filter((employee) => employee.isActive === true)
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "id")
    )
    .forEach((employee) => {
      const option = document.createElement("option");

      option.value = employee.id;
      option.textContent =
        employee.name || employee.email || employee.id;

      employeeFilter.appendChild(option);
    });
}

function validDateRange(start, end) {
  if (
    !start ||
    !end ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    start > end
  ) {
    return false;
  }

  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);

  return (
    !Number.isNaN(startDate.getTime()) &&
    !Number.isNaN(endDate.getTime()) &&
    startDate.toISOString().slice(0, 10) === start &&
    endDate.toISOString().slice(0, 10) === end
  );
}

function inRange(dateKey, start, end) {
  return (
    typeof dateKey === "string" &&
    dateKey >= start &&
    dateKey <= end
  );
}

function employeeName(userId) {
  const employee = employees.find((item) => item.id === userId);

  return (
    employee?.name ||
    employee?.displayName ||
    employee?.email ||
    "Karyawan tidak ditemukan"
  );
}

function selectedEmployeeName() {
  if (employeeFilter.value === "all") {
    return "Semua karyawan";
  }

  return employeeName(employeeFilter.value);
}

async function loadSourceData() {
  const [
    usersSnapshot,
    attendanceSnapshot,
    overtimeSnapshot,
    payrollSnapshot
  ] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "attendance")),
    getDocs(collection(db, "overtime")),
    getDocs(collection(db, "payroll"))
  ]);

  employees = usersSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  attendanceRecords = attendanceSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  overtimeRecords = overtimeSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  payrollRecords = payrollSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  renderEmployeeOptions();
}

function filterEmployee(records) {
  if (employeeFilter.value === "all") {
    return records;
  }

  return records.filter(
    (item) => item.userId === employeeFilter.value
  );
}

function buildReport(start, end, type) {
  const attendance = filterEmployee(
    attendanceRecords.filter((item) =>
      inRange(item.dateKey, start, end)
    )
  );

  const overtime = filterEmployee(
    overtimeRecords.filter((item) =>
      inRange(item.dateKey, start, end)
    )
  );

  // Payroll menggunakan snapshot tersimpan.
  // Payroll hanya masuk jika seluruh periode payroll berada
  // di dalam rentang laporan yang dipilih.
  const payroll = filterEmployee(
    payrollRecords.filter((item) =>
      item.periodStart &&
      item.periodEnd &&
      item.periodStart >= start &&
      item.periodEnd <= end
    )
  );

  const presentAttendance = attendance.filter(
    (item) => item.status === "present"
  );

  const employeeIds = new Set([
    ...attendance.map((item) => item.userId),
    ...overtime.map((item) => item.userId),
    ...payroll.map((item) => item.userId)
  ]);

  const totalHours = overtime.reduce(
    (sum, item) => sum + (Number(item.hours) || 0),
    0
  );

  const totalSalary = payroll.reduce(
    (sum, item) => sum + (Number(item.totalSalary) || 0),
    0
  );

  return {
    start,
    end,
    type,
    employeeId: employeeFilter.value,
    employeeLabel: selectedEmployeeName(),
    employees: [...employeeIds].map((id) => ({
      id,
      name: employeeName(id)
    })),
    attendance,
    presentAttendance,
    overtime,
    payroll,
    totalHours,
    totalSalary
  };
}

function renderReport(report) {
  currentReport = report;

  periodLabel.textContent =
    `${formatPeriod(report.start, report.end)} · ${report.employeeLabel}`;

  totalEmployees.textContent = report.employees.length;
  totalAttendance.textContent = report.presentAttendance.length;
  totalOvertimeHours.textContent =
    `${Number(report.totalHours.toFixed(2))} jam`;

  totalPayroll.textContent = rupiah(report.totalSalary);

  exportPdfButton.disabled = false;

  reportTableHead.replaceChildren();
  reportTableBody.replaceChildren();

  const headerRow = document.createElement("tr");

  let headers = [];

  if (report.type === "attendance") {
    headers = ["Tanggal", "Karyawan", "Status", "Waktu"];
  } else if (report.type === "overtime") {
    headers = ["Tanggal", "Karyawan", "Jam", "Tarif/Jam", "Total"];
  } else if (report.type === "payroll") {
    headers = [
      "Periode",
      "Karyawan",
      "Hari Hadir",
      "Gaji Pokok",
      "Upah Lembur",
      "Total Gaji",
      "Status"
    ];
  } else {
    headers = ["Jenis Data", "Karyawan", "Tanggal/Periode", "Keterangan"];
  }

  headers.forEach((label) => {
    const cell = document.createElement("th");

    cell.className =
      "px-5 py-4 text-xs font-semibold uppercase tracking-wider";
    cell.textContent = label;

    headerRow.appendChild(cell);
  });

  reportTableHead.appendChild(headerRow);

  const rows = [];

  if (report.type === "attendance") {
    report.attendance.forEach((item) => {
      rows.push([
        formatDate(item.dateKey),
        employeeName(item.userId),
        item.status === "present" ? "Hadir" :
          item.status === "absent" ? "Tidak hadir" : item.status || "-",
        item.timestamp?.toDate
          ? new Intl.DateTimeFormat("id-ID", {
              timeZone: TIME_ZONE,
              hour: "2-digit",
              minute: "2-digit",
              hour12: false
            }).format(item.timestamp.toDate()) + " WIB"
          : "-"
      ]);
    });
  } else if (report.type === "overtime") {
    report.overtime.forEach((item) => {
      rows.push([
        formatDate(item.dateKey),
        employeeName(item.userId),
        `${Number(item.hours) || 0} jam`,
        rupiah(item.hourlyRate),
        rupiah(item.total)
      ]);
    });
  } else if (report.type === "payroll") {
    report.payroll.forEach((item) => {
      rows.push([
        formatPeriod(item.periodStart, item.periodEnd),
        item.employeeName || employeeName(item.userId),
        String(item.attendanceDays ?? 0),
        rupiah(item.baseSalary),
        rupiah(item.overtimePay),
        rupiah(item.totalSalary),
        item.status === "paid" ? "Dibayar" : "Belum dibayar"
      ]);
    });
  } else {
    report.attendance.forEach((item) => {
      rows.push([
        "Absensi",
        employeeName(item.userId),
        formatDate(item.dateKey),
        item.status === "present" ? "Hadir" :
          item.status === "absent" ? "Tidak hadir" : item.status || "-"
      ]);
    });

    report.overtime.forEach((item) => {
      rows.push([
        "Lembur",
        employeeName(item.userId),
        formatDate(item.dateKey),
        `${Number(item.hours) || 0} jam · ${rupiah(item.total)}`
      ]);
    });

    report.payroll.forEach((item) => {
      rows.push([
        "Penggajian",
        item.employeeName || employeeName(item.userId),
        formatPeriod(item.periodStart, item.periodEnd),
        `${rupiah(item.totalSalary)} · ${
          item.status === "paid" ? "Dibayar" : "Belum dibayar"
        }`
      ]);
    });
  }

  if (!rows.length) {
    showEmptyTable("Tidak ada data pada filter yang dipilih.", headers.length);
  } else {
    rows.forEach((values) => {
      const row = document.createElement("tr");

      row.className = "hover:bg-slate-800/50";

      values.forEach((value) => addCell(row, value));
      reportTableBody.appendChild(row);
    });
  }

  recordCount.textContent = `${rows.length} baris data`;

  if (report.type === "payroll" && report.payroll.length === 0) {
    showMessage(
      "Tidak ada snapshot payroll tersimpan yang seluruh periodenya berada dalam rentang tanggal pilihan.",
      "info"
    );
  } else {
    showMessage("Laporan berhasil dibuat.", "success");
  }
}

async function createReport(event) {
  event.preventDefault();

  if (busy || !currentAdmin) return;

  const start = startDateInput.value;
  const end = endDateInput.value;

  if (!validDateRange(start, end)) {
    showMessage(
      "Tanggal tidak valid. Pastikan tanggal awal tidak melewati tanggal akhir.",
      "error"
    );
    return;
  }

  setBusy(true);
  exportPdfButton.disabled = true;

  try {
    await loadSourceData();

    const report = buildReport(start, end, reportType.value);
    renderReport(report);
  } catch (error) {
    console.error("Gagal membuat laporan:", error);

    currentReport = null;
    exportPdfButton.disabled = true;

    showMessage(
      error.code === "permission-denied"
        ? "Akses ditolak oleh Firestore Security Rules."
        : `Laporan gagal dimuat: ${error.message}`,
      "error"
    );
  } finally {
    setBusy(false);
  }
}

function exportPDF() {
  if (!currentReport || busy) return;

  if (!window.jspdf?.jsPDF) {
    showMessage(
      "Pustaka PDF belum dimuat. Periksa koneksi internet dan skrip jsPDF.",
      "error"
    );
    return;
  }

  const { jsPDF } = window.jspdf;
  const report = currentReport;
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4"
  });

  const titleMap = {
    all: "Laporan Lengkap",
    attendance: "Rekap Absensi",
    overtime: "Rekap Lembur",
    payroll: "Rekap Penggajian"
  };

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("LAPORAN ABSENSI KARYAWAN", 14, 17);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(titleMap[report.type] || "Laporan", 14, 25);
  pdf.text(
    `Periode: ${report.start} sampai ${report.end}`,
    14,
    32
  );
  pdf.text(`Karyawan: ${report.employeeLabel}`, 14, 39);
  pdf.text(
    `Dibuat: ${new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: TIME_ZONE
    }).format(new Date())} WIB`,
    14,
    46
  );

  const rows = [];

  if (report.type === "attendance") {
    report.attendance.forEach((item) => {
      rows.push([
        item.dateKey || "-",
        employeeName(item.userId),
        item.status || "-",
        item.timestamp?.toDate
          ? new Intl.DateTimeFormat("id-ID", {
              timeZone: TIME_ZONE,
              hour: "2-digit",
              minute: "2-digit",
              hour12: false
            }).format(item.timestamp.toDate()) + " WIB"
          : "-"
      ]);
    });
  } else if (report.type === "overtime") {
    report.overtime.forEach((item) => {
      rows.push([
        item.dateKey || "-",
        employeeName(item.userId),
        `${Number(item.hours) || 0} jam`,
        rupiah(item.hourlyRate),
        rupiah(item.total)
      ]);
    });
  } else if (report.type === "payroll") {
    report.payroll.forEach((item) => {
      rows.push([
        `${item.periodStart} - ${item.periodEnd}`,
        item.employeeName || employeeName(item.userId),
        String(item.attendanceDays ?? 0),
        rupiah(item.baseSalary),
        rupiah(item.overtimePay),
        rupiah(item.totalSalary),
        item.status === "paid" ? "Dibayar" : "Belum dibayar"
      ]);
    });
  } else {
    report.attendance.forEach((item) => {
      rows.push([
        "Absensi",
        employeeName(item.userId),
        item.dateKey || "-",
        item.status || "-"
      ]);
    });

    report.overtime.forEach((item) => {
      rows.push([
        "Lembur",
        employeeName(item.userId),
        item.dateKey || "-",
        `${Number(item.hours) || 0} jam · ${rupiah(item.total)}`
      ]);
    });

    report.payroll.forEach((item) => {
      rows.push([
        "Penggajian",
        item.employeeName || employeeName(item.userId),
        `${item.periodStart} - ${item.periodEnd}`,
        `${rupiah(item.totalSalary)} (${item.status || "unpaid"})`
      ]);
    });
  }

  // jsPDF AutoTable digunakan jika tersedia.
  if (typeof pdf.autoTable === "function") {
    let headers;

    if (report.type === "attendance") {
      headers = [["Tanggal", "Karyawan", "Status", "Waktu"]];
    } else if (report.type === "overtime") {
      headers = [["Tanggal", "Karyawan", "Jam", "Tarif/Jam", "Total"]];
    } else if (report.type === "payroll") {
      headers = [[
        "Periode",
        "Karyawan",
        "Hari Hadir",
        "Gaji Pokok",
        "Lembur",
        "Total Gaji",
        "Status"
      ]];
    } else {
      headers = [["Jenis Data", "Karyawan", "Tanggal/Periode", "Keterangan"]];
    }

    pdf.autoTable({
      head: headers,
      body: rows,
      startY: 53,
      theme: "grid",
      styles: {
        fontSize: 8,
        cellPadding: 2
      },
      headStyles: {
        fillColor: [30, 41, 59]
      }
    });
  } else {
    // Fallback jika plugin AutoTable belum dimuat.
    let y = 56;

    pdf.setFontSize(9);

    rows.forEach((row) => {
      const line = row.map((value) => String(value)).join(" | ");
      const wrapped = pdf.splitTextToSize(line, 265);

      if (y + wrapped.length * 5 > 190) {
        pdf.addPage();
        y = 15;
      }

      pdf.text(wrapped, 14, y);
      y += wrapped.length * 5 + 2;
    });
  }

  pdf.save(
    `laporan-${report.type}-${report.start}-${report.end}.pdf`
  );

  showMessage("PDF berhasil dibuat dan diunduh.", "success");
}

function resetFilters() {
  if (busy) return;

  const today = getTodayKey();

  startDateInput.value = `${today.slice(0, 4)}-${today.slice(5, 7)}-01`;
  endDateInput.value = today;
  reportType.value = "all";
  employeeFilter.value = "all";

  currentReport = null;
  exportPdfButton.disabled = true;

  periodLabel.textContent = "Pilih periode untuk menampilkan laporan.";
  resetSummary();

  reportTableHead.replaceChildren();
  const row = document.createElement("tr");

  ["Informasi", "Periode", "Keterangan"].forEach((label) => {
    const cell = document.createElement("th");
    cell.className =
      "px-5 py-4 text-xs font-semibold uppercase tracking-wider";
    cell.textContent = label;
    row.appendChild(cell);
  });

  reportTableHead.appendChild(row);
  showEmptyTable(
    "Belum ada laporan. Pilih filter lalu klik Tampilkan Laporan."
  );

  showMessage("Filter berhasil direset.", "info");
}

reportForm.addEventListener("submit", createReport);
resetButton.addEventListener("click", resetFilters);
exportPdfButton.addEventListener("click", exportPDF);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("./index.html");
    return;
  }

  try {
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

    const today = getTodayKey();
    startDateInput.value = `${today.slice(0, 4)}-${today.slice(5, 7)}-01`;
    endDateInput.value = today;

    await loadSourceData();
  } catch (error) {
    console.error("Gagal membuka laporan:", error);

    showMessage(
      error.code === "permission-denied"
        ? "Akses ditolak. Periksa Firestore Security Rules."
        : "Halaman laporan gagal dimuat.",
      "error"
    );
  }
});


