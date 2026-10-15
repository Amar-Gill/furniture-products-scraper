import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Applies settings from an optional .env file. Entry points import this module first so the
// values are in place before other modules read process.env. Variables already set in the
// shell take precedence over the file.
function readEnvFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

for (const [name, value] of Object.entries(parseEnv(readEnvFile(".env")))) {
  if (value !== undefined && process.env[name] === undefined) {
    process.env[name] = value;
  }
}
