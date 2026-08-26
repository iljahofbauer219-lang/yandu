import { spawn } from "node:child_process";
import { app } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AttachmentRecord } from "./AttachmentService";

const maxImagesPerTurn = 4;

export type MultimodalVisionResult = {
  imageId: string;
  fileName: string;
  adapter: "codex-vision-sidecar";
  success: boolean;
  description: string;
  error?: string;
};

export async function describeAttachments(
  attachments: AttachmentRecord[],
  userRequest: string
): Promise<MultimodalVisionResult[]> {
  const results: MultimodalVisionResult[] = [];
  // 文档（PDF/DOCX/...）走 documentContext 路径抽取纯文本,这里只把图片交给 vision-sidecar。
  // 默认 kind 为 image,以兼容旧的 manifest 记录（重构前没有 kind 字段）。
  for (const attachment of attachments
    .filter((item) => item.available)
    .filter((item) => (item.kind ?? "image") === "image")
    .slice(0, maxImagesPerTurn)) {
    results.push(await describeAttachment(attachment, userRequest));
  }
  return results;
}

async function describeAttachment(
  attachment: AttachmentRecord,
  userRequest: string
): Promise<MultimodalVisionResult> {
  const outputPath = path.join(
    os.tmpdir(),
    `yandu-advisor-vision-${attachment.id}.txt`
  );
  const prompt = [
    "只分析附加图片，不使用工具，不读取其他文件。",
    "详细、客观地描述图片中与用户问题有关的内容。",
    "必须识别页面布局、UI 元素、颜色标注框、框内文字和框之间的关系。",
    "逐字转录重要可见文字；无法确认的内容要明确标注不确定，不要要求用户重新描述图片。",
    `用户问题：${userRequest.slice(0, 1200)}`
  ].join("\n");
  const codexBinary = app.isPackaged
    ? path.join(process.resourcesPath, "codex")
    : "/Applications/ChatGPT.app/Contents/Resources/codex";
  try {
    await runCodexVision(
      codexBinary,
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-C",
        path.dirname(attachment.filePath),
        "-m",
        "gpt-5.6-luna",
        "-i",
        attachment.filePath,
        "-o",
        outputPath,
        "--",
        prompt
      ]
    );
    const description = (await fs.readFile(outputPath, "utf8")).trim();
    if (!description) throw new Error("视觉模型未返回描述。");
    return {
      imageId: attachment.id,
      fileName: attachment.fileName,
      adapter: "codex-vision-sidecar",
      success: true,
      description
    };
  } catch (error) {
    return {
      imageId: attachment.id,
      fileName: attachment.fileName,
      adapter: "codex-vision-sidecar",
      success: false,
      description: "",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await fs.unlink(outputPath).catch(() => undefined);
  }
}

function runCodexVision(binary: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      env: {
        HOME: process.env.HOME ?? "/Users/zyc",
        USER: process.env.USER ?? "zyc",
        CODEX_HOME: path.join(
          process.env.HOME ?? "/Users/zyc",
          ".codex"
        ),
        PATH:
          "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost"
      },
      stdio: ["pipe", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 16_000) stderr += chunk;
    });
    // Codex appends piped stdin to the prompt. Closing it immediately prevents
    // the packaged app from waiting forever for additional input.
    child.stdin.end();
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("视觉模型在 180 秒内没有完成分析。"));
    }, 180_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `视觉模型退出（code=${code ?? "null"}, signal=${signal ?? "null"}）${
              stderr.trim() ? `：${stderr.trim().slice(-2000)}` : ""
            }`
          )
        );
      }
    });
  });
}
