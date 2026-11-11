import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

for (const name of ["应用桌面端补丁.cmd", "还原官方原版.cmd"]) {
  const source = fs.readFileSync(new URL(name, import.meta.url), "utf8");
  assert.match(source, /^[\x00-\x7f]*$/, "CMD control flow/messages must not depend on multibyte console decoding");
  if (process.platform !== "win32") continue;
  const dir = fs.mkdtempSync(path.join(os.homedir(), "AppData/Local/Temp/opencode/launcher-check-"));
  try {
    // Execute only a stub in an isolated directory: never the real installer.
    const launcher = path.join(dir, "launch.cmd");
    fs.writeFileSync(launcher, source.replace(/\r?\n/g, "\r\n"));
    for (const code of [0, 1]) {
      fs.writeFileSync(path.join(dir, "apply-mod.mjs"), `console.log("stub-launcher");process.exit(${code});`);
      const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", launcher], { input: "\r\n", encoding: "utf8", timeout: 15000 });
      assert.ifError(result.error);
      assert.equal(result.status, code, `${name}: preserve failure exit status`);
      assert.match(result.stdout, /stub-launcher/);
      assert.doesNotMatch(result.stderr, /not recognized|不是内部或外部命令/i);
      if (code) {
        assert.match(result.stdout, /\[Failed\]/);
        assert.doesNotMatch(result.stdout, /\[EBUSY\]/, "Do not misdiagnose every installer failure as a locked file");
        assert.match(result.stdout, /For file-lock errors \(EBUSY\/EPERM\)/);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log("Launcher checks passed: ASCII-safe CMD messages, isolated success/failure paths and exit codes.");
