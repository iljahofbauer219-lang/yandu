import path from "node:path";

export type CommandPolicy =
  | {
      action: "auto";
      reason: string;
      outsideTargets: string[];
      outsideReadRoots: string[];
      allowRemember: false;
    }
  | {
      action: "approve";
      reason: string;
      outsideTargets: string[];
      outsideReadRoots: string[];
      allowRemember: boolean;
    };

const destructivePattern =
  /\b(?:rm|rmdir|unlink|shred)\b|\bfind\b[\s\S]*\s-delete\b|\bgit\s+(?:clean|push)\b|\bgit\s+reset\s+--hard\b/i;
const systemPattern =
  /\b(?:sudo|chown|chmod|launchctl|systemsetup|csrutil|diskutil)\b|\bdefaults\s+write\b|\bsecurity\s+(?:add|delete|set|unlock|import)\b/i;
const publishPattern =
  /\b(?:npm|pnpm|yarn)\s+publish\b|\b(?:docker|podman)\s+push\b|\b(?:kubectl|helm)\s+(?:apply|delete|install|upgrade)\b|\b(?:vercel|firebase|netlify)\s+(?:deploy|--prod)\b|\bscp\b|\brsync\b[\s\S]*\w+@/i;
const globalInstallPattern =
  /\b(?:npm|pnpm|yarn)\s+(?:install|add)\b[\s\S]*(?:\s-g\b|--global\b)|\bbrew\s+(?:install|uninstall|upgrade)\b|\bpip3?\s+install\b/i;
const uploadPattern =
  /\bcurl\b[\s\S]*(?:--upload-file|-T\b|-F\b|--data-binary\b)/i;
const mutatingPattern =
  /\b(?:cp|mv|mkdir|touch|truncate|install|tee)\b|\bsed\s+-i\b|\bperl\s+-i\b|\bgit\s+(?:add|commit|checkout|switch|restore|merge|rebase|tag)\b|\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|update|upgrade)\b/i;

const readOnlyCommands = new Set([
  "cat",
  "cd",
  "df",
  "diff",
  "du",
  "echo",
  "file",
  "find",
  "git",
  "grep",
  "head",
  "ls",
  "lsof",
  "pgrep",
  "printf",
  "ps",
  "pwd",
  "readlink",
  "realpath",
  "rg",
  "stat",
  "tail",
  "test",
  "type",
  "wc",
  "which"
]);

export function classifyCommand(
  command: string,
  workspacePath: string
): CommandPolicy {
  const outsideTargets = findOutsideWorkspacePaths(command, workspacePath);
  const outsideReadRoots = outsideTargets.map(outsideApprovalRoot);

  if (
    destructivePattern.test(command) ||
    systemPattern.test(command) ||
    publishPattern.test(command) ||
    globalInstallPattern.test(command) ||
    uploadPattern.test(command)
  ) {
    return {
      action: "approve",
      reason: "删除、系统修改、安装或发布操作需要每次确认",
      outsideTargets,
      outsideReadRoots: [],
      allowRemember: false
    };
  }

  if (outsideTargets.length > 0) {
    if (isReadOnlyCommand(command)) {
      return {
        action: "approve",
        reason: `需要只读访问当前项目外的目录：${outsideReadRoots.join("、")}`,
        outsideTargets,
        outsideReadRoots,
        allowRemember: true
      };
    }
    return {
      action: "approve",
      reason: `操作可能修改当前项目之外的内容：${outsideTargets.join("、")}`,
      outsideTargets,
      outsideReadRoots: [],
      allowRemember: false
    };
  }

  return {
    action: "auto",
    reason: "项目内安全操作已自动执行",
    outsideTargets: [],
    outsideReadRoots: [],
    allowRemember: false
  };
}

export function isApprovedOutsideRead(
  approvedRoots: Iterable<string>,
  requestedRoots: string[]
) {
  const approved = [...approvedRoots];
  return (
    requestedRoots.length > 0 &&
    requestedRoots.every((requested) =>
      approved.some((root) => isPathWithin(root, requested))
    )
  );
}

export function isDestructiveFileDiff(diff: string) {
  return (
    /\*\*\*\s+Delete File:/i.test(diff) ||
    /^deleted file mode\b/im.test(diff) ||
    /^\+\+\+\s+\/dev\/null\b/im.test(diff)
  );
}

export function findOutsideWorkspacePaths(
  command: string,
  workspacePath: string
) {
  const targets = new Set<string>();
  const quotedPattern =
    /(["'])(\/(?:Users|Applications|Library|System|etc|var|tmp|opt|private)(?:\/[^"';&|<>，。！？、,]*)?)\1/g;
  for (const match of command.matchAll(quotedPattern)) {
    const candidate = normalizeCommandPath(match[2]);
    if (path.isAbsolute(candidate) && !isPathWithin(workspacePath, candidate)) {
      targets.add(candidate);
    }
  }
  const absolutePattern =
    /\/(?:Users|Applications|Library|System|etc|var|tmp|opt|private)(?:\/(?:\\ |[^\s\n\r"';&|<>，。！？、,])*)?/g;
  for (const match of command.matchAll(absolutePattern)) {
    const preceding = match.index === undefined ? "" : command[match.index - 1];
    if (preceding === '"' || preceding === "'") continue;
    const candidate = normalizeCommandPath(match[0]);
    if (path.isAbsolute(candidate) && !isPathWithin(workspacePath, candidate)) {
      targets.add(candidate);
    }
  }
  for (const match of command.matchAll(/(?:^|[\s'"])(\.\.\/[^\s'";&|<>]+)/g)) {
    const candidate = path.resolve(workspacePath, normalizeCommandPath(match[1]));
    if (!isPathWithin(workspacePath, candidate)) targets.add(candidate);
  }
  return [...targets];
}

export function isPathWithin(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function outsideApprovalRoot(target: string) {
  const normalized = path.normalize(target);
  const appIndex = normalized.indexOf(".app/");
  if (appIndex >= 0) return normalized.slice(0, appIndex + 4);
  return normalized;
}

function normalizeCommandPath(value: string) {
  return value
    .trim()
    .replace(/\\ /g, " ")
    .replace(/\s+\d*$/, "")
    .replace(/\/+$/, "");
}

function isReadOnlyCommand(command: string) {
  if (mutatingPattern.test(command)) return false;
  let body = unwrapShell(command)
    .replace(/\d*>\s*\/dev\/null/g, "")
    .replace(/\d*>\s*&\d+/g, "")
    .trim();
  if (/(^|[^<])>/.test(body)) return false;
  const segments = body
    .split(/&&|\|\||[;|]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => {
    const withoutEnv = segment.replace(/^(?:\w+=\S+\s+)*/, "");
    const first = withoutEnv.match(/^(?:env\s+)?(?:\/[\w.-]+\/)*([\w[\].-]+)/)?.[1];
    if (!first) return false;
    if (first === "find" && /\s-(?:delete|exec|execdir|ok)\b/.test(segment)) {
      return false;
    }
    if (first === "git") {
      return /\bgit\b(?:\s+-C\s+\S+)?\s+(?:status|diff|log|show|branch|rev-parse|ls-files)\b/i.test(
        segment
      );
    }
    return readOnlyCommands.has(first);
  });
}

function unwrapShell(command: string) {
  const match = command.match(
    /^(?:\/bin\/)?(?:zsh|bash|sh)\s+-[^\s]*c\s+(['"])([\s\S]*)\1$/
  );
  return match?.[2] ?? command;
}
