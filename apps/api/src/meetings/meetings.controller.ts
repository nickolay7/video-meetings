import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  NotFoundException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { MeetingsRepository } from './meetings.repository';
import { Meeting } from './meeting.entity';

/** Запрос с `userId`, проставленным `JwtAuthGuard` (по образцу profile.controller). */
interface AuthenticatedRequest {
  userId?: string;
}

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private readonly meetingsRepository: MeetingsRepository) {}

  @Post()
  async create(@Body() dto: CreateMeetingDto, @Req() req: AuthenticatedRequest): Promise<Meeting> {
    return this.meetingsRepository.create(req.userId!, dto.name, dto.description ?? '');
  }

  @Get()
  async findAll(): Promise<Meeting[]> {
    return this.meetingsRepository.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Meeting> {
    const meeting = await this.meetingsRepository.findById(id);
    if (!meeting) {
      throw new NotFoundException(`Meeting with id ${id} not found`);
    }
    return meeting;
  }
}
