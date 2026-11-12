import { closeDb } from "./index";
import { runMigrations } from "./migrate";

runMigrations()
  .then(() => {
    console.log("Migrations appliquées.");
    return closeDb();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
