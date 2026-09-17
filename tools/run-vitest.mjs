#!/usr/bin/env node
/**
 * Daily Value - vitest Windows 启动器（2.14.0 加入）
 *
 * 背景：vitest 4 在 Windows 上存在「盘符大小写不匹配」崩溃 —— 项目路径为小写盘符
 * （如 d:\...）时，ESM 解析路径与 path.resolve 规范化的路径（D:\...）不一致，
 * 导致 worker 找不到当前 suite：
 *   "Vitest failed to find the current suite" / "Cannot read properties of undefined (reading 'config')"
 *
 * 作用：把所有绝对路径参数与 cwd 统一规范化为 path.resolve 的盘符大小写后，
 *       以干净环境启动 vitest 子进程（行为与 npm script 完全一致）。
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function norm(p) {
  return path.resolve(p);
}

process.chdir(norm(process.cwd()));

const args = process.argv.slice(2).map((a) => {
  if (/^[a-zA-Z]:[\\/]/.test(a)) return norm(a);
  return a;
});

const cli = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');

const res = spawnSync(process.execPath, [cli, ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status ?? 1);