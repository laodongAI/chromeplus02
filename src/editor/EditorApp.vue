<template>
  <div class="app"
    @keydown.prevent.exact.space="togglePlay"
    @keydown.prevent.exact.s="onKeyS"
    @keydown.prevent.exact.v="tlTool='select'"
    @keydown.delete.prevent="onKeyDelete"
    @keydown.ctrl.z.prevent="undo"
    @keydown.ctrl.y.prevent="redo"
    @wheel.ctrl.prevent="onCtrlWheel"
    @click="ctxMenu.show=false;bgCtxMenu.show=false;exportPanelOpen=false"
    tabindex="-1" ref="appRoot">

    <!-- ══ 顶栏 ══ -->
    <header class="topbar">
      <div class="tb-l">
        <div class="logo"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M15 10l-8 5 8 5V4z"/><path d="M21 4v16"/></svg></div>
        <span class="app-name">MediaPlus</span>
        <span class="proj-info" v-if="clips.length">{{ clips.length }} 片段 · {{ fmtT(totalDuration) }}</span>
      </div>
      <div class="tb-tools">
        <div class="tool-group">
          <button class="tb-tool" :class="{ on: tlTool==='select' }" @click="tlTool='select'" title="选择 (V)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 3l14 9-7 1-4 7z" fill="currentColor" opacity=".2"/><path d="M5 3l14 9-7 1-4 7z"/></svg>
            选择
          </button>
          <button class="tb-tool" :class="{ on: tlTool==='split' }" @click="tlTool='split'" title="切割 (S)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="8" x2="6" y2="8"/><line x1="18" y1="8" x2="22" y2="8"/><line x1="2" y1="16" x2="6" y2="16"/><line x1="18" y1="16" x2="22" y2="16"/></svg>
            切割
          </button>
        </div>
        <div class="undo-redo">
          <button class="ur-btn" @click="undo" :disabled="!canUndo" title="撤销 Ctrl+Z">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
          </button>
          <button class="ur-btn" @click="redo" :disabled="!canRedo" title="重做 Ctrl+Y">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>
          </button>
        </div>
      </div>
      <div class="tb-r">
        <span v-if="autosaveEnabled" class="save-chip" :class="`save-chip--${saveState}`" role="status" aria-live="polite">
          {{ saveState==='pending' ? '保存中…' : saveState==='failed' ? '保存失败' : savedAtText ? `已保存 ${savedAtText}` : '自动保存已开启' }}
        </span>
        <div class="exp-set-wrap">
          <button class="tb-btn" :class="{ 'tb-btn--on': exportPanelOpen }" @click.stop="exportPanelOpen=!exportPanelOpen" title="导出预设">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            导出设置
          </button>
          <div v-if="exportPanelOpen" class="exp-panel" @click.stop>
            <div class="exp-row">
              <span class="exp-label">画幅</span>
              <div class="exp-seg">
                <button v-for="a in EXPORT_ASPECTS" :key="a" class="exp-chip" :class="{ on: exportSettings.aspect===a }" @click="exportSettings.aspect=a">{{ ASPECT_LABELS[a] }}</button>
              </div>
            </div>
            <div class="exp-row">
              <span class="exp-label">短边</span>
              <div class="exp-seg">
                <button v-for="s in EXPORT_SHORT_SIDES" :key="s" class="exp-chip" :class="{ on: exportSettings.shortSide===s }" @click="exportSettings.shortSide=s">{{ SHORT_SIDE_LABELS[s] }}</button>
              </div>
            </div>
            <div class="exp-row">
              <span class="exp-label">帧率</span>
              <div class="exp-seg">
                <button v-for="f in EXPORT_FPS_OPTIONS" :key="f" class="exp-chip" :class="{ on: exportSettings.fps===f }" @click="exportSettings.fps=f">{{ f }}fps</button>
              </div>
            </div>
            <div class="exp-row">
              <span class="exp-label">画质</span>
              <div class="exp-seg">
                <button v-for="q in EXPORT_QUALITIES" :key="q" class="exp-chip" :class="{ on: exportSettings.quality===q }" @click="exportSettings.quality=q">{{ QUALITY_LABELS[q] }}</button>
              </div>
            </div>
            <div class="exp-row">
              <span class="exp-label">适配</span>
              <div class="exp-seg">
                <button v-for="f in EXPORT_FITS" :key="f" class="exp-chip" :class="{ on: exportSettings.fit===f }" @click="exportSettings.fit=f">{{ FIT_LABELS[f] }}</button>
              </div>
            </div>
            <div class="exp-row exp-row--bitrate">
              <span class="exp-label">码率</span>
              <label class="exp-custom">
                <input type="checkbox" v-model="useCustomBitrate" />
                <span>自定义</span>
                <input v-if="useCustomBitrate" class="exp-num" type="number" min="0.5" max="40" step="0.5" v-model.number="customBitrateMbps" />
                <span v-if="useCustomBitrate" class="exp-unit">Mbps</span>
              </label>
            </div>
            <div class="exp-sum">{{ exportSummary }}<template v-if="sourceSize.w"> ｜ 源 {{ sourceSize.w }}×{{ sourceSize.h }}</template></div>
            <div class="exp-hint">竖屏导出请用「画幅 9:16」；预览画面即成片构图（推镜/分屏/字幕位置同源渲染）。</div>
          </div>
        </div>
        <label class="tb-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          导入视频
          <input type="file" accept="video/*" multiple @change="handleUpload" style="display:none">
        </label>
        <button class="tb-btn tb-btn--export" :disabled="!clips.length||exporting||restoring" @click="startExport">
          <span v-if="exporting" class="spin"></span>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {{ exporting ? exportMsg : '导出' }}
        </button>
      </div>
    </header>

    <!-- ══ 崩溃恢复选择：本次带新素材进来时，恢复会顶掉它，必须由用户拍板 ══ -->
    <div v-if="recoveryProject" class="recover-bar" role="alertdialog" aria-label="恢复上次编辑">
      <span class="recover-bar__text">
        检测到 {{ recoveryTimeText }} 自动保存的工程（{{ recoveryClipCount }} 段素材）。
        恢复它会替换本次刚导入的素材。
      </span>
      <button class="recover-bar__btn recover-bar__btn--primary" :disabled="restoring" @click="acceptRecovery">
        {{ restoring ? '恢复中…' : '恢复上次编辑' }}
      </button>
      <button class="recover-bar__btn" :disabled="restoring" @click="discardRecovery">从头开始</button>
    </div>

    <!-- ══ 可见问题清单：素材载入失败 / 导出降级与失败，不随遮罩关闭而消失 ══ -->
    <div v-if="notices.length" class="notice-bar" role="alert">
      <div v-for="n in notices" :key="n.id" class="notice-bar__item" :class="`notice-bar__item--${n.kind}`">
        <span class="notice-bar__text"><strong>{{ n.title }}</strong> {{ n.detail }}</span>
        <button class="notice-bar__close" title="忽略这条提示" @click="dismissNotice(n.id)">×</button>
      </div>
    </div>

    <!-- ══ 主区域：左(预览) + 右(时间轴+属性) ══ -->
    <div class="main">

      <!-- ── 预览区(40%) ── -->
      <div class="pane-preview" :style="{ width: previewW + 'px' }">
        <div class="screen" @dragover.prevent @drop.prevent="onDrop" ref="screenEl" @mousedown="onScreenMouseDown">
          <div v-if="!clips.length" class="drop-hint">
            <label class="drop-label">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>拖放视频 / 点击导入</span>
              <span class="drop-sub">MP4 · WebM · MOV</span>
              <input type="file" accept="video/*" multiple @change="handleUpload" style="display:none">
            </label>
          </div>
          <!-- 隐藏的原始 video 用于解码（loadedmetadata 上报源尺寸，导出面板据此算目标画幅）-->
          <video ref="videoEl" class="vid-hidden"
            @timeupdate="onTimeUpdate" @ended="onEnded" @loadedmetadata="onSourceMeta"></video>
          <!-- Canvas 预览（支持 zoom/splitScreen/字幕）-->
          <canvas ref="previewCanvas" class="preview-canvas" v-show="clips.length"></canvas>
          <!-- 分屏 partner video（隐藏，用于合成）-->
          <video ref="partnerVideoEl" class="vid-hidden"></video>
          <!-- Zoom 选区框（编辑 zoom 时显示）-->
          <div v-if="activeClip && inspectorMode==='zoom' && inspectorOpen" class="zoom-editor-overlay">
            <div class="zoom-box"
              :style="zoomBoxStyle"
              @mousedown.stop="onZoomBoxDragStart">
              <div class="zoom-handle zoom-handle--tl" @mousedown.stop="onZoomResizeStart('tl',$event)"></div>
              <div class="zoom-handle zoom-handle--tr" @mousedown.stop="onZoomResizeStart('tr',$event)"></div>
              <div class="zoom-handle zoom-handle--bl" @mousedown.stop="onZoomResizeStart('bl',$event)"></div>
              <div class="zoom-handle zoom-handle--br" @mousedown.stop="onZoomResizeStart('br',$event)"></div>
              <div class="zoom-label">{{ activeClip.zoom.scale.toFixed(1) }}×</div>
            </div>
          </div>
          <!-- 裁剪选框 overlay -->
          <div v-if="activeClip && inspectorMode==='crop' && activeClip.crop.enabled" class="crop-overlay">
            <div class="crop-box"
              :style="{
                left: activeClip.crop.x*100+'%',
                top:  activeClip.crop.y*100+'%',
                width: activeClip.crop.w*100+'%',
                height: activeClip.crop.h*100+'%',
              }"
              @mousedown.stop="onCropBoxDrag($event)">
              <div class="crop-handle crop-handle--tl" @mousedown.stop="onCropResize('tl',$event)"></div>
              <div class="crop-handle crop-handle--tr" @mousedown.stop="onCropResize('tr',$event)"></div>
              <div class="crop-handle crop-handle--bl" @mousedown.stop="onCropResize('bl',$event)"></div>
              <div class="crop-handle crop-handle--br" @mousedown.stop="onCropResize('br',$event)"></div>
            </div>
          </div>

          <!-- 标注拖拽 overlay（仅在标注面板打开时显示） -->
          <div v-if="activeClip && inspectorMode==='annotate'" class="annot-overlay">
            <div v-for="(ann,ai) in activeClip.annotations" :key="ann.id"
              class="annot-drag-handle"
              :class="{on: selAnnotIdx===ai}"
              :style="{
                left: ann.x*100+'%', top: ann.y*100+'%',
                width: ann.w*100+'%', height: ann.h*100+'%',
                borderColor: selAnnotIdx===ai ? '#f59e0b' : 'rgba(255,255,255,.4)',
                pointerEvents: 'all',
              }"
              @mousedown.stop="onAnnotDrag(ai,$event)"
              @click.stop="selAnnotIdx=ai">
            </div>
          </div>

          <!-- 字幕叠加（canvas 上方）：位置与字号按取景框计算，与导出烧字同源 -->
          <div v-if="activeCaption" class="cap-overlay"
            :style="capOverlayStyle">
            {{ activeCaption.text }}
          </div>
          <div class="tc-overlay" v-if="clips.length">{{ fmtT(currentTime) }}</div>
        </div>

        <!-- 播放控件 -->
        <div class="controls">
          <div class="ctrl-btns">
            <button class="cb" @click="seekToGlobal(0)" title="回到开头">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
            </button>
            <button class="cb" @click="stepBack(-5)" title="后退5s">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="11 17 6 12 11 7"/><line x1="18" y1="7" x2="18" y2="17"/></svg>
            </button>
            <button class="cb cb--play" @click="togglePlay">
              <svg v-if="!isPlaying" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            </button>
            <button class="cb" @click="stepBack(5)" title="前进5s">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="13 17 18 12 13 7"/><line x1="6" y1="7" x2="6" y2="17"/></svg>
            </button>
            <button class="cb" @click="seekToGlobal(totalDuration)" title="跳到结尾">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
            </button>
          </div>
          <div class="progress-row">
            <span class="tc">{{ fmtT(currentTime) }}</span>
            <input type="range" class="seek" :max="Math.max(totalDuration, 0.1)" :value="currentTime" step="0.03"
              @input="e=>seekToGlobal(+(e.target as HTMLInputElement).value)" />
            <span class="tc dim">{{ fmtT(totalDuration) }}</span>
          </div>
          <div class="ctrl-row2">
            <div class="vol-group">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              <input type="range" class="vol" min="0" max="1" step="0.05" v-model.number="masterVolume" @input="applyMasterVol" />
            </div>
            <span class="speed-tag" @click="cycleSpeed">{{ playbackRate }}×</span>
          </div>
        </div>
      </div>

      <!-- 分割条 -->
      <div class="resizer" @mousedown="onResizerDown"></div>

      <!-- ── 右侧：时间轴(60%) + 属性面板 ── -->
      <div class="pane-right">

        <!-- 属性面板（折叠面板，右侧固定） -->
        <div class="inspector" v-if="inspectorOpen">
          <div class="ins-hd">
            <span>{{ inspectorTitle }}</span>
            <button class="ins-close" @click="inspectorOpen=false">×</button>
          </div>
          <!-- 片段相关功能的 tab 切换 -->
          <div class="ins-tabs" v-if="activeClip && ['clip','speed','zoom','split-screen','filter','crop','background','annotate'].includes(inspectorMode)">
            <button class="ins-tab" :class="{on:inspectorMode==='clip'}" @click="inspectorMode='clip'" title="基础">属性</button>
            <button class="ins-tab" :class="{on:inspectorMode==='speed'}" @click="inspectorMode='speed'" title="速度">⏱</button>
            <button class="ins-tab" :class="{on:inspectorMode==='zoom'}" @click="inspectorMode='zoom'" title="推镜">🔍</button>
            <button class="ins-tab" :class="{on:inspectorMode==='split-screen'}" @click="inspectorMode='split-screen'" title="分屏">⊞</button>
            <button class="ins-tab" :class="{on:inspectorMode==='crop'}" @click="inspectorMode='crop'" title="裁剪">✂</button>
            <button class="ins-tab" :class="{on:inspectorMode==='background'}" @click="inspectorMode='background'" title="背景">🎨</button>
            <button class="ins-tab" :class="{on:inspectorMode==='annotate'}" @click="inspectorMode='annotate'" title="标注">✏️</button>
            <button class="ins-tab" :class="{on:inspectorMode==='filter'}" @click="inspectorMode='filter'" title="滤镜">◑</button>
          </div>
          <div class="ins-body">
            <!-- Clip 属性 -->
            <template v-if="inspectorMode==='clip' && activeClip">
              <div class="ins-group">
                <label class="ig-label">名称</label>
                <input class="ig-input" v-model="activeClip.name" />
              </div>
              <div class="ins-group">
                <label class="ig-label">入 / 出点</label>
                <div class="ig-row">
                  <div class="ig-field"><span class="ig-tag">入</span><input class="ig-num" type="number" :value="activeClip.trimStart.toFixed(2)" @change="e=>setTrimStart(+(e.target as HTMLInputElement).value)" step="0.1" /></div>
                  <span class="ig-arr">›</span>
                  <div class="ig-field"><span class="ig-tag">出</span><input class="ig-num" type="number" :value="activeClip.trimEnd.toFixed(2)" @change="e=>setTrimEnd(+(e.target as HTMLInputElement).value)" step="0.1" /></div>
                  <span class="ig-dur">{{ fmtT(activeClip.trimEnd-activeClip.trimStart) }}</span>
                </div>
                <div class="ig-btns">
                  <button class="ig-btn" @click="setTrimStart(currentTime)">← 入点</button>
                  <button class="ig-btn" @click="setTrimEnd(currentTime)">出点 →</button>
                </div>
              </div>
              <div class="ins-group">
                <label class="ig-label">音量 <span class="ig-val">{{ activeClip.volume }}%</span></label>
                <div class="ig-row"><input type="range" class="ig-slider" min="0" max="200" v-model.number="activeClip.volume" @input="applyMasterVol" /><!-- UI 三批·组5：静音开关 emoji 换为内联 stroke SVG（currentColor 随文本色），并补 aria-label -->
<button class="ig-mute" @click="activeClip.muted=!activeClip.muted" :aria-label="activeClip.muted?'取消静音':'静音'"><svg v-if="activeClip.muted" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg><svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button></div>
              </div>
              <div class="ins-group">
                <label class="ig-label">速度</label>
                <div class="spd-grid">
                  <button v-for="s in [0.25,0.5,0.75,1,1.25,1.5,2,4]" :key="s" class="spd-btn" :class="{on:activeClip.speed===s}" @click="setSpeed(s)">{{ s }}×</button>
                </div>
              </div>
              <div class="ins-group">
                <label class="ig-label">滤镜预设</label>
                <div class="pre-grid">
                  <button v-for="p in presets" :key="p.name" class="pre-btn" :class="{on:activeClip.preset===p.name}" @click="applyPreset(p)">{{ p.name }}</button>
                </div>
              </div>
              <div v-for="f in filterDefs" :key="f.key" class="ins-slider-row">
                <span class="isr-l">{{ f.label }}</span>
                <input type="range" class="ig-slider" :min="f.min" :max="f.max" :value="activeClip.filters[f.key]" @input="e=>{activeClip!.filters[f.key]=+(e.target as HTMLInputElement).value;applyFilters()}" />
                <span class="isr-r">{{ activeClip.filters[f.key] }}{{ f.unit }}</span>
                <button class="isr-rst" @click="activeClip!.filters[f.key]=f.default;applyFilters()">↺</button>
              </div>
              <div class="ins-group">
                <button class="ig-btn ig-btn--danger" @click="removeClip(activeClipIdx)">🗑 删除片段</button>
              </div>
            </template>

            <!-- ══ 速度面板 ══ -->
            <template v-if="inspectorMode==='speed' && activeClip">
              <div class="ins-group">
                <label class="ig-label">播放速度 <span class="ig-val">{{ activeClip.speed }}×</span></label>
                <input type="range" class="ig-slider" min="0.1" max="4" step="0.05"
                  v-model.number="activeClip.speed"
                  @input="onSpeedChange" style="width:100%;margin-bottom:8px" />
                <div class="spd-grid" style="grid-template-columns:repeat(4,1fr)">
                  <button v-for="sp in [0.25,0.5,0.75,1,1.25,1.5,2,4]" :key="sp" class="spd-btn"
                    :class="{on:activeClip.speed===sp}" @click="setSpeed(sp)">{{ sp }}×</button>
                </div>
              </div>
              <div class="ins-group">
                <div class="speed-info">
                  <div class="si-row"><span>原始时长</span><span>{{ fmtT(activeClip.trimEnd - activeClip.trimStart) }}</span></div>
                  <div class="si-row"><span>实际播出</span><span class="ig-val">{{ fmtT((activeClip.trimEnd - activeClip.trimStart) / activeClip.speed) }}</span></div>
                  <div class="si-row" :class="activeClip.speed<1?'slow':'fast'">
                    <span>效果</span>
                    <span>{{ activeClip.speed < 1 ? '🐢 慢动作' : activeClip.speed > 1 ? '⚡ 快进' : '✓ 正常' }}</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- ══ 推镜面板 ══ -->
            <template v-if="inspectorMode==='zoom' && activeClip">
              <div class="ins-group">
                <div class="feat-toggle-row">
                  <span>推镜 / 镜头拉近</span>
                  <div class="toggle-sw" :class="{on:activeClip.zoom.enabled}"
                    @click="activeClip.zoom.enabled=!activeClip.zoom.enabled;renderPreviewFrame()">
                    <div class="toggle-knob"></div>
                  </div>
                </div>
                <p class="ins-hint" v-if="!activeClip.zoom.enabled">
                  开启后镜头从全画面平滑推近到焦点<br>在预览区点击设定焦点位置
                </p>
              </div>

              <div v-if="activeClip.zoom.enabled">
                <!-- 目标焦点 -->
                <div class="zoom-target-box">
                  <div class="ztb-label">
                    <span>🎯 目标焦点</span>
                    <span class="ig-val">{{ (activeClip.zoom.x*100).toFixed(0) }}%,{{ (activeClip.zoom.y*100).toFixed(0) }}%</span>
                  </div>
                  <p class="ins-hint" style="margin:0 0 6px">在左侧预览区点击设定焦点，或用滑块精调</p>
                  <div class="ins-slider-row">
                    <span class="isr-l">X</span>
                    <input type="range" class="ig-slider" min="0.05" max="0.95" step="0.01"
                      v-model.number="activeClip.zoom.x" @input="renderPreviewFrame()" />
                    <span class="isr-r">{{ (activeClip.zoom.x*100).toFixed(0) }}%</span>
                  </div>
                  <div class="ins-slider-row">
                    <span class="isr-l">Y</span>
                    <input type="range" class="ig-slider" min="0.05" max="0.95" step="0.01"
                      v-model.number="activeClip.zoom.y" @input="renderPreviewFrame()" />
                    <span class="isr-r">{{ (activeClip.zoom.y*100).toFixed(0) }}%</span>
                  </div>
                </div>

                <!-- 目标焦距 -->
                <div class="ins-group" style="margin-top:10px">
                  <label class="ig-label">目标焦距（放大倍数）<span class="ig-val">{{ activeClip.zoom.scale.toFixed(1) }}×</span></label>
                  <input type="range" class="ig-slider" min="1.2" max="8" step="0.1"
                    v-model.number="activeClip.zoom.scale"
                    @input="renderPreviewFrame()" style="width:100%;margin-bottom:5px" />
                  <div class="zoom-presets-row">
                    <button class="zpr-btn" v-for="sc in [1.5,2,2.5,3,4,6]" :key="sc"
                      :class="{on: Math.abs(activeClip.zoom.scale-sc)<0.05}"
                      @click="activeClip.zoom.scale=sc;renderPreviewFrame()">{{ sc }}×</button>
                  </div>
                </div>

                <!-- 推镜动画设置 -->
                <div class="anim-section">
                  <div class="anim-sec-title">推镜动画</div>

                  <div class="ins-group">
                    <label class="ig-label">推镜时长 <span class="ig-val">
                      {{ activeClip.zoom.animDuration === 0 ? '瞬间' : activeClip.zoom.animDuration.toFixed(1) + 's' }}
                    </span></label>
                    <input type="range" class="ig-slider" min="0" max="5" step="0.1"
                      v-model.number="activeClip.zoom.animDuration"
                      style="width:100%;margin-bottom:5px" />
                    <div class="anim-dur-row">
                      <button class="ig-btn" @click="activeClip.zoom.animDuration=0">瞬间</button>
                      <button class="ig-btn" v-for="d in [0.5,1,1.5,2,3]" :key="d"
                        :class="{on: Math.abs(activeClip.zoom.animDuration-d)<0.05}"
                        @click="activeClip.zoom.animDuration=d">{{ d }}s</button>
                    </div>
                  </div>

                  <div class="ins-group" v-if="activeClip.zoom.animDuration > 0">
                    <label class="ig-label">推镜开始时间（入点后）<span class="ig-val">{{ activeClip.zoom.animStartTime.toFixed(1) }}s</span></label>
                    <input type="range" class="ig-slider" min="0"
                      :max="Math.max(0.1, (activeClip.trimEnd-activeClip.trimStart) - activeClip.zoom.animDuration)"
                      step="0.1"
                      v-model.number="activeClip.zoom.animStartTime"
                      style="width:100%" />
                    <div class="ig-btns" style="margin-top:5px">
                      <button class="ig-btn" @click="activeClip.zoom.animStartTime=0">从头开始</button>
                      <button class="ig-btn" @click="activeClip.zoom.animStartTime=currentTime-activeClip.offset">用当前时间</button>
                    </div>
                  </div>

                  <div class="ins-group" v-if="activeClip.zoom.animDuration > 0">
                    <label class="ig-label">缓动曲线</label>
                    <div class="easing-grid">
                      <button v-for="e in easingModes" :key="e.key" class="easing-btn"
                        :class="{on: activeClip.zoom.animMode===e.key}"
                        @click="activeClip.zoom.animMode=e.key">{{ e.label }}</button>
                    </div>
                  </div>
                </div>

                <!-- 预览控制 -->
                <div class="ins-group">
                  <div class="zoom-preview-btns">
                    <!-- UI 三批·组5：预览推镜按钮的播放三角 emoji 换为内联 stroke SVG 三角图标 -->
