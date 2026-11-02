const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const source = fs.readFileSync(require.resolve("../electron/main.cjs"), "utf8");
const emitter = source.slice(
  source.indexOf("function emit() {"),
  source.indexOf("function log("),
);
const progress = source.slice(
  source.indexOf("function progressEmit() {"),
  source.indexOf("function dropError("),
);
function context(extra = {}) {
  return vm.createContext({
    isQuitting: false,
    win: null,
    trayWindow: null,
    publicState: () => ({}),
    transfers: [],
    ...extra,
  });
}
test("destroyed tray ignores late progress notifications instead of throwing", () => {
  let calls = 0;
  const c = context({
    tray: {
      isDestroyed: () => true,
      setToolTip: () => {
        calls++;
        throw new Error("Tray is destroyed");
      },
    },
  });
  vm.runInContext(emitter, c);
  assert.doesNotThrow(() => vm.runInContext("emit()", c));
  assert.equal(calls, 0);
});
test("shutdown does not send events to windows or native tray", () => {
  const c = context({
    isQuitting: true,
    win: {
      isDestroyed: () => {
        throw new Error("must not inspect window");
      },
    },
    tray: {
      isDestroyed: () => {
        throw new Error("must not inspect tray");
      },
    },
  });
  vm.runInContext(emitter, c);
  assert.doesNotThrow(() => vm.runInContext("emit()", c));
});
test("a scheduled progress timer remains safe if shutdown destroys tray before it fires", () => {
  let callback;
  const c = context({
    tray: {
      isDestroyed: () => true,
      setToolTip: () => {
        throw new Error("Tray is destroyed");
      },
    },
    progressTimer: null,
    setTimeout: (fn) => {
      callback = fn;
      return 1;
    },
  });
  vm.runInContext(emitter + progress, c);
  vm.runInContext("progressEmit();isQuitting=true;", c);
  assert.doesNotThrow(() => callback());
  assert.equal(c.progressTimer, null);
});
