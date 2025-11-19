/**
 * MCP 服务相关封装。
 * 兼容旧版 utils.js 的在线状态检测：调用本地 51512 端口的 filesystem/list_allowed_directories。
 */

export interface McpStatus { status: 'online' | 'offline'; path: string }

export async function checkMcpStatus(): Promise<McpStatus> {
  try {
    const res = await fetch('http://localhost:51512/filesystem/list_allowed_directories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ random_string: 'check' })
    });
    const data = await res.json().catch(() => ({}));
    if (Array.isArray((data as any).directoryList) && (data as any).directoryList.length > 0) {
      return { status: 'online', path: (data as any).directoryList[0] as string };
    }
    return { status: 'offline', path: '' };
  } catch {
    return { status: 'offline', path: '' };
  }
}