<button class="ig-btn ig-btn--primary" @click="previewZoomAnim"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>预览推镜</button>
                    <button class="ig-btn" @click="resetZoom">↺ 重置</button>
                  </div>
                </div>

                <!-- 当前帧状态（调试）-->
                <div class="zoom-state-info">
                  <span>当前缩放</span>
                  <span class="ig-val">{{ getCurrentZoomState(activeClip, currentTime).toFixed(2) }}×</span>
                </div>
              </div>
            </template>

            <!-- ══ 分屏/画中画面板 ══ -->
            <template v-if="inspectorMode==='split-screen' && activeClip">
              <div class="ins-group">
                <div class="feat-toggle-row">
                  <span>分屏 / 画中画</span>
                  <div class="toggle-sw" :class="{on:activeClip.splitScreen.enabled}"
                    @click="activeClip.splitScreen.enabled=!activeClip.splitScreen.enabled;renderPreviewFrame()">
                    <div class="toggle-knob"></div>
                  </div>
                </div>
              </div>
              <div v-if="activeClip.splitScreen.enabled">
                <!-- 配对视频 -->
                <div class="ins-group">
                  <label class="ig-label">第二路视频</label>
                  <select class="ig-sel" style="width:100%"
                    v-model="activeClip.splitScreen.partnerClipId"
                    @change="onPartnerChange">
                    <option value="">-- 选择配对片段 --</option>
                    <option v-for="c in clips.filter(c=>c.id!==activeClip?.id)" :key="c.id" :value="c.id">
                      {{ c.name }}
                    </option>
                  </select>
                  <p class="ins-hint" v-if="!activeClip.splitScreen.partnerClipId">请先选择配对片段</p>
                </div>
                <!-- 布局模式 -->
                <div class="ins-group">
                  <label class="ig-label">布局</label>
                  <div class="split-mode-grid">
                    <button v-for="m in splitModes" :key="m.key"
                      class="split-mode-btn" :class="{on:activeClip.splitScreen.mode===m.key}"
                      @click="activeClip.splitScreen.mode=m.key;renderPreviewFrame()">
                      <span v-html="m.icon" class="smb-icon"></span>
                      <span>{{ m.label }}</span>
                    </button>
                  </div>
                </div>
                <!-- 分屏比例 -->
                <template v-if="['h-split','v-split'].includes(activeClip.splitScreen.mode)">
                  <div class="ins-group">
                    <label class="ig-label">比例 <span class="ig-val">
                      {{ Math.round(activeClip.splitScreen.splitRatio*100) }}:{{ Math.round((1-activeClip.splitScreen.splitRatio)*100) }}
                    </span></label>
                    <input type="range" class="ig-slider" min="0.2" max="0.8" step="0.05"
                      v-model.number="activeClip.splitScreen.splitRatio"
                      @input="renderPreviewFrame()" style="width:100%;margin-bottom:4px" />
                    <div class="ig-btns">
                      <button class="ig-btn" @click="activeClip.splitScreen.splitRatio=0.5;renderPreviewFrame()">1:1</button>
                      <button class="ig-btn" @click="activeClip.splitScreen.splitRatio=0.333;renderPreviewFrame()">1:2</button>
                      <button class="ig-btn" @click="activeClip.splitScreen.splitRatio=0.667;renderPreviewFrame()">2:1</button>
                      <button class="ig-btn" @click="activeClip.splitScreen.splitRatio=0.618;renderPreviewFrame()">黄金比</button>
                    </div>
                  </div>
                  <div class="ins-group">
                    <label class="ig-label">主画面</label>
                    <div class="ig-row" style="gap:4px">
                      <button v-for="side in (activeClip.splitScreen.mode==='h-split'
                        ?[{k:'left',l:'主左'},{k:'right',l:'主右'}]
                        :[{k:'top',l:'主上'},{k:'bottom',l:'主下'}])"
                        :key="side.k" class="ig-btn" :class="{on:activeClip.splitScreen.mainSide===side.k}"
                        @click="activeClip.splitScreen.mainSide=side.k;renderPreviewFrame()">
                        {{ side.l }}
                      </button>
                    </div>
                  </div>
                </template>
                <!-- 画中画 -->
                <template v-if="['pip-rect','pip-circle'].includes(activeClip.splitScreen.mode)">
                  <div class="ins-group">
                    <label class="ig-label">大小 W/H</label>
                    <div class="ins-slider-row">
                      <span class="isr-l">宽</span>
                      <input type="range" class="ig-slider" min="0.1" max="0.7" step="0.01"
                        v-model.number="activeClip.splitScreen.pipW" @input="renderPreviewFrame()" />
                      <span class="isr-r">{{ Math.round(activeClip.splitScreen.pipW*100) }}%</span>
                    </div>
                    <div class="ins-slider-row">
                      <span class="isr-l">高</span>
                      <input type="range" class="ig-slider" min="0.1" max="0.7" step="0.01"
                        v-model.number="activeClip.splitScreen.pipH" @input="renderPreviewFrame()" />
                      <span class="isr-r">{{ Math.round(activeClip.splitScreen.pipH*100) }}%</span>
                    </div>
                    <div class="ig-btns" style="margin-top:4px">
                      <button class="ig-btn" @click="activeClip.splitScreen.pipW=0.28;activeClip.splitScreen.pipH=0.28;renderPreviewFrame()">小</button>
                      <button class="ig-btn" @click="activeClip.splitScreen.pipW=0.4;activeClip.splitScreen.pipH=0.4;renderPreviewFrame()">中</button>
                      <button class="ig-btn" @click="activeClip.splitScreen.pipW=0.55;activeClip.splitScreen.pipH=0.55;renderPreviewFrame()">大</button>
                    </div>
                  </div>
                  <div class="ins-group">
                    <label class="ig-label">位置（可在预览区拖动）</label>
                    <div class="ins-slider-row">
                      <span class="isr-l">X</span>
                      <input type="range" class="ig-slider" min="0" max="0.85" step="0.01"
                        v-model.number="activeClip.splitScreen.pipX" @input="renderPreviewFrame()" />
                      <span class="isr-r">{{ Math.round(activeClip.splitScreen.pipX*100) }}%</span>
                    </div>
                    <div class="ins-slider-row">
                      <span class="isr-l">Y</span>
                      <input type="range" class="ig-slider" min="0" max="0.85" step="0.01"
                        v-model.number="activeClip.splitScreen.pipY" @input="renderPreviewFrame()" />
                      <span class="isr-r">{{ Math.round(activeClip.splitScreen.pipY*100) }}%</span>
                    </div>
                    <div class="pip-corner-grid">
                      <button class="ig-btn" @click="setPipCorner('tl')">↖左上</button>
                      <button class="ig-btn" @click="setPipCorner('tr')">↗右上</button>
                      <button class="ig-btn" @click="setPipCorner('bl')">↙左下</button>
                      <button class="ig-btn" @click="setPipCorner('br')">↘右下</button>
                    </div>
                  </div>
                  <div class="ins-group">
                    <label class="ig-label">边框</label>
                    <div class="ig-row" style="gap:8px">
                      <input type="checkbox" v-model="activeClip.splitScreen.pipBorder" @change="renderPreviewFrame()" />
                      <span style="font-size:11px;color:rgba(255,255,255,.6)">显示边框</span>
                      <input v-if="activeClip.splitScreen.pipBorder" type="color"
                        class="ig-col" v-model="activeClip.splitScreen.pipBorderColor" @input="renderPreviewFrame()" />
                    </div>
                  </div>
                  <p class="ins-hint" style="color:var(--sp-color-primary)">💡 预览区可拖动画中画</p>
                </template>
              </div>
            </template>
            <!-- ══ 裁剪面板 ══ -->
            <template v-if="inspectorMode==='crop' && activeClip">
              <div class="ins-group">
                <div class="feat-toggle-row">
                  <span>裁剪视频区域</span>
                  <div class="toggle-sw" :class="{on:activeClip.crop.enabled}"
                    @click="activeClip.crop.enabled=!activeClip.crop.enabled;renderPreviewFrame()">
                    <div class="toggle-knob"></div>
                  </div>
                </div>
                <p class="ins-hint">隐藏画面边缘，聚焦主要内容</p>
              </div>
              <div v-if="activeClip.crop.enabled">
                <div class="ins-group">
                  <label class="ig-label">裁剪区域（在预览区拖动调整）</label>
                  <div class="crop-presets">
                    <button class="crop-preset-btn" @click="setCropPreset('16:9')">16:9</button>
                    <button class="crop-preset-btn" @click="setCropPreset('9:16')">9:16</button>
                    <button class="crop-preset-btn" @click="setCropPreset('1:1')">1:1</button>
                    <button class="crop-preset-btn" @click="setCropPreset('4:3')">4:3</button>
                    <button class="crop-preset-btn" @click="setCropPreset('free')">自由</button>
                  </div>
                </div>
                <div class="ins-group">
                  <label class="ig-label">位置</label>
                  <div class="ins-slider-row">
                    <span class="isr-l">X</span>
                    <input type="range" class="ig-slider" min="0" max="0.9" step="0.01"
                      v-model.number="activeClip.crop.x" @input="clampCrop();renderPreviewFrame()" />
                    <span class="isr-r">{{ Math.round(activeClip.crop.x*100) }}%</span>
                  </div>
                  <div class="ins-slider-row">
                    <span class="isr-l">Y</span>
                    <input type="range" class="ig-slider" min="0" max="0.9" step="0.01"
                      v-model.number="activeClip.crop.y" @input="clampCrop();renderPreviewFrame()" />
                    <span class="isr-r">{{ Math.round(activeClip.crop.y*100) }}%</span>
                  </div>
                </div>
                <div class="ins-group">
                  <label class="ig-label">尺寸</label>
                  <div class="ins-slider-row">
                    <span class="isr-l">宽</span>
                    <input type="range" class="ig-slider" min="0.1" max="1" step="0.01"
                      v-model.number="activeClip.crop.w" @input="clampCrop();renderPreviewFrame()" />
                    <span class="isr-r">{{ Math.round(activeClip.crop.w*100) }}%</span>
                  </div>
                  <div class="ins-slider-row">
                    <span class="isr-l">高</span>
                    <input type="range" class="ig-slider" min="0.1" max="1" step="0.01"
                      v-model.number="activeClip.crop.h" @input="clampCrop();renderPreviewFrame()" />
                    <span class="isr-r">{{ Math.round(activeClip.crop.h*100) }}%</span>
                  </div>
                </div>
                <div class="ins-group">
                  <button class="ig-btn" style="width:100%" @click="activeClip.crop={...defaultCrop(),enabled:true};renderPreviewFrame()">↺ 重置</button>
                </div>
              </div>
            </template>

            <!-- ══ 背景面板 ══ -->
            <template v-if="inspectorMode==='background' && activeClip">
              <div class="ins-group">
                <label class="ig-label">背景类型</label>
                <div class="bg-type-tabs">
                  <button class="bg-type-btn" :class="{on:activeClip.background.type==='none'}"
                    @click="activeClip.background.type='none';renderPreviewFrame()">无</button>
                  <button class="bg-type-btn" :class="{on:activeClip.background.type==='color'}"
                    @click="activeClip.background.type='color';renderPreviewFrame()">纯色</button>
                  <button class="bg-type-btn" :class="{on:activeClip.background.type==='gradient'}"
                    @click="activeClip.background.type='gradient';renderPreviewFrame()">渐变</button>
                  <button class="bg-type-btn" :class="{on:activeClip.background.type==='blur'}"
                    @click="activeClip.background.type='blur';renderPreviewFrame()">模糊背景</button>
                </div>
              </div>

              <!-- 纯色 -->
              <div class="ins-group" v-if="activeClip.background.type==='color'">
                <label class="ig-label">颜色</label>
                <div class="bg-color-row">
                  <input type="color" class="bg-color-pick" v-model="activeClip.background.color" @input="renderPreviewFrame()" />
                  <div class="bg-presets">
                    <div v-for="c in bgPresetColors" :key="c" class="bg-preset-dot"
                      :style="{background:c}" @click="activeClip.background.color=c;renderPreviewFrame()"></div>
                  </div>
                </div>
              </div>

              <!-- 渐变 -->
              <div class="ins-group" v-if="activeClip.background.type==='gradient'">
                <label class="ig-label">渐变颜色</label>
                <div class="ig-row" style="gap:8px;margin-bottom:6px">
                  <input type="color" class="ig-col" v-model="activeClip.background.gradient.from" @input="renderPreviewFrame()" />
                  <span style="color:rgba(255,255,255,.4);font-size:12px">→</span>
                  <input type="color" class="ig-col" v-model="activeClip.background.gradient.to" @input="renderPreviewFrame()" />
                </div>
                <label class="ig-label">角度 <span class="ig-val">{{ activeClip.background.gradient.angle }}°</span></label>
                <input type="range" class="ig-slider" min="0" max="360" step="1"
                  v-model.number="activeClip.background.gradient.angle" @input="renderPreviewFrame()" style="width:100%" />
                <div class="bg-gradient-presets">
                  <div v-for="g in gradientPresets" :key="g.name"
                    class="bg-grad-dot"
                    :style="{background:`linear-gradient(135deg,${g.from},${g.to})`}"
                    @click="activeClip.background.gradient.from=g.from;activeClip.background.gradient.to=g.to;renderPreviewFrame()">
                  </div>
                </div>
              </div>

              <!-- 模糊背景 -->
              <div class="ins-group" v-if="activeClip.background.type==='blur'">
                <label class="ig-label">模糊程度 <span class="ig-val">{{ activeClip.background.blurAmount }}px</span></label>
                <input type="range" class="ig-slider" min="2" max="60" step="1"
                  v-model.number="activeClip.background.blurAmount" @input="renderPreviewFrame()" style="width:100%" />
              </div>

              <!-- 通用背景设置 -->
              <template v-if="activeClip.background.type!=='none'">
                <div class="ins-group">
                  <label class="ig-label">内边距 <span class="ig-val">{{ Math.round(activeClip.background.padding*100) }}%</span></label>
                  <input type="range" class="ig-slider" min="0" max="0.2" step="0.005"
                    v-model.number="activeClip.background.padding" @input="renderPreviewFrame()" style="width:100%" />
                </div>
                <div class="ins-group">
                  <label class="ig-label">圆角 <span class="ig-val">{{ activeClip.background.borderRadius }}px</span></label>
                  <input type="range" class="ig-slider" min="0" max="50" step="1"
                    v-model.number="activeClip.background.borderRadius" @input="renderPreviewFrame()" style="width:100%" />
                </div>
                <div class="ins-group">
                  <label class="ig-label">阴影 <span class="ig-val">{{ Math.round(activeClip.background.shadowOpacity*100) }}%</span></label>
                  <input type="range" class="ig-slider" min="0" max="1" step="0.05"
                    v-model.number="activeClip.background.shadowOpacity" @input="renderPreviewFrame()" style="width:100%" />
                </div>
                <div class="ins-group">
                  <div class="feat-toggle-row">
                    <span>运动模糊</span>
                    <div class="toggle-sw" :class="{on:activeClip.motionBlur}"
                      @click="activeClip.motionBlur=!activeClip.motionBlur;renderPreviewFrame()">
                      <div class="toggle-knob"></div>
                    </div>
                  </div>
                  <p class="ins-hint">移动和缩放时自动添加运动模糊</p>
                </div>
              </template>
            </template>

            <!-- ══ 标注面板 ══ -->
            <template v-if="inspectorMode==='annotate' && activeClip">
              <div class="ins-group">
                <label class="ig-label">添加标注</label>
                <div class="annot-types">
                  <button class="annot-type-btn" @click="addAnnotation('text')" title="文字">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                    文字
                  </button>
                  <button class="annot-type-btn" @click="addAnnotation('arrow')" title="箭头">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    箭头
                  </button>
                  <button class="annot-type-btn" @click="addAnnotation('rect')" title="矩形">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                    矩形
                  </button>
                  <button class="annot-type-btn" @click="addAnnotation('circle')" title="圆形">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>
                    圆形
                  </button>
                </div>
              </div>

              <!-- 已有标注列表 -->
              <div class="ins-group" v-if="activeClip.annotations.length">
                <label class="ig-label">标注列表 ({{ activeClip.annotations.length }})</label>
                <div class="annot-list">
                  <div v-for="(ann,ai) in activeClip.annotations" :key="ann.id"
                    class="annot-item" :class="{on:selAnnotIdx===ai}"
                    @click="selAnnotIdx=ai">
                    <span class="annot-icon">{{ {text:'T',arrow:'→',rect:'□',circle:'○',image:'🖼'}[ann.type] }}</span>
                    <span class="annot-lbl">{{ ann.type==='text'?ann.text.slice(0,12)||(ann.type+' '+(ai+1)):ann.type+' '+(ai+1) }}</span>
                    <span class="annot-tc">{{ fmtT(ann.startT) }}</span>
                    <button class="cap-ic del" @click.stop="removeAnnotation(ai)">×</button>
                  </div>
                </div>
              </div>

              <!-- 选中标注的属性 -->
              <div v-if="selAnnotIdx>=0 && activeClip.annotations[selAnnotIdx]" class="annot-editor">
                <div class="ins-group">
                  <label class="ig-label">{{ activeClip.annotations[selAnnotIdx].type==='text'?'文字内容':'颜色' }}</label>
                  <textarea v-if="activeClip.annotations[selAnnotIdx].type==='text'"
                    class="ig-ta" rows="2" v-model="activeClip.annotations[selAnnotIdx].text"
                    @input="renderPreviewFrame()" placeholder="输入文字…"></textarea>
                  <div v-if="activeClip.annotations[selAnnotIdx].type==='text'" class="ins-slider-row" style="margin-top:5px">
                    <span class="isr-l">字号</span>
                    <input type="range" class="ig-slider" min="12" max="80" step="1"
                      v-model.number="activeClip.annotations[selAnnotIdx].fontSize" @input="renderPreviewFrame()" />
                    <span class="isr-r">{{ activeClip.annotations[selAnnotIdx].fontSize }}</span>
                  </div>
                </div>
                <div class="ins-group">
                  <div class="ig-row" style="gap:8px">
                    <label class="ig-label" style="margin:0">颜色</label>
                    <input type="color" class="ig-col" v-model="activeClip.annotations[selAnnotIdx].color" @input="renderPreviewFrame()" />
                    <div v-for="c in annotColors" :key="c" class="annot-color-dot"
                      :style="{background:c}" @click="activeClip.annotations[selAnnotIdx].color=c;renderPreviewFrame()"></div>
                  </div>
                </div>
                <div class="ins-group" v-if="['rect','circle','arrow'].includes(activeClip.annotations[selAnnotIdx].type)">
                  <label class="ig-label">线宽 <span class="ig-val">{{ activeClip.annotations[selAnnotIdx].strokeWidth }}px</span></label>
                  <input type="range" class="ig-slider" min="1" max="20" step="1"
                    v-model.number="activeClip.annotations[selAnnotIdx].strokeWidth" @input="renderPreviewFrame()" style="width:100%" />
                </div>
                <div class="ins-group">
                  <label class="ig-label">透明度 <span class="ig-val">{{ Math.round(activeClip.annotations[selAnnotIdx].opacity*100) }}%</span></label>
                  <input type="range" class="ig-slider" min="0.1" max="1" step="0.05"
                    v-model.number="activeClip.annotations[selAnnotIdx].opacity" @input="renderPreviewFrame()" style="width:100%" />
                </div>
                <div class="ins-group">
                  <label class="ig-label">显示时间段</label>
                  <div class="ig-row" style="gap:5px">
                    <div class="ig-field"><span class="ig-tag">入</span><input class="ig-num" type="number" v-model.number="activeClip.annotations[selAnnotIdx].startT" step="0.1" min="0" @input="renderPreviewFrame()" /></div>
                    <span class="ig-arr">→</span>
                    <div class="ig-field"><span class="ig-tag">出</span><input class="ig-num" type="number" v-model.number="activeClip.annotations[selAnnotIdx].endT" step="0.1" @input="renderPreviewFrame()" /></div>
                  </div>
                  <button class="ig-btn" style="margin-top:5px" @click="activeClip.annotations[selAnnotIdx].startT=Math.max(0,currentTime-activeClip.offset)">用当前时间</button>
                </div>
                <div class="ins-group">
                  <button class="ig-btn ig-btn--danger" @click="removeAnnotation(selAnnotIdx)">🗑 删除标注</button>
                </div>
              </div>
              <p class="ins-hint" v-else-if="!activeClip.annotations.length">点击上方按钮添加标注，在预览区拖动调整位置</p>
            </template>

            <!-- Dub 属性 -->
            <template v-if="inspectorMode==='dub' && selDubIdx>=0 && dubClips[selDubIdx]">
              <div class="ins-group"><label class="ig-label">配音 {{ selDubIdx+1 }}</label></div>
              <div class="ins-group">
                <label class="ig-label">位置(秒)</label>
                <div class="ig-row">
                  <input class="ig-num" type="number" :value="dubClips[selDubIdx].at.toFixed(2)" @change="e=>dubClips[selDubIdx].at=Math.max(0,+(e.target as HTMLInputElement).value)" step="0.1" />
                  <button class="ig-btn" style="margin-left:5px" @click="dubClips[selDubIdx].at=currentTime">用当前</button>
                </div>
              </div>
              <div class="ins-group">
                <label class="ig-label">音量 <span class="ig-val">{{ dubClips[selDubIdx].volume }}%</span></label>
                <div class="ig-row"><input type="range" class="ig-slider" min="0" max="200" v-model.number="dubClips[selDubIdx].volume" /><button class="ig-mute" @click="dubClips[selDubIdx].muted=!dubClips[selDubIdx].muted" :aria-label="dubClips[selDubIdx].muted?'取消静音':'静音'"><svg v-if="dubClips[selDubIdx].muted" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg><svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button></div>
              </div>
              <audio :src="dubClips[selDubIdx].url" controls class="ins-audio"></audio>
              <div class="ins-group"><button class="ig-btn ig-btn--danger" @click="removeDub(selDubIdx)">🗑 删除配音</button></div>
            </template>

            <!-- 字幕 -->
            <template v-if="inspectorMode==='caption'">
              <div class="ins-group">
                <label class="ig-label">{{ editCapIdx>=0?'编辑字幕':'添加字幕' }}</label>
                <textarea class="ig-ta" v-model="capForm.text" rows="2" placeholder="输入字幕…"></textarea>
                <div class="ig-row" style="margin-top:5px">
                  <div class="ig-field"><span class="ig-tag">入</span><input class="ig-num" type="number" v-model.number="capForm.start" step="0.1" /></div>
                  <span class="ig-arr">›</span>
                  <div class="ig-field"><span class="ig-tag">出</span><input class="ig-num" type="number" v-model.number="capForm.end" step="0.1" /></div>
                </div>
                <div class="ig-row" style="margin-top:5px;flex-wrap:wrap;gap:4px">
                  <select class="ig-sel" v-model="capForm.position"><option value="bottom">底部</option><option value="top">顶部</option><option value="center">居中</option></select>
                  <input type="color" class="ig-col" v-model="capForm.color" />
                  <select class="ig-sel" v-model="capForm.size"><option value="sm">小</option><option value="md">中</option><option value="lg">大</option></select>
                  <button class="ig-btn" @click="capForm.start=currentTime">⏱</button>
                </div>
                <div class="ig-btns" style="margin-top:6px">
                  <button class="ig-btn ig-btn--primary" @click="submitCap" :disabled="!capForm.text">{{ editCapIdx>=0?'更新':'添加' }}</button>
                  <button v-if="editCapIdx>=0" class="ig-btn" @click="cancelCap">取消</button>
                </div>
              </div>
              <div class="ins-group" v-if="captions.length">
                <label class="ig-label">字幕 ({{ captions.length }})</label>
                <div class="cap-list">
                  <div v-for="(c,i) in captions" :key="i" class="cap-row" :class="{on:editCapIdx===i}">
                    <span class="cap-tc">{{ fmtT(c.start) }}</span>
                    <span class="cap-txt">{{ c.text }}</span>
                    <button class="cap-ic" @click="editCap(i)">✏</button>
                    <button class="cap-ic del" @click="deleteCap(i)">×</button>
                  </div>
                </div>
              </div>
              <div class="ins-group">
                <label class="ig-label">字幕文件</label>
                <div class="ig-row" style="margin-top:4px">
                  <span class="ig-tag">偏移</span>
                  <input class="ig-num" type="number" v-model.number="srtOffset" step="0.1" min="0" title="源字幕整体向后平移的秒数" />
                  <span class="ig-unit">秒</span>
                </div>
                <label class="ins-file-zone srt-file-zone">
                  + 导入 .srt / .vtt
                  <input type="file" accept=".srt,.vtt,text/plain" @change="importSubtitleFile" style="display:none" />
                </label>
                <div class="ig-btns" style="margin-top:5px">
                  <button class="ig-btn" :disabled="!captions.length" @click="exportSubtitles('srt')">导出 SRT</button>
                  <button class="ig-btn" :disabled="!captions.length" @click="exportSubtitles('vtt')">导出 VTT</button>
                </div>
                <p v-if="srtReport" class="srt-report">{{ srtReport }}</p>
                <p v-else class="srt-report srt-report--hint">导入的字幕按偏移落到时间线，并裁到成片时长内；导出时按当前时间线顺序编号。</p>
              </div>
            </template>

            <!-- 音频 -->
            <template v-if="inspectorMode==='audio'">
              <div class="ins-group">
                <label class="ig-label">背景音乐</label>
                <label class="ins-file-zone">
                  {{ bgMusicFile ? bgMusicFile.name : '+ 添加背景音乐' }}
                  <input type="file" accept="audio/*" @change="loadBgMusic" style="display:none" />
                </label>
                <div v-if="bgMusicFile" class="bg-music-ctrl">
                  <div class="ins-slider-row">
                    <span class="isr-l">音量</span>
                    <input type="range" class="ig-slider" min="0" max="200" v-model.number="bgVolume" />
                    <span class="isr-r">{{ bgVolume }}%</span>
                    <button class="ig-mute" @click="bgMuted=!bgMuted" :title="bgMuted?'取消静音':'静音'" :aria-label="bgMuted?'取消静音':'静音'"><svg v-if="bgMuted" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg><svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>
                  </div>
                  <button class="ig-btn ig-btn--danger" style="width:100%;margin-top:5px" @click="removeBgMusic">🗑 删除背景音乐</button>
                </div>
              </div>
              <div class="ins-group">
                <label class="ig-label">麦克风配音</label>
                <div v-if="micStatus!=='granted'" class="mic-hint">
                  <p>{{ micStatus==='denied'?'麦克风权限被拒绝，请在浏览器设置中允许':'需要麦克风权限' }}</p>
                  <button class="ig-btn ig-btn--primary" style="width:100%" @click="requestMic">🎤 授权麦克风</button>
                </div>
                <template v-else>
                  <div class="dub-ctrl-row">
                    <button class="dub-rec-btn" :class="{recording:dubRecording}" @click="toggleDub">
                      <span v-if="dubRecording" class="rec-dot"></span>
                      <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/></svg>
                      {{ dubRecording ? fmtT(dubElapsed) : '开始配音' }}
                    </button>
                    <span class="dub-pos">@ {{ fmtT(currentTime) }}</span>
                  </div>
                  <div v-if="dubRecording" class="level-bar"><div class="lv-fill" :style="{width:audioLevel+'%'}"></div></div>
                </template>
              </div>
            </template>

            <!-- AI -->
            <template v-if="inspectorMode==='ai'">
              <div v-if="!aiCfg.apiKey" class="ai-no-key">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <p>未配置 AI 模型</p>
                <p class="ai-nk-sub">请在插件「设置」中配置 AI</p>
              </div>
              <template v-else>
                <div class="ins-group">
                  <label class="ig-label">🎙 语音转字幕</label>
                  <select class="ig-sel" v-model="transcriptLang" style="width:100%;margin-bottom:5px"><option value="auto">自动检测</option><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option></select>
                  <button class="ig-btn ig-btn--primary" style="width:100%" @click="runTranscript" :disabled="aiLoading||!activeClip">{{ aiLoading&&aiTask==='transcript'?'识别中…':'提取字幕' }}</button>
                </div>
                <div class="ins-group">
                  <label class="ig-label">🌐 字幕翻译</label>
                  <div class="ig-row" style="gap:5px">
                    <select class="ig-sel" v-model="translateFrom"><option value="auto">自动</option><option value="zh">中</option><option value="en">英</option><option value="ja">日</option></select>
                    <span style="color:#666">→</span>
                    <select class="ig-sel" v-model="translateTo"><option value="zh">中文</option><option value="en">英文</option><option value="ja">日文</option><option value="ko">韩文</option><option value="fr">法文</option></select>
                  </div>
                  <button class="ig-btn ig-btn--primary" style="width:100%;margin-top:5px" @click="runTranslate" :disabled="aiLoading||!captions.length">{{ aiLoading&&aiTask==='translate'?'翻译中…':'翻译字幕 ('+captions.length+'条)' }}</button>
                </div>
                <div class="ins-group">
                  <label class="ig-label">🎵 变音 <span class="ig-val">{{ pitchShift>=0?'+':'' }}{{ pitchShift }}st</span></label>
                  <input type="range" class="ig-slider" min="-12" max="12" step="1" v-model.number="pitchShift" @change="applyPitchPreview" style="width:100%" />
                  <div class="pch-grid">
                    <button class="pch-btn" @click="pitchShift=-8;applyPitchPreview()">低沉</button>
                    <button class="pch-btn" @click="pitchShift=0;applyPitchPreview()">原声</button>
                    <button class="pch-btn" @click="pitchShift=6;applyPitchPreview()">女声</button>
                    <button class="pch-btn" @click="pitchShift=12;applyPitchPreview()">卡通</button>
                  </div>
                </div>
                <div v-if="aiResult" class="ai-result">
                  <div class="air-hd"><span>AI 输出</span><button class="cap-ic" @click="aiResult=''">×</button></div>
                  <pre class="air-txt">{{ aiResult }}</pre>
                  <button v-if="aiTask==='transcript'" class="ig-btn ig-btn--primary" style="width:100%;margin-top:5px" @click="applyTranscriptResult">应用字幕</button>
                  <button v-if="aiTask==='translate'" class="ig-btn ig-btn--primary" style="width:100%;margin-top:5px" @click="applyTranslateResult">替换字幕</button>
                </div>
                <div v-if="aiLoading" class="ai-loading"><div class="spin"></div>处理中…</div>
              </template>
            </template>
          </div>
        </div>

        <!-- 时间轴区域 -->
        <div class="timeline-area">

          <!-- 时间轴工具栏 -->
          <div class="tl-bar">
            <div class="tl-bar-l">
              <button class="tl-btn" :class="{on:tlTool==='select'}" @click="tlTool='select'" title="V">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 3l14 9-7 1-4 7z" fill="currentColor" opacity=".2"/><path d="M5 3l14 9-7 1-4 7z"/></svg>
              </button>
              <button class="tl-btn" :class="{on:tlTool==='split'}" @click="tlTool='split'" title="S">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="8" x2="6" y2="8"/><line x1="18" y1="8" x2="22" y2="8"/></svg>
              </button>
              <div class="tl-sep"></div>
              <button class="tl-btn tl-btn--danger" :disabled="activeClipIdx<0" @click="removeClip(activeClipIdx)" title="Del">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>
              <button class="tl-btn" @click="addVideoTrack" title="新增视频轨">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                轨道
              </button>
            </div>
            <div class="tl-tip" v-if="tlTool==='select'">拖动移位 · 边缘裁剪 · 右键菜单 · Ctrl+滚轮缩放</div>
            <div class="tl-tip tl-tip--cut" v-else>S / 点击轨道 → 切割</div>
            <div class="tl-bar-r">
              <button class="tl-icon-btn" @click="openInspector('audio')" title="音频配音">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
              </button>
              <button class="tl-icon-btn" @click="openInspector('caption')" title="字幕">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
              </button>
              <button class="tl-icon-btn" :class="{on:inspectorMode==='ai'&&inspectorOpen}" @click="openInspector('ai')" title="AI">AI</button>
              <div class="tl-sep"></div>
              <button class="zoom-btn" @click="zoomOut">－</button>
              <button class="zoom-btn" @click="fitView">⊡</button>
              <button class="zoom-btn" @click="zoomIn">＋</button>
            </div>
          </div>

          <!-- 时间轴主体 -->
          <div class="tl-main" ref="tlMain">

            <!-- 轨道控制列（固定左侧） -->
            <div class="track-controls">
              <div class="tc-ruler-spacer"></div>
              <!-- 视频轨控制 -->
              <div v-for="(vt,vi) in videoTracks" :key="'vc'+vi" class="track-ctrl track-ctrl--video">
                <span class="tc-label">V{{ vi+1 }}</span>
                <div class="tc-icons">
                  <button class="tc-ic" :class="{on:vt.locked}" @click="vt.locked=!vt.locked" title="锁定">🔒</button>
                  <button class="tc-ic" :class="{on:!vt.visible}" @click="vt.visible=!vt.visible" title="显示">👁</button>
                  <!-- UI 三批·组5：轨道控制/悬停栏静音按钮 emoji 换为内联 stroke SVG，补 aria-label -->
