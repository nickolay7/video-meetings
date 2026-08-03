import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginCommand } from '../login.command';
import { FindUserByEmailQuery } from '../../../users/queries/find-user-by-email.query';

@CommandHandler(LoginCommand)
export class LoginCommandHandler implements ICommandHandler<LoginCommand> {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly jwtService: JwtService,
  ) {}

  async execute(command: LoginCommand): Promise<{ access_token: string }> {
    const { email, password } = command;

    const user = await this.queryBus.execute(new FindUserByEmailQuery(email));
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user.id, email: user.email };
    const access_token = this.jwtService.sign(payload);

    return { access_token };
  }
}
