import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import mime from "mime";
import normalizeMimeType from "../normalizeMimeType.ts";
import { replaceExtension } from "./handlerUtils.ts";

class pandocHandler implements FormatHandler {

  static formatNames: Map<string, string> = new Map([
    ["ansi", "ANSI terminal"],
    ["asciidoc", "modern AsciiDoc"],
    ["asciidoc_legacy", "AsciiDoc for asciidoc-py"],
    ["asciidoctor", "AsciiDoctor (= modern AsciiDoc)"],
    ["bbcode", "BBCode"],
    ["beamer", "LaTeX Beamer slides"],
    ["biblatex", "BibLaTeX bibliography"],
    ["bibtex", "BibTeX bibliography"],
    ["bits", "BITS XML, alias for jats"],
    ["chunkedhtml", "zip of linked HTML files"],
    ["commonmark", "CommonMark Markdown"],
    ["commonmark_x", "CommonMark with extensions"],
    ["context", "ConTeXt"],
    ["creole", "Creole 1.0"],
    ["csljson", "CSL JSON bibliography"],
    ["csv", "CSV table"],
    ["djot", "Djot markup"],
    ["docbook", "DocBook v4"],
    ["docbook5", "DocBook v5"],
    ["docx", "Word"],
    ["dokuwiki", "DokuWiki markup"],
    ["dzslides", "DZSlides HTML slides"],
    ["endnotexml", "EndNote XML bibliography"],
    ["epub", "EPUB v3"],
    ["epub2", "EPUB v2"],
    ["epub3", "EPUB v3"],
    ["fb2", "FictionBook2"],
    ["gfm", "GitHub-Flavored Markdown"],
    ["haddock", "Haddock markup"],
    ["html", "HTML"],
    ["html4", "XHTML 1.0 Transitional"],
    ["html5", "HTML"],
    ["icml", "InDesign ICML"],
    ["ipynb", "Jupyter notebook"],
    ["jats", "JATS XML"],
    ["jira", "Jira/Confluence wiki markup"],
    ["json", "Pandoc AST (JSON)"],
    ["latex", "LaTeX"],
    ["man", "roff man"],
    ["markdown", "Pandoc's Markdown"],
    ["markdown_mmd", "MultiMarkdown"],
    ["markdown_phpextra", "PHP Markdown Extra"],
    ["markdown_strict", "original unextended Markdown"],
    ["markdown_github", "GitHub-Flavored Markdown"],
    ["markua", "Markua"],
    ["mdoc", "mdoc manual page markup"],
    ["mediawiki", "MediaWiki markup"],
    ["ms", "roff ms"],
    ["muse", "Muse"],
    ["native", "native Haskell"],
    ["odt", "OpenDocument text"],
    ["opendocument", "OpenDocument XML"],
    ["opml", "OPML"],
    ["org", "Emacs Org mode"],
    ["pdf", "PDF via Typst"],
    ["plain", "plain text"],
    ["pod", "Perl POD"],
    ["pptx", "PowerPoint"],
    ["revealjs", "reveal.js HTML slides"],
    ["ris", "RIS bibliography"],
    ["rst", "reStructuredText"],
    ["rtf", "Rich Text Format"],
    ["s5", "S5 HTML slides"],
    ["slideous", "Slideous HTML slides"],
    ["slidy", "Slidy HTML slides"],
    ["t2t", "txt2tags"],
    ["tei", "TEI Simple"],
    ["texinfo", "GNU Texinfo"],
    ["textile", "Textile"],
    ["tikiwiki", "TikiWiki markup"],
    ["tsv", "TSV table"],
    ["twiki", "TWiki markup"],
    ["typst", "Typst"],
    ["vimdoc", "Vimdoc"],
    ["vimwiki", "Vimwiki"],
    ["xlsx", "Excel spreadsheet"],
    ["xml", "Pandoc AST (XML)"],
    ["xwiki", "XWiki markup"],
    ["zimwiki", "ZimWiki markup"]
  ]);

  static formatExtensions: Map<string, string> = new Map([
    ["html", "html"],
    ["html5", "html"],
    ["html4", "html"],
    ["chunkedhtml", "zip"],
    ["markdown", "md"],
    ["markdown_strict", "md"],
    ["markdown_mmd", "md"],
    ["markdown_phpextra", "md"],
    ["markdown_github", "md"],
    ["gfm", "md"],
    ["commonmark", "md"],
    ["commonmark_x", "md"],
    ["latex", "tex"],
    ["beamer", "tex"],
    ["context", "tex"],
    ["pdf", "pdf"],
    ["docx", "docx"],
    ["odt", "odt"],
    ["epub", "epub"],
    ["epub2", "epub"],
    ["epub3", "epub"],
    ["rst", "rst"],
    ["org", "org"],
    ["plain", "txt"],
    ["json", "json"],
    ["native", "native"],
    ["docbook", "xml"],
    ["docbook4", "xml"],
    ["docbook5", "xml"],
    ["jats", "xml"],
    ["tei", "xml"],
    ["bits", "xml"],
    ["jats_archiving", "xml"],
    ["jats_articleauthoring", "xml"],
    ["jats_publishing", "xml"],
    ["xml", "xml"],
    ["man", "1"],
    ["rtf", "rtf"],
    ["textile", "textile"],
    ["mediawiki", "wiki"],
    ["asciidoc", "adoc"],
    ["asciidoctor", "adoc"],
    ["asciidoc_legacy", "adoc"],
    ["revealjs", "html"],
    ["slidy", "html"],
    ["slideous", "html"],
    ["dzslides", "html"],
    ["s5", "html"],
    ["ipynb", "ipynb"],
    ["typst", "typ"],
    ["texinfo", "texi"],
    ["ms", "ms"],
    ["icml", "icml"],
    ["opml", "opml"],
    ["bibtex", "bib"],
    ["biblatex", "bib"],
    ["csljson", "json"],
    ["pptx", "pptx"],
    ["djot", "dj"],
    ["fb2", "fb2"],
    ["opendocument", "xml"],
    ["vimdoc", "txt"]
  ]);

