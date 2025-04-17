/**
 * 内容脚本 - 在支持的网站上提取页面内容
 */

// ==================== 常量定义 ====================
// 支持的网站列表 - 确保与background.js和config.js保持一致
const SUPPORTED_SITES = [
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    enabled: true,
    domains: ['bilibili.com', 'b23.tv'],
    patterns: ['*://*.bilibili.com/video/*', '*://b23.tv/*']
  },
  {
    id: 'youtube',
    name: 'YouTube',
    enabled: true,
    domains: ['youtube.com', 'youtu.be'],
    patterns: ['*://*.youtube.com/watch*', '*://youtu.be/*']
  },
  {
    id: 'zhihu',
    name: '知乎',
    enabled: true,
    domains: ['zhihu.com'],
    patterns: ['*://*.zhihu.com/question/*', '*://*.zhihu.com/zvideo/*']
  },
  {
    id: 'douyin',
    name: '抖音',
    enabled: true,
    domains: ['douyin.com'],
    patterns: ['*://*.douyin.com/video/*', '*://*.douyin.com/discover*']
  },
  {
    id: 'weibo',
    name: '微博',
    enabled: true,
    domains: ['weibo.com'],
    patterns: ['*://*.weibo.com/*']
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    enabled: true,
    domains: ['xiaohongshu.com'],
    patterns: ['*://*.xiaohongshu.com/explore/*']
  }
];

// 全局变量
let config = null;
let siteInfo = null;

// 初始化
async function initialize() {
  console.log('内容脚本初始化');
  
  setupUrlChangeListener();
  await updatePageInfo();
  
  // 监听来自扩展的消息
  chrome.runtime.onMessage.addListener(handleMessage);
  
  // 监听窗口消息
  setupWindowMessageListener();
}

// 设置窗口消息监听器，处理iframe通信
function setupWindowMessageListener() {
  window.addEventListener('message', (event) => {
    console.log('收到窗口消息:', event.data);
    
    // 确保消息有效且有action属性
    if (!event.data || !event.data.action) {
      return;
    }
    
    // 处理不同类型的action
    switch (event.data.action) {
      case 'playVideo':
        console.log('收到播放视频消息');
        const video = document.querySelector('video');
        if (video) {
          console.log('尝试播放视频元素');
          video.play()
            .then(() => console.log('通过消息播放视频成功'))
            .catch(err => console.error('通过消息播放视频失败:', err));
        } else {
          console.log('未找到视频元素，尝试点击播放按钮');
          const playBtn = document.querySelector('.xgplayer-play') || 
                          document.querySelector('[class*="play"]') ||
                          document.querySelector('[aria-label*="播放"]');
          if (playBtn) {
            playBtn.click();
          }
        }
        break;
        
      case 'pauseVideo':
        console.log('收到暂停视频消息');
        const videoToPause = document.querySelector('video');
        if (videoToPause) {
          console.log('尝试暂停视频元素');
          videoToPause.pause();
        } else {
          console.log('未找到视频元素，尝试点击暂停按钮');
          const pauseBtn = document.querySelector('.xgplayer-pause') || 
                           document.querySelector('[class*="pause"]') ||
                           document.querySelector('[aria-label*="暂停"]');
          if (pauseBtn) {
            pauseBtn.click();
          }
        }
        break;
        
      // 可以添加其他消息类型处理
    }
  });
  
  console.log('已设置窗口消息监听器');
}

// 快速检查网站类型（不依赖配置）
function quickCheckSite(url) {
  if (!url) return null;
  
  // 转换为小写，便于匹配
  const lowercaseUrl = url.toLowerCase();
  
  for (const site of SUPPORTED_SITES) {
    if (site.domains.some(domain => lowercaseUrl.includes(domain.toLowerCase()))) {
      return site;
    }
  }
  
  return null;
}

