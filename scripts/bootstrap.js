"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runtime = path.join(root, "runtime");

for (const directory of ["logs", "scenarios", "evidence", "data", "ssh"]) {
  fs.mkdirSync(path.join(runtime, directory), { recursive: true, mode: 0o700 });
}

const profilePath = path.join(runtime, "data", "profile.json");
const profileAlreadyExists = fs.existsSync(profilePath);

const initialFiles = new Map([
  [
    path.join(runtime, "backend.env"),
    "BACKEND_PORT=4000\nMOCK_BACKEND_API_KEY=lab-only-public-key\n",
  ],
  [
    path.join(runtime, "web.env"),
    [
      "WEB_PORT=3000",
      "SUPABASE_URL=http://127.0.0.1:4000",
      "SUPABASE_ANON_KEY=lab-only-public-key",
      "PROFILE_FILE=runtime/data/profile.json",
      "",
    ].join("\n"),
  ],
  [
    profilePath,
    JSON.stringify(
      {
        lab: "linux-support-lab",
        owner: "local-training-only",
        purpose: "A harmless file used to practice permissions troubleshooting.",
      },
      null,
      2,
    ) + "\n",
  ],
]);

for (const [file, content] of initialFiles) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, content, { mode: 0o600 });
    console.log(`Created ${path.relative(root, file)}`);
  }
}

if (!profileAlreadyExists) {
  fs.chmodSync(profilePath, 0o600);
}
console.log("Lab runtime is ready. Existing environment files were left unchanged.");
