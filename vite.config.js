
import { defineConfig } from "vite";
import { resolve } from "node:path";

const pages = [
  "index",
  "admin",
  "user",
  "employees",
  "attendance",
  "overtime",
  "payroll",
  "reports",
];

export default defineConfig({
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((page) => [
          page,
          resolve(process.cwd(), `${page}.html`),
        ])
      ),
    },
  },
});
