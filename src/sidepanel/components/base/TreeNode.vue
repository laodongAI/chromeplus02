<template>
  <div class="tree-node" :style="{ paddingLeft: `${level * 20}px` }">
    <!-- UI 三批（组3）：行内含 checkbox 与子按钮，不能换成 button 标签，
         改用 role=button + tabindex=0 + Enter/Space 键盘触发达到同等可达性 -->
    <div
      class="tree-node__row"
      :class="{ 'is-selected': isSelected, 'is-directory': node.type === 'directory' }"
      role="button"
      tabindex="0"
      @click="handleClick"
      @keydown.enter.prevent="handleClick"
      @keydown.space.prevent="handleClick"
    >
      <div class="tree-node__left">
        <button
          v-if="node.type === 'directory'"
          class="tree-node__toggle"
          :aria-label="isExpanded ? '收起目录' : '展开目录'"
          @click.stop="$emit('toggle', node.path)"
        >
          <!-- UI 三批（组5）：▼/▶ 字符箭头换成内联 SVG chevron（朝右），展开态 CSS 旋转 90° -->
          <span class="toggle-icon" :class="{ 'is-open': isExpanded }" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
        </button>
        <span v-else class="tree-node__spacer"></span>

        <!-- UI 三批（组3）：16px checkbox 外包 ≥24px 的 label 命中区（点空白即勾选），
             label 上 @click.stop 保留原「勾选不触发行展开/选择」语义 -->
        <label class="checkbox-hit" @click.stop>
          <input
            type="checkbox"
            class="tree-node__checkbox"
            :checked="isSelected"
            @click.stop
            @change="$emit('select', node)"
          />
        </label>

        <!-- UI 三批（组5）：nodeIcon 由 emoji 改为内联 stroke SVG 字符串，纯装饰图标 aria-hidden -->
        <span class="tree-node__icon" v-html="nodeIcon" aria-hidden="true"></span>
        <span class="tree-node__name">{{ node.name }}</span>
      </div>

      <div class="tree-node__right">
        <button
          v-if="node.type === 'directory' && node.children && node.children.length > 0"
          class="tree-node__expand-all"
          @click.stop="$emit('expand-children', node.path)"
          title="展开所有子目录"
          aria-label="展开所有子目录"
        >
          <!-- UI 三批（组5）：⤵ 字符换成 corner-down-right 内联 SVG -->
          <span class="expand-icon" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>
          </span>
        </button>
        <span v-if="node.type === 'file' && node.size" class="tree-node__size">
          {{ formatSize(node.size) }}
        </span>
        <span v-if="node.type === 'directory' && node.children" class="tree-node__count">
          {{ node.children.length }}
        </span>
      </div>
    </div>
    
    <div v-if="node.type === 'directory' && isExpanded && node.children" class="tree-node__children">
      <TreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :level="level + 1"
        :expanded="expanded"
        :selected="selected"
        @toggle="$emit('toggle', $event)"
        @select="$emit('select', $event)"
        @expand-children="$emit('expand-children', $event)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue';

/**
 * UI 三批（组5）：树节点内联 SVG 图标常量（16px、stroke=currentColor、stroke-width 2）。
 * 三种形状：闭合文件夹（目录收起）/ 打开文件夹（目录展开）/ 文件 / 图片框；
 * 字符串经 v-html 注入装饰性 <span aria-hidden="true">，内容为本文件内静态常量，无注入风险。
 */
const SVG_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
/** 目录·收起：闭合文件夹 */
const ICON_FOLDER_CLOSED = `<svg ${SVG_ATTRS}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
/** 目录·展开：翻开盖的文件夹 */
const ICON_FOLDER_OPEN = `<svg ${SVG_ATTRS}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-2.26 6A2 2 0 0 1 17.68 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.76a2 2 0 0 1 1.7.9l.64 1.1A2 2 0 0 0 10.76 6H18a2 2 0 0 1 2 2v2"/></svg>`;
/** 文件：折角文档（所有非图片文件统一用此单态，替代原 📜📘🎨📄📋 五种 emoji） */
const ICON_FILE = `<svg ${SVG_ATTRS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
/** 图片：图片框（山+日点题），替代原 🖼️ */
const ICON_IMAGE = `<svg ${SVG_ATTRS}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

interface SourceTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: SourceTreeNode[];
  url?: string;
  size?: number;
}

