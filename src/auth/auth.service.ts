import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import * as nodemailer from 'nodemailer';
import { MoreThan, MoreThanOrEqual, Repository } from 'typeorm';
import { AnalyticsService } from '../analytics/analytics.service';
import { UsersService } from '../users/users.service';
import { EmailCodeSendLog } from './email-code-send-log.entity';
import { EmailVerification } from './email-verification.entity';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RecordWorkbookAttemptDto } from './dto/record-workbook-attempt.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendEmailCodeDto } from './dto/send-email-code.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdateTargetCertificationDto } from './dto/update-target-certification.dto';
import { VerifyEmailCodeDto } from './dto/verify-email-code.dto';

const EMAIL_RESEND_COOLDOWN_MS = 120_000;
const IP_SEND_MAX_PER_HOUR = 10;
const IP_SEND_MAX_PER_KST_DAY = 20;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SIGNUP_EMAIL_PURPOSE = 'signup' as const;
const PASSWORD_RESET_EMAIL_PURPOSE = 'password_reset' as const;
/** 리프레시 토큰 유효 기간(일) — 갱신 시마다 연장 */
const REFRESH_TOKEN_TTL_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly analyticsService: AnalyticsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(EmailVerification)
    private readonly emailVerificationRepository: Repository<EmailVerification>,
    @InjectRepository(EmailCodeSendLog)
    private readonly emailCodeSendLogRepository: Repository<EmailCodeSendLog>,
  ) {}

  private normalizeEmail(email: string) {
    return email.toLowerCase().trim();
  }

  /** KST 자정(일일 IP 상한 기준) */
  private kstStartOfDay(now = new Date()) {
    const kstDateText = new Date(now.getTime() + KST_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
    return new Date(`${kstDateText}T00:00:00.000+09:00`);
  }

  private createCode() {
    return `${Math.floor(100000 + Math.random() * 900000)}`;
  }

  private buildVerificationEmailHtml(code: string) {
    return `
      <div style="margin:0;padding:0;background-color:#f5f7fb;font-family:Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                <tr>
                  <td style="background:#0f172a;padding:18px 24px;color:#f8fafc;font-size:18px;font-weight:700;">
                    AWS Quiz KR 이메일 인증
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px;color:#111827;line-height:1.6;font-size:14px;">
                    안녕하세요.<br/>
                    AWS Quiz KR은 개발자로서 AWS 개념을 실전 퀴즈로 학습할 수 있도록 만든 서비스입니다.<br/>
                    회원가입을 위해 아래 인증번호를 입력해주세요.
                    <div style="margin:18px 0;padding:16px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;text-align:center;">
                      <span style="display:inline-block;font-size:30px;letter-spacing:7px;font-weight:700;color:#0f172a;">${code}</span>
                    </div>
                    <p style="margin:0;color:#6b7280;font-size:13px;">
                      인증번호는 <strong style="color:#111827;">10분</strong> 동안만 유효합니다.
                    </p>
                    <p style="margin:12px 0 0;color:#6b7280;font-size:13px;">
                      현재 테스트 버전 특성상 데이터 손실 가능성이 있으며, 보안 설정 변경이 있을 수 있으니
                      민감한 비밀번호 재사용은 피해주세요.
                    </p>
                    <p style="margin:12px 0 0;color:#6b7280;font-size:13px;">
                      앞으로 다양한 기능을 계속 적용해 나갈 예정입니다. 사용 중 개선사항이나 문의사항이
                      있다면 언제든지 전달해주시면 큰 도움이 됩니다.
                    </p>
                    <p style="margin:14px 0 0;color:#6b7280;font-size:13px;">
                      본인이 요청하지 않았다면 이 메일을 무시해 주세요.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e5e7eb;color:#94a3b8;font-size:12px;">
                    © AWS Quiz KR
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;
  }

  private async sendVerificationEmail(email: string, code: string) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT') ?? '587');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const from = this.configService.get<string>('SMTP_FROM');

    const ready = Boolean(host && port && user && pass && from);
    if (!ready) {
      return false;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to: email,
      subject: '[AWS Quiz KR] 이메일 인증코드',
      text: `인증코드: ${code}\n인증번호는 10분 동안 유효합니다.`,
      html: this.buildVerificationEmailHtml(code),
    });
    return true;
  }

  async sendEmailCode(dto: SendEmailCodeDto, clientIp: string) {
    // 1. IP 기준 발송량을 먼저 제한해서 SMTP 남용을 막는다.
    const ip = (clientIp || '0.0.0.0').slice(0, 128);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sendsLastHour = await this.emailCodeSendLogRepository.count({
      where: { ip, createdAt: MoreThan(hourAgo) },
    });
    if (sendsLastHour >= IP_SEND_MAX_PER_HOUR) {
      throw new HttpException(
        '같은 네트워크에서 인증메일 요청이 너무 많습니다. 1시간 후 다시 시도해 주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const dayStart = this.kstStartOfDay();
    const sendsTodayKst = await this.emailCodeSendLogRepository.count({
      where: { ip, createdAt: MoreThanOrEqual(dayStart) },
    });
    if (sendsTodayKst >= IP_SEND_MAX_PER_KST_DAY) {
      throw new HttpException(
        '오늘 이 네트워크에서 보낼 수 있는 인증메일 횟수를 초과했습니다. 내일 다시 시도해 주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. 이미 가입된 이메일인지 확인한다.
    const email = this.normalizeEmail(dto.email);
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new UnauthorizedException('이미 가입된 이메일입니다.');
    }

    // 3. 같은 이메일로 너무 자주 인증코드를 요청하지 못하게 막는다.
    const existingVerification = await this.emailVerificationRepository.findOne(
      {
        where: { email, purpose: SIGNUP_EMAIL_PURPOSE },
      },
    );
    if (existingVerification?.lastSentAt) {
      const elapsed = Date.now() - existingVerification.lastSentAt.getTime();
      if (elapsed < EMAIL_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((EMAIL_RESEND_COOLDOWN_MS - elapsed) / 1000);
        throw new HttpException(
          `같은 이메일로는 ${Math.round(EMAIL_RESEND_COOLDOWN_MS / 1000)}초에 한 번만 인증메일을 보낼 수 있습니다. 약 ${waitSec}초 후 다시 시도해 주세요.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // 4. 인증코드를 만들고, 메일 발송을 시도한다. SMTP가 없으면 개발 환경에서 devCode를 돌려준다.
    const code = this.createCode();
    const codeHash = await hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const sent = await this.sendVerificationEmail(email, code);
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';

    const sentAt = new Date();
    if (existingVerification) {
      existingVerification.codeHash = codeHash;
      existingVerification.expiresAt = expiresAt;
      existingVerification.verifiedAt = null;
      existingVerification.lastSentAt = sentAt;
      await this.emailVerificationRepository.save(existingVerification);
    } else {
      await this.emailVerificationRepository.save(
        this.emailVerificationRepository.create({
          email,
          purpose: SIGNUP_EMAIL_PURPOSE,
          codeHash,
          expiresAt,
          verifiedAt: null,
          lastSentAt: sentAt,
        }),
      );
    }

    // 5. IP 발송 로그를 남긴 뒤 클라이언트가 타이머를 표시할 수 있는 응답을 반환한다.
    await this.emailCodeSendLogRepository.save(
      this.emailCodeSendLogRepository.create({ ip }),
    );

    return {
      message: sent
        ? '인증코드를 이메일로 발송했습니다.'
        : 'SMTP 설정이 없어 개발용 인증코드를 발급했습니다.',
      expiresInSeconds: 600,
      devCode: sent || isProd ? undefined : code,
    };
  }

  async verifyEmailCode(dto: VerifyEmailCodeDto) {
    // 1. 인증 요청 기록을 찾고, 만료 여부를 확인한다.
    const email = this.normalizeEmail(dto.email);
    const code = dto.code.trim();
    const record = await this.emailVerificationRepository.findOne({
      where: { email, purpose: SIGNUP_EMAIL_PURPOSE },
    });

    if (!record) {
      throw new UnauthorizedException('인증요청 이력이 없습니다.');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('인증코드가 만료되었습니다.');
    }

    // 2. 입력 코드와 저장된 해시가 맞으면 인증 완료 시각을 저장한다.
    const matched = await compare(code, record.codeHash);
    if (!matched) {
      throw new UnauthorizedException('인증코드가 올바르지 않습니다.');
    }

    record.verifiedAt = new Date();
    await this.emailVerificationRepository.save(record);

    return { verified: true };
  }

  async signup(signupDto: SignupDto) {
    // 1. 이메일 중복과 인증 완료 여부를 확인한다.
    const email = this.normalizeEmail(signupDto.email);
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new UnauthorizedException('이미 가입된 이메일입니다.');
    }

    const verification = await this.emailVerificationRepository.findOne({
      where: { email, purpose: SIGNUP_EMAIL_PURPOSE },
    });
    if (
      !verification ||
      !verification.verifiedAt ||
      verification.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('이메일 인증을 먼저 완료해주세요.');
    }

    // 2. 비밀번호를 해시해서 사용자를 만들고, 사용한 인증 기록은 정리한다.
    const hashedPassword = await hash(signupDto.password, 10);
    const user = await this.usersService.createUser({
      email,
      name: signupDto.name,
      password: hashedPassword,
      targetCertificationType: signupDto.targetCertificationType,
    });

    await this.emailVerificationRepository.delete({
      email,
      purpose: SIGNUP_EMAIL_PURPOSE,
    });

    // 3. 가입 직후 바로 로그인 상태가 되도록 토큰 응답을 반환한다.
    return await this.createTokenResponse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      targetCertificationType: user.targetCertificationType,
      solvedWorkbookIds: Array.isArray(user.solvedWorkbookIds)
        ? user.solvedWorkbookIds
        : [],
    });
  }

  async login(loginDto: LoginDto) {
    // 1. 이메일로 사용자를 찾고 비밀번호를 검증한다.
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('이메일이 올바르지 않습니다.');
    }

    const isPasswordMatched = await compare(loginDto.password, user.password);
    if (!isPasswordMatched) {
      throw new UnauthorizedException('비밀번호가 올바르지 않습니다.');
    }

    // 2. 인증에 성공하면 프론트가 저장할 토큰과 사용자 정보를 반환한다.
    return await this.createTokenResponse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      targetCertificationType: user.targetCertificationType,
      solvedWorkbookIds: Array.isArray(user.solvedWorkbookIds)
        ? user.solvedWorkbookIds
        : [],
    });
  }

  async getProfile(userId: number) {
    // 1. JWT의 userId로 현재 사용자 정보를 다시 조회한다.
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('사용자 정보를 찾을 수 없습니다.');
    }

    // 2. 프론트가 세션 동기화에 필요한 사용자 정보만 반환한다.
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        targetCertificationType: user.targetCertificationType,
        solvedWorkbookIds: Array.isArray(user.solvedWorkbookIds)
          ? user.solvedWorkbookIds
          : [],
      },
    };
  }

  async markWorkbookSolved(userId: number, workbookId: string) {
    // 1. 사용자가 완료한 문제집 목록에 현재 문제집을 추가하고 최신 목록을 반환한다.
    const solvedWorkbookIds = await this.usersService.addSolvedWorkbook(
      userId,
      workbookId.trim(),
    );
    return { solvedWorkbookIds };
  }

  async updateTargetCertification(
    userId: number,
    dto: UpdateTargetCertificationDto,
  ) {
    // 1. 목표 자격증을 저장한다.
    const user = await this.usersService.updateTargetCertification(
      userId,
      dto.targetCertificationType,
    );
    if (!user) {
      throw new UnauthorizedException('사용자 정보를 찾을 수 없습니다.');
    }

    // 2. 프론트가 localStorage를 갱신할 수 있도록 최신 사용자 정보를 반환한다.
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        targetCertificationType: user.targetCertificationType,
        solvedWorkbookIds: Array.isArray(user.solvedWorkbookIds)
          ? user.solvedWorkbookIds
          : [],
      },
    };
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    // 1. 현재 비밀번호 검증을 위해 password까지 포함해서 사용자를 조회한다.
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user) {
      throw new UnauthorizedException('사용자 정보를 찾을 수 없습니다.');
    }

    // 2. 현재 비밀번호가 맞는 경우에만 새 비밀번호를 저장한다.
    const matched = await compare(dto.currentPassword, user.password);
    if (!matched) {
      throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다.');
    }

    const hashedPassword = await hash(dto.newPassword, 10);
    await this.usersService.updatePassword(userId, hashedPassword);
    await this.usersService.clearRefreshToken(userId);
    return { changed: true };
  }

  async sendPasswordResetCode(dto: SendEmailCodeDto, clientIp: string) {
    // 1. 비밀번호 찾기는 가입된 이메일에 대해서만 인증코드를 발송한다.
    const email = this.normalizeEmail(dto.email);
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('가입된 이메일을 찾을 수 없습니다.');
    }

    // 2. IP 기준 발송량을 회원가입 인증과 동일하게 제한한다.
    const ip = (clientIp || '0.0.0.0').slice(0, 128);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sendsLastHour = await this.emailCodeSendLogRepository.count({
      where: { ip, createdAt: MoreThan(hourAgo) },
    });
    if (sendsLastHour >= IP_SEND_MAX_PER_HOUR) {
      throw new HttpException(
        '같은 네트워크에서 인증메일 요청이 너무 많습니다. 1시간 후 다시 시도해 주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const dayStart = this.kstStartOfDay();
    const sendsTodayKst = await this.emailCodeSendLogRepository.count({
      where: { ip, createdAt: MoreThanOrEqual(dayStart) },
    });
    if (sendsTodayKst >= IP_SEND_MAX_PER_KST_DAY) {
      throw new HttpException(
        '오늘 이 네트워크에서 보낼 수 있는 인증메일 횟수를 초과했습니다. 내일 다시 시도해 주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 3. 같은 이메일 재발송 쿨다운을 확인한다.
    const existingVerification = await this.emailVerificationRepository.findOne(
      {
        where: { email, purpose: PASSWORD_RESET_EMAIL_PURPOSE },
      },
    );
    if (existingVerification?.lastSentAt) {
      const elapsed = Date.now() - existingVerification.lastSentAt.getTime();
      if (elapsed < EMAIL_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((EMAIL_RESEND_COOLDOWN_MS - elapsed) / 1000);
        throw new HttpException(
          `같은 이메일로는 ${Math.round(EMAIL_RESEND_COOLDOWN_MS / 1000)}초에 한 번만 인증메일을 보낼 수 있습니다. 약 ${waitSec}초 후 다시 시도해 주세요.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // 4. 비밀번호 재설정용 인증코드를 발송하고 purpose를 분리해서 저장한다.
    const code = this.createCode();
    const codeHash = await hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const sent = await this.sendVerificationEmail(email, code);
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const sentAt = new Date();

    if (existingVerification) {
      existingVerification.codeHash = codeHash;
      existingVerification.expiresAt = expiresAt;
      existingVerification.verifiedAt = null;
      existingVerification.lastSentAt = sentAt;
      await this.emailVerificationRepository.save(existingVerification);
    } else {
      await this.emailVerificationRepository.save(
        this.emailVerificationRepository.create({
          email,
          purpose: PASSWORD_RESET_EMAIL_PURPOSE,
          codeHash,
          expiresAt,
          verifiedAt: null,
          lastSentAt: sentAt,
        }),
      );
    }

    await this.emailCodeSendLogRepository.save(
      this.emailCodeSendLogRepository.create({ ip }),
    );

    return {
      message: sent
        ? '비밀번호 재설정 인증코드를 이메일로 발송했습니다.'
        : 'SMTP 설정이 없어 개발용 인증코드를 발급했습니다.',
      expiresInSeconds: 600,
      devCode: sent || isProd ? undefined : code,
    };
  }

  async verifyPasswordResetCode(dto: VerifyEmailCodeDto) {
    // 1. 가입된 이메일의 비밀번호 재설정 인증 요청만 검증한다.
    const email = this.normalizeEmail(dto.email);
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('가입된 이메일을 찾을 수 없습니다.');
    }

    const record = await this.emailVerificationRepository.findOne({
      where: { email, purpose: PASSWORD_RESET_EMAIL_PURPOSE },
    });
    if (!record) {
      throw new UnauthorizedException('인증요청 이력이 없습니다.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('인증코드가 만료되었습니다.');
    }

    // 2. 인증코드가 맞으면 재설정 가능 상태로 표시한다.
    const matched = await compare(dto.code.trim(), record.codeHash);
    if (!matched) {
      throw new UnauthorizedException('인증코드가 올바르지 않습니다.');
    }

    record.verifiedAt = new Date();
    await this.emailVerificationRepository.save(record);
    return { verified: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    // 1. 비밀번호 재설정은 가입된 이메일과 password_reset 인증 완료 기록이 모두 필요하다.
    const email = this.normalizeEmail(dto.email);
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('가입된 이메일을 찾을 수 없습니다.');
    }

    const verification = await this.emailVerificationRepository.findOne({
      where: { email, purpose: PASSWORD_RESET_EMAIL_PURPOSE },
    });
    if (
      !verification ||
      !verification.verifiedAt ||
      verification.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('이메일 인증을 먼저 완료해주세요.');
    }

    // 2. 새 비밀번호를 저장하고 사용한 인증 기록은 제거한다.
    const hashedPassword = await hash(dto.newPassword, 10);
    await this.usersService.updatePassword(user.id, hashedPassword);
    await this.usersService.clearRefreshToken(user.id);
    await this.emailVerificationRepository.delete({
      email,
      purpose: PASSWORD_RESET_EMAIL_PURPOSE,
    });
    return { reset: true };
  }

  async recordWorkbookAttempt(
    userId: number,
    role: 'user' | 'admin',
    dto: RecordWorkbookAttemptDto,
  ) {
    // 1. admin의 테스트 제출은 이용자 통계와 약점 분석 데이터에서 제외한다.
    if (role === 'admin') {
      return { saved: true, statsExcluded: true as const };
    }

    // 2. 일반 사용자의 제출만 analytics 서비스에 위임해 문제집 정답률과 문항별 기록을 저장한다.
    return this.analyticsService.recordWorkbookAttempt({
      userId,
      workbookId: dto.workbookId,
      correctCount: dto.correctCount,
      totalCount: dto.totalCount,
      questionAttempts: dto.questionAttempts,
    });
  }

  async getPersonalWeakCategories(userId: number) {
    // 1. 홈 화면의 "내가 자주 틀리는 유형" 데이터를 analytics 서비스에서 가져온다.
    return this.analyticsService.getPersonalWeakCategories(userId);
  }

  async getRecommendedQuestions(userId: number, limit?: number) {
    // 1. 목표 자격증이 있으면 해당 자격증 안에서만 유사 약점 문제를 추천한다.
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('사용자 정보를 찾을 수 없습니다.');
    }
    return this.analyticsService.getRecommendedQuestions(
      userId,
      limit,
      user.targetCertificationType,
    );
  }

  async getDailyQuestions(userId: number, limit?: number) {
    // 1. 오늘의 문제는 목표 자격증이 있어야 제공한다.
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('사용자 정보를 찾을 수 없습니다.');
    }
    if (!user.targetCertificationType) {
      throw new HttpException(
        '오늘의 문제를 받으려면 목표 자격증을 먼저 선택해주세요.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2. 목표 자격증과 KST 날짜 기준으로 하루 동안 고정된 랜덤 문제를 반환한다.
    return this.analyticsService.getDailyQuestions(
      userId,
      user.targetCertificationType,
      limit,
    );
  }

  async getWeaknessComment(userId: number) {
    // 1. 사용자의 약점 요약과 일일 AI 코멘트 캐시를 가져온다.
    return this.analyticsService.getWeaknessComment(userId);
  }

  async getGlobalWeakCategories() {
    // 1. 전체 이용자가 자주 틀리는 유형을 홈 화면에 제공한다.
    return this.analyticsService.getGlobalWeakCategories();
  }

  /** 개인 학습 통계: 전체 응답 정답률 + 문제집별 최초 제출 성적 및 제출 횟수 */
  async getMyLearningStats(userId: number) {
    return this.analyticsService.getMyLearningStats(userId);
  }

  /** 문제집별 회차 채점·오답 노트 조회 */
  async getWorkbookReview(userId: number, workbookId: string) {
    return this.analyticsService.getWorkbookReviewSessions(userId, workbookId);
  }

  createTokenResponse(user: {
    id: number;
    email: string;
    name: string;
    role: 'user' | 'admin';
    targetCertificationType?: string | null;
    solvedWorkbookIds: string[];
  }) {
    return this.issueAuthTokens(user);
  }

  /**
   * 1) access JWT 발급
   * 2) refresh 원문 생성 → DB bcrypt 저장(세션) + 만료일 연장
   */
  private async issueAuthTokens(user: {
    id: number;
    email: string;
    name: string;
    role: 'user' | 'admin';
    targetCertificationType?: string | null;
    solvedWorkbookIds: string[];
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const accessExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES') ?? '15m';
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });
    const refreshToken = await this.rotateRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        targetCertificationType: user.targetCertificationType ?? null,
        solvedWorkbookIds: user.solvedWorkbookIds,
      },
    };
  }

  private refreshTokenExpiresAt() {
    return new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  /** userId 접두 + UUID — refresh 시 userId로 DB 조회 후 해시 compare */
  private async rotateRefreshToken(userId: number): Promise<string> {
    const raw = `${userId}.${randomUUID()}`;
    const refreshTokenHash = await hash(raw, 10);
    await this.usersService.setRefreshToken(
      userId,
      refreshTokenHash,
      this.refreshTokenExpiresAt(),
    );
    return raw;
  }

  /**
   * access JWT 만료/없음 시: 클라이언트 refreshToken ↔ DB 해시 일치 + 만료 확인 → access·refresh 재발급
   */
  async refreshAccessToken(refreshToken: string) {
    const trimmed = refreshToken.trim();
    const dotIdx = trimmed.indexOf('.');
    if (dotIdx <= 0) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }

    const userId = Number(trimmed.slice(0, dotIdx));
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }

    const user = await this.usersService.findByIdForRefresh(userId);
    if (!user?.refreshToken || !user.refreshTokenExpiresAt) {
      throw new UnauthorizedException('세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    if (user.refreshTokenExpiresAt.getTime() < Date.now()) {
      await this.usersService.clearRefreshToken(userId);
      throw new UnauthorizedException('세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    const matched = await compare(trimmed, user.refreshToken);
    if (!matched) {
      await this.usersService.clearRefreshToken(userId);
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }

    return this.issueAuthTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      targetCertificationType: user.targetCertificationType,
      solvedWorkbookIds: Array.isArray(user.solvedWorkbookIds)
        ? user.solvedWorkbookIds
        : [],
    });
  }

  async logout(userId: number) {
    await this.usersService.clearRefreshToken(userId);
    return { loggedOut: true };
  }
}
