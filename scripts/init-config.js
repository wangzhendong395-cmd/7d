import { copyFile, stat } from "node:fs/promises";
import path from "node:path";

const target = path.resolve(".env.local");
const source = path.resolve(".env.example");

try {
  await stat(target);
  console.log(".env.local already exists. No changes made.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await copyFile(source, target);
  console.log("Created .env.local from .env.example.");
  console.log("Edit .env.local and fill your Feishu values, then restart npm run dev.");
}