<button class="tc-ic" :class="{on:vt.muted}" @click="vt.muted=!vt.muted" title="静音" :aria-label="vt.muted?'取消静音':'静音'"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg></button>
                </div>
              </div>
              <!-- 音频轨控制 -->
              <div v-for="(at,ai) in audioTracks" :key="'ac'+ai" class="track-ctrl track-ctrl--audio">
                <span class="tc-label">A{{ ai+1 }}</span>
                <div class="tc-icons">
                  <button class="tc-ic" :class="{on:at.locked}" @click="at.locked=!at.locked">🔒</button>
                  <button class="tc-ic" :class="{on:at.muted}" @click="at.muted=!at.muted;syncAudioMute()" :aria-label="at.muted?'取消静音':'静音'"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg></button>
                </div>
              </div>
              <!-- 字幕轨控制 -->
              <div class="track-ctrl track-ctrl--caption">
                <span class="tc-label">字幕</span>
                <div class="tc-icons">
                  <button class="tc-ic" @click="openInspector('caption')">✏</button>
                </div>
              </div>
            </div>

            <!-- 滚动内容 -->
            <div class="tl-scroll-area" ref="tlScrollArea"
              @scroll="onTlScroll"
              @wheel.prevent="onTlWheel">

              <!-- 刻度尺 -->
              <div class="ruler" ref="rulerEl"
                :style="{width:tlPx+'px'}"
                @mousedown="onRulerDown"
                @mousemove="onRulerMove"
                @mouseleave="snapX=-1"
                :class="{'cursor-cut':tlTool==='split'}">
                <div v-for="t in ticks" :key="t.t" class="tick" :style="{left:t.x+'px'}">
                  <div class="tick-line" :class="{'tick-major':t.major}"></div>
                  <span v-if="t.label" class="tick-lbl">{{ t.label }}</span>
                </div>
                <!-- 吸附预览 -->
                <div v-if="snapX>=0" class="snap-line" :style="{left:snapX+'px'}"></div>
                <!-- 播放头 -->
                <div class="playhead" :style="{left:phPx+'px'}" @mousedown.stop="dragPH">
                  <div class="ph-triangle"></div>
                </div>
                <!-- 切割预览 -->
                <div v-if="tlTool==='split'&&splitX>=0" class="split-cursor" :style="{left:splitX+'px'}">
                  <span class="split-tc">{{ fmtT(splitX/pxPerSec) }}</span>
                </div>
              </div>

              <!-- 播放头竖线（跨越所有轨道） -->
              <div class="ph-vline" :style="{left:phPx+'px', height:totalTrackH+'px'}"></div>

              <!-- 视频轨道 -->
              <div v-for="(vt,vi) in videoTracks" :key="'vt'+vi"
                class="track track--video"
                :style="{width:tlPx+'px'}"
                :class="{'track--locked':vt.locked}"
                @click.self="onTrackBgClick"
                @mousemove="onTrackMousemove"
                @mouseleave="splitX=-1;hovSeg=-1">
                <div v-for="(clip,ci) in vt.clips" :key="clip.id"
                  class="seg"
                  :class="{'seg--active':activeClipIdx===globalClipIdx(vi,ci),'seg--hover':hovSeg===globalClipIdx(vi,ci),'seg--muted':clip.muted||vt.muted,'seg--locked':vt.locked}"
                  :style="segStyle(clip,globalClipIdx(vi,ci))"
                  @mousedown.stop="onSegDown(vi,ci,$event)"
                  @mouseenter="hovSeg=globalClipIdx(vi,ci)"
                  @mouseleave="hovSeg=-1"
                  @click.stop="onSegClick(vi,ci,$event)"
                  @contextmenu.prevent.stop="openCtxMenu(globalClipIdx(vi,ci),$event,'video')">
                  <!-- 左裁剪手柄 -->
                  <div class="trim-l" @mousedown.stop="onTrimDown(vi,ci,'start',$event)"><span>⋮</span></div>
                  <!-- 片段内容 -->
                  <div class="seg-body">
                    <!-- 模拟波形 -->
                    <svg class="seg-waveform" viewBox="0 0 100 20" preserveAspectRatio="none">
                      <polyline :points="clip._wave||defaultWave" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2"/>
                    </svg>
                    <span class="seg-name">{{ clip.name }}</span>
                    <span class="seg-dur">{{ fmtT(clip.trimEnd-clip.trimStart) }}</span>
                  </div>
                  <!-- 右裁剪手柄 -->
                  <div class="trim-r" @mousedown.stop="onTrimDown(vi,ci,'end',$event)"><span>⋮</span></div>
                  <!-- 拖拽时间标签 -->
                  <div v-if="dragLabel&&activeClipIdx===globalClipIdx(vi,ci)" class="drag-lbl">{{ dragLabel }}</div>
                  <!-- 悬停操作 -->
                  <div v-show="hovSeg===globalClipIdx(vi,ci)&&!isDragging&&tlTool==='select'" class="seg-hbar">
                    <button class="shb" @click.stop="splitClipAtPlayhead(vi,ci)" title="切割">✂</button>
                    <button class="shb del" @click.stop="removeClip(globalClipIdx(vi,ci))" title="删除">✕</button>
                  </div>
                </div>
                <!-- 切割预览线 -->
                <div v-if="tlTool==='split'&&splitX>=0" class="track-split-line" :style="{left:splitX+'px'}"></div>
              </div>

              <!-- 音频轨道 -->
              <div v-for="(at,ai) in audioTracks" :key="'at'+ai"
                class="track track--audio"
                :style="{width:tlPx+'px'}"
                :class="{'track--locked':at.locked}">
                <!-- BGM（第一条音频轨） -->
                <div v-if="ai===0&&bgMusicFile"
                  class="seg seg--bgm"
                  :style="{left:0,width:tlPx+'px'}"
                  @contextmenu.prevent="openBgmCtxMenu($event)">
                <div class="seg-body" style="padding:0 10px">
                  <svg class="seg-waveform" viewBox="0 0 100 20" preserveAspectRatio="none">
                    <polyline points="0,10 5,4 10,14 15,6 20,12 25,3 30,16 35,8 40,11 45,5 50,13 55,7 60,15 65,9 70,4 75,12 80,6 85,14 90,8 95,11 100,10" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2"/>
                  </svg>
                  <span class="seg-name" :style="{opacity:bgMuted?.45:1}">🎵 {{ bgMusicFile.name }}</span>
                </div>
                <div class="seg-hbar">
                  <button class="shb" @click.stop="bgMuted=!bgMuted" :title="bgMuted?'取消静音':'静音'" :aria-label="bgMuted?'取消静音':'静音'"><svg v-if="bgMuted" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg><svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>
                  <button class="shb del" @click.stop="removeBgMusic" title="删除背景音乐">✕</button>
                </div>
              </div>
                <!-- 配音片段 -->
                <div v-for="(dub,di) in dubClips" :key="dub.id"
                  class="seg seg--dub"
                  :class="{'seg--active':selDubIdx===di,'seg--muted':dub.muted||at.muted}"
                  :style="dubStyle(dub)"
                  @mousedown.stop="onDubDown(di,$event)"
                  @click.stop="selDubIdx=di;openInspector('dub')"
                  @contextmenu.prevent.stop="openCtxMenu(di,$event,'dub')">
                  <div class="seg-body" style="padding:0 8px;gap:4px">
                    <svg class="seg-waveform" viewBox="0 0 100 20" preserveAspectRatio="none" style="opacity:.7">
                      <polyline points="0,10 8,5 16,14 24,7 32,13 40,4 48,15 56,8 64,12 72,5 80,14 88,9 100,10" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
                    </svg>
                    <span class="seg-name" :style="{opacity:dub.muted?.4:1}">🎤 配音{{ di+1 }}</span>
                    <span class="seg-dur">{{ fmtT(dub.duration) }}</span>
                  </div>
                  <div v-show="!isDragging" class="seg-hbar">
                    <button class="shb" @click.stop="dub.muted=!dub.muted" :aria-label="dub.muted?'取消静音':'静音'"><svg v-if="dub.muted" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg><svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>
                    <button class="shb del" @click.stop="removeDub(di)">✕</button>
                  </div>
                </div>
                <label v-if="ai===0&&!bgMusicFile&&!dubClips.length" class="track-empty-lbl">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  添加音乐
                  <input type="file" accept="audio/*" @change="loadBgMusic" style="display:none">
                </label>
              </div>

              <!-- 字幕轨 -->
              <div class="track track--caption" :style="{width:tlPx+'px'}">
                <div v-for="(cap,ci) in captions" :key="ci"
                  class="seg seg--caption"
                  :style="capStyle(cap)"
                  @click="editCap(ci)">
                  <span class="seg-cap-txt">{{ cap.text }}</span>
                </div>
                <label v-if="!captions.length" class="track-empty-lbl" @click="openInspector('caption')">+ 添加字幕</label>
              </div>

              <!-- 标记点 -->
              <div v-for="m in markers" :key="m.id" class="marker" :style="{left:m.t*pxPerSec+'px'}" :title="m.label">
                <div class="marker-line"></div>
                <span class="marker-lbl">{{ m.label }}</span>
              </div>

            </div><!-- tl-scroll-area -->
          </div><!-- tl-main -->
        </div><!-- timeline-area -->
      </div><!-- pane-right -->
    </div><!-- main -->

    <!-- ══ 右键菜单 ══ -->
    <Teleport to="body">
      <div v-if="ctxMenu.show" class="ctx-menu" :style="{left:ctxMenu.x+'px',top:ctxMenu.y+'px'}" @click.stop>
        <div class="ctx-hd">{{ ctxMenu.type==='dub'?'配音片段':clips[ctxMenu.idx]?.name||'片段' }}</div>
        <template v-if="ctxMenu.type==='video'">
          <button class="ctx-item" @click="splitAtPlayhead_ctx">✂ 切割</button>
          <button class="ctx-item" @click="ctxDuplicate">⧉ 复制</button>
          <button class="ctx-item" @click="addMarkerAt">🏴 添加标记</button>
          <div class="ctx-sep"></div>
          <button class="ctx-item" @click="ctxMoveLeft" :disabled="ctxMenu.idx<=0">← 前移</button>
          <button class="ctx-item" @click="ctxMoveRight" :disabled="ctxMenu.idx>=clips.length-1">→ 后移</button>
          <div class="ctx-sep"></div>
          <button class="ctx-item ctx-del" @click="ctxDelete">🗑 删除</button>
        </template>
        <template v-else>
          <button class="ctx-item" @click="dubClips[ctxMenu.idx].muted=!dubClips[ctxMenu.idx].muted;ctxMenu.show=false">{{ dubClips[ctxMenu.idx]?.muted?'取消静音':'静音' }}</button>
          <div class="ctx-sep"></div>
          <button class="ctx-item ctx-del" @click="ctxDelete">🗑 删除</button>
        </template>
      </div>
    </Teleport>

    <!-- BGM 右键菜单 -->
    <Teleport to="body">
      <div v-if="bgCtxMenu.show" class="ctx-menu"
        :style="{left:bgCtxMenu.x+'px',top:bgCtxMenu.y+'px'}"
        @click.stop>
        <div class="ctx-hd">背景音乐</div>
        <button class="ctx-item" @click="bgMuted=!bgMuted;bgCtxMenu.show=false">
          {{ bgMuted?'取消静音':'静音' }}
        </button>
        <div class="ctx-sep"></div>
        <button class="ctx-item ctx-del" @click="removeBgMusic">🗑 删除背景音乐</button>
      </div>
    </Teleport>

    <!-- ══ 导出遮罩 ══ -->
    <div v-if="exporting" class="export-mask">
      <div class="export-card">
        <div class="export-spin"></div>
        <div class="export-title">正在导出</div>
        <div class="export-sub">{{ exportMsg }}</div>
        <div class="export-track"><div class="export-fill" :style="{width:exportPct+'%'}"></div></div>
        <div class="export-pct">{{ Math.round(exportPct) }}%</div>
        <button class="export-cancel" :disabled="exportCancelling" @click="cancelExport">
          {{ exportCancelling ? '正在取消…' : '取消导出' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
/**
 * 模块级安全纯函数（P0-7 消息注入面收紧）。
 * 放在普通 <script> 块：既能被下方 <script setup> 直接引用，
 * 又能被 tests/unit 单测导入；不依赖 Vue/DOM/chrome，保证可测性。
 */

/** 远程片段单次抓取允许的最大字节数（约 200MB），防止异常消息触发超大下载 */
export const MAX_REMOTE_CLIP_BYTES = 200 * 1024 * 1024;
/** 单条 LOAD_CLIPS 消息最多处理的片段数量，防止消息洪泛 */
export const MAX_LOAD_CLIPS_PER_MESSAGE = 50;

/**
 * 片段 URL 白名单校验（纯函数）：仅放行 http/https。
 * 显式禁止 data:、file:、chrome-extension:、javascript:、blob: 等方案。
 * blob: 不留任何例外——它的生命周期绑定创建它的文档，跨文档传过来必然失效；
 * 本地素材一律走 IndexedDB 键交接（见 shared/editorHandoff.ts）。
 * @param raw 待校验的 URL（未知类型，非字符串一律拒绝）
 * @returns 是否允许加载
 */
export function isAllowedClipUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false; // 非法 URL 字符串一律拒绝
  }
}

/**
 * 带体积上限的片段抓取（P0-7：消息通道限制体积）。
 * 先看 Content-Length 预判；响应带 body 时流式累计读取，超限立即取消读取并抛错。
 * @param url      已通过白名单校验的 http/https URL
 * @param maxBytes 允许的最大字节数
 * @returns 抓取到的 Blob；超限或 HTTP 非 2xx 时 reject
 */
export async function fetchClipBlobCapped(url: string, maxBytes: number): Promise<Blob> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const declared = Number(r.headers.get('content-length') || '0');
  if (declared > maxBytes) throw new Error(`片段超出体积上限：${declared} > ${maxBytes}`);
  if (!r.body) {
    const b = await r.blob();
    if (b.size > maxBytes) throw new Error(`片段超出体积上限：${b.size} > ${maxBytes}`);
    return b;
  }
  const reader = r.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = []; // 已读取的分片缓存
  let total = 0;                   // 已累计字节数
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => { /* 放弃剩余响应体，取消失败可忽略 */ });
      throw new Error(`片段超出体积上限：> ${maxBytes}`);
    }
    chunks.push(value);
  }
  return new Blob(chunks, { type: r.headers.get('content-type') || '' });
}
</script>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
// P1-8：分级日志（编辑器为扩展页面上下文，默认 info 级）
import { createLogger } from '@/utils/logger';
import { canUseWebCodecsExport, exportMp4 } from '@/core/mp4Export';
import { triggerBlobDownload } from '@/core/mediaConvert';
// 导出预设：画幅/短边/帧率/画质/适配 → 目标宽高与码率（纯函数，可单测）
import {
  DEFAULT_EXPORT_SETTINGS, EXPORT_FPS_OPTIONS, EXPORT_SHORT_SIDES,
  ASPECT_LABELS, FIT_LABELS, QUALITY_LABELS, SHORT_SIDE_LABELS,
  describeExportSettings, estimateBitrateBps, isFullFrame,
  composeFrameLayout, normalizeExportSettings, resolveExportSize,
  type ExportAspect, type ExportFit, type ExportQuality, type ExportSettings, type FrameLayout, type FrameRect,
} from '@/core/exportPresets';
// 字幕取景：预览覆盖层与导出烧字共用同一套字号/落点算式，避免两边各写一份
import {
  captionBaseline, captionFontSize, captionOverlayCenterX, captionOverlayTop, fullBox,
  type CaptionPositionKey, type CaptionSizeKey,
} from '@/core/captionRender';
// 素材交接：侧栏交的是 IndexedDB 键，不是 blob: URL（后者随侧栏文档销毁失效）
import { idbGet, idbPut, idbDelete, idbGetAllKeys, STORE_HLS_BLOBS } from '@/shared/blobStore';
import { isTransientHandoffKey, resolveHandoffBlob, type PendingEditorClip } from '@/shared/editorHandoff';
// 导出收尾：安全停止录制器、逐帧墙钟对齐、音轨失败归因（两条导出通道共用）
import { stopMediaRecorder, computeFrameDelay, describeAudioTrackFailure } from './exportControl';
// 工程自动保存：blob: URL 不能落盘，统一换成 IDB 素材键 / http 直链
import {
  EDITOR_PROJECT_KEY, EDITOR_MATERIAL_PREFIX, PROJECT_SNAPSHOT_VERSION, AUTOSAVE_DEBOUNCE_MS,
  newMaterialKey, toPersistedMedia, parseProjectSnapshot, hasRecoverableContent,
  collectMaterialKeys, isOrphanMaterial, type PersistedProject,
} from './projectSnapshot';
// 字幕文件双向：把网上下载的 .srt/.vtt 带进时间线，也把已识别字幕交出去
import {
  clampCuesToDuration, parseSubtitle, serializeSrt, serializeVtt, shiftCues,
  type SubtitleCue,
} from '@/core/srt';

/** 本模块 logger：保留原 `[EditorApp]`/`[split]` 前缀语义（split 场景并入模块前缀） */
const log = createLogger('EditorApp');

// ─── 类型 ────────────────────────────────────────
interface ZoomRegion {
  enabled: boolean;
  // 目标焦点（推镜终点）
  x: number;        // 焦点中心 X 0-1
  y: number;        // 焦点中心 Y 0-1
  scale: number;    // 目标放大倍数 1-8
  // 推镜动画
  animMode: 'instant'|'linear'|'ease-in'|'ease-out'|'ease-in-out';
  animDuration: number;  // 推镜时长(秒), 0=瞬间到位
  animStartTime: number; // 推镜开始时间（相对片段入点的秒数）
  // 起始状态（1x 全画面）
  startScale: number;    // 起始缩放，默认 1
  startX: number;        // 起始焦点 X，默认 0.5（中心）
  startY: number;        // 起始焦点 Y，默认 0.5
}
interface SplitScreen {
  enabled: boolean;
  mode: 'none'|'h-split'|'v-split'|'pip-circle'|'pip-rect'|'h-split-custom'|'v-split-custom';
  partnerClipId: string;
  // 分屏比例 (0.1-0.9，0.5=对半)
  splitRatio: number;
  mainSide: 'left'|'right'|'top'|'bottom';
  // 画中画自定义位置/大小 (0-1 相对画面)
  pipX: number;     // 画中画左上角 X
  pipY: number;     // 画中画左上角 Y
  pipW: number;     // 画中画宽度
  pipH: number;     // 画中画高度
  pipShape: 'rect'|'circle'|'rounded';
  pipBorder: boolean;
  pipBorderColor: string;
}
interface CropRegion {
  enabled: boolean;
  x: number; y: number;   // 左上角 0-1
  w: number; h: number;   // 宽高 0-1
}
interface Annotation {
  id: string;
  type: 'text'|'arrow'|'rect'|'circle'|'image';
  x: number; y: number;       // 位置 0-1
  w: number; h: number;       // 尺寸 0-1（arrow/text 用 w 作长度）
  angle: number;              // 旋转角度
  text: string;               // type=text 时的文字内容
  color: string;
  fontSize: number;
  strokeWidth: number;
  opacity: number;
  imageUrl?: string;          // type=image
  startT: number;             // 出现时间（相对片段入点）
  endT: number;               // 消失时间，-1=持续到结尾
}
interface Background {
  type: 'none'|'color'|'gradient'|'image'|'blur';
  color: string;
  gradient: { from: string; to: string; angle: number };
  imageUrl: string;
  blurAmount: number;
  padding: number;            // 主视频内边距 0-0.2
  borderRadius: number;       // 圆角 0-50px
  shadowOpacity: number;      // 阴影 0-1
}
interface Clip { id:string; name:string; url:string; duration:number; trimStart:number; trimEnd:number; offset:number; volume:number; muted:boolean; speed:number; preset:string; filters:Record<string,number>; _wave?:string; zoom:ZoomRegion; splitScreen:SplitScreen; crop:CropRegion; annotations:Annotation[]; motionBlur:boolean; background:Background; materialKey?:string; sourceUrl?:string; }
interface DubClip { id:string; at:number; duration:number; url:string; volume:number; muted:boolean; materialKey?:string; }
/**
 * 字幕条目。start/end 是时间线绝对秒（不是片段内时间），所以导入字幕要加偏移。
 * id 供列表渲染与后续按脚本重排使用；旧工程快照没有该字段，故为可选。
 */
interface Caption { id?:string; text:string; start:number; end:number; position:CaptionPositionKey; size:CaptionSizeKey; color:string; }
interface VideoTrack { clips:Clip[]; locked:boolean; visible:boolean; muted:boolean; }
interface AudioTrack { locked:boolean; muted:boolean; }
interface Marker { id:string; t:number; label:string; }
interface AIConfig { provider:string; apiKey:string; baseUrl:string; model:string; whisperModel:string; translateProvider:string; deeplApiKey:string; baiduAppId:string; baiduSecretKey:string; }

// ─── 状态 ────────────────────────────────────────
// 多轨道数据结构
const videoTracks = ref<VideoTrack[]>([{ clips:[], locked:false, visible:true, muted:false }]);
const audioTracks = ref<AudioTrack[]>([{ locked:false, muted:false }, { locked:false, muted:false }]);
const captions    = ref<Caption[]>([]);
const dubClips    = ref<DubClip[]>([]);
const markers     = ref<Marker[]>([]);
const bgMusicFile = ref<File|null>(null);
/** 背景音乐的耐久素材键：File 本身无法落盘，恢复时靠它从 IDB 取回 */
const bgMusicKey  = ref<string|undefined>(undefined);
/** 背景音乐显示名：从 IDB 取回的 Blob 不带文件名，轨道标签靠它还原 */
const bgMusicName = ref('');
const bgVolume    = ref(80);
const bgMuted     = ref(false);
const masterVolume= ref(1);

// 便捷计算：所有视频片段的扁平列表（向后兼容）
const clips = computed(() => videoTracks.value.flatMap(t => t.clips));

// 活动片段（用 trackIdx + clipIdx 来定位）
const activeTrackIdx = ref(0);
const activeClipLocalIdx = ref(-1);
const activeClipIdx = computed(() => globalClipIdx(activeTrackIdx.value, activeClipLocalIdx.value));
const activeClip = computed(():Clip|null => {
  const t = videoTracks.value[activeTrackIdx.value];
  if (!t || activeClipLocalIdx.value < 0) return null;
  return t.clips[activeClipLocalIdx.value] ?? null;
});

// DOM refs
const appRoot        = ref<HTMLElement|null>(null);
const videoEl        = ref<HTMLVideoElement|null>(null);
const previewCanvas  = ref<HTMLCanvasElement|null>(null);   // Canvas 预览
const partnerVideoEl = ref<HTMLVideoElement|null>(null);    // 分屏配对视频
const screenEl       = ref<HTMLElement|null>(null);         // 预览容器（zoom 交互用）
const rulerEl        = ref<HTMLElement|null>(null);
const tlScrollArea   = ref<HTMLElement|null>(null);
const tlMain         = ref<HTMLElement|null>(null);

// 播放
const isPlaying    = ref(false);
const currentTime  = ref(0);
const playbackRate = ref(1);
let playingTrack = 0, playingLocal = -1, switching = false;

// 混音
let liveACtx: AudioContext|null = null;
let liveBgSrc: AudioBufferSourceNode|null = null;
let liveDubSrcs = new Map<string,AudioBufferSourceNode>();
let liveGainMaster: GainNode|null = null;
const audioBufferCache = new Map<string,AudioBuffer>();

// 时间轴
const pxPerSec  = ref(80);
const minTlPx   = ref(600);       // 最小时间轴像素宽（由可视区决定）
const minDisplayDuration = ref(30);  // 最小显示时长
const tlTool    = ref<'select'|'split'>('select');
const hovSeg    = ref(-1);
const isDragging = ref(false);
const splitX    = ref(-1);
const snapX     = ref(-1);
const dragLabel = ref('');

// Inspector
const inspectorOpen  = ref(false);
const inspectorMode  = ref<'clip'|'dub'|'caption'|'audio'|'ai'|'speed'|'zoom'|'split-screen'|'filter'|'crop'|'background'|'annotate'>('clip');
const inspectorTitle = computed(()=>({clip:'属性',dub:'配音',caption:'字幕',audio:'音频',ai:'AI',speed:'速度',zoom:'推镜',filter:'滤镜','split-screen':'分屏','crop':'裁剪','background':'背景','annotate':'标注'}[inspectorMode.value]||'属性'));

// 预览区宽度（可拖动 resizer 调整）
const previewW = ref(0); // 0=自动(CSS flex)
let resizerStartX = 0, resizerStartW = 0;

// 麦克风
const micStatus    = ref<'unknown'|'granted'|'denied'|'prompt'>('unknown');
const dubRecording = ref(false);
const dubElapsed   = ref(0);
const audioLevel   = ref(0);
let dubRec: MediaRecorder|null = null;
let dubTimer: ReturnType<typeof setInterval>|null = null;
let analyserNode: AnalyserNode|null = null;
let levelRaf: number|null = null;
let micStream: MediaStream|null = null;
let micACtx: AudioContext|null = null;
const selDubIdx = ref(-1);
// 收口轮死代码清理：dragFrom / speedPitchCorrect 全文件无引用（旧拖拽排序与音调补偿遗留），已删除

// 字幕
const editCapIdx = ref(-1);
const capForm = reactive<Caption>({ text:'', start:0, end:3, position:'bottom', color:'#ffffff', size:'md' });

// Undo/Redo
const undoStack: string[] = [];
const redoStack: string[] = [];
const canUndo = computed(() => undoStack.length > 0);
const canRedo = computed(() => redoStack.length > 0);

// AI
const aiCfg       = ref<AIConfig>({ provider:'openai', apiKey:'', baseUrl:'https://api.openai.com/v1', model:'gpt-4o-mini', whisperModel:'whisper-1', translateProvider:'openai', deeplApiKey:'', baiduAppId:'', baiduSecretKey:'' });
const aiLoading   = ref(false);
const aiTask      = ref('');
const aiResult    = ref('');
const aiResultRaw = ref<any>(null);
const transcriptLang = ref('auto');
const translateFrom  = ref('auto');
const translateTo    = ref('zh');
const pitchShift     = ref(0);

// 导出
const exporting = ref(false);
const exportPct = ref(0);
const exportMsg = ref('');
/** 取消入口的即时反馈：abort 到编码器/录制器真正释放之间还有一段收尾时间 */
const exportCancelling = ref(false);
/** 本次导出的取消信号；非导出期间为 null */
let exportAbort: AbortController | null = null;

/** 取消导出：只发信号，资源清理由导出函数的 finally 统一负责 */
function cancelExport(): void {
  if (!exportAbort || exportCancelling.value) return;
  exportCancelling.value = true;
  exportMsg.value = '正在取消…';
  exportAbort.abort();
}

// ─── 导出预设 ─────────────────────────────────────
/** 导出设置在本页 storage.local 的键（只存这一份偏好在设置里，工程数据另有其键） */
const EXPORT_SETTINGS_KEY = 'editor_export_settings';

/** 当前导出设置（面板可改，变更后写回本地存储） */
const exportSettings = reactive<ExportSettings>({ ...DEFAULT_EXPORT_SETTINGS });
/** 导出设置面板开合 */
const exportPanelOpen = ref(false);
/**
 * 源视频实际尺寸：面板要显示「目标 vs 源」才有意义，
 * 而 videoWidth 不是响应式的，靠 loadedmetadata 显式刷新。
 */
const sourceSize = ref({ w: 0, h: 0 });

/** 目标画布尺寸（导出与预览取景共用） */
const exportTargetSize = computed(() => resolveExportSize(sourceSize.value.w, sourceSize.value.h, exportSettings));
/** 目标码率 bps */
const exportBitrate = computed(() => estimateBitrateBps(exportTargetSize.value.width, exportTargetSize.value.height, exportSettings.fps, exportSettings));
/** 面板与日志共用的一行摘要 */
const exportSummary = computed(() => describeExportSettings(exportTargetSize.value, exportSettings, exportBitrate.value));

/** 素材元数据就绪：记下源尺寸，面板立即反映真实目标分辨率 */
function onSourceMeta(e: Event): void {
  const v = e.target as HTMLVideoElement | null;
  if (v && v.videoWidth > 0 && v.videoHeight > 0) sourceSize.value = { w: v.videoWidth, h: v.videoHeight };
}

/** 读取上次导出设置；存储不可用或内容异常时用默认值（不让设置页拖垮编辑器启动） */
async function loadExportSettings(): Promise<void> {
  try {
    const got = await chrome.storage?.local?.get(EXPORT_SETTINGS_KEY);
    const stored = got?.[EXPORT_SETTINGS_KEY];
    if (stored) Object.assign(exportSettings, normalizeExportSettings(stored));
  } catch (e: unknown) {
    log.warn('导出设置读取失败，使用默认值', e);
  }
}

let saveExportSettingsTimer: number | null = null;
/** 变更防抖落盘：连续点选帧率/画质不该每次写库 */
watch(exportSettings, () => {
  if (saveExportSettingsTimer !== null) clearTimeout(saveExportSettingsTimer);
  saveExportSettingsTimer = window.setTimeout(() => {
    saveExportSettingsTimer = null;
    chrome.storage?.local?.set({ [EXPORT_SETTINGS_KEY]: { ...exportSettings } }).catch?.((e: unknown) => log.warn('导出设置保存失败', e));
  }, 400);
}, { deep: true });

const EXPORT_ASPECTS: ExportAspect[] = ['source', '16:9', '9:16', '4:3', '3:4', '1:1'];
const EXPORT_FITS: ExportFit[] = ['stretch', 'contain', 'cover'];
const EXPORT_QUALITIES: ExportQuality[] = ['draft', 'standard', 'high'];

/**
 * 自定义码率开关：bitrateMbps>0 即视为自定义，不另存一个状态位。
 * 关掉时归零回到按画质档位算，避免「勾掉了但还在用旧码率」这种隐性生效。
 */
const useCustomBitrate = computed({
  get: () => exportSettings.bitrateMbps > 0,
  set: (v: boolean) => { exportSettings.bitrateMbps = v ? 8 : 0; },
});
/** 自定义码率数值（Mbps）：非自定义时面板不显示，读到的也是档位值，写回会切档 */
const customBitrateMbps = computed({
  get: () => exportSettings.bitrateMbps || 8,
  set: (v: number) => { exportSettings.bitrateMbps = Number.isFinite(v) && v > 0 ? Math.min(40, v) : 0; },
});

// ─── 计算 ─────────────────────────────────────────
const totalDuration = computed(() => {
  const all = clips.value;
  if (!all.length) return 0;  // 空时为 0
  return Math.max(0, ...all.map(c => c.offset + (c.trimEnd - c.trimStart) / c.speed));
});
// 收口轮死代码清理：displayDuration 全文件无引用（时间轴宽度直接用 tlPx），已删除
const tlPx = computed(() => {
  // 时间轴宽度 = 内容宽度 + 适当余量，但不超过 2x 可视宽度
  const contentW = Math.ceil(totalDuration.value * pxPerSec.value);
  return Math.max(contentW + 120, minTlPx.value);
});
const phPx = computed(() => currentTime.value * pxPerSec.value);
const totalTrackH = computed(() => (videoTracks.value.length + audioTracks.value.length + 1) * 50);

const ticks = computed(() => {
  const px = pxPerSec.value;
  const step = px>=160?.5:px>=80?1:px>=40?2:px>=20?5:10;
  const major = step * 5;
  const out:{ t:number; x:number; major:boolean; label:string }[] = [];
  for (let t=0; t<=Math.max(totalDuration.value, minDisplayDuration.value)+major; t+=step) {
    const isMaj = Math.round(t / major) * major === Math.round(t * 100) / 100;
    out.push({ t, x: Math.round(t * px), major: isMaj, label: isMaj ? fmtT(t) : '' });
  }
  return out;
});

const activeCaption = computed(() => captions.value.find(c => currentTime.value >= c.start && currentTime.value < c.end) ?? null);

/**
 * 预览取景框（内容与目标画幅在画布中的摆放，像素）：
 * 导出画幅与源比例不符时，预览必须显示同一套黑边，否则「竖屏导出」全靠想象。
 * 由 renderPreviewFrame 每帧写入（值未变则不写），字幕覆盖层按它定位。
 */
const previewLayout = ref<FrameLayout>({ target: fullBox(0, 0), content: fullBox(0, 0) });

/** 只在真正变化时写入，避免每帧都给响应式对象赋新值触发无谓重渲染 */
function setPreviewLayout(next: FrameLayout): void {
  const p = previewLayout.value;
  const same = (a: typeof p.target, b: typeof p.target) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  if (same(p.target, next.target) && same(p.content, next.content)) return;
  previewLayout.value = next;
}

/**
 * 是否按导出画幅取景：推镜/裁剪/标注选框是铺满画布定位的浮层，
 * 它们打开时退回满幅显示，避免选框与画面错位（关面板即恢复取景）。
 */
const previewFramingActive = computed(() => {
  if (exportSettings.fit === 'stretch' && exportSettings.aspect === 'source') return false;
  if (!inspectorOpen.value) return true;
  return !['zoom', 'crop', 'annotate'].includes(inspectorMode.value);
});

/**
 * 预览字幕覆盖层定位：与导出烧字共用 captionRender 的算式，
 * 字号随取景框高度缩放，落点绝不落进黑边。
 */
const capOverlayStyle = computed(() => {
  const cap = activeCaption.value;
  const box = previewLayout.value.content;
  if (!cap || box.w <= 0) return {};
  const size = captionFontSize(box.h, cap.size);
  return {
    fontSize: size + 'px',
    left: captionOverlayCenterX(box) + 'px',
    top: captionOverlayTop(box, size, cap.position) + 'px',
    color: cap.color,
    maxWidth: Math.round(box.w * 0.9) + 'px',
  };
});

const COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#f97316'];
const defaultWave = "0,10 10,5 20,14 30,7 40,13 50,4 60,15 70,8 80,11 90,5 100,10";

function globalClipIdx(ti: number, ci: number): number {
  let idx = 0;
  for (let i = 0; i < ti; i++) idx += videoTracks.value[i]?.clips.length ?? 0;
  return ci >= 0 ? idx + ci : -1;
}
function findClipByGlobal(gi: number): { ti:number; ci:number } | null {
  let idx = 0;
  for (let ti = 0; ti < videoTracks.value.length; ti++) {
    const n = videoTracks.value[ti].clips.length;
    if (gi < idx + n) return { ti, ci: gi - idx };
    idx += n;
  }
  return null;
}

function segStyle(c: Clip, gi: number) {
  const w = Math.max(28, (c.trimEnd - c.trimStart) / c.speed * pxPerSec.value);
  return { left: c.offset * pxPerSec.value + 'px', width: w + 'px', '--sc': COLORS[gi % COLORS.length] };
}
function dubStyle(d: DubClip) {
  return { left: d.at * pxPerSec.value + 'px', width: Math.max(28, d.duration * pxPerSec.value) + 'px' };
}
function capStyle(cap: Caption) {
  const dur = totalDuration.value || 1;
  return { left: (cap.start / dur * 100) + '%', width: Math.max(.5, (cap.end - cap.start) / dur * 100) + '%' };
}

