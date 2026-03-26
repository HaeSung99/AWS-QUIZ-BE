import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService } from '../analytics/analytics.service';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { AdminService } from './admin.service';
import { CreateNoticeDto } from './dto/create-notice.dto';
import { CreateQuestionItemDto } from './dto/create-question-item.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateNoticeDto } from './dto/update-notice.dto';
import { UpdateQuestionItemDto } from './dto/update-question-item.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Get('stats/overview')
  getStatsOverview() {
    return this.analyticsService.getAdminOverview();
  }

  @Post('notices')
  createNotice(@Body() dto: CreateNoticeDto) {
    return this.adminService.createNotice(dto);
  }

  @Get('notices')
  getNotices() {
    return this.adminService.getNotices();
  }

  @Patch('notices/:noticeId')
  updateNotice(
    @Param('noticeId') noticeId: string,
    @Body() dto: UpdateNoticeDto,
  ) {
    return this.adminService.updateNotice(noticeId, dto);
  }

  @Delete('notices/:noticeId')
  deleteNotice(@Param('noticeId') noticeId: string) {
    return this.adminService.deleteNotice(noticeId);
  }

  @Post('questions')
  createQuestion(@Body() dto: CreateQuestionDto) {
    return this.adminService.createQuestion(dto);
  }

  @Get('questions')
  getQuestions() {
    return this.adminService.getQuestions();
  }

  @Patch('questions/:questionId')
  updateQuestion(
    @Param('questionId') questionId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.adminService.updateQuestion(questionId, dto);
  }

  @Delete('questions/:questionId')
  deleteQuestion(@Param('questionId') questionId: string) {
    return this.adminService.deleteQuestion(questionId);
  }

  @Post('questions/:questionId/items')
  createQuestionItem(
    @Param('questionId') questionId: string,
    @Body() dto: CreateQuestionItemDto,
  ) {
    return this.adminService.createQuestionItem(questionId, dto);
  }

  @Get('questions/:questionId/items')
  getQuestionItems(@Param('questionId') questionId: string) {
    return this.adminService.getQuestionItems(questionId);
  }

  @Patch('questions/:questionId/items/:itemId')
  updateQuestionItem(
    @Param('questionId') questionId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateQuestionItemDto,
  ) {
    return this.adminService.updateQuestionItem(questionId, itemId, dto);
  }

  @Delete('questions/:questionId/items/:itemId')
  deleteQuestionItem(
    @Param('questionId') questionId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.adminService.deleteQuestionItem(questionId, itemId);
  }
}
