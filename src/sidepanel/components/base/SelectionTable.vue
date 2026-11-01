<template>
  <BaseTable :dense="dense">
    <template #toolbar v-if="$slots.toolbar">
      <slot name="toolbar" />
    </template>
    <thead>
      <tr>
        <th class="checkbox-col">
          <input
            type="checkbox"
            class="table-checkbox"
            :checked="allSelected"
            :indeterminate="indeterminate"
            @change="toggleAll"
            :disabled="disabled || items.length === 0"
          />
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
          <input
            type="checkbox"
            class="table-checkbox"
            :checked="selected.has(getRowKey(item))"
            @change="toggleRow(getRowKey(item))"
          />
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
.checkbox-col {
  width: 48px;
  text-align: center;
}

.checkbox-cell {
  text-align: center;
  padding: var(--sp-spacing-3);
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
