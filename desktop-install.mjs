import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const read = file => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`安装包不是普通文件，拒绝覆盖：${file}`);
    return fs.readFileSync(file);
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);

function replace(file, before, after) {
  if (!same(read(file), before)) throw new Error(`安装包在操作期间已变化，未覆盖：${file}`);
  if (after === null) { fs.unlinkSync(file); return; }
  const temp = path.join(path.dirname(file), `.desktop-mod-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, after, { flag: "wx", mode: before === null ? 0o644 : fs.statSync(file).mode & 0o777 });
    if (!same(read(file), before)) throw new Error(`安装包在操作期间已变化，未覆盖：${file}`);
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

// Never register a plugin after a failed ASAR write. If configuration fails,
// restore the exact package present before this run, not an older official copy.
export function writeDesktopPatch(file, bytes, goals, expected = read(file)) {
  let replaced = false;
  try {
    replace(file, expected, bytes);
    replaced = true;
    goals.commit();
  } catch (error) {
    const errors = [error];
    try { goals.rollback(); } catch (rollback) { errors.push(rollback); }
    if (replaced) try { replace(file, bytes, expected); } catch (rollback) { errors.push(rollback); }
    if (errors.length > 1) throw new AggregateError(errors, "安装或还原失败；回滚遇到冲突，未覆盖同时发生的修改，请检查保留的备份。");
    throw error;
  } finally { goals.finish(); }
}
