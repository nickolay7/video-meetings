import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Регистратор MCP-примитивов домена (инструменты, ресурсы, промпты). Домен инжектит свои
 * сервисы через стандартный NestDI, реализует `register()` и регистрирует примитивы на
 * переданном `McpServer` из `@modelcontextprotocol/sdk`. Каждый домен предоставляет свой
 * регистратор провайдером с токеном `MCP_TOOL_REGISTER` и флагом `multi: true` — McpService
 * получает массив всех регистраторов и вызывает `register()` при создании MCP-сервера.
 */
export interface McpToolRegister {
  /** Регистрирует инструменты/ресурсы/промпты домена на MCP-сервере. */
  register(server: McpServer): void;
}
