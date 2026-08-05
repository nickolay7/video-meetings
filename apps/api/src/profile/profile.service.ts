import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { mkdir, writeFile, readFile } from 'fs/promises';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { FindUserByIdQuery } from '../users/queries/find-user-by-id.query';
import { UpdateUserAvatarCommand } from '../users/commands/update-user-avatar.command';
import { UpdateUserPasswordCommand } from '../users/commands/update-user-password.command';
import { AVATAR_STORED_NAME, getAvatarsDir } from './profile.constants';

@Injectable()
export class ProfileService {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  async saveAvatar(userId: string, file: Express.Multer.File): Promise<User> {
    // Проверяем пользователя до записи на диск, чтобы не оставить осиротевший файл.
    const existing = await this.queryBus.execute(new FindUserByIdQuery(userId));
    if (!existing) {
      throw new NotFoundException('User not found');
    }

    // Тип проверяем по фактическому содержимому (магическим байтам), а не по расширению/заголовку.
    const mimeType = detectImageMime(file.buffer);
    if (!mimeType) {
      throw new BadRequestException('Only image files are allowed');
    }

    const userDir = path.join(getAvatarsDir(), userId);
    await mkdir(userDir, { recursive: true });
    // Фиксированное имя: повторная загрузка заменяет прежний файл.
    await writeFile(path.join(userDir, AVATAR_STORED_NAME), file.buffer);

    // Репозиторий мутирует найденную запись: existing уже содержит обновлённый avatarPath.
    await this.commandBus.execute(
      new UpdateUserAvatarCommand(userId, AVATAR_STORED_NAME, mimeType),
    );
    return existing;
  }

  async getAvatar(userId: string): Promise<{ mimeType: string; content: Buffer }> {
    const user = await this.queryBus.execute(new FindUserByIdQuery(userId));
    if (!user || !user.avatarPath) {
      throw new NotFoundException('Avatar not found');
    }

    let content: Buffer;
    try {
      content = await readFile(path.join(getAvatarsDir(), userId, user.avatarPath));
    } catch {
      // Метаданные остались, а файл на диске удалён/осиротел — считаем аватар отсутствующим.
      throw new NotFoundException('Avatar not found');
    }
    return { mimeType: user.avatarMimeType ?? 'application/octet-stream', content };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.queryBus.execute(new FindUserByIdQuery(userId));
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isOldPasswordValid) {
      throw new BadRequestException('Old password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.commandBus.execute(new UpdateUserPasswordCommand(userId, hashedPassword));
  }
}

/** Определяет MIME-тип изображения по магическим байтам; возвращает null, если это не изображение. */
function detectImageMime(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
