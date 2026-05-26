import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { extractClientIp } from './client-ip.util';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RecordWorkbookAttemptDto } from './dto/record-workbook-attempt.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendEmailCodeDto } from './dto/send-email-code.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdateTargetCertificationDto } from './dto/update-target-certification.dto';
import { VerifyEmailCodeDto } from './dto/verify-email-code.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtPayload } from './jwt.strategy';

type RequestWithUser = Request & { user: JwtPayload };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 이메일 인증코드 발송: IP/이메일 제한은 AuthService에서 처리한다.
  @Post('email/send-code')
  sendEmailCode(@Body() dto: SendEmailCodeDto, @Req() req: Request) {
    return this.authService.sendEmailCode(dto, extractClientIp(req));
  }

  // 이메일 인증코드 검증: 가입 전에 이메일 소유 여부를 확정한다.
  @Post('email/verify')
  verifyEmailCode(@Body() dto: VerifyEmailCodeDto) {
    return this.authService.verifyEmailCode(dto);
  }

  // 회원가입: 이메일 인증 완료 여부를 확인하고 가입 직후 토큰을 발급한다.
  @Post('signup')
  signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  // 로그인: 이메일/비밀번호를 검증하고 토큰과 사용자 정보를 반환한다.
  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  // 비밀번호 찾기 인증코드 발송: 가입된 이메일에 대해서만 재설정 코드를 보낸다.
  @Post('password/send-reset-code')
  sendPasswordResetCode(@Body() dto: SendEmailCodeDto, @Req() req: Request) {
    return this.authService.sendPasswordResetCode(dto, extractClientIp(req));
  }

  // 비밀번호 찾기 인증코드 검증: 재설정 가능한 이메일임을 확정한다.
  @Post('password/verify-reset-code')
  verifyPasswordResetCode(@Body() dto: VerifyEmailCodeDto) {
    return this.authService.verifyPasswordResetCode(dto);
  }

  // 비밀번호 재설정: 인증 완료된 가입 이메일의 비밀번호만 변경한다.
  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // 내 프로필 조회: JWT의 user id 기준으로 현재 사용자 정보를 가져온다.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: RequestWithUser) {
    return this.authService.getProfile(req.user.sub);
  }

  // 목표 자격증 수정: 오늘의 문제와 추천 문제의 기준 자격증을 변경한다.
  @UseGuards(JwtAuthGuard)
  @Patch('me/target-certification')
  updateTargetCertification(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateTargetCertificationDto,
  ) {
    return this.authService.updateTargetCertification(req.user.sub, dto);
  }

  // 비밀번호 변경: 로그인 상태에서 현재 비밀번호 확인 후 새 비밀번호를 저장한다.
  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  changePassword(
    @Req() req: RequestWithUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(req.user.sub, dto);
  }

  // 내 약점 유형 조회: 문항별 풀이 기록을 유형 단위로 집계한다.
  @UseGuards(JwtAuthGuard)
  @Get('me/weak-categories')
  getMyWeakCategories(@Req() req: RequestWithUser) {
    return this.authService.getPersonalWeakCategories(req.user.sub);
  }

  // AI 유사 문제 추천: 최근 풀이 흐름을 기준으로 약점과 비슷한 문제를 반환한다.
  @UseGuards(JwtAuthGuard)
  @Get('me/recommended-questions')
  getRecommendedQuestions(
    @Req() req: RequestWithUser,
    @Query('limit') limit?: string,
  ) {
    return this.authService.getRecommendedQuestions(
      req.user.sub,
      limit ? Number(limit) : undefined,
    );
  }

  // 오늘의 문제: 목표 자격증 기준으로 KST 하루 동안 고정된 랜덤 문제를 반환한다.
  @UseGuards(JwtAuthGuard)
  @Get('me/daily-questions')
  getDailyQuestions(
    @Req() req: RequestWithUser,
    @Query('limit') limit?: string,
  ) {
    return this.authService.getDailyQuestions(
      req.user.sub,
      limit ? Number(limit) : undefined,
    );
  }

  // AI 약점 코멘트: 최근 오답/정답 흐름과 추천 문제 특징을 짧게 설명한다.
  @UseGuards(JwtAuthGuard)
  @Get('me/weakness-comment')
  getWeaknessComment(@Req() req: RequestWithUser) {
    return this.authService.getWeaknessComment(req.user.sub);
  }

  // 전체 이용자 약점 유형 조회: 공개 학습 트렌드용 전역 오답 유형을 반환한다.
  @UseGuards(JwtAuthGuard)
  @Get('weak-categories/global')
  getGlobalWeakCategories() {
    return this.authService.getGlobalWeakCategories();
  }

  // 개인 학습 통계: 전체 정답률·문제집별 최초 제출 성적
  @UseGuards(JwtAuthGuard)
  @Get('me/learning-stats')
  getMyLearningStats(@Req() req: RequestWithUser) {
    return this.authService.getMyLearningStats(req.user.sub);
  }

  // 문제집 채점 이력·오답 노트(회차별)
  @UseGuards(JwtAuthGuard)
  @Get('me/workbooks/:workbookId/review')
  getWorkbookReview(
    @Req() req: RequestWithUser,
    @Param('workbookId') workbookId: string,
  ) {
    return this.authService.getWorkbookReview(req.user.sub, workbookId);
  }

  // 문제집 풀이 완료 처리: 사용자 프로필의 solvedWorkbookIds에 문제집을 기록한다.
  @UseGuards(JwtAuthGuard)
  @Post('me/solved-workbooks/:workbookId')
  markSolved(
    @Req() req: RequestWithUser,
    @Param('workbookId') workbookId: string,
  ) {
    return this.authService.markWorkbookSolved(req.user.sub, workbookId);
  }

  // 문제집 제출 기록: 점수와 문항별 정오답을 저장하고 admin 제출은 통계에서 제외한다.
  @UseGuards(JwtAuthGuard)
  @Post('me/workbook-attempts')
  recordWorkbookAttempt(
    @Req() req: RequestWithUser,
    @Body() dto: RecordWorkbookAttemptDto,
  ) {
    return this.authService.recordWorkbookAttempt(
      req.user.sub,
      req.user.role,
      dto,
    );
  }
}
