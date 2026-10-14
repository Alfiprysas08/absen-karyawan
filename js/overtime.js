
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
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "firebase/firestore";

const $ = (id) => document.getElementById(id);

const form = $("overtimeForm");
const employeeSelect = $("employeeId");
const dateInput = $("dateKey");
const hoursInput = $("hours");
const rateInput = $("hourlyRate");
const totalPreview = $("calculatedTotal");
const tableBody = $("overtimeTableBody");
const messageBox = $("pageMessage");
const saveButton = $("saveButton");
const cancelEditButton = $("cancelEditButton");

let currentAdmin = null;
let employees = [];
let overtimeRecords = [];
let editingId = null;
let busy = false;

const rupiah = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

function getTodayWIB() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

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
  }).format(
    new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12))
  );
}

function calculateTotal() {
  const hours = Number(hoursInput.value);
  const rate = Number(rateInput.value);

  const total =
    Number.isFinite(hours) &&
    Number.isFinite(rate) &&
    hours > 0 &&
    rate > 0
      ? hours * rate
      : 0;

  totalPreview.textContent = rupiah(total);

  return total;
}

function setBusy(value) {
  busy = value;

  saveButton.disabled = value;
  cancelEditButton.disabled = value;

  saveButton.textContent = value
    ? "Memproses..."
    : editingId
      ? "Simpan Perubahan"
      : "Simpan Lembur";
}

function renderEmployeeOptions(selectedId = "") {
  employeeSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = employees.length
    ? "Pilih karyawan"
    : "Belum ada karyawan aktif";

  employeeSelect.appendChild(placeholder);

  for (const employee of employees) {
    const option = document.createElement("option");

    option.value = employee.id;
    option.textContent =
      employee.name || employee.email || employee.id;

    employeeSelect.appendChild(option);
  }

  employeeSelect.value = selectedId;
}

async function loadEmployees() {
  const snapshot = await getDocs(collection(db, "users"));

  employees = snapshot.docs
    .map((item) => ({
      id: item.id,
      ...item.data()
    }))
    .filter(
      (employee) =>
        employee.role === "user" &&
        employee.isActive === true
    )
    .sort((a, b) =>
      String(a.name || "").localeCompare(
        String(b.name || ""),
        "id"
      )
    );

  renderEmployeeOptions(
    editingId
      ? form.dataset.employeeId || ""
      : ""
  );
}

async function loadOvertime() {
  tableBody.innerHTML = `
    <tr>
      <td colspan="6" class="px-3 py-8 text-center text-slate-400">
        Memuat data...
      </td>
    </tr>
  `;

  const snapshot = await getDocs(collection(db, "overtime"));

  overtimeRecords = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  overtimeRecords.sort((a, b) =>
    String(b.dateKey || "").localeCompare(
      String(a.dateKey || "")
    )
  );

  renderTable();
}

function renderTable() {
  const keyword = $("searchInput").value.trim().toLowerCase();
  const selectedDate = $("filterDate").value;

  const filtered = overtimeRecords.filter((record) => {
    const employee = employees.find(
      (item) => item.id === record.userId
    );

    const name =
      record.employeeName ||
      employee?.name ||
      employee?.email ||
      "Karyawan tidak aktif";

    const matchesName = name.toLowerCase().includes(keyword);
    const matchesDate =
      !selectedDate || record.dateKey === selectedDate;

    return matchesName && matchesDate;
  });

  tableBody.replaceChildren();

  let totalVisible = 0;

  for (const record of filtered) {
    const employee = employees.find(
      (item) => item.id === record.userId
    );

    const name =
      record.employeeName ||
      employee?.name ||
      employee?.email ||
      "Karyawan tidak aktif";

    const hours = Number(record.hours) || 0;
    const rate = Number(record.hourlyRate) || 0;
    const total = Number(record.total) || hours * rate;

    totalVisible += total;

    const row = document.createElement("tr");
    row.className = "hover:bg-slate-800/50";

    const values = [
      formatDate(record.dateKey),
      name,
      `${hours} jam`,
      rupiah(rate),
      rupiah(total)
    ];

    for (const value of values) {
      const cell = document.createElement("td");

      cell.className = "px-3 py-4";
      cell.textContent = value;

      row.appendChild(cell);
    }

    const actionCell = document.createElement("td");
    actionCell.className = "px-3 py-4";

    const actionWrapper = document.createElement("div");
    actionWrapper.className = "flex flex-wrap gap-2";

    const editButton = document.createElement("button");

    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.className =
      "rounded-lg border border-blue-800 px-3 py-2 text-blue-300 hover:bg-blue-950";

    editButton.addEventListener("click", () => {
      startEdit(record);
    });

    const deleteButton = document.createElement("button");

    deleteButton.type = "button";
    deleteButton.textContent = "Hapus";
    deleteButton.className =
      "rounded-lg border border-red-800 px-3 py-2 text-red-300 hover:bg-red-950";

    deleteButton.addEventListener("click", () => {
      deleteOvertime(record);
    });

    actionWrapper.append(editButton, deleteButton);
    actionCell.appendChild(actionWrapper);
    row.appendChild(actionCell);

    tableBody.appendChild(row);
  }

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 6;
    cell.className = "px-3 py-10 text-center text-slate-400";
    cell.textContent = "Belum ada data lembur yang sesuai.";

    row.appendChild(cell);
    tableBody.appendChild(row);
  }

  $("recordCount").textContent = `${filtered.length} catatan`;
  $("totalOvertime").textContent = rupiah(totalVisible);
}

