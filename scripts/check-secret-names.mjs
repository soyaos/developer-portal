import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const EXPECTED = [
  "API_KEY_PEPPER",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "SESSION_SECRET",
];

export function validateProductionSecretNames(names) {
  const present = [...new Set(names)].sort();
  const missing = EXPECTED.filter((name) => !present.includes(name));
  const forbidden = present.filter((name) => name === "E2E_BOOTSTRAP_SECRET");
  return {
    environment: "production",
    result: missing.length === 0 && forbidden.length === 0 ? "pass" : "fail",
    present,
    missing,
    forbidden,
  };
}

export function readProductionSecretNames() {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const command = spawnSync(executable, ["wrangler", "secret", "list"], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  if (command.status !== 0) {
    throw new Error("unable to list production Worker secret names");
  }
  const payload = JSON.parse(command.stdout);
  if (!Array.isArray(payload)) throw new Error("invalid Worker secret-name response");
  return payload.map((entry) => entry?.name).filter((name) => typeof name === "string");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = validateProductionSecretNames(readProductionSecretNames());
    console.log(JSON.stringify(result, null, 2));
    if (result.result !== "pass") process.exitCode = 1;
  } catch (error) {
    console.error(
      JSON.stringify({
        environment: "production",
        result: "fail",
        error: error instanceof Error ? error.message : "unknown secret-name check failure",
      }),
    );
    process.exitCode = 1;
  }
}
