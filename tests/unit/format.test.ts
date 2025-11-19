/**
 * format 工具的基础单测。
 */
import { describe, it, expect } from 'vitest';
import { formatPrompt, formatFilename } from '../../src/utils/format';

describe('format utils', () => {
  it('formatPrompt 替换变量', () => {
    const out = formatPrompt('Hello {name}', { name: 'World' });
    expect(out).toBe('Hello World');
  });

  it('formatFilename 生成合法文件名', () => {
    const out = formatFilename('{title}', { title: 'A:/B*C?"D' });
    expect(out).toBe('A__B_C__D');
  });
});
