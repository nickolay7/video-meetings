import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateUserCommand } from '../create-user.command';
import { UsersRepository } from '../../users.repository';
import { User } from '../../user.entity';

@CommandHandler(CreateUserCommand)
export class CreateUserCommandHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(command: CreateUserCommand): Promise<User> {
    const { email, hashedPassword, name } = command;
    return this.usersRepository.create(email, hashedPassword, name);
  }
}
