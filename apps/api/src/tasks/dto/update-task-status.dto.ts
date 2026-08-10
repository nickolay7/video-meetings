import { IsIn } from 'class-validator';
import { TaskStatus } from '../task.entity';

export class UpdateTaskStatusDto {
  @IsIn(['open', 'completed'])
  status: TaskStatus;
}
