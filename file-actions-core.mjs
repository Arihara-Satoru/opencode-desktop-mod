import path from "node:path";
import { fileURLToPath } from "node:url";

export const EDIT_SCRIPTS = new Set([".ps1", ".bat", ".cmd"]);
const EXECUTABLES = new Set([".exe", ".com", ".msi", ".msp", ".scr", ".lnk", ".url", ".hta", ".reg", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".py", ".sh", ".app", ".desktop", ".command", ".jar"]);
export const needsOpenConfirmation = file => EXECUTABLES.has(path.extname(file).toLowerCase());

export function resolveFileTarget(data, platform = process.platform, home = "") {
  if (!data || data.local !== true || data.workspaceID) throw new Error("远程文件不能使用本机文件操作。");
  const paths = platform === "win32" ? path.win32 : path.posix;
  const valid = value => typeof value === "string" && value.length > 0 && value.length <= 32767 && !/[\x00-\x1f\x7f]/.test(value);
  if (!valid(data.directory) || !valid(data.path)) throw new Error("文件路径无效。");
  let file = data.path;
  // Native data-local-link paths are already decoded. Decode only actual URLs.
  if (/^file:/i.test(file)) {
    const url = new URL(file);
    if (url.hostname && url.hostname !== "localhost") throw new Error("不支持网络文件地址。");
    if (url.search) throw new Error("文件地址不能带查询参数。");
    if (/%(?:2f|5c)/i.test(url.pathname)) throw new Error("文件地址不能包含编码的路径分隔符。");
    url.hash = "";
    file = platform === "win32" ? decodeURIComponent(url.pathname).replace(/^\/([a-z]:)/i, "$1") : fileURLToPath(url);
  } else {
    if (platform === "win32" && /^[a-z]:(?![\\/])/i.test(file)) throw new Error("不支持盘符相对路径。");
    file = file.replace(/#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/i, "").replace(/:\d+(?::\d+|[-–]\d+)?$/, "");
    if (!/^[a-z]:[\\/]/i.test(file) && /^[a-z][a-z\d+.-]*:/i.test(file)) throw new Error("不是本地文件路径。");
  }
  if (file.startsWith("~/") || file.startsWith("~\\")) {
    if (!home) throw new Error("无法解析用户目录。");
    file = paths.join(home, file.slice(2));
  }
  const check = value => {
    if (!valid(value)) throw new Error("文件路径无效。");
    if (platform === "win32") {
      if (/^[\\/]{2}/.test(value) || /^[\\/]/.test(value) || /^[a-z]:(?![\\/])/i.test(value)) throw new Error("不支持网络、设备或盘符相对路径。");
      if (/[<>"|?*]/.test(value) || value.replace(/^[a-z]:/i, "").includes(":")) throw new Error("文件路径包含不支持的字符。");
      if (value.split(/[\\/]/).some(part => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("不支持设备文件。");
      if (value.split(/[\\/]/).some(part => part !== "." && part !== ".." && /[. ]$/.test(part))) throw new Error("不支持末尾带点或空格的路径。");
    }
  };
  check(data.directory);
  check(file);
  if (!paths.isAbsolute(data.directory)) throw new Error("会话目录不是绝对路径。");
  const resolved = paths.resolve(data.directory, file);
  check(resolved);
  return resolved;
}

const literal = text => "'" + text.replaceAll("'", "''") + "'";
export function powerShellArgs(directory, file) {
  const code = `Set-Location -LiteralPath ${literal(directory)};` +
    (file ? ` & ${literal(file)}` : "");
  return ["-NoLogo", "-NoProfile", "-NoExit", "-EncodedCommand", Buffer.from(code, "utf16le").toString("base64")];
}

export function commandPromptArgs() {
  // No CALL (which expands the path twice), delayed expansion or authored command.
  // Only the fixed environment variable is expanded, inside a quoted command.
  return ["/d", "/v:off", "/s", "/k", '""%OC_MOD_SCRIPT%""'];
}
