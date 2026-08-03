import { Controller, Get, Post, Body, Param, NotFoundException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { MeetingsRepository } from './meetings.repository';
import { Meeting } from './meeting.entity';

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private readonly meetingsRepository: MeetingsRepository) {}

  @Post()
  async create(@Body() dto: CreateMeetingDto): Promise<Meeting> {
    return this.meetingsRepository.create(dto.name, dto.description ?? '');
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
