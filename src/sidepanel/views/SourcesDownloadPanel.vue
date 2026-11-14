<template>
  <!-- UI 三批（组6）：标题「Sources文件下载」改引用术语表 PANEL_TITLES.sources（资源包下载），消除英文残留 -->
  <BaseCard :title="PANEL_TITLES.sources" subtitle="浏览和下载页面资源文件，保持目录结构" :padded="true">
    <div class="toolbar">
      <div class="toolbar__left">
        <BaseButton size="sm" variant="secondary" :loading="scanning" @click="scanSourcesTree">
          扫描资源目录
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="showDebugInfo = !showDebugInfo">
          {{ showDebugInfo ? '隐藏调试' : '显示调试' }}
        </BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!hasSelection" @click="clearSelection">
          清空选择
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="expandAll">
          {{ allExpanded ? '全部折叠' : '全部展开' }}
        </BaseButton>
      </div>
      <div class="toolbar__right">
        <span v-if="selectedCount > 0" class="selection-info">
          已选择 {{ selectedCount }} 个文件
        </span>
        <BaseButton 
          size="sm" 
          variant="primary" 
          :disabled="!hasSelection || downloading" 
          :loading="downloading"
          @click="downloadSelected">
          下载并打包
        </BaseButton>
      </div>
    </div>

    <!-- UI 三批（组1）：本地 ⚠️ emoji 版 error-banner 整块换成共享 ErrorBanner
         （danger 红语义 + 内联 SVG 图标 + 可关闭），关闭时清空 error 状态 -->
    <ErrorBanner v-if="error" :message="error" title="操作失败" @close="error = null" />
    <!-- 打包成功但有文件缺失：黄色警示（不是操作失败，不能抢 danger 语义） -->
    <ErrorBanner v-if="notice" :message="notice" title="已下载，但有文件缺失" tone="warning" @close="notice = null" />

    <div v-if="downloadProgress > 0 && downloadProgress < 1" class="progress-container">
      <div class="progress-header">
        <span class="progress-label">正在下载和打包...</span>
        <span class="progress-percent">{{ Math.round(downloadProgress * 100) }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-bar__fill" :style="{ width: `${downloadProgress * 100}%` }"></div>
      </div>
    </div>

    <div v-if="showDebugInfo && debugData" class="debug-panel">
      <div class="debug-header">调试信息（原始数据）</div>
      <pre class="debug-content">{{ debugData }}</pre>
    </div>

    <div v-if="!scanning && tree.length === 0" class="empty-state">
      <!-- UI 三批（组5）：空状态 📁 emoji 换内联 stroke SVG（currentColor 跟随主题，跨平台一致） -->
      <div class="empty-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div class="empty-title">尚未扫描资源</div>
      <div class="empty-hint">点击"扫描资源目录"开始浏览页面资源文件</div>
    </div>

    <div v-else-if="tree.length > 0" class="tree-container">
      <div class="tree-header">
        <span class="tree-title">资源目录</span>
        <span class="tree-info">{{ totalFiles }} 个文件</span>
      </div>
      <div class="tree-list">
        <TreeNode
          v-for="node in tree"
          :key="node.path"
          :node="node"
          :level="0"
          :expanded="expandedNodes"
          :selected="selectedFiles"
          @toggle="toggleNode"
          @select="toggleSelect"
          @expand-children="expandChildren"
        />
      </div>
    </div>
  </BaseCard>
</template>

<script lang="ts">
import { computed, defineComponent, reactive, ref } from 'vue';
// UI 三批（组1）：新增共享 ErrorBanner，替换本面板手抄的 ⚠️ emoji 错误横幅
import { BaseButton, BaseCard, ErrorBanner } from '../components/base';
// UI 三批（组6）：面板标题引用术语表（Options API 需从 setup 返回供模板绑定）
import { PANEL_TITLES } from '../utils/terminology';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
// P1-1 协议收敛：SOURCES_* 消息类型统一从消息协议模块导入，消除裸字符串
import { MessageType } from '@/messaging';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';
import TreeNode from '../components/base/TreeNode.vue';

/** 本模块 logger：保留原 `[SourcesDownloadPanel]`/`[SourcesDownload]` 前缀语义 */
const log = createLogger('SourcesDownload');

interface SourceTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: SourceTreeNode[];
  url?: string;
  size?: number;
}

