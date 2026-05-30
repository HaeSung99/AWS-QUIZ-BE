import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    // 1. 로그인/가입 중복 확인에 필요한 필드를 포함해 이메일로 사용자를 찾는다.
    return this.usersRepository.findOne({
      where: { email: email.toLowerCase().trim() },
      select: [
        'id',
        'email',
        'name',
        'password',
        'role',
        'solvedWorkbookIds',
        'targetCertificationType',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async findById(id: number): Promise<User | null> {
    // 1. 프로필 동기화에 필요한 공개 사용자 정보만 조회한다.
    return this.usersRepository.findOne({
      where: { id },
      select: [
        'id',
        'email',
        'name',
        'role',
        'solvedWorkbookIds',
        'targetCertificationType',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async findByIdWithPassword(id: number): Promise<User | null> {
    // 1. 비밀번호 변경처럼 현재 비밀번호 검증이 필요한 경우에만 password를 함께 조회한다.
    return this.usersRepository.findOne({
      where: { id },
      select: [
        'id',
        'email',
        'name',
        'password',
        'role',
        'solvedWorkbookIds',
        'targetCertificationType',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async createUser(input: {
    email: string;
    name: string;
    password: string;
    targetCertificationType?: string | null;
  }): Promise<User> {
    // 1. 이메일과 이름을 정리한 뒤 일반 사용자 기본값으로 계정을 만든다.
    const cert = input.targetCertificationType?.trim() || null;
    const user = this.usersRepository.create({
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      password: input.password,
      solvedWorkbookIds: [],
      targetCertificationType: cert,
    });
    return this.usersRepository.save(user);
  }

  async updateTargetCertification(
    userId: number,
    targetCertificationType?: string | null,
  ): Promise<User | null> {
    // 1. 사용자를 찾고 목표 자격증을 저장한다.
    const user = await this.findById(userId);
    if (!user) return null;

    user.targetCertificationType =
      targetCertificationType?.trim() || null;
    return this.usersRepository.save(user);
  }

  async updatePassword(userId: number, password: string): Promise<boolean> {
    // 1. 비밀번호 해시는 AuthService에서 만든 뒤 저장만 담당한다.
    const result = await this.usersRepository.update(userId, { password });
    return Boolean(result.affected && result.affected > 0);
  }

  async addSolvedWorkbook(
    userId: number,
    workbookId: string,
  ): Promise<string[]> {
    // 1. 완료 처리할 사용자를 조회한다. 사용자가 없으면 빈 목록을 반환한다.
    const user = await this.findById(userId);
    if (!user) {
      return [];
    }

    // 2. 이미 완료한 문제집이면 중복 저장하지 않고 기존 목록을 그대로 반환한다.
    const current = Array.isArray(user.solvedWorkbookIds)
      ? user.solvedWorkbookIds
      : [];
    if (current.includes(workbookId)) {
      return current;
    }

    // 3. 새 문제집 ID를 추가하고 저장된 최신 완료 목록을 반환한다.
    user.solvedWorkbookIds = [...current, workbookId];
    const saved = await this.usersRepository.save(user);
    return Array.isArray(saved.solvedWorkbookIds)
      ? saved.solvedWorkbookIds
      : [];
  }

  async findByIdForRefresh(userId: number): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id: userId },
      select: [
        'id',
        'email',
        'name',
        'role',
        'solvedWorkbookIds',
        'targetCertificationType',
        'refreshToken',
        'refreshTokenExpiresAt',
      ],
    });
  }

  async setRefreshToken(
    userId: number,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.usersRepository.update(userId, {
      refreshToken: refreshTokenHash,
      refreshTokenExpiresAt: expiresAt,
    });
  }

  async clearRefreshToken(userId: number): Promise<void> {
    await this.usersRepository.update(userId, {
      refreshToken: null,
      refreshTokenExpiresAt: null,
    });
  }
}
