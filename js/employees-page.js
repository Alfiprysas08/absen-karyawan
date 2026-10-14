
import {
  auth,
  db,
  secondaryAuth,
  prepareSecondaryAuth
} from "./firebase.js";

import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut
} from "firebase/auth";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";

import { getEmployees } from "./employees.js";

// ========================================
// ELEMEN HTML
// ========================================

const statusEl = document.getElementById("status");
const listEl = document.getElementById("employeeList");
const refreshBtn = document.getElementById("refreshBtn");

const toggleFormBtn = document.getElementById("toggleFormBtn");
const formSection = document.getElementById("employeeFormSection");
const employeeForm = document.getElementById("employeeForm");
const cancelFormBtn = document.getElementById("cancelFormBtn");
const saveEmployeeBtn = document.getElementById("saveEmployeeBtn");
const formMessage = document.getElementById("formMessage");

const editSection = document.getElementById("editEmployeeSection");
const editForm = document.getElementById("editEmployeeForm");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const updateEmployeeBtn = document.getElementById("updateEmployeeBtn");
const editFormMessage = document.getElementById("editFormMessage");

// ========================================
// STATUS APLIKASI
// ========================================

let isAdminVerified = false;
let isLoading = false;
let isSaving = false;
let isEditing = false;

// ========================================
// UTILITAS
// ========================================

function formatRupiah(amount) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(amount);
}

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
}

function hideStatus() {
  statusEl.classList.add("hidden");
}

function showMessage(element, message, type = "error") {
  element.textContent = message;

  element.classList.remove(
    "hidden",
    "border-red-500/30",
    "bg-red-500/10",
    "text-red-300",
    "border-emerald-500/30",
    "bg-emerald-500/10",
    "text-emerald-300"
  );

  if (type === "success") {
    element.classList.add(
      "border-emerald-500/30",
      "bg-emerald-500/10",
      "text-emerald-300"
    );
  } else {
    element.classList.add(
      "border-red-500/30",
      "bg-red-500/10",
      "text-red-300"
    );
  }
}

function hideMessage(element) {
  element.classList.add("hidden");
  element.textContent = "";
}

async function verifyAdmin() {
  const admin = auth.currentUser;

  if (!admin) return false;

  const snapshot = await getDoc(doc(db, "users", admin.uid));

  return (
    snapshot.exists() &&
    snapshot.data().role === "admin" &&
    snapshot.data().isActive === true
  );
}

// ========================================
// FORM TAMBAH KARYAWAN
// ========================================

function openAddForm() {
  if (!isAdminVerified || isSaving) return;

  editSection.classList.add("hidden");
  editForm.reset();
  hideMessage(editFormMessage);

  formSection.classList.remove("hidden");
  toggleFormBtn.textContent = "Tutup Form";

  hideMessage(formMessage);
}

function closeAddForm() {
  if (isSaving) return;

  formSection.classList.add("hidden");
  toggleFormBtn.textContent = "+ Tambah Karyawan";

  employeeForm.reset();
  hideMessage(formMessage);
}

toggleFormBtn.addEventListener("click", () => {
  if (formSection.classList.contains("hidden")) {
    openAddForm();
  } else {
    closeAddForm();
  }
});

cancelFormBtn.addEventListener("click", closeAddForm);

// ========================================
// FORM EDIT KARYAWAN
// ========================================