export default defineComponent({
  name: 'SourcesDownloadPanel',
  components: { BaseButton, BaseCard, ErrorBanner, TreeNode },
  setup() {
    const tree = ref<SourceTreeNode[]>([]);
    const expandedNodes = reactive(new Set<string>());
    const selectedFiles = reactive(new Set<string>());
    const scanning = ref(false);
    const downloading = ref(false);
    const downloadProgress = ref(0);
    const error = ref<string | null>(null);
    /** 部分成功提示：打包完成但有文件未入包时由后台的 skipped 摘要填充 */
    const notice = ref<string | null>(null);
    const showDebugInfo = ref(false);
    const debugData = ref<string>('');

    const totalFiles = computed(() => {
      return countFiles(tree.value);
    });

    const selectedCount = computed(() => selectedFiles.size);
    const hasSelection = computed(() => selectedFiles.size > 0);
    const allExpanded = computed(() => {
      const allNodes = getAllNodes(tree.value);
      const dirs = allNodes.filter(n => n.type === 'directory');
      return dirs.length > 0 && dirs.every(n => expandedNodes.has(n.path));
    });

    function countFiles(nodes: SourceTreeNode[]): number {
      let count = 0;
      for (const node of nodes) {
        if (node.type === 'file') {
          count++;
        } else if (node.children) {
          count += countFiles(node.children);
        }
      }
      return count;
    }

    function getAllNodes(nodes: SourceTreeNode[]): SourceTreeNode[] {
      const result: SourceTreeNode[] = [];
      for (const node of nodes) {
        result.push(node);
        if (node.children) {
          result.push(...getAllNodes(node.children));
        }
      }
      return result;
    }

    function toggleNode(path: string) {
      if (expandedNodes.has(path)) {
        expandedNodes.delete(path);
      } else {
        expandedNodes.add(path);
      }
    }

    function toggleSelect(node: SourceTreeNode) {
      if (node.type === 'file') {
        if (selectedFiles.has(node.path)) {
          selectedFiles.delete(node.path);
        } else {
          selectedFiles.add(node.path);
        }
      } else {
        // 目录：选择/取消选择所有子文件
        const files = getAllFilesInNode(node);
        const allSelected = files.every(f => selectedFiles.has(f.path));
        
        if (allSelected) {
          files.forEach(f => selectedFiles.delete(f.path));
        } else {
          files.forEach(f => selectedFiles.add(f.path));
        }
      }
    }

    function expandChildren(path: string) {
      const node = findNode(tree.value, path);
      if (node && node.children) {
        for (const child of node.children) {
          if (child.type === 'directory') {
            expandedNodes.add(child.path);
          }
        }
      }
    }

    function findNode(nodes: SourceTreeNode[], path: string): SourceTreeNode | null {
      for (const node of nodes) {
        if (node.path === path) return node;
        if (node.children) {
          const found = findNode(node.children, path);
          if (found) return found;
        }
      }
      return null;
    }

    function getAllFilesInNode(node: SourceTreeNode): SourceTreeNode[] {
      const files: SourceTreeNode[] = [];
      if (node.type === 'file') {
        files.push(node);
      } else if (node.children) {
        for (const child of node.children) {
          files.push(...getAllFilesInNode(child));
        }
      }
      return files;
    }

    function clearSelection() {
      selectedFiles.clear();
    }

    function expandAll() {
      if (allExpanded.value) {
        expandedNodes.clear();
      } else {
        const allNodes = getAllNodes(tree.value);
        allNodes.forEach(n => {
          if (n.type === 'directory') {
            expandedNodes.add(n.path);
          }
        });
      }
    }

    async function scanSourcesTree() {
      scanning.value = true;
      error.value = null;
      debugData.value = '';
      try {
        const response = await sendRuntimeMessage<{ 
          success: boolean; 
          tree?: SourceTreeNode[]; 
          rawData?: any;
          error?: string 
        }>({
          type: MessageType.SOURCES_TREE_SCAN
        });

        if (!response?.success) {
          throw new Error(response?.error || '扫描失败');
        }

        log.debug('Received tree:', response.tree);
        
        // 保存调试数据
        if (response.rawData) {
          debugData.value = JSON.stringify(response.rawData, null, 2);
        }
        
        tree.value = response.tree || [];
        selectedFiles.clear();
        expandedNodes.clear();
        
        // 默认展开第一级和第二级
        tree.value.forEach(node => {
          if (node.type === 'directory') {
            expandedNodes.add(node.path);
            // 展开第二级
            if (node.children) {
              node.children.forEach(child => {
                if (child.type === 'directory') {
                  expandedNodes.add(child.path);
                }
              });
            }
          }
        });
      } catch (e: any) {
        error.value = e?.message || '扫描资源目录失败';
        tree.value = [];
      } finally {
        scanning.value = false;
      }
    }

    async function downloadSelected() {
      if (!hasSelection.value) return;
      
      downloading.value = true;
      downloadProgress.value = 0;
      error.value = null;
      notice.value = null;

      try {
        // 收集所有选中的文件节点
        const allNodes = getAllNodes(tree.value);
        const selectedNodes = allNodes.filter(n => 
          n.type === 'file' && selectedFiles.has(n.path)
        );

        if (selectedNodes.length === 0) {
          throw new Error('没有选中的文件');
        }

        // 发送到background处理
        const response = await sendRuntimeMessage<{
          success: boolean;
          taskId?: string;
          error?: string;
          skipped?: { count: number; text: string } | null;
        }>({
          type: MessageType.SOURCES_TREE_DOWNLOAD,
          files: selectedNodes.map(n => ({
            path: n.path,
            url: n.url,
            size: n.size
          }))
        });

        if (!response?.success) {
          throw new Error(response?.error || '下载启动失败');
        }

        // 轮询进度
        if (response.taskId) {
          await pollDownloadProgress(response.taskId);
        }

        // 后台已如实报出未入包项：完成也要让用户知道压缩包少了什么
        if (response.skipped?.count) notice.value = response.skipped.text;
      } catch (e: any) {
        error.value = e?.message || '下载失败';
      } finally {
        downloading.value = false;
        downloadProgress.value = 0;
      }
    }

    async function pollDownloadProgress(taskId: string) {
      const maxAttempts = 300; // 最多轮询5分钟
      let attempts = 0;
      
      const poll = async () => {
        if (attempts >= maxAttempts) {
          downloading.value = false;
          error.value = '下载超时';
          return;
        }

        try {
          const response = await sendRuntimeMessage<{ 
            success: boolean; 
            task?: { progress: number; status: string; error?: string } 
          }>({
            type: MessageType.SOURCES_DOWNLOAD_STATUS,
            taskId
          });

          if (response?.task) {
            downloadProgress.value = response.task.progress;
            
            if (response.task.status === 'completed') {
              downloading.value = false;
              downloadProgress.value = 1;
              error.value = null;
              // 清空选择
              selectedFiles.clear();
              return;
            } else if (response.task.status === 'error') {
              downloading.value = false;
              downloadProgress.value = 0;
              error.value = response.task.error || '下载失败';
              return;
            }
          }

          attempts++;
          setTimeout(poll, 1000);
        } catch (e) {
          log.error('Poll error:', e);
          downloading.value = false;
          downloadProgress.value = 0;
          error.value = '获取下载状态失败';
        }
      };

      poll();
    }

    return {
      PANEL_TITLES,
      tree,
      expandedNodes,
      selectedFiles,
      scanning,
      downloading,
      downloadProgress,
      error,
      notice,
      totalFiles,
      selectedCount,
      hasSelection,
      allExpanded,
      showDebugInfo,
      debugData,
      toggleNode,
      toggleSelect,
      expandChildren,
      clearSelection,
      expandAll,
      scanSourcesTree,
      downloadSelected
    };
  }
});
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 6px;
}

