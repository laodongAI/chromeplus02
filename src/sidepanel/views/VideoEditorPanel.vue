<template>
  <div class="editor" ref="editorRoot">

    <!-- ══ 空状态 ══ -->
    <div v-if="clips.length === 0" class="editor-empty">
      <div class="empty-icon">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </div>
      <div class="empty-title">视频编辑器</div>
      <div class="empty-sub">上传一个或多个视频文件开始编辑</div>
      <label class="upload-cta">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        上传视频文件
        <input type="file" accept="video/*" multiple @change="handleUpload" style="display:none">
      </label>
    </div>

    <!-- ══ 编辑主界面 ══ -->
    <div v-else class="editor-main">

      <!-- 顶栏 -->
      <div class="e-topbar">
        <div class="e-topbar-l">
          <div class="e-logo">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </div>
          <span class="e-title">视频编辑器</span>
          <span class="e-seg-badge">{{ clips.length }} 个片段</span>
        </div>
        <div class="e-topbar-r">
          <label class="e-add-btn">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            添加片段
            <input type="file" accept="video/*" multiple @change="handleUpload" style="display:none">
          </label>
          <button class="e-export-btn" @click="exportVideo" :disabled="exporting">
            <span v-if="exporting" class="btn-spin"></span>
            <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {{ exporting ? '导出中…' : '导出视频' }}
          </button>
        </div>
      </div>

      <!-- 左右分栏布局 -->
      <div class="editor-body">

        <!-- ── 左列：预览 + 时间轴 ── -->
        <div class="editor-left">

          <!-- 视频预览 -->
          <div class="preview-wrap" ref="previewWrap">
            <video
              ref="videoEl"
              class="preview-video"
              @timeupdate="onTimeUpdate"
              @ended="onEnded"
            ></video>
            <div v-if="!activeClip" class="preview-placeholder">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
              <span>选择片段开始预览</span>
            </div>
            <!-- 字幕叠加 -->
            <div v-if="activeCaption" class="cap-overlay" :class="`cap-pos--${activeCaption.position}`"
              :style="{ color: activeCaption.color, fontSize: capFontSize }">
              {{ activeCaption.text }}
            </div>
          </div>

          <!-- 播放控件 -->
          <div class="player-bar">
            <div class="player-btns">
              <button class="p-btn" @click="stepBack" title="后退5秒">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="11 17 6 12 11 7"/><line x1="18" y1="7" x2="18" y2="17"/></svg>
              </button>
              <button class="p-btn p-btn--play" @click="togglePlay">
                <svg v-if="!isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              </button>
              <button class="p-btn" @click="stepForward" title="前进5秒">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="13 17 18 12 13 7"/><line x1="6" y1="7" x2="6" y2="17"/></svg>
              </button>
            </div>
            <div class="player-time">{{ formatTime(currentTime) }} / {{ formatTime(totalDuration) }}</div>
            <input type="range" class="seek-bar" :max="totalDuration" :value="currentTime" step="0.02" @input="seekTo" />
            <div class="vol-row">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              <input type="range" class="vol-bar" min="0" max="1" step="0.05" :value="volume" @input="changeVolume" />
            </div>
            <span class="speed-pill" @click="cycleSpeed" title="点击切换速度">{{ playbackRate }}×</span>
          </div>

          <!-- 时间轴 -->
          <div class="timeline">
            <div class="tl-header">
              <span class="tl-header-label">多轨时间轴</span>
              <div class="tl-zoom-btns">
                <button class="tl-z-btn" @click="zoomOut" title="缩小">－</button>
                <button class="tl-z-btn" @click="fitTimeline" title="适应">⊡</button>
                <button class="tl-z-btn" @click="zoomIn" title="放大">＋</button>
              </div>
            </div>

            <!-- 刻度尺 -->
            <div class="tl-ruler" ref="rulerEl" @click="seekOnRuler">
              <div class="tl-ruler-inner" :style="{ width: tlPx + 'px' }">
                <div v-for="tick in rulerTicks" :key="tick.t" class="tl-tick" :style="{ left: tick.x + 'px' }">
                  <span class="tl-tick-t">{{ formatTime(tick.t) }}</span>
                </div>
              </div>
              <div class="tl-playhead" :style="{ left: playheadPx + 'px' }" @mousedown.stop="dragPlayhead"></div>
            </div>

            <!-- 视频轨 -->
            <div class="tl-row">
              <div class="tl-row-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                视频
              </div>
              <div class="tl-row-body" @click.self="seekOnTrack">
                <div
                  v-for="(clip, i) in clips"
                  :key="clip.id"
                  class="tl-clip"
                  :class="{ active: activeClipIndex === i }"
                  :style="clipStyle(clip, i)"
                  @mousedown.stop="dragClip(i, $event)"
                  @click.stop="selectClip(i)"
                >
                  <div class="clip-hndl clip-hndl--l" @mousedown.stop="trimClip(i,'start',$event)"></div>
                  <div class="clip-body">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                    <span class="clip-name">{{ clip.name }}</span>
                    <span class="clip-dur">{{ formatTime(clip.trimEnd - clip.trimStart) }}</span>
                  </div>
                  <div class="clip-hndl clip-hndl--r" @mousedown.stop="trimClip(i,'end',$event)"></div>
                </div>
              </div>
            </div>

            <!-- 音频轨 -->
            <div class="tl-row">
              <div class="tl-row-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>
                音频
              </div>
              <div class="tl-row-body tl-row-body--audio">
                <div v-if="bgMusicFile" class="tl-clip tl-clip--audio" style="left:0;right:0;width:100%">
                  <div class="clip-body" style="padding:0 8px">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/></svg>
                    <span class="clip-name">{{ bgMusicFile.name }}</span>
                  </div>
                </div>
                <div v-else class="tl-row-empty">
                  <label class="tl-add-label">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    添加背景音乐
                    <input type="file" accept="audio/*" @change="loadBgMusic" style="display:none">
                  </label>
                </div>
              </div>
            </div>

            <!-- 字幕轨 -->
            <div class="tl-row">
              <div class="tl-row-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                字幕
              </div>
              <div class="tl-row-body tl-row-body--caption">
                <div v-for="(cap, i) in captions" :key="i"
                  class="tl-clip tl-clip--caption"
                  :style="capStyle(cap)"
                  @click="editCap(i)"
                  :title="cap.text">
                  <span class="cap-clip-text">{{ cap.text }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── 右列：工具面板 ── -->
        <div class="editor-right">
          <!-- 工具标签 -->
          <div class="tool-tabs">
            <button v-for="t in toolTabs" :key="t.key"
              class="tool-tab" :class="{ active: activeTool === t.key }"
              @click="activeTool = t.key">
              <span class="tt-icon" v-html="t.icon"></span>
              {{ t.label }}
            </button>
          </div>

          <!-- 工具内容 — 可滚动 -->
          <div class="tool-content">

            <!-- 片段属性 -->
            <div v-if="activeTool === 'clip'">
              <div v-if="!activeClip" class="tool-hint">在时间轴上点击选择片段</div>
              <div v-else class="tool-section">
                <div class="field-label">片段名称</div>
                <input class="field-input" type="text" v-model="activeClip.name" />

                <div class="field-label" style="margin-top:10px">剪辑范围（秒）</div>
                <div class="field-row">
                  <div class="field-group">
                    <span class="fg-label">入点</span>
                    <input class="field-input-sm" type="number"
                      :value="activeClip.trimStart.toFixed(2)"
                      @change="e => setTrimStart(+(e.target as HTMLInputElement).value)"
                      step="0.1" min="0" />
                  </div>
                  <span class="field-arrow">→</span>
                  <div class="field-group">
                    <span class="fg-label">出点</span>
                    <input class="field-input-sm" type="number"
                      :value="activeClip.trimEnd.toFixed(2)"
                      @change="e => setTrimEnd(+(e.target as HTMLInputElement).value)"
                      step="0.1" />
                  </div>
                  <div class="field-static">{{ formatTime(activeClip.trimEnd - activeClip.trimStart) }}</div>
                </div>
                <div class="btn-row" style="margin-top:6px">
                  <button class="tool-btn" @click="setTrimStart(currentTime)">← 标记入点</button>
                  <button class="tool-btn" @click="setTrimEnd(currentTime)">标记出点 →</button>
                  <button class="tool-btn tool-btn--danger" @click="removeClip(activeClipIndex)">移除片段</button>
                </div>

                <div class="field-label" style="margin-top:12px">片段音量</div>
                <div class="slider-row">
                  <input type="range" class="p-slider" min="0" max="200" :value="activeClip.volume"
                    @input="e => { activeClip!.volume = +(e.target as HTMLInputElement).value; applyVolume(); }" />
                  <span class="s-val">{{ activeClip.volume }}%</span>
                </div>

                <div class="field-label" style="margin-top:12px">播放速度</div>
                <div class="speed-grid">
                  <button v-for="s in speeds" :key="s" class="speed-btn"
                    :class="{ active: activeClip.speed === s }"
                    @click="setClipSpeed(s)">{{ s }}×</button>
                </div>
              </div>
            </div>

            <!-- 滤镜 -->
            <div v-if="activeTool === 'filter'">
              <div v-if="!activeClip" class="tool-hint">请先选择片段</div>
              <div v-else class="tool-section">
                <div class="field-label">快速预设</div>
                <div class="preset-grid">
                  <button v-for="p in presets" :key="p.name" class="preset-btn"
                    :class="{ active: activeClip.preset === p.name }"
                    @click="applyPreset(p)">{{ p.name }}</button>
                </div>
                <div class="field-label" style="margin-top:12px">手动调节</div>
                <div v-for="f in filterParams" :key="f.key" class="slider-row" style="margin-bottom:8px">
                  <span class="s-label">{{ f.label }}</span>
                  <input type="range" class="p-slider" :min="f.min" :max="f.max"
                    :value="activeClip.filters[f.key]"
                    @input="e => { activeClip!.filters[f.key]=+(e.target as HTMLInputElement).value; applyFilters(); }" />
                  <span class="s-val">{{ activeClip.filters[f.key] }}{{ f.unit }}</span>
                  <button class="s-reset" @click="activeClip!.filters[f.key]=f.default;applyFilters()">↺</button>
                </div>
              </div>
            </div>

            <!-- 转场 -->
            <div v-if="activeTool === 'transition'" class="tool-section">
              <div class="field-label">片段间转场效果</div>
              <div class="tr-grid">
                <button v-for="tr in transitions" :key="tr.key" class="tr-btn"
                  :class="{ active: activeTransition === tr.key }"
                  @click="activeTransition = tr.key">
                  <span class="tr-ic" v-html="tr.icon"></span>
                  {{ tr.label }}
                </button>
              </div>
              <div class="field-label" style="margin-top:12px">转场时长</div>
              <div class="slider-row">
                <input type="range" class="p-slider" min="0.2" max="2" step="0.1" v-model.number="trDuration" />
                <span class="s-val">{{ trDuration.toFixed(1) }}s</span>
              </div>
            </div>

            <!-- 字幕 -->
            <div v-if="activeTool === 'caption'" class="tool-section">
              <div class="field-label">{{ editingCapIdx >= 0 ? '编辑字幕' : '添加字幕' }}</div>
              <textarea class="cap-textarea" v-model="newCap.text" rows="2" placeholder="输入字幕文字…"></textarea>
              <div class="field-row" style="margin-top:6px">
                <div class="field-group">
                  <span class="fg-label">出现(秒)</span>
                  <input class="field-input-sm" type="number" v-model.number="newCap.start" min="0" step="0.1" />
                </div>
                <span class="field-arrow">→</span>
                <div class="field-group">
                  <span class="fg-label">消失(秒)</span>
                  <input class="field-input-sm" type="number" v-model.number="newCap.end" :min="newCap.start+0.3" step="0.1" />
                </div>
              </div>
              <div class="field-row" style="margin-top:6px;align-items:center">
                <select class="field-select" v-model="newCap.position">
                  <option value="bottom">底部</option><option value="top">顶部</option><option value="center">居中</option>
                </select>
                <input type="color" class="color-pick" v-model="newCap.color" title="文字颜色" />
                <select class="field-select" v-model="newCap.size">
                  <option value="sm">小字</option><option value="md">中字</option><option value="lg">大字</option>
                </select>
                <button class="tool-btn tool-btn--primary" @click="submitCap" :disabled="!newCap.text">
                  {{ editingCapIdx >= 0 ? '更新' : '添加' }}
                </button>
                <button v-if="editingCapIdx >= 0" class="tool-btn" @click="cancelEditCap">取消</button>
              </div>
              <div class="field-label" style="margin-top:14px">字幕列表</div>
              <div v-if="captions.length === 0" class="tool-hint">暂无字幕</div>
              <div v-for="(cap, i) in captions" :key="i" class="cap-row" :class="{ 'cap-row--editing': editingCapIdx===i }">
                <span class="cap-row-time">{{ formatTime(cap.start) }}–{{ formatTime(cap.end) }}</span>
                <span class="cap-row-text">{{ cap.text }}</span>
                <button class="icon-btn" @click="editCap(i)" title="编辑">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="icon-btn icon-btn--del" @click="captions.splice(i,1);if(editingCapIdx===i)cancelEditCap()" title="删除">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>

            <!-- 配音 -->
            <div v-if="activeTool === 'dub'" class="tool-section">
              <div class="field-label">背景音乐</div>
              <label class="file-drop">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/></svg>
                {{ bgMusicFile ? bgMusicFile.name : '点击添加背景音乐 (MP3 / WAV / M4A)' }}
                <input type="file" accept="audio/*" @change="loadBgMusic" style="display:none" />
              </label>
              <div v-if="bgMusicFile" class="slider-row" style="margin-top:6px">
                <span class="s-label">音量</span>
                <input type="range" class="p-slider" min="0" max="200" v-model.number="bgVolume" />
                <span class="s-val">{{ bgVolume }}%</span>
                <button class="s-reset" style="color:var(--sp-color-danger)" @click="bgMusicFile=null">×</button>
              </div>

              <div class="field-label" style="margin-top:14px">麦克风配音</div>
              <div class="dub-row">
                <button class="dub-btn" :class="{ 'dub-btn--rec': dubRecording }" @click="toggleDub">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                  {{ dubRecording ? `停止配音 (${formatTime(dubElapsed)})` : '开始配音' }}
                </button>
                <span class="dub-hint">从当前播放位置录制</span>
              </div>
              <div v-for="(d, i) in dubClips" :key="i" class="dub-clip">
                <div class="dub-clip-meta"><span>配音{{ i+1 }}</span><span class="dub-at">@ {{ formatTime(d.at) }}</span></div>
                <audio :src="d.url" controls style="flex:1;height:24px"></audio>
                <button class="icon-btn icon-btn--del" @click="dubClips.splice(i,1)">×</button>
              </div>
            </div>

            <!-- 片段管理 -->
            <div v-if="activeTool === 'clips'" class="tool-section">
              <div class="field-label">片段顺序（拖动 ☰ 排序）</div>
              <div class="clips-list">
                <div v-for="(clip, i) in clips" :key="clip.id"
                  class="clip-row" :class="{ 'clip-row--active': activeClipIndex===i }"
                  @click="selectClip(i)">
                  <div class="clip-row-drag"
                    draggable="true"
                    @dragstart="dragFrom=i"
                    @dragover.prevent
                    @drop.prevent="dropClip(i)">☰</div>
                  <div class="clip-row-thumb">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                  </div>
                  <div class="clip-row-info">
                    <div class="clip-row-name">{{ clip.name }}</div>
                    <div class="clip-row-meta">{{ formatTime(clip.trimEnd - clip.trimStart) }} · {{ clip.speed }}× · {{ clip.preset }}</div>
                  </div>
                  <div class="clip-row-btns">
                    <button class="icon-btn" @click.stop="moveClip(i,-1)" :disabled="i===0">↑</button>
                    <button class="icon-btn" @click.stop="moveClip(i,1)" :disabled="i===clips.length-1">↓</button>
                    <button class="icon-btn icon-btn--del" @click.stop="removeClip(i)">×</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 导出遮罩 -->
    <div v-if="exporting" class="export-mask">
      <div class="export-card">
        <div class="export-spin"></div>
        <div class="export-title">正在导出视频</div>
        <div class="export-sub">{{ exportMsg }}</div>
        <div class="export-track"><div class="export-fill" :style="{ width: exportPct+'%' }"></div></div>
        <span class="export-pct">{{ Math.round(exportPct) }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

// ── 类型 ──────────────────────────────────────────────────────
interface VideoClip {
  id: string; name: string; blob: Blob; url: string; duration: number;
  trimStart: number; trimEnd: number; offset: number;
  volume: number; speed: number; preset: string; filters: Record<string, number>;
}
interface Caption {
  text: string; start: number; end: number;
  position: 'top'|'center'|'bottom'; color: string; size: 'sm'|'md'|'lg';
}
interface DubClip { at: number; url: string; duration: number; }

const props = defineProps<{ initialFiles?: { name: string; blob: Blob; url: string }[] }>();

// ── 状态 ──────────────────────────────────────────────────────
const clips      = ref<VideoClip[]>([]);
const captions   = ref<Caption[]>([]);
const dubClips   = ref<DubClip[]>([]);
const bgMusicFile = ref<File|null>(null);
const bgVolume   = ref(80);
const activeClipIndex = ref(-1);
const activeTool  = ref<'clip'|'filter'|'transition'|'caption'|'dub'|'clips'>('clip');

const videoEl    = ref<HTMLVideoElement|null>(null);
const rulerEl    = ref<HTMLElement|null>(null);
// 播放引擎状态
const isPlaying  = ref(false);
const currentTime = ref(0);      // 全局时间线时间
const volume     = ref(1);
const playbackRate = ref(1);
const speeds     = [0.5, 0.75, 1, 1.25, 1.5, 2];

// 播放引擎内部
let playingClipIdx   = -1;       // 正在播放的 clip 索引
let playingClipLocal = 0;        // 该 clip 内部的起始时间
let clipSwitching    = false;    // 防止重入

const pxPerSec    = ref(50);
const exporting   = ref(false);
const exportPct   = ref(0);
const exportMsg   = ref('');
const activeTransition = ref('fade');
const trDuration  = ref(0.5);
let dragFrom      = -1;

const dubRecording = ref(false);
const dubElapsed   = ref(0);
let dubRec: MediaRecorder|null = null;
let dubTimer: number|null = null;

const editingCapIdx = ref(-1);
const newCap = reactive<Caption>({ text:'', start:0, end:3, position:'bottom', color:'#ffffff', size:'md' });

// ── 计算属性 ──────────────────────────────────────────────────
const activeClip = computed(() => activeClipIndex.value >= 0 ? clips.value[activeClipIndex.value] ?? null : null);

const totalDuration = computed(() => {
  if (!clips.value.length) return 10;
  return Math.max(...clips.value.map(c => c.offset + (c.trimEnd - c.trimStart) / c.speed));
});

const tlPx = computed(() => Math.max(200, Math.ceil(totalDuration.value * pxPerSec.value) + 60));

// 播放头的全局位置（px）
const playheadPx = computed(() => currentTime.value * pxPerSec.value);

const rulerTicks = computed(() => {
  const step = pxPerSec.value >= 80 ? 1 : pxPerSec.value >= 40 ? 2 : 5;
  const ticks: { t: number; x: number }[] = [];
  for (let t = 0; t <= totalDuration.value + step; t += step)
    ticks.push({ t, x: Math.round(t * pxPerSec.value) });
  return ticks;
});

const activeCaption = computed(() => {
  // 按全局时间查字幕
  return captions.value.find(c => currentTime.value >= c.start && currentTime.value < c.end) ?? null;
});
const capFontSize = computed(() => ({ sm:'12px', md:'15px', lg:'20px' }[activeCaption.value?.size ?? 'md']));

// 播放器显示用时间（当前 clip 的本地时间）
const displayCurrentTime = computed(() => {
  const clip = clips.value[playingClipIdx >= 0 ? playingClipIdx : activeClipIndex.value];
  if (!clip || !videoEl.value) return 0;
  return videoEl.value.currentTime;
});
const displayEndTime = computed(() => {
  const clip = clips.value[playingClipIdx >= 0 ? playingClipIdx : activeClipIndex.value];
  return clip?.trimEnd ?? 0;
});

// ── 滤镜 ──────────────────────────────────────────────────────
const filterParams = [
  { key:'brightness', label:'亮度',   min:0,    max:200,  default:100, unit:'%' },
  { key:'contrast',   label:'对比度', min:0,    max:200,  default:100, unit:'%' },
  { key:'saturation', label:'饱和度', min:0,    max:200,  default:100, unit:'%' },
  { key:'blur',       label:'模糊',   min:0,    max:10,   default:0,   unit:'px' },
  { key:'hueRotate',  label:'色调',   min:-180, max:180,  default:0,   unit:'°' },
];
const presets = [
  { name:'原始',   v:{ brightness:100, contrast:100, saturation:100, blur:0, hueRotate:0  } },
  { name:'复古',   v:{ brightness:90,  contrast:115, saturation:55,  blur:0, hueRotate:18 } },
  { name:'冷色调', v:{ brightness:100, contrast:108, saturation:85,  blur:0, hueRotate:-18} },
  { name:'暖色调', v:{ brightness:108, contrast:100, saturation:125, blur:0, hueRotate:14 } },
  { name:'高对比', v:{ brightness:100, contrast:155, saturation:110, blur:0, hueRotate:0  } },
  { name:'黑白',   v:{ brightness:100, contrast:115, saturation:0,   blur:0, hueRotate:0  } },
  { name:'梦幻',   v:{ brightness:115, contrast:90,  saturation:80,  blur:1, hueRotate:25 } },
  { name:'胶片',   v:{ brightness:95,  contrast:105, saturation:70,  blur:0, hueRotate:-8 } },
];
const defaultFilters = () => ({ brightness:100, contrast:100, saturation:100, blur:0, hueRotate:0 });

const videoFilterStyle = computed(() => {
  const f = activeClip.value?.filters ?? (playingClipIdx >= 0 ? clips.value[playingClipIdx]?.filters : null);
  if (!f) return {};
  return { filter: `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px) hue-rotate(${f.hueRotate}deg)` };
});

// ── 转场 ──────────────────────────────────────────────────────
const transitions = [
  { key:'none',     label:'无',       icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>` },
  { key:'fade',     label:'淡入淡出', icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5" opacity=".5"/><circle cx="12" cy="12" r="2"/></svg>` },
  { key:'slide',    label:'滑动',     icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>` },
  { key:'zoom',     label:'缩放',     icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>` },
  { key:'dissolve', label:'溶解',     icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>` },
  { key:'wipe',     label:'擦除',     icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="10" height="14" rx="1"/><rect x="12" y="5" width="10" height="14" rx="1" opacity=".4"/></svg>` },
];

// ── 工具标签 ──────────────────────────────────────────────────
const toolTabs = [
  { key:'clip',       label:'属性', icon:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>` },
  { key:'filter',     label:'滤镜', icon:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M1.05 12H7M17.01 12h5.95M12 6.93V1.07M12 22.93V17"/></svg>` },
  { key:'transition', label:'转场', icon:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>` },
  { key:'caption',    label:'字幕', icon:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>` },
  { key:'dub',        label:'配音', icon:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>` },
  { key:'clips',      label:'片段', icon:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/></svg>` },
];

// ── 加载初始文件 ──────────────────────────────────────────────
let pendingSelect = false;
watch(() => props.initialFiles, (files) => {
  if (!files?.length) return;
  files.forEach(f => {
    const url = f.url;
    const v = document.createElement('video');
    v.preload = 'metadata'; v.src = url;
    v.onloadedmetadata = () => {
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 10;
      const offset = clips.value.length
        ? clips.value.reduce((acc, c) => Math.max(acc, c.offset + (c.trimEnd - c.trimStart) / c.speed), 0) : 0;
      clips.value.push({
        id: `clip_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        name: f.name.replace(/\.[^.]+$/, ''),
        blob: f.blob, url, duration: dur, trimStart: 0, trimEnd: dur,
        offset, volume: 100, speed: 1, preset: '原始', filters: defaultFilters(),
      });
      if (clips.value.length === 1) {
        if (videoEl.value) { activeClipIndex.value = 0; loadClipIntoPlayer(0); }
        else pendingSelect = true;
      }
    };
    v.onerror = () => {
      clips.value.push({
        id: `clip_${Date.now()}`, name: f.name.replace(/\.[^.]+$/, ''),
        blob: f.blob, url, duration: 10, trimStart: 0, trimEnd: 10,
        offset: 0, volume: 100, speed: 1, preset: '原始', filters: defaultFilters(),
      });
    };
  });
}, { immediate: true });

onMounted(() => {
  if (pendingSelect && clips.value.length > 0) {
    nextTick(() => { activeClipIndex.value = 0; loadClipIntoPlayer(0); });
    pendingSelect = false;
  }
});

// ── 上传 ──────────────────────────────────────────────────────
function handleUpload(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  files.forEach(f => {
    const url = URL.createObjectURL(f);
    const v = document.createElement('video');
    v.preload = 'metadata'; v.src = url;
    v.onloadedmetadata = () => {
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 10;
      const offset = clips.value.length
        ? clips.value.reduce((acc, c) => Math.max(acc, c.offset + (c.trimEnd - c.trimStart) / c.speed), 0) : 0;
      clips.value.push({
        id: `clip_${Date.now()}`, name: f.name.replace(/\.[^.]+$/, ''),
        blob: f, url, duration: dur, trimStart: 0, trimEnd: dur,
        offset, volume: 100, speed: 1, preset: '原始', filters: defaultFilters(),
      });
      if (clips.value.length === 1) nextTick(() => { activeClipIndex.value = 0; loadClipIntoPlayer(0); });
    };
  });
  (e.target as HTMLInputElement).value = '';
}

function loadBgMusic(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) bgMusicFile.value = f;
}

// ── 片段管理 ──────────────────────────────────────────────────
function selectClip(i: number) {
  if (isPlaying.value) pausePlayback();
  activeClipIndex.value = i;
  loadClipIntoPlayer(i);
}

/** 把指定 clip 加载到 <video>，跳到 trimStart */
function loadClipIntoPlayer(i: number) {
  const clip = clips.value[i];
  if (!clip || !videoEl.value) return;
  videoEl.value.src = clip.url;
  videoEl.value.playbackRate = clip.speed;
  videoEl.value.volume = volume.value * (clip.volume / 100);
  videoEl.value.currentTime = clip.trimStart;
  currentTime.value = clip.offset;
  applyClipFilter(clip);
}

function applyClipFilter(clip: VideoClip) {
  if (!videoEl.value) return;
  const f = clip.filters;
  videoEl.value.style.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px) hue-rotate(${f.hueRotate}deg)`;
}

function removeClip(i: number) {
  if (isPlaying.value) pausePlayback();
  clips.value.splice(i, 1);
  recomputeOffsets();
  if (clips.value.length === 0) {
    activeClipIndex.value = -1;
    if (videoEl.value) { videoEl.value.src = ''; videoEl.value.removeAttribute('src'); }
    currentTime.value = 0;
    return;
  }
  const newIdx = Math.min(activeClipIndex.value, clips.value.length - 1);
  activeClipIndex.value = newIdx;
  nextTick(() => loadClipIntoPlayer(newIdx));
}

function moveClip(i: number, dir: -1|1) {
  const j = i + dir;
  if (j < 0 || j >= clips.value.length) return;
  [clips.value[i], clips.value[j]] = [clips.value[j], clips.value[i]];
  recomputeOffsets();
  activeClipIndex.value = j;
}

function recomputeOffsets() {
  let t = 0;
  clips.value.forEach(c => { c.offset = t; t += (c.trimEnd - c.trimStart) / c.speed; });
}

function dropClip(toIdx: number) {
  if (dragFrom < 0 || dragFrom === toIdx) return;
  const [rem] = clips.value.splice(dragFrom, 1);
  clips.value.splice(toIdx, 0, rem);
  recomputeOffsets();
  dragFrom = -1;
}

// ── 播放引擎 ─────────────────────────────────────────────────
// 核心：连续播放所有片段
// globalTime = clip.offset + (localTime - clip.trimStart) / clip.speed

function togglePlay() {
  if (isPlaying.value) pausePlayback();
  else startPlayback();
}

function startPlayback() {
  if (!videoEl.value || !clips.value.length) return;
  // 找出 currentTime 对应的 clip
  const ci = findClipAtGlobal(currentTime.value);
  if (ci < 0) {
    // 已到结尾，从头开始
    currentTime.value = 0;
    playFromClip(0, clips.value[0].trimStart);
  } else {
    const clip = clips.value[ci];
    const localT = clip.trimStart + (currentTime.value - clip.offset) * clip.speed;
    playFromClip(ci, localT);
  }
}

function pausePlayback() {
  isPlaying.value = false;
  videoEl.value?.pause();
}

/** 从指定 clip 的 localTime 开始播放 */
function playFromClip(ci: number, localT: number) {
  if (clipSwitching) return;
  const clip = clips.value[ci];
  if (!clip || !videoEl.value) return;

  clipSwitching = true;
  playingClipIdx = ci;
  playingClipLocal = localT;
  activeClipIndex.value = ci;

  // 如果当前 src 已经是这个 clip，不用重新加载
  const needLoad = !videoEl.value.src || videoEl.value.src !== clip.url;
  
  const doPlay = () => {
    clipSwitching = false;
    if (!videoEl.value) return;
    videoEl.value.currentTime = localT;
    videoEl.value.playbackRate = clip.speed;
    videoEl.value.volume = volume.value * (clip.volume / 100);
    applyClipFilter(clip);
    isPlaying.value = true;
    videoEl.value.play().catch(err => {
      console.warn('play() failed:', err);
      isPlaying.value = false;
      clipSwitching = false;
    });
  };

  if (needLoad) {
    videoEl.value.pause();
    videoEl.value.src = clip.url;
    videoEl.value.load();
    videoEl.value.oncanplay = () => {
      videoEl.value!.oncanplay = null;
      doPlay();
    };
  } else {
    doPlay();
  }
}

/** video timeupdate：更新全局时间，并在到达 trimEnd 时切换下一 clip */
function onTimeUpdate() {
  if (!videoEl.value || playingClipIdx < 0) return;
  const clip = clips.value[playingClipIdx];
  if (!clip) return;

  const localT = videoEl.value.currentTime;
  // 同步全局时间
  currentTime.value = clip.offset + (localT - clip.trimStart) / clip.speed;

  // 到达出点 → 切下一片段
  if (isPlaying.value && localT >= clip.trimEnd - 0.05) {
    const next = playingClipIdx + 1;
    if (next < clips.value.length) {
      playFromClip(next, clips.value[next].trimStart);
    } else {
      // 全部播放完
      videoEl.value.pause();
      isPlaying.value = false;
      playingClipIdx = -1;
      currentTime.value = totalDuration.value;
    }
  }
}

function onMeta() {
  // loadedmetadata 不再用于播放控制，只用于初始跳转
}

function onEnded() {
  if (!isPlaying.value) return;
  const next = playingClipIdx + 1;
  if (next < clips.value.length) {
    playFromClip(next, clips.value[next].trimStart);
  } else {
    isPlaying.value = false;
    playingClipIdx = -1;
  }
}

function findClipAtGlobal(t: number): number {
  for (let i = 0; i < clips.value.length; i++) {
    const c = clips.value[i];
    const end = c.offset + (c.trimEnd - c.trimStart) / c.speed;
    if (t >= c.offset && t < end) return i;
  }
  return -1;
}

function stepBack() {
  const newT = Math.max(0, currentTime.value - 5);
  seekToGlobal(newT);
}
function stepForward() {
  const newT = Math.min(totalDuration.value, currentTime.value + 5);
  seekToGlobal(newT);
}

function seekTo(e: Event) {
  const v = +(e.target as HTMLInputElement).value;
  seekToGlobal(v);
}

function seekToGlobal(globalT: number) {
  const ci = findClipAtGlobal(globalT);
  if (ci < 0) {
    currentTime.value = Math.min(globalT, totalDuration.value);
    return;
  }
  const clip = clips.value[ci];
  const localT = clip.trimStart + (globalT - clip.offset) * clip.speed;
  currentTime.value = globalT;
  
  if (isPlaying.value) {
    playFromClip(ci, localT);
  } else {
    activeClipIndex.value = ci;
    if (videoEl.value) {
      if (videoEl.value.src !== clip.url) {
        videoEl.value.src = clip.url;
        videoEl.value.oncanplay = () => { videoEl.value!.oncanplay = null; videoEl.value!.currentTime = localT; };
      } else {
        videoEl.value.currentTime = localT;
      }
      applyClipFilter(clip);
    }
  }
}

function seekOnRuler(e: MouseEvent) {
  if (!rulerEl.value) return;
  const rect = rulerEl.value.getBoundingClientRect();
  seekToGlobal((e.clientX - rect.left) / pxPerSec.value);
}
function seekOnTrack(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  seekToGlobal((e.clientX - rect.left) / pxPerSec.value);
}

function changeVolume(e: Event) {
  volume.value = +(e.target as HTMLInputElement).value;
  if (videoEl.value) videoEl.value.volume = volume.value * ((clips.value[playingClipIdx]?.volume ?? 100) / 100);
}
function cycleSpeed() {
  const idx = speeds.indexOf(playbackRate.value);
  playbackRate.value = speeds[(idx + 1) % speeds.length];
  if (videoEl.value && isPlaying.value) videoEl.value.playbackRate = playbackRate.value;
}
function setTrimStart(v: number) { if (activeClip.value) activeClip.value.trimStart = Math.max(0, Math.min(v, activeClip.value.trimEnd - 0.1)); recomputeOffsets(); }
function setTrimEnd(v: number)   { if (activeClip.value) activeClip.value.trimEnd = Math.min(activeClip.value.duration, Math.max(v, activeClip.value.trimStart + 0.1)); recomputeOffsets(); }
function setClipSpeed(s: number) {
  if (!activeClip.value) return;
  activeClip.value.speed = s;
  recomputeOffsets();
  if (isPlaying.value && videoEl.value) videoEl.value.playbackRate = s;
}
function applyVolume() {
  if (videoEl.value && activeClip.value) videoEl.value.volume = volume.value * (activeClip.value.volume / 100);
}
function applyFilters() {
  if (activeClip.value) applyClipFilter(activeClip.value);
}
function applyPreset(p: { name:string; v:Record<string,number> }) {
  if (!activeClip.value) return;
  Object.assign(activeClip.value.filters, p.v);
  activeClip.value.preset = p.name;
  applyFilters();
}

// ── 时间轴 ────────────────────────────────────────────────────
const CLIP_COLORS = ['#6366f1','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#f97316'];
function clipStyle(clip: VideoClip, i: number) {
  const dur = (clip.trimEnd - clip.trimStart) / clip.speed;
  return { left: (clip.offset * pxPerSec.value)+'px', width: Math.max(24, dur * pxPerSec.value)+'px', background: CLIP_COLORS[i % CLIP_COLORS.length] };
}
function capStyle(cap: Caption) {
  const dur = totalDuration.value || 1;
  return { left: (cap.start / dur * 100)+'%', width: ((cap.end - cap.start) / dur * 100)+'%' };
}

function dragPlayhead(e: MouseEvent) {
  const move = (ev: MouseEvent) => {
    if (!rulerEl.value) return;
    const rect = rulerEl.value.getBoundingClientRect();
    seekToGlobal(Math.max(0, (ev.clientX - rect.left) / pxPerSec.value));
  };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  e.preventDefault();
}

function dragClip(i: number, e: MouseEvent) {
  const startX = e.clientX, startOff = clips.value[i].offset;
  const move = (ev: MouseEvent) => { clips.value[i].offset = Math.max(0, startOff + (ev.clientX - startX) / pxPerSec.value); };
  const up   = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  e.preventDefault();
}

function trimClip(i: number, side: 'start'|'end', e: MouseEvent) {
  const startX = e.clientX, clip = clips.value[i];
  const orig = { start: clip.trimStart, end: clip.trimEnd, offset: clip.offset };
  const move = (ev: MouseEvent) => {
    const dt = (ev.clientX - startX) / pxPerSec.value * clip.speed;
    if (side === 'start') {
      clip.trimStart = Math.max(0, Math.min(orig.start + dt, clip.trimEnd - 0.1));
      clip.offset = orig.offset + (clip.trimStart - orig.start) / clip.speed;
    } else {
      clip.trimEnd = Math.max(clip.trimStart + 0.1, Math.min(clip.duration, orig.end + dt));
    }
    recomputeOffsets();
  };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  e.preventDefault();
}

function zoomIn()   { pxPerSec.value = Math.min(240, pxPerSec.value * 1.5); }
function zoomOut()  { pxPerSec.value = Math.max(15,  pxPerSec.value / 1.5); }
function fitTimeline() {
  if (!rulerEl.value) return;
  const w = rulerEl.value.clientWidth - 20;
  pxPerSec.value = Math.max(15, Math.min(240, w / Math.max(1, totalDuration.value)));
}

// ── 字幕 ──────────────────────────────────────────────────────
function submitCap() {
  if (!newCap.text) return;
  if (editingCapIdx.value >= 0) { captions.value[editingCapIdx.value] = { ...newCap }; cancelEditCap(); }
  else { captions.value.push({ ...newCap }); newCap.text = ''; }
}
function editCap(i: number) { Object.assign(newCap, captions.value[i]); editingCapIdx.value = i; activeTool.value = 'caption'; }
function cancelEditCap() { editingCapIdx.value = -1; newCap.text = ''; }

// ── 配音 ──────────────────────────────────────────────────────
async function toggleDub() {
  if (dubRecording.value) {
    dubRec?.stop(); dubRecording.value = false;
    if (dubTimer) { clearInterval(dubTimer); dubTimer = null; }
    videoEl.value?.pause();
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const startAt = currentTime.value, startMs = Date.now();
      dubElapsed.value = 0;
      dubTimer = window.setInterval(() => { dubElapsed.value = Math.floor((Date.now()-startMs)/1000); }, 1000);
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = ev => { if (ev.data.size > 0) chunks.push(ev.data); };
      rec.onstop = () => {
        dubClips.value.push({ at: startAt, url: URL.createObjectURL(new Blob(chunks, { type:'audio/webm' })), duration: dubElapsed.value });
        stream.getTracks().forEach(t => t.stop());
      };
      rec.start(); dubRec = rec; dubRecording.value = true;
      videoEl.value?.play().catch(() => {});
    } catch { alert('无法访问麦克风'); }
  }
}

// ── 真实导出：用 Canvas + MediaRecorder 逐帧渲染所有片段 ─────
import { canUseWebCodecsExport, exportMp4 } from '@/core/mp4Export';

// ── 导出：优先 WebCodecs 真 MP4（H.264+AAC 硬件加速、混音），回退 MediaRecorder(WebM) ─────
function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function drawCaption(canvas: HTMLCanvasElement, t: number) {
  const cap = captions.value.find(c => t >= c.start && t < c.end);
  if (!cap) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const fontSize = { sm:16, md:22, lg:30 }[cap.size];
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  const tw = ctx.measureText(cap.text).width;
  const tx = canvas.width / 2;
  const ty = cap.position === 'top' ? 40 : cap.position === 'center' ? canvas.height/2 : canvas.height - 30;
  ctx.fillRect(tx - tw/2 - 8, ty - fontSize, tw + 16, fontSize + 10);
  ctx.fillStyle = cap.color;
  ctx.fillText(cap.text, tx, ty);
}

/** 混音：各片段音频（音量/倍速）+ 配音轨 → OfflineAudioContext 渲染 */
function buildMixAudio() {
  return async (): Promise<AudioBuffer | null> => {
    const AC: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    const tmp = new AC();
    try {
      const sr = 48000;
      const total = Math.max(0.5, totalDuration.value);
      const offline = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
      const cache = new Map<string, AudioBuffer>();
      const decode = async (url: string): Promise<AudioBuffer | null> => {
        try {
          let buf = cache.get(url);
          if (!buf) {
            const ab = await (await fetch(url)).arrayBuffer();
            buf = await tmp.decodeAudioData(ab);
            cache.set(url, buf);
          }
          return buf;
        } catch { return null; }
      };
      let any = false;
      for (const clip of clips.value) {
        const buf = await decode(clip.url);
        if (!buf) continue;
        any = true;
        const src = offline.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = clip.speed || 1;
        const g = offline.createGain();
        g.gain.value = Math.max(0, Math.min(2, (clip.volume ?? 100) / 100));
        src.connect(g).connect(offline.destination);
        src.start(clip.offset, clip.trimStart, Math.max(0, clip.trimEnd - clip.trimStart));
      }
      for (const d of dubClips.value) {
        const buf = await decode(d.url);
        if (!buf) continue;
        any = true;
        const src = offline.createBufferSource();
        src.buffer = buf;
        const g = offline.createGain(); g.gain.value = 1;
        src.connect(g).connect(offline.destination);
        src.start(Math.max(0, Math.min(d.at, total)));
      }
      if (!any) return null;
      return await offline.startRendering();
    } finally {
      try { tmp.close(); } catch { /* noop */ }
    }
  };
}

async function exportVideo() {
  if (!clips.value.length) return;
  if (isPlaying.value) pausePlayback();
  exporting.value = true; exportPct.value = 0; exportMsg.value = '准备导出…';

  try {
    const width  = videoEl.value?.videoWidth  || 1280;
    const height = videoEl.value?.videoHeight || 720;
    const fps = 30;
    const total = totalDuration.value;

    // ── 首选：WebCodecs 真 MP4（H.264+AAC 硬件加速、含混音） ──
    if (canUseWebCodecsExport()) {
      exportMsg.value = '准备混音…';
      const pool = new Map<string, HTMLVideoElement>();
      const getVideo = (clip: VideoClip): HTMLVideoElement => {
        let v = pool.get(clip.id);
        if (!v) {
          v = document.createElement('video');
          v.src = clip.url; v.muted = true; v.preload = 'auto';
          document.body.appendChild(v);
          pool.set(clip.id, v);
        }
        return v;
      };
      const seekTo = async (v: HTMLVideoElement, t: number) => {
        if (Math.abs(v.currentTime - t) < 0.001) return;
        v.currentTime = t;
        await new Promise<void>(r => { v.onseeked = () => r(); setTimeout(r, 80); });
      };
      const drawFrame = async (canvas: HTMLCanvasElement, t: number) => {
        const clip = clips.value.find(c => t >= c.offset && t < c.offset + (c.trimEnd - c.trimStart) / c.speed)
          || clips.value[clips.value.length - 1];
        const v = getVideo(clip);
        const localT = Math.min(clip.trimStart + (t - clip.offset) * clip.speed, Math.max(0, clip.trimEnd - 0.05));
        await seekTo(v, localT);
        const ctx = canvas.getContext('2d', { alpha: false })!;
        const f = clip.filters;
        ctx.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px) hue-rotate(${f.hueRotate}deg)`;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';
        drawCaption(canvas, t);
      };
      const blob = await exportMp4({
        width, height, fps, durationSec: total,
        drawFrame,
        mixAudio: buildMixAudio(),
        onProgress: r => { exportPct.value = Math.round(r * 95); exportMsg.value = `编码中 ${Math.round(r * 100)}%`; }
      });
      pool.forEach(v => v.remove()); pool.clear();
      exportPct.value = 100; exportMsg.value = '导出完成（MP4）！';
      triggerDownload(blob, `merged_${Date.now()}.mp4`);
      await new Promise(r => setTimeout(r, 600));
      return;
    }

    // ── 回退：Canvas + MediaRecorder（WebM，无声） ──
    exportMsg.value = '使用兼容模式导出（WebM）…';
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const stream = canvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.start(100);

    for (let ci = 0; ci < clips.value.length; ci++) {
      const clip = clips.value[ci];
      exportMsg.value = `合并片段 ${ci+1}/${clips.value.length}：${clip.name}`;
      const basePct = (ci / clips.value.length) * 85;

      await new Promise<void>((resolve, reject) => {
        const v = document.createElement('video');
        v.src = clip.url;
        v.muted = true;
        v.playbackRate = clip.speed;
        v.volume = 0;
        v.preload = 'auto';

        v.onloadedmetadata = async () => {
          v.currentTime = clip.trimStart;
          await new Promise(r => { v.onseeked = r; });

          const clipDur = (clip.trimEnd - clip.trimStart) / clip.speed;
          const frameCount = Math.ceil(clipDur * fps);
          const frameInterval = 1 / fps;

          const f = clip.filters;
          ctx.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px) hue-rotate(${f.hueRotate}deg)`;

          for (let frame = 0; frame < frameCount; frame++) {
            const localT = clip.trimStart + frame * frameInterval * clip.speed;
            if (localT > clip.trimEnd) break;

            v.currentTime = localT;
            await new Promise(r => { v.onseeked = r; setTimeout(r, 50); });

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

            const globalT = clip.offset + frame * frameInterval;
            drawCaption(canvas, globalT);

            exportPct.value = basePct + (frame / frameCount) * (85 / clips.value.length);

            if (frame % 5 === 0) await new Promise(r => setTimeout(r, 0));
          }

          v.remove();
          resolve();
        };
        v.onerror = reject;
        document.body.appendChild(v);
      });
    }

    exportMsg.value = '封装输出文件…';
    exportPct.value = 90;
    recorder.stop();

    await new Promise<void>(res => { recorder.onstop = () => res(); });
    exportPct.value = 100;
    exportMsg.value = '导出完成（WebM 回退）！';

    triggerDownload(new Blob(chunks, { type: mimeType }), `merged_${Date.now()}.webm`);
    await new Promise(r => setTimeout(r, 600));
  } catch (err: any) {
    console.error('Export failed:', err);
    exportMsg.value = '导出失败：' + (err?.message ?? String(err));
    await new Promise(r => setTimeout(r, 2000));
  }

  exporting.value = false;
  exportPct.value = 0;
}

function animTo(target: number, ms: number) {
  return new Promise<void>(res => {
    const step = (target - exportPct.value) / (ms / 16); let v = exportPct.value;
    const id = setInterval(() => { v = Math.min(target, v+step); exportPct.value = v; if (v >= target) { clearInterval(id); res(); } }, 16);
  });
}

function formatTime(s: number) {
  if (!s || isNaN(s) || !isFinite(s) || s < 0) return '00:00';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

onBeforeUnmount(() => {
  if (isPlaying.value) pausePlayback();
  dubClips.value.forEach(d => URL.revokeObjectURL(d.url));
  if (dubTimer) clearInterval(dubTimer);
});
</script>

<style scoped>
/* ══ 容器 ══ */
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--sp-color-bg);
  position: relative;
}

/* 空状态 */
.editor-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 14px; padding: 56px 24px; text-align: center;
}
.empty-icon {
  width: 72px; height: 72px; border-radius: 18px;
  background: var(--sp-color-primary-light);
  display: flex; align-items: center; justify-content: center;
  color: var(--sp-color-primary);
}
.empty-title { font-size: 17px; font-weight: 700; color: var(--sp-color-heading); }
.empty-sub   { font-size: 13px; color: var(--sp-color-muted); }
.upload-cta  {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 24px; background: var(--sp-color-primary); color: white;
  border-radius: var(--sp-radius-lg); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all var(--sp-transition-fast);
  box-shadow: 0 2px 8px var(--sp-color-primary-glow);
}
.upload-cta:hover { background: var(--sp-color-primary-hover); transform: translateY(-1px); }

/* 主界面 */
.editor-main {
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}

/* ── 顶栏 ── */
.e-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px; background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
  flex-shrink: 0;
}
.e-topbar-l, .e-topbar-r { display: flex; align-items: center; gap: 7px; }
.e-logo {
  width: 22px; height: 22px; border-radius: 6px;
  background: linear-gradient(135deg,#6366f1,#8b5cf6);
  display: flex; align-items: center; justify-content: center;
}
.e-title { font-size: 13px; font-weight: 600; color: var(--sp-color-heading); }
.e-seg-badge {
  font-size: 11px; color: var(--sp-color-muted);
  background: var(--sp-color-surface); border: 1px solid var(--sp-color-border);
  border-radius: 999px; padding: 1px 8px;
}
.e-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 11px; border: 1px solid var(--sp-color-primary);
  border-radius: var(--sp-radius-sm); background: var(--sp-color-primary-light);
  color: var(--sp-color-primary); font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: var(--sp-font-family); transition: all var(--sp-transition-fast);
}
.e-add-btn:hover { background: var(--sp-color-primary); color: white; }
.e-export-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 13px; background: var(--sp-color-primary); border: none;
  border-radius: var(--sp-radius-sm); color: white; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: var(--sp-font-family); transition: all var(--sp-transition-fast);
  box-shadow: 0 1px 4px var(--sp-color-primary-glow);
}
.e-export-btn:hover:not(:disabled) { background: var(--sp-color-primary-hover); }
.e-export-btn:disabled { opacity: .45; cursor: not-allowed; }
.btn-spin {
  width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,.3); border-top-color: white;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ══ 主体左右布局 ══ */
.editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── 左列 ── */
.editor-left {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--sp-color-border);
}

/* 预览区：自动填满剩余高度 */
.preview-wrap {
  flex: 1;
  min-height: 0;
  background: #1a1a2e;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.preview-video {
  max-width: 100%;
  max-height: 100%;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.preview-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  color: rgba(255,255,255,.35); font-size: 12px;
}
.cap-overlay {
  position: absolute; left: 50%; transform: translateX(-50%);
  padding: 5px 14px; background: rgba(0,0,0,.6);
  border-radius: 5px; font-weight: 600;
  text-shadow: 0 1px 3px rgba(0,0,0,.9);
  white-space: pre-wrap; text-align: center; max-width: 90%;
}
.cap-pos--bottom { bottom: 12px; }
.cap-pos--top    { top: 12px; }
.cap-pos--center { top: 50%; transform: translate(-50%,-50%); }

/* 播放控件 */
.player-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  background: var(--sp-color-bg-elevated);
  border-top: 1px solid var(--sp-color-border);
  border-bottom: 1px solid var(--sp-color-border);
  flex-shrink: 0;
}
.player-btns { display: flex; gap: 3px; flex-shrink: 0; }
.p-btn {
  width: 28px; height: 28px; border-radius: var(--sp-radius-sm);
  border: 1px solid var(--sp-color-border-strong);
  background: var(--sp-color-surface); color: var(--sp-color-text);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all var(--sp-transition-fast); flex-shrink: 0;
}
.p-btn:hover { background: var(--sp-color-primary-light); border-color: var(--sp-color-primary); color: var(--sp-color-primary); }
.p-btn--play { background: var(--sp-color-primary); border-color: transparent; color: white; }
.p-btn--play:hover { background: var(--sp-color-primary-hover); color: white; border-color: transparent; }
.player-time {
  font-size: 11px; font-family: var(--sp-font-mono,monospace);
  color: var(--sp-color-muted); white-space: nowrap; flex-shrink: 0;
}
.seek-bar { flex: 1; height: 4px; cursor: pointer; accent-color: var(--sp-color-primary); min-width: 40px; }
.vol-row  { display: flex; align-items: center; gap: 4px; flex-shrink: 0; color: var(--sp-color-muted); }
.vol-bar  { width: 50px; height: 3px; cursor: pointer; accent-color: var(--sp-color-primary); }
.speed-pill {
  font-size: 11px; font-weight: 600; color: var(--sp-color-primary);
  background: var(--sp-color-primary-light); border: 1px solid rgba(99,102,241,.2);
  border-radius: 999px; padding: 2px 8px; cursor: pointer; flex-shrink: 0;
  transition: all var(--sp-transition-fast);
}
.speed-pill:hover { background: var(--sp-color-primary); color: white; }