const filterDefs = [
  {key:'brightness',label:'亮度',min:0,max:200,default:100,unit:'%'},
  {key:'contrast',  label:'对比',min:0,max:200,default:100,unit:'%'},
  {key:'saturation',label:'饱和',min:0,max:200,default:100,unit:'%'},
  {key:'blur',      label:'模糊',min:0,max:10, default:0,  unit:'px'},
  {key:'hueRotate', label:'色调',min:-180,max:180,default:0,unit:'°'},
];
const presets = [
  {name:'原始',v:{brightness:100,contrast:100,saturation:100,blur:0,hueRotate:0}},
  {name:'复古',v:{brightness:90,contrast:115,saturation:55,blur:0,hueRotate:18}},
  {name:'冷色',v:{brightness:100,contrast:108,saturation:85,blur:0,hueRotate:-18}},
  {name:'暖色',v:{brightness:108,contrast:100,saturation:125,blur:0,hueRotate:14}},
  {name:'黑白',v:{brightness:100,contrast:115,saturation:0,blur:0,hueRotate:0}},
  {name:'胶片',v:{brightness:95,contrast:105,saturation:70,blur:0,hueRotate:-8}},
];
const defaultFilters = () => ({ brightness:100, contrast:100, saturation:100, blur:0, hueRotate:0 });
const defaultCrop = (): CropRegion => ({ enabled:false, x:0, y:0, w:1, h:1 });
const defaultBg   = (): Background => ({
  type: 'none', color:'#1a1a2e',
  gradient:{ from:'#1a1a2e', to:'#16213e', angle:135 },
  imageUrl:'', blurAmount:20, padding:0.04, borderRadius:10, shadowOpacity:0.5,
});
const defaultZoom = (): ZoomRegion => ({
  enabled:false,
  x:0.5, y:0.5, scale:2,
  animMode:'ease-in-out', animDuration:1.0, animStartTime:0,
  startScale:1, startX:0.5, startY:0.5,
});
const defaultSplit = (): SplitScreen => ({
  enabled:false, mode:'h-split', partnerClipId:'',
  splitRatio:0.5, mainSide:'left',
  pipX:0.65, pipY:0.6, pipW:0.32, pipH:0.32,
  pipShape:'rounded', pipBorder:true, pipBorderColor:'#ffffff',
});

/** 只列 renderSplitScreen 真正实现的四种布局；类型联合里的 *-custom 从未被赋值，故不提供入口 */
const splitModes = [
  { key: 'h-split', label: '左右分屏', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="12" y1="5" x2="12" y2="19"/></svg>` },
  { key: 'v-split', label: '上下分屏', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>` },
  { key: 'pip-rect', label: '矩形画中画', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="13" y="12" width="6" height="5" rx="1"/></svg>` },
  { key: 'pip-circle', label: '圆形画中画', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="16" cy="14.5" r="3"/></svg>` },
] as const;

// ─── 初始化 ───────────────────────────────────────
onMounted(async () => {
  await checkMicPerm(); await loadAIConfig(); await loadExportSettings();
  // 先读上次工程，再决定是否自动恢复：自动保存此刻仍关闭，
  // 否则挂载期的空时间线会立刻把用户上次的成果覆盖掉。
  let savedProject: PersistedProject|null = null;
  try {
    const raw = await idbGet(STORE_HLS_BLOBS, EDITOR_PROJECT_KEY);
    savedProject = parseProjectSnapshot(raw);
    if (raw && !savedProject) pushNotice('warning', '上次工程无法读取', '存储中的工程结构已损坏或版本不兼容，本次将从空白时间线开始');
  } catch (e) { log.warn('读取上次工程失败', e); }

  let handoffCount = 0;
  try {
    // 内部可信通道：侧栏经 chrome.storage.session 交来的素材清单。
    // 交的是 IndexedDB 键（不是 blob: URL），故用户打开编辑器后关掉侧栏也照样能取回素材。
    const r = await chrome.storage?.session?.get('pendingEditorClips');
    const pending = r?.pendingEditorClips;
    if (Array.isArray(pending)) {
      handoffCount = pending.length;
      for (const c of pending as PendingEditorClip[]) {
        if (c.idbKey) await addClipFromIdb(c.idbKey, c.name);
        else if (c.url) addClipByUrl(c.url, c.name);
        else reportClipLoadError(c.name, new Error('交接清单缺少素材地址'));
      }
      await chrome.storage?.session?.remove('pendingEditorClips');
    }
  } catch (e) { reportClipLoadError('侧栏交接素材', e); }

  if (savedProject && hasRecoverableContent(savedProject)) {
    if (handoffCount) {
      // 本次带着新素材进来：恢复会顶掉刚交接的片段，必须让用户明确选择，不能替他决定
      recoverySavedAt.value = savedProject.savedAt;
      recoveryProject.value = savedProject;
    } else {
      // 纯刷新/崩溃重开：没有竞争内容，直接续上，省掉一次无意义的确认
      await restoreProject(savedProject);
    }
  }
  // 决定做完才开闸；带交接进来的情况下开闸要等用户点完横幅
  if (!recoveryProject.value) autosaveEnabled.value = true;
  void sweepOrphanMaterials(savedProject);
  document.addEventListener('visibilitychange', onPageHide);
  window.addEventListener('beforeunload', onBeforeUnload);

  window.addEventListener('message', onMsg);
  // P0-7：postMessage 不再使用 '*' 通配目标源——
  // 仅当 opener 可读且与本页面同源（同为扩展自身 origin）时才发送 EDITOR_READY 握手，
  // 跨源 opener 无法读取 location，直接放弃广播，避免向未知源泄露消息
  if (window.opener) {
    let openerOrigin = '';
    try { openerOrigin = new URL(window.opener.location.href).origin; } catch { /* 跨源 opener 不可读 */ }
    if (openerOrigin && openerOrigin === location.origin) {
      window.opener.postMessage({ type:'EDITOR_READY' }, location.origin);
    }
  }
  nextTick(() => {
    appRoot.value?.focus();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fitView();
      if (tlScrollArea.value) {
        const ro = new ResizeObserver(() => {
          if (tlScrollArea.value) minTlPx.value = tlScrollArea.value.clientWidth;
        });
        ro.observe(tlScrollArea.value);
      }
      // 监听 previewCanvas 大小
      if (previewCanvas.value) {
        const ro2 = new ResizeObserver(() => renderPreviewFrame());
        ro2.observe(previewCanvas.value);
      }
    }));

    // watch 分屏 partner 变化
    watch(
      () => activeClip.value?.splitScreen.partnerClipId,
      (id) => { if (id) loadPartnerVideo(id); },
      { immediate: true }
    );
    // watch 任何可视属性变化 → 重渲染
    watch(
      () => [
        activeClip.value?.zoom, activeClip.value?.splitScreen,
        activeClip.value?.filters, activeClip.value?.crop,
        activeClip.value?.background, activeClip.value?.annotations,
        activeClip.value?.motionBlur,
      ],
      () => renderPreviewFrame(),
      { deep: true }
    );
  });
});

async function loadAIConfig() {
  try { const r = await (chrome as any).storage?.local?.get('global_settings_v2'); if (r?.global_settings_v2?.ai) aiCfg.value = { ...aiCfg.value, ...r.global_settings_v2.ai }; } catch { /* noop：存储不可用时保留默认 AI 配置 */ }
}
/**
 * 接收外部 postMessage 的 LOAD_CLIPS 指令（P0-7 收紧后）。
 * 三重校验，全部通过才加载片段：
 * ① origin 必须是同源（扩展自身页面，chrome-extension://<id>）；
 * ② event.source 必须是预期的窗口引用——即通过 window.open 打开本编辑器页的 opener；
 *    （当前侧栏走 chrome.tabs.create + storage.session 通道，无 opener 时本消息路径整体拒绝，
 *     不影响既有侧栏→编辑器通信）
 * ③ 每个 URL 走白名单（仅 http/https，禁止 data:/file:/blob:/chrome-extension: 等），
 *    并限制单条消息片段数量与单个片段抓取体积。
 */
function onMsg(e: MessageEvent) {
  // 校验①：仅接受同源消息，其他 origin 一律忽略
  if (e.origin !== location.origin) return;
  if (e.data?.type !== 'LOAD_CLIPS' || !Array.isArray(e.data.clips)) return;
  // 校验②：source 必须是预期的窗口引用（同扩展 opener）
  if (!window.opener || e.source !== window.opener) {
    log.warn('LOAD_CLIPS 已拒绝：event.source 不是预期窗口引用');
    return;
  }
  // 校验③：限数量 + 逐条 URL 白名单，非法项跳过并告警
  const clips = e.data.clips.slice(0, MAX_LOAD_CLIPS_PER_MESSAGE) as { name?: unknown; url?: unknown }[];
  if (e.data.clips.length > MAX_LOAD_CLIPS_PER_MESSAGE) {
    log.warn(`LOAD_CLIPS 超出数量上限，仅处理前 ${MAX_LOAD_CLIPS_PER_MESSAGE} 条`);
  }
  for (const c of clips) {
    const name = typeof c.name === 'string' ? c.name : 'clip';
    if (typeof c?.url !== 'string' || !isAllowedClipUrl(c.url)) {
      log.warn('LOAD_CLIPS 跳过非法 URL：', typeof c?.url === 'string' ? c.url.slice(0, 120) : String(c?.url));
      reportClipLoadError(name, new Error('素材地址不在允许范围内（仅支持 http/https 直链）'));
      continue;
    }
    addClipByUrl(c.url, name, { maxBytes: MAX_REMOTE_CLIP_BYTES });
  }
}
/**
 * 可见问题清单：素材载入失败、导出降级与失败都进这里。
 * 静默失败的代价是用户拿到一个空编辑器或一条缺声成片却无从判断原因，
 * 故全站只留这一个常驻出口，不随遮罩关闭而消失。
 */
interface EditorNotice { id:string; kind:'error'|'warning'; title:string; detail:string }
const notices = ref<EditorNotice[]>([]);
function pushNotice(kind: EditorNotice['kind'], title: string, detail: string): void {
  notices.value.push({ id:`n_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, kind, title: title || '未命名', detail });
}
function reportClipLoadError(name: string, reason: unknown): void {
  const text = reason instanceof Error ? reason.message : String(reason);
  log.error('素材加载失败', name, text);
  pushNotice('error', name || '未命名素材', `载入失败：${text}`);
}
function dismissNotice(id: string): void {
  notices.value = notices.value.filter(n => n.id !== id);
}

/**
 * 把素材写入工程自有 IDB 键，返回耐久键（自动保存/崩溃恢复靠它取回素材）。
 * 写不进去（配额满/隐私模式）不阻断编辑，但必须告知用户刷新后这段素材要重新导入。
 */
async function persistMaterial(blob: Blob, label: string): Promise<string|undefined> {
  const key = newMaterialKey();
  try {
    await idbPut(STORE_HLS_BLOBS, key, { savedAt: Date.now(), blob });
    return key;
  } catch (e) {
    log.warn('素材落库失败', label, e);
    pushNotice('warning', '自动保存受限', `「${label}」无法写入本地素材库（${e instanceof Error ? e.message : String(e)}）；刷新页面后需重新导入该素材`);
    return undefined;
  }
}

/**
 * 按 URL 加载片段（P0-7：统一白名单校验与体积上限）。
 * 只收 http/https 直链；本地素材一律走 addClipFromIdb / addClipFile，
 * 因为 blob: URL 属于创建它的文档，跨文档传过来必然失效。
 */
function addClipByUrl(url: string, name: string, opts: { maxBytes?: number } = {}) {
  if (!isAllowedClipUrl(url)) {
    reportClipLoadError(name, new Error('素材地址不在允许范围内（仅支持 http/https 直链）'));
    return;
  }
  const load = opts.maxBytes ? fetchClipBlobCapped(url, opts.maxBytes) : fetch(url).then(r => r.blob());
  // 失败不再造一个 0 字节 Blob 顶替：那既加不进片段也不报错，等于把素材悄悄丢掉
  load.then(b => {
    if (!b.size) throw new Error('素材内容为空');
    // 远程素材记直链而非落库：恢复时重新抓取，避免为网上一段视频再占一份本地配额
    addClipFile(name, URL.createObjectURL(b), { sourceUrl: url });
  }).catch(e => reportClipLoadError(name, e));
}

/**
 * 从 IndexedDB 取交接素材。侧栏交的是键而非 blob: URL，故侧栏关闭后仍可取回。
 * 一次性交接键在素材确认载入后才删（载入失败时保留，用户还能回侧栏重试）；
 * 录制成果键是用户长期保存的产物，只读不删。
 */
async function addClipFromIdb(key: string, name: string): Promise<void> {
  try {
    const blob = resolveHandoffBlob(await idbGet(STORE_HLS_BLOBS, key));
    if (!blob) throw new Error('素材不存在或已被清理，请回到侧栏重新打开');
    // 一次性交接键载入后即删，不能当工程的耐久引用 → 转存为工程自有素材键；
    // 录制成果键（caprec_）由录制 store 长期持有，直接引用，零拷贝。
    const materialKey = isTransientHandoffKey(key) ? await persistMaterial(blob, name) : key;
    addClipFile(name, URL.createObjectURL(blob), {
      materialKey,
      onLoaded: () => {
        if (!isTransientHandoffKey(key)) return;
        void idbDelete(STORE_HLS_BLOBS, key).catch(e => log.warn('清理一次性交接素材失败', key, e));
      },
    });
  } catch (e) {
    reportClipLoadError(name, e);
  }
}

// ─── 文件处理 ─────────────────────────────────────
/** 本地导入/拖入共用：先落库拿耐久键，再建片段（Blob 写 IDB 是引用传递，不额外拷贝字节） */
async function addLocalFiles(files: File[]): Promise<void> {
  for (const f of files) {
    const materialKey = await persistMaterial(f, f.name);
    addClipFile(f.name, URL.createObjectURL(f), { materialKey });
  }
}
async function handleUpload(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  (e.target as HTMLInputElement).value = '';
  await addLocalFiles(files);
}
async function onDrop(e: DragEvent) {
  await addLocalFiles(Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith('video/')));
}
/** 元数据加载兜底超时：素材失效或编码不受支持时 error 事件未必触发，不能无限等待 */
const CLIP_METADATA_TIMEOUT_MS = 15000;
function addClipFile(rawName: string, url: string, opts: { materialKey?:string; sourceUrl?:string; onLoaded?:()=>void } = {}) {
  const v = document.createElement('video'); v.preload='metadata';
  const name = rawName.replace(/\.[^.]+$/, '').replace(/_/g,' ').replace(/\s+/g,' ').trim().slice(0,20) || 'video';
  let settled = false;
  const fail = (reason: unknown) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    v.removeAttribute('src');
    try { v.load(); } catch { /* noop */ }
    // 此处 url 一律是调用方为本片段新建的 object URL，失败即释放，避免钉住大 Blob
    if (url.startsWith('blob:')) { try { URL.revokeObjectURL(url); } catch { /* noop */ } }
    reportClipLoadError(name, reason);
  };
  const timer = setTimeout(() => fail(new Error('读取素材元数据超时（文件可能已损坏或格式不受支持）')), CLIP_METADATA_TIMEOUT_MS);
  v.onerror = () => fail(new Error('无法解码该素材（格式不受支持或素材地址已失效）'));
  v.onloadedmetadata = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 10;
    const track = videoTracks.value[0];
    const offset = track.clips.reduce((acc,c) => Math.max(acc, c.offset+(c.trimEnd-c.trimStart)/c.speed), 0);
    // 生成波形（随机模拟）
    const wave = Array.from({length:20},(_,i)=>`${i*5.26},${5+Math.random()*14}`).join(' ');
    const clip: Clip = { id:`c_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, name, url, duration:dur, trimStart:0, trimEnd:dur, offset, volume:100, muted:false, speed:1, preset:'原始', filters:defaultFilters(), _wave:wave, zoom:defaultZoom(), splitScreen:defaultSplit(), crop:defaultCrop(), annotations:[], motionBlur:false, background:defaultBg(), materialKey:opts.materialKey, sourceUrl:opts.sourceUrl };
    track.clips.push(clip);
    if (track.clips.length === 1) nextTick(() => { selectClipByTrack(0,0); });
    preloadAudio(url, url);
    opts.onLoaded?.();
  };
  v.src = url;
}
/** 设定背景音乐：落库拿耐久键 + 预解码。恢复工程时复用同一路径，避免两处语义漂移 */
async function useBgMusicBlob(blob: Blob, name: string, materialKey?: string): Promise<void> {
  bgMusicFile.value = new File([blob], name, { type: blob.type });
  bgMusicName.value = name;
  // 换曲必须清掉旧解码缓存，否则 preloadAudio 命中缓存直接返回，播放的还是上一首
  audioBufferCache.delete('bg');
  bgMusicKey.value = materialKey ?? await persistMaterial(blob, name);
  const url = URL.createObjectURL(blob);
  void preloadAudio(url, 'bg').finally(() => URL.revokeObjectURL(url));
}
async function loadBgMusic(e:Event) {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null;
  (e.target as HTMLInputElement).value = '';
  if (!file) { removeBgMusic(); return; }
  await useBgMusicBlob(file, file.name);
}
function removeBgMusic() {
  bgMusicFile.value = null;
  bgMusicKey.value = undefined;
  bgMusicName.value = '';
  bgMuted.value = false;
  bgVolume.value = 80;
  audioBufferCache.delete('bg');
  bgCtxMenu.show = false;
}
function addVideoTrack() {
  saveUndo();
  videoTracks.value.push({ clips:[], locked:false, visible:true, muted:false });
}

// ─── 音频预加载 ───────────────────────────────────
async function preloadAudio(url:string, key:string) {
  if (audioBufferCache.has(key)) return;
  try { const a=new AudioContext(); const ab=await(await fetch(url)).arrayBuffer(); const buf=await a.decodeAudioData(ab); await a.close(); audioBufferCache.set(key,buf); } catch { /* noop：预解码失败回退即时解码路径 */ }
}

// ─── 实时混音 ─────────────────────────────────────
function stopLive() {
  try { liveBgSrc?.stop(); } catch { /* noop：已停止的源重复 stop 忽略 */ }
  liveDubSrcs.forEach(s => { try { s.stop(); } catch { /* noop：同上 */ } });
  liveDubSrcs.clear();
  if (liveACtx) { liveACtx.close(); liveACtx = null; }
  liveGainMaster = null;
}

async function startLive(gT: number) {
  stopLive();

  // 用一个局部变量捕获本次启动的 context
  // 每次 await 后都检查它是否仍是当前 context，防止 race condition
  const ctx = new AudioContext();
  liveACtx = ctx;

  const gainMaster = ctx.createGain();
  gainMaster.gain.value = masterVolume.value;
  gainMaster.connect(ctx.destination);
  liveGainMaster = gainMaster;

  const now = ctx.currentTime + 0.05;

  // ── BGM ──
  if (bgMusicFile.value && !bgMuted.value) {
    try {
      let buf = audioBufferCache.get('bg');
      if (!buf) {
        const u = URL.createObjectURL(bgMusicFile.value);
        const ab = await (await fetch(u)).arrayBuffer();
        // 检查：await 期间用户可能停止了播放
        if (liveACtx !== ctx) return;
        buf = await ctx.decodeAudioData(ab);
        if (liveACtx !== ctx) return;
        audioBufferCache.set('bg', buf);
      }
      if (buf && liveACtx === ctx) {
        liveBgSrc = ctx.createBufferSource();
        liveBgSrc.buffer = buf;
        liveBgSrc.loop = true;
        const g = ctx.createGain();
        g.gain.value = bgVolume.value / 100;
        liveBgSrc.connect(g).connect(gainMaster);
        liveBgSrc.start(now, gT % buf.duration);
      }
    } catch { /* BGM 加载失败不影响其他音频 */ }
  }

  // ── 配音 ──
  for (const dub of dubClips.value) {
    if (dub.muted || dub.at + dub.duration <= gT) continue;
    try {
      let buf = audioBufferCache.get(dub.id);
      if (!buf) {
        const ab = await (await fetch(dub.url)).arrayBuffer();
        if (liveACtx !== ctx) return;  // 已被停止
        buf = await ctx.decodeAudioData(ab);
        if (liveACtx !== ctx) return;
        audioBufferCache.set(dub.id, buf);
      }
      if (!buf || liveACtx !== ctx) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = dub.volume / 100;
      src.connect(g).connect(gainMaster);
      if (dub.at >= gT) {
        src.start(now + (dub.at - gT), 0, dub.duration);
      } else {
        const skip = gT - dub.at;
        src.start(now, skip, dub.duration - skip);
      }
      liveDubSrcs.set(dub.id, src);
    } catch { /* 单条配音失败不影响其他 */ }
  }
}

// ─── 播放 ─────────────────────────────────────────
function togglePlay() { isPlaying.value ? pause() : play(); }
function play() {
  if (!videoEl.value || !clips.value.length) return;
  const ci = findClipAt(currentTime.value);
  if (!ci) { seekToGlobal(0); playFrom(0,0,videoTracks.value[0].clips[0].trimStart,0); }
  else { const c=clips.value[ci.g]; playFrom(ci.ti,ci.li,c.trimStart+(currentTime.value-c.offset)*c.speed,currentTime.value); }
}
function pause() { isPlaying.value=false; videoEl.value?.pause(); stopLive(); stopCanvasRaf(); nextTick(()=>renderPreviewFrame()); }
function playFrom(ti:number, li:number, localT:number, gT:number) {
  if (switching) return;
  const track = videoTracks.value[ti]; if (!track) return;
  const clip = track.clips[li]; if (!clip||!videoEl.value) return;
  switching=true; playingTrack=ti; playingLocal=li;
  const go=()=>{
    switching=false; if(!videoEl.value)return;
    videoEl.value.currentTime=Math.max(clip.trimStart,Math.min(localT,clip.trimEnd));
    videoEl.value.playbackRate=clip.speed*Math.pow(2,pitchShift.value/12);
    videoEl.value.volume=clip.muted||track.muted?0:masterVolume.value*(clip.volume/100);
    applyFilterClip(clip); isPlaying.value=true; startLive(gT);
    startCanvasRaf();  // 开始 canvas 帧渲染
    videoEl.value.play().catch(()=>{isPlaying.value=false;switching=false;stopLive();stopCanvasRaf();});
  };
  if (videoEl.value.getAttribute('data-url')!==clip.url) {
    videoEl.value.pause(); videoEl.value.src=clip.url; videoEl.value.setAttribute('data-url',clip.url);
    videoEl.value.oncanplay=()=>{videoEl.value!.oncanplay=null;go();};
  } else go();
}
function onTimeUpdate() {
  if (!videoEl.value||playingLocal<0) return;
  const track=videoTracks.value[playingTrack]; if(!track)return;
  const clip=track.clips[playingLocal]; if(!clip)return;
  currentTime.value=clip.offset+(videoEl.value.currentTime-clip.trimStart)/clip.speed;
  if (isPlaying.value && videoEl.value.currentTime>=clip.trimEnd-0.05) {
    // 尝试下一个片段（同轨道）
    const nextLi=playingLocal+1;
    if (nextLi<track.clips.length) playFrom(playingTrack,nextLi,track.clips[nextLi].trimStart,track.clips[nextLi].offset);
    else { videoEl.value.pause(); isPlaying.value=false; playingLocal=-1; stopLive(); }
  }
  // 自动滚动
  if (isPlaying.value&&tlScrollArea.value) {
    const ph=phPx.value; const sl=tlScrollArea.value.scrollLeft; const sw=tlScrollArea.value.clientWidth;
    if (ph<sl+40||ph>sl+sw-80) tlScrollArea.value.scrollLeft=Math.max(0,ph-sw*.3);
  }
}
function onEnded() { if(!isPlaying.value)return; const t=videoTracks.value[playingTrack]; const ni=playingLocal+1; if(ni<t?.clips.length)playFrom(playingTrack,ni,t.clips[ni].trimStart,t.clips[ni].offset); else{isPlaying.value=false;playingLocal=-1;stopLive();stopCanvasRaf();nextTick(()=>renderPreviewFrame());} }

interface ClipRef { ti:number; li:number; g:number }
function findClipAt(t:number): ClipRef|null {
  for (let ti=0;ti<videoTracks.value.length;ti++) {
    const tr=videoTracks.value[ti];
    for (let li=0;li<tr.clips.length;li++) {
      const c=tr.clips[li]; if(t>=c.offset&&t<c.offset+(c.trimEnd-c.trimStart)/c.speed) return{ti,li,g:globalClipIdx(ti,li)};
    }
  }
  return null;
}
function seekToGlobal(t:number) {
  t=Math.max(0,Math.min(t,totalDuration.value));
  const was=isPlaying.value; if(was)pause();
  const ci=findClipAt(t); currentTime.value=t;
  if (!ci) return;
  const c=clips.value[ci.g]; const lt=c.trimStart+(t-c.offset)*c.speed;
  selectClipByTrack(ci.ti,ci.li);
  if (!videoEl.value) return;
  const set=()=>{if(videoEl.value){videoEl.value.currentTime=lt;applyFilterClip(c);}};
  if (videoEl.value.getAttribute('data-url')!==c.url) {
    videoEl.value.src=c.url; videoEl.value.setAttribute('data-url',c.url);
    videoEl.value.oncanplay=()=>{videoEl.value!.oncanplay=null;set();if(was)playFrom(ci.ti,ci.li,lt,t);};
  } else { set(); if(was) playFrom(ci.ti,ci.li,lt,t); }
}
function stepBack(s:number) { seekToGlobal(Math.max(0,currentTime.value+s)); }
function applyMasterVol() { if(liveGainMaster)liveGainMaster.gain.value=masterVolume.value; if(videoEl.value&&activeClip.value&&!activeClip.value.muted)videoEl.value.volume=masterVolume.value*(activeClip.value.volume/100); }
function cycleSpeed() { const sp=[0.25,.5,.75,1,1.25,1.5,2,4];const ni=(sp.indexOf(playbackRate.value)+1)%sp.length;playbackRate.value=sp[ni];if(videoEl.value&&isPlaying.value)videoEl.value.playbackRate=sp[ni]; }
function setTrimStart(v:number){if(activeClip.value){activeClip.value.trimStart=Math.max(0,Math.min(v,activeClip.value.trimEnd-.05));reoffset(activeTrackIdx.value);}}
function setTrimEnd(v:number){if(activeClip.value){activeClip.value.trimEnd=Math.min(activeClip.value.duration,Math.max(v,activeClip.value.trimStart+.05));reoffset(activeTrackIdx.value);}}
function setSpeed(s:number){if(activeClip.value){activeClip.value.speed=s;reoffset(activeTrackIdx.value);if(videoEl.value&&isPlaying.value)videoEl.value.playbackRate=s;}}
function applyFilters(){if(activeClip.value)applyFilterClip(activeClip.value);}

// ════ Canvas 预览渲染引擎 ════
let previewRaf: number|null = null;
let isRafPlaying = false;

/**
 * 滤镜字符串：预览与导出共用一份构造。
 * 此前两处各写一遍 CSS 函数串，改一个参数就要冒两处漂移的风险（导出与预览不一致最难查）。
 */
function filterString(f?: Record<string, number>): string {
  if (!f) return 'none';
  return `brightness(${f.brightness}%)contrast(${f.contrast}%)saturate(${f.saturation}%)blur(${f.blur}px)hue-rotate(${f.hueRotate}deg)`;
}

/**
 * 在取景布局内绘制一帧：按 target 裁剪、按 content 变换。
 * 满幅时走快速路径（不 save/clip），保持原有逐帧开销不变。
 */