// 加载配置
async function loadConfiguration() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('加载配置失败:', chrome.runtime.lastError);
        
        // 通信失败时使用内部默认配置
        config = { supportedSites: SUPPORTED_SITES };
        console.log('使用内部默认配置');
        
      } else if (response && response.config) {
        config = response.config;
        console.log('已加载配置，支持的网站数量:', 
                   config.supportedSites ? config.supportedSites.length : 0);
                   
        // 如果配置中的supportedSites为空，使用内部默认配置
        if (!config.supportedSites || config.supportedSites.length === 0) {
          console.log('配置中没有支持的网站，使用内部默认配置');
          config.supportedSites = SUPPORTED_SITES;
        }
      } else {
        // 没有返回配置时使用内部默认配置
        config = { supportedSites: SUPPORTED_SITES };
        console.log('后台未返回配置，使用内部默认配置');
      }
      
      // 获取当前网站信息
      const url = window.location.href;
      
      // 如果快速检测没有找到网站信息，使用配置再次检测
      if (!siteInfo) {
        siteInfo = getSiteInfo(url, config);
      }
      
      console.log('当前网站:', siteInfo ? siteInfo.id : '不支持的网站', 
                 '当前URL:', url.substring(0, 100) + (url.length > 100 ? '...' : ''));
                 
      // 发送状态消息到侧边栏
      try {
        chrome.runtime.sendMessage({
          type: 'CONTENT_SITE_INFO',
          data: {
            url: url,
            siteInfo: siteInfo,
            supported: !!siteInfo
          }
        });
      } catch (e) {
        console.error('发送网站信息到后台失败:', e);
      }
      
      resolve();
    });
  });
}

// 处理来自扩展的消息
function handleMessage(message, sender, sendResponse) {
  if (!message || !message.type) {
    sendResponse({ success: false, error: '无效的消息' });
    return;
  }
  
  switch (message.type) {
    case 'GET_PAGE_INFO':
      getPageInfo().then(sendResponse);
      return true; // 异步响应
      
    case 'PLAY_VIDEO':
      playVideo().then(sendResponse);
      return true;
      
    case 'PAUSE_VIDEO':
      pauseVideo().then(sendResponse);
      return true;
      
    case 'ANALYZE_CONTENT':
      analyzeContent().then(sendResponse);
      return true;
      
    default:
      sendResponse({ success: false, error: '未知的消息类型' });
      return false;
  }
}