/* 时间轴 */
.timeline {
  flex-shrink: 0;
  background: var(--sp-color-bg-elevated);
}
.tl-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 10px; background: var(--sp-color-surface);
  border-bottom: 1px solid var(--sp-color-border);
}
.tl-header-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .06em; color: var(--sp-color-muted);
}
.tl-zoom-btns { display: flex; gap: 2px; }
.tl-z-btn {
  width: 22px; height: 22px; border-radius: var(--sp-radius-sm);
  border: 1px solid var(--sp-color-border-strong);
  background: var(--sp-color-bg-elevated); color: var(--sp-color-muted);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 12px; font-weight: 500;
  transition: all var(--sp-transition-fast);
}
.tl-z-btn:hover { color: var(--sp-color-primary); border-color: var(--sp-color-primary); }

.tl-ruler {
  height: 22px; overflow-x: auto; overflow-y: hidden;
  background: var(--sp-color-surface); border-bottom: 1px solid var(--sp-color-border);
  position: relative; cursor: pointer; scrollbar-width: none;
}
.tl-ruler::-webkit-scrollbar { display: none; }
.tl-ruler-inner { position: relative; height: 100%; }
.tl-tick {
  position: absolute; top: 0; height: 100%;
  display: flex; flex-direction: column; align-items: flex-start; padding-left: 3px;
}
.tl-tick::before { content:''; width: 1px; height: 5px; background: var(--sp-color-border-strong); }
.tl-tick-t { font-size: 11px; color: var(--sp-color-muted); font-family: var(--sp-font-mono,monospace); white-space: nowrap; }
.tl-playhead {
  position: absolute; top: 0; bottom: 0; width: 2px;
  background: var(--sp-color-primary); transform: translateX(-50%);
  cursor: ew-resize; z-index: 10;
}
.tl-playhead::before {
  content:''; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 8px; height: 8px; border-radius: 50%; background: var(--sp-color-primary);
}