function withFrameLayout(ctx: CanvasRenderingContext2D, layout: FrameLayout, draw: (w: number, h: number) => void): void {
  const { target, content } = layout;
  if (isFullFrame(target, ctx.canvas.width, ctx.canvas.height) && isFullFrame(content, ctx.canvas.width, ctx.canvas.height)) {
    draw(content.w, content.h);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(target.x, target.y, target.w, target.h);
  ctx.clip();
  ctx.translate(content.x, content.y);
  draw(content.w, content.h);
  ctx.restore();
}

/** 预览取景布局：目标画幅内含进画布，视频再按适配方式摆进目标画幅 */
function resolvePreviewLayout(videoW: number, videoH: number, W: number, H: number): FrameLayout {
  const t = exportTargetSize.value;
  return composeFrameLayout(videoW, videoH, W, H, t.width, t.height, exportSettings.fit, previewFramingActive.value);
}

/** 渲染单帧到 preview canvas（支持 zoom + splitScreen + 导出画幅取景）*/
function renderPreviewFrame() {
  const canvas = previewCanvas.value;
  const video  = videoEl.value;
  const clip   = activeClip.value;
  if (!canvas || !video) return;

  const W = canvas.width  = canvas.offsetWidth  || 1280;
  const H = canvas.height = canvas.offsetHeight || 720;
  const ctx = canvas.getContext('2d')!;
  const layout = resolvePreviewLayout(video.videoWidth || W, video.videoHeight || H, W, H);
  setPreviewLayout(layout);
  // 底色一次性铺满：黑边区域必须是实心，否则透出页面背景
  ctx.filter = 'none';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07070e';
  ctx.fillRect(0, 0, W, H);
  if (!clip || video.readyState < 2) return;

  const zoom = clip.zoom;
  const ss   = clip.splitScreen;
  const bg   = clip.background;
  const localTime = Math.max(0, currentTime.value - clip.offset);

  withFrameLayout(ctx, layout, (w, h) => {
    ctx.filter = filterString(clip.filters);
    if (bg.type !== 'none') {
      // 背景模式：背景铺底 + 视频带圆角/内边距
      applyBackground(ctx, video, w, h, clip);
    } else if (ss.enabled && ss.mode !== 'none' && ss.partnerClipId) {
      renderSplitScreen(ctx, video, w, h, clip, ss);
    } else if (zoom.enabled) {
      renderZoom(ctx, video, w, h, zoom, clip, currentTime.value);
    } else if (clip.crop.enabled) {
      ctx.filter = 'none';
      applyCrop(ctx, video, w, h, clip.crop);
    } else {
      ctx.drawImage(video, 0, 0, w, h);
    }
    ctx.filter = 'none';
    // 标注叠加
    if (clip.annotations.length > 0) renderAnnotations(ctx, w, h, clip.annotations, localTime);
  });
}

// ════ 背景、裁剪、标注数据 ════
const bgPresetColors = ['#0f0f23','#1a1a2e','#16213e','#0d0d0d','#1e1b4b','#064e3b','#7c2d12'];
const gradientPresets = [
  {name:'夜空',    from:'#0f0c29', to:'#302b63'},
  {name:'日落',    from:'#f953c6', to:'#b91d73'},
  {name:'森林',    from:'#134e5e', to:'#71b280'},
  {name:'火焰',    from:'#f12711', to:'#f5af19'},
  {name:'极光',    from:'#1a2a6c', to:'#b21f1f'},
  {name:'柠檬',    from:'#acb6e5', to:'#86fde8'},
  {name:'深海',    from:'#003973', to:'#e5e5be'},
  {name:'紫梦',    from:'#4776e6', to:'#8e54e9'},
];
const annotColors = ['#ffffff','#ffff00','#ff4444','#44ff88','#4488ff','#ff8844'];
const selAnnotIdx = ref(-1);

// ════ 裁剪相关 ════
function clampCrop() {
  const c = activeClip.value; if (!c) return;
  c.crop.w = Math.max(0.1, Math.min(1 - c.crop.x, c.crop.w));
  c.crop.h = Math.max(0.1, Math.min(1 - c.crop.y, c.crop.h));
}
function setCropPreset(ratio: string) {
  const c = activeClip.value; if (!c) return;
  c.crop.enabled = true;
  const vW = videoEl.value?.videoWidth || 1920;
  const vH = videoEl.value?.videoHeight || 1080;
  const ar = vW / vH;
  const presets: Record<string,{w:number;h:number}> = {
    '16:9':  { w:1, h: ar < 16/9 ? 1 : (vW*(9/16))/vH },
    '9:16':  { w: ar > 9/16 ? (vH*(9/16))/vW : 1, h:1 },
    '1:1':   { w: ar>1 ? vH/vW : 1, h: ar<1 ? vW/vH : 1 },
    '4:3':   { w: ar>4/3 ? (vH*(4/3))/vW : 1, h: ar<4/3 ? (vW*(3/4))/vH : 1 },
    'free':  { w:1, h:1 },
  };
  const p = presets[ratio] || presets['free'];
  c.crop.w = Math.min(1, p.w); c.crop.h = Math.min(1, p.h);
  c.crop.x = (1 - c.crop.w) / 2; c.crop.y = (1 - c.crop.h) / 2;
  renderPreviewFrame();
}

// ════ 标注相关 ════
function addAnnotation(type: Annotation['type']) {
  const c = activeClip.value; if (!c) return;
  const ann: Annotation = {
    id: `ann_${Date.now()}`, type,
    x:0.35, y:0.35, w:0.3, h:0.2, angle:0,
    text: type==='text' ? '双击编辑文字' : '',
    color: type==='text' ? '#ffffff' : '#f59e0b',
    fontSize: 28, strokeWidth: 3, opacity: 1,
    startT: Math.max(0, currentTime.value - (activeClip.value?.offset||0)),
    endT: -1,
  };
  c.annotations.push(ann);
  selAnnotIdx.value = c.annotations.length - 1;
  renderPreviewFrame();
}
function removeAnnotation(i: number) {
  activeClip.value?.annotations.splice(i, 1);
  selAnnotIdx.value = -1;
  renderPreviewFrame();
}

// ════ Canvas 渲染：背景 + 裁剪 + 标注 ════
function applyBackground(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, W: number, H: number, clip: Clip) {
  const bg = clip.background;
  if (bg.type === 'none') {
    ctx.drawImage(video, 0, 0, W, H);
    return false;
  }
  // 绘制背景
  if (bg.type === 'color') {
    ctx.fillStyle = bg.color; ctx.fillRect(0, 0, W, H);
  } else if (bg.type === 'gradient') {
    const gr = ctx.createLinearGradient(0, 0,
      W * Math.cos(bg.gradient.angle * Math.PI/180),
      H * Math.sin(bg.gradient.angle * Math.PI/180));
    gr.addColorStop(0, bg.gradient.from); gr.addColorStop(1, bg.gradient.to);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  } else if (bg.type === 'blur') {
    // 模糊背景：先绘制模糊版本铺满，再在上面绘制清晰小图
    ctx.save(); ctx.filter = `blur(${bg.blurAmount}px)`;
    ctx.drawImage(video, -30, -30, W+60, H+60);
    ctx.restore();
    // 暗化
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0,0,W,H);
  }
  // 计算内边距后的主视频区域
  const pad = bg.padding;
  const vx = W * pad, vy = H * pad;
  const vw = W * (1-pad*2), vh = H * (1-pad*2);
  const r = bg.borderRadius;
  // 阴影
  if (bg.shadowOpacity > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${bg.shadowOpacity})`;
    ctx.shadowBlur = 30; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'transparent';
    ctx.beginPath(); ctx.roundRect(vx, vy, vw, vh, r); ctx.fill();
    ctx.restore();
  }
  // 裁剪绘制视频
  ctx.save();
  ctx.beginPath(); ctx.roundRect(vx, vy, vw, vh, r); ctx.clip();
  // 考虑 crop
  if (clip.crop.enabled) {
    const vW2=video.videoWidth||W, vH2=video.videoHeight||H;
    const sx=clip.crop.x*vW2, sy=clip.crop.y*vH2, sw=clip.crop.w*vW2, sh=clip.crop.h*vH2;
    ctx.drawImage(video, sx, sy, sw, sh, vx, vy, vw, vh);
  } else {
    ctx.drawImage(video, 0, 0, video.videoWidth||W, video.videoHeight||H, vx, vy, vw, vh);
  }
  ctx.restore();
  return true; // 表示已处理视频绘制
}

function applyCrop(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, W: number, H: number, crop: CropRegion) {
  if (!crop.enabled) { ctx.drawImage(video, 0, 0, W, H); return; }
  const vW=video.videoWidth||W, vH=video.videoHeight||H;
  const sx=crop.x*vW, sy=crop.y*vH, sw=crop.w*vW, sh=crop.h*vH;
  // 保持裁剪区域的宽高比绘制到全画面
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
}

function renderAnnotations(ctx: CanvasRenderingContext2D, W: number, H: number, annotations: Annotation[], localTime: number) {
  for (const ann of annotations) {
    if (ann.startT > localTime) continue;
    if (ann.endT >= 0 && ann.endT < localTime) continue;
    ctx.save(); ctx.globalAlpha = ann.opacity;
    const px=ann.x*W, py=ann.y*H, pw=ann.w*W, ph=ann.h*H;
    ctx.strokeStyle = ann.color; ctx.fillStyle = ann.color;
    ctx.lineWidth = ann.strokeWidth;
    if (ann.angle) { ctx.translate(px+pw/2,py+ph/2); ctx.rotate(ann.angle*Math.PI/180); ctx.translate(-pw/2,-ph/2); }
    if (ann.type==='text') {
      ctx.font = `bold ${ann.fontSize}px sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      // 文字阴影
      ctx.shadowColor='rgba(0,0,0,0.7)'; ctx.shadowBlur=4;
      ctx.fillText(ann.text, ann.angle?0:px, ann.angle?0:py, pw);
    } else if (ann.type==='arrow') {
      const ex=ann.angle?pw:px+pw, ey=ann.angle?0:py;
      const sx2=ann.angle?0:px, sy2=ann.angle?0:py;
      ctx.beginPath(); ctx.moveTo(sx2,sy2); ctx.lineTo(ex,ey); ctx.stroke();
      // 箭头头部
      const angle2=Math.atan2(ey-sy2,ex-sx2);
      const hs=14;
      ctx.beginPath();
      ctx.moveTo(ex,ey);
      ctx.lineTo(ex-hs*Math.cos(angle2-0.4),ey-hs*Math.sin(angle2-0.4));
      ctx.lineTo(ex-hs*Math.cos(angle2+0.4),ey-hs*Math.sin(angle2+0.4));
      ctx.closePath(); ctx.fill();
    } else if (ann.type==='rect') {
      ctx.beginPath(); ctx.roundRect(ann.angle?0:px,ann.angle?0:py,pw,ph,4); ctx.stroke();
    } else if (ann.type==='circle') {
      ctx.beginPath(); ctx.ellipse(ann.angle?pw/2:px+pw/2,ann.angle?ph/2:py+ph/2,pw/2,ph/2,0,0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }
}

/** 缓动函数 */
function easeValue(t: number, mode: string): number {
  t = Math.max(0, Math.min(1, t));
  switch (mode) {
    case 'linear':       return t;
    case 'ease-in':      return t * t * t;
    case 'ease-out':     return 1 - Math.pow(1 - t, 3);
    case 'ease-in-out':  return t < 0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
    default:             return t;
  }
}

/**
 * 计算指定时刻的缩放状态（支持动画插值）。
 * @param at 全局时间线时刻（秒）。必须由调用方显式传入：此前读全局 currentTime，
 *           导出时 currentTime 停在最后一次预览的位置，动画推镜在成片里被冻成一张静帧。
 */
function getCurrentZoomState(clip: Clip, at: number): number {
  if (!clip.zoom.enabled) return 1;
  const z = clip.zoom;
  const localTime = at - clip.offset; // 相对片段起点的时间
  if (z.animDuration <= 0) return z.scale; // 瞬间到位
  const elapsed = localTime - z.animStartTime;
  if (elapsed <= 0) return z.startScale;   // 未开始推镜
  if (elapsed >= z.animDuration) return z.scale; // 推镜完成
  const t = easeValue(elapsed / z.animDuration, z.animMode);
  return z.startScale + (z.scale - z.startScale) * t;
}

/** 计算指定时刻的推镜焦点，时间口径与 getCurrentZoomState 一致 */
function getCurrentZoomCenter(clip: Clip, at: number): { cx: number; cy: number } {
  if (!clip.zoom.enabled) return { cx: 0.5, cy: 0.5 };
  const z = clip.zoom;
  const localTime = at - clip.offset;
  if (z.animDuration <= 0) return { cx: z.x, cy: z.y };
  const elapsed = localTime - z.animStartTime;
  if (elapsed <= 0) return { cx: z.startX, cy: z.startY };
  if (elapsed >= z.animDuration) return { cx: z.x, cy: z.y };
  const t = easeValue(elapsed / z.animDuration, z.animMode);
  return {
    cx: z.startX + (z.x - z.startX) * t,
    cy: z.startY + (z.y - z.startY) * t,
  };
}

/**
 * @param at 全局时间线时刻；传 clip 时按它插值动画，不传（或无 clip）用静态 scale/x/y
 */
function renderZoom(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, W: number, H: number, zoom: ZoomRegion, clip?: Clip, at = 0) {
  const vW = video.videoWidth  || W;
  const vH = video.videoHeight || H;
  // 获取当前插值后的缩放和焦点
  const sc = clip ? getCurrentZoomState(clip, at) : zoom.scale;
  const center = clip ? getCurrentZoomCenter(clip, at) : { cx: zoom.x, cy: zoom.y };
  // 如果缩放接近 1，直接全画面
  if (sc <= 1.01) { ctx.drawImage(video, 0, 0, W, H); return; }
  const srcW = vW / sc;
  const srcH = vH / sc;
  const cx = center.cx * vW;
  const cy = center.cy * vH;
  const sx = Math.max(0, Math.min(cx - srcW / 2, vW - srcW));
  const sy = Math.max(0, Math.min(cy - srcH / 2, vH - srcH));
  ctx.drawImage(video, sx, sy, srcW, srcH, 0, 0, W, H);
}

function renderSplitScreen(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, W: number, H: number, clip: Clip, ss: SplitScreen) {
  const partner = partnerVideoEl.value;
  ctx.filter = 'none';

  if (!partner || partner.readyState < 2) {
    ctx.drawImage(video, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, H-36, W, 36);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('请选择配对视频片段', W/2, H-14);
    return;
  }

  const mode = ss.mode;
  const ratio = ss.splitRatio || 0.5;

  if (mode === 'h-split') {
    const mW = Math.round(W * (ss.mainSide==='left' ? ratio : 1-ratio));
    const [mainX, partX, mainW, partW] = ss.mainSide==='left'
      ? [0, mW, mW, W-mW]
      : [W-mW, 0, mW, W-mW];
    ctx.save(); ctx.beginPath(); ctx.rect(mainX, 0, mainW, H); ctx.clip();
    ctx.drawImage(video, 0, 0, video.videoWidth||W, video.videoHeight||H, mainX, 0, mainW, H);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(partX, 0, partW, H); ctx.clip();
    ctx.drawImage(partner, 0, 0, partner.videoWidth||W, partner.videoHeight||H, partX, 0, partW, H);
    ctx.restore();
    // 分割线
    const lineX = ss.mainSide==='left' ? mW : W-mW;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lineX, 0); ctx.lineTo(lineX, H); ctx.stroke();
  }
  else if (mode === 'v-split') {
    const mH = Math.round(H * (ss.mainSide==='top' ? ratio : 1-ratio));
    const [mainY, partY, mainH, partH] = ss.mainSide==='top'
      ? [0, mH, mH, H-mH]
      : [H-mH, 0, mH, H-mH];
    ctx.save(); ctx.beginPath(); ctx.rect(0, mainY, W, mainH); ctx.clip();
    ctx.drawImage(video, 0, 0, video.videoWidth||W, video.videoHeight||H, 0, mainY, W, mainH);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, partY, W, partH); ctx.clip();
    ctx.drawImage(partner, 0, 0, partner.videoWidth||W, partner.videoHeight||H, 0, partY, W, partH);
    ctx.restore();
    const lineY = ss.mainSide==='top' ? mH : H-mH;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(W, lineY); ctx.stroke();
  }
  else {
    // 画中画：先画主视频全画面
    ctx.drawImage(video, 0, 0, video.videoWidth||W, video.videoHeight||H, 0, 0, W, H);
    const px = Math.round(ss.pipX * W);
    const py = Math.round(ss.pipY * H);
    const pw = Math.round(ss.pipW * W);
    const ph = Math.round(ss.pipH * H);
    const radius = mode === 'pip-circle' ? Math.min(pw, ph) / 2 : 10;

    ctx.save();
    ctx.beginPath();
    if (mode === 'pip-circle') {
      ctx.arc(px + pw/2, py + ph/2, Math.min(pw,ph)/2, 0, Math.PI*2);
    } else {
      ctx.roundRect(px, py, pw, ph, radius);
    }
    ctx.clip();
    ctx.drawImage(partner, 0, 0, partner.videoWidth||W, partner.videoHeight||H, px, py, pw, ph);
    ctx.restore();

    // 边框
    if (ss.pipBorder) {
      ctx.strokeStyle = ss.pipBorderColor || '#ffffff';
      ctx.lineWidth = 3;
      ctx.save();
      ctx.beginPath();
      if (mode === 'pip-circle') {
        ctx.arc(px + pw/2, py + ph/2, Math.min(pw,ph)/2, 0, Math.PI*2);
      } else {
        ctx.roundRect(px, py, pw, ph, radius);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}

// 播放时循环渲染 canvas
function startCanvasRaf() {
  if (isRafPlaying) return;
  isRafPlaying = true;
  const loop = () => {
    renderPreviewFrame();
    if (isRafPlaying) previewRaf = requestAnimationFrame(loop);
  };
  previewRaf = requestAnimationFrame(loop);
}
function stopCanvasRaf() {
  isRafPlaying = false;
  if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = null; }
}

// ════ 速度相关 ════
function onSpeedChange() {
  if (!activeClip.value || !videoEl.value || !isPlaying.value) return;
  videoEl.value.playbackRate = activeClip.value.speed * Math.pow(2, pitchShift.value / 12);
  reoffset(activeTrackIdx.value);
}

// ════ Zoom 交互（在预览区拖选）════
let zoomDragStart = { mx: 0, my: 0, ox: 0, oy: 0, ow: 0, oh: 0 };

// 收口轮死代码清理：onZoomDragStart / clampZoom / zoomDragMode 全文件无读取方
// （拖选入口统一走 onZoomBoxDragStart / onZoomResizeDragStart，模式仅写不读），已删除

function onZoomBoxDragStart(e: MouseEvent) {
  const clip = activeClip.value; if (!clip) return;
  zoomDragStart = { mx: e.clientX, my: e.clientY, ox: clip.zoom.x, oy: clip.zoom.y, ow:0, oh:0 };
  const mm = (ev: MouseEvent) => {
    const rect = screenEl.value?.getBoundingClientRect(); if (!rect) return;
    const dx = (ev.clientX - zoomDragStart.mx) / rect.width;
    const dy = (ev.clientY - zoomDragStart.my) / rect.height;
    clip.zoom.x = Math.max(0, Math.min(1, zoomDragStart.ox + dx));
    clip.zoom.y = Math.max(0, Math.min(1, zoomDragStart.oy + dy));
    renderPreviewFrame();
  };
  const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
  document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  e.stopPropagation(); e.preventDefault();
}

function onZoomResizeStart(corner: string, e: MouseEvent) {
  // 简单：resize 时调整 scale
  const clip = activeClip.value; if (!clip) return;
  const startScale = clip.zoom.scale; const startY = e.clientY;
  const mm = (ev: MouseEvent) => {
    clip.zoom.scale = Math.max(1.1, Math.min(5, startScale + (startY - ev.clientY) * 0.02));
    renderPreviewFrame();
  };
  const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
  document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  e.stopPropagation(); e.preventDefault();
}

const zoomBoxStyle = computed(() => {
  const clip = activeClip.value;
  if (!clip?.zoom.enabled) return {};
  const sc = clip.zoom.scale;
  const boxW = 100 / sc;
  const boxH = 100 / sc;
  return {
    left:   `${Math.max(0, clip.zoom.x * 100 - boxW/2)}%`,
    top:    `${Math.max(0, clip.zoom.y * 100 - boxH/2)}%`,
    width:  `${boxW}%`,
    height: `${boxH}%`,
  };
});

function resetZoom() {
  const clip = activeClip.value; if (!clip) return;
  clip.zoom = defaultZoom(); clip.zoom.enabled = true;
  renderPreviewFrame();
}
// 推镜动画预览（从头播放该片段）
function previewZoomAnim() {
  const clip = activeClip.value; if (!clip) return;
  seekToGlobal(clip.offset);
  nextTick(() => play());
}

// 画中画快速定位
// ════ 裁剪交互 ════
function onCropBoxDrag(e: MouseEvent) {
  const c = activeClip.value; if (!c) return;
  const rect = screenEl.value?.getBoundingClientRect(); if (!rect) return;
  const startX = e.clientX, startY = e.clientY;
  const ox = c.crop.x, oy = c.crop.y;
  const mm = (ev: MouseEvent) => {
    const dx = (ev.clientX - startX) / rect.width;
    const dy = (ev.clientY - startY) / rect.height;
    c.crop.x = Math.max(0, Math.min(1 - c.crop.w, ox + dx));
    c.crop.y = Math.max(0, Math.min(1 - c.crop.h, oy + dy));
    renderPreviewFrame();
  };
  const mu = () => { document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); };
  document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  e.preventDefault();
}
function onCropResize(corner: string, e: MouseEvent) {
  const c = activeClip.value; if (!c) return;
  const rect = screenEl.value?.getBoundingClientRect(); if (!rect) return;
  const startX=e.clientX, startY=e.clientY;
  const orig = { ...c.crop };
  const mm = (ev: MouseEvent) => {
    const dx = (ev.clientX - startX) / rect.width;
    const dy = (ev.clientY - startY) / rect.height;
    if (corner.includes('r')) { c.crop.w = Math.max(0.1, Math.min(1-orig.x, orig.w+dx)); }
    if (corner.includes('l')) { const nx=Math.max(0,Math.min(orig.x+dx,orig.x+orig.w-0.1)); c.crop.w=orig.w+(orig.x-nx); c.crop.x=nx; }
    if (corner.includes('b')) { c.crop.h = Math.max(0.1, Math.min(1-orig.y, orig.h+dy)); }
    if (corner.includes('t')) { const ny=Math.max(0,Math.min(orig.y+dy,orig.y+orig.h-0.1)); c.crop.h=orig.h+(orig.y-ny); c.crop.y=ny; }
    renderPreviewFrame();
  };
  const mu = () => { document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); };
  document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  e.preventDefault();
}

// ════ 标注拖拽 ════
function onAnnotDrag(ai: number, e: MouseEvent) {
  const c = activeClip.value; if (!c) return;
  selAnnotIdx.value = ai;
  const ann = c.annotations[ai];
  const rect = screenEl.value?.getBoundingClientRect(); if (!rect) return;
  const startX=e.clientX, startY=e.clientY, ox=ann.x, oy=ann.y;
  const mm = (ev: MouseEvent) => {
    ann.x = Math.max(0, Math.min(1-ann.w, ox + (ev.clientX-startX)/rect.width));
    ann.y = Math.max(0, Math.min(1-ann.h, oy + (ev.clientY-startY)/rect.height));
    renderPreviewFrame();
  };
  const mu = () => { document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); };
  document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  e.preventDefault();
}

function setPipCorner(corner: string) {
  const clip = activeClip.value; if (!clip) return;
  const ss = clip.splitScreen;
  const margin = 0.02;
  const positions: Record<string,{x:number;y:number}> = {
    tl: { x: margin,             y: margin              },
    tr: { x: 1-ss.pipW-margin,   y: margin              },
    bl: { x: margin,             y: 1-ss.pipH-margin    },
    br: { x: 1-ss.pipW-margin,   y: 1-ss.pipH-margin    },
  };
  const p = positions[corner];
  if (p) { ss.pipX = p.x; ss.pipY = p.y; renderPreviewFrame(); }
}

// 切换配对片段时加载 partner video
async function onPartnerChange() {
  const clip = activeClip.value; if (!clip) return;
  await loadPartnerVideo(clip.splitScreen.partnerClipId);
  renderPreviewFrame();
}

// PIP 拖动：在预览区点击画中画区域可拖动
let pipDragging = false;
let pipDragStartMouse = { x:0, y:0 };
let pipDragStartPos   = { x:0, y:0 };

function onScreenMouseDown(e: MouseEvent) {
  const clip = activeClip.value;
  if (!clip?.splitScreen.enabled || !['pip-rect','pip-circle'].includes(clip.splitScreen.mode)) return;
  const rect = screenEl.value?.getBoundingClientRect(); if (!rect) return;
  const mx = (e.clientX - rect.left) / rect.width;
  const my = (e.clientY - rect.top)  / rect.height;
  const ss = clip.splitScreen;
  // 检查是否点在 pip 区域内
  const inPip = mx >= ss.pipX && mx <= ss.pipX+ss.pipW && my >= ss.pipY && my <= ss.pipY+ss.pipH;
  if (!inPip) {
    // 如果是推镜模式，点击设置焦点
    if (clip.zoom.enabled && inspectorMode.value === 'zoom') {
      clip.zoom.x = Math.max(0.05, Math.min(0.95, mx));
      clip.zoom.y = Math.max(0.05, Math.min(0.95, my));
      renderPreviewFrame();
    }
    return;
  }
  pipDragging = true;
  pipDragStartMouse = { x: mx, y: my };
  pipDragStartPos   = { x: ss.pipX, y: ss.pipY };
  e.preventDefault();
  const mm = (ev: MouseEvent) => {
    if (!pipDragging) return;
    const r2 = screenEl.value?.getBoundingClientRect(); if (!r2) return;
    const nmx = (ev.clientX - r2.left) / r2.width;
    const nmy = (ev.clientY - r2.top)  / r2.height;
    const dx = nmx - pipDragStartMouse.x;
    const dy = nmy - pipDragStartMouse.y;
    ss.pipX = Math.max(0, Math.min(1-ss.pipW, pipDragStartPos.x + dx));
    ss.pipY = Math.max(0, Math.min(1-ss.pipH, pipDragStartPos.y + dy));
    renderPreviewFrame();
  };
  const mu = () => { pipDragging=false; document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); };
  document.addEventListener('mousemove', mm);
  document.addEventListener('mouseup', mu);
}

// 缓动曲线定义（用于 UI 显示）
const easingModes = [
  { key: 'instant',      label: '瞬间' },
  { key: 'linear',       label: '匀速' },
  { key: 'ease-in',      label: '渐快' },
  { key: 'ease-out',     label: '渐慢' },
  { key: 'ease-in-out',  label: '先慢后快' },
] as const;

// ════ 加载 partner video ════
async function loadPartnerVideo(clipId: string) {
  const pv = partnerVideoEl.value; if (!pv) return;
  const c = clips.value.find(x => x.id === clipId);
  if (!c) { pv.src = ''; return; }
  if (pv.getAttribute('data-url') !== c.url) {
    pv.src = c.url; pv.setAttribute('data-url', c.url);
    // partner 从对应时间点加载
    await new Promise<void>(r => { pv.onloadedmetadata = () => r(); });
    pv.currentTime = c.trimStart;
  }
}

// watch activeClip splitScreen 的 partner 变化
// 这在下面 onMounted 里用 watch 实现
function applyFilterClip(c:Clip){if(!videoEl.value)return;const f=c.filters;videoEl.value.style.filter=`brightness(${f.brightness}%)contrast(${f.contrast}%)saturate(${f.saturation}%)blur(${f.blur}px)hue-rotate(${f.hueRotate}deg)`;}
function applyPreset(p:{name:string;v:Record<string,number>}){if(!activeClip.value)return;Object.assign(activeClip.value.filters,p.v);activeClip.value.preset=p.name;applyFilters();}
function applyPitchPreview(){if(videoEl.value&&activeClip.value)videoEl.value.playbackRate=activeClip.value.speed*Math.pow(2,pitchShift.value/12);}
function syncAudioMute() { /* 音频轨静音状态同步 */ }

// ─── 片段管理 ─────────────────────────────────────
function selectClipByTrack(ti:number, li:number) {
  if(isPlaying.value) pause();
  activeTrackIdx.value=ti; activeClipLocalIdx.value=li;
  const clip = videoTracks.value[ti]?.clips[li];
  if(clip&&videoEl.value){
    videoEl.value.src=clip.url;videoEl.value.setAttribute('data-url',clip.url);
    videoEl.value.playbackRate=clip.speed*Math.pow(2,pitchShift.value/12);
    videoEl.value.volume=clip.muted?0:masterVolume.value*(clip.volume/100);
    videoEl.value.currentTime=clip.trimStart;currentTime.value=clip.offset;
    applyFilterClip(clip);
    nextTick(()=>renderPreviewFrame());
  }
  // 保持当前 tab（如果是片段相关 tab）
  if (!['clip','speed','zoom','split-screen','filter'].includes(inspectorMode.value)) {
    inspectorMode.value = 'clip';
  }
  if(!inspectorOpen.value) inspectorOpen.value=true;
}
function removeClip(gi:number) {
  const r = findClipByGlobal(gi);
  if (!r) return;
  saveUndo();  // 保存快照，支持撤销
  videoTracks.value[r.ti].clips.splice(r.ci, 1);
  reoffset(r.ti);
  // 调整激活片段索引
  const remaining = videoTracks.value[r.ti].clips.length;
  if (remaining === 0) {
    activeClipLocalIdx.value = -1;
  } else {
    // 选中前一个或第一个
    activeClipLocalIdx.value = Math.min(r.ci, remaining - 1);
  }
  ctxMenu.show = false;
  if (isPlaying.value) pause();
}
function reoffset(ti:number) { let t=0; videoTracks.value[ti]?.clips.forEach(c=>{c.offset=t;t+=(c.trimEnd-c.trimStart)/c.speed;}); }
function splitClipAtPlayhead(ti:number, li:number) {
  const clip = videoTracks.value[ti]?.clips[li];
  if (!clip) return;

  // 计算切割点在原始视频中的位置
  const localT = clip.trimStart + (currentTime.value - clip.offset) * clip.speed;

  // 检查切割点是否在有效范围内（至少保留 0.05s）
  if (localT <= clip.trimStart + 0.05 || localT >= clip.trimEnd - 0.05) {
    log.warn('[split] 切割点太靠近边缘，忽略', { localT, trimStart: clip.trimStart, trimEnd: clip.trimEnd });
    return;
  }

  saveUndo();

  // 生成新波形
  const wave = Array.from({ length: 20 }, (_, i) => `${i * 5.26},${5 + Math.random() * 14}`).join(' ');

  // 右侧新片段：从切割点开始到原来的出点
  const right: Clip = {
    ...clip,
    id: `c_${Date.now()}_r`,
    name: clip.name.replace(/ ②$/, '') + ' ②',
    trimStart: localT, trimEnd: clip.trimEnd, offset: 0, _wave: wave,
    filters: { ...clip.filters }, zoom: { ...clip.zoom }, splitScreen: { ...clip.splitScreen },
    crop: { ...clip.crop }, annotations: clip.annotations.map(a=>({...a})),
    background: { ...clip.background, gradient: { ...clip.background.gradient } },
  };

  // 左侧原片段：出点改为切割点
  clip.trimEnd = localT;

  // 插入右侧片段到下一个位置
  videoTracks.value[ti].clips.splice(li + 1, 0, right);

  // 重算所有 offset
  reoffset(ti);

  // 选中右侧新片段（方便继续操作）
  activeTrackIdx.value = ti;
  activeClipLocalIdx.value = li + 1;
}

// ─── Undo/Redo ────────────────────────────────────
/**
 * 时间线深拷贝口径：Undo 快照与工程自动保存共用，避免两套序列化语义漂移
 * （例如某天给 Clip 加了嵌套字段，只改一处就会让另一处丢参数）。
 */
function cloneTimeline() {
  return {
    tracks: videoTracks.value.map(t => ({
      ...t,
      clips: t.clips.map(c => ({ ...c, filters:{...c.filters}, zoom:{...c.zoom}, splitScreen:{...c.splitScreen}, crop:{...c.crop}, annotations:c.annotations.map(a=>({...a})), background:{...c.background,gradient:{...c.background.gradient}} }))
    })),
    dubs: dubClips.value.map(d => ({ ...d })),
    caps: captions.value.map(c => ({ ...c })),
  };
}
function deepSnap(): string {
  return JSON.stringify(cloneTimeline());
}
function saveUndo() {
  undoStack.push(deepSnap());
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
}
function undo() {
  if (!undoStack.length) return;
  const snap = undoStack.pop()!;
  // 保存当前状态到 redo 栈（深拷贝）
  redoStack.push(deepSnap());
  applySnapshot(snap);
  nextTick(() => fitView());
}
function redo() {
  if (!redoStack.length) return;
  const snap = redoStack.pop()!;
  undoStack.push(deepSnap());
  applySnapshot(snap);
  nextTick(() => fitView());
}
function applySnapshot(s:string) { try{const d=JSON.parse(s);videoTracks.value=d.tracks;dubClips.value=d.dubs;captions.value=d.caps;}catch{ /* noop：快照 JSON 损坏时放弃恢复 */ } }

// ─── 工程自动保存 / 崩溃恢复 ───────────────────────
// 编辑器此前零持久化：刷新、崩溃、误关标签都会丢光整条时间线。
// 落盘的是工程参数 + 素材耐久引用（IDB 键 / http 直链），blob: URL 绝不入库。
const recoveryProject = ref<PersistedProject|null>(null);
const recoverySavedAt = ref(0);
const restoring       = ref(false);
const autosaveEnabled = ref(false);
const saveState       = ref<'idle'|'pending'|'saved'|'failed'>('idle');
const savedAtText     = ref('');
let autosaveTimer: ReturnType<typeof setTimeout>|null = null;
let autosaveRunning = false;
let autosaveAgain = false;

