import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpAuthGuard, type McpAuthRequest } from '../guards/mcp-auth.guard';
import { McpService } from './mcp.service';
import type { Requester } from './requester';

/**
 * HTTP-эндпоинт MCP-протокола: `POST /mcp` (JSON-RPC-запросы), `GET /mcp` (SSE-поток),
 * `DELETE /mcp` (закрытие сессии). `@All()` передаёт все методы в `McpService`, который
 * диспетчеризует их транспортом `StreamableHTTPServerTransport`.
 *
 * Аутентификация — `McpAuthGuard`: без валидного Bearer-JWT в `Authorization` запрос
 * получает 401. Идентифицированный пользователь (`userId` из токена) превращается в
 * `Requester` и передаётся в `McpService`, а тот — в регистраторы инструментов для
 * авторизации на уровне данных (владелец встречи/задачи).
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @All()
  @UseGuards(McpAuthGuard)
  async handle(@Req() req: McpAuthRequest & Request, @Res() res: Response): Promise<void> {
    // Guard гарантирует userId после успешной аутентификации (иначе — 401).
    const requester: Requester = { id: req.userId! };
    await this.mcpService.handleHttpRequest(req, res, requester);
  }
}
