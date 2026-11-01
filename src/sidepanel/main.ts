/**
 * 侧边栏入口：挂载 Vue 应用。
 * 后续：将原有 DOM 操作迁移为 Vue 组件状态与事件。
 */
import { createApp } from 'vue';
import SidePanelApp from './SidePanelApp.vue';
import './styles/tokens.css';
import { MessageType } from '@/messaging';
import { getActiveTabInfo, sendMessageToTab } from './utils/chromeMessaging';
import { loadSettings } from './services/settings';
import { isRestrictedPage } from './utils/restrictedPages';

createApp(SidePanelApp).mount(document.getElementById('app') || document.body);

console.log('[sidepanel:main] Vue 侧边栏入口初始化');

// 初始握手：根据设置自动启用动态监控（增量扫描）
// 说明：各面板 mount 时也会单独发送 ENABLE_FEATURES，但这里统一发送一次，确保在首次打开侧栏即可安装 watchers。
(async () => {
	try {
		const st = await loadSettings();
		const autoScan = !!st?.autoScan;
		const tab = await getActiveTabInfo();
		const tabId = tab?.id;
		const url = tab?.url || tab?.pendingUrl;
		
		if (tabId && !isRestrictedPage(url)) {
			const basePayload: any = { spaWatchers: autoScan, video: true, image: true, audio: true, playbackEvents: true };
			// 若未开启 autoScan 仍发送一次以安装基础播放事件监听（不强制增量 watchers）
			if (!autoScan) { basePayload.spaWatchers = false; }
			await sendMessageToTab(tabId, { type: MessageType.ENABLE_FEATURES, payload: basePayload });
			console.log('[sidepanel:main] 发送 ENABLE_FEATURES 初始握手', basePayload);
		} else {
			console.log('[sidepanel:main] 跳过初始握手 (无活动标签或受限页面)', { tabId, url });
		}
	} catch (e) {
		console.warn('[sidepanel:main] 初始 ENABLE_FEATURES 发送失败', e);
	}
})();
