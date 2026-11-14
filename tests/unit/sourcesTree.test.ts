/**
 * sourcesTree 纯函数单测（P1-4 治理 + 深审差量回归）。
 * 覆盖：
 *  - 深度截断只影响展示树，截断前收集的文件清单必须包含 >3 层文件（静默丢失修复）；
 *  - addResourceToTree 路径构造（原三元两分支相同的残留代码统一后行为不变）；
 *  - 子帧资源必须进目录树并挂在自身域名下（旧实现只遍历顶层帧的兄弟链，
 *    且下载阶段用顶层 frameId 取内容，iframe 资源一律静默丢失）；
 *  - 主域判定改用可注册主域：*.co.uk / *.github.io 之类的无关租户不得混入本站资源。
 */
import { describe, it, expect } from 'vitest';
import {
  getAllFilesInDirectory, limitTreeDepth, buildSourcesTree, isUsefulHost,
  type SourceTreeNode,
} from '@/content-scripts/sourcesTree';

/** 构造一个 host 根节点（path 与 name 同为 host，对应原三元表达式的命中分支） */
function makeHostNode(host: string): SourceTreeNode {
  return { name: host, path: host, type: 'directory', children: [] };
}

/** 手动拼一棵 5 层深的目录树：host/a/b/c/d/file.js */
function makeDeepTree(): SourceTreeNode {
  const file: SourceTreeNode = {
    name: 'file.js',
    path: 'example.com/a/b/c/d/file.js',
    type: 'file',
    url: 'https://example.com/a/b/c/d/file.js',
    size: 123
  };
  const d: SourceTreeNode = { name: 'd', path: 'example.com/a/b/c/d', type: 'directory', children: [file] };
  const c: SourceTreeNode = { name: 'c', path: 'example.com/a/b/c', type: 'directory', children: [d] };
  const b: SourceTreeNode = { name: 'b', path: 'example.com/a/b', type: 'directory', children: [c] };
  const a: SourceTreeNode = { name: 'a', path: 'example.com/a', type: 'directory', children: [b] };
  const host = makeHostNode('example.com');
  host.children = [a];
  return host;
}

describe('getAllFilesInDirectory（截断前收集）', () => {
  it('完整树可收集到 >3 层的深层文件', () => {
    const files = getAllFilesInDirectory(makeDeepTree());
    expect(files.length).toBe(1);
    expect(files[0].url).toBe('https://example.com/a/b/c/d/file.js');
  });

  it('截断后的展示树会丢失深层文件（说明必须在截断前收集清单）', () => {
    const truncated = limitTreeDepth([makeDeepTree()], 0, 3);
    const files = truncated.flatMap((n) => getAllFilesInDirectory(n));
    // 3 级截断后 d/file.js 不在展示树中——回归旧缺陷存在的证据
    expect(files.some((f) => f.url?.endsWith('/d/file.js'))).toBe(false);
  });
});

describe('limitTreeDepth', () => {
  it('超过 maxDepth 的层级 children 被剥离，但不修改原树', () => {
    const original = makeDeepTree();
    const truncated = limitTreeDepth([original], 0, 3);
    // 展示树：host(0)/a(1)/b(2) 保留 children，c(3) 的 children 被剥离
    const bNode = truncated[0].children![0].children![0];
    expect(bNode.name).toBe('b');
    expect(bNode.children!.length).toBe(1);
    const cNode = bNode.children![0];
    expect(cNode.children).toBeUndefined();
    // 原完整树不受截断影响（浅拷贝语义）
    expect(getAllFilesInDirectory(original).length).toBe(1);
  });
});

/** 构造一棵帧树：顶层站点 + 支付 iframe + 第三方 iframe */
function makeFrameTree(topUrl: string): unknown {
  return {
    frame: { id: 'F_TOP', url: topUrl },
    resources: [{ url: `${topUrl}/main.js`, contentSize: 10 }],
    childFrames: [
      {
        frame: { id: 'F_PAY', url: 'https://pay.shop.example.com/checkout' },
        resources: [{ url: 'https://pay.shop.example.com/checkout.js', contentSize: 20 }],
      },
      {
        frame: { id: 'F_AD', url: 'https://ad.doubleclick.net/x' },
        resources: [{ url: 'https://ad.doubleclick.net/x/b.js', contentSize: 30 }],
      },
    ],
  };
}

