import { spawnSync } from "node:child_process";

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function pickEnv(names) {
  for (const name of names) {
    if (nonEmpty(process.env[name])) return process.env[name].trim();
  }
  return "";
}

function buildDatabaseUrlFromParts() {
  const host = pickEnv(["PGHOST", "POSTGRES_HOST"]);
  const port = pickEnv(["PGPORT", "POSTGRES_PORT"]) || "5432";
  const database = pickEnv(["PGDATABASE", "POSTGRES_DB"]);
  const user = pickEnv(["PGUSER", "POSTGRES_USER"]);
  const password = pickEnv(["PGPASSWORD", "POSTGRES_PASSWORD"]);

  if (!host || !database || !user || !password) return "";

  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgresql://${auth}@${host}:${port}/${database}?sslmode=require`;
}

function runOrExit(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const resolvedDatabaseUrl =
  pickEnv(["DATABASE_URL", "DATABASE_PRIVATE_URL", "POSTGRES_URL"]) ||
  buildDatabaseUrlFromParts();

const env = { ...process.env };

if (resolvedDatabaseUrl) {
  env.DATABASE_URL = resolvedDatabaseUrl;
  console.log("[startup] DATABASE_URL resolved. Running prisma db push...");
  runOrExit("npx", ["prisma", "db", "push"], env);
} else {
  console.warn("[startup] DATABASE_URL is empty. Skipping prisma db push.");
  console.warn("[startup] Set DATABASE_URL in Railway Variables to enable DB features.");
}

console.log("[startup] Starting server...");
runOrExit("npx", ["tsx", "server.ts"], env);
