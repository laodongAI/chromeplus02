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
          <div class="toggle" :class="{ 'is-on': state.autoScan }" @click="state.autoScan = !state.autoScan" role="switch" :aria-checked="state.autoScan"></div>
        </div>
        <div class="setting-row">
          <div class="setting-row__info">
            <div class="setting-row__label">显示快捷键提示</div>
            <div class="setting-row__hint">搜索栏下方快捷键帮助是否显示</div>
          </div>
          <div class="toggle" :class="{ 'is-on': state.showShortcutHints }" @click="state.showShortcutHints = !state.showShortcutHints" role="switch" :aria-checked="state.showShortcutHints"></div>
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
          <div class="toggle" :class="{ 'is-on': state.companion }" @click="state.companion = !state.companion" role="switch" :aria-checked="state.companion"></div>
        </div>
        <div class="setting-row" v-if="state.companion">
          <div class="setting-row__info">
            <div class="setting-row__label">伴生程序状态</div>
            <div class="setting-row__hint">{{ companionStatusText }}</div>
          </div>
          <BaseButton size="sm" variant="ghost" :loading="companionChecking" @click="checkCompanion">重新检测</BaseButton>
        </div>
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
        <button class="btn-clear" @click="handleClearHistory" :disabled="historyCount === 0">清除历史</button>
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
            <button class="btn-eye" @click="showApiKey=!showApiKey">{{ showApiKey ? '🙈' : '👁' }}</button>
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
          <button class="btn-test" @click="testAI" :disabled="testingAI || !state.ai.apiKey">
            <span v-if="testingAI" class="test-spin"></span>
            {{ testingAI ? '测试中…' : '测试连接' }}
          </button>
          <span class="test-result" :class="testResult.ok ? 'ok' : 'fail'" v-if="testResult.msg">
            {{ testResult.ok ? '✓' : '✗' }} {{ testResult.msg }}
          </span>
        </div>
      </div>

      <!-- Save Actions -->
      <div class="save-actions">
        <button class="btn-reset" @click="resetToDefault">恢复默认</button>
        <button class="btn-save" @click="immediateSave">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          保存设置
        </button>
      </div>
    </div>
  </BaseCard>
</template>

<script lang="ts">
import { defineComponent, reactive, computed, watch, ref, onMounted } from 'vue';
import { BaseCard, FormField } from '../components/base';
import { formatFilename } from '@/utils/format';
import { loadSettings, saveSettings, type ExtensionSettings } from '../services/settings';
import { getHistoryCount, clearHistory, loadHistory } from '../services/downloadHistory';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { MessageType } from '@/messaging';
import { confirmDialog } from '../composables/useConfirm';
import { toast } from '../composables/useToast';

export default defineComponent({
  name: 'SettingsPanel',
  components: { BaseCard, FormField },
  setup() {
    const state = reactive<ExtensionSettings>({
      namingTemplate: '{site}_{title}_{datetime}', autoScan: false, maxConcurrent: 3, showShortcutHints: true, theme: 'auto',
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
        try { await sendRuntimeMessage({ type: MessageType.SETTINGS_UPDATE, payload: { ...state } }); } catch {}
        saveTimer = null;
      }, 400);
    }, { deep: true });

    function immediateSave() {
      if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = null; }
      saveSettings(state);
      try { sendRuntimeMessage({ type: MessageType.SETTINGS_UPDATE, payload: { ...state } }); } catch {}
    }

    function resetToDefault() {
      state.namingTemplate = '{site}_{title}_{datetime}';
      state.autoScan = false;
      state.maxConcurrent = 3;
      state.showShortcutHints = true;
      state.theme = 'auto';
      state.companion = false;
    }

    // ── 极速下载伴生程序状态 ──
    const companionStatusText = ref('未检测');
    const companionChecking = ref(false);
    async function checkCompanion() {
      if (companionChecking.value) return;
      companionChecking.value = true;
      try {
        const resp: any = await sendRuntimeMessage({ type: 'COMPANION_STATUS' });
        companionStatusText.value = resp?.online
          ? '✓ 在线（本地 yt-dlp 已就绪，下载将优先派发）'
          : '✗ 未检测到：请到仓库 companion/ 目录运行 install.bat <扩展ID>（扩展 ID 可在 chrome://extensions 查看）';
      } catch (e: any) {
        companionStatusText.value = '✗ 检测失败：' + (e?.message || '未知错误');
      } finally { companionChecking.value = false; }
    }
    watch(() => state.companion, (v) => { if (v) void checkCompanion(); });

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
  font-size: 11px;
  color: var(--sp-color-muted);
  margin-top: 2px;
}

/* Toggle switch */
.toggle {
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
  font-size: 11px;
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

.btn-clear {
  font-size: 11px;
  font-weight: 500;
  color: var(--sp-color-danger);
  background: var(--sp-color-danger-light);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: var(--sp-radius-sm);
  padding: 4px 10px;
  cursor: pointer;
  transition: all var(--sp-transition-fast);
  white-space: nowrap;
  font-family: var(--sp-font-family);
}

.btn-clear:hover:not(:disabled) { background: var(--sp-color-danger); color: white; border-color: transparent; }
.btn-clear:disabled { opacity: 0.4; cursor: not-allowed; }

/* Save actions */
.save-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.btn-reset {
  font-size: 11px;
  font-weight: 500;
  color: var(--sp-color-muted);
  background: transparent;
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  padding: 5px 12px;
  cursor: pointer;
  font-family: var(--sp-font-family);
  transition: all var(--sp-transition-fast);
}

.btn-reset:hover { background: var(--sp-color-surface); color: var(--sp-color-text); }

.btn-save {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  color: white;
  background: var(--sp-color-primary);
  border: none;
  border-radius: var(--sp-radius-sm);
  padding: 5px 14px;
  cursor: pointer;
  font-family: var(--sp-font-family);
  transition: all var(--sp-transition-fast);
  box-shadow: 0 1px 4px var(--sp-color-primary-glow);
}

.btn-save:hover { background: var(--sp-color-primary-hover); box-shadow: 0 2px 8px var(--sp-color-primary-glow); }
.section-title { font-size:12px; font-weight:700; color:var(--sp-color-heading); margin-bottom:10px; padding-bottom:6px; border-bottom:1px solid var(--sp-color-border); }
.api-key-row { display:flex; gap:6px; align-items:center; }
.btn-eye { width:28px; height:28px; border:1px solid var(--sp-color-border-strong); border-radius:var(--sp-radius-sm); background:var(--sp-color-surface); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; }
.setting-input--med { width:130px; }
.ai-test-row { display:flex; align-items:center; gap:8px; margin-top:8px; }
.btn-test { display:inline-flex; align-items:center; gap:5px; padding:5px 12px; border:1px solid var(--sp-color-primary); border-radius:var(--sp-radius-sm); background:var(--sp-color-primary-light); color:var(--sp-color-primary); font-size:11px; font-weight:600; cursor:pointer; font-family:var(--sp-font-family); transition:all var(--sp-transition-fast); }
.btn-test:hover:not(:disabled) { background:var(--sp-color-primary); color:white; }
.btn-test:disabled { opacity:.4; cursor:not-allowed; }
.test-spin { width:10px; height:10px; border-radius:50%; border:1.5px solid rgba(99,102,241,.3); border-top-color:var(--sp-color-primary); animation:spin .7s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
.test-result { font-size:11px; font-weight:500; }
.test-result.ok { color:var(--sp-color-success); }
.test-result.fail { color:var(--sp-color-danger); }


</style>
