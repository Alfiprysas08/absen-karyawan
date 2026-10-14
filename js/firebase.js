
import { initializeApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  inMemoryPersistence
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB_Qnd3RVlWDxGTgCdJOIKJu2LlyMGWgj0",
  authDomain: "absensi-karyawan-9c975.firebaseapp.com",
  projectId: "absensi-karyawan-9c975",
  storageBucket: "absensi-karyawan-9c975.firebasestorage.app",
  messagingSenderId: "1020570640862",
  appId: "1:1020570640862:web:d17eb213f46a816946bd4f"
};

// Instance utama untuk login Admin dan akses Firestore
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Instance kedua khusus untuk membuat akun karyawan
const secondaryApp = initializeApp(
  firebaseConfig,
  "Secondary"
);

export const secondaryAuth = getAuth(secondaryApp);

// Gunakan sesi sementara untuk instance kedua
export const prepareSecondaryAuth = () =>
  setPersistence(secondaryAuth, inMemoryPersistence);
