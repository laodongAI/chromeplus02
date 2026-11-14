<template>
  <BaseCard title="系统设置" subtitle="配置扫描策略、命名模板与并发" padded>
    <div class="settings-form">
      <!-- Toggle Settings -->
      <div class="setting-section">
        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">自动扫描</div>
            <div class="setting-row__hint">打开后将尝试增量发现新增资源</div>
          </div>
          <!-- UI 三批（组3）：开关由 div 换成本身可聚焦的 button，键盘 Enter/Space 可达 -->
          <button type="button" class="toggle" :class="{ 'is-on': state.autoScan }" @click="state.autoScan = !state.autoScan" role="switch" :aria-checked="state.autoScan"></button>
        </div>
        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">显示快捷键提示</div>
            <div class="setting-row__hint">搜索栏下方快捷键帮助是否显示</div>
          </div>
          <!-- UI 三批（组3）：开关由 div 换成本身可聚焦的 button，键盘 Enter/Space 可达 -->
          <button type="button" class="toggle" :class="{ 'is-on': state.showShortcutHints }" @click="state.showShortcutHints = !state.showShortcutHints" role="switch" :aria-checked="state.showShortcutHints"></button>
        </div>
        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">界面主题</div>
            <div class="setting-row__hint">跟随系统 / 亮色 / 暗色，切换即时生效</div>
          </div>
          <select v-model="state.theme" class="setting-input" aria-label="界面主题" style="width: 96px;">
            <option value="auto">跟随系统</option>
            <option value="light">亮色</option>
            <option value="dark">暗色</option>
          </select>
        </div>
        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">⚡ 极速下载（本地伴生程序）</div>
            <div class="setting-row__hint">优先派发给本地 yt-dlp（数千站点），失败自动回退内置链路</div>
          </div>
          <!-- UI 三批（组3）：开关由 div 换成本身可聚焦的 button，键盘 Enter/Space 可达 -->
          <button type="button" class="toggle" :class="{ 'is-on': state.companion }" @click="state.companion = !state.companion" role="switch" :aria-checked="state.companion"></button>
        </div>
        <div class="setting-row" v-if="state.companion">
          <div class="setting-row__info">
            <div class="setting-row__label">伴生程序状态</div>
            <div class="setting-row__hint">{{ companionStatusText }}</div>
          </div>
          <BaseButton size="sm" variant="ghost" :loading="companionChecking" @click="checkCompanion">重新检测</BaseButton>
        </div>
      </div>

      <!-- Round 5 #30：外挂下载器。aria2 走本机 JSON-RPC（无需安装伴生程序）；
           m3u8DL-RE / ffmpeg 需要本机进程，只能经伴生程序派发 -->
      <div class="setting-section">
        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">外挂下载器</div>
            <div class="setting-row__hint">用 aria2 / m3u8DL-RE / ffmpeg 下载，失败自动回退内置链路</div>
          </div>
          <button type="button" class="toggle" :class="{ 'is-on': state.externalTools.enabled }" @click="state.externalTools.enabled = !state.externalTools.enabled" role="switch" :aria-checked="state.externalTools.enabled"></button>
        </div>
        <template v-if="state.externalTools.enabled">
          <div class="setting-row setting-row--vertical">
            <div class="setting-row__info">
              <div class="setting-row__label">aria2 RPC 端点</div>
              <div class="setting-row__hint">需本机运行：aria2c --enable-rpc --rpc-origin-whitelist-required=false</div>
            </div>
            <input type="text" class="setting-input setting-input--full" v-model="state.externalTools.aria2Rpc" placeholder="http://127.0.0.1:6800/jsonrpc" />
          </div>
          <div class="setting-row setting-row--vertical">
            <div class="setting-row__info">
              <div class="setting-row__label">aria2 RPC 密钥</div>
              <div class="setting-row__hint">对应 --rpc-secret，未设置则留空</div>
            </div>
            <input type="password" class="setting-input setting-input--full" v-model="state.externalTools.aria2Secret" placeholder="留空表示无密钥" />
          </div>
          <div class="setting-row">
            <div class="setting-row__info">
              <div class="setting-row__label">本机工具</div>
              <div class="setting-row__hint">m3u8DL-RE / ffmpeg 需放进 companion\bin 并安装伴生程序</div>
            </div>
            <select class="setting-input" v-model="state.externalTools.nativeTool">
              <option value="off">不使用</option>
              <option value="m3u8dl">m3u8DL-RE</option>
              <option value="ffmpeg">ffmpeg</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-row__info">
              <div class="setting-row__label">分段流也交给外挂</div>
              <div class="setting-row__hint">HLS/DASH 优先外发；内置引擎已支持加密清单与重试，一般保持关闭</div>
            </div>
            <button type="button" class="toggle" :class="{ 'is-on': state.externalTools.preferForStreams }" @click="state.externalTools.preferForStreams = !state.externalTools.preferForStreams" role="switch" :aria-checked="state.externalTools.preferForStreams"></button>
          </div>
          <div class="setting-row">
            <div class="setting-row__info">
              <div class="setting-row__label">通道状态</div>
              <div class="setting-row__hint">{{ externalToolsStatusText }}</div>
            </div>
            <BaseButton size="sm" variant="ghost" :loading="externalToolsChecking" @click="checkExternalTools">检测</BaseButton>
          </div>
        </template>
      </div>

      <!-- Text / Number Settings -->
      <div class="setting-section">
        <div class="setting-row setting-row--vertical">
          <div class="setting-row__info">
            <div class="setting-row__label">命名模板</div>
            <div class="setting-row__hint">支持变量: {site} {title} {date} {time} {datetime} {index}</div>
          </div>
          <input
            type="text"
            class="setting-input setting-input--full"
            v-model="state.namingTemplate"
            placeholder="{site}_{title}_{datetime}"
          />
        </div>
        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">并发上限</div>
            <div class="setting-row__hint">同时进行的最大下载任务数 (1-10)</div>
          </div>
          <input
            type="number"
            class="setting-input setting-input--num"
            min="1"
            max="10"
            v-model.number="state.maxConcurrent"
          />
        </div>
      </div>

      <!-- UI 二批之二：快捷键说明（信息架构收敛后同步更新文案） -->
      <div class="setting-section">
        <div class="section-title">⌨️ 快捷键说明</div>
        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">列表操作（作用于当前子模式的面板）</div>
            <div class="setting-row__hint">Ctrl+F 聚焦搜索 · Ctrl+A 全选 · Ctrl+D 清除选择 · Ctrl+Shift+I 反选 · Ctrl+Shift+N 选中新增 · Ctrl+Shift+R 重新扫描</div>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">导航（抓取 / 下载 / 录制 / 设置）</div>
            <div class="setting-row__hint">Tab 键聚焦导航后，用 ←/→ 方向键切换一级入口与各面板子模式（图片|视频|音频|文本|资源包、收集篮|进行中|历史）</div>
          </div>
        </div>
      </div>

      <!-- Preview -->
      <div class="preview-block">
        <div class="preview-block__label">预览文件名</div>
        <code class="preview-block__value">{{ previewFilename }}</code>
      </div>

      <!-- History -->
      <div class="history-block">
        <div class="history-block__info">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>已记录下载历史 <strong>{{ historyCount }}</strong> 条</span>
        </div>
        <!-- UI 三批（组1）：手写 .btn-clear 收敛为 BaseButton danger 语义（破坏性清除操作） -->
        <BaseButton variant="danger" size="sm" @click="handleClearHistory" :disabled="historyCount === 0">清除历史</BaseButton>
      </div>

      <!-- AI 模型配置 -->
      <div class="setting-section">
        <div class="section-title">🤖 AI 模型配置</div>

        <div class="setting-row setting-row--vertical">
          <div class="setting-row__label">服务提供商</div>
          <select class="setting-input" v-model="state.ai.provider" @change="onProviderChange">
            <option value="zhipu">智谱 GLM（含免费模型）</option>
            <option value="openai">OpenAI / 兼容接口</option>
            <option value="deepseek">DeepSeek</option>
            <option value="moonshot">月之暗面 Kimi</option>
            <option value="qwen">通义千问 Qwen</option>
            <option value="anthropic">Anthropic Claude</option>
            <option value="gemini">Google Gemini</option>
            <option value="custom">自定义接口</option>
          </select>
        </div>

        <div class="setting-row setting-row--vertical">
          <div class="setting-row__label">API Key</div>
          <div class="api-key-row">
            <input
              :type="showApiKey ? 'text' : 'password'"
              class="setting-input setting-input--full"
              v-model="state.ai.apiKey"
              placeholder="sk-..."
            />
            <!-- UI 三批（组1/组5）：emoji 眼睛按钮收敛为 BaseButton icon-sm ghost +
                 内联 stroke SVG（currentColor 随主题），icon 尺寸必须带 aria-label -->
            <BaseButton size="icon-sm" variant="ghost" aria-label="显示/隐藏 API Key" @click="showApiKey=!showApiKey">
              <!-- 明文态：眼睛带斜线（点击后切回密文）；密文态：睁眼（点击后显示明文） -->
              <svg v-if="showApiKey" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="14.12" y1="9.88" x2="9.88" y2="14.12"/><line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </BaseButton>
          </div>
        </div>

        <div class="setting-row setting-row--vertical">
          <div class="setting-row__label">API Base URL</div>
          <input
            type="text"
            class="setting-input setting-input--full"
            v-model="state.ai.baseUrl"
            placeholder="https://api.openai.com/v1"
          />
          <div class="setting-row__hint">支持任何 OpenAI 兼容接口（如 Ollama、LM Studio）</div>
        </div>

        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">Chat 模型</div>
            <div class="setting-row__hint">用于字幕翻译、AI 助手</div>
          </div>
          <input
            type="text"
            class="setting-input setting-input--med"
            v-model="state.ai.model"
            placeholder="gpt-4o-mini"
          />
        </div>

        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">Whisper 模型</div>
            <div class="setting-row__hint">语音转文字（字幕提取）</div>
          </div>
          <input
            type="text"
            class="setting-input setting-input--med"
            v-model="state.ai.whisperModel"
            placeholder="whisper-1"
          />
        </div>

        <div class="setting-row setting-row--vertical" style="margin-top:8px">
          <div class="setting-row__label">翻译服务</div>
          <select class="setting-input" v-model="state.ai.translateProvider">
            <option value="openai">OpenAI（使用上方 Key）</option>
            <option value="deepl">DeepL</option>
            <option value="baidu">百度翻译</option>
          </select>
        </div>

        <template v-if="state.ai.translateProvider === 'deepl'">
          <div class="setting-row setting-row--vertical">
            <div class="setting-row__label">DeepL API Key</div>
            <input type="password" class="setting-input setting-input--full" v-model="state.ai.deeplApiKey" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx" />
          </div>
        </template>

        <template v-if="state.ai.translateProvider === 'baidu'">
          <div class="setting-row setting-row--vertical">
            <div class="setting-row__label">百度 App ID</div>
            <input type="text" class="setting-input setting-input--full" v-model="state.ai.baiduAppId" placeholder="2015063000000001" />
          </div>
          <div class="setting-row setting-row--vertical">
            <div class="setting-row__label">百度 Secret Key</div>
            <input type="password" class="setting-input setting-input--full" v-model="state.ai.baiduSecretKey" placeholder="12345678" />
          </div>
        </template>

        <div class="ai-test-row">
          <!-- UI 三批（组1）：手写 .btn-test + 本地 .test-spin 收敛为 BaseButton outline，
               loading 态由组件内置 spinner 承担（testingAI 时自动禁用并显示转圈） -->
          <BaseButton variant="outline" size="sm" :loading="testingAI" :disabled="!state.ai.apiKey" @click="testAI">测试连接</BaseButton>
          <span class="test-result" :class="testResult.ok ? 'ok' : 'fail'" v-if="testResult.msg">
            {{ testResult.ok ? '✓' : '✗' }} {{ testResult.msg }}
          </span>
        </div>
      </div>

      <!-- Save Actions -->
      <div class="save-actions">
        <!-- UI 三批（组1）：保存/恢复两个手写按钮收敛 BaseButton（primary 主操作 / secondary 次级），
             保存按钮保留原内联 SVG 图标 -->
        <BaseButton variant="secondary" size="sm" @click="resetToDefault">恢复默认</BaseButton>
        <BaseButton variant="primary" size="sm" @click="immediateSave">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          保存设置
        </BaseButton>
      </div>
    </div>
  </BaseCard>
