<template>
  <div class="tree-node" :style="{ paddingLeft: `${level * 20}px` }">
    <div 
      class="tree-node__row"
      :class="{ 'is-selected': isSelected, 'is-directory': node.type === 'directory' }"
      @click="handleClick"
    >
      <div class="tree-node__left">
        <button
          v-if="node.type === 'directory'"
          class="tree-node__toggle"
          @click.stop="$emit('toggle', node.path)"
        >
          <span class="toggle-icon">{{ isExpanded ? '▼' : '▶' }}</span>
        </button>
        <span v-else class="tree-node__spacer"></span>
        
        <input
          type="checkbox"
          class="tree-node__checkbox"
          :checked="isSelected"
          @click.stop
          @change="$emit('select', node)"
        />
        
        <span class="tree-node__icon">{{ nodeIcon }}</span>
        <span class="tree-node__name">{{ node.name }}</span>
      </div>
      
      <div class="tree-node__right">
        <button
          v-if="node.type === 'directory' && node.children && node.children.length > 0"
          class="tree-node__expand-all"
          @click.stop="$emit('expand-children', node.path)"
          title="展开所有子目录"
        >
          <span class="expand-icon">⤵</span>
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

    const nodeIcon = computed(() => {
      if (props.node.type === 'directory') {
        return isExpanded.value ? '📂' : '📁';
      }
      // 根据文件类型返回图标
      const name = props.node.name.toLowerCase();
      if (name.endsWith('.js') || name.endsWith('.jsx')) return '📜';
      if (name.endsWith('.ts') || name.endsWith('.tsx')) return '📘';
      if (name.endsWith('.css') || name.endsWith('.scss')) return '🎨';
      if (name.endsWith('.html')) return '📄';
      if (name.endsWith('.json')) return '📋';
      if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.svg')) return '🖼️';
      return '📄';
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

.toggle-icon {
  font-size: 11px;
  display: block;
  transition: transform var(--sp-transition-fast);
}

.tree-node__spacer {
  width: 20px;
  flex-shrink: 0;
}

.tree-node__checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--sp-color-primary);
}

.tree-node__icon {
  font-size: 16px;
  flex-shrink: 0;
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

.expand-icon {
  font-size: 12px;
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