const recoveryTimeText = computed(() => {
  if (!recoverySavedAt.value) return '';
  const d = new Date(recoverySavedAt.value);
  return `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
});
const recoveryClipCount = computed(() =>
  (recoveryProject.value?.tracks.reduce((n,t)=>n+t.clips.length,0) ?? 0) + (recoveryProject.value?.dubs.length ?? 0));

function buildProjectSnapshot(): PersistedProject {
  const t = cloneTimeline();
  return {
    version: PROJECT_SNAPSHOT_VERSION,
    savedAt: Date.now(),
    tracks: t.tracks.map(tr => ({ ...tr, clips: tr.clips.map(toPersistedMedia) })),
    dubs: t.dubs.map(toPersistedMedia),
    caps: t.caps,
    markers: markers.value.map(m => ({ ...m })),
    audioTracks: audioTracks.value.map(a => ({ ...a })),
    bgVolume: bgVolume.value,
    bgMuted: bgMuted.value,
    masterVolume: masterVolume.value,
    bgMusicKey: bgMusicKey.value,
    bgMusicName: bgMusicName.value || undefined,
  };
}

async function flushAutosave(): Promise<void> {
  if (!autosaveEnabled.value) return;
  if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  // 串行写：并发写同一槽位时完成顺序不定，旧快照可能覆盖新快照
  if (autosaveRunning) { autosaveAgain = true; return; }
  autosaveRunning = true;
  try {
    const snap = buildProjectSnapshot();
    await idbPut(STORE_HLS_BLOBS, EDITOR_PROJECT_KEY, snap);
    saveState.value = 'saved';
    const d = new Date(snap.savedAt);
    savedAtText.value = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch (e) {
    saveState.value = 'failed';
    log.error('工程自动保存失败', e);
    pushNotice('error', '自动保存失败', `工程未能写入本地存储（${e instanceof Error ? e.message : String(e)}）；请立即导出，否则关闭页面会丢失本次编辑`);
  } finally {
    autosaveRunning = false;
    if (autosaveAgain) { autosaveAgain = false; void flushAutosave(); }
  }
}
function scheduleAutosave(): void {
  if (!autosaveEnabled.value) return;
  saveState.value = 'pending';
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { autosaveTimer = null; void flushAutosave(); }, AUTOSAVE_DEBOUNCE_MS);
}
watch([videoTracks, dubClips, captions, markers, audioTracks, bgMusicKey, bgMusicName, bgVolume, bgMuted, masterVolume],
  () => scheduleAutosave(), { deep: true });

/** 页面切后台/关闭前抢一次落盘：防抖窗口内的最后一笔改动不能丢 */
function onPageHide(): void { if (document.visibilityState === 'hidden') void flushAutosave(); }
function onBeforeUnload(): void { void flushAutosave(); }

/**
 * 解出素材的可用 object URL。优先 IDB 耐久键，其次 http 直链重抓；
 * 两条路都走不通就返回 null，由调用方剔除该条并可见告知——绝不静默少一段。
 */
async function resolveMediaUrl(m: { materialKey?: string; sourceUrl?: string }, label: string): Promise<string|null> {
  if (m.materialKey) {
    try {
      const blob = resolveHandoffBlob(await idbGet(STORE_HLS_BLOBS, m.materialKey));
      if (blob) return URL.createObjectURL(blob);
      log.warn('素材键对应的内容已不存在', m.materialKey);
    } catch (e) { log.warn('读取素材键失败', m.materialKey, e); }
  }
  if (m.sourceUrl && isAllowedClipUrl(m.sourceUrl)) {
    try {
      const blob = await fetchClipBlobCapped(m.sourceUrl, MAX_REMOTE_CLIP_BYTES);
      if (!blob.size) throw new Error('素材内容为空');
      return URL.createObjectURL(blob);
    } catch (e) { reportClipLoadError(label, e); return null; }
  }
  reportClipLoadError(label, new Error(m.materialKey ? '本地素材已被清理，请重新导入' : '缺少可恢复的素材来源'));
  return null;
}

/** 释放当前时间线持有的 object URL 与解码缓存：恢复会整体替换，不释放就把旧 Blob 钉在内存里 */
function releaseTimelineResources(): void {
  if (isPlaying.value) pause();
  stopLive();
  for (const c of clips.value) { if (c.url.startsWith('blob:')) URL.revokeObjectURL(c.url); }
  for (const d of dubClips.value) { if (d.url.startsWith('blob:')) URL.revokeObjectURL(d.url); }
  frameCache.forEach(v => v.remove());
  frameCache.clear();
  audioBufferCache.clear();
}

async function restoreProject(p: PersistedProject): Promise<void> {
  restoring.value = true;
  let missing = 0;
  try {
    releaseTimelineResources();
    const tracks: VideoTrack[] = [];
    for (const t of p.tracks) {
      const restored: Clip[] = [];
      for (const c of t.clips) {
        const url = await resolveMediaUrl(c, String(c.name ?? '未命名素材'));
        if (!url) { missing++; continue; }
        // 落盘时 url 被置空，其余剪辑参数原样透传；此处断言回运行态类型
        restored.push({ ...(c as unknown as Clip), url });
        void preloadAudio(url, url);
      }
      tracks.push({ clips: restored, locked: !!t.locked, visible: t.visible !== false, muted: !!t.muted });
    }
    const dubs: DubClip[] = [];
    for (const d of p.dubs) {
      const url = await resolveMediaUrl(d, `配音 ${fmtT(Number(d.at) || 0)}`);
      if (!url) { missing++; continue; }
      dubs.push({ ...(d as unknown as DubClip), url });
      void preloadAudio(url, String(d.id));
    }
    videoTracks.value = tracks.length ? tracks : [{ clips:[], locked:false, visible:true, muted:false }];
    dubClips.value = dubs;
    captions.value = p.caps as Caption[];
    markers.value = p.markers as Marker[];
    audioTracks.value = p.audioTracks.length ? p.audioTracks as AudioTrack[] : [{ locked:false, muted:false }, { locked:false, muted:false }];
    bgVolume.value = p.bgVolume;
    bgMuted.value = p.bgMuted;
    masterVolume.value = p.masterVolume;
    if (p.bgMusicKey) {
      try {
        const blob = resolveHandoffBlob(await idbGet(STORE_HLS_BLOBS, p.bgMusicKey));
        if (!blob) throw new Error('本地素材已被清理');
        await useBgMusicBlob(blob, p.bgMusicName || '背景音乐', p.bgMusicKey);
      } catch (e) {
        removeBgMusic();
        reportClipLoadError(p.bgMusicName || '背景音乐', e);
      }
    } else {
      removeBgMusic();
      bgVolume.value = p.bgVolume;
      bgMuted.value = p.bgMuted;
    }
    activeTrackIdx.value = 0;
    activeClipLocalIdx.value = -1;
    currentTime.value = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    nextTick(() => fitView());
    const total = tracks.reduce((n,t)=>n+t.clips.length,0) + dubs.length;
    log.info('工程已恢复', { total, missing });
    pushNotice('warning', '已恢复上次编辑',
      missing ? `恢复 ${total} 段素材，另有 ${missing} 段素材已失效被跳过（详见上方失败提示）`
              : `恢复 ${total} 段素材与全部剪辑参数，可继续编辑`);
  } catch (e) {
    log.error('恢复工程失败', e);
    pushNotice('error', '恢复失败', `上次工程未能完整恢复（${e instanceof Error ? e.message : String(e)}）`);
  } finally {
    restoring.value = false;
    autosaveEnabled.value = true;
    // 立刻回写：失效素材已被剔除，下次打开不该再为同一批死素材反复报错
    void flushAutosave();
  }
}

async function acceptRecovery(): Promise<void> {
  const p = recoveryProject.value;
  recoveryProject.value = null;
  if (p) await restoreProject(p);
  else autosaveEnabled.value = true;
}
/** 从头开始：清掉旧槽位，素材本体留给 TTL 回收，7 天内仍可从存储里找回 */
async function discardRecovery(): Promise<void> {
  recoveryProject.value = null;
  autosaveEnabled.value = true;
  try { await idbDelete(STORE_HLS_BLOBS, EDITOR_PROJECT_KEY); }
  catch (e) { log.warn('清理旧工程槽位失败', e); }
  await flushAutosave();
}

/**
 * 孤儿素材回收：只删工程自有前缀、超过 TTL、且既不被上次工程也不被当前时间线引用的键。
 * caprec_ 录制成果与 editor_handoff_ 一次性交接键归他人所有，一律不碰。
 */
async function sweepOrphanMaterials(saved: PersistedProject|null): Promise<void> {
  try {
    const kept = new Set<string>(saved ? collectMaterialKeys(saved) : []);
    for (const k of collectMaterialKeys(buildProjectSnapshot())) kept.add(k);
    const now = Date.now();
    const keys = (await idbGetAllKeys(STORE_HLS_BLOBS)).filter(k => k.startsWith(EDITOR_MATERIAL_PREFIX) && !kept.has(k));
    let removed = 0;
    for (const key of keys) {
      const rec = await idbGet<{ savedAt?: unknown }>(STORE_HLS_BLOBS, key);
      if (!isOrphanMaterial(key, rec?.savedAt, now, kept)) continue;
      await idbDelete(STORE_HLS_BLOBS, key);
      removed++;
    }
    if (removed) log.info('回收过期孤儿素材', removed);
  } catch (e) { log.warn('孤儿素材回收失败', e); }
}

// ─── 时间轴交互 ───────────────────────────────────
function getContentX(clientX:number):number { return clientX-(tlScrollArea.value?.getBoundingClientRect().left??0)+(tlScrollArea.value?.scrollLeft??0); }

function onRulerDown(e:MouseEvent) {
  const t = getContentX(e.clientX) / pxPerSec.value;
  if (tlTool.value === 'split') {
    currentTime.value = t;  // 先更新 currentTime
    const ci = findClipAt(t);
    if (ci) splitClipAtPlayhead(ci.ti, ci.li);
    else seekToGlobal(t);   // 没有片段时只移动播放头
  } else {
    seekToGlobal(t);
    const mm = (ev: MouseEvent) => seekToGlobal(getContentX(ev.clientX) / pxPerSec.value);
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  }
}
function onRulerMove(e:MouseEvent) { if(tlTool.value==='split')splitX.value=getContentX(e.clientX); else splitX.value=-1; }
function onTrackBgClick(e:MouseEvent) {
  if (tlTool.value === 'split') {
    const t = getContentX(e.clientX) / pxPerSec.value;
    currentTime.value = t;
    const ci = findClipAt(t);
    if (ci) splitClipAtPlayhead(ci.ti, ci.li);
    else seekToGlobal(t);
  }
}
function onTrackMousemove(e:MouseEvent) { if(tlTool.value==='split')splitX.value=getContentX(e.clientX); else splitX.value=-1; }

function onSegDown(ti:number, li:number, e:MouseEvent) {
  if(tlTool.value!=='select'||videoTracks.value[ti].locked)return;
  const sx=e.clientX; const orig=videoTracks.value[ti].clips[li].offset; isDragging.value=true;
  const mm=(ev:MouseEvent)=>{
    const newOff=Math.max(0,orig+(ev.clientX-sx)/pxPerSec.value);
    videoTracks.value[ti].clips[li].offset=newOff;
    dragLabel.value=fmtT(newOff);
    // 吸附检测
    const snapTargets=[...videoTracks.value[ti].clips.map(c=>[c.offset,(c.offset+(c.trimEnd-c.trimStart)/c.speed)]).flat()].filter((_,i2)=>Math.floor(i2/2)!==li);
    const nearSnap=snapTargets.find(t2=>Math.abs(t2-newOff)*pxPerSec.value<8);
    if(nearSnap!==undefined){videoTracks.value[ti].clips[li].offset=nearSnap;snapX.value=nearSnap*pxPerSec.value;}else snapX.value=-1;
  };
  const mu=()=>{isDragging.value=false;dragLabel.value='';snapX.value=-1;document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);saveUndo();};
  document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);e.preventDefault();
}
function onTrimDown(ti:number, li:number, side:'start'|'end', e:MouseEvent) {
  const sx=e.clientX; const c=videoTracks.value[ti].clips[li]; const orig={s:c.trimStart,e:c.trimEnd,off:c.offset}; isDragging.value=true;
  const mm=(ev:MouseEvent)=>{
    const dt=(ev.clientX-sx)/pxPerSec.value*c.speed;
    if(side==='start'){c.trimStart=Math.max(0,Math.min(orig.s+dt,c.trimEnd-.05));c.offset=orig.off+(c.trimStart-orig.s)/c.speed;}
    else c.trimEnd=Math.max(c.trimStart+.05,Math.min(c.duration,orig.e+dt));
    reoffset(ti); dragLabel.value=side==='start'?`入:${fmtT(c.trimStart)}`:`出:${fmtT(c.trimEnd)}`;
  };
  const mu=()=>{isDragging.value=false;dragLabel.value='';document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);saveUndo();};
  document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);e.preventDefault();
}
function onDubDown(i:number, e:MouseEvent) {
  const sx=e.clientX; const orig=dubClips.value[i].at; isDragging.value=true;
  const mm=(ev:MouseEvent)=>{dubClips.value[i].at=Math.max(0,orig+(ev.clientX-sx)/pxPerSec.value); dragLabel.value=fmtT(dubClips.value[i].at);};
  const mu=()=>{isDragging.value=false;dragLabel.value='';document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};
  document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);e.preventDefault();
}
function dragPH(e:MouseEvent) { const mm=(ev:MouseEvent)=>seekToGlobal(getContentX(ev.clientX)/pxPerSec.value); const mu=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);}; document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);e.preventDefault(); }

function onTlScroll() { /* 滚动同步（标签列已用grid固定，无需处理） */ }
function onTlWheel(e:WheelEvent) {
  if(e.ctrlKey) { const f=e.deltaY>0?.85:1.18; pxPerSec.value=Math.max(10,Math.min(400,pxPerSec.value*f)); return; }
  if(tlScrollArea.value) tlScrollArea.value.scrollLeft+=e.deltaY;
}
function onCtrlWheel(e:WheelEvent) { const f=e.deltaY>0?.85:1.18; pxPerSec.value=Math.max(10,Math.min(400,pxPerSec.value*f)); }

function openCtxMenu(i:number, e:MouseEvent, type:'video'|'dub') { ctxMenu.show=true;ctxMenu.x=e.clientX;ctxMenu.y=e.clientY;ctxMenu.idx=i;ctxMenu.type=type; }
const ctxMenu = reactive({ show:false, x:0, y:0, idx:-1, type:'video' as 'video'|'dub' });
const bgCtxMenu = reactive({ show:false, x:0, y:0 });

function openBgmCtxMenu(e:MouseEvent) {
  ctxMenu.show = false;
  bgCtxMenu.show = true; bgCtxMenu.x = e.clientX; bgCtxMenu.y = e.clientY;
}
function splitAtPlayhead_ctx(){const r=findClipByGlobal(ctxMenu.idx);if(r)splitClipAtPlayhead(r.ti,r.ci);ctxMenu.show=false;}
function ctxDuplicate(){const r=findClipByGlobal(ctxMenu.idx);if(!r)return;const c=videoTracks.value[r.ti].clips[r.ci];const nc={...c,id:`c_${Date.now()}`,name:c.name+' 副本',offset:0,_wave:Array.from({length:20},(_,i)=>`${i*5.26},${5+Math.random()*14}`).join(' ')};videoTracks.value[r.ti].clips.splice(r.ci+1,0,nc);reoffset(r.ti);ctxMenu.show=false;}
function ctxMoveLeft(){const r=findClipByGlobal(ctxMenu.idx);if(!r||r.ci<=0)return;saveUndo();const arr=videoTracks.value[r.ti].clips;[arr[r.ci],arr[r.ci-1]]=[arr[r.ci-1],arr[r.ci]];reoffset(r.ti);ctxMenu.show=false;}
function ctxMoveRight(){const r=findClipByGlobal(ctxMenu.idx);if(!r)return;saveUndo();const arr=videoTracks.value[r.ti].clips;if(r.ci>=arr.length-1)return;[arr[r.ci],arr[r.ci+1]]=[arr[r.ci+1],arr[r.ci]];reoffset(r.ti);ctxMenu.show=false;}
function ctxDelete(){ctxMenu.type==='dub'?removeDub(ctxMenu.idx):removeClip(ctxMenu.idx);ctxMenu.show=false;}

function addMarkerAt(){const m:Marker={id:`m_${Date.now()}`,t:currentTime.value,label:fmtT(currentTime.value)};markers.value.push(m);ctxMenu.show=false;}

function onKeyS() { if(activeClip.value){const r=findClipByGlobal(activeClipIdx.value);if(r)splitClipAtPlayhead(r.ti,r.ci);} }

/** 片段点击：选择模式→选中，切割模式→在鼠标位置切割 */
function onSegClick(ti:number, li:number, e:MouseEvent) {
  if (tlTool.value === 'split') {
    const clip = videoTracks.value[ti]?.clips[li];
    if (!clip) return;
    // 从鼠标点击位置算出全局时间
    const clickT = getContentX(e.clientX) / pxPerSec.value;
    // 夹紧到片段有效范围
    const clampedT = Math.max(
      clip.offset + 0.06,
      Math.min(clickT, clip.offset + (clip.trimEnd - clip.trimStart) / clip.speed - 0.06)
    );
    // 更新 currentTime 后再切割（同步操作）
    currentTime.value = clampedT;
    // 直接切割（currentTime 已更新）
    splitClipAtPlayhead(ti, li);
  } else {
    selectClipByTrack(ti, li);
  }
}
function onKeyDelete() { if(activeClip.value)removeClip(activeClipIdx.value); }

function zoomIn()  { pxPerSec.value=Math.min(400,pxPerSec.value*1.5); }
function zoomOut() { pxPerSec.value=Math.max(10, pxPerSec.value/1.5); }
function fitView() {
  if (!tlScrollArea.value) return;
  const visW = tlScrollArea.value.clientWidth - 10;
  minTlPx.value = visW; // 确保时间轴至少填满可视区
  if (totalDuration.value > 0) {
    // 适应内容：让内容恰好填满 80% 可视宽度
    pxPerSec.value = Math.max(5, Math.min(400, (visW * 0.8) / totalDuration.value));
  } else {
    pxPerSec.value = 80;
  }
}

// ─── Inspector ────────────────────────────────────
function openInspector(mode: 'clip'|'dub'|'caption'|'audio'|'ai') { inspectorMode.value=mode; inspectorOpen.value=true; }

// ─── Resizer ──────────────────────────────────────
function onResizerDown(e:MouseEvent) {
  resizerStartX=e.clientX; resizerStartW=previewW.value||document.querySelector('.pane-preview')?.getBoundingClientRect().width||400;
  const mm=(ev:MouseEvent)=>{previewW.value=Math.max(200,Math.min(window.innerWidth*.7,resizerStartW+(ev.clientX-resizerStartX)));};
  const mu=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};
  document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);e.preventDefault();
}

// ─── 字幕 ─────────────────────────────────────────
function submitCap(){if(!capForm.text)return;saveUndo();if(editCapIdx.value>=0){captions.value[editCapIdx.value]={...capForm,id:captions.value[editCapIdx.value].id??newCaptionId()};cancelCap();}else{captions.value.push({...capForm,id:newCaptionId()});capForm.text='';}}
function editCap(i:number){Object.assign(capForm,captions.value[i]);editCapIdx.value=i;openInspector('caption');}
function deleteCap(i:number){saveUndo();captions.value.splice(i,1);if(editCapIdx.value===i)cancelCap();}
function cancelCap(){editCapIdx.value=-1;capForm.text='';}

// ─── 字幕文件（SRT / WebVTT）双向 ──────────────────
/** 导入偏移（秒）：源字幕按素材自身零点计时，落到时间线要整体平移 */
const srtOffset = ref(0);
/** 上一次导入/导出的结果说明（含被跳过的坏行），留在面板上而不是只打日志 */
const srtReport = ref('');

/** 生成一条字幕条目 id（列表稳定 key 与后续按脚本重排都要用） */
function newCaptionId(): string {
  return `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 字幕模型 → SRT 提示：文本原样保留，多行仍是一行正文里的换行 */
function captionsToCues(): SubtitleCue[] {
  return [...captions.value]
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ start: c.start, end: c.end, text: c.text }));
}

/**
 * 导入 .srt/.vtt：解析 → 平移 → 按成片时长裁剪 → 追加进时间线。
 * 坏行由 parseSubtitle 记账回传，这里如实显示条数，绝不出现「导入成功但少了几条还不说」。
 */
async function importSubtitleFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  srtReport.value = '';
  let text = '';
  try {
    text = await file.text();
  } catch (e: unknown) {
    srtReport.value = `读取文件失败：${e instanceof Error ? e.message : String(e)}`;
    log.error('字幕文件读取失败', e);
    return;
  }
  const parsed = parseSubtitle(text);
  if (!parsed.cues.length) {
    srtReport.value = `未解析到任何字幕条目${parsed.errors.length ? `：${parsed.errors[0]}` : '（文件可能是空的或不是字幕格式）'}`;
    pushNotice('error', '字幕导入失败', `${file.name}：${srtReport.value}`);
    return;
  }
  const shifted = shiftCues(parsed.cues, srtOffset.value);
  const dur = totalDuration.value;
  const clamped = dur > 0 ? clampCuesToDuration(shifted, dur) : { cues: shifted, dropped: 0 };
  if (!clamped.cues.length) {
    srtReport.value = `全部 ${shifted.length} 条字幕都落在时间线之外（偏移 ${srtOffset.value}s，成片 ${fmtT(dur)}）`;
    pushNotice('warning', '字幕导入为空', srtReport.value);
    return;
  }
  saveUndo();
  for (const cue of clamped.cues) {
    captions.value.push({ id: newCaptionId(), text: cue.text, start: cue.start, end: cue.end, position: 'bottom', color: '#ffffff', size: 'md' });
  }
  captions.value.sort((a, b) => a.start - b.start);
  const parts = [`已导入 ${clamped.cues.length} 条（来自 ${file.name}）`];
  if (clamped.dropped) parts.push(`超出片尾丢弃 ${clamped.dropped} 条`);
  if (parsed.errors.length) parts.push(`跳过 ${parsed.errors.length} 处异常：${parsed.errors[0]}`);
  srtReport.value = parts.join('；');
  log.info(`字幕导入：${srtReport.value}`);
}

/** 导出字幕文件：SRT 兼容性最好，VTT 供网页播放器直接用 */
function exportSubtitles(fmt: 'srt' | 'vtt') {
  if (!captions.value.length) return;
  const cues = captionsToCues();
  const text = fmt === 'srt' ? serializeSrt(cues) : serializeVtt(cues, 'MediaPlus 编辑器导出');
  const blob = new Blob([text], { type: fmt === 'srt' ? 'text/plain;charset=utf-8' : 'text/vtt;charset=utf-8' });
  triggerBlobDownload(blob, `MediaPlus_字幕_${Date.now()}.${fmt}`);
  srtReport.value = `已导出 ${cues.length} 条 ${fmt.toUpperCase()}（时间戳相对时间线起点）`;
  log.info(`字幕导出：${fmt}，${cues.length} 条`);
}

// ─── 麦克风 ───────────────────────────────────────
// 收口轮 lint 修复：去掉 PermissionDescriptor/PermissionName 全局类型断言
// （no-undef 不识别 TS lib 类型名）；'microphone' 字面量在 TS 5.3 DOM 库中即为合法 name
async function checkMicPerm(){try{const r=await navigator.permissions.query({name:'microphone'});micStatus.value=r.state as any;r.addEventListener('change',()=>{micStatus.value=r.state as any;});}catch{micStatus.value='prompt';}}
async function requestMic(){try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());micStatus.value='granted';}catch{micStatus.value='denied';}}
async function toggleDub(){
  if(dubRecording.value){
    dubRec?.stop();dubRecording.value=false;
    if(dubTimer){clearInterval(dubTimer);dubTimer=null;} if(levelRaf){cancelAnimationFrame(levelRaf);levelRaf=null;}
    analyserNode=null;micStream?.getTracks().forEach(t=>t.stop());micStream=null;micACtx?.close();micACtx=null;videoEl.value?.pause();audioLevel.value=0;
  }else{
    try{
      micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});micStatus.value='granted';
      micACtx=new AudioContext();analyserNode=micACtx.createAnalyser();analyserNode.fftSize=256;
      micACtx.createMediaStreamSource(micStream).connect(analyserNode);
      const buf=new Uint8Array(analyserNode.frequencyBinCount);
      const upLv=()=>{if(!analyserNode)return;analyserNode.getByteFrequencyData(buf);audioLevel.value=Math.min(100,buf.reduce((a,b)=>a+b,0)/buf.length/128*300);levelRaf=requestAnimationFrame(upLv);};
      levelRaf=requestAnimationFrame(upLv);
      const startAt=currentTime.value;const startMs=Date.now();dubElapsed.value=0;
      dubTimer=setInterval(()=>{dubElapsed.value=(Date.now()-startMs)/1000;},100);
      const chunks:Blob[]=[];const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';
      dubRec=new MediaRecorder(micStream,{mimeType:mime});
      dubRec.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
      dubRec.onstop=async()=>{
        const blob=new Blob(chunks,{type:mime});const url=URL.createObjectURL(blob);const id=`dub_${Date.now()}`;
        const duration=Math.max(.1,dubElapsed.value);
        const materialKey=await persistMaterial(blob,`配音 ${fmtT(startAt)}`);
        dubClips.value.push({id,at:startAt,duration,url,volume:100,muted:false,materialKey});
        preloadAudio(url,id);selDubIdx.value=dubClips.value.length-1;openInspector('dub');
      };
      dubRec.start(100);dubRecording.value=true;videoEl.value?.play().catch(()=>{});
    }catch(err:any){micStatus.value='denied';alert(`麦克风失败：${err?.message??err}`);}
  }
}
function removeDub(i:number){URL.revokeObjectURL(dubClips.value[i].url);dubClips.value.splice(i,1);ctxMenu.show=false;}

// ─── AI ───────────────────────────────────────────
async function aiRequest(messages:any[], opts?:{maxTokens?:number}){
  const resp=await fetch(`${aiCfg.value.baseUrl.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'Authorization':`Bearer ${aiCfg.value.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:aiCfg.value.model,messages,max_tokens:opts?.maxTokens??2000})});
  if(!resp.ok)throw new Error(`AI ${resp.status}: ${await resp.text()}`);
  return (await resp.json()).choices?.[0]?.message?.content??'';
}
async function runTranscript(){
  if(!activeClip.value||!aiCfg.value.apiKey)return;
  aiLoading.value=true;aiTask.value='transcript';aiResult.value='';
  try{
    const blob=await extractAudioBlob(activeClip.value);const fd=new FormData();fd.append('file',blob,'audio.wav');fd.append('model',aiCfg.value.whisperModel||'whisper-1');if(transcriptLang.value!=='auto')fd.append('language',transcriptLang.value);fd.append('response_format','verbose_json');fd.append('timestamp_granularities[]','segment');
    const resp=await fetch(`${aiCfg.value.baseUrl.replace(/\/$/,'')}/audio/transcriptions`,{method:'POST',headers:{'Authorization':`Bearer ${aiCfg.value.apiKey}`},body:fd});
    if(!resp.ok)throw new Error(`Whisper ${resp.status}`);
    const data=await resp.json();aiResultRaw.value=data;
    if(data.segments){const off=activeClip.value.offset;aiResult.value=data.segments.map((s:any)=>`[${fmtT(s.start+off)}-${fmtT(s.end+off)}] ${s.text.trim()}`).join('\n');}
    else aiResult.value=data.text||'无法识别';
  }catch(e:any){aiResult.value=`失败：${e.message}`;}finally{aiLoading.value=false;}
}
async function extractAudioBlob(clip:Clip):Promise<Blob>{
  const ac=new AudioContext();const ab=await(await fetch(clip.url)).arrayBuffer();const buf=await ac.decodeAudioData(ab);const sr=buf.sampleRate;const ss=Math.floor(clip.trimStart*sr);const es=Math.floor(clip.trimEnd*sr);const fr=es-ss;const nb=ac.createBuffer(buf.numberOfChannels,fr,sr);for(let ch=0;ch<buf.numberOfChannels;ch++){const sd=buf.getChannelData(ch);const dd=nb.getChannelData(ch);for(let i=0;i<fr;i++)dd[i]=sd[ss+i]||0;}await ac.close();return audioBufferToWav(nb);
}
function audioBufferToWav(buf:AudioBuffer):Blob{const nc=buf.numberOfChannels,sr=buf.sampleRate,dl=buf.length*nc*2,ab=new ArrayBuffer(44+dl),v=new DataView(ab);const ws=(o:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};ws(0,'RIFF');v.setUint32(4,36+dl,true);ws(8,'WAVE');ws(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,nc,true);v.setUint32(24,sr,true);v.setUint32(28,sr*nc*2,true);v.setUint16(32,nc*2,true);v.setUint16(34,16,true);ws(36,'data');v.setUint32(40,dl,true);let o=44;for(let i=0;i<buf.length;i++)for(let ch=0;ch<nc;ch++){const s=Math.max(-1,Math.min(1,buf.getChannelData(ch)[i]));v.setInt16(o,s<0?s*0x8000:s*0x7FFF,true);o+=2;}return new Blob([ab],{type:'audio/wav'});}
function applyTranscriptResult(){if(!aiResultRaw.value?.segments||!activeClip.value)return;const off=activeClip.value.offset;saveUndo();captions.value.push(...aiResultRaw.value.segments.map((s:any):Caption=>({id:newCaptionId(),text:s.text.trim(),start:s.start+off,end:s.end+off,position:'bottom',color:'#ffffff',size:'md'})));aiResult.value='';openInspector('caption');}
async function runTranslate(){
  if(!captions.value.length||!aiCfg.value.apiKey)return;
  aiLoading.value=true;aiTask.value='translate';aiResult.value='';
  try{
    const src=captions.value.map((c,i)=>`${i+1}|${c.text}`).join('\n');
    const langs:Record<string,string>={zh:'中文',en:'English',ja:'日本語',ko:'한국어',fr:'Français',de:'Deutsch',auto:'auto'};
    const txt=await aiRequest([{role:'system',content:`Translate subtitles${translateFrom.value!=='auto'?` from ${langs[translateFrom.value]}`:''} to ${langs[translateTo.value]}. Keep format: number|text. Output only translations.`},{role:'user',content:src}],{maxTokens:3000});
    aiResultRaw.value=txt;aiResult.value=txt.split('\n').map((l:string)=>{const m=l.match(/^(\d+)\|(.+)/);return m?`[${m[1]}] ${m[2]}`:l;}).join('\n');
  }catch(e:any){aiResult.value=`失败：${e.message}`;}finally{aiLoading.value=false;}
}
function applyTranslateResult(){if(!aiResultRaw.value)return;saveUndo();(aiResultRaw.value as string).split('\n').forEach((l:string)=>{const m=l.match(/^(\d+)\|(.+)/);if(m){const i=parseInt(m[1])-1;if(i>=0&&i<captions.value.length)captions.value[i].text=m[2].trim();}});aiResult.value='';}

