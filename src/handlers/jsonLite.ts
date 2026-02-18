import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import * as yaml from "@std/yaml";

function parseXML(text: string): any {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");

  function nodeToObj(node: Node): any {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent?.trim();
      return t || undefined;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return undefined;

    const el = node as Element;
    const obj: any = { _tag: el.tagName };

    if (el.attributes.length) {
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        obj[attr.name] = attr.value;
      }
    }

    const children: any[] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = nodeToObj(el.childNodes[i]);
      if (child !== undefined) children.push(child);
    }
    obj._children = children;
    return obj;
  }

  return nodeToObj(doc.documentElement);
}

export class toJsonHandler implements FormatHandler {
  public name: string = "tojson";
  public ready: boolean = true;

  public supportedFormats: FileFormat[] = [
    {
      name: "Comma Separated Values",
      format: "csv",
      extension: "csv",
      mime: "text/csv",
      from: true,
      to: false,
      internal: "csv"
    },
    {
      name: "Extensible Markup Language",
      format: "xml",
      extension: "xml",
      mime: "application/xml",
      from: true,
      to: false,
      internal: "xml"
    },
    {
      name: "YAML Ain't Markup Language",
      format: "yaml",
      extension: "yml",
      mime: "application/yaml",
      from: true,
      to: false,
      internal: "yaml"
    },
    {
      name: "JavaScript Object Notation",
      format: "json",
      extension: "json",
      mime: "application/json",
      from: false,
      to: true,
      internal: "json"
    },
  ];

  async init() {
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    _outputFormat: FileFormat,
  ): Promise<FileData[]> {
    return inputFiles.map(file => {
      const name = file.name.split(".")[0] + ".json";
      const text = new TextDecoder().decode(file.bytes);
      let object: any;
      switch (inputFormat.mime) {
        case "text/csv": {
          const data = text.split(/\r?\n/).map(x => {
            const arr = [...x.matchAll(/(?:(?:"(?:[^"]|"")*")|[^,]*)(?:,|$)/g)].map(([x]) => {
              if (x.endsWith(",")) x = x.substring(0, x.length - 1);
              if (x.endsWith("\"")) x = x.substring(1, x.length - 1);
              return x;
            });
            arr.pop();
            return arr;
          });
          data.pop();
          const keys = data.shift() ?? [];
          object = [];
          for (const entry of data) {
            const jsonEntry: any = {};
            for (let i = 0; i < entry.length; i++) {
              jsonEntry[i < keys.length ? keys[i] : `column${i + 1}`] = entry[i];
            }
            object.push(jsonEntry);
          }
          break;
        }
        case "application/xml":
          object = parseXML(text);
          break;
        case "application/yaml":
          object = yaml.parse(text);
          break;
        default:
          throw new Error("Unsupported input format");
      }
      return {
        name,
        bytes: new TextEncoder().encode(JSON.stringify(object))
      };
    });
  }
}

export class fromJsonHandler implements FormatHandler {
  public name: string = "fromjson";
  public ready: boolean = true;

  public supportedFormats: FileFormat[] = [
    {
      name: "Comma Separated Values",
      format: "csv",
      extension: "csv",
      mime: "text/csv",
      from: false,
      to: true,
      internal: "csv"
    },
    {
      name: "Extensible Markup Language",
      format: "xml",
      extension: "xml",
      mime: "application/xml",
      from: false,
      to: true,
      internal: "xml"
    },
    {
      name: "YAML Ain't Markup Language",
      format: "yaml",
      extension: "yml",
      mime: "application/yaml",
      from: false,
      to: true,
      internal: "yaml"
    },
    {
      name: "JavaScript Object Notation",
      format: "json",
      extension: "json",
      mime: "application/json",
      from: true,
      to: false,
      internal: "json"
    },
  ];

  async init() {
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    _inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    return inputFiles.map(file => {
      const name = file.name.split(".")[0] + "." + outputFormat.extension;
      const object = JSON.parse(new TextDecoder().decode(file.bytes));
      let text = "";
      switch (outputFormat.mime) {
        case "text/csv": {
          function csvEscape(str: string): string {
            if (str.includes(",") || str.includes("\""))
              return `"${str.replaceAll("\"", "\"\"")}"`;
            return str;
          }
          let arr = object;
          if (!Array.isArray(arr)) {
            const newArr: any[] = [];
            for (const [k, v] of Object.entries(object)) {
              if (v != null && typeof v === "object" && !Array.isArray(v)) {
                (v as any)._key = k;
                newArr.push(v);
              } else {
                newArr.push({ _key: k, _value: v });
              }
            }
            arr = newArr;
          }
          const keySet = new Set<string>();
          for (const value of arr) {
            if (typeof value !== "object" || Array.isArray(value)) {
              keySet.add("_value");
              continue;
            }
            for (const key of Object.keys(value)) {
              if (!keySet.has(key)) keySet.add(key);
            }
          }
          const keys = [...keySet].sort();
          text += keys.map(x => csvEscape(x)).join(",") + "\n";
          for (const value of arr) {
            text += keys.map(key => {
              if (key === "_value" && (typeof value !== "object" || Array.isArray(value)))
                return value;
              return value[key] ?? "";
            }).map(x => csvEscape(typeof x === "string" ? x : JSON.stringify(x))).join(",") + "\n";
          }
          break;
        }
        case "application/xml": {
          function xmlEscape(str: string): string {
            return str
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll("\"", "&quot;")
              .replaceAll("'", "&apos;");
          }
          function write(value: any, tagName: string | null = null) {
            if (tagName != null) tagName = xmlEscape(tagName);
            if (typeof value !== "object" || value === null) {
              const str = xmlEscape(typeof value === "string" ? value : JSON.stringify(value));
              if (tagName != null) text += `<${tagName}>${str}</${tagName}>`;
              else text += str;
              return;
            }
            if (Array.isArray(value)) {
              tagName ??= "Array";
              text += `<${tagName}>`;
              for (const item of value) write(item, "Item");
              text += `</${tagName}>`;
              return;
            }
            const isXMLTag = typeof value._tag === "string" && Array.isArray(value._children);
            if (isXMLTag) tagName ??= value._tag;
            tagName ??= "Object";
            text += `<${tagName}>`;
            for (const [k, v] of Object.entries(value)) {
              if (isXMLTag && (k === "_tag" || k === "_children")) continue;
              write(v, k);
            }
            if (isXMLTag) {
              for (const child of value._children) write(child);
            }
            text += `</${tagName}>`;
          }
          write(object);
          break;
        }
        case "application/yaml":
          text = yaml.stringify(object);
          break;
        default:
          throw new Error("Unsupported output format");
      }
      return {
        name,
        bytes: new TextEncoder().encode(text)
      };
    });
  }
}
