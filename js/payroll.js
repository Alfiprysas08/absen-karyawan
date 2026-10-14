
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";

const $ = (id) => document.getElementById(id);

const periodForm = $("periodForm");
const startDateInput = $("startDate");
const endDateInput = $("endDate");
const calculateButton = $("calculateButton");
const saveButton = $("saveButton");
const tableBody = $("payrollTableBody");
const pageMessage = $("pageMessage");
const periodLabel = $("periodLabel");
const historySelect = $("historySelect");
const loadHistoryButton = $("loadHistoryButton");

let currentAdmin = null;
let currentRows = [];
let currentPeriod = null;
let allPayrollRecords = [];
let busy = false;

const rupiah = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

const escapeHTML = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

function showMessage(message, type = "info") {
  pageMessage.textContent = message;
  pageMessage.className = "text-sm mt-3";

  if (type === "error") pageMessage.classList.add("text-red-600");
  else if (type === "success") pageMessage.classList.add("text-emerald-700");
  else pageMessage.classList.add("text-slate-600");
}

function setBusy(value) {
  busy = value;
  calculateButton.disabled = value;
  saveButton.disabled = value || currentRows.length === 0 ||
    currentRows.every((row) => row.saved);
  loadHistoryButton.disabled = value;
}

function formatPeriod(start, end) {
  const format = (date) =>
    new Date(`${date}T12:00:00`).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });

  return `${format(start)} – ${format(end)}`;
}

function validPeriod(start, end) {
  return Boolean(start && end && start <= end);
}

function periodKey(start, end) {
  return `${start}__${end}`;
}

function payrollId(uid, start, end) {
  return `${uid}_${periodKey(start, end)}`;
}

function isDateInRange(dateKey, start, end) {
  return typeof dateKey === "string" && dateKey >= start && dateKey <= end;
}

function isActiveEmployee(employee) {
  return employee.role === "user" && employee.isActive === true;
}

function renderSummary() {
  $("employeeCount").textContent = currentRows.length;
  $("totalAttendanceDays").textContent = currentRows.reduce(
    (sum, row) => sum + row.attendanceDays, 0
  );
  $("grandTotal").textContent = rupiah(
    currentRows.reduce((sum, row) => sum + row.totalSalary, 0)
  );
}

function renderTable() {
  renderSummary();

  if (!currentRows.length) {
    tableBody.innerHTML = `
      <tr><td colspan="9" class="px-4 py-8 text-center text-slate-500">
        Tidak ada karyawan untuk ditampilkan.
      </td></tr>`;
    saveButton.disabled = true;
    return;
  }

  tableBody.innerHTML = currentRows.map((row) => {
    const statusClass = row.status === "paid"
      ? "bg-emerald-100 text-emerald-700"
      : "bg-amber-100 text-amber-700";

    const action = row.status === "paid"
      ? `<span class="text-slate-500">Sudah dibayar</span>`
      : row.saved
        ? `<button data-pay="${escapeHTML(row.id)}"
              class="rounded-lg bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700">
              Tandai Dibayar
            </button>`
        : `<span class="text-slate-400">Simpan dahulu</span>`;

    return `
      <tr class="border-t border-slate-200">
        <td class="px-4 py-3 font-medium">${escapeHTML(row.employeeName)}</td>
        <td class="px-4 py-3">${escapeHTML(row.position || "-")}</td>
        <td class="px-4 py-3">${row.attendanceDays}</td>
        <td class="px-4 py-3 whitespace-nowrap">${rupiah(row.dailySalary)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${rupiah(row.baseSalary)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${rupiah(row.overtimePay)}</td>
        <td class="px-4 py-3 font-semibold whitespace-nowrap">${rupiah(row.totalSalary)}</td>
        <td class="px-4 py-3">
          <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}">
            ${row.status === "paid" ? "Dibayar" : "Belum dibayar"}
          </span>
        </td>
        <td class="px-4 py-3 whitespace-nowrap">${action}</td>
      </tr>`;
  }).join("");

  saveButton.disabled = busy || currentRows.every((row) => row.saved);
}

