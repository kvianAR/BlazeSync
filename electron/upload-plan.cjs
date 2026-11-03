async function prepareUploadPlan(entries, keepBoth, copyKey) {
  const selected = keepBoth
    ? entries
    : [...new Map(entries.map((entry) => [entry.key, entry])).values()];
  const seen = new Set();
  const reserved = new Set(entries.map((entry) => entry.key));
  const pending = [];
  for (const entry of selected) {
    const duplicate =
      !entry.directory && keepBoth && (entry.existing || seen.has(entry.key));
    if (duplicate) {
      const key = await copyKey(entry.key);
      if (reserved.has(key))
        throw new Error(
          "Copy name conflicts with another selected item. Try again.",
        );
      reserved.add(key);
      pending.push({ ...entry, key });
    } else if (!entry.unchanged && !(entry.directory && seen.has(entry.key))) {
      pending.push(entry);
    }
    seen.add(entry.key);
  }
  return {
    pending,
    skipped: selected.length - pending.length,
    merged: entries.length - selected.length,
  };
}
module.exports = { prepareUploadPlan };
