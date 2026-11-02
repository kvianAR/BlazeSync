function isBlazeSyncRunning(commands) {
  return commands
    .split("\n")
    .some((command) =>
      command.trim().endsWith("BlazeSync.app/Contents/MacOS/BlazeSync"),
    );
}
module.exports = { isBlazeSyncRunning };
