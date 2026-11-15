<template>
  <div class="screen-record-panel">
    <!-- 录制中状态 -->
    <div v-if="recording" class="recording-overlay">
      <div class="recording-status">
        <div class="rec-pulse"></div>
        <span class="rec-label">录制中</span>
        <span class="rec-timer">{{ timerDisplay }}</span>
        <span v-if="autoStopCountdown" class="rec-limit" title="到达设定成片时长后自动停止">剩余 {{ autoStopCountdown }}</span>
      </div>
      <!-- UI 三批（组1）：删除 ✏️ emoji，纯文字说明即可（色彩改用 warning token） -->
      <div class="annot-hint" v-if="annotTabId != null">黑板画笔已开启：默认是操作模式，网页可正常点击；选一个画笔工具即进入绘制模式，可切换 文字/矩形/直线/箭头/荧光/橡皮、颜色与粗细。按 H 隐藏工具栏（两种模式都生效，隐藏后不会录进画面）、空格切换「绘制/操作」（仅绘制模式，操作模式下空格属于页面）。需要画在桌面或 PPT 等其他应用上时，点下方「桌面标注」（需安装 companion 伴生程序）</div>
      <!-- Round 5 #31：按住说话。用 pointer 事件而非 click——click 只有「按下并松开」一个时刻，
           做不出「按住期间开麦」；pointercancel/leave 一并松手，避免麦克风卡在打开态 -->
      <div v-if="pttEnabled" class="ptt-wrap">
        <button
          type="button"
          class="ptt-btn"
          :class="{ 'is-holding': pttHolding }"
          @pointerdown.prevent="onPttDown"
          @pointerup="onPttUp"
          @pointerleave="onPttUp"
          @pointercancel="onPttUp"
          @contextmenu.prevent
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
          {{ pttHolding ? '正在收人声…' : `按住说话（或按住 ${PTT_KEY_LABEL} 键）` }}
        </button>
        <div class="ptt-hint">按键只在侧栏获得焦点时生效；录制其他应用时请按住上方按钮</div>
      </div>
      <!-- 画中画录制中微调：合成器支持热更新，不必停录重来 -->
      <div v-if="cameraActive && cameraPip" class="pip-live">
        <!-- 自view：画中画是画进视频轨的，页面上没有任何浮窗，不给预览就只能回放成片才知道有没有入镜 -->
        <video
          ref="camPreviewEl"
          class="pip-cam"
          :class="{ 'is-circle': cameraPip.shape === 'circle', 'is-mirror': cameraPip.mirror }"
          muted
          playsinline
          autoplay
        ></video>
        <span class="pip-live__label">画中画</span>
        <select class="pip-select" :value="cameraPip.position" @change="setPipPosition(($event.target as HTMLSelectElement).value)">
          <option v-for="(label, key) in PIP_POSITION_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
        <select class="pip-select" :value="cameraPip.size" @change="setPipSize(($event.target as HTMLSelectElement).value)">
          <option v-for="(label, key) in PIP_SIZE_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <!-- Round 5 #33：推近聚焦与敏感区遮挡（仅在合成器已建立时出现） -->
      <RecordingVisualControls />
      <div class="recording-controls">
        <!-- UI 三批（组1）：桌面标注开关收敛到 BaseButton；
             开启态用 outline（主色描边高亮）、关闭态 secondary；✏️ emoji 换成内联 stroke SVG 铅笔（currentColor 随按钮文字色） -->
        <BaseButton
          :variant="overlayOn ? 'outline' : 'secondary'"
          :disabled="overlayBusy"
          title="在整个桌面上叠加一层透明画布，可在 PPT、播放器或其他应用窗口上绘制（会录入整屏录制）"
          @click="toggleDesktopOverlay"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          {{ overlayOn ? '关闭桌面标注' : '桌面标注' }}
        </BaseButton>
        <!-- Round 5 #32：录制中可随时开关点击高亮，不必停录重来 -->
        <BaseButton
          :variant="highlightOn ? 'outline' : 'secondary'"
          title="在被录页面上显示点击涟漪与光标光晕（录整屏或标签页时可见）"
          @click="toggleHighlight"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>
          {{ highlightOn ? '关闭点击高亮' : '点击高亮' }}
        </BaseButton>
        <!-- 暂停/继续：次要操作，收敛为 BaseButton secondary -->
        <BaseButton variant="secondary" @click="togglePause">
          <svg v-if="!paused" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          {{ paused ? '继续' : '暂停' }}
        </BaseButton>
        <!-- 停止录制：破坏/终止类操作，红色语义只保留给本按钮（danger） -->
        <BaseButton variant="danger" @click="stopRecording">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          停止录制
        </BaseButton>
      </div>
      <!-- 全局快捷键：录其他应用时侧栏按钮点不到，必须让用户知道有键盘入口 -->
      <div class="rec-hotkeys">{{ RECORD_HOTKEY_HINT }}</div>
    </div>

    <!-- 选择来源 -->
    <div v-else class="setup-panel">
      <div class="setup-header">
        <!-- 术语对齐 RECORD_TERMS.desktop =「桌面录制」 -->
        <div class="pt">桌面录制</div>
        <div class="ps">录制屏幕、窗口或标签页内容</div>
      </div>

      <!-- 录制选项 -->
      <!-- UI 三批（组3）：.opt-item 由 <label> 改为 <div>——label 包裹 button 会造成点击双重触发；
           开关本体改为 <button role="switch" :aria-checked>，可访问名由 aria-label 提供 -->
      <div class="options-row">
        <div class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/></svg>
            录制系统音频
          </span>
          <button
            type="button"
            class="tgl"
            :class="{ on: options.systemAudio }"
            role="switch"
            :aria-checked="options.systemAudio"
            aria-label="录制系统音频"
            @click="options.systemAudio = !options.systemAudio"
          ></button>
        </div>
        <div class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            录制麦克风
          </span>
          <button
            type="button"
            class="tgl"
            :class="{ on: options.microphone }"
            role="switch"
            :aria-checked="options.microphone"
            aria-label="录制麦克风"
            @click="options.microphone = !options.microphone"
          ></button>
        </div>
        <div class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/></svg>
            显示鼠标指针
          </span>
          <button
            type="button"
            class="tgl"
            :class="{ on: options.cursor }"
            role="switch"
            :aria-checked="options.cursor"
            aria-label="显示鼠标指针"
            @click="options.cursor = !options.cursor"
          ></button>
        </div>
        <!-- Round 5 #31：摄像头画中画。走 canvas 合成，与录制来源无关（录窗口/其他标签页也能进画面） -->
        <div class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            摄像头画中画
          </span>
          <button
            type="button"
            class="tgl"
            :class="{ on: options.camera.enabled }"
            role="switch"
            :aria-checked="options.camera.enabled"
            aria-label="摄像头画中画"
            @click="options.camera.enabled = !options.camera.enabled"
          ></button>
        </div>
        <!-- 按住说话：依赖麦克风，麦克风关闭时给出原因而不是让用户开了没效果 -->
        <div class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            按住说话
            <span class="opt-note">{{ options.microphone ? `按住按钮或 ${PTT_KEY_LABEL} 键才收人声` : '需先开启录制麦克风' }}</span>
          </span>
          <button
            type="button"
            class="tgl"
            :class="{ on: options.pushToTalk }"
            role="switch"
            :aria-checked="options.pushToTalk"
            aria-label="按住说话"
            :disabled="!options.microphone"
            @click="options.pushToTalk = !options.pushToTalk"
          ></button>
        </div>
        <!-- Round 5 #32：点击/光标高亮。画在被录页面上，录其他应用窗口时录不到 -->
        <div class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>
            点击/光标高亮
            <span class="opt-note">录整屏或标签页可见</span>
          </span>
          <button
            type="button"
            class="tgl"
            :class="{ on: options.cursorHighlight }"
            role="switch"
            :aria-checked="options.cursorHighlight"
            aria-label="点击/光标高亮"
            @click="options.cursorHighlight = !options.cursorHighlight"
          ></button>
        </div>
        <!-- Round 5 #33：画面增强必须在开始前开启——MediaRecorder 不能中途换视频轨 -->
        <div class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            推近聚焦 / 敏感遮挡
            <span class="opt-note">录制中可用，多一次逐帧绘制</span>
          </span>
          <button
            type="button"
            class="tgl"
            :class="{ on: options.visualFx }"
            role="switch"
            :aria-checked="options.visualFx"
            aria-label="推近聚焦与敏感遮挡"
            @click="options.visualFx = !options.visualFx"
          ></button>
        </div>
      </div>

      <!-- 定时自动停止：口径是成片时长（不含暂停），不是墙钟时间 -->
      <div class="limit-row">
        <span class="limit-row__label">定时停止</span>
        <select class="pip-select" v-model="autoStopChoice">
          <option v-for="p in AUTO_STOP_PRESETS" :key="p.seconds" :value="String(p.seconds)">{{ p.label }}</option>
          <option value="custom">自定义…</option>
        </select>
        <template v-if="autoStopChoice === 'custom'">
          <input
            type="number"
            class="limit-input"
            min="1"
            :max="AUTO_STOP_MAX_SECONDS / 60"
            v-model.number="customMinutes"
            aria-label="自定义录制分钟数"
          />
          <span class="limit-row__unit">分钟</span>
        </template>
        <span class="limit-row__hint">按成片时长计（暂停不计时）</span>
      </div>

      <!-- 画中画参数：仅在开启时出现，避免设置页长期堆一排用不上的控件 -->
      <div v-if="options.camera.enabled" class="pip-row">
        <label class="pip-field">
          <span class="pip-field__label">位置</span>
          <select class="pip-select" v-model="options.camera.position">
            <option v-for="(label, key) in PIP_POSITION_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="pip-field">
          <span class="pip-field__label">尺寸</span>
          <select class="pip-select" v-model="options.camera.size">
            <option v-for="(label, key) in PIP_SIZE_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="pip-field">
          <span class="pip-field__label">外形</span>
          <select class="pip-select" v-model="options.camera.shape">
            <option value="circle">圆形</option>
            <option value="rounded">圆角</option>
          </select>
        </label>
        <label class="pip-field pip-field--check">
          <input type="checkbox" v-model="options.camera.mirror" />
          <span class="pip-field__label">镜像</span>
        </label>
      </div>

      <!-- 画质选择 -->
      <div class="quality-row">
        <span class="quality-label">录制画质</span>
        <div class="quality-opts">
          <button
            v-for="q in qualities"
            :key="q.key"
            class="quality-btn"
            :class="{ active: options.quality === q.key }"
            @click="options.quality = q.key"
          >
            {{ q.label }}
            <span class="quality-hint">{{ q.hint }}</span>
          </button>
        </div>
      </div>

      <!-- 屏幕/窗口：提示使用系统选择器（选择器内可直接选屏幕/窗口/标签页，
           故不再单设"标签页"定向采集模式与来源切换 tab） -->
      <div class="screen-hint">
        <div class="screen-hint__icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div class="screen-hint__text">
          点击"开始录制"后，浏览器将弹出<br/>
          系统窗口供你选择录制目标
        </div>
        <div class="screen-hint__tips">
          <div class="hint-chip">整个屏幕</div>
          <div class="hint-chip">应用窗口</div>
          <div class="hint-chip">浏览器标签</div>
        </div>
      </div>

      <!-- 开始按钮 -->
      <!-- UI 三批（组1）色彩语义纠正：原为 danger 红 #ef4444，"开始录制"是主操作，
           必须 primary；红色只保留给"停止录制"。图标内小红点是"录制圆点"语义，保留 #ef4444 fill。
           loading 绑 starting（组件内置 spinner 并禁用），原 .btn-spinner 样式删除 -->
      <div class="start-wrap">
        <BaseButton
          variant="primary"
          size="md"
          block
          :loading="starting"
          @click="startRecording"
        >
          <svg v-if="!starting" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#ef4444"/></svg>
          {{ starting ? '准备中…' : '开始录制' }}
        </BaseButton>
        <div class="rec-hotkeys">{{ RECORD_HOTKEY_HINT }}</div>
      </div>
    </div>

    <!-- 录制完成列表 -->
    <div v-if="recordings.length > 0" class="recordings-list">
      <div class="recordings-list__header">
        <span>已录制文件</span>
        <span class="recordings-count">{{ recordings.length }}</span>
      </div>
      <div v-for="rec in recordings" :key="rec.id" class="rec-item">
        <div class="rec-item__icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        </div>
        <div class="rec-item__info">
          <div class="rec-item__name">{{ rec.name }}</div>
          <div class="rec-item__meta">
            <span>{{ rec.duration }}</span>
            <span>{{ rec.size }}</span>
            <!-- UI 三批（组1）：本地 .chip.chip-green 收敛为 BaseTag success/sm -->
            <BaseTag variant="success" size="sm">已完成</BaseTag>
          </div>
        </div>
        <div class="rec-item__actions">
          <!-- UI 三批（组1/组3）：三按钮收敛为 BaseButton icon（28px 方形触控目标），
               variant 分别 secondary/outline/danger；aria-label 含文件名提供可读名称 -->
          <BaseButton size="icon" variant="secondary" :aria-label="`下载录制文件 ${rec.name}`" :loading="downloadingIds.has(rec.id)" title="下载（自动转 MP4，任意播放器可打开）" @click="downloadRecording(rec)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </BaseButton>
          <BaseButton size="icon" variant="outline" :aria-label="`在全屏编辑器中打开 ${rec.name}`" title="在新标签页打开全屏编辑器" @click="openInEditor(rec)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </BaseButton>
          <BaseButton size="icon" variant="danger" :aria-label="`删除录制文件 ${rec.name}`" title="删除" @click="handleDeleteRecording(rec)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <!-- UI 三批（组1）：本地 .error-banner 整块收敛为共享 ErrorBanner（danger 语义 + 内联 SVG 图标 + aria-label 关闭钮）；
         组件内部 v-if="message" 判空，error 为 null 时传空串即自动隐藏，无需外层 v-if -->
    <div class="error-wrap">
      <ErrorBanner :message="error || ''" @close="error = null" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