async function loadSourceData(start, end) {
  const [usersSnapshot, attendanceSnapshot, overtimeSnapshot, payrollSnapshot] =
    await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "attendance")),
      getDocs(collection(db, "overtime")),
      getDocs(collection(db, "payroll"))
    ]);

  const employees = usersSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter(isActiveEmployee);

  const attendance = attendanceSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) =>
      item.status === "present" &&
      isDateInRange(item.dateKey, start, end)
    );

  const overtime = overtimeSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => isDateInRange(item.dateKey, start, end));

  allPayrollRecords = payrollSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  return { employees, attendance, overtime };
}

function buildRows(start, end, source) {
  const { employees, attendance, overtime } = source;

  return employees.map((employee) => {
    const attendanceDays = new Set(
      attendance
        .filter((item) => item.userId === employee.id)
        .map((item) => item.dateKey)
    ).size;

    const dailySalary = Math.max(0, Math.trunc(Number(employee.dailySalary) || 0));
    const baseSalary = attendanceDays * dailySalary;

    const overtimePay = overtime
      .filter((item) => item.userId === employee.id)
      .reduce((sum, item) => sum + (Number(item.total) || 0), 0);

    const totalSalary = baseSalary + overtimePay;
    const id = payrollId(employee.id, start, end);
    const existing = allPayrollRecords.find((item) => item.id === id);

    // Jika periode sudah pernah disimpan, gunakan snapshot yang tersimpan.
    // Jangan hitung ulang otomatis dan jangan menimpa data lama.
    if (existing) {
      return {
        ...existing,
        id,
        saved: true,
        attendanceDays: Number(existing.attendanceDays) || 0,
        dailySalary: Number(existing.dailySalary) || 0,
        baseSalary: Number(existing.baseSalary) || 0,
        overtimePay: Number(existing.overtimePay) || 0,
        totalSalary: Number(existing.totalSalary) || 0,
        status: existing.status || "unpaid"
      };
    }

    return {
      id,
      userId: employee.id,
      employeeName: employee.name || employee.displayName || employee.email || "Tanpa nama",
      position: employee.position || "-",
      periodStart: start,
      periodEnd: end,
      periodKey: periodKey(start, end),
      attendanceDays,
      dailySalary,
      baseSalary,
      overtimePay,
      totalSalary,
      status: "unpaid",
      saved: false
    };
  });
}

async function calculatePeriod(start = startDateInput.value, end = endDateInput.value) {
  if (!validPeriod(start, end)) {
    showMessage("Tanggal awal dan akhir wajib diisi. Tanggal awal tidak boleh melewati tanggal akhir.", "error");
    return;
  }

  setBusy(true);
  showMessage("Sedang menghitung penggajian...");

  try {
    const source = await loadSourceData(start, end);
    currentPeriod = { start, end };
    currentRows = buildRows(start, end, source);

    startDateInput.value = start;
    endDateInput.value = end;
    periodLabel.textContent = `Periode: ${formatPeriod(start, end)}`;

    renderTable();
    renderHistoryOptions();

    showMessage(
      "Perhitungan selesai. Periksa rincian sebelum menyimpan.",
      "success"
    );
  } catch (error) {
    console.error(error);
    showMessage(`Gagal menghitung gaji: ${error.message}`, "error");
  } finally {
    setBusy(false);
    renderTable();
  }
}

async function savePayroll() {
  if (!currentAdmin || !currentPeriod || busy) return;

  const unsavedRows = currentRows.filter((row) => !row.saved);
  if (!unsavedRows.length) {
    showMessage("Periode ini sudah tersimpan. Tidak ada data baru untuk disimpan.", "info");
    return;
  }

  if (!confirm(
    `Simpan ${unsavedRows.length} catatan gaji untuk periode ${formatPeriod(
      currentPeriod.start, currentPeriod.end
    )}? Catatan yang sudah tersimpan tidak akan ditimpa.`
  )) return;

  setBusy(true);
  let savedCount = 0;
  let skippedCount = 0;

  try {
    for (const row of unsavedRows) {
      const ref = doc(db, "payroll", row.id);

      // Cek ulang sebelum membuat dokumen untuk menghindari overwrite.
      const existing = await getDoc(ref);
      if (existing.exists()) {
        skippedCount++;
        continue;
      }

      const data = {
        userId: row.userId,
        employeeName: row.employeeName,
        position: row.position,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        periodKey: row.periodKey,
        attendanceDays: row.attendanceDays,
        dailySalary: row.dailySalary,
        baseSalary: row.baseSalary,
        overtimePay: row.overtimePay,
        totalSalary: row.totalSalary,
        status: "unpaid",
        createdAt: serverTimestamp(),
        createdBy: currentAdmin.uid,
        updatedAt: serverTimestamp(),
        updatedBy: currentAdmin.uid
      };

      // Tanpa merge: hanya membuat dokumen baru.
      await setDoc(ref, data);
      savedCount++;
    }

    await calculatePeriod(currentPeriod.start, currentPeriod.end);

    showMessage(
      `Selesai. ${savedCount} catatan baru disimpan${skippedCount ? `, ${skippedCount} dilewati karena sudah ada` : ""}.`,
      "success"
    );
  } catch (error) {
    console.error(error);
    showMessage(`Gagal menyimpan gaji: ${error.message}`, "error");
  } finally {
    setBusy(false);
    renderTable();
  }
}

