import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { extractClientIp } from './client-ip.util';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RecordWorkbookAttemptDto } from './dto/record-workbook-attempt.dto';
import { SendEmailCodeDto } from './dto/send-email-code.dto';
import { SignupDto } from './dto/signup.dto';
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

  // 내 프로필 조회: JWT의 user id 기준으로 현재 사용자 정보를 가져온다.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: RequestWithUser) {
    return this.authService.getProfile(req.user.sub);
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
