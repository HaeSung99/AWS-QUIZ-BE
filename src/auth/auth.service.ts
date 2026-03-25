import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(signupDto: SignupDto) {
    const existingUser = await this.usersService.findByEmail(signupDto.email);
    if (existingUser) {
      throw new UnauthorizedException('이미 가입된 이메일입니다.');
    }

    const hashedPassword = await hash(signupDto.password, 10);
    const user = await this.usersService.createUser({
      email: signupDto.email,
      name: signupDto.name,
      password: hashedPassword,
    });

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