</template>

<script lang="ts">
import { defineComponent, reactive, computed, watch, ref, onMounted } from 'vue';
// UI 三批（组1）：面板内全部手写按钮收敛为共享 BaseButton
import { BaseButton, BaseCard } from '../components/base';
import { formatFilename } from '@/utils/format';
import { loadSettings, saveSettings, type ExtensionSettings, DEFAULT_EXTERNAL_TOOLS } from '../services/settings';
import { getHistoryCount, clearHistory, loadHistory } from '../services/downloadHistory';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { MessageType } from '@/messaging';
import { confirmDialog } from '../composables/useConfirm';
import { toast } from '../composables/useToast';

export default defineComponent({
  name: 'SettingsPanel',
  // 收口轮 lint 修复：FormField 注册后模板未使用（表单直接用语义标签），移除注册
  // UI 三批（组1）：新注册 BaseButton，保存/清除/测试/眼睛/恢复五个按钮统一走共享实现
  components: { BaseButton, BaseCard },
  setup() {
    const state = reactive<ExtensionSettings>({
      namingTemplate: '{site}_{title}_{datetime}', autoScan: false, maxConcurrent: 3, showShortcutHints: true, theme: 'auto', companion: false,
      externalTools: { ...DEFAULT_EXTERNAL_TOOLS },
      // WebRTC 捕获开关由视频面板的卡片经后台写入，这里只负责原样带回，避免保存设置时把它抹掉
      webrtcCapture: false,
      ai: { provider:'openai', apiKey:'', baseUrl:'https://api.openai.com/v1', model:'gpt-4o-mini',
            whisperModel:'whisper-1', translateProvider:'openai', deeplApiKey:'', baiduAppId:'', baiduSecretKey:'' }
    });
    const showApiKey = ref(false);
    const testingAI  = ref(false);
    const testResult = ref({ ok: false, msg: '' });
    const historyCount = ref(0);

    loadSettings().then(s => { Object.assign(state, s); });

    onMounted(async () => {
      await loadHistory();
      historyCount.value = getHistoryCount();
    });

    async function handleClearHistory() {
      const ok = await confirmDialog({ title: '清除下载历史', message: '将移除全部下载记录（不删除已下载文件），不可恢复。', danger: true, confirmText: '清除' });
      if (ok) {
        await clearHistory();
        historyCount.value = getHistoryCount();
        toast.success('下载历史已清除');
      }
    }

    let saveTimer: number | null = null;
    watch(state, () => {
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(async () => {
        await saveSettings(state);
        try { await sendRuntimeMessage({ type: MessageType.SETTINGS_UPDATE, payload: { ...state } }); } catch { /* noop：后台未起时下次保存重试 */ }
        saveTimer = null;
      }, 400);
    }, { deep: true });

    function immediateSave() {
      if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = null; }
      saveSettings(state);
      try { sendRuntimeMessage({ type: MessageType.SETTINGS_UPDATE, payload: { ...state } }); } catch { /* noop：同上，静默降级 */ }
    }

    function resetToDefault() {
      state.namingTemplate = '{site}_{title}_{datetime}';
      state.autoScan = false;
      state.maxConcurrent = 3;
      state.showShortcutHints = true;
      state.theme = 'auto';
      state.companion = false;
      state.externalTools = { ...DEFAULT_EXTERNAL_TOOLS };
    }

    // ── 极速下载伴生程序状态 ──
    const companionStatusText = ref('未检测');
    const companionChecking = ref(false);
    async function checkCompanion() {
      if (companionChecking.value) return;
      companionChecking.value = true;
      try {
        const resp: any = await sendRuntimeMessage({ type: MessageType.COMPANION_STATUS });
        companionStatusText.value = resp?.online
          ? '✓ 在线（本地 yt-dlp 已就绪，下载将优先派发）'
          : '✗ 未检测到：请到仓库 companion/ 目录运行 install.bat <扩展ID>（扩展 ID 可在 chrome://extensions 查看）';
      } catch (e: any) {
        companionStatusText.value = '✗ 检测失败：' + (e?.message || '未知错误');
      } finally { companionChecking.value = false; }
    }
    watch(() => state.companion, (v) => { if (v) void checkCompanion(); });

    // ── 外挂下载器通道状态（Round 5 #30）──
    const externalToolsStatusText = ref('未检测');
    const externalToolsChecking = ref(false);
    /**
     * 探测两条通道并给出可执行的失败原因。
     * aria2 的 403 与"连不上"是两回事（Origin 白名单 vs 没起进程），
     * 后台已按此归因，这里原样呈现，不自行猜测。
     */
    async function checkExternalTools() {
      if (externalToolsChecking.value) return;
      externalToolsChecking.value = true;
      try {
        const resp: any = await sendRuntimeMessage({ type: MessageType.EXTERNAL_TOOLS_STATUS });
        if (!resp?.enabled) {
          externalToolsStatusText.value = '已关闭：全部走内置下载链路';
          return;
        }
        const aria2 = resp.aria2?.ok
          ? `✓ aria2 ${resp.aria2.version || ''}`.trim()
          : `✗ aria2：${resp.aria2?.error || '不可用'}`;
        const native = state.externalTools.nativeTool === 'off'
          ? '（本机工具未启用）'
          : resp.native?.ok
            ? `✓ 本机工具就绪（m3u8DL：${resp.native.tools?.m3u8dl ? '有' : '无'} / ffmpeg：${resp.native.tools?.ffmpeg ? '有' : '无'}）`
            : `✗ 本机工具：${resp.native?.error || '伴生程序未安装'}`;
        externalToolsStatusText.value = `${aria2}；${native}`;
      } catch (e: any) {
        externalToolsStatusText.value = '✗ 检测失败：' + (e?.message || '未知错误');
      } finally { externalToolsChecking.value = false; }
    }
    watch(() => state.externalTools.enabled, (v) => { if (v) void checkExternalTools(); });

    const previewFilename = computed(() => {
      try {
        return formatFilename(state.namingTemplate, { site: 'youtube', title: 'my_video', index: '001' });
      } catch { return state.namingTemplate; }
    });

    function onProviderChange() {
      // 各家均提供 OpenAI 兼容端点（chat/completions）；whisperModel 为语音转文字模型名
      const presets: Record<string, { baseUrl: string; model: string; whisperModel?: string }> = {
        zhipu:     { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', whisperModel: 'glm-asr' },
        openai:    { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', whisperModel: 'whisper-1' },
        deepseek:  { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        moonshot:  { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
        qwen:      { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
        anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-20241022' },
        gemini:    { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-1.5-flash' },
        custom:    { baseUrl: '', model: '' },
      };
      const p = presets[state.ai.provider];
      if (p) {
        state.ai.baseUrl = p.baseUrl;
        state.ai.model = p.model;
        if (p.whisperModel) state.ai.whisperModel = p.whisperModel;
      }
    }

    async function testAI() {
      testingAI.value = true; testResult.value = { ok: false, msg: '' };
      const base = state.ai.baseUrl.replace(/\/$/, '');
      const headers = { 'Authorization': `Bearer ${state.ai.apiKey}`, 'Content-Type': 'application/json' };
      try {
        // 首选 /models；部分兼容端点（如智谱）不列出免费模型，回退最小对话探测
        const resp = await fetch(`${base}/models`, { headers });
        if (resp.ok) { testResult.value = { ok: true, msg: '连接成功 ✓' }; return; }
        const chat = await fetch(`${base}/chat/completions`, {
          method: 'POST', headers,
          body: JSON.stringify({ model: state.ai.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
        });
        testResult.value = chat.ok
          ? { ok: true, msg: `连接成功 ✓（/models 不可用，对话探测通过 ${resp.status}）` }
          : { ok: false, msg: `HTTP ${resp.status} / ${chat.status}` };
      } catch (e: any) {
        testResult.value = { ok: false, msg: e?.message ?? '连接失败' };
      } finally { testingAI.value = false; }
    }

    return { state, historyCount, handleClearHistory, immediateSave, resetToDefault, previewFilename,
             showApiKey, testingAI, testResult, onProviderChange, testAI,
             companionStatusText, companionChecking, checkCompanion,
             externalToolsStatusText, externalToolsChecking, checkExternalTools,
 };
  }
});
</script>

<style scoped>
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Section container */
.setting-section {
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-lg);
  overflow: hidden;
  background: var(--sp-color-surface);
}

/* Individual row */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--sp-color-border);
}

.setting-row:last-child { border-bottom: none; }

.setting-row--vertical {
  flex-direction: column;
  align-items: flex-start;
}

.setting-row__info { flex: 1; min-width: 0; }

.setting-row__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--sp-color-text);
}

.setting-row__hint {
  /* UI 三批（组2）：信息性说明文字 11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
  margin-top: 2px;
}

/* Toggle switch
   UI 三批（组3）：元素由 div 换成 button（键盘 Enter/Space 可达），
   这里重置 UA 默认样式并保持 34×20 视觉不变；
   ::before 透明层向外扩出命中区，触控高度 20px → 28px（≥24px 标准） */
.toggle {
  appearance: none;
  -webkit-appearance: none;
  padding: 0;
  font: inherit;
  width: 34px;
  height: 20px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: 999px;
  cursor: pointer;
  position: relative;
  transition: all var(--sp-transition-fast);
  flex-shrink: 0;
}

/* UI 三批（组3）：扩触控区（垂直 -4px×2 → 28px 高，水平 -10px×2 → 54px 宽），不影响视觉 */
.toggle::before {
  content: '';
  position: absolute;
  inset: -4px -10px;
}

.toggle:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: 2px; }

.toggle.is-on {
  background: var(--sp-color-primary);
  border-color: transparent;
}

.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--sp-color-muted);
  transition: left var(--sp-transition-fast), background var(--sp-transition-fast);
}

