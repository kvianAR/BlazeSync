export function uniqueBy(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}
export async function refreshPages(fetchPage, previousCount = 0) {
  let token,
    result,
    pages = 0;
  const files = [],
    folders = [],
    tokens = new Set();
  do {
    result = await fetchPage(token);
    pages++;
    files.push(...(result.files || []));
    folders.push(...(result.folders || []));
    token = result.next;
    if (token) {
      if (tokens.has(token))
        throw new Error("Repeated cloud listing page. Refresh again.");
      tokens.add(token);
    }
  } while (token && files.length + folders.length < previousCount);
  return {
    ...result,
    files: uniqueBy(files, (f) => f.key),
    folders: [...new Set(folders)],
    pages,
  };
}
