import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

import { canvasToBytes, mimeLacksAlpha, replaceExtension } from "./handlerUtils.ts";

class threejsHandler implements FormatHandler {

  public name: string = "threejs";
  public supportedFormats = [
    {
      name: "GL Transmission Format Binary",
      format: "glb",
      extension: "glb",
      mime: "model/gltf-binary",
      from: true,
      to: false,
      internal: "glb"
    },
    {
      name: "Portable Network Graphics",
      format: "png",
      extension: "png",
      mime: "image/png",
      from: false,
      to: true,
      internal: "png"
    },
    {
      name: "Joint Photographic Experts Group JFIF",
      format: "jpeg",
      extension: "jpg",
      mime: "image/jpeg",
      from: false,
      to: true,
      internal: "jpeg"
    },
    {
      name: "WebP",
      format: "webp",
      extension: "webp",
      mime: "image/webp",
      from: false,
      to: true,
      internal: "webp"
    },
  ];
  public ready: boolean = false;

  static width = 960;
  static height = 540;

  private renderer?: THREE.WebGLRenderer;

  async init () {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      });
      this.renderer.setSize(threejsHandler.width, threejsHandler.height);
    }
    this.ready = true;
  }

  /** Releases GPU resources held by a loaded model. */
  static dispose (root: THREE.Object3D) {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
  }

  async doConvert (
    inputFiles: FileData[],
    _inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    if (!this.renderer) await this.init();
    const renderer = this.renderer!;
    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {

      // Parse straight from memory: no object URL to leak, nothing fetched.
      const buffer = inputFile.bytes.buffer.slice(
        inputFile.bytes.byteOffset,
        inputFile.bytes.byteOffset + inputFile.bytes.byteLength
      ) as ArrayBuffer;
      const gltf: GLTF = await new Promise((resolve, reject) => {
        new GLTFLoader().parse(buffer, "", resolve, reject);
      });

      const scene = new THREE.Scene();
      // glTF uses physically based materials, which render black without light.
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
      const sun = new THREE.DirectionalLight(0xffffff, 2);
      sun.position.set(1, 2, 3);
      scene.add(sun);
      scene.add(gltf.scene);

      // Frame the model's bounding sphere from the front, slightly above.
      const camera = new THREE.PerspectiveCamera(
        45, threejsHandler.width / threejsHandler.height, 0.01, 1e7
      );
      const bbox = new THREE.Box3().setFromObject(gltf.scene);
      const sphere = bbox.getBoundingSphere(new THREE.Sphere());
      if (bbox.isEmpty() || !Number.isFinite(sphere.radius) || sphere.radius <= 0) {
        threejsHandler.dispose(gltf.scene);
        throw `${inputFile.name} contains no visible geometry.`;
      }
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const distance = sphere.radius / Math.sin(Math.min(vFov, hFov) / 2);
      const direction = new THREE.Vector3(0, 0.35, 1).normalize();
      camera.position.copy(sphere.center).addScaledVector(direction, distance * 1.1);
      camera.near = Math.max(distance / 1000, 1e-4);
      camera.far = distance * 10;
      camera.updateProjectionMatrix();
      camera.lookAt(sphere.center);
      sun.position.copy(camera.position).add(new THREE.Vector3(distance, distance, 0));

      // JPEG has no alpha: render on white. PNG/WebP keep a transparent background.
      if (mimeLacksAlpha(outputFormat.mime)) renderer.setClearColor(0xffffff, 1);
      else renderer.setClearColor(0x000000, 0);
      renderer.render(scene, camera);

      try {
        const bytes = await canvasToBytes(renderer.domElement, outputFormat.mime);
        outputFiles.push({ bytes, name: replaceExtension(inputFile.name, outputFormat.extension) });
      } finally {
        threejsHandler.dispose(gltf.scene);
        renderer.renderLists.dispose();
      }

    }

    return outputFiles;
  }

}

export default threejsHandler;