// 获取页面信息
async function getPageInfo() {
  try {
    if (!siteInfo) {
      return { success: false, error: '不支持的网站' };
    }
    
    const pageData = {};
    
    // 根据网站ID提取相应内容
    switch (siteInfo.id.toLowerCase()) {
      case 'bilibili':
        pageData.title = document.querySelector('h1.video-title')?.textContent?.trim() || '';
        pageData.uploader = document.querySelector('.up-name')?.textContent?.trim() || '';
        pageData.url = window.location.href;
        pageData.description = document.querySelector('.desc-info')?.textContent?.trim() || '';
        pageData.viewCount = document.querySelector('.view.item')?.textContent?.trim() || '';
        pageData.likeCount = document.querySelector('.like.item')?.textContent?.trim() || '';
        pageData.danmuCount = document.querySelector('.dm.item')?.textContent?.trim() || '';
        pageData.publishTime = document.querySelector('.pubdate-text')?.textContent?.trim() || '';
        pageData.tags = Array.from(document.querySelectorAll('.tag-link')).map(tag => tag.textContent.trim());
        break;
        
      case 'youtube':
        pageData.title = document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || '';
        pageData.uploader = document.querySelector('#owner #channel-name')?.textContent?.trim() || '';
        pageData.url = window.location.href;
        pageData.description = document.querySelector('#description-inline-expander')?.textContent?.trim() || '';
        pageData.viewCount = document.querySelector('.view-count')?.textContent?.trim() || '';
        const likeButton = document.querySelector('button.yt-spec-button-shape-next--icon-button yt-formatted-string');
        pageData.likeCount = likeButton ? likeButton.textContent.trim() : '';
        pageData.publishTime = document.querySelector('#info-strings yt-formatted-string')?.textContent?.trim() || '';
        break;
        
      case 'douyin':
        pageData.title = document.querySelector('.VVX0yR36')?.textContent?.trim() || 
                         document.querySelector('.A1XYTxI5')?.textContent?.trim() || 
                         document.querySelector('.aQoncqRg')?.textContent?.trim() || '';
        pageData.uploader = document.querySelector('.yy3pFu0l a')?.textContent?.trim() || 
                            document.querySelector('.vCiuzZmL a')?.textContent?.trim() || '';
        pageData.url = window.location.href;
        pageData.description = document.querySelector('.HbzKJxgD')?.textContent?.trim() || 
                               document.querySelector('.EgRysJvN')?.textContent?.trim() || '';
        pageData.viewCount = document.querySelector('.CE7XkkTw')?.textContent?.trim() || '';
        pageData.likeCount = document.querySelector('.xm7LxYwy button:first-child')?.getAttribute('aria-label')?.replace(/\D/g, '') || '';
        pageData.commentCount = document.querySelector('.xm7LxYwy button:nth-child(2)')?.getAttribute('aria-label')?.replace(/\D/g, '') || '';
        pageData.publishTime = document.querySelector('.aQoncqRg')?.textContent?.trim() || '';
        pageData.tags = Array.from(document.querySelectorAll('.pFyasgy8')).map(tag => tag.textContent.trim());
        break;
        
      case 'zhihu':
        if (window.location.href.includes('/answer/')) {
          pageData.title = document.querySelector('.QuestionHeader-title')?.textContent?.trim() || '';
          pageData.uploader = document.querySelector('.AuthorInfo-name')?.textContent?.trim() || '';
          pageData.url = window.location.href;
          pageData.description = document.querySelector('.RichContent-inner')?.textContent?.trim() || '';
          pageData.viewCount = document.querySelector('.NumberBoard-itemValue')?.textContent?.trim() || '';
          pageData.publishTime = document.querySelector('.ContentItem-time')?.textContent?.trim() || '';
        }
        break;
        
      // 可根据需要添加其他网站
      default:
        pageData.title = document.title;
        pageData.url = window.location.href;
        pageData.content = document.body.textContent.substr(0, 5000); // 限制内容长度
    }
    
    // 返回提取的信息
    return { 
      success: true, 
      data: {
        siteId: siteInfo.id,
        pageInfo: pageData
      }
    };
  } catch (error) {
    console.error('获取页面信息错误:', error);
    return { success: false, error: error.message };
  }
}