function openEditForm(employee) {
  if (!isAdminVerified || isSaving) return;

  closeAddForm();
  hideMessage(editFormMessage);

  document.getElementById("editEmployeeId").value = employee.id;
  document.getElementById("editEmployeeName").value =
    employee.name || "";
  document.getElementById("editEmployeeEmail").value =
    employee.email || "";
  document.getElementById("editEmployeePosition").value =
    employee.position || "";

  document.getElementById("editDailySalary").value =
    typeof employee.dailySalary === "number"
      ? String(employee.dailySalary)
      : "";

  editSection.classList.remove("hidden");

  editSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function closeEditForm() {
  if (isSaving) return;

  editSection.classList.add("hidden");
  editForm.reset();
  hideMessage(editFormMessage);
}

cancelEditBtn.addEventListener("click", closeEditForm);

// ========================================
// TAMPILAN DAFTAR KARYAWAN
// ========================================

function renderEmployees(employees) {
  listEl.replaceChildren();

  if (employees.length === 0) {
    showStatus("Belum ada data karyawan.");
    return;
  }

  hideStatus();

  employees.forEach((employee) => {
    const card = document.createElement("article");

    card.className =
      "rounded-2xl border border-slate-800 bg-slate-900 p-5";

    const name = document.createElement("h3");
    name.className = "font-semibold";
    name.textContent = employee.name || "Tanpa nama";

    const email = document.createElement("p");
    email.className = "mt-1 break-all text-sm text-slate-400";
    email.textContent = employee.email || "-";

    const role = document.createElement("p");
    role.className = "mt-3 text-sm text-blue-300";
    role.textContent =
      employee.role === "admin"
        ? "Administrator"
        : "Karyawan";

    const position = document.createElement("p");
    position.className = "mt-2 text-sm text-slate-300";
    position.textContent =
      `Jabatan: ${employee.position || "Belum diatur"}`;

    const active = document.createElement("p");
    active.className = "mt-2 text-xs";

    active.textContent =
      employee.isActive === true
        ? "Akun aktif"
        : "Akun nonaktif";

    active.classList.add(
      employee.isActive === true
        ? "text-emerald-400"
        : "text-red-400"
    );

    const salary = document.createElement("p");
    salary.className = "mt-3 text-sm text-slate-300";

    salary.textContent =
      typeof employee.dailySalary === "number"
        ? `Gaji harian: ${formatRupiah(employee.dailySalary)}`
        : "Gaji harian: Belum diatur";

    card.append(name, email, role, position, active, salary);

    // Tombol hanya untuk akun karyawan
    if (employee.role === "user") {
      const actions = document.createElement("div");

      actions.className =
        "mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4";

      // Tombol Edit
      const editButton = document.createElement("button");

      editButton.type = "button";
      editButton.className =
        "rounded-xl border border-amber-500/40 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/10";
      editButton.textContent = "Edit Karyawan";

      editButton.addEventListener("click", () => {
        openEditForm(employee);
      });

      // Tombol Nonaktifkan / Aktifkan
      const statusButton = document.createElement("button");

      statusButton.type = "button";

      if (employee.isActive === true) {
        statusButton.textContent = "Nonaktifkan";

        statusButton.className =
          "rounded-xl border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/10";
      } else {
        statusButton.textContent = "Aktifkan Kembali";

        statusButton.className =
          "rounded-xl border border-emerald-500/40 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10";
      }

      statusButton.addEventListener("click", () => {
        toggleEmployeeStatus(employee);
      });

      actions.append(editButton, statusButton);
      card.append(actions);
    }

    listEl.append(card);
  });
}

// ========================================
// MUAT ULANG DAFTAR
// ========================================

async function loadEmployees() {
  if (!isAdminVerified || isLoading) return;

  isLoading = true;

  refreshBtn.disabled = true;
  refreshBtn.textContent = "Memuat...";

  showStatus("Memuat data karyawan...");
  listEl.replaceChildren();

  try {
    const employees = await getEmployees();
    renderEmployees(employees);
  } catch (error) {
    console.error("Gagal memuat karyawan:", error);

    showStatus(
      "Data gagal dimuat. Periksa koneksi dan Firestore Rules."
    );
  } finally {
    isLoading = false;
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Muat Ulang";
  }
}

refreshBtn.addEventListener("click", loadEmployees);

// ========================================
// SIMPAN KARYAWAN BARU
// ========================================

employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdminVerified || isSaving) return;

  isSaving = true;
  saveEmployeeBtn.disabled = true;
  saveEmployeeBtn.textContent = "Menyimpan...";

  hideMessage(formMessage);

  let newAuthUser = null;
  let profileSaved = false;

  try {
    if (!(await verifyAdmin())) {
      isAdminVerified = false;
      throw new Error("ADMIN_ACCESS_DENIED");
    }

    const name = document
      .getElementById("employeeName")
      .value.trim();

    const email = document
      .getElementById("employeeEmail")
      .value.trim()
      .toLowerCase();

    const password = document
      .getElementById("employeePassword")
      .value;

    const position = document
      .getElementById("employeePosition")
      .value.trim();

    const salaryInput = document
      .getElementById("dailySalary")
      .value.trim();

    const dailySalary = Number(salaryInput);

    if (!name || !email || !password || !position) {
      throw new Error("Lengkapi semua data karyawan.");
    }

    if (password.length < 6) {
      throw new Error("Password minimal 6 karakter.");
    }

    if (
      salaryInput === "" ||
      !Number.isSafeInteger(dailySalary) ||
      dailySalary < 0 ||
      dailySalary > 1000000000
    ) {
      throw new Error("Nominal gaji harian tidak valid.");
    }

    await prepareSecondaryAuth();

    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      password
    );

    newAuthUser = credential.user;

    await setDoc(doc(db, "users", newAuthUser.uid), {
      name,
      email,
      role: "user",
      isActive: true,
      position,
      dailySalary,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid
    });

    profileSaved = true;

    // Sesi Admin utama tetap digunakan
    await signOut(secondaryAuth);
    newAuthUser = null;

    employeeForm.reset();

    showMessage(
      formMessage,
      "Karyawan berhasil ditambahkan.",
      "success"
    );

    await loadEmployees();
  } catch (error) {
    console.error("Gagal menambahkan karyawan:", error);

    let message =
      "Karyawan gagal ditambahkan. Silakan coba lagi.";

    if (error.message === "ADMIN_ACCESS_DENIED") {
      message = "Akses Admin tidak valid. Silakan login kembali.";
    } else if (
      error.message === "Lengkapi semua data karyawan." ||
      error.message === "Password minimal 6 karakter." ||
      error.message === "Nominal gaji harian tidak valid."
    ) {
      message = error.message;
    } else if (error.code === "auth/email-already-in-use") {
      message = "Email tersebut sudah digunakan.";
    } else if (error.code === "auth/invalid-email") {
      message = "Format email tidak valid.";
    } else if (error.code === "auth/weak-password") {
      message = "Password terlalu lemah. Gunakan minimal 6 karakter.";
    } else if (error.code === "permission-denied") {
      message = "Firestore menolak penyimpanan. Periksa Security Rules.";
    }

    if (newAuthUser && !profileSaved) {
      try {
        await deleteUser(newAuthUser);
        newAuthUser = null;
      } catch (cleanupError) {
        console.error("Gagal membersihkan akun Auth:", cleanupError);

        message +=
          " Periksa Firebase Authentication untuk akun yang mungkin belum memiliki profil.";
      }
    }

    try {
      if (secondaryAuth.currentUser) {
        await signOut(secondaryAuth);
      }
    } catch (cleanupError) {
      console.error("Gagal membersihkan sesi kedua:", cleanupError);
    }

    showMessage(formMessage, message);
  } finally {
    isSaving = false;
    saveEmployeeBtn.disabled = false;
    saveEmployeeBtn.textContent = "Simpan Karyawan";
  }
});

