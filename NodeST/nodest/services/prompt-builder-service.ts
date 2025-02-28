import { ChatMessage } from '../../../shared/types';

/**
 * D类条目接口定义
 */
export interface DEntry {
  name: string;                  // 条目名称 
  content: string;               // 条目内容
  role?: "user" | "model";       // 条目角色，默认为 "user"
  position?: number;             // 条目位置（0-4）
  depth?: number;                // 插入深度
  constant?: boolean;            // 是否始终包含
  key?: string[];                // 触发关键词
  identifier?: string;           // 条目唯一标识
}

/**
 * R框架条目接口定义
 */
export interface RFrameworkEntry {
  name: string;                  // 条目名称
  content: string;               // 条目内容
  role?: "user" | "model" | "system" ;       // 条目角色，默认为 "user"
  identifier?: string;           // 条目唯一标识
  isChatHistory?: boolean;       // 是否为聊天历史容器
}

/**
 * 构建请求选项接口
 */
export interface PromptBuilderOptions {
  rFramework: RFrameworkEntry[];      // R框架条目
  dEntries?: DEntry[];                // D类条目
  chatHistory?: ChatMessage[];        // 聊天历史 
  userMessage?: string;               // 用户消息
  maxHistoryLength?: number;          // 最大历史消息数，默认15
}

/**
 * 提示词构建服务，用于统一管理R框架和D类条目的构建
 */
export class PromptBuilderService {
  /**
   * 构建完整的请求体
   * @param options 构建选项
   * @returns 构建后的消息数组
   */
  static buildPrompt(options: PromptBuilderOptions): any[] {
    const {
      rFramework,
      dEntries = [],
      chatHistory = [],
      userMessage,
      maxHistoryLength = 15
    } = options;

    // 1. 构建基础消息数组（R框架部分）
    const messages: any[] = [];
    let chatHistoryIndex = -1;
    
    // 1.1 处理R框架条目
    rFramework.forEach((entry, index) => {
      if (entry.isChatHistory) {
        // 记录聊天历史插入点
        chatHistoryIndex = messages.length;
        messages.push({
          name: entry.name,
          role: entry.role || "system",
          parts: [],
          identifier: entry.identifier
        });
      } else {
        // 添加普通R框架条目
        messages.push({
          name: entry.name,
          role: entry.role || "user",
          parts: [{ text: entry.content }],
          identifier: entry.identifier
        });
      }
    });

    // 如果没有找到聊天历史插入点，则追加到末尾
    if (chatHistoryIndex === -1 && (chatHistory.length > 0 || userMessage)) {
      chatHistoryIndex = messages.length;
      messages.push({
        name: "Chat History",
        role: "system",
        parts: [],
        identifier: "chatHistory"
      });
    }

    // 2. 处理聊天历史和D类条目
    // 2.1 如果有聊天历史或用户消息
    if (chatHistoryIndex !== -1) {
      // 限制历史消息长度
      const trimmedHistory = chatHistory.slice(-maxHistoryLength);
      
      // 处理常规历史消息（不包含D类条目）
      const processedHistory = this.processHistory(trimmedHistory);
      
      // 如果有新的用户消息，添加到历史末尾
      if (userMessage) {
        processedHistory.push({
          role: "user",
          parts: [{ text: userMessage }]
        });
      }
      
      // 将D类条目插入到历史中
      const historyWithDEntries = this.insertDEntriesToHistory(
        processedHistory,
        dEntries,
        userMessage || ''
      );
      
      // 设置聊天历史
      messages[chatHistoryIndex].parts = historyWithDEntries;
    }

    // 3. 记录日志
    console.log(`[PromptBuilderService] 构建完成：R框架条目数=${rFramework.length}，D类条目数=${dEntries.length}，历史消息数=${chatHistory?.length}`);

    return messages;
  }

