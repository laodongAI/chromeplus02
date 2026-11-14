<template>
  <BaseTable :dense="dense">
    <template #toolbar v-if="$slots.toolbar">
      <slot name="toolbar" />
    </template>
    <thead>
      <tr>
        <th class="checkbox-col">
          <!-- UI 三批（组3）：label 包裹扩 24×24 命中区（点 label 空白即切换勾选），input 视觉尺寸不变、@change 逻辑不动 -->
          <label class="checkbox-hit">
            <input
              type="checkbox"
              class="table-checkbox"
              :checked="allSelected"
              :indeterminate="indeterminate"
              @change="toggleAll"
              :disabled="disabled || items.length === 0"
            />
          </label>
        </th>
        <slot name="header" />
      </tr>
    </thead>
    <tbody>
      <tr v-if="items.length === 0 && !loading">
        <td :colspan="columnCount + 1" class="empty-row">
          <slot name="empty">暂无数据</slot>
        </td>
      </tr>
      <tr
        v-for="(item, index) in items"
        :key="getRowKey(item)"
        :class="getRowClass(item)"
      >
        <td class="checkbox-cell">
          <!-- UI 三批（组3）：行勾选同样用 label 包裹扩 24×24 命中区，勾选逻辑不变 -->
          <label class="checkbox-hit">
            <input
              type="checkbox"
              class="table-checkbox"
              :checked="selected.has(getRowKey(item))"
              @change="toggleRow(getRowKey(item))"
            />
          </label>
        </td>
        <slot name="row" :item="item" :index="index" />
      </tr>
    </tbody>
    <template #footer v-if="$slots.footer">
      <slot name="footer" />
    </template>
  </BaseTable>
</template>

<script lang="ts">
import { defineComponent, computed, type PropType } from 'vue';
import BaseTable from './BaseTable.vue';

export default defineComponent({
  name: 'SelectionTable',
  components: { BaseTable },
  props: {
    items: { type: Array as PropType<any[]>, required: true },
    selected: { type: Object as PropType<Set<any>>, required: true },
    rowKey: { type: [String, Function] as PropType<string | ((item: any) => any)>, required: true },
    dense: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    columnCount: { type: Number, default: 10 }, // For colspan
    rowClass: { type: Function as PropType<(item: any) => any>, default: () => ({}) }
  },
  emits: ['update:selected', 'select-all', 'select-row'],
  setup(props, { emit }) {
    const getRowKey = (item: any) => {
      if (typeof props.rowKey === 'function') return props.rowKey(item);
      return item[props.rowKey as string];
    };

    const allSelected = computed(() => {
      return props.items.length > 0 && props.items.every(i => props.selected.has(getRowKey(i)));
    });

    const indeterminate = computed(() => {
      return props.selected.size > 0 && !allSelected.value;
    });

    const toggleAll = (e: Event) => {
      const checked = (e.target as HTMLInputElement).checked;
      emit('select-all', checked);
    };

    const toggleRow = (key: any) => {
      emit('select-row', key);
    };
    
    const getRowClass = (item: any) => {
        return props.rowClass(item);
    };

    return {
      getRowKey,
      allSelected,
      indeterminate,
      toggleAll,
      toggleRow,
      getRowClass
    };
  }
});
</script>

<style scoped>
/* 评审（UI 二批之一）：勾选列由 48px 收窄到 30px——窄侧栏（300-400px）下
   列宽预算紧张，18px 勾选框 + 6px 内边距足够命中，多出的宽度还给数据列 */
.checkbox-col {
  width: 30px;
  text-align: center;
}

.checkbox-cell {
  text-align: center;
  padding: 6px;
}

/* UI 三批（组3）：勾选命中区容器——label 包裹使点击 24×24 内任意位置都切换 checkbox，
   input 自身视觉尺寸（18px）保持不变 */
.checkbox-hit {
  min-width: 24px;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.table-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--sp-color-primary);
}

.empty-row {
  text-align: center;
  color: var(--sp-color-muted);
  padding: var(--sp-spacing-8) var(--sp-spacing-4);
  font-size: var(--sp-text-sm);
}
</style>
