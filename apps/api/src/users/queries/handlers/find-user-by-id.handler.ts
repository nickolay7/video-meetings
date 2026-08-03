import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { FindUserByIdQuery } from '../find-user-by-id.query';
import { UsersRepository } from '../../users.repository';
import { User } from '../../user.entity';

@QueryHandler(FindUserByIdQuery)
export class FindUserByIdQueryHandler implements IQueryHandler<FindUserByIdQuery> {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(query: FindUserByIdQuery): Promise<User | undefined> {
    return this.usersRepository.findById(query.id);
  }
}