export default defineComponent({
  name: 'TreeNode',
  props: {
    node: {
      type: Object as PropType<SourceTreeNode>,
      required: true
    },
    level: {
      type: Number,
      default: 0
    },
    expanded: {
      type: Set as PropType<Set<string>>,
      required: true
    },
    selected: {
      type: Set as PropType<Set<string>>,
      required: true
    }
  },
  emits: ['toggle', 'select', 'expand-children'],
  setup(props, { emit }) {
    const isExpanded = computed(() => props.expanded.has(props.node.path));
    
    const isSelected = computed(() => {
      if (props.node.type === 'file') {
        return props.selected.has(props.node.path);
      } else {
        // 目录：检查是否所有子文件都被选中
        const files = getAllFilesInNode(props.node);
        return files.length > 0 && files.every(f => props.selected.has(f.path));
      }
    });

    /**
     * UI 三批（组5）：节点图标由 emoji 收敛为内联 stroke SVG 字符串
     * （统一 16px 视口、currentColor 随主题、stroke-width 2）。
     * 不再按扩展名细分七种 emoji：目录=folder 开/合两态，图片类=图片框，其余=file 单态，
     * 信息量等价且深浅主题下颜色与全站图标语言一致。
     */
    const nodeIcon = computed(() => {
      if (props.node.type === 'directory') {
        return isExpanded.value ? ICON_FOLDER_OPEN : ICON_FOLDER_CLOSED;
      }
      const name = props.node.name.toLowerCase();
      // 图片类扩展名 → 图片框图标（与原 emoji 分类等价，png/jpg/jpeg/svg 及常见 webp/gif）
      if (/\.(png|jpe?g|svg|webp|gif)$/.test(name)) return ICON_IMAGE;
      return ICON_FILE;
    });

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

    function formatSize(bytes: number): string {
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
    }

    function handleClick() {
      if (props.node.type === 'directory') {
        emit('toggle', props.node.path);
      } else {
        emit('select', props.node);
      }
    }

    return {
      isExpanded,
      isSelected,
      nodeIcon,
      formatSize,
      handleClick
    };
  }
});
</script>

<style scoped>
.tree-node {
  user-select: none;
}

.tree-node__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--sp-spacing-2) var(--sp-spacing-3);
  border-radius: var(--sp-radius-sm);
  cursor: pointer;
  transition: all var(--sp-transition-fast);
  gap: var(--sp-spacing-2);
}

.tree-node__row:hover {
  background: var(--sp-color-bg-subtle-hover);
}

/* UI 三批（组3）：行改为 role=button 可聚焦后，补键盘焦点环（内偏移避免撑破容器） */
.tree-node__row:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: -2px; }

.tree-node__row.is-selected {
  background: var(--sp-color-primary-light);
  border-left: 2px solid var(--sp-color-primary);
}

.tree-node__row.is-directory {
  font-weight: 500;
}

.tree-node__left {
  display: flex;
  align-items: center;
  gap: var(--sp-spacing-2);
  flex: 1;
  min-width: 0;
}

.tree-node__toggle {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--sp-color-muted);
  padding: 0;
  transition: all var(--sp-transition-fast);
}

.tree-node__toggle:hover {
  color: var(--sp-color-text);
  background: var(--sp-color-bg-subtle);
  border-radius: var(--sp-radius-sm);
}

/* UI 三批（组5）：折叠箭头由 11px 文字改为 SVG：收起态朝右（▶ 等价），展开态旋转 90°（▼ 等价） */
.toggle-icon {
  display: block;
  transition: transform var(--sp-transition-fast);
}
.toggle-icon.is-open { transform: rotate(90deg); }
.toggle-icon svg { display: block; }

.tree-node__spacer {
  width: 20px;
  flex-shrink: 0;
}

/* UI 三批（组3）：checkbox 视觉 16px 不变，外层 label 命中区扩到 ≥24×24 */
.checkbox-hit {
  min-width: 24px;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tree-node__checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--sp-color-primary);
}

/* UI 三批（组5）：图标容器改为承载内联 SVG（16px），颜色走 muted 与文字层级区分 */
.tree-node__icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--sp-color-muted);
}

.tree-node__name {
  font-size: var(--sp-text-sm);
  color: var(--sp-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-node__row.is-directory .tree-node__name {
  color: var(--sp-color-heading);
  font-weight: 600;
}

.tree-node__right {
  display: flex;
  align-items: center;
  gap: var(--sp-spacing-2);
  flex-shrink: 0;
}

.tree-node__expand-all {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-sm);
  cursor: pointer;
  color: var(--sp-color-muted);
  transition: all var(--sp-transition-fast);
}

.tree-node__expand-all:hover {
  background: var(--sp-color-bg-subtle);
  border-color: var(--sp-color-primary);
  color: var(--sp-color-primary);
}

/* UI 三批（组5）：⤵ 字符换成 SVG 后改为 flex 容器承载 */
.expand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.tree-node__size,
.tree-node__count {
  font-size: var(--sp-text-xs);
  color: var(--sp-color-muted);
  font-family: var(--sp-font-mono);
  padding: 2px 6px;
  background: var(--sp-color-bg-subtle);
  border-radius: var(--sp-radius-sm);
}

.tree-node__children {
  margin-top: var(--sp-spacing-1);
}
</style>