// 播放视频
async function playVideo() {
  try {
    if (!siteInfo) {
      return { success: false, error: '不支持的网站' };
    }
    
    let video = null;
    
    // 根据网站获取视频元素
    switch (siteInfo.id.toLowerCase()) {
      case 'bilibili':
        console.log('尝试控制B站视频播放');
        // 尝试多种B站视频选择器
        video = document.querySelector('video.bilibili-player-video') || 
                document.querySelector('.bpx-player-video-wrap video') ||
                document.querySelector('.bilibili-player-area video') ||
                document.querySelector('.player-wrap video') ||
                document.querySelector('video');
                
        console.log('B站视频元素查找结果:', video ? '找到视频元素' : '未找到视频元素');
                
        // 如果没有找到视频元素，尝试点击播放按钮
        if (!video) {
          const playBtn = document.querySelector('.bilibili-player-video-btn-start') ||
                         document.querySelector('.bpx-player-ctrl-play') ||
                         document.querySelector('.bilibili-player-iconfont-start') ||
                         document.querySelector('.squirtle-video-start') ||
                         document.querySelector('.bilibili-player-dm-tip-wrap');
                         
          console.log('B站播放按钮查找结果:', playBtn ? '找到播放按钮' : '未找到播放按钮');
                         
          if (playBtn) {
            playBtn.click();
            console.log('已点击B站播放按钮');
            
            // 点击后再次尝试获取视频元素
            setTimeout(() => {
              const videoAfterClick = document.querySelector('video.bilibili-player-video') ||
                                     document.querySelector('.bpx-player-video-wrap video') ||
                                     document.querySelector('.bilibili-player-area video') ||
                                     document.querySelector('.player-wrap video') ||
                                     document.querySelector('video');
                                     
              if (videoAfterClick) {
                console.log('点击后找到B站视频元素，尝试播放');
                videoAfterClick.play()
                  .then(() => console.log('B站视频播放成功'))
                  .catch(err => console.error('B站视频播放失败:', err));
              }
            }, 500);
            
            return { success: true, message: '已尝试点击B站播放按钮' };
          }
        } else {
          // 尝试直接调用play方法并处理可能的Promise
          console.log('找到B站视频元素，尝试调用play()方法');
          try {
            const playPromise = video.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => console.log('B站视频播放成功'))
                .catch(err => {
                  console.error('B站视频播放失败:', err);
                  // 如果直接播放失败，尝试点击播放按钮
                  const playBtn = document.querySelector('.bilibili-player-video-btn-start') ||
                                document.querySelector('.bpx-player-ctrl-play') ||
                                document.querySelector('.bilibili-player-iconfont-start');
                  if (playBtn) {
                    console.log('尝试点击B站播放按钮');
                    playBtn.click();
                  }
                });
            }
          } catch (e) {
            console.error('B站视频播放异常:', e);
          }
        }
        break;
        
      case 'youtube':
        video = document.querySelector('video.html5-main-video');
        break;
        
      case 'douyin':
        // 先查找是否在iframe中或处理iframe中的视频
        if (handleDouyinIframeVideo('playVideo')) {
          console.log('已处理抖音iframe视频播放');
          return { success: true, message: '已尝试在iframe中播放视频' };
        }

        // 打印页面中所有视频元素，帮助调试
        const allVideos = document.querySelectorAll('video');
        console.log('页面中视频元素数量:', allVideos.length);
        if (allVideos.length > 0) {
          console.log('第一个视频元素类名:', allVideos[0].className);
          console.log('第一个视频元素父元素:', allVideos[0].parentElement?.className || '无父元素');
        }

        // 抖音视频元素选择器 - 增强版
        const douyinSelectors = [
          'video.xgplayer-video',
          '.tiktok-web-player video',
          '.player-container video',
          '.swiper-slide-active video',
          'video[src*="douyin"]',
          'xg-video video'
        ];
        
        // 尝试找到视频元素
        let videoFound = false;
        for (const selector of douyinSelectors) {
          const videos = document.querySelectorAll(selector);
          console.log(`选择器 ${selector} 找到 ${videos.length} 个视频元素`);
          
          for (const video of videos) {
            try {
              if (video) {
                video.play();
                console.log('成功播放视频元素', video);
                videoFound = true;
                return true;
              }
            } catch (e) {
              console.error(`尝试播放视频时出错: ${e.message}`);
            }
          }
        }
        
        // 如果没有找到视频元素，尝试点击播放按钮
        if (!videoFound) {
          console.log('未找到视频元素，尝试点击播放按钮');
          
          const playButtonSelectors = [
            '.xgplayer-play',
            '.xgplayer-play-img',
            '.xgplayer-icon-play',
            '.play-button',
            '[data-e2e="play-icon"]',
            '.video-play-btn'
          ];
          
          for (const selector of playButtonSelectors) {
            const playButton = document.querySelector(selector);
            if (playButton) {
              playButton.click();
              console.log('点击了播放按钮', selector);
              return true;
            }
          }
          
          // 尝试点击视频容器
          const containerSelectors = [
            '.xgplayer',
            '.video-container',
            '.player-container',
            '.swiper-slide-active',
            '[data-e2e="feed-video"]'
          ];
          
          for (const selector of containerSelectors) {
            const container = document.querySelector(selector);
            if (container) {
              container.click();
              console.log('点击了视频容器', selector);
              return true;
            }
          }
          
          // 检查是否在iframe中，如果是，向父页面发送消息
          if (window !== window.top) {
            console.log('在iframe中，向父页面发送播放消息');
            window.parent.postMessage({ action: 'playVideo' }, '*');
            return true;
          }
          
          console.error('无法找到抖音视频或播放按钮');
          return false;
        }
        break;
        
      case 'zhihu':
        // 知乎视频播放
        let zhihuVideo = document.querySelector('.ZVideoItem video');
        if (zhihuVideo) {
          zhihuVideo.play();
          return true;
        }
        break;
        
      // 其他站点...
      
      default:
        console.error('不支持的站点类型:', siteInfo.id);
        return false;
    }
    
    if (video) {
      video.play();
      return { success: true };
    } else {
      return { success: false, error: '未找到视频元素' };
    }
  } catch (error) {
    console.error('播放视频错误:', error);
    return { success: false, error: error.message };
  }
}

