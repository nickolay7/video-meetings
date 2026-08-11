/**
 * DI-токен регистраторов MCP-примитивов. Доменные модули предоставляют свои регистраторы
 * (классы, реализующие `McpToolRegister`) с флагом `multi: true`; McpService инжектит
 * массив всех зарегистрированных регистраторов и применяет их к MCP-серверу при каждом
 * HTTP-запросе (в stateless-режиме сервер создаётся на запрос).
 */
export const MCP_TOOL_REGISTER = Symbol('MCP_TOOL_REGISTER');

export const DEFAULT_MCP_SERVER_NAME = 'meeting-tasks';
export const DEFAULT_MCP_SERVER_VERSION = '1.0.0';

/**
 * Имя MCP-сервера: env `MCP_SERVER_NAME`, default — `meeting-tasks`. Попадает в
 * `serverInfo` ответа на `initialize` (вместе с версией).
 */
export function getMcpServerName(): string {
  const name = process.env.MCP_SERVER_NAME;
  return name && name.trim() !== '' ? name.trim() : DEFAULT_MCP_SERVER_NAME;
}

/**
 * Версия MCP-сервера: env `MCP_SERVER_VERSION`, default — `1.0.0`.
 */
export function getMcpServerVersion(): string {
  const version = process.env.MCP_SERVER_VERSION;
  return version && version.trim() !== '' ? version.trim() : DEFAULT_MCP_SERVER_VERSION;
}