.tl-row {
  display: flex; align-items: stretch;
  border-bottom: 1px solid var(--sp-color-border); min-height: 34px;
}
.tl-row:last-child { border-bottom: none; }
.tl-row-label {
  width: 50px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 3px;
  font-size: 11px; color: var(--sp-color-muted);
  background: var(--sp-color-surface);
  border-right: 1px solid var(--sp-color-border); padding: 4px 2px; text-align: center;
}
.tl-row-body {
  flex: 1; position: relative; overflow-x: auto; overflow-y: hidden;
  cursor: pointer;
  background: repeating-linear-gradient(90deg,transparent,transparent 49px,var(--sp-color-border) 49px,var(--sp-color-border) 50px);
  scrollbar-width: none;
}
.tl-row-body::-webkit-scrollbar { display: none; }
.tl-row-body--audio   { background: rgba(16,185,129,.04); cursor: default; }
.tl-row-body--caption { background: rgba(99,102,241,.04); cursor: default; }
.tl-row-empty { display: flex; align-items: center; justify-content: center; height: 100%; }
.tl-add-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--sp-color-muted); cursor: pointer;
  padding: 4px 10px; border-radius: var(--sp-radius-sm);
  border: 1px dashed var(--sp-color-border-strong);
  transition: all var(--sp-transition-fast);
}
.tl-add-label:hover { color: var(--sp-color-primary); border-color: var(--sp-color-primary); }

