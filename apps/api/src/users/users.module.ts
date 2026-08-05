import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { UsersRepository } from './users.repository';
import { CreateUserCommandHandler } from './commands/handlers/create-user.handler';
import { UpdateUserNameCommandHandler } from './commands/handlers/update-user-name.handler';
import { UpdateUserAvatarCommandHandler } from './commands/handlers/update-user-avatar.handler';
import { UpdateUserPasswordCommandHandler } from './commands/handlers/update-user-password.handler';
import { FindUserByEmailQueryHandler } from './queries/handlers/find-user-by-email.handler';
import { FindUserByIdQueryHandler } from './queries/handlers/find-user-by-id.handler';

const CommandHandlers = [
  CreateUserCommandHandler,
  UpdateUserNameCommandHandler,
  UpdateUserAvatarCommandHandler,
  UpdateUserPasswordCommandHandler,
];
const QueryHandlers = [FindUserByEmailQueryHandler, FindUserByIdQueryHandler];

@Module({
  imports: [CqrsModule],
  providers: [UsersRepository, ...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
