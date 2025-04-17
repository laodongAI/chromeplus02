// ==================== MCP文件系统服务初始化 ====================

// 定义MCP命名空间
window.mcp = window.mcp || {};

// ==================== MCP配置 ====================
// MCP服务配置
const MCP_CONFIG = {
  baseUrl: 'http://localhost:51512', // MCP服务默认端口
  defaultSaveDir: 'D:/mcp/mcp_result_files' // 根据用户配置的目录
};

// ==================== 辅助函数 ====================
// 格式化路径（替换反斜杠为正斜杠）
function formatPath(path) {
  // 如果路径以盘符开头，保留原样
  if (/^[A-Za-z]:/.test(path)) {
    return path.replace(/\\/g, '/');
  }
  
  // 如果是相对路径，添加默认目录
  if (!path.startsWith('/') && !path.includes(':')) {
    return `${MCP_CONFIG.defaultSaveDir}/${path}`;
  }
  
  return path;
}

// ==================== 文件系统服务实现 ====================
// 初始化文件系统服务
window.mcp.filesystem = {
  // 读取文件
  readFile: async function({ path }) {
    try {
      const formattedPath = formatPath(path);
      const response = await fetch(`${MCP_CONFIG.baseUrl}/filesystem/read_file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: formattedPath })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`读取文件失败: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      return data.content;
    } catch (error) {
      console.error('MCP读取文件错误:', error);
      throw error;
    }
  },
  
  // 写入文件
  writeFile: async function({ path, content }) {
    try {
      const formattedPath = formatPath(path);
      console.log(`正在写入文件: ${formattedPath}`);
      
      const response = await fetch(`${MCP_CONFIG.baseUrl}/filesystem/write_file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: formattedPath, content })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`写入文件失败: ${errorData.error || response.statusText}`);
      }
      
      console.log(`文件写入成功: ${formattedPath}`);
      return true;
    } catch (error) {
      console.error('MCP写入文件错误:', error);
      throw error;
    }
  },
  
  // 创建目录
  createDirectory: async function({ path }) {
    try {
      const formattedPath = formatPath(path);
      console.log(`正在创建目录: ${formattedPath}`);
      
      const response = await fetch(`${MCP_CONFIG.baseUrl}/filesystem/create_directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: formattedPath })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`创建目录失败: ${errorData.error || response.statusText}`);
      }
      
      console.log(`目录创建成功: ${formattedPath}`);
      return true;
    } catch (error) {
      console.error('MCP创建目录错误:', error);
      throw error;
    }
  },
  
  // 检查文件存在
  fileExists: async function({ path }) {
    try {
      const formattedPath = formatPath(path);
      const response = await fetch(`${MCP_CONFIG.baseUrl}/filesystem/get_file_info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: formattedPath })
      });
      
      if (response.status === 404) {
        return false;
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`检查文件失败: ${errorData.error || response.statusText}`);
      }
      
      return true;
    } catch (error) {
      if (error.message && error.message.includes('404')) {
        return false;
      }
      console.error('MCP检查文件错误:', error);
      throw error;
    }
  },
  
  // 获取目录列表
  listDirectory: async function({ path }) {
    try {
      const formattedPath = formatPath(path);
      const response = await fetch(`${MCP_CONFIG.baseUrl}/filesystem/list_directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: formattedPath })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`获取目录失败: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('MCP获取目录错误:', error);
      throw error;
    }
  }
};

// ==================== MCP客户端实现 ====================
// 初始化客户端
class McpClient {
  constructor() {
    this.baseUrl = MCP_CONFIG.baseUrl;
    this.defaultSaveDir = MCP_CONFIG.defaultSaveDir;
    this.isAvailable = false;
  }
  
  // 检查MCP服务是否可用
  async checkAvailability() {
    try {
      const response = await fetch(`${this.baseUrl}/filesystem/list_allowed_directories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ random_string: "check" })
      });
      
      if (response.ok) {
        this.isAvailable = true;
        console.log('MCP服务可用');
        return true;
      } else {
        this.isAvailable = false;
        console.error('MCP服务不可用:', response.statusText);
        return false;
      }
    } catch (error) {
      this.isAvailable = false;
      console.error('无法连接到MCP服务:', error);
      return false;
    }
  }
  
  // 保存内容到文件
  async saveToFile(fileName, content) {
    if (!this.isAvailable) {
      await this.checkAvailability();
      if (!this.isAvailable) {
        throw new Error('MCP服务不可用');
      }
    }
    
    // 确保文件名是安全的
    const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_');
    const filePath = `${this.defaultSaveDir}/${safeName}`;
    
    try {
      // 确保目录存在
      await window.mcp.filesystem.createDirectory({ path: this.defaultSaveDir });
      
      // 写入文件
      const result = await window.mcp.filesystem.writeFile({
        path: filePath,
        content: content
      });
      
      return {
        success: result,
        path: filePath
      };
    } catch (error) {
      console.error('保存文件失败:', error);
      throw error;
    }
  }
}

// ==================== 初始化 ====================
// 创建客户端实例并导出
window.mcp.client = new McpClient();

// 启动时检查MCP服务可用性
window.mcp.client.checkAvailability()
  .then(isAvailable => {
    console.log(`MCP服务状态: ${isAvailable ? '可用' : '不可用'}`);
    // 保存状态到存储
    chrome.storage.local.set({ mcpServiceAvailable: isAvailable });
  })
  .catch(error => {
    console.error('检查MCP服务出错:', error);
    chrome.storage.local.set({ mcpServiceAvailable: false });
  });

// 初始化成功消息
console.log('MCP文件系统服务已初始化，配置为:', MCP_CONFIG); 