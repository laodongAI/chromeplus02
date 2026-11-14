/**
 * 共享 DOM 查询工具。
 * 收敛原先在 content-scripts/router.ts、images.ts、audio.ts 中逐字重复的
 * deepQuerySelectorAll 实现（含 Shadow DOM 深度遍历），统一维护入口。
 * 注意：本模块仅在内容脚本上下文中调用（依赖 document），
 *       默认参数在调用时才求值，后台（Service Worker）导入本模块不会报错。
 */

/**
 * 深度查询：按 BFS 顺序遍历文档与所有开放 Shadow Root，
 * 收集匹配 selector 的元素（自定义元素 shadowRoot 为 closed 时无法穿透，属已知限制）。
 * @param selector CSS 选择器
 * @param root 查询根节点，默认整个 document
 * @returns 匹配到的元素数组（按遍历顺序）
 */
export function deepQuerySelectorAll<T extends Element>(
  selector: string,
  root: Document | ShadowRoot = document
): T[] {
  const out: T[] = []; // 结果集合：按 BFS 顺序收集匹配元素
  const queue: (Document | ShadowRoot)[] = [root]; // BFS 队列：待遍历的文档/影子根
  while (queue.length) {
    const current = queue.shift()!; // 取出当前根节点
    // 1) 在当前根内直接查询目标元素
    current.querySelectorAll<T>(selector).forEach((el) => out.push(el));
    // 2) 扫描当前根内所有元素，发现开放 ShadowRoot 则入队继续遍历
    current.querySelectorAll<Element>('*').forEach((el) => {
      const typed = el as Element & { shadowRoot?: ShadowRoot | null };
      if (typed.shadowRoot) queue.push(typed.shadowRoot);
    });
  }
  return out;
}