// 侧栏 → 后台消息（桌面标注启停走伴生程序 companion）
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { MessageType } from '@/messaging';
// 评审 P0（UI 第一批）：破坏性操作（删除录制产物）复用全局确认对话框，不另造
import { confirmDialog } from '../composables/useConfirm';
// UI 三批（组1）：按钮/徽标/错误横幅收敛到 base 目录共享组件，删除面板内同义分叉样式
import BaseButton from '../components/base/BaseButton.vue';
import BaseTag from '../components/base/BaseTag.vue';
import ErrorBanner from '../components/base/ErrorBanner.vue';
// Round 5 #33：录制中推近聚焦与敏感区遮挡
import RecordingVisualControls from '../components/RecordingVisualControls.vue';
// UI 三批（组1）：面板补分级日志，记录桌面标注开关 / 标签页刷新失败等里程碑
import { createLogger } from '@/utils/logger';
// UI 第一批改进 · 评审 P0：录屏运行时状态（MediaRecorder/计时/暂停累计/产物列表）
// 已提升到模块级 store —— 面板组件只做视图绑定与操作入口：
//  - 切走 Tab 卸载面板不会停止录制（原 onBeforeUnmount 强停逻辑已移除）；
//  - 切回面板时从 store 恢复完整状态（计时连续、录制中标记、暂停态、产物列表）。
import type { RecordingFile } from '../services/recordingStore';
import {
  recording,
  paused,
  error,
  recordings,
  annotTabId,
  timerDisplay,
  startRecording as storeStartRecording,
  togglePause,
  stopRecording,
  deleteRecording,
  downloadRecording,
  // 转码下载中的产物 id 集合（按钮 loading 展示）
  downloadingIds,
  // Round 5 #31：按住说话与画中画的运行时态
  pttHolding,
  pttEnabled,
  cameraActive,
  cameraPip,
  setPttHolding,
  updateCameraPip,
  // Round 5 #32：定时停止倒计时与点击高亮
  autoStopCountdown,
  highlightOn,
  setCursorHighlight,
  // 摄像头实时自view：画中画画进视频轨，页面上没有浮窗，不给预览就看不到自己
  cameraPreviewStream,
  installRecordingCommandListener,
} from '../services/recordingStore';
import {
  DEFAULT_CAMERA_PIP,
  PIP_POSITION_LABELS,
  PIP_SIZE_LABELS,
  type CameraPipOptions,
  type PipPosition,
  type PipSize,
} from '@/core/cameraOverlay';
import { PTT_KEY_LABEL } from '@/core/recordingAudio';
import { AUTO_STOP_MAX_SECONDS, AUTO_STOP_PRESETS, normalizeAutoStopSeconds } from '@/core/recordingLimits';
import { RECORD_HOTKEY_HINT } from '../utils/shortcutHints';