// 暂停视频
async function pauseVideo() {
  try {
    if (!siteInfo) {
      return { success: false, error: '不支持的网站' };
    }
    
    let video = null;
    
    // 根据网站获取视频元素
    switch (siteInfo.id.toLowerCase()) {
      case 'bilibili':
        console.log('尝试暂停B站视频');
        // 尝试多种B站视频选择器
        video = document.querySelector('video.bilibili-player-video') || 
                document.querySelector('.bpx-player-video-wrap video') ||
                document.querySelector('.bilibili-player-area video') ||
                document.querySelector('.player-wrap video') ||
                document.querySelector('video');
                
        console.log('B站视频元素查找结果:', video ? '找到视频元素' : '未找到视频元素');
                
        // 如果没有找到视频元素，尝试点击暂停按钮
        if (!video) {
          const pauseBtn = document.querySelector('.bilibili-player-video-btn-start.video-state-pause') ||
                          document.querySelector('.bpx-player-ctrl-play.bpx-player-ctrl-paused') ||
                          document.querySelector('.bilibili-player-iconfont-pause') ||
                          document.querySelector('.squirtle-video-pause');
                          
          console.log('B站暂停按钮查找结果:', pauseBtn ? '找到暂停按钮' : '未找到暂停按钮');
                          
          if (pauseBtn) {
            pauseBtn.click();
            console.log('已点击B站暂停按钮');
            return { success: true, message: '已尝试点击B站暂停按钮' };
          }
        } else {
          // 尝试直接调用pause方法
          console.log('找到B站视频元素，尝试调用pause()方法');
          try {
            video.pause();
            console.log('B站视频暂停成功');
          } catch (e) {
            console.error('B站视频暂停异常:', e);
            // 如果直接暂停失败，尝试点击暂停按钮
            const pauseBtn = document.querySelector('.bilibili-player-video-btn-start.video-state-pause') ||
                           document.querySelector('.bpx-player-ctrl-play.bpx-player-ctrl-paused') ||
                           document.querySelector('.bilibili-player-iconfont-pause');
            if (pauseBtn) {
              console.log('尝试点击B站暂停按钮');
              pauseBtn.click();
            }
          }
        }
        break;
        
      case 'youtube':
        video = document.querySelector('video.html5-main-video');
        break;
        
      case 'douyin':
        // 先查找是否在iframe中或处理iframe中的视频
        if (handleDouyinIframeVideo('pauseVideo')) {
          console.log('已处理抖音iframe视频暂停');
          return { success: true, message: '已尝试在iframe中暂停视频' };
        }
        
        // 打印页面中所有视频元素，帮助调试
        const allVideosForPause = document.querySelectorAll('video');
        console.log('页面中视频元素数量:', allVideosForPause.length);
        if (allVideosForPause.length > 0) {
          console.log('第一个视频元素类名:', allVideosForPause[0].className);
          console.log('第一个视频元素父元素:', allVideosForPause[0].parentElement?.className || '无父元素');
        }
        
        // 抖音视频元素选择器 - 增强版
        const douyinSelectorsForPause = [
          'video.xgplayer-video',
          '.tiktok-web-player video',
          '.player-container video',
          '.swiper-slide-active video',
          'video[src*="douyin"]',
          'xg-video video'
        ];
        
        // 尝试找到视频元素
        let videoFoundForPause = false;
        for (const selector of douyinSelectorsForPause) {
          const videosForPause = document.querySelectorAll(selector);
          console.log(`选择器 ${selector} 找到 ${videosForPause.length} 个视频元素`);
          
          for (const video of videosForPause) {
            try {
              if (video) {
                video.pause();
                console.log('成功暂停视频元素', video);
                videoFoundForPause = true;
                return true;
              }
            } catch (e) {
              console.error(`尝试暂停视频时出错: ${e.message}`);
            }
          }
        }
        
        // 如果没有找到视频元素，尝试点击暂停按钮
        if (!videoFoundForPause) {
          console.log('未找到视频元素，尝试点击暂停按钮');
          
          const pauseButtonSelectors = [
            '.xgplayer-pause',
            '.xgplayer-pause-img',
            '.xgplayer-icon-pause',
            '.pause-button',
            '[data-e2e="pause-icon"]',
            '.video-pause-btn'
          ];
          
          for (const selector of pauseButtonSelectors) {
            const pauseButton = document.querySelector(selector);
            if (pauseButton) {
              pauseButton.click();
              console.log('点击了暂停按钮', selector);
              return true;
            }
          }
          
          // 尝试点击视频容器
          const containerSelectors = [
            '.xgplayer',
            '.video-container',
            '.player-container',
            '.swiper-slide-active',
            '[data-e2e="feed-video"]'
          ];
          
          for (const selector of containerSelectors) {
            const container = document.querySelector(selector);
            if (container) {
              container.click();
              console.log('点击了视频容器', selector);
              return true;
            }
          }
          
          // 检查是否在iframe中，如果是，向父页面发送消息
          if (window !== window.top) {
            console.log('在iframe中，向父页面发送暂停消息');
            window.parent.postMessage({ action: 'pauseVideo' }, '*');
            return true;
          }
          
          console.error('无法找到抖音视频或暂停按钮');
          return false;
        }
        break;
        
      case 'zhihu':
        // 知乎视频暂停
        let zhihuVideo = document.querySelector('.ZVideoItem video');
        if (zhihuVideo) {
          zhihuVideo.pause();
          return true;
        }
        break;
        
      // 其他站点...
      
      default:
        console.error('不支持的站点类型:', siteInfo.id);
        return false;
    }
    
    if (video) {
      video.pause();
      return { success: true };
    } else {
      return { success: false, error: '未找到视频元素' };
    }
  } catch (error) {
    console.error('暂停视频错误:', error);
    return { success: false, error: error.message };
  }
}