.toggle.is-on::after {
  left: 16px;
  background: white;
}

/* Inputs */
.setting-input {
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  color: var(--sp-color-text);
  /* UI 三批（组2）：输入框正文级文字 11px → 12px */
  font-size: 12px;
  font-family: var(--sp-font-family);
  padding: 5px 10px;
  height: 28px;
  outline: none;
  transition: border-color var(--sp-transition-fast);
}

.setting-input:focus {
  border-color: var(--sp-color-primary);
  box-shadow: 0 0 0 2px var(--sp-color-primary-light);
}

.setting-input--full { width: 100%; }
.setting-input--num { width: 60px; text-align: center; }

/* Preview block */
.preview-block {
  padding: 10px 14px;
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-lg);
}

.preview-block__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sp-color-muted);
  font-weight: 600;
  margin-bottom: 4px;
}

.preview-block__value {
  font-family: var(--sp-font-mono, monospace);
  font-size: 11px;
  color: var(--sp-color-primary);
  word-break: break-all;
}

/* History block */
.history-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-lg);
  font-size: 12px;
  color: var(--sp-color-text-secondary);
}

.history-block__info {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--sp-color-muted);
}

.history-block__info strong { color: var(--sp-color-text); }

/* UI 三批（组1）：.btn-clear/.btn-reset/.btn-save/.btn-eye/.btn-test/.test-spin 本地样式
   已随按钮收敛 BaseButton 全部删除（色彩/尺寸/loading 由共享组件承担） */

/* Save actions */
.save-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.section-title { font-size:12px; font-weight:700; color:var(--sp-color-heading); margin-bottom:10px; padding-bottom:6px; border-bottom:1px solid var(--sp-color-border); }
.api-key-row { display:flex; gap:6px; align-items:center; }
.setting-input--med { width:130px; }
.ai-test-row { display:flex; align-items:center; gap:8px; margin-top:8px; }
/* UI 三批（组2）：测试结果属正文级状态文字 11px → 12px */
.test-result { font-size:12px; font-weight:500; }
.test-result.ok { color:var(--sp-color-success); }
.test-result.fail { color:var(--sp-color-danger); }


</style>
