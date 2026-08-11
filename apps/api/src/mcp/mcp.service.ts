import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getMcpServerName, getMcpServerVersion, MCP_TOOL_REGISTER } from './mcp.constants';
import type { McpToolRegister } from './mcp-tool-register';
import type { Requester } from './requester';

/**
 * Сервис MCP-сервера поверх HTTP (endpoint `/mcp`). Один экземпляр на приложение: инжектит
 * массив регистраторов всех доменов (`MCP_TOOL_REGISTER`, собирается в `McpModule`) и
 * обрабатывает каждый входящий HTTP-запрос по протоколу Streamable HTTP.
 *
 * Stateless-режим (`sessionIdGenerator: undefined`) + `enableJsonResponse: true`: ответы на
 * POST возвращаются как JSON, сессии не создаются. Аутентификация выполнена `McpAuthGuard`
 * на уровне контроллера; идентифицированный `Requester` пробрасывается сюда и дальше —
 * в регистраторы инструментов для авторизации на уровне данных (`MeetingOwner`).
 * Особенность SDK: stateless-транспорт обрабатывает ровно один запрос, а `McpServer` может
 * быть подключён к одному транспорту за время жизни, — поэтому на каждый запрос создаётся
 * свежий `McpServer` + транспорт (регистрация инструментов дешёвая, репозитории/сервисы
 * общие через DI).
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    @Inject(MCP_TOOL_REGISTER)
    private readonly toolRegistrars: McpToolRegister[],
  ) {}

  /**
   * Обрабатывает HTTP-запрос к `/mcp`: создаёт свежий MCP-сервер с инструментами всех
   * доменов, подключает его к свежему `StreamableHTTPServerTransport` и передаёт Node-`req/res`
   * транспорту (обёртка сама конвертирует в Web Request/Response и пробрасывает SSE-потоки).
   * `requester` — идентифицированный пользователь, подключающийся к серверу.
   */
  async handleHttpRequest(
    req: ExpressRequest,
    res: ExpressResponse,
    requester: Requester,
  ): Promise<void> {
    const server = this.createServer(requester);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: без сессий и Mcp-Session-Id
      enableJsonResponse: true, // ответы на POST — JSON, а не SSE
    });
    await server.connect(transport);

    this.logger.debug(`MCP ${req.method} ${req.originalUrl}`);
    try {
      // parsedBody — тело уже разобрано глобальным body-parser (Nest), транспорт не читает req.json().
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error(`MCP request failed: ${message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal MCP error' });
      } else {
        res.end();
      }
    }
  }

  /**
   * Собирает MCP-сервер с именем/версией из конфигурации и примитивами всех доменов.
   * `requester` передаётся каждому регистратору: обработчики захватывают его в замыкании,
   * поэтому у каждого запроса свой круг доступа (сервер создаётся на запрос).
   */
  private createServer(requester: Requester): McpServer {
    const server = new McpServer(
      { name: getMcpServerName(), version: getMcpServerVersion() },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );
    for (const registrar of this.toolRegistrars) {
      registrar.register(server, requester);
    }
    return server;
  }
}