  /**
   * 将D类条目插入到历史中
   * @param history 聊天历史
   * @param dEntries D类条目
   * @param baseMessage 基准消息（通常是用户最新消息）
   * @returns 插入D类条目后的聊天历史
   */
  private static insertDEntriesToHistory(
    history: any[],
    dEntries: DEntry[],
    baseMessage: string
  ): any[] {
    // If no D entries or history, return original history
    if (dEntries.length === 0 || history.length === 0) {
      return history;
    }

    console.log(`[PromptBuilderService] Inserting ${dEntries.length} D-entries with base message: ${baseMessage.substring(0, 30)}...`);

    // 1. Filter out existing D-entries from history to avoid duplication
    const chatMessages = history.filter(msg => !msg.is_d_entry);
    
    // 2. Find the base message (newest user message)
    const baseMessageIndex = chatMessages.length - 1 - [...chatMessages].reverse().findIndex(
      msg => msg.role === "user" && msg.parts?.[0]?.text === baseMessage
    );
    
    // If base message not found, use the last message as reference
    const effectiveBaseIndex = baseMessageIndex !== -1 ? 
      baseMessageIndex : 
      chatMessages.length - 1;
      
    console.log(`[PromptBuilderService] Base message found at index ${effectiveBaseIndex} of ${chatMessages.length}`);

    // 3. Process position=4 entries (dynamic depth entries)
    const position4Entries = dEntries
      .filter(entry => entry.position === 4 || entry.position === undefined)
      .reduce((acc, entry) => {
        const depth = entry.depth || 0;
        if (!acc[depth]) acc[depth] = [];
        acc[depth].push({
          role: entry.role || "user",
          parts: [{ text: entry.content }],
          is_d_entry: true,
          depth: entry.depth,
          constant: entry.constant,
          identifier: entry.identifier,
          name: entry.name
        });
        return acc;
      }, {} as Record<number, any[]>);

    // Log available depths
    console.log(`[PromptBuilderService] D-entries available at depths: ${Object.keys(position4Entries).join(', ')}`);

    // 4. Process other position entries
    const otherPositionEntries = dEntries
      .filter(entry => entry.position !== undefined && entry.position !== 4)
      .map(entry => ({
        role: entry.role || "user",
        parts: [{ text: entry.content }],
        is_d_entry: true,
        position: entry.position,
        constant: entry.constant,
        identifier: entry.identifier,
        name: entry.name
      }));

    // 5. Build final history
    const finalHistory: any[] = [];
    
    // 5.1 Process regular messages + dynamic depth entries
    for (let i = 0; i < chatMessages.length; i++) {
      const msg = chatMessages[i];
      const depthFromBase = effectiveBaseIndex - i;

      // Insert D-entries before current message if depth matches
      if (position4Entries[depthFromBase]) {
        console.log(`[PromptBuilderService] Inserting ${position4Entries[depthFromBase].length} entries at depth=${depthFromBase}`);
        finalHistory.push(...position4Entries[depthFromBase]);
      }

      // Insert current message
      finalHistory.push(msg);

      // If this is the base message, insert depth=0 entries after it
      if (i === effectiveBaseIndex && position4Entries[0]) {
        console.log(`[PromptBuilderService] Inserting ${position4Entries[0].length} entries at depth=0 (after base message)`);
        finalHistory.push(...position4Entries[0]);
      }
    }

    // 5.2 Handle special position entries (e.g., around author notes)
    const authorNoteIndex = finalHistory.findIndex(msg => msg.is_author_note);
    if (authorNoteIndex !== -1) {
      const position2Items = otherPositionEntries.filter(e => e.position === 2);
      const position3Items = otherPositionEntries.filter(e => e.position === 3);
      
      // Insert before author note
      for (let i = position2Items.length - 1; i >= 0; i--) {
        finalHistory.splice(authorNoteIndex, 0, position2Items[i]);
      }
      
      // Insert after author note
      for (let i = 0; i < position3Items.length; i++) {
        finalHistory.splice(authorNoteIndex + 1 + i, 0, position3Items[i]);
      }
    }
    
    // Log the structure of the final history
    console.log(`[PromptBuilderService] Final history structure: ${finalHistory.length} total entries`);
    console.log(`[PromptBuilderService] D-entries inserted: ${finalHistory.filter(msg => msg.is_d_entry).length}`);
    
    // Return the history with inserted D-entries
    return finalHistory;
  }

  /**
   * 处理聊天历史，将其转换为标准格式
   */
  private static processHistory(history: ChatMessage[]): any[] {
    return history.map(msg => {
      // 跳过已经是D类条目的消息，它们将在insertDEntriesToHistory中处理
      if (msg.is_d_entry) return null;
      
      // 将角色映射为LLM接口要求的格式
      const role = msg.role === "assistant" || msg.role === "model" ? 
        "model" : "user";
      
      // 返回标准格式的消息
      return {
        role,
        parts: msg.parts || [{ text: (msg.parts?.[0] as { text: string })?.text || "" }],
        timestamp: msg.timestamp
      };
    }).filter(Boolean); // 过滤掉null值
  }

  /**
   * 将完整的消息数组转换为适合API请求的文本格式
   */
  static messagesToText(messages: any[]): string {
    return messages.map(msg => {
      // 处理消息数组
      if (Array.isArray(msg.parts)) {
        interface MessagePart {
            text: string;
        }

        return msg.parts.map((part: MessagePart): string => part.text || "").join("\n");
      } 
      // 处理单一文本消息
      else if (typeof msg.parts?.[0]?.text === 'string') {
        return msg.parts[0].text;
      }
      // 处理聊天历史
      else if (msg.name === "Chat History" && Array.isArray(msg.parts)) {
        return msg.parts.map((historyMsg: any) => {
          const prefix = historyMsg.role === "user" ? "用户: " : "AI: ";
          const text = historyMsg.parts?.[0]?.text || "";
          return `${prefix}${text}`;
        }).join("\n\n");
      }
      return '';
    }).filter(text => text.trim() !== '').join("\n\n");
  }

  /**
   * 创建D类条目
   * @param options D类条目配置选项
   */
  static createDEntry(options: DEntry): DEntry {
    return {
      name: options.name,
      content: options.content,
      role: options.role || "user",
      position: options.position || 4, // 默认为动态深度条目
      depth: options.depth || 1,       // 默认深度为1
      constant: options.constant || true, // 默认为常量条目
      key: options.key || [],
      identifier: options.identifier
    };
  }

  /**
   * 创建R框架条目
   * @param options R框架条目配置选项
   */
  static createRFrameworkEntry(options: RFrameworkEntry): RFrameworkEntry {
    return {
      name: options.name,
      content: options.content,
      role: options.role || "user",
      identifier: options.identifier,
      isChatHistory: options.isChatHistory || false
    };
  }

  /**
   * 创建聊天历史容器的R框架条目
   */
  static createChatHistoryContainer(identifier: string = "chatHistory"): RFrameworkEntry {
    return {
      name: "Chat History",
      content: "",
      role: "system",
      identifier,
      isChatHistory: true
    };
  }
}
