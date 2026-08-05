import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateUserAvatarCommand } from '../update-user-avatar.command';
import { UsersRepository } from '../../users.repository';
import { User } from '../../user.entity';

@CommandHandler(UpdateUserAvatarCommand)
export class UpdateUserAvatarCommandHandler implements ICommandHandler<UpdateUserAvatarCommand> {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(command: UpdateUserAvatarCommand): Promise<User | undefined> {
    const { userId, avatarPath, avatarMimeType } = command;
    return this.usersRepository.updateAvatar(userId, avatarPath, avatarMimeType);
  }
}
