export class User {
  id: string;
  email: string;
  password: string;
  name?: string;
  /** Имя файла аватара в каталоге пользователя (фиксированное, см. profile.constants). */
  avatarPath?: string;
  avatarMimeType?: string;

  constructor(id: string, email: string, password: string, name?: string) {
    this.id = id;
    this.email = email;
    this.password = password;
    this.name = name;
  }
}
