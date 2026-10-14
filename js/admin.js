
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const message = document.getElementById("pageMessage");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("./index.html");
    return;
  }

  try {
    const profileRef = doc(db, "users", user.uid);
    const profileSnap = await getDoc(profileRef);

    if (!profileSnap.exists()) {
      await signOut(auth);
      window.location.replace("./index.html");
      return;
    }

    const profile = profileSnap.data();

    if (profile.role !== "admin" || profile.isActive !== true) {
      await signOut(auth);
      window.location.replace("./index.html");
      return;
    }

    document.getElementById("adminName").textContent =
      profile.name || "Administrator";

    document.getElementById("adminEmail").textContent =
      user.email || "";

  } catch (error) {
    console.error("Gagal memuat dashboard:", error);
    message.textContent =
      "Gagal memuat profil. Periksa koneksi dan Firestore Rules.";
    message.classList.remove("hidden");
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("./index.html");
});