/** 本模块 logger：统一 `[ScreenRecordPanel]` 前缀，记录标注开关等交互里程碑 */
const log = createLogger('ScreenRecordPanel');

const emit = defineEmits<{ (e: 'open-editor', rec: RecordingFile): void }>();

/** "开始录制"按钮的进行中态（面板本地：录制运行时状态在 store） */
const starting = ref(false);

/** 桌面标注层是否已开启（进程由伴生程序托管，面板只维护开关显示） */
const overlayOn = ref(false);
/** 桌面标注启停操作进行中（防止连点重复启动） */
const overlayBusy = ref(false);

// 全局快捷键（Alt+Shift+P 暂停继续 / Alt+Shift+S 停止）的接收端在 store。
// 幂等安装：面板反复挂载只装一次，录制活在模块级 store，切走 Tab 不该丢监听。
installRecordingCommandListener();

/** 摄像头自view 元素：srcObject 只能命令式赋值，模板绑不上 */
const camPreviewEl = ref<HTMLVideoElement | null>(null);

watch([camPreviewEl, cameraPreviewStream], ([el, stream]) => {
  if (el && el.srcObject !== stream) el.srcObject = stream;
}, { immediate: true });

/**
 * 开启 / 关闭桌面标注层。
 * 该标注层覆盖整个桌面（透明分层窗口），可在 PPT、播放器或其他应用窗口上绘制，
 * 整屏录制时笔迹会被一起录入；依赖 companion 伴生程序在线。
 * UI 三批（组1）：补 info/error 日志记录开关里程碑与失败原因。
 */
