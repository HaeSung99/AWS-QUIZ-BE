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
import { RecommendQuestionCategoryDto } from './dto/recommend-question-category.dto';
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

  // 관리자 대시보드 통계: 가입자, 방문자, 문제집 정답률 통계를 반환한다.
  @Get('stats/overview')
  getStatsOverview() {
    return this.analyticsService.getAdminOverview();
  }

  // 문항 카테고리 목록: 현재 저장된 문항에서 실제 사용 중인 카테고리를 가져온다.
  @Get('question-categories')
  getUsedQuestionCategories() {
    return this.adminService.getUsedQuestionCategories();
  }

  // 문항 카테고리 추천: 작성 중인 문항을 기존 문제 임베딩과 비교해 현재 사용 중인 카테고리 중 Top 3를 추천한다.
  @Post('question-categories/recommend')
  recommendQuestionCategory(@Body() dto: RecommendQuestionCategoryDto) {
    return this.adminService.recommendQuestionCategory(dto);
  }

  // 공지 생성: 홈/공지 페이지에 노출할 공지글을 등록한다.
  @Post('notices')
  createNotice(@Body() dto: CreateNoticeDto) {
    return this.adminService.createNotice(dto);
  }

  // 공지 목록 조회: pinned 우선순위와 작성일 기준으로 공지글을 가져온다.
  @Get('notices')
  getNotices() {
    return this.adminService.getNotices();
  }

  // 공지 수정: 제목, 본문, 고정 여부를 부분 수정한다.
  @Patch('notices/:noticeId')
  updateNotice(
    @Param('noticeId') noticeId: string,
    @Body() dto: UpdateNoticeDto,
  ) {
    return this.adminService.updateNotice(noticeId, dto);
  }

  // 공지 삭제: 관리자 화면에서 선택한 공지글을 제거한다.
  @Delete('notices/:noticeId')
  deleteNotice(@Param('noticeId') noticeId: string) {
    return this.adminService.deleteNotice(noticeId);
  }

  // 문제집 생성: 문제집 기본 정보만 만들고 최초 상태는 draft로 둔다.
  @Post('questions')
  createQuestion(@Body() dto: CreateQuestionDto) {
    return this.adminService.createQuestion(dto);
  }

  // 문제집 목록 조회: 관리자 편집 화면용으로 draft 포함 전체 문제집을 가져온다.
  @Get('questions')
  getQuestions() {
    return this.adminService.getQuestions();
  }

  // 문제집 수정: 제목, 요약, 문항 수, 게시 상태를 관리자가 변경한다.
  @Patch('questions/:questionId')
  updateQuestion(
    @Param('questionId') questionId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.adminService.updateQuestion(questionId, dto);
  }

  // 문제집 삭제: 문제집과 하위 문항을 함께 삭제한다.
  @Delete('questions/:questionId')
  deleteQuestion(@Param('questionId') questionId: string) {
    return this.adminService.deleteQuestion(questionId);
  }

  // 문항 생성: 문제집의 다음 번호로 객관식 문항을 추가한다.
  @Post('questions/:questionId/items')
  createQuestionItem(
    @Param('questionId') questionId: string,
    @Body() dto: CreateQuestionItemDto,
  ) {
    return this.adminService.createQuestionItem(questionId, dto);
  }

  // 문항 목록 조회: 특정 문제집의 모든 문항을 번호순으로 가져온다.
  @Get('questions/:questionId/items')
  getQuestionItems(@Param('questionId') questionId: string) {
    return this.adminService.getQuestionItems(questionId);
  }

  // 문항 수정: 문제 설명, 선택지, 정답, 힌트, 난이도, 유형을 수정한다.
  @Patch('questions/:questionId/items/:itemId')
  updateQuestionItem(
    @Param('questionId') questionId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateQuestionItemDto,
  ) {
    return this.adminService.updateQuestionItem(questionId, itemId, dto);
  }

  // 문항 삭제: 문항을 제거하고 뒤 문항 번호를 당겨 연속성을 유지한다.
  @Delete('questions/:questionId/items/:itemId')
  deleteQuestionItem(
    @Param('questionId') questionId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.adminService.deleteQuestionItem(questionId, itemId);
  }
}
