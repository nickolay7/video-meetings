import { CommandHandler, ICommandHandler, CommandBus, QueryBus } from '@nestjs/cqrs';
import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterCommand } from '../register.command';
import { CreateUserCommand } from '../../../users/commands/create-user.command';
import { FindUserByEmailQuery } from '../../../users/queries/find-user-by-email.query';

@CommandHandler(RegisterCommand)
export class RegisterCommandHandler implements ICommandHandler<RegisterCommand> {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
    private readonly jwtService: JwtService,
  ) {}

  async execute(command: RegisterCommand): Promise<{ access_token: string }> {
    const { email, password } = command;
    const name = command.name?.trim() || undefined;

    const existingUser = await this.queryBus.execute(new FindUserByEmailQuery(email));
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await this.commandBus.execute(new CreateUserCommand(email, hashedPassword, name));

    const payload = { sub: user.id, email: user.email };
    const access_token = this.jwtService.sign(payload);

    return { access_token };
  }
}