// 分析页面内容
async function analyzeContent() {
  try {
    // 获取页面信息
    const pageInfoResult = await getPageInfo();
    
    if (!pageInfoResult.success) {
      return pageInfoResult;
    }
    
    // 页面信息提取成功
    const { siteId, pageInfo } = pageInfoResult.data;
    
    // 获取页面文本内容（例如评论、描述等）
    let textContent = '';
    
    // 根据网站获取文本内容
    switch (siteId.toLowerCase()) {
      case 'bilibili':
        // 获取视频描述
        textContent += '视频描述: ' + (pageInfo.description || '无描述') + '\n\n';
        
        // 获取评论
        const comments = Array.from(document.querySelectorAll('.reply-item')).slice(0, 10); // 限制评论数量
        if (comments.length > 0) {
          textContent += '热门评论:\n';
          comments.forEach((comment, index) => {
            const username = comment.querySelector('.user-name')?.textContent?.trim() || '匿名用户';
            const content = comment.querySelector('.reply-content')?.textContent?.trim() || '';
            textContent += `${index + 1}. ${username}: ${content}\n`;
          });
        }
        break;
        
      case 'youtube':
        // 获取视频描述
        textContent += '视频描述: ' + (pageInfo.description || '无描述') + '\n\n';
        
        // 获取评论 (YouTube需要滚动加载评论，可能不完整)
        const ytComments = Array.from(document.querySelectorAll('ytd-comment-renderer')).slice(0, 10);
        if (ytComments.length > 0) {
          textContent += '热门评论:\n';
          ytComments.forEach((comment, index) => {
            const username = comment.querySelector('#author-text')?.textContent?.trim() || '匿名用户';
            const content = comment.querySelector('#content')?.textContent?.trim() || '';
            textContent += `${index + 1}. ${username}: ${content}\n`;
          });
        }
        break;
        
      default:
        // 对于其他网站，获取一般内容
        const paragraphs = Array.from(document.querySelectorAll('p')).slice(0, 20);
        textContent = paragraphs.map(p => p.textContent.trim()).join('\n\n');
    }
    
    // 将文本内容添加到页面信息中
    pageInfo.textContent = textContent;
    
    return { 
      success: true, 
      data: {
        siteId,
        pageInfo
      }
    };
  } catch (error) {
    console.error('分析内容错误:', error);
    return { success: false, error: error.message };
  }
}

