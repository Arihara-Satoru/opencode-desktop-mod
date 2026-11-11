#!/usr/bin/env node
import path from "node:path";
import { installGoals } from "./deploy.mjs";

const args = process.argv.slice(2);
const uninstall = args.includes("--uninstall");
const configFlag = args.indexOf("--config");
if (configFlag >= 0 && (!args[configFlag + 1] || args[configFlag + 1].startsWith("--"))) throw new Error("--config 后需要明确的配置文件路径。");
const result = installGoals({ uninstall, version: "2.2.7", configFile: configFlag >= 0 ? path.resolve(args[configFlag + 1]) : undefined });
if (result.backup) console.log(`已备份原配置：${result.backup}`);
console.log(`${uninstall ? "已移除目标功能注册" : "已部署离线目标功能"}：${result.configFile}`);
console.log(uninstall ? "不删除已保存的目标、会话或代码；重新启用前应确认已暂停的状态。" : "需要 OpenCode 2.2.7+；随 OpenCode 自带服务运行，无独立服务、npm 安装或源码路径依赖。");
