function renameBeforeExtension(name: string, suffix: string) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}${suffix}`;
  return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

/** Keep every output available when names become ZIP entry keys. */
export function uniquifyOutputNames<T extends { name: string }>(files: T[]): T[] {
  const reserved = new Set(files.map((file) => file.name));
  const used = new Set<string>();
  return files.map((file) => {
    let name = file.name;
    let suffix = 2;
    if (used.has(name)) {
      do {
        name = renameBeforeExtension(file.name, `-${suffix++}`);
      } while (used.has(name) || reserved.has(name));
    }
    used.add(name);
    return name === file.name ? file : { ...file, name };
  });
}
