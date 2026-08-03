import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { FindUserByEmailQuery } from '../find-user-by-email.query';
import { UsersRepository } from '../../users.repository';
import { User } from '../../user.entity';

@QueryHandler(FindUserByEmailQuery)
export class FindUserByEmailQueryHandler implements IQueryHandler<FindUserByEmailQuery> {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(query: FindUserByEmailQuery): Promise<User | undefined> {
    return this.usersRepository.findByEmail(query.email);
  }
}