// ========================================
// EDIT DATA KARYAWAN
// ========================================

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdminVerified || isSaving) return;

  const employeeId = document
    .getElementById("editEmployeeId")
    .value;

  const name = document
    .getElementById("editEmployeeName")
    .value.trim();

  const position = document
    .getElementById("editEmployeePosition")
    .value.trim();

  const salaryInput = document
    .getElementById("editDailySalary")
    .value.trim();

  const dailySalary = Number(salaryInput);

  if (!employeeId || !name || !position) {
    showMessage(editFormMessage, "Nama dan jabatan wajib diisi.");
    return;
  }

  if (
    salaryInput === "" ||
    !Number.isSafeInteger(dailySalary) ||
    dailySalary < 0 ||
    dailySalary > 1000000000
  ) {
    showMessage(
      editFormMessage,
      "Nominal gaji harian tidak valid."
    );
    return;
  }

  isSaving = true;
  isEditing = true;

  updateEmployeeBtn.disabled = true;
  updateEmployeeBtn.textContent = "Menyimpan...";

  hideMessage(editFormMessage);

  try {
    if (!(await verifyAdmin())) {
      isAdminVerified = false;
      throw new Error("ADMIN_ACCESS_DENIED");
    }

    const employeeRef = doc(db, "users", employeeId);
    const employeeSnapshot = await getDoc(employeeRef);

    if (
      !employeeSnapshot.exists() ||
      employeeSnapshot.data().role !== "user"
    ) {
      throw new Error("EMPLOYEE_NOT_FOUND");
    }

    await updateDoc(employeeRef, {
      name,
      position,
      dailySalary,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid
    });

    showMessage(
      editFormMessage,
      "Data karyawan berhasil diperbarui.",
      "success"
    );

    editSection.classList.add("hidden");
    editForm.reset();

    await loadEmployees();
  } catch (error) {
    console.error("Gagal mengedit karyawan:", error);

    let message = "Perubahan gagal disimpan.";

    if (error.message === "ADMIN_ACCESS_DENIED") {
      message = "Akses Admin tidak valid. Silakan login kembali.";
    } else if (error.message === "EMPLOYEE_NOT_FOUND") {
      message = "Data karyawan tidak ditemukan.";
    } else if (error.code === "permission-denied") {
      message = "Firestore menolak perubahan. Periksa Security Rules.";
    }

    showMessage(editFormMessage, message);
  } finally {
    isSaving = false;
    isEditing = false;

    updateEmployeeBtn.disabled = false;
    updateEmployeeBtn.textContent = "Simpan Perubahan";
  }
});