.tl-clip {
  position: absolute; top: 3px; bottom: 3px; border-radius: 5px;
  display: flex; align-items: center; overflow: hidden;
  cursor: grab; user-select: none; min-width: 20px;
}
.tl-clip:active { cursor: grabbing; }
.tl-clip.active { outline: 2px solid rgba(255,255,255,.8); outline-offset: 1px; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
.tl-clip--audio   { left: 0 !important; right: 0; width: auto !important; background: linear-gradient(135deg,rgba(16,185,129,.8),rgba(5,150,105,.8)); cursor: default; }
.tl-clip--caption { background: linear-gradient(135deg,rgba(99,102,241,.75),rgba(139,92,246,.75)); cursor: pointer; top: 5px; bottom: 5px; border-radius: 4px; display: flex; align-items: center; }
.cap-clip-text { font-size: 11px; color: white; padding: 0 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.clip-hndl { position: absolute; top: 0; bottom: 0; width: 7px; background: rgba(255,255,255,.35); cursor: ew-resize; }
.clip-hndl--l { left: 0; border-radius: 5px 0 0 5px; }
.clip-hndl--r { right: 0; border-radius: 0 5px 5px 0; }
.clip-hndl:hover { background: rgba(255,255,255,.65); }
.clip-body { display: flex; align-items: center; gap: 4px; padding: 0 10px; color: white; font-size: 11px; font-weight: 500; flex: 1; overflow: hidden; }
.clip-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.clip-dur  { opacity: .7; font-size: 11px; margin-left: auto; flex-shrink: 0; }

/* ── 右列 ── */
.editor-right {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--sp-color-bg-elevated);
}

.tool-tabs {
  display: flex; flex-direction: column;
  border-bottom: 1px solid var(--sp-color-border);
  flex-shrink: 0;
}
.tool-tab {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 14px; border: none; background: transparent;
  color: var(--sp-color-muted); font-size: 12px; font-weight: 500;
  cursor: pointer; border-left: 2px solid transparent;
  white-space: nowrap; font-family: var(--sp-font-family);
  transition: all var(--sp-transition-fast); text-align: left;
}
.tool-tab:hover { color: var(--sp-color-text); background: var(--sp-color-surface); }
.tool-tab.active { color: var(--sp-color-primary); border-left-color: var(--sp-color-primary); background: var(--sp-color-primary-light); }
.tt-icon { display: flex; align-items: center; line-height: 0; }

.tool-content { flex: 1; overflow-y: auto; padding: 12px; }
.tool-hint { font-size: 12px; color: var(--sp-color-muted); padding: 14px 0; text-align: center; }

/* 通用表单 */
.tool-section { display: flex; flex-direction: column; gap: 0; }
.field-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .06em; color: var(--sp-color-muted); margin-bottom: 5px;
}
.field-input {
  width: 100%; height: 28px; padding: 0 9px;
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm); color: var(--sp-color-text);
  font-size: 12px; font-family: var(--sp-font-family); outline: none;
  transition: border-color var(--sp-transition-fast);
}
.field-input:focus { border-color: var(--sp-color-primary); box-shadow: 0 0 0 2px var(--sp-color-primary-light); }
.field-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.field-group { display: flex; flex-direction: column; gap: 2px; }
.fg-label { font-size: 11px; color: var(--sp-color-muted); }
.field-input-sm {
  width: 60px; height: 26px; padding: 0 6px; text-align: center;
  background: var(--sp-color-bg-elevated); border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm); color: var(--sp-color-text);
  font-size: 12px; font-family: var(--sp-font-family); outline: none;
}
.field-input-sm:focus { border-color: var(--sp-color-primary); }
.field-arrow { color: var(--sp-color-muted); font-size: 12px; }
.field-static {
  height: 26px; padding: 0 8px; display: flex; align-items: center;
  font-size: 11px; font-family: var(--sp-font-mono,monospace);
  color: var(--sp-color-primary); background: var(--sp-color-primary-light);
  border-radius: var(--sp-radius-sm); border: 1px solid rgba(99,102,241,.15);
}
.field-select {
  height: 26px; padding: 0 6px;
  background: var(--sp-color-bg-elevated); border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm); color: var(--sp-color-text);
  font-size: 11px; font-family: var(--sp-font-family); outline: none; cursor: pointer;
}
.color-pick {
  width: 28px; height: 26px; padding: 1px;
  border: 1px solid var(--sp-color-border-strong); border-radius: var(--sp-radius-sm);
  background: var(--sp-color-bg-elevated); cursor: pointer;
}
.btn-row { display: flex; gap: 4px; flex-wrap: wrap; }
.tool-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 9px; border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm); background: var(--sp-color-bg-elevated);
  color: var(--sp-color-text); font-size: 11px; font-weight: 500;
  cursor: pointer; font-family: var(--sp-font-family); transition: all var(--sp-transition-fast);
}
.tool-btn:hover { background: var(--sp-color-surface); }
.tool-btn--primary { background: var(--sp-color-primary); border-color: transparent; color: white; }
.tool-btn--primary:hover { background: var(--sp-color-primary-hover); }
.tool-btn--danger  { background: var(--sp-color-danger-light); border-color: rgba(239,68,68,.25); color: var(--sp-color-danger); }
.tool-btn--danger:hover  { background: var(--sp-color-danger); color: white; border-color: transparent; }
.tool-btn:disabled { opacity: .4; cursor: not-allowed; }

