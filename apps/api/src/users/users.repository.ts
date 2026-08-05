import { Injectable } from '@nestjs/common';
import { User } from './user.entity';

@Injectable()
export class UsersRepository {
  private users: Map<string, User> = new Map();
  private idCounter = 1;

  async create(email: string, hashedPassword: string, name?: string): Promise<User> {
    const id = String(this.idCounter++);
    const user = new User(id, email, hashedPassword, name);
    this.users.set(email, user);
    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return this.users.get(email);
  }

  async findById(id: string): Promise<User | undefined> {
    return [...this.users.values()].find((user) => user.id === id);
  }

  async updateName(id: string, name?: string): Promise<User | undefined> {
    const user = await this.findById(id);
    if (!user) {
      return undefined;
    }
    user.name = name;
    return user;
  }

  async updateAvatar(
    id: string,
    avatarPath: string,
    avatarMimeType: string,
  ): Promise<User | undefined> {
    const user = await this.findById(id);
    if (!user) {
      return undefined;
    }
    user.avatarPath = avatarPath;
    user.avatarMimeType = avatarMimeType;
    return user;
  }

  async updatePassword(id: string, hashedPassword: string): Promise<User | undefined> {
    const user = await this.findById(id);
    if (!user) {
      return undefined;
    }
    user.password = hashedPassword;
    return user;
  }

  async clear(): Promise<void> {
    this.users.clear();
    this.idCounter = 1;
  }
}
