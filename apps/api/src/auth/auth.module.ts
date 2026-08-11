import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterCommandHandler } from './commands/handlers/register.handler';
import { LoginCommandHandler } from './commands/handlers/login.handler';

const CommandHandlers = [RegisterCommandHandler, LoginCommandHandler];

@Module({
  imports: [
    CqrsModule,
    // Глобальный: JwtService резолвится в любом модуле (например, McpAuthGuard для `/mcp`)
    // без отдельного импорта JwtModule.
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'default-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, ...CommandHandlers],
})
export class AuthModule {}
