/**
 * Daily Value v2 - 文件桥（2.14.0）
 *
 * Android：调用本地 FileBridgePlugin（SAF：ACTION_CREATE_DOCUMENT 保存 / ACTION_OPEN_DOCUMENT 选择），
 * 用户通过系统文件界面选择位置，文件真实存在于用户可控位置。
 * Web/开发环境兜底：导出用 Blob + download，导入用隐藏 input[type=file]（保持可测试）。
 *
 * 数据以 UTF-8 文本传递；原生桥走 base64（避免控制字符/JS 字符串截断）。
 */

export interface SaveFileInput {
  fileName: string;
  /** MIME：备份 application/json；CSV text/csv */
  mimeType: string;
  /** UTF-8 文本内容（备份 JSON / CSV 文本） */
  text: string;
}
export interface OpenFileResult {
  name: string;
  text: string;
}

interface NativeFileBridge {
  saveFile(options: { fileName: string; mimeType: string; data: string }): Promise<{ ok: boolean }>;
  openFile(): Promise<{ name: string; data: string }>;
}

/** 检测原生 FileBridge 是否可用（Capacitor 本地插件经 Capacitor.Plugins 暴露） */
export function isNativeFileBridgeAvailable(): boolean {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return Boolean(cap?.Plugins?.FileBridge);
}

function getBridge(): NativeFileBridge | undefined {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, NativeFileBridge> } }).Capacitor;
  return cap?.Plugins?.FileBridge;
}

/** UTF-8 → base64（规避 btoa 对非 Latin1 的抛错） */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 → UTF-8 文本 */
function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** 保存文本文件：Android 走系统 SAF 保存界面；Web 走 Blob 下载兜底。返回描述文案。 */
export async function saveTextFile(input: SaveFileInput): Promise<{ ok: boolean; via: 'native' | 'web' }> {
  const bridge = getBridge();
  if (bridge) {
    try {
      await bridge.saveFile({
        fileName: input.fileName,
        mimeType: input.mimeType,
        data: utf8ToBase64(input.text),
      });
      return { ok: true, via: 'native' };
    } catch {
      // 原生失败（如用户取消）→ 抛给调用方决定（不静默降级 Web 下载）
      throw new Error('native-save-cancelled');
    }
  }
  // Web 兜底：Blob 下载（开发/测试环境）
  const blob = new Blob([input.text], { type: `${input.mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = input.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true, via: 'web' };
}

/** 打开文本文件：Android 走系统文件选择；Web 走 input[type=file]。返回 { name, text }。 */
export async function openTextFile(): Promise<OpenFileResult> {
  const bridge = getBridge();
  if (bridge) {
    const result = await bridge.openFile();
    return { name: result.name, text: base64ToUtf8(result.data) };
  }
  // Web 兜底：隐藏 input 选择文件
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.dvbackup,application/json,text/csv,.csv';
  const text = await new Promise<string>((resolve, reject) => {
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('no-file'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('read-failed'));
      reader.readAsText(file, 'utf-8');
    };
    input.click();
  });
  const name = input.files?.[0]?.name ?? 'file';
  return { name, text };
}