  /**
   * Writers that can't work in pandoc.wasm: PDF shells out to an external
   * engine (typst/LaTeX) and fails with "createDirectory: does not exist".
   */
  static unsupportedOutputs: Set<string> = new Set(["pdf"]);

  /**
   * Corrections for formats whose extension-derived MIME type is wrong or too
   * generic. Pandoc's AST dumps and markup-specific JSON/XML dialects must not
   * share `application/json` / `application/xml` with generic data: otherwise
   * "CSV -> JSON" picks pandoc's AST writer, and any uploaded .json/.xml file
   * is offered to pandoc's AST readers.
   */
  static mimeOverrides: Map<string, string> = new Map([
    ["org", "text/x-org"],
    ["json", "application/vnd.pandoc+json"],
    ["xml", "application/vnd.pandoc+xml"],
    ["csljson", "application/vnd.citationstyles.csl+json"],
    ["docbook", "application/docbook+xml"],
    ["docbook4", "application/docbook+xml"],
    ["docbook5", "application/docbook+xml"],
    ["jats", "application/jats+xml"],
    ["jats_archiving", "application/jats+xml"],
    ["jats_articleauthoring", "application/jats+xml"],
    ["jats_publishing", "application/jats+xml"],
    ["bits", "application/jats+xml"],
    ["tei", "application/tei+xml"],
    ["opendocument", "application/vnd.oasis.opendocument.text-flat-xml"]
  ]);

  /** User-facing format IDs, distinct from the generic data formats. */
  static formatIds: Map<string, string> = new Map([
    ["json", "pandoc-json"],
    ["xml", "pandoc-xml"]
  ]);

  public name: string = "pandoc";
  public supportedFormats?: FileFormat[];
  public ready: boolean = false;

  private query?: (options: any) => Promise<any>;
  private convert?: (options: any, stdin: any, files: any) => Promise<{
    stdout: string;
    stderr: string;
    warnings: any;
  }>;

  async init () {
    const { query, convert } = await import("./pandoc/pandoc.js");
    this.query = query;
    this.convert = convert;

    const inputFormats: string[] = await query({ query: "input-formats" });
    const outputFormats: string[] = await query({ query: "output-formats" });

    const allFormats = new Set(inputFormats);
    outputFormats.forEach(format => allFormats.add(format));

    this.supportedFormats = [];
    for (const format of allFormats) {
      const name = pandocHandler.formatNames.get(format) || format;
      const extension = pandocHandler.formatExtensions.get(format) || format;
      this.supportedFormats.push({
        name,
        format: pandocHandler.formatIds.get(format) || format,
        extension,
        mime: normalizeMimeType(
          pandocHandler.mimeOverrides.get(format) || mime.getType(extension) || `text/${format}`
        ),
        from: inputFormats.includes(format),
        to: outputFormats.includes(format) && !pandocHandler.unsupportedOutputs.has(format),
        internal: format
      });
    }

    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    if (
      !this.ready
      || !this.query
      || !this.convert
    ) throw "Handler not initialized.";

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {

      // Fixed name: user file names could collide with the output entry.
      const inputName = `input.${inputFormat.extension}`;
      const files: Record<string, Blob> = {
        [inputName]: new Blob([inputFile.bytes as BlobPart])
      };

      // chunkedhtml writes a directory unless the output name ends in .zip.
      const outputName = outputFormat.internal === "chunkedhtml" ? "output.zip" : "output";

      const { stderr } = await this.convert({
        from: inputFormat.internal,
        to: outputFormat.internal,
        "input-files": [inputName],
        "output-file": outputName,
        // Without this pandoc emits body fragments: RTF without the {\rtf1}
        // header, LaTeX without \documentclass, HTML without a charset.
        standalone: true,
        "embed-resources": ["html", "html4", "html5"].includes(outputFormat.internal)
      }, null, files);

      if (stderr) throw stderr;

      const outputBlob = files[outputName];
      if (!(outputBlob instanceof Blob)) throw `pandoc produced no output for ${inputFile.name}.`;

      const arrayBuffer = await outputBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const name = replaceExtension(inputFile.name, outputFormat.extension);

      outputFiles.push({ bytes, name });

    }

    return outputFiles;
  }

}

export default pandocHandler;
