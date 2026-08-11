import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpService } from './mcp.service';

/**
 * HTTP-эндпоинт MCP-протокола: `POST /mcp` (JSON-RPC-запросы), `GET /mcp` (SSE-поток),
 * `DELETE /mcp` (закрытие сессии). `@All()` передаёт все методы в `McpService`, который
 * диспетчеризует их транспортом `StreamableHTTPServerTransport`. Endpoint публичный —
 * авторизация выполняется на уровне данных инструментов (`user_id`/`meeting_id` + `MeetingOwner`).
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.mcpService.handleHttpRequest(req, res);
  }
}
