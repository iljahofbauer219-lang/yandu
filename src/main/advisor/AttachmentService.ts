import { app, nativeImage } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createVisionAdapter,
  failureAnalysis,
  type VisionAnalysis
} from "./VisionAdapter";

export type AttachmentRecord = {
  id: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  size: number;
  filePath: string;
  thumbnailPath: string;
  previewUrl: string;
  available?: boolean;
};

export type IncomingImage = {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};

const dataRoot = path.join(app.getPath("userData"), "advisor", "attachments");
const maxImageBytes = 15 * 1024 * 1024;

export async function saveIncomingImages(
  sessionId: string,
  images: IncomingImage[]
): Promise<AttachmentRecord[]> {
  validateSessionId(sessionId);
  const existing = await listAttachments(sessionId);
  const saved: AttachmentRecord[] = [];
  for (const image of images) {
    const bytes = Buffer.from(image.bytes);
    if (!image.mimeType.startsWith("image/")) {
      throw new Error(`${image.name} 不是受支持的图片。`);
    }
    if (bytes.length === 0 || bytes.length > maxImageBytes) {
      throw new Error(`${image.name} 的大小无效或超过 15 MB。`);
    }
    const decoded = nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty()) throw new Error(`${image.name} 无法解码。`);

    const id = crypto.randomUUID();
    const extension = safeExtension(image.name, image.mimeType);
    const taskDir = sessionDirectory(sessionId);
    await fs.mkdir(taskDir, { recursive: true });
    const filePath = path.join(taskDir, `${id}${extension}`);
    const thumbnailPath = path.join(taskDir, `${id}.thumb.png`);
    const size = decoded.getSize();
    const width = Math.min(260, Math.max(1, size.width));
    const thumbnail = decoded.resize({ width, quality: "good" }).toPNG();
    await fs.writeFile(filePath, bytes, { mode: 0o600 });
    await fs.writeFile(thumbnailPath, thumbnail, { mode: 0o600 });
    saved.push({
      id,
      sessionId,
      fileName: sanitizeName(image.name),
      mimeType: image.mimeType,
      size: bytes.length,
      filePath,
      thumbnailPath,
      previewUrl: `data:image/png;base64,${thumbnail.toString("base64")}`
    });
  }
  const all = [...existing, ...saved];
  await writeManifest(sessionId, all);
  return all;
}

export async function listAttachments(
  sessionId: string
): Promise<AttachmentRecord[]> {
  validateSessionId(sessionId);
  try {
    const content = await fs.readFile(
      path.join(sessionDirectory(sessionId), "manifest.json"),
      "utf8"
    );
    const records = JSON.parse(content) as AttachmentRecord[];
    return Promise.all(
      records.map(async (record) => {
        try {
          return {
            ...record,
            previewUrl: `data:image/png;base64,${(
              await fs.readFile(record.thumbnailPath)
            ).toString("base64")}`,
            available: true
          };
        } catch {
          return { ...record, previewUrl: "", available: false };
        }
      })
    );
  } catch {
    return [];
  }
}

export async function readAttachmentPreview(sessionId: string, id: string) {
  const records = await listAttachments(sessionId);
  const target = records.find((record) => record.id === id);
  if (!target || !target.available) throw new Error("图片文件已不可用。");
  if (!isWithin(sessionDirectory(sessionId), target.filePath)) {
    throw new Error("附件路径越过任务目录。");
  }
  const bytes = await fs.readFile(target.filePath);
  return `data:${target.mimeType};base64,${bytes.toString("base64")}`;
}

export async function removeAttachmentSession(sessionId: string) {
  validateSessionId(sessionId);
  await fs.rm(sessionDirectory(sessionId), { recursive: true, force: true });
}

export async function cloneAttachmentSession(
  sourceSessionId: string,
  targetSessionId: string
) {
  const records = await listAttachments(sourceSessionId);
  const images: IncomingImage[] = [];
  for (const record of records) {
    if (record.available === false) continue;
    images.push({
      name: record.fileName,
      mimeType: record.mimeType,
      bytes: await fs.readFile(record.filePath)
    });
  }
  return images.length > 0
    ? saveIncomingImages(targetSessionId, images)
    : [];
}

export async function removeAttachment(sessionId: string, id: string) {
  const records = await listAttachments(sessionId);
  const target = records.find((record) => record.id === id);
  if (!target) return false;
  if (
    !isWithin(sessionDirectory(sessionId), target.filePath) ||
    !isWithin(sessionDirectory(sessionId), target.thumbnailPath)
  ) {
    throw new Error("附件路径越过任务目录。");
  }
  await Promise.all([
    fs.unlink(target.filePath).catch(() => undefined),
    fs.unlink(target.thumbnailPath).catch(() => undefined)
  ]);
  await writeManifest(
    sessionId,
    records.filter((record) => record.id !== id)
  );
  return true;
}

export async function analyzeSession(
  sessionId: string
): Promise<VisionAnalysis[]> {
  const records = await listAttachments(sessionId);
  const adapter = createVisionAdapter();
  const analysisPath = path.join(sessionDirectory(sessionId), "analysis.json");
  try {
    const cached = JSON.parse(
      await fs.readFile(analysisPath, "utf8")
    ) as VisionAnalysis[];
    const recordIds = new Set(records.map((record) => record.id));
    if (
      cached.length === records.length &&
      cached.every(
        (result) =>
          result.schemaVersion === 2 &&
          result.adapter === adapter.name &&
          recordIds.has(result.imageId)
      )
    ) {
      return cached;
    }
  } catch {
    // No matching cache; run the configured adapter.
  }
  const results: VisionAnalysis[] = [];
  for (const record of records) {
    const input = {
      id: record.id,
      fileName: record.fileName,
      filePath: record.filePath
    };
    try {
      results.push(await adapter.analyze(input));
    } catch (error) {
      results.push(failureAnalysis(input, adapter.name, error));
    }
  }
  if (records.length > 0) {
    await fs.writeFile(
      analysisPath,
      JSON.stringify(results, null, 2),
      { mode: 0o600 }
    );
  }
  return results;
}

function sessionDirectory(sessionId: string) {
  validateSessionId(sessionId);
  return path.join(dataRoot, sessionId);
}

function validateSessionId(sessionId: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) {
    throw new Error("附件任务编号无效。");
  }
}

function safeExtension(name: string, mimeType: string) {
  const extension = path.extname(name).toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|heic|tiff?|bmp)$/.test(extension)) {
    return extension;
  }
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/tiff": ".tiff",
    "image/bmp": ".bmp"
  };
  return map[mimeType] ?? ".img";
}

function sanitizeName(name: string) {
  return path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 160);
}

function isWithin(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function writeManifest(
  sessionId: string,
  records: AttachmentRecord[]
) {
  const taskDir = sessionDirectory(sessionId);
  await fs.mkdir(taskDir, { recursive: true });
  const persisted = records.map(({ previewUrl: _previewUrl, ...record }) => record);
  await fs.writeFile(
    path.join(taskDir, "manifest.json"),
    JSON.stringify(persisted, null, 2),
    { mode: 0o600 }
  );
}