async function toggleDesktopOverlay() {
  if (overlayBusy.value) return;
  overlayBusy.value = true;
  // 本次操作目标动作（true=关闭、false=开启），用于日志描述
  const stopping = overlayOn.value;
  log.info(`用户点击桌面标注：请求${stopping ? '关闭' : '开启'}桌面画布层`);
  try {
    const type = stopping ? MessageType.DESKTOP_OVERLAY_STOP : MessageType.DESKTOP_OVERLAY_START;
    const resp: any = await sendRuntimeMessage({ type });
    if (resp?.success) {
      overlayOn.value = !!resp.running;
      log.info(`桌面标注操作成功，当前状态：${overlayOn.value ? '已开启' : '已关闭'}`);
    } else {
      // 伴生程序未安装 / 未开启时给出可读提示
      error.value = resp?.error || '桌面标注操作失败';
      log.error(`桌面标注操作失败：${error.value}`);
    }
  } catch (e: any) {
    error.value = '桌面标注操作失败：' + (e?.message || '未知错误');
    log.error(`桌面标注消息发送异常：${e?.message || e}`, e);
  } finally {
    overlayBusy.value = false;
  }
}

// 录制结束后自动关闭桌面标注，避免透明画布长期留在桌面上
watch(recording, (isRecording) => {
  if (!isRecording && overlayOn.value) {
    overlayOn.value = false;
    log.info('录制结束，自动关闭桌面标注层');
    void sendRuntimeMessage({ type: MessageType.DESKTOP_OVERLAY_STOP }).catch(() => { /* 关闭失败不影响录制结果 */ });
  }
});

