import { execFile } from "node:child_process";
import { app } from "electron";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OCRBlock = {
  id: string;
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisualAnnotation = {
  color: "red" | "green";
  shape: "rectangle";
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  regionText: string[];
  position: string;
  enclosedBlockIds: string[];
  enclosedText: string[];
  nearbyText: string[];
};

export type VisionAnalysis = {
  schemaVersion: 2;
  adapter: string;
  success: boolean;
  imageId: string;
  fileName: string;
  image: { width: number; height: number };
  ocr: {
    fullText: string;
    blocks: OCRBlock[];
  };
  annotations: VisualAnnotation[];
  productAttributes: Record<string, string>;
  logoCandidates: string[];
  risks: string[];
  suggestions: string[];
  error?: string;
};

export type VisionInput = {
  id: string;
  fileName: string;
  filePath: string;
};

export interface VisionAdapter {
  readonly name: string;
  analyze(input: VisionInput): Promise<VisionAnalysis>;
}

class MacOSVisionAdapter implements VisionAdapter {
  readonly name = "macos-vision";

  async analyze(input: VisionInput): Promise<VisionAnalysis> {
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, "vision-ocr.swift")
      : path.join(app.getAppPath(), "src", "main", "advisor", "vision-ocr.swift");
    const { stdout } = await execFileAsync(
      "/usr/bin/swift",
      [scriptPath, input.filePath],
      { maxBuffer: 8 * 1024 * 1024, timeout: 90_000 }
    );
    const parsed = JSON.parse(stdout) as {
      width?: number;
      height?: number;
      blocks?: OCRBlock[];
      annotations?: Array<
        Omit<VisualAnnotation, "position" | "enclosedBlockIds" | "enclosedText" | "nearbyText">
      >;
    };
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    return structureAnalysis(
      input,
      this.name,
      blocks,
      parsed.annotations ?? [],
      { width: parsed.width ?? 0, height: parsed.height ?? 0 }
    );
  }
}

class UnavailableVisionAdapter implements VisionAdapter {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  async analyze(): Promise<VisionAnalysis> {
    throw new Error(`视觉适配器不可用：${this.name}`);
  }
}

export function createVisionAdapter(): VisionAdapter {
  const configured =
    process.env.DEEPSEEK_CODEX_VISION_ADAPTER?.trim() || "macos-vision";
  if (configured === "macos-vision") return new MacOSVisionAdapter();
  return new UnavailableVisionAdapter(configured);
}

export function failureAnalysis(
  input: VisionInput,
  adapter: string,
  error: unknown
): VisionAnalysis {
  return {
    schemaVersion: 2,
    adapter,
    success: false,
    imageId: input.id,
    fileName: input.fileName,
    image: { width: 0, height: 0 },
    ocr: { fullText: "", blocks: [] },
    annotations: [],
    productAttributes: {},
    logoCandidates: [],
    risks: ["视觉分析失败，不能据此判断商品合规性。"],
    suggestions: ["检查视觉服务配置后重试；文本任务仍可继续。"],
    error: error instanceof Error ? error.message : String(error)
  };
}

