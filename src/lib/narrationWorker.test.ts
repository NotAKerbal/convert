import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { NarrationWorkerMessage, NarrationWorkerRequest } from "../handlers/narration.worker.ts";

test("narration retries after a failed CPU fallback download", { timeout: 5000 }, async (t) => {
  t.mock.method(console, "warn", () => {});
  // Exercise the actual worker with deterministic GPU and download failures.
  // No model downloads or GPU hardware are required for this recovery check.
  const mockUrl = `data:text/javascript,${encodeURIComponent(`
    export const env = {};
    export const loads = [];
    export const KokoroTTS = {
      async from_pretrained(_id, { device }) {
        loads.push(device);
        if (device === "wasm" && loads.length === 2) throw new Error("Download interrupted");
        const tokenizer = () => ({ input_ids: { dims: [1, 10] } });
        tokenizer.model_max_length = 512;
        return {
          tokenizer,
          async generate() {
            if (device === "webgpu") throw new Error("GPU inference failed");
            return { audio: new Float32Array([0.25, -0.25]) };
          },
        };
      },
    };
  `)}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "kokoro-js") return { url: mockUrl, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let receive!: (event: { data: NarrationWorkerRequest }) => void;
  let finish!: (message: NarrationWorkerMessage) => void;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { requestAdapter: async () => ({}) } },
  });
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      location: { origin: "https://narration.test" },
      addEventListener(_type: string, listener: typeof receive) { receive = listener; },
      postMessage(message: NarrationWorkerMessage) {
        if (message.type === "error" || message.type === "done") finish(message);
      },
    },
  });
  try {
    await import("../handlers/narration.worker.ts");
    const request = (id: number) => new Promise<NarrationWorkerMessage>((resolve) => {
      finish = resolve;
      receive({ data: { type: "speak", id, chunks: [{ text: "Hello.", pauseAfterMs: 0 }] } });
    });
    assert.deepEqual(await request(1), { type: "error", id: 1, message: "Download interrupted" });
    const retried = await request(2);
    assert.equal(retried.type, "done");
    if (retried.type !== "done") assert.fail("The second narration should recover");
    assert.equal(retried.device, "wasm");
    assert.deepEqual(Array.from(retried.samples), [0.25, -0.25]);
    const { loads } = await import(mockUrl);
    assert.deepEqual(loads, ["webgpu", "wasm", "webgpu", "wasm"]);
  } finally {
    hooks.deregister();
    if (originalSelf) Object.defineProperty(globalThis, "self", originalSelf);
    else Reflect.deleteProperty(globalThis, "self");
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
