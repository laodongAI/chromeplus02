/**
 * 内容脚本类型与接口定义。
 */

export interface PageInfo {
  title?: string;
  url?: string;
}

export interface SiteAdapter {
  id: string;
  isMatch: (loc: Location) => boolean;
  getPageInfo: () => PageInfo;
  play?: () => void;
  pause?: () => void;
}
