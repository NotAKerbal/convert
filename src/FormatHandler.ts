export interface FileFormat {
  /** Format description (long name) for displaying to the user. */
  name: string;
  /** Short, "formal" name for displaying to the user. */
  format: string;
  /** File extension. */
  extension: string;
  /** MIME type. */
  mime: string;
  /** Whether conversion **from** this format is supported. */
  from: boolean;
  /** Whether conversion **to** this format is supported. */
  to: boolean;
  /** Format identifier for the handler's internal reference. */
  internal: string;
}

export interface FileData {
  /** File name with extension. */
  name: string;
  /**
   * File contents in bytes.
   *
   * **Please note:** _handlers_ are responsible for ensuring the lifetime
   * and consistency of this buffer. If you're not sure that your handler
   * won't modify it, wrap it in `new Uint8Array()`.
   */
  readonly bytes: Uint8Array;
}

/**
 * Establishes a common interface for converting between file formats.
 * Often a "wrapper" for existing tools.
 */
export interface FormatHandler {
  /** Name of the tool being wrapped (e.g. "FFmpeg"). */
  name: string;
  /** List of supported input/output {@link FileFormat}s. */
  supportedFormats?: FileFormat[];

  /** Whether the handler supports input of any type.
   * Conversion using this handler will be performed only if no other direct conversion is found.
   */
  supportAnyInput?: boolean;

  /**
   * Optional sink for human-readable progress from long-running handlers
   * (model downloads, OCR, speech synthesis). The conversion engine sets it
   * for the duration of {@link doConvert} and clears it afterwards.
   */
  onProgress?: (message: string) => void;

  /**
   * Whether the handler is ready for use. Should be set in {@link init}.
   * If true, {@link doConvert} is expected to work.
   */
  ready: boolean;
  /**
   * Initializes the handler if necessary.
   * Should set {@link ready} to true.
   */
  init: () => Promise<void>;
  /**
   * Performs the actual file conversion.
   * @param inputFiles Array of {@link FileData} entries, one per input file.
   * @param inputFormat Input {@link FileFormat}, the same for all inputs.
   * @param outputFormat Output {@link FileFormat}, the same for all outputs.
   * @param args Optional arguments as a string array.
   * Can be used to perform recursion with different settings.
   * @returns Array of {@link FileData} entries, one per generated output file.
   */
  doConvert: (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    args?: string[]
  ) => Promise<FileData[]>;
}

/**
 * A failure that should end the whole conversion instead of letting the route
 * search fall back to a different (usually much less meaningful) route. For
 * example, if narration can't find any text in an image, the user should see
 * that error rather than a spectrogram "sound" of the pixels.
 */
export class FatalConversionError extends Error {
  readonly fatal = true;
  constructor(message: string) {
    super(message);
    this.name = "FatalConversionError";
  }
}

export class ConvertPathNode {
  public handler: FormatHandler;
  public format: FileFormat;
  constructor(handler: FormatHandler, format: FileFormat) {
    this.handler = handler;
    this.format = format;
  }
}