const options = reactive({
  systemAudio: true,
  microphone: false,
  cursor: true,
  quality: 'high' as 'low' | 'medium' | 'high',
  camera: { ...DEFAULT_CAMERA_PIP } as CameraPipOptions,
  pushToTalk: false,
  cursorHighlight: false,
  visualFx: false,
});

/** 定时停止的下拉选择（'custom' 表示走自定义分钟输入） */
const autoStopChoice = ref('0');
/** 自定义分钟数（下拉选「自定义…」时生效） */
const customMinutes = ref(5);

/** 交给 store 的秒数：预设直接用，自定义按分钟换算并收敛到合法区间 */
const autoStopSeconds = computed(() => {
  if (autoStopChoice.value === 'custom') return normalizeAutoStopSeconds(customMinutes.value * 60);
  return normalizeAutoStopSeconds(autoStopChoice.value);
});

/** 录制中开关点击高亮 */
function toggleHighlight(): void {
  void setCursorHighlight(!highlightOn.value);
}

// 麦克风关掉后按住说话没有意义：同步关掉，避免下次开麦时带着一个用户没预期的开关
watch(() => options.microphone, (on) => { if (!on) options.pushToTalk = false; });

/** 按住说话按钮：pointerdown 开麦，任何形式的松开都关麦 */
function onPttDown(): void { setPttHolding(true); }
function onPttUp(): void { setPttHolding(false); }

