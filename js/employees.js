
import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  query,
  orderBy
} from "firebase/firestore";

export async function getEmployees() {
  const employeesRef = collection(db, "users");
  const employeesQuery = query(
    employeesRef,
    orderBy("name", "asc")
  );

  const snapshot = await getDocs(employeesQuery);

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));
}