/* 滑块 */
.slider-row { display: flex; align-items: center; gap: 6px; }
.s-label    { font-size: 11px; color: var(--sp-color-muted); min-width: 40px; }
.p-slider   { flex: 1; height: 4px; cursor: pointer; accent-color: var(--sp-color-primary); }
.s-val      { font-size: 11px; font-family: var(--sp-font-mono,monospace); color: var(--sp-color-text); min-width: 36px; text-align: right; }
.s-reset    { background: none; border: none; cursor: pointer; color: var(--sp-color-muted); font-size: 13px; padding: 0 2px; transition: color var(--sp-transition-fast); }
.s-reset:hover { color: var(--sp-color-primary); }

/* 速度 */
.speed-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 3px; }
.speed-btn {
  padding: 5px 2px; border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm); background: var(--sp-color-bg-elevated);
  color: var(--sp-color-text); font-size: 11px; text-align: center;
  cursor: pointer; font-family: var(--sp-font-family); transition: all var(--sp-transition-fast);
}
.speed-btn.active { border-color: var(--sp-color-primary); background: var(--sp-color-primary-light); color: var(--sp-color-primary); font-weight: 600; }
.speed-btn:hover:not(.active) { border-color: var(--sp-color-border-hover); }

/* 滤镜预设 */
.preset-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 4px; }
.preset-btn {
  padding: 6px 4px; border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm); background: var(--sp-color-bg-elevated);
  color: var(--sp-color-text); font-size: 11px; font-weight: 500;
  cursor: pointer; font-family: var(--sp-font-family); transition: all var(--sp-transition-fast); text-align: center;
}
.preset-btn.active { border-color: var(--sp-color-primary); background: var(--sp-color-primary-light); color: var(--sp-color-primary); }
.preset-btn:hover:not(.active) { background: var(--sp-color-surface); }