// ─── 导出 ─────────────────────────────────────────
// 导出双通道：
//  1. 首选 WebCodecs（exportMp4）：逐帧渲染 + H.264/AAC 封装为 MP4，
//     全播放器兼容（修复「导出/录制的视频下载后播放不了」的反馈）；
//  2. 环境不支持时回退 MediaRecorder 实时录制 webm（Chrome/VLC 可播）。

const frameCache=new Map<string,HTMLVideoElement>();

/**
 * 导出画布上烧一条字幕（字号与落点与预览覆盖层同源，见 captionRender）。
 * 底板按文字宽度收拢，位置永远落在内容框内——竖屏导出时黑边里不该有字幕背景。
 */
function drawCaptionOnCanvas(ctx: CanvasRenderingContext2D, cap: Caption, box: FrameRect): void {
  const size = captionFontSize(box.h, cap.size as CaptionSizeKey);
  const y = captionBaseline(box, size, cap.position as CaptionPositionKey);
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const lines = String(cap.text).split('\n');
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const tx = box.x + box.w / 2;
  const lineH = Math.round(size * 1.25);
  const blockH = lineH * lines.length;
  // 底板以基线为锚向上铺开：bottom 时基线即下沿，top/center 时下沿随文字块
  const padX = Math.max(8, Math.round(size * 0.4));
  const padY = Math.max(4, Math.round(size * 0.18));
  const rectBottom = cap.position === 'top' ? y - size + padY : y + padY;
  ctx.fillStyle = 'rgba(0,0,0,.65)';
  ctx.fillRect(tx - tw / 2 - padX, rectBottom - blockH - padY, tw + padX * 2, blockH + padY * 2);
  ctx.fillStyle = cap.color;
  lines.forEach((l, i) => ctx.fillText(l, tx, y - (lines.length - 1 - i) * lineH));
}

/**
 * 渲染时间线指定时刻的一帧到导出画布（帧循环主体，从 startExport 抽出，
 * 供 WebCodecs 逐帧导出与 MediaRecorder 兜底通道共用；与预览渲染口径一致：
 * 滤镜/推镜/分屏/背景/裁剪/标注/字幕，且同样按导出画幅取景）。
 * @param ctx 导出画布 2d 上下文
 * @param gt 全局时间线时刻（秒）
 * @param W 画布宽（导出目标宽）
 * @param H 画布高（导出目标高）
 */
async function renderExportFrame(ctx:CanvasRenderingContext2D, gt:number, W:number, H:number){
  // 黑底先行：无片段、视频未就绪或画幅带黑边时，画布都必须是不透明底色
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const ci=findClipAt(gt);
  if(!ci)return;
  const c=clips.value[ci.g]; const lt=c.trimStart+(gt-c.offset)*c.speed;
  let vEl=frameCache.get(c.url);
  if(!vEl){vEl=document.createElement('video');vEl.src=c.url;vEl.muted=true;vEl.preload='auto';document.body.appendChild(vEl);await new Promise<void>(r=>{vEl!.onloadedmetadata=()=>r();});frameCache.set(c.url,vEl);}
  vEl.currentTime=lt; await new Promise<void>(r=>{vEl!.onseeked=()=>r();setTimeout(r,50);});
  // 视频元数据在 loadedmetadata 后可读；导出画布就是目标画幅，故 target 为整幅，
  // 只有「视频 → 画幅」这一层适配生效（与预览的两层取景口径一致）
  const layout = composeFrameLayout(vEl.videoWidth || W, vEl.videoHeight || H, W, H, W, H, exportSettings.fit, true);
  const splitOn = c.splitScreen.enabled && c.splitScreen.mode !== 'none' && !!c.splitScreen.partnerClipId;
  withFrameLayout(ctx, layout, (w, h) => {
    ctx.filter = filterString(c.filters);
    // ── Zoom（支持动画推镜：按导出帧时刻插值，绝不读预览时间）──
    if (c.zoom.enabled) {
      renderZoom(ctx, vEl as unknown as HTMLVideoElement, w, h, c.zoom, c, gt);
    }
    // ── SplitScreen：partner 要异步取帧，交给闭包外的合成，避免主画面先画一遍再被覆盖 ──
    else if (splitOn) {
      ctx.filter = 'none';
    }
    else if (c.background.type !== 'none') {
      applyBackground(ctx, vEl as unknown as HTMLVideoElement, w, h, c);
    } else if (c.crop.enabled) {
      applyCrop(ctx, vEl as unknown as HTMLVideoElement, w, h, c.crop);
    } else { ctx.drawImage(vEl as unknown as HTMLVideoElement, 0, 0, w, h); }
    ctx.filter = 'none';
  });
  if (splitOn) await renderExportSplitScreen(ctx, layout.content, c, vEl as unknown as HTMLVideoElement, gt);
  // 标注与字幕在画面（含分屏合成）之上
  withFrameLayout(ctx, { target: layout.target, content: layout.content }, (w, h) => {
    if (c.annotations.length > 0) renderAnnotations(ctx, w, h, c.annotations, gt - c.offset);
    const cap = captions.value.find((k) => gt >= k.start && gt < k.end);
    if (cap) drawCaptionOnCanvas(ctx, cap, { x: 0, y: 0, w, h });
  });
}

/**
 * 导出路径的分屏合成：partner 片段要先解码取帧（异步），无法塞进同步绘制闭包，
 * 故在闭包之后按同一取景框重画一次。
 */
async function renderExportSplitScreen(ctx: CanvasRenderingContext2D, box: FrameRect, c: Clip, mainEl: HTMLVideoElement, gt: number) {
  const pClip = clips.value.find((x) => x.id === c.splitScreen.partnerClipId);
  if (!pClip) return;
  let pEl = frameCache.get(pClip.url);
  if (!pEl) {
    pEl = document.createElement('video'); pEl.src = pClip.url; pEl.muted = true; pEl.preload = 'auto';
    document.body.appendChild(pEl);
    await new Promise<void>((r) => { pEl!.onloadedmetadata = () => r(); });
    frameCache.set(pClip.url, pEl);
  }
  const pLt = pClip.trimStart + (gt - pClip.offset) * pClip.speed;
  pEl.currentTime = Math.max(pClip.trimStart, Math.min(pLt, pClip.trimEnd));
  await new Promise<void>((r) => { pEl!.onseeked = () => r(); setTimeout(r, 50); });
  // 临时把 partner 挂到全局 ref 供 renderSplitScreen 使用
  const origPartner = partnerVideoEl.value;
  (partnerVideoEl as any).value = pEl;
  withFrameLayout(ctx, { target: box, content: box }, (w, h) => {
    ctx.filter = 'none';
    renderSplitScreen(ctx, mainEl, w, h, c, c.splitScreen);
  });
  (partnerVideoEl as any).value = origPartner;
}

/**
 * 构建导出音频混音（OfflineAudioContext 离线渲染，非实时，速度远快于播放时长）。
 * 混音对象：剪辑原声（音量/静音/裁剪区间）、背景音乐（循环截断）、配音片段；
 * 主音量经母带 gain 统一缩放。无任何音轨时返回 null（导出为无声视频）。
 * 单条音轨失败不阻断整条时间线，但必须进可见告警清单——否则用户拿到缺声成片才发现。
 * @param signal 取消信号：逐条音轨检查，abort 后抛出由导出入口收尾
 * @returns 混音结果 AudioBuffer；无音轨或渲染失败返回 null
 */
async function buildExportAudioMix(signal?:AbortSignal):Promise<AudioBuffer|null>{
  const dur=totalDuration.value;
  if(!dur||dur<=0)return null;
  /** 离线渲染采样率（与 AAC 常用采样率一致，避免重采样损耗） */
  const SR=48000;
  const off=new OfflineAudioContext(2,Math.max(1,Math.ceil(dur*SR)),SR);
  /** 母带 gain：主音量统一缩放出口 */
  const mg=off.createGain();mg.gain.value=masterVolume.value;mg.connect(off.destination);
  /** 是否成功挂接了至少一条音轨（全失败则按无声导出） */
  let anyTrack=false;
  // ── 剪辑原声 ──
  for(const clip of clips.value){
    if(clip.muted)continue;
    signal?.throwIfAborted();
    try{
      const ab=await(await fetch(clip.url)).arrayBuffer();
      const buf=await off.decodeAudioData(ab);
      const src=off.createBufferSource();src.buffer=buf;
      const g=off.createGain();g.gain.value=clip.volume/100;
      src.connect(g).connect(mg);
      const when=Math.max(0,clip.offset);
      if(when<dur){src.start(when,clip.trimStart,Math.min(clip.trimEnd-clip.trimStart,dur-when));anyTrack=true;}
    }catch(e){
      signal?.throwIfAborted();
      pushNotice('warning','导出音轨缺失',describeAudioTrackFailure('clip',clip.name,e));
    }
  }
  // ── 背景音乐（不足时长循环补齐） ──
  const bgFile=bgMusicFile.value;
  if(bgFile&&!bgMuted.value){
    signal?.throwIfAborted();
    try{
      // 直接读 Blob，不再造 object URL：此前每次导出都泄漏一个 URL 钉住整个音乐文件
      const ab=await bgFile.arrayBuffer();
      const buf=await off.decodeAudioData(ab);
      const src=off.createBufferSource();src.buffer=buf;
      const g=off.createGain();g.gain.value=bgVolume.value/100;
      src.connect(g).connect(mg);
      if(buf.duration>=dur)src.start(0,0,dur);else{src.loop=true;src.start(0);}
      anyTrack=true;
    }catch(e){
      signal?.throwIfAborted();
      pushNotice('warning','导出音轨缺失',describeAudioTrackFailure('bgm',bgFile.name,e));
    }
  }
  // ── 配音片段（优先用已解码缓存） ──
  for(const [i,dub] of dubClips.value.entries()){
    if(dub.muted)continue;
    signal?.throwIfAborted();
    try{
      let buf=audioBufferCache.get(dub.id);
      if(!buf){const ab=await(await fetch(dub.url)).arrayBuffer();buf=await off.decodeAudioData(ab);audioBufferCache.set(dub.id,buf);}
      const src=off.createBufferSource();src.buffer=buf;
      const g=off.createGain();g.gain.value=dub.volume/100;
      src.connect(g).connect(mg);
      const when=Math.max(0,dub.at);
      if(when<dur){src.start(when,0,Math.min(dub.duration,dur-when));anyTrack=true;}
    }catch(e){
      signal?.throwIfAborted();
      pushNotice('warning','导出音轨缺失',describeAudioTrackFailure('dub',`配音 ${i+1}`,e));
    }
  }
  if(!anyTrack)return null;
  signal?.throwIfAborted();
  try{
    return await off.startRendering();
  }catch(e){
    signal?.throwIfAborted();
    log.warn('离线混音渲染失败，按无声导出',e);
    pushNotice('warning','导出为无声视频',`离线混音渲染失败：${e instanceof Error?e.message:String(e)}`);
    return null;
  }
}

/**
 * WebCodecs 导出通道：逐帧渲染 + H.264/AAC 封装为 MP4（首选，全播放器兼容）。
 * @param W 输出宽
 * @param H 输出高
 * @param FPS 输出帧率
 * @param bitrate 输出视频码率 bps（导出预设给出）
 * @param signal 取消信号
 */
async function exportViaWebCodecs(W:number,H:number,FPS:number,bitrate:number,signal:AbortSignal){
  exportMsg.value='混音中…';
  log.info(`开始 WebCodecs 导出：${W}x${H}@${FPS}fps，${Math.round(bitrate/1e6*10)/10} Mbps，时长 ${totalDuration.value.toFixed(2)}s`);
  const mp4=await exportMp4({
    width:W,height:H,fps:FPS,
    durationSec:totalDuration.value,
    // 码率由导出预设决定（此前恒为编码器系数，选「省流」也压不下来）
    bitrate,
    // 逐帧渲染：复用与预览同口径的帧渲染函数
    drawFrame:async(canvas,t)=>{
      const ctx=canvas.getContext('2d');
      if(ctx)await renderExportFrame(ctx,t,W,H);
    },
    // 离线混音（无音轨返回 null → 无声视频）
    mixAudio:()=>buildExportAudioMix(signal),
    onProgress:(r)=>{
      exportPct.value=Math.round(r*100);
      exportMsg.value=`渲染 ${Math.round(r*100)}%`;
    },
    signal,
    // 降级为无声视频必须让用户知道，不能只写日志
    onWarning:(text)=>pushNotice('warning','导出降级',text),
  });
  signal.throwIfAborted();
  exportPct.value=100;exportMsg.value='完成！';
  triggerBlobDownload(mp4,`MediaPlus_${Date.now()}.mp4`);
  log.info('WebCodecs 导出完成（MP4）');
  await new Promise(r=>setTimeout(r,800));
}

/**
 * MediaRecorder 兜底导出通道（环境不支持 WebCodecs 时使用）：
 * 实时录制画布流 + 音轨为 webm（Chrome/VLC 可播；Windows 默认播放器兼容性差，
 * 故仅作为降级路径）。实时采集意味着导出耗时约等于片长，故必须可取消。
 * @param W 输出宽
 * @param H 输出高
 * @param FPS 输出帧率
 * @param bitrate 输出视频码率 bps（沿用导出预设，避免两条通道口径不同）
 * @param signal 取消信号
 */
async function exportViaMediaRecorder(W:number,H:number,FPS:number,bitrate:number,signal:AbortSignal){
  signal.throwIfAborted();
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('无法创建导出画布（2D 上下文不可用）');
  const ac=new AudioContext();
  /** 已调度的音源：取消/失败时逐个 stop，避免关不掉的活动音源 */
  const sources:AudioBufferSourceNode[]=[];
  let rec:MediaRecorder|null=null;
  let stream:MediaStream|null=null;
  try{
    const dest=ac.createMediaStreamDestination();
    const mg=ac.createGain();mg.gain.value=masterVolume.value;mg.connect(dest);
    exportMsg.value='加载音频…';
    /** 待调度音轨：先全部解码完再统一排期（见下方 t0 注释） */
    const pending:Array<{buf:AudioBuffer;when:number;offset:number;duration:number;gain:number;loop?:boolean}>=[];
    for(const clip of clips.value){
      if(clip.muted)continue;
      signal.throwIfAborted();
      try{
        const buf=await ac.decodeAudioData(await(await fetch(clip.url)).arrayBuffer());
        pending.push({buf,when:Math.max(0,clip.offset),offset:clip.trimStart,duration:Math.max(0,clip.trimEnd-clip.trimStart),gain:clip.volume/100});
      }catch(e){
        signal.throwIfAborted();
        pushNotice('warning','导出音轨缺失',describeAudioTrackFailure('clip',clip.name,e));
      }
    }
    const bgFile=bgMusicFile.value;
    const dur=totalDuration.value;
    if(bgFile&&!bgMuted.value){
      signal.throwIfAborted();
      try{
        const buf=await ac.decodeAudioData(await bgFile.arrayBuffer());
        pending.push({buf,when:0,offset:0,duration:dur,gain:bgVolume.value/100,loop:buf.duration<dur});
      }catch(e){
        signal.throwIfAborted();
        pushNotice('warning','导出音轨缺失',describeAudioTrackFailure('bgm',bgFile.name,e));
      }
    }
    for(const [i,dub] of dubClips.value.entries()){
      if(dub.muted)continue;
      signal.throwIfAborted();
      try{
        let buf=audioBufferCache.get(dub.id);
        if(!buf){buf=await ac.decodeAudioData(await(await fetch(dub.url)).arrayBuffer());audioBufferCache.set(dub.id,buf);}
        pending.push({buf,when:Math.max(0,dub.at),offset:0,duration:dub.duration,gain:dub.volume/100});
      }catch(e){
        signal.throwIfAborted();
        pushNotice('warning','导出音轨缺失',describeAudioTrackFailure('dub',`配音 ${i+1}`,e));
      }
    }
    signal.throwIfAborted();
    stream=new MediaStream([...canvas.captureStream(FPS).getTracks(),...dest.stream.getTracks()]);
    const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')?'video/webm;codecs=vp9,opus':'video/webm';
    rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:bitrate});
    const chunks:Blob[]=[];
    rec.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
    rec.start(200);
    // t0 必须在 rec.start() 之后、所有 src.start() 之前一次性取定。
    // 此前它在解码开始之前就取好，解码耗时让 t0 沦为过去时刻，Web Audio 会把全部音轨
    // 钳到"立即播放"，时间线偏移全丢 → 成片音画错位。
    const t0=ac.currentTime;
    for(const p of pending){
      const src=ac.createBufferSource();src.buffer=p.buf;
      const g=ac.createGain();g.gain.value=p.gain;
      src.connect(g).connect(mg);
      if(p.loop)src.loop=true;
      src.start(t0+p.when,p.offset,p.duration);
      sources.push(src);
    }
    const tf=Math.max(1,Math.ceil(dur*FPS));
    const startWall=performance.now();
    for(let f=0;f<tf;f++){
      signal.throwIfAborted();
      const gt=f/FPS;
      exportPct.value=f/tf*90;
      if(f%30===0)exportMsg.value=`渲染 ${fmtT(gt)} / ${fmtT(dur)}`;
      await renderExportFrame(ctx,gt,W,H);
      // 逐帧对齐墙钟：MediaRecorder 按真实时间采集画布流，
      // 渲染快于实时会让成片短于音轨（画面截尾），此前用一段盲等补尾并不解决这个问题。
      const delay=computeFrameDelay(startWall,f,FPS,performance.now());
      await new Promise(r=>setTimeout(r,delay));
    }
    signal.throwIfAborted();
    exportMsg.value='封装中…';exportPct.value=95;
    await stopMediaRecorder(rec);
    rec=null; // 已正常收尾，finally 不再重复 stop
    signal.throwIfAborted();
    const blob=new Blob(chunks,{type:mime});
    if(!blob.size)throw new Error('导出结果为空（画布流未产生任何数据）');
    exportPct.value=100;exportMsg.value='完成！';
    triggerBlobDownload(blob,`MediaPlus_${Date.now()}.webm`);
    log.warn('环境不支持 WebCodecs，已回退 MediaRecorder 导出（webm）');
    await new Promise(r=>setTimeout(r,800));
  }finally{
    for(const s of sources){try{s.stop();}catch{/* noop：尚未 start 或已结束 */}}
    if(rec&&rec.state!=='inactive'){try{rec.stop();}catch{/* noop */}}
    stream?.getTracks().forEach(t=>{try{t.stop();}catch{/* noop */}});
    try{await ac.close();}catch{/* noop */}
  }
}

/**
 * 导出入口：优先 WebCodecs MP4（全播放器兼容），不支持时回退 MediaRecorder webm。
 * 尺寸/帧率/码率全部来自导出预设（此前写死源宽高与 30fps，既出不了竖屏也压不下体积）。
 * 取消与失败都进常驻告警清单——此前失败文案只在遮罩里停 2.5 秒就被重置，用户根本来不及看。
 */
async function startExport(){
  if(!clips.value.length)return; if(isPlaying.value)pause();
  exportAbort=new AbortController();
  const signal=exportAbort.signal;
  exporting.value=true;exportCancelling.value=false;exportPct.value=0;exportMsg.value='准备中…';
  try{
    // 源尺寸以真正载入元数据的播放元素为准，面板的 sourceSize 只做展示
    const srcW = videoEl.value?.videoWidth || sourceSize.value.w || 1280;
    const srcH = videoEl.value?.videoHeight || sourceSize.value.h || 720;
    const size = resolveExportSize(srcW, srcH, exportSettings);
    const W = size.width, H = size.height, FPS = exportSettings.fps;
    const bitrate = estimateBitrateBps(W, H, FPS, exportSettings);
    log.info(`导出预设：${exportSummary.value}（源 ${srcW}×${srcH}）`);
    if(canUseWebCodecsExport()){
      await exportViaWebCodecs(W,H,FPS,bitrate,signal);
    }else{
      await exportViaMediaRecorder(W,H,FPS,bitrate,signal);
    }
  }catch(e){
    if(signal.aborted){
      log.info('用户取消导出');
      pushNotice('warning','导出已取消','未生成文件；时间线与素材保持不变，可重新导出');
    }else{
      log.error('导出失败',e);
      pushNotice('error','导出失败',e instanceof Error?e.message:String(e));
    }
  }finally{
    exporting.value=false;exportCancelling.value=false;exportPct.value=0;exportMsg.value='';exportAbort=null;
  }
}

function fmtT(s:number){if(!s||isNaN(s)||!isFinite(s)||s<0)return'0:00';const m=Math.floor(s/60),sec=Math.floor(s%60);return`${m}:${String(sec).padStart(2,'0')}`;}

onBeforeUnmount(()=>{
  // 防抖窗口内的最后一笔改动补写一次，再摘监听
  if(autosaveTimer){clearTimeout(autosaveTimer);autosaveTimer=null;}
  void flushAutosave();
  document.removeEventListener('visibilitychange',onPageHide);
  window.removeEventListener('beforeunload',onBeforeUnload);
  // 页面卸载时中断在跑的导出，让编码器/录制器走 finally 释放，而不是被硬生生掐断
  exportAbort?.abort();
  if(isPlaying.value)pause();stopLive();stopCanvasRaf();
  dubClips.value.forEach(d=>URL.revokeObjectURL(d.url));
  frameCache.forEach(v=>v.remove());frameCache.clear();
  if(dubTimer)clearInterval(dubTimer);if(levelRaf)cancelAnimationFrame(levelRaf);
  micStream?.getTracks().forEach(t=>t.stop());micACtx?.close();
  window.removeEventListener('message',onMsg);
});
</script>

<style scoped>
/* UI 三批·组4：编辑器并入 --sp-* 设计 token —— 原硬编码暗色/旧主色全部改引 tokens.css 变量：
   页面底色→var(--sp-color-bg)、面板底→var(--sp-color-bg-elevated)、
   主色→var(--sp-color-primary)、悬停深档与主色亮字→var(--sp-color-primary-hover)、
   logo/进度渐变副色→var(--sp-brand-violet)、
   旧主色 rgba 阴影与描边→var(--sp-color-primary-glow)、旧主色浅底→var(--sp-color-primary-light)。
   以下各替换点均遵循本映射，不再逐处重复注释。 */
/* ════ 基础 ════ */
*,*::before,*::after{box-sizing:border-box}
/* UI 三批·组4：并入 --sp-* 设计 token —— 背景/主色/字体改引 tokens.css 变量，
   编辑器与侧栏共用同一套色板（页面 html 已带 data-theme="dark"，变量解析为深色档） */