.toolbar__left, .toolbar__right {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.selection-info {
  /* UI 三批（组2）：选中计数属状态正文文字 11px → 12px */
  font-size: 12px;
  color: var(--sp-color-primary);
  font-weight: 500;
}

/* UI 三批（组1）：.error-banner/.error-title/.error-message 本地样式随错误横幅
   收敛共享 ErrorBanner 组件一并删除 */

.progress-container {
  margin-bottom: 12px;
  padding: 10px 12px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.progress-label {
  /* UI 三批（组2）：下载状态文字 11px → 12px */
  font-size: 12px;
  color: var(--sp-color-text-secondary);
}

.progress-percent {
  /* UI 三批（组2）：进度百分比属状态文字 11px → 12px */
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-color-primary);
  font-family: var(--sp-font-mono, monospace);
}

.progress-bar {
  height: 4px;
  background: var(--sp-color-bg-subtle);
  border-radius: 999px;
  overflow: hidden;
}

.progress-bar__fill {
  height: 100%;
  background: var(--sp-color-primary);
  border-radius: 999px;
  transition: width var(--sp-transition-base);
}

.debug-panel {
  margin-bottom: 10px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
}

.debug-header {
  padding: 6px 10px;
  background: var(--sp-color-bg-elevated);
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-color-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--sp-color-border);
}

.debug-content {
  margin: 0;
  padding: 10px;
  font-family: var(--sp-font-mono, monospace);
  font-size: 11px;
  color: var(--sp-color-text);
  background: var(--sp-color-surface);
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 32px;
  line-height: 1;
}

.empty-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--sp-color-text);
}

.empty-hint {
  font-size: 11px;
  color: var(--sp-color-muted);
}

.tree-container {
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-lg);
  overflow: hidden;
}

.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
}

.tree-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tree-info {
  font-size: 11px;
  color: var(--sp-color-muted);
}

.tree-list {
  max-height: 420px;
  overflow-y: auto;
  background: var(--sp-color-bg-elevated);
  padding: 4px 0;
}
</style>