// 根据URL获取网站信息
function getSiteInfo(url, config) {
  console.log('开始检查网站信息. URL:', url);
  
  if (!url) {
    console.error('URL为空');
    return null;
  }
  
  // 首先尝试使用快速检测方法
  const quickResult = quickCheckSite(url);
  if (quickResult) {
    console.log('通过快速检测找到网站:', quickResult.id);
    return quickResult;
  }
  
  // 如果快速检测失败，尝试使用配置
  if (!config || !config.supportedSites || !Array.isArray(config.supportedSites)) {
    console.error('配置无效或supportedSites不是数组');
    return null;
  }
  
  // 标准化URL以便更好地匹配
  const normalizedUrl = url.toLowerCase();
  
  // 遍历所有支持的网站
  for (const site of config.supportedSites) {
    if (!site.enabled) {
      continue;
    }
    
    if (!site.domains || !Array.isArray(site.domains)) {
      continue;
    }
    
    // 检查域名匹配
    for (const domain of site.domains) {
      if (normalizedUrl.includes(domain.toLowerCase())) {
        console.log(`找到匹配的网站: ${site.id || site.name}, 匹配域名: ${domain}`);
        return site;
      }
    }
  }
  
  console.warn('没有找到匹配的网站');
  return null;
}

// 处理抖音iframe内的视频
function handleDouyinIframeVideo(action) {
  console.log('尝试处理抖音iframe内的视频，操作:', action);
  
  // 查找所有iframe元素
  const iframes = document.querySelectorAll('iframe');
  console.log('页面中iframe数量:', iframes.length);
  
  if (iframes.length === 0) {
    return false;
  }
  
  // 尝试给每个iframe注入脚本
  let success = false;
  
  // 发送消息给父页面
  try {
    window.parent.postMessage({ action: action }, '*');
    console.log('已向父页面发送消息:', action);
    success = true;
  } catch (e) {
    console.error('向父页面发送消息失败', e);
  }
  
  // 尝试直接操作每个iframe
  Array.from(iframes).forEach((iframe, index) => {
    try {
      console.log(`处理第${index+1}个iframe:`, iframe.src || 'iframe无src属性');
      
      // 尝试访问iframe内容
      const iframeDocument = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDocument) {
        console.log('成功访问iframe文档');
        
        // 查找iframe内的视频元素
        const iframeVideo = iframeDocument.querySelector('video');
        if (iframeVideo) {
          console.log('在iframe中找到视频元素');
          
          if (action === 'playVideo') {
            iframeVideo.play()
              .then(() => console.log('iframe视频播放成功'))
              .catch(err => console.error('iframe视频播放失败:', err));
          } else if (action === 'pauseVideo') {
            iframeVideo.pause();
            console.log('iframe视频暂停成功');
          }
          
          success = true;
        } else {
          console.log('iframe中未找到视频元素');
          
          // 尝试点击iframe中的播放/暂停按钮
          const btnSelector = action === 'playVideo' 
            ? '.xgplayer-play, [class*="play"], [aria-label*="播放"]'
            : '.xgplayer-pause, [class*="pause"], [aria-label*="暂停"]';
            
          const button = iframeDocument.querySelector(btnSelector);
          if (button) {
            console.log(`在iframe中找到${action === 'playVideo' ? '播放' : '暂停'}按钮`);
            button.click();
            success = true;
          }
          
          // 如果没有找到按钮，尝试点击视频容器
          if (!button) {
            const container = iframeDocument.querySelector('.xgplayer, [class*="player"], [class*="video"]');
            if (container) {
              console.log('尝试点击iframe中的视频容器');
              container.click();
              success = true;
            }
          }
        }
      } else {
        console.log('无法访问iframe内容，可能是跨域限制');
      }
    } catch (e) {
      console.error(`处理iframe ${index+1} 失败:`, e);
    }
  });
  
  return success;
}