async function markAsPaid(id) {
  if (!currentAdmin || busy) return;

  const row = currentRows.find((item) => item.id === id);
  if (!row || !row.saved || row.status === "paid") return;

  const paymentDate = prompt(
    "Masukkan tanggal pembayaran (YYYY-MM-DD):",
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
  );

  if (paymentDate === null) return;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    showMessage("Format tanggal pembayaran harus YYYY-MM-DD.", "error");
    return;
  }

  if (!confirm(
    `Tandai gaji ${row.employeeName} sebesar ${rupiah(row.totalSalary)} sebagai sudah dibayar?`
  )) return;

  setBusy(true);

  try {
    await updateDoc(doc(db, "payroll", id), {
      status: "paid",
      paymentDate,
      paidAt: serverTimestamp(),
      paidBy: currentAdmin.uid,
      updatedAt: serverTimestamp(),
      updatedBy: currentAdmin.uid
    });

    await calculatePeriod(currentPeriod.start, currentPeriod.end);
    showMessage("Status pembayaran berhasil diperbarui.", "success");
  } catch (error) {
    console.error(error);
    showMessage(`Gagal memperbarui pembayaran: ${error.message}`, "error");
  } finally {
    setBusy(false);
    renderTable();
  }
}

function renderHistoryOptions() {
  const periods = new Map();

  for (const item of allPayrollRecords) {
    if (!item.periodStart || !item.periodEnd) continue;
    const key = periodKey(item.periodStart, item.periodEnd);
    periods.set(key, {
      key,
      start: item.periodStart,
      end: item.periodEnd
    });
  }

  const options = [...periods.values()].sort((a, b) =>
    b.start.localeCompare(a.start)
  );

  historySelect.innerHTML = options.length
    ? `<option value="">Pilih periode tersimpan</option>` +
      options.map((item) =>
        `<option value="${escapeHTML(item.key)}">${escapeHTML(formatPeriod(item.start, item.end))}</option>`
      ).join("")
    : `<option value="">Belum ada riwayat tersimpan</option>`;
}

async function loadHistory() {
  const selected = historySelect.value;
  if (!selected) {
    showMessage("Pilih periode riwayat terlebih dahulu.", "error");
    return;
  }

  const [start, end] = selected.split("__");
  await calculatePeriod(start, end);
}

periodForm.addEventListener("submit", (event) => {
  event.preventDefault();
  calculatePeriod();
});

saveButton.addEventListener("click", savePayroll);
loadHistoryButton.addEventListener("click", loadHistory);

tableBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-pay]");
  if (button) markAsPaid(button.dataset.pay);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./index.html";
    return;
  }

  try {
    const profile = await getDoc(doc(db, "users", user.uid));

    if (
      !profile.exists() ||
      profile.data().role !== "admin" ||
      profile.data().isActive !== true
    ) {
      await signOut(auth);
      window.location.href = "./index.html";
      return;
    }

    currentAdmin = user;

    // Default periode awal: tujuh hari terakhir sampai hari ini.
    const today = new Date();
    const end = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
    const startDate = new Date(`${end}T12:00:00`);
    startDate.setDate(startDate.getDate() - 6);
    const start = [
      startDate.getFullYear(),
      String(startDate.getMonth() + 1).padStart(2, "0"),
      String(startDate.getDate()).padStart(2, "0")
    ].join("-");

    startDateInput.value = start;
    endDateInput.value = end;

    await calculatePeriod(start, end);
  } catch (error) {
    console.error(error);
    showMessage(`Gagal memeriksa akun Admin: ${error.message}`, "error");
  }
});