/** 录制中改画中画停靠角（合成器热更新，不停录） */
function setPipPosition(value: string): void {
  if (!cameraPip.value) return;
  updateCameraPip({ ...cameraPip.value, position: value as PipPosition });
}

/** 录制中改画中画尺寸 */
function setPipSize(value: string): void {
  if (!cameraPip.value) return;
  updateCameraPip({ ...cameraPip.value, size: value as PipSize });
}

const qualities = [
  { key: 'low' as const, label: '标清', hint: '720p' },
  { key: 'medium' as const, label: '高清', hint: '1080p' },
  { key: 'high' as const, label: '超清', hint: '2K' },
];

/**
 * "开始录制"入口（面板本地包装）：
 * 采集/编码运行时逻辑已全部迁移到 recordingStore（评审 P0：切 tab 不中断录制），
 * 这里仅负责传入当前面板配置（录制选项）并维护按钮 loading 态。
 * 录制目标（屏幕/窗口/标签页）统一由系统选择器决定，面板不再单设标签页模式。
 */
async function startRecording() {
  starting.value = true;
  try {
    await storeStartRecording({ options: { ...options, autoStopSeconds: autoStopSeconds.value } });
  } finally {
    starting.value = false;
  }
}

/**
 * 删除录制产物入口（评审 P0：破坏性操作补确认）：
 * 先弹确认框说明后果（永久删除、无法找回），确认后才调用 store
 * 释放 blob URL 并从产物列表移除；取消则不做任何操作。
 * @param rec 目标录制产物
 */
async function handleDeleteRecording(rec: RecordingFile) {
  const ok = await confirmDialog({
    title: '删除录制文件',
    message: `将永久删除「${rec.name}」（${rec.duration} · ${rec.size}），删除后无法找回；如需保留请先下载。`,
    danger: true,
    confirmText: '删除',
  });
  if (!ok) return;
  deleteRecording(rec);
}

/** 在新标签页打开全屏编辑器：把产物交给 SidePanelApp 统一处理 */
function openInEditor(rec: RecordingFile) {
  emit('open-editor', rec);
}

// 录制/暂停/计时/产物状态由 store 持有，组件重新挂载即自动恢复显示。
// 注意：此处刻意不再注册 onBeforeUnmount 停止录制 —— 切走 Tab 只卸载视图，
// 录制与计时由 store 继续维护（评审 P0 的核心修复点）。
</script>

<style scoped>
/* UI 三批（组1）：#d97706 硬编码 → warning token；rgba 半透明装饰底保留 */
.annot-hint {
  margin: 8px 16px 0;
  padding: 7px 10px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.10);
  color: var(--sp-color-warning);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}
.screen-record-panel { display: flex; flex-direction: column; gap: 0; }

/* header */
.setup-header { padding: 14px 14px 10px; }
.pt { font-size: 15px; font-weight: 600; color: var(--sp-color-heading); }
/* 组2：正文级信息文字 11px → 12px */
.ps { font-size: 12px; color: var(--sp-color-muted); margin-top: 2px; }

/* recording overlay */
.recording-overlay {
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  background: rgba(239,68,68,0.04);
  border-bottom: 1px solid var(--sp-color-border);
}

.recording-status {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 组1 色彩 token 化：录制指示红改用 danger token（rgba 光晕为装饰底，保留） */
.rec-pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--sp-color-danger);
  animation: pulse-red 1.2s ease infinite;
  flex-shrink: 0;
}

@keyframes pulse-red {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
  50% { opacity: 0.8; box-shadow: 0 0 0 6px rgba(239,68,68,0); }
}

.rec-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--sp-color-danger);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.rec-timer {
  font-size: 28px;
  font-weight: 700;
  color: var(--sp-color-heading);
  font-family: var(--sp-font-mono, monospace);
  letter-spacing: 0.05em;
}

.recording-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