/** 取目录树中出现的全部域名节点名 */
function hostsOf(nodes: SourceTreeNode[]): string[] {
  return nodes.map(n => n.name);
}

describe('buildSourcesTree（子帧资源归属）', () => {
  it('iframe 内同主域子域的资源照常进树，挂在自身域名下', () => {
    const tree = buildSourcesTree(makeFrameTree('https://shop.example.com') as never);
    expect(hostsOf(tree)).toContain('pay.shop.example.com');
    const payNode = tree.find(n => n.name === 'pay.shop.example.com')!;
    const files = getAllFilesInDirectory(payNode);
    expect(files.length).toBe(1);
    expect(files[0].url).toBe('https://pay.shop.example.com/checkout.js');
    expect(files[0].size).toBe(20);
  });

  it('黑名单第三方域名默认过滤，不混进本站资源', () => {
    const tree = buildSourcesTree(makeFrameTree('https://shop.example.com') as never);
    expect(hostsOf(tree)).not.toContain('ad.doubleclick.net');
  });

  it('非 http(s) 协议的资源不入树（blob:/data: 无法按需取内容）', () => {
    const tree = buildSourcesTree({
      frame: { id: 'F', url: 'https://a.com/' },
      resources: [
        { url: 'blob:https://a.com/mse', contentSize: 1 },
        { url: 'data:application/javascript,', contentSize: 1 },
        { url: 'chrome-extension://xyz/inject.js', contentSize: 1 },
        { url: 'https://a.com/ok.js', contentSize: 1 },
      ],
    } as never);
    expect(getAllFilesInDirectory(tree[0]).map(f => f.url)).toEqual(['https://a.com/ok.js']);
  });

  it('顶层帧 URL 解析失败时仍按黑名单+第三方规则收敛（不因主域未知而放行全部）', () => {
    const tree = buildSourcesTree({
      frame: { id: 'F', url: 'about:blank' },
      resources: [{ url: 'https://any-third-party.com/a.js', contentSize: 1 }],
    } as never);
    expect(tree).toEqual([]);
  });
});

describe('isUsefulHost（可注册主域判定）', () => {
  it('同主域的其它子域与不同端口都保留', () => {
    expect(isUsefulHost('static.example.com', 'www.example.com')).toBe(true);
    expect(isUsefulHost('example.com', 'www.example.com')).toBe(true);
    expect(isUsefulHost('api.example.com:8443', 'www.example.com')).toBe(true);
  });

  it('多级公共后缀下的不同注册者不再被误判为同主域（旧 slice(-2) 缺陷）', () => {
    expect(isUsefulHost('evil.co.uk', 'shop-a.co.uk')).toBe(false);
    expect(isUsefulHost('other.github.io', 'mine.github.io')).toBe(false);
    expect(isUsefulHost('cdn.example.co.uk', 'shop.example.co.uk')).toBe(true);
  });

  it('本地开发主机强制保留（端口各异的前后端都要留下）', () => {
    expect(isUsefulHost('localhost:5173', 'localhost:3000')).toBe(true);
    expect(isUsefulHost('127.0.0.1:9000', '127.0.0.1:3000')).toBe(true);
    expect(isUsefulHost('app.local', 'dev.local')).toBe(true);
  });

  it('本站在线域名的资源不会被本地开发例外放行', () => {
    // 本地例外只认主机形态，与页面主域无关：线上站点不该出现 localhost 资源，
    // 真出现了也属于第三方，默认过滤
    expect(isUsefulHost('localhost:5173', 'www.example.com')).toBe(true);
    expect(isUsefulHost('cdn.other.com', 'www.example.com')).toBe(false);
  });

  it('preview-sandbox 强制保留', () => {
    expect(isUsefulHost('x.preview-sandbox.io', 'shop.example.com')).toBe(true);
  });

  it('黑名单优先于同主域判定', () => {
    expect(isUsefulHost('google.com', 'google.com')).toBe(false);
  });

  it('主域信息缺失（null）时不放行第三方', () => {
    expect(isUsefulHost('cdn.other.com', null)).toBe(false);
  });
});
