import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { RegisterCommand } from './commands/register.command';
import { LoginCommand } from './commands/login.command';

@Injectable()
export class AuthService {
  constructor(private readonly commandBus: CommandBus) {}

  async register(email: string, password: string): Promise<{ access_token: string }> {
    return this.commandBus.execute(new RegisterCommand(email, password));
  }

  async login(email: string, password: string): Promise<{ access_token: string }> {
    return this.commandBus.execute(new LoginCommand(email, password));
  }
}
