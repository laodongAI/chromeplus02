/**
 * 域名共享模块单测（P2-1 统一后的唯一维护入口）。
 * 重点回归：
 *  - 后缀精确匹配（替代旧 includes 宽松匹配）不误伤相似拼写域名；
 *  - 可注册主域（近似 eTLD+1）：多级公共后缀必须多留一段，
 *    旧版 slice(-2) 把 example.co.uk 判成 co.uk，会放行任意 *.co.uk 第三方。
 */
import { describe, it, expect } from 'vitest';
import { DOMAIN_BLOCKLIST, isBlockedHost, getRegistrableDomain, MULTI_LEVEL_PUBLIC_SUFFIXES } from '@/utils/domains';

describe('DOMAIN_BLOCKLIST 数据完整性', () => {
  it('条目非空且均为小写裸域名（不含协议/路径/端口）', () => {
    expect(DOMAIN_BLOCKLIST.length).toBeGreaterThan(10);
    for (const d of DOMAIN_BLOCKLIST) {
      expect(d).toBe(d.toLowerCase());
      expect(d).not.toMatch(/[:/]/);
    }
  });

  it('合并后同时包含旧版两套黑名单的关键条目', () => {
    // 原 sources.ts 独有
    expect(DOMAIN_BLOCKLIST).toContain('google-analytics.com');
    expect(DOMAIN_BLOCKLIST).toContain('stripe.com');
    // 原 sourcesTree.ts 独有
    expect(DOMAIN_BLOCKLIST).toContain('googlesyndication.com');
    expect(DOMAIN_BLOCKLIST).toContain('twitter.com');
    // 两边共有
    expect(DOMAIN_BLOCKLIST).toContain('google.com');
    expect(DOMAIN_BLOCKLIST).toContain('clarity.ms');
  });

  it('无重复条目', () => {
    expect(new Set(DOMAIN_BLOCKLIST).size).toBe(DOMAIN_BLOCKLIST.length);
  });
});

describe('isBlockedHost 后缀精确匹配', () => {
  it('精确命中与子域命中', () => {
    expect(isBlockedHost('google.com')).toBe(true);
    expect(isBlockedHost('www.google.com')).toBe(true);
    expect(isBlockedHost('fonts.googleapis.com')).toBe(true);
    expect(isBlockedHost('www.facebook.com')).toBe(true);
  });

  it('冒牌前缀/后缀不误伤（旧 includes 匹配的典型误判场景）', () => {
    expect(isBlockedHost('notgoogle.com')).toBe(false);
    expect(isBlockedHost('google.com.evil.io')).toBe(false);
    expect(isBlockedHost('myclarity.ms.example.org')).toBe(false);
  });

  it('大小写与端口不影响判定', () => {
    expect(isBlockedHost('WWW.GOOGLE.COM')).toBe(true);
    expect(isBlockedHost('www.google.com:443')).toBe(true);
  });

  it('普通业务域名不受影响', () => {
    expect(isBlockedHost('www.bilibili.com')).toBe(false);
    expect(isBlockedHost('localhost')).toBe(false);
    expect(isBlockedHost('')).toBe(false);
  });
});

describe('MULTI_LEVEL_PUBLIC_SUFFIXES 数据完整性', () => {
  it('条目均为小写两段以上裸域名，无重复', () => {
    expect(MULTI_LEVEL_PUBLIC_SUFFIXES.length).toBeGreaterThan(20);
    for (const s of MULTI_LEVEL_PUBLIC_SUFFIXES) {
      expect(s).toBe(s.toLowerCase());
      expect(s).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
    expect(new Set(MULTI_LEVEL_PUBLIC_SUFFIXES).size).toBe(MULTI_LEVEL_PUBLIC_SUFFIXES.length);
  });
});

describe('getRegistrableDomain（近似 eTLD+1）', () => {
  it('常规域名去掉子域只留主域', () => {
    expect(getRegistrableDomain('www.bilibili.com')).toBe('bilibili.com');
    expect(getRegistrableDomain('a.b.c.example.com')).toBe('example.com');
    expect(getRegistrableDomain('example.com')).toBe('example.com');
  });

  it('多级公共后缀多留一段（旧版 slice(-2) 的典型误判）', () => {
    expect(getRegistrableDomain('www.example.co.uk')).toBe('example.co.uk');
    expect(getRegistrableDomain('a.b.example.com.cn')).toBe('example.com.cn');
    expect(getRegistrableDomain('foo.example.com.au')).toBe('example.com.au');
    expect(getRegistrableDomain('live.example.co.jp')).toBe('example.co.jp');
  });

  it('不同注册者的同后缀站点不再被判成同一主域', () => {
    // 旧实现：两者都是 'co.uk' → 第三方混入主域资源
    expect(getRegistrableDomain('shop-a.co.uk')).not.toBe(getRegistrableDomain('shop-b.co.uk'));
    expect(getRegistrableDomain('a.github.io')).toBe('a.github.io');
    expect(getRegistrableDomain('b.github.io')).toBe('b.github.io');
    expect(getRegistrableDomain('evil.github.io')).not.toBe('tenant.github.io');
  });

  it('本身是公共后缀时返回 null：不属于任何单一注册者，不能用来比同主域', () => {
    expect(getRegistrableDomain('co.uk')).toBeNull();
    expect(getRegistrableDomain('github.io')).toBeNull();
  });

  it('单段输入按字面主机名返回自身（localhost / 内网名可用；裸 TLD 是理论输入，同规则处理）', () => {
    expect(getRegistrableDomain('com')).toBe('com');
  });

  it('端口、大小写、尾点不影响结果', () => {
    expect(getRegistrableDomain('Sub.Example.COM:8443')).toBe('example.com');
    expect(getRegistrableDomain('example.com.')).toBe('example.com');
    expect(getRegistrableDomain('shop-a.co.uk:3000')).toBe('shop-a.co.uk');
    expect(getRegistrableDomain('co.uk:3000')).toBeNull(); // 公共后缀本身，带端口同样为 null
    expect(getRegistrableDomain('a.co.uk.:3000')).toBe('a.co.uk'); // a.co.uk 是 .UK 下已注册的真实域名，不是公共后缀
    expect(getRegistrableDomain('[::1]:3000')).toBe('::1'); // IPv6 带端口
  });

  it('IP 字面量与单段主机名整体返回自身', () => {
    expect(getRegistrableDomain('192.168.1.20')).toBe('192.168.1.20');
    expect(getRegistrableDomain('127.0.0.1:9000')).toBe('127.0.0.1');
    expect(getRegistrableDomain('[::1]:3000')).toBe('::1');
    expect(getRegistrableDomain('localhost')).toBe('localhost');
    expect(getRegistrableDomain('intranet')).toBe('intranet');
  });

  it('相同 IP 不同端口仍是同一主机', () => {
    expect(getRegistrableDomain('192.168.1.20:3000')).toBe(getRegistrableDomain('192.168.1.20:8080'));
  });

  it('空输入返回 null', () => {
    for (const bad of ['', '   ', '.']) {
      expect(getRegistrableDomain(bad)).toBeNull();
    }
  });
});
