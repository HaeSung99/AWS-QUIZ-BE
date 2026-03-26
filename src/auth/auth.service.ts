import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import * as nodemailer from 'nodemailer';
import { Repository } from 'typeorm';
import { AnalyticsService } from '../analytics/analytics.service';
import { UsersService } from '../users/users.service';
import { EmailVerification } from './email-verification.entity';
import { LoginDto } from './dto/login.dto';
import { RecordWorkbookAttemptDto } from './dto/record-workbook-attempt.dto';
import { SendEmailCodeDto } from './dto/send-email-code.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyEmailCodeDto } from './dto/verify-email-code.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly analyticsService: AnalyticsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(EmailVerification)
    private readonly emailVerificationRepository: Repository<EmailVerification>,
  ) {}

  private normalizeEmail(email: string) {
    return email.toLowerCase().trim();
  }

  private createCode() {
    return `${Math.floor(100000 + Math.random() * 900000)}`;
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
      subject: '[AWS 문풀] 이메일 인증코드',
      text: `인증코드: ${code}\n10분 안에 입력해주세요.`,
    });
    return true;
  }

  async sendEmailCode(dto: SendEmailCodeDto) {
    const email = this.normalizeEmail(dto.email);
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new UnauthorizedException('이미 가입된 이메일입니다.');
    }

    const code = this.createCode();
    const codeHash = await hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const existingVerification = await this.emailVerificationRepository.findOne({
      where: { email },
    });

    if (existingVerification) {
      existingVerification.codeHash = codeHash;
      existingVerification.expiresAt = expiresAt;
      existingVerification.verifiedAt = null;
      await this.emailVerificationRepository.save(existingVerification);
    } else {
      const created = this.emailVerificationRepository.create({
        email,
        codeHash,
        expiresAt,
        verifiedAt: null,
      });
      await this.emailVerificationRepository.save(created);
    }

    const sent = await this.sendVerificationEmail(email, code);
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';

    return {
      message: sent
        ? '인증코드를 이메일로 발송했습니다.'
        : 'SMTP 설정이 없어 개발용 인증코드를 발급했습니다.',
      expiresInSeconds: 600,
      devCode: sent || isProd ? undefined : code,
    };
  }

  async verifyEmailCode(dto: VerifyEmailCodeDto) {
    const email = this.normalizeEmail(dto.email);
    const code = dto.code.trim();
    const record = await this.emailVerificationRepository.findOne({
      where: { email },
    });

    if (!record) {
      throw new UnauthorizedException('인증요청 이력이 없습니다.');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('인증코드가 만료되었습니다.');
    }

    const matched = await compare(code, record.codeHash);
    if (!matched) {
      throw new UnauthorizedException('인증코드가 올바르지 않습니다.');
    }

    record.verifiedAt = new Date();
    await this.emailVerificationRepository.save(record);

    return { verified: true };
  }

  async signup(signupDto: SignupDto) {
    const email = this.normalizeEmail(signupDto.email);
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new UnauthorizedException('이미 가입된 이메일입니다.');
    }

    const verification = await this.emailVerificationRepository.findOne({
      where: { email },
    });
    if (
      !verification ||
      !verification.verifiedAt ||
      verification.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('이메일 인증을 먼저 완료해주세요.');
    }

    const hashedPassword = await hash(signupDto.password, 10);
    const user = await this.usersService.createUser({
      email,
      name: signupDto.name,
      password: hashedPassword,
    });

    await this.emailVerificationRepository.delete({ email });

    return this.createTokenResponse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      solvedWorkbookIds: Array.isArray(user.solvedWorkbookIds)
        ? user.solvedWorkbookIds
        : [],
    });
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('이메일이 올바르지 않습니다.');
    }

    const isPasswordMatched = await compare(loginDto.password, user.password);
    if (!isPasswordMatched) {
      throw new UnauthorizedException('비밀번호가 올바르지 않습니다.');
    }

    return this.createTokenResponse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      solvedWorkbookIds: Array.isArray(user.solvedWorkbookIds)
        ? user.solvedWorkbookIds
        : [],
    });
  }

  async getProfile(userId: number) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('사용자 정보를 찾을 수 없습니다.');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        solvedWorkbookIds: Array.isArray(user.solvedWorkbookIds)
          ? user.solvedWorkbookIds
          : [],
      },
    };
  }

  async markWorkbookSolved(userId: number, workbookId: string) {
    const solvedWorkbookIds = await this.usersService.addSolvedWorkbook(
      userId,
      workbookId.trim(),
    );
    return { solvedWorkbookIds };
  }

  async recordWorkbookAttempt(userId: number, dto: RecordWorkbookAttemptDto) {
    return this.analyticsService.recordWorkbookAttempt({
      userId,
      workbookId: dto.workbookId,
      correctCount: dto.correctCount,
      totalCount: dto.totalCount,
    });
  }

  createTokenResponse(user: {
    id: number;
    email: string;
    name: string;
    role: 'user' | 'admin';
    solvedWorkbookIds: string[];
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        solvedWorkbookIds: user.solvedWorkbookIds,
      },
    };
  }
}
