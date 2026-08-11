import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** HTTP-запрос, авторизованный `McpAuthGuard`: после успешной проверки содержит `userId`. */
export interface McpAuthRequest {
  headers: Record<string, string | string[] | undefined>;
  userId?: string;
}

/**
 * Guard аутентификации MCP-эндпоинта `/mcp`: проверяет наличие и валидность Bearer-JWT
 * в заголовке `Authorization`. При отсутствии токена, не-Bearer-формате или невалидной
 * подписи — 401 Unauthorized. При успехе кладёт `userId` (поле `sub` из payload) в объект
 * запроса, откуда его подхватывает `McpController` и передаёт дальше как `Requester`.
 *
 * `JwtService` резолвится из глобального `JwtModule` (зарегистрирован в `AuthModule`),
 * поэтому отдельный импорт JwtModule в модуль MCP не требуется.
 */
@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<McpAuthRequest>();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('Missing token');
    }

    const headerValue = String(authHeader);
    if (!headerValue.startsWith('Bearer ')) {
      throw new UnauthorizedException('Invalid token');
    }
    const token = headerValue.slice('Bearer '.length);

    try {
      const payload = this.jwtService.verify<{ sub: string }>(token);
      request.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
