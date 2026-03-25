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
    return this.usersRepository.findOne({
      where: { id },
      select: ['id', 'email', 'name', 'role', 'solvedWorkbookIds', 'createdAt', 'updatedAt'],
    });
  }

  async createUser(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<User> {
    const user = this.usersRepository.create({
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      password: input.password,
      solvedWorkbookIds: [],
    });
    return this.usersRepository.save(user);
  }

  async addSolvedWorkbook(userId: number, workbookId: string): Promise<string[]> {
    const user = await this.findById(userId);
    if (!user) {
      return [];
    }

    const current = Array.isArray(user.solvedWorkbookIds) ? user.solvedWorkbookIds : [];
    if (current.includes(workbookId)) {
      return current;
    }

    user.solvedWorkbookIds = [...current, workbookId];
    const saved = await this.usersRepository.save(user);
    return Array.isArray(saved.solvedWorkbookIds) ? saved.solvedWorkbookIds : [];
  }
}