.app{display:flex;flex-direction:column;height:100vh;background:var(--sp-color-bg);font-family:var(--sp-font-family);font-size:12px;color:#c8cce0;overflow:hidden;outline:none;--accent:var(--sp-color-primary);--accent-dim:var(--sp-color-primary-light);--track-h:52px;--ctrl-h:160px}

/* ════ 顶栏 ════ */
.topbar{height:42px;background:var(--sp-color-bg-elevated);border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;padding:0 12px;gap:16px;flex-shrink:0;z-index:20}
.tb-l{display:flex;align-items:center;gap:8px;flex-shrink:0}
.logo{width:26px;height:26px;background:linear-gradient(135deg,var(--accent),var(--sp-brand-violet));border-radius:7px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px var(--sp-color-primary-glow)}
.app-name{font-size:13px;font-weight:700;color:#e8eaf5;letter-spacing:-.02em}
.proj-info{font-size:11px;color:rgba(255,255,255,.3);background:rgba(255,255,255,.06);border-radius:999px;padding:2px 9px}
.tb-tools{display:flex;align-items:center;gap:6px;flex:1;justify-content:center}
.tool-group{display:flex;background:rgba(255,255,255,.05);border-radius:8px;padding:3px;gap:2px;border:1px solid rgba(255,255,255,.07)}
.tb-tool{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:5px;background:transparent;border:none;color:rgba(255,255,255,.45);font-size:11px;font-weight:500;cursor:pointer;font-family:inherit;transition:all .12s}
.tb-tool:hover{color:rgba(255,255,255,.8)}
.tb-tool.on{background:var(--accent);color:white;box-shadow:0 2px 6px var(--sp-color-primary-glow)}
.undo-redo{display:flex;gap:3px}
.ur-btn{width:28px;height:28px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:rgba(255,255,255,.45);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .12s}
.ur-btn:hover:not(:disabled){color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.2)}
.ur-btn:disabled{opacity:.25;cursor:not-allowed}
.tb-r{display:flex;gap:6px;flex-shrink:0}
.tb-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.07);color:rgba(255,255,255,.7);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .12s}
.tb-btn:hover{background:rgba(255,255,255,.13);color:white}
.tb-btn--export{background:var(--accent);border-color:transparent;color:white;box-shadow:0 2px 8px var(--sp-color-primary-glow)}
.tb-btn--export:hover:not(:disabled){background:var(--sp-color-primary-hover);transform:translateY(-1px)}
.tb-btn--export:disabled{opacity:.4;cursor:not-allowed;transform:none}
.tb-btn--on{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
/* 导出预设面板：浮在顶栏下方，改完即生效并防抖落盘，无需"保存"按钮 */
.exp-set-wrap{position:relative}
.exp-panel{position:absolute;top:calc(100% + 8px);right:0;width:322px;background:var(--sp-color-bg-elevated);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px;box-shadow:0 12px 32px rgba(0,0,0,.5);z-index:60;display:flex;flex-direction:column;gap:7px}
.exp-row{display:flex;align-items:flex-start;gap:8px}
.exp-label{font-size:10px;color:rgba(255,255,255,.4);width:28px;flex-shrink:0;padding-top:4px}
.exp-seg{display:flex;flex-wrap:wrap;gap:3px}
.exp-chip{padding:3px 7px;border-radius:5px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:rgba(255,255,255,.55);font-size:10px;cursor:pointer;font-family:inherit;transition:all .1s}
.exp-chip:hover{background:rgba(255,255,255,.11);color:white}
.exp-chip.on{background:var(--accent-dim);border-color:var(--accent);color:var(--accent);font-weight:700}
.exp-custom{display:flex;align-items:center;gap:5px;font-size:10px;color:rgba(255,255,255,.55);cursor:pointer;padding-top:2px}
.exp-num{width:64px}
.exp-unit{font-size:10px;color:rgba(255,255,255,.35)}
.exp-sum{font-size:10px;color:var(--accent);font-weight:700;border-top:1px solid rgba(255,255,255,.07);margin-top:1px;padding:6px 0 0}
.exp-hint{font-size:9px;line-height:1.5;color:rgba(255,255,255,.3)}
.spin{width:11px;height:11px;border-radius:50%;border:1.5px solid rgba(255,255,255,.3);border-top-color:white;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}

/* ════ 可见问题清单（素材载入 / 导出降级与失败） ════ */
.notice-bar{flex-shrink:0;max-height:26vh;overflow-y:auto;background:var(--sp-color-bg-elevated);border-bottom:1px solid rgba(255,255,255,.08);padding:6px 12px;display:flex;flex-direction:column;gap:4px}
.notice-bar__item{display:flex;align-items:flex-start;gap:8px;font-size:11px;line-height:1.5;padding:4px 8px;border-radius:5px;border-left:2px solid transparent}
.notice-bar__item--error{background:var(--sp-color-danger-light);border-left-color:var(--sp-color-danger);color:#fca5a5}
.notice-bar__item--warning{background:var(--sp-color-warning-light);border-left-color:var(--sp-color-warning);color:#fcd34d}
.notice-bar__text{flex:1;min-width:0;word-break:break-word}
.notice-bar__text strong{font-weight:600;filter:brightness(1.15)}
.notice-bar__close{flex-shrink:0;width:18px;height:18px;border-radius:4px;border:none;background:transparent;color:inherit;opacity:.6;font-size:14px;line-height:1;cursor:pointer;font-family:inherit}
.notice-bar__close:hover{opacity:1;background:rgba(255,255,255,.1)}
.save-chip{font-size:10px;line-height:1;padding:4px 7px;border-radius:4px;white-space:nowrap;color:var(--sp-color-muted);background:rgba(255,255,255,.05)}
.save-chip--pending{color:var(--sp-color-text-secondary)}
.save-chip--failed{color:#fca5a5;background:var(--sp-color-danger-light)}
.recover-bar{flex-shrink:0;display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:11px;line-height:1.5;background:var(--sp-color-primary-light);border-bottom:1px solid var(--sp-color-primary-glow);color:var(--sp-color-text-secondary)}
.recover-bar__text{flex:1;min-width:0}
.recover-bar__btn{flex-shrink:0;padding:5px 12px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:transparent;color:inherit;font-size:11px;font-family:inherit;cursor:pointer}
.recover-bar__btn:hover:not(:disabled){background:rgba(255,255,255,.08)}
.recover-bar__btn--primary{background:var(--sp-color-primary);border-color:var(--sp-color-primary);color:#fff}
.recover-bar__btn--primary:hover:not(:disabled){background:var(--sp-color-primary-hover)}
.recover-bar__btn:disabled{opacity:.55;cursor:default}

/* ════ 主区域 ════ */
.main{display:flex;flex:1;min-height:0;overflow:hidden}

/* ════ 预览 ════ */
.pane-preview{display:flex;flex-direction:column;width:38%;min-width:200px;max-width:65%;border-right:1px solid rgba(255,255,255,.07);flex-shrink:0}
.screen{flex:1;min-height:0;background:#07070e;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}
.drop-hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.drop-label{display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px;cursor:pointer;color:rgba(255,255,255,.3);text-align:center;border:2px dashed rgba(255,255,255,.1);border-radius:16px;margin:16px;transition:all .15s}
.drop-label:hover{border-color:var(--sp-color-primary-glow);color:rgba(255,255,255,.6)}
.drop-label span{font-size:13px;font-weight:500}
.drop-sub{font-size:11px;opacity:.6}
.vid{width:100%;height:100%;object-fit:contain}
.cap-overlay{position:absolute;left:50%;transform:translateX(-50%);padding:5px 14px;background:rgba(0,0,0,.7);border-radius:5px;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.9);white-space:pre-wrap;text-align:center;max-width:90%}
.cap-bottom{bottom:12px}.cap-top{top:12px}.cap-center{top:50%;transform:translate(-50%,-50%)}
.tc-overlay{position:absolute;top:8px;left:10px;font-size:11px;font-family:monospace;font-weight:600;color:rgba(255,255,255,.6);background:rgba(0,0,0,.5);padding:2px 8px;border-radius:4px}
.resizer{width:4px;background:transparent;cursor:ew-resize;flex-shrink:0;transition:background .15s;z-index:5}
.resizer:hover{background:var(--sp-color-primary-glow)}

/* 控件 */
.controls{flex-shrink:0;background:#141520;padding:8px 12px;display:flex;flex-direction:column;gap:6px}
.ctrl-btns{display:flex;align-items:center;justify-content:center;gap:4px}
.cb{width:28px;height:28px;border-radius:7px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .12s}
.cb:hover{background:var(--sp-color-primary-light);border-color:var(--sp-color-primary-glow);color:var(--sp-color-primary-hover)}
.cb--play{width:34px;height:34px;border-radius:50%;background:var(--accent)!important;border-color:transparent!important;color:white!important;box-shadow:0 2px 10px var(--sp-color-primary-glow)}
.cb--play:hover{background:var(--sp-color-primary-hover)!important;transform:scale(1.05)}
.progress-row{display:flex;align-items:center;gap:6px}
.tc{font-size:11px;font-family:monospace;font-weight:600;color:#c8cce0;flex-shrink:0}
.tc.dim{color:rgba(255,255,255,.3)}
.seek{flex:1;height:4px;cursor:pointer;accent-color:var(--accent)}
.ctrl-row2{display:flex;align-items:center;justify-content:space-between}
.vol-group{display:flex;align-items:center;gap:5px;color:rgba(255,255,255,.4)}
.vol{width:64px;height:3px;accent-color:var(--accent);cursor:pointer}
.speed-tag{font-size:11px;font-weight:700;color:var(--accent);background:var(--accent-dim);border:1px solid var(--sp-color-primary-glow);border-radius:999px;padding:2px 8px;cursor:pointer;transition:all .12s}
.speed-tag:hover{background:var(--accent);color:white}

/* ════ 右侧 ════ */
.pane-right{flex:1;min-width:0;display:flex;flex-direction:row;overflow:hidden;position:relative}

/* ════ Inspector ════ */
.inspector{width:240px;flex-shrink:0;height:100%;background:var(--sp-color-bg-elevated);border-left:1px solid rgba(255,255,255,.07);z-index:15;display:flex;flex-direction:column;box-shadow:-4px 0 20px rgba(0,0,0,.4);overflow:hidden}
.ins-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#141520;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;font-size:11px;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.06em}
.ins-close{background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:16px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:all .12s}
.ins-close:hover{background:rgba(255,255,255,.1);color:white}
.ins-body{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:0}
.ins-body::-webkit-scrollbar{width:4px}
.ins-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
.ins-group{margin-bottom:12px}
.ig-label{display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.3);margin-bottom:5px}
.ig-val{font-size:10px;font-family:monospace;color:var(--accent);font-weight:600;text-transform:none;letter-spacing:0}
.ig-input{width:100%;height:26px;padding:0 8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:5px;color:#e2e4f0;font-size:11px;font-family:inherit;outline:none}
.ig-input:focus{border-color:var(--accent)}
.ig-num{width:60px;height:24px;padding:0 5px;text-align:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#e2e4f0;font-size:11px;font-family:inherit;outline:none}
.ig-ta{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:5px;color:#e2e4f0;font-size:11px;font-family:inherit;padding:6px 8px;resize:vertical;outline:none}
.ig-sel{height:24px;padding:0 5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#e2e4f0;font-size:11px;font-family:inherit;outline:none;cursor:pointer}
.ig-col{width:24px;height:24px;padding:1px;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:rgba(255,255,255,.06);cursor:pointer}
.ig-slider{width:100%;height:3px;cursor:pointer;accent-color:var(--accent)}
.ig-mute{width:24px;height:24px;border-radius:4px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);cursor:pointer;font-size:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.ig-row{display:flex;align-items:center;gap:4px}
.ig-field{display:flex;align-items:center;gap:3px}
.ig-tag{font-size:9px;font-weight:700;color:var(--accent);background:var(--accent-dim);border-radius:3px;padding:1px 4px}
.ig-arr{color:rgba(255,255,255,.3);font-size:12px}
.ig-dur{font-size:11px;font-family:monospace;color:var(--accent);background:var(--accent-dim);border-radius:999px;padding:1px 7px;margin-left:4px}
.ig-btns{display:flex;gap:4px;flex-wrap:wrap}
.ig-btn{display:inline-flex;align-items:center;gap:3px;padding:4px 8px;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:rgba(255,255,255,.06);color:rgba(255,255,255,.65);font-size:11px;cursor:pointer;font-family:inherit;transition:all .12s;white-space:nowrap}
.ig-btn:hover{background:rgba(255,255,255,.12);color:white}
.ig-btn--primary{background:var(--accent);border-color:transparent;color:white}
.ig-btn--primary:hover:not(:disabled){background:var(--sp-color-primary-hover)}
.ig-btn--danger{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.25);color:#ef4444}
.ig-btn--danger:hover{background:#ef4444;color:white;border-color:transparent}
.ig-btn:disabled{opacity:.4;cursor:not-allowed}
.spd-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:2px}
.spd-btn{padding:4px 2px;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.55);font-size:10px;text-align:center;cursor:pointer;font-family:inherit;transition:all .12s}
.spd-btn.on{border-color:var(--accent);background:var(--accent-dim);color:var(--accent);font-weight:600}
.pre-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}
.pre-btn{padding:4px 2px;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.55);font-size:10px;text-align:center;cursor:pointer;font-family:inherit;transition:all .12s}
.pre-btn.on{border-color:var(--accent);background:var(--accent-dim);color:var(--accent)}
.pre-btn:hover:not(.on){background:rgba(255,255,255,.1)}
.ins-slider-row{display:flex;align-items:center;gap:5px;margin-bottom:5px}
.isr-l{font-size:10px;color:rgba(255,255,255,.35);min-width:32px}
.isr-r{font-size:10px;font-family:monospace;color:rgba(255,255,255,.6);min-width:32px;text-align:right;flex-shrink:0}
.isr-rst{background:none;border:none;cursor:pointer;color:rgba(255,255,255,.25);font-size:12px;transition:color .12s}
.isr-rst:hover{color:var(--accent)}
.cap-list{display:flex;flex-direction:column;gap:2px;max-height:130px;overflow-y:auto}
.cap-row{display:flex;align-items:center;gap:4px;padding:4px 6px;background:rgba(255,255,255,.04);border-radius:4px;border:1px solid rgba(255,255,255,.06)}
.cap-row.on{border-color:var(--accent);background:var(--accent-dim)}
.cap-tc{font-size:10px;font-family:monospace;color:var(--accent);flex-shrink:0}
.cap-txt{font-size:10px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,.65)}
.cap-ic{width:18px;height:18px;border-radius:3px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:rgba(255,255,255,.4);cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;transition:all .1s}
.cap-ic.del:hover{background:rgba(239,68,68,.15);color:#ef4444}
.ins-file-zone{display:flex;align-items:center;justify-content:center;padding:10px;border:1px dashed rgba(255,255,255,.12);border-radius:6px;cursor:pointer;font-size:11px;color:rgba(255,255,255,.3);transition:all .12s}
.ins-file-zone:hover{border-color:var(--accent);color:var(--accent)}
.ig-unit{font-size:9px;color:rgba(255,255,255,.35)}
.srt-file-zone{margin-top:5px;padding:7px}
.srt-report{font-size:9px;line-height:1.5;color:var(--accent);margin:6px 0 0;word-break:break-all}
.srt-report--hint{color:rgba(255,255,255,.3)}
.mic-hint{background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:6px;padding:8px;margin-bottom:8px}
.mic-hint p{font-size:11px;color:#d97706;margin:0 0 6px}
.dub-ctrl-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.dub-rec-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1px solid rgba(239,68,68,.3);border-radius:6px;background:rgba(239,68,68,.08);color:#ef4444;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .12s}
.dub-rec-btn.recording{background:#ef4444;color:white;border-color:transparent;animation:pulse .8s ease infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.3)}50%{box-shadow:0 0 0 6px rgba(239,68,68,0)}}
/* UI 三批·组3：录制指示点由 0.6s 硬闪烁改为 1.2s ease-in-out 平滑呼吸渐变，透明度下限 0.35 */
.rec-dot{width:8px;height:8px;border-radius:50%;background:white;animation:rec-dot-fade 1.2s ease-in-out infinite}
@keyframes rec-dot-fade{0%,100%{opacity:1}50%{opacity:.35}}
.dub-pos{font-size:10px;color:rgba(255,255,255,.35)}
.level-bar{height:4px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden}
.lv-fill{height:100%;background:linear-gradient(90deg,#10b981,#f59e0b);border-radius:999px;transition:width .05s}
.ins-audio{width:100%;height:24px;margin-top:6px}
.ai-no-key{display:flex;flex-direction:column;align-items:center;gap:6px;padding:20px 0;text-align:center;color:rgba(255,255,255,.35)}
.ai-no-key p{margin:0;font-size:12px}
.ai-nk-sub{font-size:10px;color:rgba(255,255,255,.25)}
.pch-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;margin-top:5px}
.pch-btn{padding:4px 2px;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.55);font-size:10px;text-align:center;cursor:pointer;font-family:inherit;transition:all .12s}
.pch-btn:hover{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
.ai-result{background:var(--sp-color-primary-light);border:1px solid var(--sp-color-primary-light);border-radius:6px;padding:8px}
.air-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;font-size:10px;font-weight:700;color:var(--accent)}
.air-txt{font-size:10px;font-family:monospace;color:rgba(255,255,255,.7);white-space:pre-wrap;line-height:1.6;max-height:120px;overflow-y:auto;margin:0}
.ai-loading{display:flex;align-items:center;gap:7px;padding:8px 0;font-size:11px;color:rgba(255,255,255,.4)}

/* ════ 时间轴区域 ════ */
.timeline-area{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;background:var(--sp-color-bg);overflow:hidden}

/* 时间轴工具栏 */
.tl-bar{height:36px;background:var(--sp-color-bg-elevated);border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between;padding:0 10px;flex-shrink:0;gap:6px}
.tl-bar-l,.tl-bar-r{display:flex;align-items:center;gap:4px}
.tl-sep{width:1px;height:14px;background:rgba(255,255,255,.1);margin:0 4px}
.tl-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid transparent;border-radius:5px;background:transparent;color:rgba(255,255,255,.4);font-size:11px;font-weight:500;cursor:pointer;font-family:inherit;transition:all .12s;height:26px}
.tl-btn:hover:not(:disabled){background:rgba(255,255,255,.07);color:rgba(255,255,255,.8)}
.tl-btn.on{background:var(--accent-dim);border-color:var(--sp-color-primary-glow);color:var(--sp-color-primary-hover)}
.tl-btn--danger:not(:disabled){color:rgba(239,68,68,.7)}
.tl-btn--danger:hover:not(:disabled){background:rgba(239,68,68,.12);color:#ef4444}
.tl-btn:disabled{opacity:.3;cursor:not-allowed}
.tl-tip{font-size:11px;color:rgba(255,255,255,.25);flex:1;text-align:center}
.tl-tip--cut{color:rgba(245,158,11,.7)}
.tl-icon-btn{width:28px;height:28px;border-radius:5px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:rgba(255,255,255,.4);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;font-weight:600;transition:all .12s}
.tl-icon-btn:hover{color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.2)}
.tl-icon-btn.on{background:var(--accent-dim);border-color:var(--sp-color-primary-glow);color:var(--sp-color-primary-hover)}
.zoom-btn{width:24px;height:24px;border-radius:5px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:rgba(255,255,255,.4);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;font-weight:600;transition:all .12s}
.zoom-btn:hover{color:rgba(255,255,255,.9);border-color:rgba(255,255,255,.2)}

/* ════ 时间轴主体 (Grid: 控制列 | 滚动内容) ════ */
.tl-main{flex:1;min-height:0;display:grid;grid-template-columns:72px 1fr;overflow:hidden;min-width:0}

/* 轨道控制列 */
.track-controls{grid-column:1;display:flex;flex-direction:column;background:var(--sp-color-bg-elevated);border-right:1px solid rgba(255,255,255,.07);overflow:hidden;z-index:5}
.tc-ruler-spacer{height:28px;background:#1d1e2c;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0}
.track-ctrl{display:flex;flex-direction:column;justify-content:center;padding:0 6px;height:var(--track-h);border-bottom:1px solid rgba(255,255,255,.05);gap:4px}
.track-ctrl--video{background:#1d2240}
.track-ctrl--audio{background:#1a2830}
.track-ctrl--caption{background:#221d2e}
.tc-label{font-size:10px;font-weight:700;color:rgba(255,255,255,.5);letter-spacing:.05em}
.tc-icons{display:flex;gap:3px}
.tc-ic{width:18px;height:18px;border-radius:3px;background:rgba(255,255,255,.06);border:none;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;opacity:.45;transition:all .12s}
.tc-ic:hover{opacity:1}
.tc-ic.on{opacity:1;background:var(--sp-color-primary-light)}

/* 滚动内容区 */
.tl-scroll-area{grid-column:2;overflow-x:auto;overflow-y:hidden;display:flex;flex-direction:column;position:relative;min-width:0}
.tl-scroll-area::-webkit-scrollbar{height:5px}
.tl-scroll-area::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}

/* 刻度尺 */
.ruler{height:28px;position:relative;background:#1d1e2c;border-bottom:1px solid rgba(255,255,255,.07);cursor:pointer;flex-shrink:0;user-select:none}
.ruler.cursor-cut{cursor:col-resize}
.tick{position:absolute;top:0}
.tick-line{width:1px;background:rgba(255,255,255,.15);height:5px}
.tick-major{height:9px;background:rgba(255,255,255,.35)}
.tick-lbl{position:absolute;top:10px;left:3px;font-size:10px;color:rgba(255,255,255,.45);font-family:monospace;white-space:nowrap}

/* 播放头 */
.playhead{position:absolute;top:0;z-index:30;pointer-events:none;transform:translateX(-50%)}
.ph-triangle{width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid #ef4444;margin:0 auto}
.ph-vline{position:absolute;width:2px;background:#ef4444;opacity:.9;z-index:25;pointer-events:none;transform:translateX(-50%);top:28px}
.snap-line{position:absolute;top:0;width:2px;background:var(--sp-color-primary);height:100%;z-index:20;pointer-events:none}
.split-cursor{position:absolute;top:0;bottom:0;width:2px;background:rgba(245,158,11,.8);z-index:26;pointer-events:none;transform:translateX(-50%)}
.split-tc{position:absolute;bottom:calc(100% + 2px);left:50%;transform:translateX(-50%);font-size:10px;color:#f59e0b;background:#1d1e2c;padding:1px 5px;border-radius:3px;white-space:nowrap;font-family:monospace}

/* 轨道行 */
.track{position:relative;height:var(--track-h);flex-shrink:0;user-select:none}
.track--video{background:rgba(59,130,246,.05);border-bottom:1px solid rgba(255,255,255,.05)}
.track--audio{background:rgba(16,185,129,.05);border-bottom:1px solid rgba(255,255,255,.05)}
.track--caption{background:rgba(245,158,11,.04)}
.track--locked{pointer-events:none;opacity:.6}
.track-split-line{position:absolute;top:0;bottom:0;width:2px;background:rgba(245,158,11,.8);pointer-events:none;transform:translateX(-50%);z-index:10}
.track-empty-lbl{display:flex;align-items:center;justify-content:center;height:100%;font-size:11px;color:rgba(255,255,255,.2);cursor:pointer;gap:4px;transition:color .12s}
.track-empty-lbl:hover{color:rgba(255,255,255,.5)}

/* 片段 — 核心视觉 */
.seg{position:absolute;top:5px;bottom:5px;border-radius:6px;display:flex;align-items:stretch;overflow:hidden;cursor:grab;min-width:24px;background:var(--sc,#3b82f6);border:1.5px solid rgba(255,255,255,.2);transition:box-shadow .1s,border-color .1s}
.seg:active{cursor:grabbing}
.seg--active{border-color:rgba(255,255,255,.9)!important;box-shadow:0 0 0 2px #ef4444,0 2px 12px rgba(0,0,0,.5)!important;z-index:6}
.seg--hover:not(.seg--active){filter:brightness(1.15);z-index:5}
.seg--muted{opacity:.45;filter:grayscale(.5)}
.seg--locked{cursor:not-allowed}
.seg--bgm{left:0!important;width:100%!important;background:linear-gradient(135deg,rgba(16,185,129,.6),rgba(5,150,105,.5));border-color:rgba(16,185,129,.3);cursor:default;top:5px;bottom:5px}
.seg--dub{background:linear-gradient(135deg,var(--sp-color-primary),var(--sp-brand-violet));border-color:var(--sp-color-primary-glow);top:5px;bottom:5px}
.seg--caption{background:linear-gradient(135deg,rgba(245,158,11,.6),rgba(251,191,36,.5));border-color:rgba(245,158,11,.35);cursor:pointer;top:6px;bottom:6px;border-radius:4px}
.seg-cap-txt{font-size:10px;color:white;padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;align-self:center;text-shadow:0 1px 2px rgba(0,0,0,.7)}
.seg-body{display:flex;align-items:center;gap:5px;padding:0 12px;color:white;flex:1;overflow:hidden;min-width:0;position:relative}
.seg-waveform{position:absolute;inset:0;width:100%;height:100%;opacity:.6}
.seg-name{position:relative;font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;text-shadow:0 1px 3px rgba(0,0,0,.7)}
.seg-dur{position:relative;font-size:10px;opacity:.75;flex-shrink:0;font-family:monospace}

/* 裁剪手柄 */
.trim-l,.trim-r{width:10px;flex-shrink:0;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;cursor:ew-resize;z-index:3;transition:background .1s}
.trim-l{border-radius:6px 0 0 6px}
.trim-r{border-radius:0 6px 6px 0}
.trim-l:hover,.trim-r:hover{background:rgba(255,255,255,.55)}
.trim-l span,.trim-r span{font-size:10px;color:rgba(255,255,255,.8);letter-spacing:-1px;user-select:none}

/* 悬停操作栏 */
.seg-hbar{position:absolute;top:50%;right:8px;transform:translateY(-50%);display:flex;gap:3px;z-index:10}
.shb{width:20px;height:20px;border-radius:4px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.2);color:white;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);transition:all .1s}
.shb:hover{background:rgba(0,0,0,.8)}
.shb.del:hover{background:rgba(239,68,68,.8)}

/* 拖拽标签 */
.drag-lbl{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);background:#ef4444;color:white;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;font-family:monospace;white-space:nowrap;z-index:50;pointer-events:none}

/* 标记点 */
.marker{position:absolute;top:0;bottom:0;z-index:12;pointer-events:none;transform:translateX(-50%)}
.marker-line{width:1.5px;height:100%;background:rgba(16,185,129,.8)}
.marker-lbl{position:absolute;top:2px;left:3px;font-size:9px;color:#10b981;white-space:nowrap;font-family:monospace}

/* ════ 右键菜单 ════ */
.ctx-menu{position:fixed;z-index:9999;min-width:160px;background:#1e2030;border:1px solid rgba(255,255,255,.1);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.6);padding:5px}
.ctx-hd{font-size:10px;font-weight:700;color:rgba(255,255,255,.3);padding:4px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase;letter-spacing:.05em}
.ctx-sep{height:1px;background:rgba(255,255,255,.07);margin:3px 0}
.ctx-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:transparent;color:rgba(255,255,255,.7);font-size:11px;cursor:pointer;font-family:inherit;border-radius:6px;transition:all .1s;text-align:left}
.ctx-item:hover:not(:disabled){background:var(--accent-dim);color:var(--sp-color-primary-hover)}
.ctx-del{color:rgba(239,68,68,.8)}
.ctx-del:hover:not(:disabled){background:rgba(239,68,68,.12)!important;color:#ef4444!important}
.ctx-item:disabled{opacity:.35;cursor:not-allowed}

/* ════ 导出 ════ */
.export-mask{position:fixed;inset:0;background:rgba(7,7,14,.9);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;z-index:100}
.export-card{background:var(--sp-color-bg-elevated);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:36px 48px;display:flex;flex-direction:column;align-items:center;gap:16px;min-width:280px;box-shadow:0 4px 40px rgba(0,0,0,.8)}
.export-spin{width:48px;height:48px;border-radius:50%;border:3px solid rgba(255,255,255,.1);border-top-color:var(--accent);animation:spin .8s linear infinite}
.export-title{font-size:16px;font-weight:700;color:#e8eaf5}
.export-sub{font-size:12px;color:rgba(255,255,255,.4);text-align:center}
.export-track{width:200px;height:5px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden}
.export-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--sp-brand-violet));border-radius:999px;transition:width .15s}
.export-pct{font-size:14px;font-weight:700;color:var(--accent);font-family:monospace}
.export-cancel{margin-top:4px;padding:7px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:rgba(255,255,255,.65);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .12s}
.export-cancel:hover:not(:disabled){background:var(--sp-color-danger-light);border-color:var(--sp-color-danger);color:#fca5a5}
.export-cancel:disabled{opacity:.45;cursor:progress}
/* ── 新功能 CSS ── */
/* vid 隐藏（canvas 作为预览） */
.vid-hidden { display:none!important; }
.preview-canvas { width:100%; height:100%; object-fit:contain; display:block; background:#07070e; }

/* Inspector tabs */
.ins-tabs { display:flex; gap:1px; padding:4px 6px; background:#12131a; border-bottom:1px solid rgba(255,255,255,.07); flex-shrink:0; flex-wrap:wrap; }
.ins-tab { flex:1; padding:4px 6px; border:1px solid transparent; border-radius:5px; background:transparent; color:rgba(255,255,255,.4); font-size:10px; font-weight:600; cursor:pointer; font-family:inherit; text-align:center; transition:all .12s; white-space:nowrap; }
.ins-tab:hover { color:rgba(255,255,255,.75); }
.ins-tab.on { background:var(--accent-dim); border-color:var(--sp-color-primary-glow); color:var(--sp-color-primary-hover); }

/* 速度面板 */
.speed-info { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); border-radius:7px; padding:8px 10px; display:flex; flex-direction:column; gap:5px; }
.si-row { display:flex; justify-content:space-between; font-size:11px; color:rgba(255,255,255,.55); }
.si-row.slow .si-row span:last-child { color:#06b6d4; }
.si-row.fast .si-row span:last-child { color:#f59e0b; }

/* Zoom 选区 */
.zoom-editor-overlay { position:absolute; inset:0; cursor:crosshair; }
.zoom-box { position:absolute; border:2px solid #f59e0b; border-radius:4px; box-shadow:0 0 0 1px rgba(0,0,0,.5), inset 0 0 0 1px rgba(245,158,11,.3); cursor:move; }
.zoom-label { position:absolute; top:2px; left:4px; font-size:10px; font-weight:700; color:#f59e0b; text-shadow:0 1px 3px rgba(0,0,0,.9); }
.zoom-handle { position:absolute; width:10px; height:10px; background:#f59e0b; border-radius:50%; cursor:nwse-resize; }
.zoom-handle--tl { top:-5px; left:-5px; }
.zoom-handle--tr { top:-5px; right:-5px; }
.zoom-handle--bl { bottom:-5px; left:-5px; }
.zoom-handle--br { bottom:-5px; right:-5px; cursor:se-resize; }
.zoom-scale-presets { display:flex; gap:3px; margin-top:5px; flex-wrap:wrap; }
.zoom-controls .ins-group { margin-bottom:10px; }

/* Toggle switch */
.feat-toggle-row { display:flex; align-items:center; justify-content:space-between; }
.feat-toggle-row > span { font-size:12px; font-weight:600; color:rgba(255,255,255,.75); }
.toggle-sw { width:34px; height:18px; border-radius:999px; background:rgba(255,255,255,.12); cursor:pointer; position:relative; transition:background .2s; flex-shrink:0; }
.toggle-sw.on { background:var(--accent); }
.toggle-knob { position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:white; transition:left .2s; }
.toggle-sw.on .toggle-knob { left:18px; }

/* 提示文字 */
.ins-hint { font-size:10px; color:rgba(255,255,255,.3); line-height:1.5; margin:4px 0; }

/* 分屏模式选择 */
.split-mode-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:5px; }
.split-mode-btn { display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 4px; border:1px solid rgba(255,255,255,.1); border-radius:7px; background:rgba(255,255,255,.04); color:rgba(255,255,255,.5); font-size:10px; cursor:pointer; font-family:inherit; transition:all .12s; }
.split-mode-btn:hover { background:rgba(255,255,255,.09); color:rgba(255,255,255,.8); }
.split-mode-btn.on { border-color:var(--accent); background:var(--accent-dim); color:var(--sp-color-primary-hover); }
.smb-icon { display:flex; align-items:center; }

/* 画中画位置 */
.pip-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:3px; }
.pip-btn { padding:5px 4px; border:1px solid rgba(255,255,255,.1); border-radius:4px; background:rgba(255,255,255,.04); color:rgba(255,255,255,.5); font-size:10px; text-align:center; cursor:pointer; font-family:inherit; transition:all .12s; }
.pip-btn.on { border-color:var(--accent); background:var(--accent-dim); color:var(--sp-color-primary-hover); }


/* 推镜面板 */
.zoom-target-box { background:rgba(245,158,11,.07); border:1px solid rgba(245,158,11,.2); border-radius:8px; padding:10px; margin-bottom:8px; }
.ztb-label { display:flex; justify-content:space-between; align-items:center; font-size:11px; font-weight:600; color:rgba(245,158,11,.9); margin-bottom:4px; }
.zoom-presets-row { display:flex; gap:3px; flex-wrap:wrap; }
.zpr-btn { padding:4px 8px; border:1px solid rgba(255,255,255,.1); border-radius:4px; background:rgba(255,255,255,.05); color:rgba(255,255,255,.55); font-size:11px; cursor:pointer; font-family:inherit; transition:all .12s; }
.zpr-btn.on,.zpr-btn:hover { border-color:var(--accent); background:var(--accent-dim); color:var(--sp-color-primary-hover); }
.anim-section { background:var(--sp-color-primary-light); border:1px solid var(--sp-color-primary-light); border-radius:8px; padding:10px; margin-bottom:8px; }
.anim-sec-title { font-size:11px; font-weight:700; color:var(--sp-color-primary); margin-bottom:8px; }
.anim-dur-row { display:flex; gap:3px; flex-wrap:wrap; margin-top:4px; }
.easing-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:3px; }
.easing-btn { padding:5px 2px; border:1px solid rgba(255,255,255,.1); border-radius:4px; background:rgba(255,255,255,.04); color:rgba(255,255,255,.5); font-size:10px; text-align:center; cursor:pointer; font-family:inherit; transition:all .12s; }
.easing-btn.on { border-color:var(--accent); background:var(--accent-dim); color:var(--sp-color-primary-hover); }
.zoom-preview-btns { display:flex; gap:6px; }
.zoom-state-info { display:flex; justify-content:space-between; align-items:center; padding:5px 8px; background:rgba(255,255,255,.04); border-radius:5px; font-size:11px; color:rgba(255,255,255,.4); }

/* 分屏面板 */
.pip-size-row { display:flex; flex-direction:column; gap:4px; }
.pip-corner-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:3px; margin-top:5px; }

/* ─── 背景面板 ─── */
.bg-type-tabs{display:flex;gap:2px;background:rgba(255,255,255,.05);border-radius:7px;padding:3px}
.bg-type-btn{flex:1;padding:4px;border:none;border-radius:5px;background:transparent;color:rgba(255,255,255,.45);font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .12s}
.bg-type-btn:hover{color:rgba(255,255,255,.8)}
.bg-type-btn.on{background:var(--accent);color:white}
.bg-color-row{display:flex;align-items:center;gap:8px;margin-top:5px}
.bg-color-pick{width:40px;height:32px;padding:2px;border:1px solid rgba(255,255,255,.15);border-radius:6px;background:rgba(255,255,255,.06);cursor:pointer}
.bg-presets{display:flex;gap:4px;flex-wrap:wrap}
.bg-preset-dot{width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid rgba(255,255,255,.15);transition:transform .1s}
.bg-preset-dot:hover{transform:scale(1.2);border-color:white}
.bg-gradient-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px}
.bg-grad-dot{height:28px;border-radius:5px;cursor:pointer;border:1px solid rgba(255,255,255,.1);transition:transform .1s}
.bg-grad-dot:hover{transform:scale(1.05)}

/* ─── 裁剪面板 ─── */
.crop-presets{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px}
.crop-preset-btn{padding:4px 8px;border:1px solid rgba(255,255,255,.12);border-radius:4px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.6);font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .12s}
.crop-preset-btn:hover{background:var(--accent-dim);border-color:var(--accent);color:var(--sp-color-primary-hover)}
.crop-overlay{position:absolute;inset:0;pointer-events:none}
.crop-box{position:absolute;border:2px solid rgba(255,255,255,.8);box-shadow:0 0 0 9999px rgba(0,0,0,.55);cursor:move}
.crop-handle{position:absolute;width:10px;height:10px;background:white;border-radius:2px;cursor:nwse-resize}
.crop-handle--tl{top:-5px;left:-5px;cursor:nw-resize}
.crop-handle--tr{top:-5px;right:-5px;cursor:ne-resize}
.crop-handle--bl{bottom:-5px;left:-5px;cursor:sw-resize}
.crop-handle--br{bottom:-5px;right:-5px;cursor:se-resize}

/* ─── 标注面板 ─── */
.annot-types{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:8px}
.annot-type-btn{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;border:1px solid rgba(255,255,255,.1);border-radius:6px;background:rgba(255,255,255,.04);color:rgba(255,255,255,.55);font-size:10px;cursor:pointer;font-family:inherit;transition:all .12s}
.annot-type-btn:hover{background:var(--accent-dim);border-color:var(--accent);color:var(--sp-color-primary-hover)}
.annot-list{display:flex;flex-direction:column;gap:2px;max-height:120px;overflow-y:auto}
.annot-item{display:flex;align-items:center;gap:5px;padding:4px 7px;background:rgba(255,255,255,.04);border-radius:4px;border:1px solid rgba(255,255,255,.06);cursor:pointer;transition:all .1s}
.annot-item.on{border-color:var(--accent);background:var(--accent-dim)}
.annot-icon{font-size:12px;font-weight:700;color:rgba(255,255,255,.7);min-width:14px}
.annot-lbl{flex:1;font-size:10px;color:rgba(255,255,255,.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.annot-tc{font-size:10px;font-family:monospace;color:var(--accent)}
.annot-editor{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:7px;padding:8px;margin-top:6px}
.annot-color-dot{width:16px;height:16px;border-radius:50%;cursor:pointer;border:1px solid rgba(255,255,255,.15);transition:transform .1s;flex-shrink:0}
.annot-color-dot:hover{transform:scale(1.2)}

/* ─── 标注在 Canvas 上的拖拽 overlay ─── */
.annot-overlay{position:absolute;inset:0;pointer-events:none}
.annot-drag-handle{position:absolute;border:2px dashed rgba(245,158,11,.8);border-radius:4px;cursor:move;pointer-events:all}
.annot-drag-handle:hover{border-color:#f59e0b;background:rgba(245,158,11,.05)}

</style>
