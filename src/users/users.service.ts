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
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async createUser(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<User> {
    // 1. 이메일과 이름을 정리한 뒤 일반 사용자 기본값으로 계정을 만든다.
    const user = this.usersRepository.create({
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      password: input.password,
      solvedWorkbookIds: [],
    });
    return this.usersRepository.save(user);
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
}
