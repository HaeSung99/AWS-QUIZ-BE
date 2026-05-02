import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AnalyticsService } from '../analytics/analytics.service';
import { TrackVisitDto } from '../analytics/dto/track-visit.dto';
import { AdminService } from './admin.service';

@Controller('public')
export class PublicController {
  constructor(
    private readonly adminService: AdminService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  // 방문 추적: 익명 방문자의 행동 신호와 봇 여부를 통계용으로 기록한다.
  @Post('track-visit')
  trackVisit(@Body() dto: TrackVisitDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    return this.analyticsService.trackVisit(dto, {
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }

  // 공개 공지 조회: 비로그인 사용자도 볼 수 있는 공지 목록을 반환한다.
  @Get('notices')
  getNotices() {
    return this.adminService.getNotices();
  }

  // 공개 문제집 조회: 게시 완료된 문제집 목록만 반환한다.
  @Get('workbooks')
  getWorkbooks() {
    return this.adminService.getPublicQuestions();
  }

  // 공개 문제집 정답률 조회: 홈 화면의 평균 정답률 표시용 데이터를 반환한다.
  @Get('workbooks/accuracy')
  getWorkbookAccuracy() {
    return this.analyticsService.getWorkbookAccuracy();
  }

  // 유형별 문항 조회: 특정 questionCategory 문항만 모아 연습할 때 사용한다.
  @Get('questions/by-category')
  getQuestionItemsByCategory(
    @Query('category') category = '',
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getPublicQuestionItemsByCategory(
      category,
      limit ? Number(limit) : undefined,
    );
  }

  // 공개 문제집 문항 조회: 게시 완료되고 문항 수가 충족된 문제집만 풀이용으로 반환한다.
  @Get('workbooks/:workbookId/items')
  getWorkbookItems(@Param('workbookId') workbookId: string) {
    return this.adminService.getPublicQuestionItems(workbookId);
  }
}
