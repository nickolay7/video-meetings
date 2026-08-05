import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateUserPasswordCommand } from '../update-user-password.command';
import { UsersRepository } from '../../users.repository';
import { User } from '../../user.entity';

@CommandHandler(UpdateUserPasswordCommand)
export class UpdateUserPasswordCommandHandler implements ICommandHandler<UpdateUserPasswordCommand> {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(command: UpdateUserPasswordCommand): Promise<User | undefined> {
    const { userId, hashedPassword } = command;
    return this.usersRepository.updatePassword(userId, hashedPassword);
  }
}
