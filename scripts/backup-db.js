import { loadLocalEnv } from "../server/env.js";
import { createBackup } from "../server/store.js";

await loadLocalEnv();
const backup = await createBackup();

console.log(
  JSON.stringify(
    {
      path: backup.path,
      createdAt: backup.createdAt,
      records: backup.records
    },
    null,
    2
  )
);
