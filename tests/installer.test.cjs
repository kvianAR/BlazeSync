const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const installer = path.resolve(__dirname, "../scripts/install-macos.sh");
async function fixture(run) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "blazesync-installer-test-"),
  );
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  const write = async (name, body) => {
    const p = path.join(bin, name);
    await fs.writeFile(p, "#!/bin/bash\nset -e\n" + body);
    await fs.chmod(p, 0o755);
  };
  const zip = path.join(root, "release.zip");
  await fs.writeFile(zip, "fixture release");
  const digest = crypto
    .createHash("sha256")
    .update("fixture release")
    .digest("hex");
  await fs.writeFile(
    path.join(root, "SHA256SUMS.txt"),
    digest + "  BlazeSync-macos-arm64.zip\n",
  );
  await write(
    "uname",
    'if [ "$1" = "-s" ]; then echo "${TEST_OS:-Darwin}"; else echo "${TEST_ARCH:-arm64}"; fi\n',
  );
  await write("ps", 'printf "%s\\n" "${TEST_PROCESS:-/bin/zsh}"\n');
  await write(
    "curl",
    'while [ "$#" -gt 0 ]; do case "$1" in -o) target="$2"; shift 2;; *) shift;; esac; done\ncase "$target" in *.zip) cp "$TEST_FIXTURE/release.zip" "$target";; *) cp "$TEST_FIXTURE/SHA256SUMS.txt" "$target";; esac\n',
  );
  await write(
    "ditto",
    'target="${@: -1}"; mkdir -p "$target/BlazeSync.app/Contents/MacOS"; printf "#!/bin/bash\\nexit 0\\n" > "$target/BlazeSync.app/Contents/MacOS/BlazeSync"; chmod +x "$target/BlazeSync.app/Contents/MacOS/BlazeSync"\n',
  );
  await write("codesign", "exit 0\n");
  await write(
    "rsync",
    'source="${@: -2:1}"; target="${@: -1}"; mkdir -p "$target"; cp -R "$source". "$target"\n',
  );
  const invoke = (extra = [], env = {}) =>
    spawnSync(
      "/bin/bash",
      [installer, "--prefix", path.join(root, "install"), ...extra],
      {
        env: {
          ...process.env,
          PATH: bin + ":" + process.env.PATH,
          TEST_FIXTURE: root,
          ...env,
        },
        encoding: "utf8",
      },
    );
  try {
    await run({ root, invoke });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("installer help explains destination without changing files", () => {
  const r = spawnSync("/bin/bash", [installer, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Apple Silicon/);
});
test("installer rejects unsupported platforms before downloading", () =>
  fixture(async ({ root, invoke }) => {
    const r = invoke([], { TEST_OS: "Linux" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /requires an Apple Silicon Mac/);
    await assert.rejects(fs.stat(path.join(root, "install")));
  }));
test("installer blocks active relative-path app launches", () =>
  fixture(async ({ invoke }) => {
    const r = invoke([], {
      TEST_PROCESS: "outputs/BlazeSync.app/Contents/MacOS/BlazeSync",
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Quit BlazeSync/);
  }));
test("installer refuses a mismatched archive before installation", () =>
  fixture(async ({ root, invoke }) => {
    await fs.appendFile(path.join(root, "release.zip"), "tampered");
    const r = invoke();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Checksum mismatch/);
    await assert.rejects(fs.stat(path.join(root, "install")));
  }));
test("installer refuses a symbolic-link destination", () =>
  fixture(async ({ root, invoke }) => {
    await fs.mkdir(path.join(root, "install"));
    await fs.symlink(
      path.join(root, "elsewhere"),
      path.join(root, "install", "BlazeSync.app"),
    );
    const r = invoke();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /symbolic link/);
  }));
test("installer verifies fixture checksum and installs the expected app", () =>
  fixture(async ({ root, invoke }) => {
    const r = invoke();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Installed BlazeSync/);
    await fs.access(
      path.join(
        root,
        "install",
        "BlazeSync.app",
        "Contents",
        "MacOS",
        "BlazeSync",
      ),
    );
  }));