function structureAnalysis(
  input: VisionInput,
  adapter: string,
  blocks: OCRBlock[],
  rawAnnotations: Array<
    Omit<VisualAnnotation, "position" | "enclosedBlockIds" | "enclosedText" | "nearbyText">
  >,
  image: { width: number; height: number }
): VisionAnalysis {
  const lines = blocks.map((block) => block.text.trim()).filter(Boolean);
  const fullText = lines.join("\n");
  const productAttributes: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([^:：]{1,32})[:：]\s*(.{1,160})$/);
    if (match) productAttributes[match[1].trim()] = match[2].trim();
  }

  const logoCandidates = lines
    .filter(
      (line) =>
        line.length >= 2 &&
        line.length <= 32 &&
        !line.includes(":") &&
        !line.includes("：") &&
        /[A-Za-z\u4e00-\u9fff]/.test(line)
    )
    .slice(0, 3);

  const risks: string[] = [];
  const riskRules: Array<[RegExp, string]> = [
    [/(battery|电池|锂电)/i, "可能涉及电池运输与危险品申报要求。"],
    [/(food|食品|nutrition|成分)/i, "可能涉及食品标签、成分和目的国准入要求。"],
    [/(medical|药|医疗|治疗|cure)/i, "可能包含医疗或功效宣称，需要核查合规证据。"],
    [/(child|children|儿童|婴儿|toy|玩具)/i, "可能适用儿童产品或玩具安全标准。"],
    [/(flammable|易燃|aerosol)/i, "可能属于易燃或受限运输商品。"]
  ];
  for (const [pattern, message] of riskRules) {
    if (pattern.test(fullText)) risks.push(message);
  }
  if (risks.length === 0) {
    risks.push("仅凭图片未发现明确高风险关键词，仍需结合销售国家和商品资料复核。");
  }

  const suggestions = [
    blocks.length
      ? "核对 OCR 文本与实物包装，避免识别误差进入商品详情。"
      : "图片中未识别到清晰文字，建议上传更高分辨率的正面包装图。",
    logoCandidates.length
      ? "核查 Logo/品牌候选的商标授权与销售区域。"
      : "补充品牌或 Logo 特写图，便于知识产权检查。",
    Object.keys(productAttributes).length
      ? "将识别出的属性与后台商品字段逐项校验。"
      : "补充包含型号、材质、尺寸、产地等字段的标签图。"
  ];
  const annotations = rawAnnotations.map((annotation) => {
    const enclosed = blocks.filter((block) => containment(annotation, block) >= 0.55);
    const nearby = blocks
      .filter((block) => !enclosed.includes(block) && distance(annotation, block) <= 0.08)
      .sort((a, b) => distance(annotation, a) - distance(annotation, b))
      .slice(0, 5);
    return {
      ...annotation,
      position: pagePosition(annotation),
      enclosedBlockIds: enclosed.map((block) => block.id),
      enclosedText: uniqueStrings([
        ...annotation.regionText,
        ...enclosed.map((block) => block.text)
      ]),
      nearbyText: nearby.map((block) => block.text)
    };
  });

  return {
    schemaVersion: 2,
    adapter,
    success: true,
    imageId: input.id,
    fileName: input.fileName,
    image,
    ocr: { fullText, blocks },
    annotations,
    productAttributes,
    logoCandidates,
    risks,
    suggestions
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function containment(annotation: Pick<VisualAnnotation, "x" | "y" | "width" | "height">, block: OCRBlock) {
  const left = Math.max(annotation.x, block.x);
  const bottom = Math.max(annotation.y, block.y);
  const right = Math.min(annotation.x + annotation.width, block.x + block.width);
  const top = Math.min(annotation.y + annotation.height, block.y + block.height);
  const overlap = Math.max(0, right - left) * Math.max(0, top - bottom);
  return overlap / Math.max(block.width * block.height, Number.EPSILON);
}

function distance(annotation: Pick<VisualAnnotation, "x" | "y" | "width" | "height">, block: OCRBlock) {
  const ax = annotation.x + annotation.width / 2;
  const ay = annotation.y + annotation.height / 2;
  const bx = block.x + block.width / 2;
  const by = block.y + block.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function pagePosition(annotation: Pick<VisualAnnotation, "x" | "y" | "width" | "height">) {
  const horizontal = annotation.x + annotation.width / 2 < 0.34
    ? "左侧"
    : annotation.x + annotation.width / 2 > 0.66 ? "右侧" : "中部";
  const vertical = annotation.y + annotation.height / 2 < 0.34
    ? "下方"
    : annotation.y + annotation.height / 2 > 0.66 ? "上方" : "中部";
  return vertical === "中部" ? `页面${horizontal}` : `页面${vertical}${horizontal}`;
}
