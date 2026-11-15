/**
 * 扩展级全局快捷键（chrome.commands）。
 *
 * 为什么必须有这一层：页内画笔工具栏的 H 只在「被录页面恰好获得焦点」时才收得到按键。
 * 录整屏或录其他应用窗口时，用户根本不在那个页面上，页内快捷键完全够不着；
 * 侧栏自身也没有任何按键入口。commands 由浏览器分发，Chrome 任一窗口聚焦即可触发。
 *
 * 平台边界（不要向用户承诺超出这个范围的能力）：
 *  - Chrome 未聚焦（例如正在操作 PowerPoint）时 commands 不触发。真·系统级全局热键
 *    只有伴生程序的桌面标注层做得到（companion/overlay/overlay.ps1 用 RegisterHotKey
 *    注册了 Ctrl+Alt+T 等），那是另一条链路，需要用户安装 companion。
 *  - commands 只有 keydown 没有 keyup，所以「按住说话」不能走这里（见 core/recordingAudio）。
 *  - 快捷键可能与站点或其他扩展冲突，用户可在 chrome://extensions/shortcuts 自行改绑。
 */

import { MessageType } from '@/messaging';
import { createLogger } from '@/utils/logger';

const log = createLogger('bg.commands');

/** manifest.commands 里注册的命令名（改 manifest 必须同步改这里） */
const CMD_ANNOTATE_TOOLBAR = 'annotate-toolbar';
const CMD_RECORD_TOGGLE_PAUSE = 'record-toggle-pause';
const CMD_RECORD_STOP = 'record-stop';

/**
 * 取命令触发时的目标标签页。
 * onCommand 自带的 tab 参数就是触发时的活动页，优先用它；
 * 拿不到（某些 Chrome 版本/场景不给）再回退查询，避免快捷键静默失效。
 */
async function resolveTargetTab(tab?: chrome.tabs.Tab): Promise<chrome.tabs.Tab | undefined> {
  if (tab?.id != null) return tab;
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    return active;
  } catch {
    return undefined;
  }
}

/** 转发录制控制命令给侧栏；侧栏未开时无接收端，属正常（此时录制本就不存在） */
function sendRecordingCommand(action: 'toggle-pause' | 'stop'): void {
  // 带 callback 才不返回 Promise：侧栏未开时的 reject 抓不进同步 try/catch，会成为未处理拒绝
  try {
    chrome.runtime.sendMessage({ type: MessageType.RECORDING_COMMAND, action }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* 扩展上下文失效等同步异常 */
  }
}

/** 安装 commands 监听（幂等） */
export function initCommands(): void {
  if (!chrome?.commands?.onCommand) {
    log.debug('非扩展运行环境（chrome.commands 不可用），跳过全局快捷键安装');
    return;
  }

  chrome.commands.onCommand.addListener((command: string, tab?: chrome.tabs.Tab) => {
    if (command === CMD_RECORD_TOGGLE_PAUSE) {
      log.info('全局快捷键：暂停/继续录制');
      sendRecordingCommand('toggle-pause');
      return;
    }
    if (command === CMD_RECORD_STOP) {
      log.info('全局快捷键：停止录制');
      sendRecordingCommand('stop');
      return;
    }
    if (command === CMD_ANNOTATE_TOOLBAR) {
      void (async () => {
        const target = await resolveTargetTab(tab);
        if (target?.id == null) {
          log.debug('工具栏快捷键：没有可用目标标签页，忽略');
          return;
        }
        // frameId 0：覆盖层只建在顶层 frame，广播到 iframe 只会产生一堆无接收端的拒绝
        chrome.tabs.sendMessage(
          target.id,
          { type: MessageType.ANNOTATE_TOOLBAR_TOGGLE },
          { frameId: 0 },
          () => { void chrome.runtime.lastError; }
        );
        log.info(`全局快捷键：切换画笔工具栏显隐（tab ${target.id}）`);
      })();
      return;
    }
    log.debug(`未识别的命令名，忽略: ${command}`);
  });

  log.info('全局快捷键已安装：Alt+Shift+H 工具栏显隐 / Alt+Shift+P 暂停继续 / Alt+Shift+S 停止');
}