// ========================================
// NONAKTIFKAN / AKTIFKAN KARYAWAN
// ========================================

async function toggleEmployeeStatus(employee) {
  if (!isAdminVerified || isSaving) return;

  const nextActive = employee.isActive !== true;

  const action = nextActive
    ? "mengaktifkan kembali"
    : "menonaktifkan";

  const confirmed = window.confirm(
    `Yakin ingin ${action} karyawan ${employee.name || "ini"}?`
  );

  if (!confirmed) return;

  isSaving = true;

  try {
    if (!(await verifyAdmin())) {
      isAdminVerified = false;
      throw new Error("ADMIN_ACCESS_DENIED");
    }

    const employeeRef = doc(db, "users", employee.id);
    const employeeSnapshot = await getDoc(employeeRef);

    if (
      !employeeSnapshot.exists() ||
      employeeSnapshot.data().role !== "user"
    ) {
      throw new Error("EMPLOYEE_NOT_FOUND");
    }

    await updateDoc(employeeRef, {
      isActive: nextActive,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid
    });

    showStatus(
      nextActive
        ? "Karyawan berhasil diaktifkan kembali."
        : "Karyawan berhasil dinonaktifkan. Riwayat data tetap tersimpan."
    );

    await loadEmployees();
  } catch (error) {
    console.error("Gagal mengubah status karyawan:", error);

    if (error.message === "ADMIN_ACCESS_DENIED") {
      showStatus("Akses Admin tidak valid. Silakan login kembali.");
    } else if (error.message === "EMPLOYEE_NOT_FOUND") {
      showStatus("Data karyawan tidak ditemukan.");
    } else {
      showStatus(
        "Status gagal diperbarui. Periksa koneksi dan Firestore Rules."
      );
    }
  } finally {
    isSaving = false;
  }
}

// ========================================
// VERIFIKASI SESI ADMIN
// ========================================

onAuthStateChanged(auth, async (user) => {
  isAdminVerified = false;

  if (!user) {
    window.location.replace("./index.html");
    return;
  }

  try {
    if (!(await verifyAdmin())) {
      window.location.replace("./index.html");
      return;
    }

    isAdminVerified = true;
    await loadEmployees();
  } catch (error) {
    console.error("Verifikasi Admin gagal:", error);

    showStatus(
      "Tidak dapat memverifikasi Admin. Periksa koneksi dan Security Rules."
    );
  }
});