// 新增：更新页面信息的函数
async function updatePageInfo() {
  const url = window.location.href;
  const config = await loadConfiguration();
  const site = getSiteInfo(url, config);
  
  console.log('发送页面更新信息:', {
    url: url,
    siteInfo: site,
    supported: !!site
  });
  
  try {
    chrome.runtime.sendMessage({
      type: 'PAGE_INFO_UPDATED',
      data: {
        url: url,
        siteInfo: site,
        supported: !!site,
        pageInfo: await getBasicPageInfo(site)
      }
    });
  } catch (e) {
    console.error('发送页面信息失败:', e);
  }
}

// 新增：获取基本页面信息
async function getBasicPageInfo(site) {
  if (!site) return null;
  
  const pageData = {};
  
  switch (site.id.toLowerCase()) {
    case 'bilibili':
      pageData.title = document.querySelector('h1.video-title')?.textContent?.trim() || '';
      pageData.uploader = document.querySelector('.up-name')?.textContent?.trim() || '';
      break;
      
    case 'douyin':
      pageData.title = document.querySelector('.VVX0yR36, .aQoncqRg')?.textContent?.trim() || '';
      pageData.uploader = document.querySelector('.yy3pFu0l a, .vCiuzZmL a')?.textContent?.trim() || '';
      break;
      
    // 其他网站...
  }
  
  pageData.url = window.location.href;
  return pageData;
}

// 添加URL变化监听
function setupUrlChangeListener() {
  let lastUrl = window.location.href;

  // 监听 History API 变化
  const pushState = window.history.pushState;
  window.history.pushState = function() {
    pushState.apply(history, arguments);
    onUrlChange();
  };

  const replaceState = window.history.replaceState;
  window.history.replaceState = function() {
    replaceState.apply(history, arguments);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);

  // 使用 MutationObserver 监听 DOM 变化
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onUrlChange();
    }
  });

  observer.observe(document.querySelector('head'), {
    childList: true,
    subtree: true
  });
}

// URL变化处理
async function onUrlChange() {
  console.log('URL已变化，更新页面信息');
  await updatePageInfo();
}

// 启动初始化
console.log('内容脚本初始化中...');
initialize();