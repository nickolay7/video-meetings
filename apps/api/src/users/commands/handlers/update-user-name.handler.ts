import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateUserNameCommand } from '../update-user-name.command';
import { UsersRepository } from '../../users.repository';
import { User } from '../../user.entity';

@CommandHandler(UpdateUserNameCommand)
export class UpdateUserNameCommandHandler implements ICommandHandler<UpdateUserNameCommand> {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(command: UpdateUserNameCommand): Promise<User | undefined> {
    const { userId, name } = command;
    return this.usersRepository.updateName(userId, name);
  }
}