function startEdit(record) {
  if (busy) return;

  editingId = record.id;
  form.dataset.employeeId = record.userId || "";

  renderEmployeeOptions(record.userId || "");

  dateInput.value = record.dateKey || getTodayWIB();
  hoursInput.value = record.hours ?? "";
  rateInput.value = record.hourlyRate ?? "";

  $("formTitle").textContent = "Edit Data Lembur";
  cancelEditButton.classList.remove("hidden");

  calculateTotal();

  saveButton.textContent = "Simpan Perubahan";

  hideMessage();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function resetForm() {
  editingId = null;
  delete form.dataset.employeeId;

  form.reset();

  dateInput.value = getTodayWIB();

  $("formTitle").textContent = "Tambah Data Lembur";

  cancelEditButton.classList.add("hidden");

  renderEmployeeOptions();
  calculateTotal();

  saveButton.textContent = "Simpan Lembur";
}

async function handleSubmit(event) {
  event.preventDefault();

  hideMessage();

  if (busy || !currentAdmin) return;

  const userId = employeeSelect.value;
  const dateKey = dateInput.value;
  const hours = Number(hoursInput.value);
  const hourlyRate = Number(rateInput.value);
  const total = calculateTotal();

  const employee = employees.find(
    (item) => item.id === userId
  );

  if (!employee) {
    showMessage("Pilih karyawan yang masih aktif.", "error");
    return;
  }

  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    showMessage("Tanggal lembur tidak valid.", "error");
    return;
  }

  if (
    !Number.isFinite(hours) ||
    hours < 0.5 ||
    hours > 24 ||
    !Number.isFinite(hourlyRate) ||
    hourlyRate <= 0 ||
    !Number.isSafeInteger(total) ||
    total <= 0
  ) {
    showMessage(
      "Periksa jumlah jam dan tarif. Total harus berupa nominal rupiah bulat.",
      "error"
    );
    return;
  }

  setBusy(true);

  try {
    const recordData = {
      userId,
      employeeName: employee.name || employee.email || "Karyawan",
      dateKey,
      hours,
      hourlyRate,
      total,
      updatedAt: serverTimestamp(),
      updatedBy: currentAdmin.uid
    };

    if (editingId) {
      await updateDoc(
        doc(db, "overtime", editingId),
        recordData
      );

      showMessage("Data lembur berhasil diperbarui.");
    } else {
      await addDoc(collection(db, "overtime"), {
        ...recordData,
        createdAt: serverTimestamp(),
        createdBy: currentAdmin.uid
      });

      showMessage("Data lembur berhasil disimpan.");
    }

    resetForm();
    await loadOvertime();
  } catch (error) {
    console.error("Gagal menyimpan lembur:", error);

    showMessage(
      error.code === "permission-denied"
        ? "Akses ditolak. Periksa Firestore Security Rules."
        : "Data gagal disimpan. Periksa koneksi dan konfigurasi Firebase.",
      "error"
    );
  } finally {
    setBusy(false);
  }
}

async function deleteOvertime(record) {
  if (busy || !currentAdmin) return;

  const confirmed = window.confirm(
    `Yakin ingin menghapus catatan lembur ini?\n\n` +
    `Nama: ${record.employeeName || "Karyawan"}\n` +
    `Tanggal: ${formatDate(record.dateKey)}\n` +
    `Total: ${rupiah(record.total)}\n\n` +
    `Penghapusan ini permanen di Firestore.`
  );

  if (!confirmed) return;

  hideMessage();
  setBusy(true);

  try {
    await deleteDoc(doc(db, "overtime", record.id));

    if (editingId === record.id) {
      resetForm();
    }

    await loadOvertime();

    showMessage("Data lembur berhasil dihapus.");
  } catch (error) {
    console.error("Gagal menghapus lembur:", error);

    showMessage(
      error.code === "permission-denied"
        ? "Akses ditolak. Periksa Firestore Security Rules."
        : "Data lembur gagal dihapus.",
      "error"
    );
  } finally {
    setBusy(false);
  }
}

async function initializePage(user) {
  const profileSnapshot = await getDoc(
    doc(db, "users", user.uid)
  );

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

  dateInput.value = getTodayWIB();

  await loadEmployees();
  await loadOvertime();
}

form.addEventListener("submit", handleSubmit);

hoursInput.addEventListener("input", calculateTotal);
rateInput.addEventListener("input", calculateTotal);

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
    await loadEmployees();
    await loadOvertime();

    showMessage("Data berhasil dimuat ulang.");
  } catch (error) {
    console.error("Gagal memuat data:", error);
    showMessage("Gagal memuat data lembur.", "error");
  } finally {
    setBusy(false);
  }
});

cancelEditButton.addEventListener("click", () => {
  if (!busy) resetForm();
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("./index.html");
    return;
  }

  try {
    await initializePage(user);
  } catch (error) {
    console.error("Gagal membuka modul lembur:", error);

    showMessage(
      "Halaman gagal dimuat. Periksa profil Admin dan Firestore Security Rules.",
      "error"
    );
  }
});