/* 转场 */
.tr-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 4px; }
.tr-btn {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 4px; border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-md); background: var(--sp-color-bg-elevated);
  color: var(--sp-color-text-secondary); font-size: 11px;
  cursor: pointer; font-family: var(--sp-font-family); transition: all var(--sp-transition-fast);
}
.tr-btn.active { border-color: var(--sp-color-primary); background: var(--sp-color-primary-light); color: var(--sp-color-primary); }
.tr-btn:hover:not(.active) { background: var(--sp-color-surface); }
.tr-ic { display: flex; align-items: center; color: currentColor; }

/* 字幕 */
.cap-textarea {
  width: 100%; background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border-strong); border-radius: var(--sp-radius-sm);
  color: var(--sp-color-text); font-size: 12px; font-family: var(--sp-font-family);
  padding: 7px 9px; resize: vertical; outline: none; margin-bottom: 2px;
}
.cap-textarea:focus { border-color: var(--sp-color-primary); }
.cap-row {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 8px; background: var(--sp-color-bg-elevated);
  border-radius: var(--sp-radius-sm); border: 1px solid var(--sp-color-border);
  margin-top: 4px; transition: background var(--sp-transition-fast);
}
.cap-row--editing { border-color: var(--sp-color-primary); background: var(--sp-color-primary-light); }
.cap-row-time { font-size: 11px; font-family: var(--sp-font-mono,monospace); color: var(--sp-color-primary); min-width: 82px; flex-shrink: 0; }
.cap-row-text { font-size: 11px; color: var(--sp-color-text); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 配音 */
.file-drop {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 12px; border: 1px dashed var(--sp-color-border-strong);
  border-radius: var(--sp-radius-md); cursor: pointer; text-align: center;
  font-size: 11px; color: var(--sp-color-muted); transition: border-color var(--sp-transition-fast);
}
.file-drop:hover { border-color: var(--sp-color-primary); color: var(--sp-color-primary); }
.dub-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.dub-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border-radius: var(--sp-radius-sm);
  border: 1px solid rgba(239,68,68,.3); background: var(--sp-color-danger-light);
  color: var(--sp-color-danger); font-size: 11px; font-weight: 500;
  cursor: pointer; font-family: var(--sp-font-family); transition: all var(--sp-transition-fast);
}
.dub-btn--rec { background: var(--sp-color-danger); color: white; border-color: transparent; animation: pulse-btn .8s ease infinite; }
@keyframes pulse-btn { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.3)} 50%{box-shadow:0 0 0 5px rgba(239,68,68,0)} }
.dub-hint { font-size: 11px; color: var(--sp-color-muted); }
.dub-clip { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-bottom: 1px solid var(--sp-color-border); }
.dub-clip:last-child { border-bottom: none; }
.dub-clip-meta { font-size: 11px; color: var(--sp-color-muted); min-width: 70px; flex-shrink: 0; }
.dub-at { color: var(--sp-color-primary); display: block; }

