import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { csvEscape } from "./jsonLite.ts";

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;

/** Formats one SQLite value as a CSV field. BLOBs are written as hex. */
export function sqliteValueToCsv (value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Uint8Array) {
    return Array.from(value, b => b.toString(16).padStart(2, "0")).join("");
  }
  return csvEscape(String(value));
}

/** Quotes an SQL identifier (table name) so spaces, keywords and quotes are safe. */
export function quoteIdentifier (name: string): string {
  return `"${name.replaceAll("\"", "\"\"")}"`;
}

class sqlite3Handler implements FormatHandler {

  public name: string = "sqlite3";
  public supportedFormats?: FileFormat[];
  public ready: boolean = false;

  #sqlite3?: Promise<Sqlite3>;

  async init () {
    this.supportedFormats = [
      {
        name: "SQLite3",
        format: "sqlite3",
        extension: "db",
        mime: "application/vnd.sqlite3",
        from: true,
        to: false,
        internal: "sqlite3"
      },
      {
        name: "Comma Separated Values",
        format: "csv",
        extension: "csv",
        mime: "text/csv",
        from: false,
        to: true,
        internal: "csv"
      },
    ];
    this.ready = true;
  }

  /**
   * Loads the SQLite WASM module once. The binary is served from
   * `public/wasm` (copied by `scripts/copy-wasm.mjs`) because the package's
   * default `new URL("sqlite3.wasm", import.meta.url)` lookup doesn't survive
   * bundling.
   */
  #loadSqlite () {
    this.#sqlite3 ??= (sqlite3InitModule as unknown as (opts: object) => Promise<Sqlite3>)({
      locateFile: (file: string) => `/wasm/${file}`,
      print: () => {},
      printErr: (msg: string) => console.warn("[sqlite3]", msg)
    }).catch((e) => {
      this.#sqlite3 = undefined;
      throw e;
    });
    return this.#sqlite3;
  }

  getTables (db: any): string[] {
    const tables: string[] = [];
    const stmt = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid;"
    );
    try {
      while (stmt.step()) tables.push(String(stmt.get(0)));
    } finally {
      stmt.finalize();
    }
    return tables;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    if (inputFormat.internal !== "sqlite3" || outputFormat.internal !== "csv") {
      throw `sqlite3: unsupported conversion ${inputFormat.format} -> ${outputFormat.format}`;
    }

    const sqlite3 = await this.#loadSqlite();
    const outputFiles: FileData[] = [];
    const encoder = new TextEncoder();

    for (const file of inputFiles) {
      const baseName = file.name.replace(/\.[^.]+$/, "") || "database";
      const bytes = new Uint8Array(file.bytes);
      // WAL-mode databases (file format bytes 18/19 == 2) can't be opened
      // from memory; marking them as rollback-journal (1) is what the sqlite3
      // CLI's `.open --deserialize` does too. The WAL file isn't available here anyway.
      if (bytes.length >= 100 && bytes[18] === 2 && bytes[19] === 2) {
        bytes[18] = 1;
        bytes[19] = 1;
      }
      const p = sqlite3.wasm.allocFromTypedArray(bytes);
      const db = new sqlite3.oo1.DB();
      try {
        if (!db.pointer) throw new Error("Database pointer is undefined");
        const rc = sqlite3.capi.sqlite3_deserialize(
          db.pointer,
          "main",
          p,
          bytes.byteLength,
          bytes.byteLength,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_READONLY
        );
        db.checkRc(rc);

        const tables = this.getTables(db);
        if (tables.length === 0) throw `${file.name} contains no tables.`;

        for (const table of tables) {
          const stmt = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`);
          let csv = "";
          try {
            csv += stmt.getColumnNames().map(csvEscape).join(",") + "\n";
            while (stmt.step()) {
              const row = Array.from({ length: stmt.columnCount }, (_, j) => stmt.get(j));
              csv += row.map(sqliteValueToCsv).join(",") + "\n";
            }
          } finally {
            stmt.finalize();
          }

          const safeTable = table.replace(/[\\/:*?"<>|]/g, "_");
          outputFiles.push({
            name: tables.length === 1 && inputFiles.length === 1
              ? `${baseName}.${outputFormat.extension}`
              : `${baseName}_${safeTable}.${outputFormat.extension}`,
            bytes: encoder.encode(csv)
          });
        }
      } finally {
        db.close();
      }
    }

    return outputFiles;
  }

}

export default sqlite3Handler;
