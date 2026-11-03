const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("all Electron and packaging entry points parse before startup", () => {
  for (const directory of ["electron", "scripts"]) {
    const root = path.join(__dirname, "..", directory);
    for (const file of fs.readdirSync(root)) {
      if (file.endsWith(".cjs"))
        execFileSync(process.execPath, ["--check", path.join(root, file)], {
          stdio: "pipe",
        });
    }
  }
});