/* 片段列表 */
.clips-list { display: flex; flex-direction: column; gap: 3px; }
.clip-row {
  display: flex; align-items: center; gap: 7px;
  padding: 7px 8px; border-radius: var(--sp-radius-sm);
  border: 1px solid var(--sp-color-border); background: var(--sp-color-bg-elevated);
  cursor: pointer; transition: all var(--sp-transition-fast);
}
.clip-row:hover { background: var(--sp-color-surface); }
.clip-row--active { border-color: var(--sp-color-primary); background: var(--sp-color-primary-light); }
.clip-row-drag { color: var(--sp-color-muted); cursor: grab; font-size: 12px; flex-shrink: 0; }
.clip-row-thumb {
  width: 26px; height: 26px; border-radius: 6px;
  background: var(--sp-color-primary-light); color: var(--sp-color-primary);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.clip-row-info { flex: 1; min-width: 0; }
.clip-row-name { font-size: 11px; font-weight: 500; color: var(--sp-color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.clip-row-meta { font-size: 11px; color: var(--sp-color-muted); margin-top: 1px; }
.clip-row-btns { display: flex; gap: 2px; flex-shrink: 0; }

/* 图标按钮 */
.icon-btn {
  width: 22px; height: 22px; border-radius: var(--sp-radius-sm);
  border: 1px solid var(--sp-color-border-strong); background: var(--sp-color-bg-elevated);
  color: var(--sp-color-muted); display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 12px; transition: all var(--sp-transition-fast);
}
.icon-btn:hover { color: var(--sp-color-text); border-color: var(--sp-color-border-hover); }
.icon-btn--del:hover { background: var(--sp-color-danger-light); color: var(--sp-color-danger); border-color: rgba(239,68,68,.25); }
.icon-btn:disabled { opacity: .35; cursor: not-allowed; }

/* 导出遮罩 */
.export-mask {
  position: absolute; inset: 0;
  background: rgba(245,246,250,.85); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.export-card {
  background: var(--sp-color-bg-elevated); border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-xl); padding: 28px 32px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  min-width: 220px; box-shadow: var(--sp-shadow-lg);
}
.export-spin { width: 36px; height: 36px; border-radius: 50%; border: 3px solid var(--sp-color-border-strong); border-top-color: var(--sp-color-primary); animation: spin .8s linear infinite; }
.export-title { font-size: 14px; font-weight: 600; color: var(--sp-color-heading); }
.export-sub   { font-size: 12px; color: var(--sp-color-muted); }
.export-track { width: 100%; height: 4px; background: var(--sp-color-surface); border-radius: 999px; overflow: hidden; }
.export-fill  { height: 100%; background: var(--sp-color-primary); border-radius: 999px; transition: width .1s; }
.export-pct   { font-size: 12px; font-weight: 700; color: var(--sp-color-primary); font-family: var(--sp-font-mono,monospace); }
</style>
