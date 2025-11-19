/**
 * Chrome API 封装占位：提供 Promise 化/类型化方法。
 * 后续将添加 tabs/storage/runtime/sidePanel 等具体函数。
 */

export const chromeApis = {
  async getActiveTab(): Promise<chrome.tabs.Tab | null> {
    return new Promise(resolve => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          resolve(tabs[0] || null);
        });
      } catch (e) {
        console.error('获取活动标签页错误', e);
        resolve(null);
      }
    });
  }
};