/* UI 三批（组1）：.ctrl-btn / .ctrl-btn--pause / .ctrl-btn--annot / .ctrl-btn--stop
   全部由 BaseButton（secondary/outline/danger）替代，本地分叉样式删除 */
/* 录制中来源信息条（.recording-info）随"标签页"定向采集模式一并删除：
   录制目标统一由系统选择器决定，无面板内来源名可展示 */

/* options */
.options-row {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0 14px 10px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
  background: var(--sp-color-surface);
}

/* 组3：.opt-item 由 label 改为 div（label 包 button 会双重触发），
   行不再是点击目标，cursor 恢复默认，仅保留悬停反馈 */
.opt-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid var(--sp-color-border);
  transition: background var(--sp-transition-fast);
}

.opt-item:last-child { border-bottom: none; }
.opt-item:hover { background: var(--sp-color-surface-hover); }

.opt-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--sp-color-text);
  user-select: none;
}

/* quality */
.quality-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 10px;
  gap: 10px;
}

/* 组2：字段标签属信息性文字 11px → 12px */
.quality-label { font-size: 12px; color: var(--sp-color-muted); flex-shrink: 0; }

.quality-opts { display: flex; gap: 4px; }

.quality-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5px 12px;
  border-radius: var(--sp-radius-sm);
  border: 1px solid var(--sp-color-border-strong);
  background: var(--sp-color-surface);
  color: var(--sp-color-text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--sp-font-family);
  transition: all var(--sp-transition-fast);
  line-height: 1.3;
}

.quality-btn.active {
  border-color: var(--sp-color-primary);
  background: var(--sp-color-primary-light);
  color: var(--sp-color-primary);
}

/* 纯标注（画质参数注记）：允许 11px */
.quality-hint { font-size: 11px; opacity: 0.7; }

/* 标签页列表相关样式（.source-list/.tab-list/.source-item 等）随"标签页"
   定向采集模式一并删除；@keyframes spin 仅 .mini-spinner 使用，同步删除 */

/* screen hint */
.screen-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 14px;
  text-align: center;
}

.screen-hint__icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sp-color-muted);
}

/* 组2：引导正文 11px → 12px */
.screen-hint__text { font-size: 12px; color: var(--sp-color-text-secondary); line-height: 1.6; }

.screen-hint__tips { display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; }
/* 纯标注胶囊：允许 11px */
.hint-chip {
  font-size: 11px;
  padding: 3px 8px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: 999px;
  color: var(--sp-color-muted);
}

/* start button */
/* UI 三批（组1）：.start-btn / .btn-spinner 由 BaseButton primary md block + :loading 替代；
   外层仅保留与原按钮一致的页边距容器 */
.start-wrap { margin: 0 14px 14px; }

/* toggle */
/* 组3：开关本体改为 <button role="switch">（div @click 不可键盘操作）。
   视觉仍为 30×17，appearance/padding 复位原生按钮默认样式 */
.tgl {
  width: 30px; height: 17px;
  background: var(--sp-color-bg-elevated);
  border-radius: 999px;
  border: 1px solid var(--sp-color-border-strong);
  cursor: pointer;
  position: relative;
  transition: background var(--sp-transition-fast);
  flex-shrink: 0;
  appearance: none;
  padding: 0;
}
/* 组3 触控目标 ≥24px：透明 ::before 把可点区向四周扩展（上下各 4px → 25px 高），视觉尺寸不变 */
.tgl::before {
  content: '';
  position: absolute;
  inset: -4px -1px;
}
.tgl:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: 2px; }
.tgl.on { background: var(--sp-color-primary); border-color: transparent; }
.tgl::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 11px; height: 11px;
  border-radius: 50%;
  background: var(--sp-color-muted);
  transition: left var(--sp-transition-fast), background var(--sp-transition-fast);
}
.tgl.on::after { left: 15px; background: white; }
.tgl:disabled { opacity: 0.45; cursor: not-allowed; }

/* Round 5 #31：选项行内的补充说明（为什么这个开关现在不可用） */
.opt-note { font-size: 11px; color: var(--sp-color-muted); margin-left: 2px; }

/* 画中画参数行 */
.pip-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 14px 10px;
  padding: 8px 10px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  background: var(--sp-color-surface);
}
.pip-field { display: flex; align-items: center; gap: 5px; }
.pip-field--check { cursor: pointer; }
.pip-field__label { font-size: 12px; color: var(--sp-color-muted); }
.pip-select {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  background: var(--sp-color-bg-elevated);
  color: var(--sp-color-text);
  font-family: var(--sp-font-family);
  cursor: pointer;
}
.pip-select:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: 1px; }

/* 按住说话：按下态用主色实心，松开态描边，状态差异要一眼可辨 */
.ptt-wrap { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 100%; }
.ptt-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 18px;
  border-radius: 999px;
  border: 1px solid var(--sp-color-primary);
  background: var(--sp-color-surface);
  color: var(--sp-color-primary);
  font-size: 13px;
  font-weight: 600;
  font-family: var(--sp-font-family);
  cursor: pointer;
  user-select: none;
  touch-action: none;
  transition: background var(--sp-transition-fast), color var(--sp-transition-fast);
}
.ptt-btn.is-holding { background: var(--sp-color-primary); color: #fff; }
.ptt-btn:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: 2px; }
.ptt-hint { font-size: 11px; color: var(--sp-color-muted); text-align: center; }

/* 录制中的画中画微调条 */
.pip-live { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pip-live__label { font-size: 12px; color: var(--sp-color-muted); }

/* 摄像头自view：形状/镜像跟随画中画设置，让用户看到的和录进去的一致 */
.pip-cam {
  width: 64px;
  height: 36px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--sp-color-border-strong);
  background: #000;
  flex-shrink: 0;
}
.pip-cam.is-circle { width: 40px; height: 40px; border-radius: 50%; }
.pip-cam.is-mirror { transform: scaleX(-1); }

/* 全局快捷键提示：弱于操作按钮，但录其他应用时它是唯一的操作入口说明 */
.rec-hotkeys {
  margin: 8px 16px 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--sp-color-muted);
}
.start-wrap .rec-hotkeys { margin: 8px 0 0; text-align: center; }

/* Round 5 #32：自动停止倒计时（跟在计时后面，弱于主计时但可读） */
.rec-limit {
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-color-warning);
  font-family: var(--sp-font-mono, monospace);
  padding: 2px 7px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.10);
}

/* 定时停止设置行 */
.limit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 14px 10px;
}
.limit-row__label { font-size: 12px; color: var(--sp-color-muted); flex-shrink: 0; }
.limit-row__unit { font-size: 12px; color: var(--sp-color-muted); }
.limit-row__hint { font-size: 11px; color: var(--sp-color-muted); }
.limit-input {
  width: 64px;
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  background: var(--sp-color-bg-elevated);
  color: var(--sp-color-text);
  font-family: var(--sp-font-family);
}
.limit-input:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: 1px; }

/* recordings list */
.recordings-list {
  border-top: 1px solid var(--sp-color-border);
  padding: 12px 14px;
}

/* 大写小标题属纯标注：允许 11px */
.recordings-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-color-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}

.recordings-count {
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  border-radius: 999px;
  font-size: 11px;
  padding: 1px 6px;
  color: var(--sp-color-text);
}

.rec-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--sp-color-border);
}

.rec-item:last-child { border-bottom: none; }

/* 组1 色彩 token 化：录制产物图标红改用 danger token（rgba 底为装饰，保留） */
.rec-item__icon {
  width: 30px; height: 30px;
  border-radius: 8px;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.2);
  color: var(--sp-color-danger);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rec-item__info { flex: 1; min-width: 0; }
/* 组2：产物名称/元信息属信息性文字 11px → 12px */
.rec-item__name { font-size: 12px; font-weight: 500; color: var(--sp-color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rec-item__meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 12px; color: var(--sp-color-muted); }

.rec-item__actions { display: flex; gap: 4px; flex-shrink: 0; }

/* UI 三批（组1）：.icon-btn / .icon-btn--primary / .icon-btn--danger 由
   BaseButton size=icon（secondary/outline/danger）替代；
   .chip/.chip-green 由 BaseTag success/sm 替代——本地分叉样式全部删除 */

/* error banner */
/* UI 三批（组1）：.error-banner/.banner-close 由共享 ErrorBanner 组件替代，
   外层容器仅保留原 14px 页边距（组件自身带纵向 margin） */
.error-wrap { margin: 0 14px; }
</style>
