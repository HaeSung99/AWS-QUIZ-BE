import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { TrackVisitDto } from './dto/track-visit.dto';
import { VisitLog } from './entities/visit-log.entity';
import { WorkbookAttempt } from './entities/workbook-attempt.entity';
import { Question, QuestionDocument } from '../admin/schemas/question.schema';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(VisitLog)
    private readonly visitLogRepository: Repository<VisitLog>,
    @InjectRepository(WorkbookAttempt)
    private readonly workbookAttemptRepository: Repository<WorkbookAttempt>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
  ) {}

  private dateString(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  async trackVisit(dto: TrackVisitDto) {
    const clientKey = dto.clientKey.trim();
    if (!clientKey) return { tracked: false };
    const viewedOn = this.dateString();

    const existing = await this.visitLogRepository.findOne({
      where: { clientKey, viewedOn },
    });
    if (existing) {
      return { tracked: true };
    }

    const created = this.visitLogRepository.create({ clientKey, viewedOn });
    await this.visitLogRepository.save(created);
    return { tracked: true };
  }

  async recordWorkbookAttempt(input: {
    userId: number;
    workbookId: string;
    correctCount: number;
    totalCount: number;
  }) {
    const created = this.workbookAttemptRepository.create({
      userId: input.userId,
      workbookId: input.workbookId.trim(),
      correctCount: input.correctCount,
      totalCount: input.totalCount,
    });
    await this.workbookAttemptRepository.save(created);
    return { saved: true };
  }

  private async buildDailyUserSignups(days = 30) {
    const rows = await this.usersRepository
      .createQueryBuilder('u')
      .select("DATE_FORMAT(u.createdAt, '%Y-%m-%d')", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('u.createdAt >= DATE_SUB(CURDATE(), INTERVAL :days DAY)', { days })
      .groupBy("DATE_FORMAT(u.createdAt, '%Y-%m-%d')")
      .orderBy("DATE_FORMAT(u.createdAt, '%Y-%m-%d')", 'ASC')
      .getRawMany<{ date: string; count: string }>();

    return rows.map((row) => ({ date: row.date, count: Number(row.count) }));
  }

  private async buildMonthlyUserSignups(months = 12) {
    const rows = await this.usersRepository
      .createQueryBuilder('u')
      .select("DATE_FORMAT(u.createdAt, '%Y-%m')", 'month')
      .addSelect('COUNT(*)', 'count')
      .where('u.createdAt >= DATE_SUB(CURDATE(), INTERVAL :months MONTH)', { months })
      .groupBy("DATE_FORMAT(u.createdAt, '%Y-%m')")
      .orderBy("DATE_FORMAT(u.createdAt, '%Y-%m')", 'ASC')
      .getRawMany<{ month: string; count: string }>();

    return rows.map((row) => ({ month: row.month, count: Number(row.count) }));
  }

  private async buildDailyVisitors(days = 30) {
    const rows = await this.visitLogRepository
      .createQueryBuilder('v')
      .select('v.viewedOn', 'date')
      .addSelect('COUNT(*)', 'count')
      .where('v.viewedOn >= DATE_SUB(CURDATE(), INTERVAL :days DAY)', { days })
      .groupBy('v.viewedOn')
      .orderBy('v.viewedOn', 'ASC')
      .getRawMany<{ date: string; count: string }>();

    return rows.map((row) => ({ date: row.date, count: Number(row.count) }));
  }

  private async buildMonthlyVisitors(months = 12) {
    const rows = await this.visitLogRepository
      .createQueryBuilder('v')
      .select("DATE_FORMAT(v.viewedOn, '%Y-%m')", 'month')
      .addSelect('COUNT(*)', 'count')
      .where('v.viewedOn >= DATE_SUB(CURDATE(), INTERVAL :months MONTH)', { months })
      .groupBy("DATE_FORMAT(v.viewedOn, '%Y-%m')")
      .orderBy("DATE_FORMAT(v.viewedOn, '%Y-%m')", 'ASC')
      .getRawMany<{ month: string; count: string }>();

    return rows.map((row) => ({ month: row.month, count: Number(row.count) }));
  }

  async getWorkbookAccuracy(limit?: number) {
    const query = this.workbookAttemptRepository
      .createQueryBuilder('a')
      .select('a.workbookId', 'workbookId')
      .addSelect('SUM(a.correctCount)', 'correctSum')
      .addSelect('SUM(a.totalCount)', 'totalSum')
      .addSelect('COUNT(*)', 'attemptCount')
      .groupBy('a.workbookId')
      .orderBy('attemptCount', 'DESC');

    if (typeof limit === 'number' && limit > 0) {
      query.limit(limit);
    }

    const rows = await query.getRawMany<{
      workbookId: string;
      correctSum: string;
      totalSum: string;
      attemptCount: string;
    }>();

    const workbookIds = rows.map((row) => row.workbookId);
    const questions = workbookIds.length
      ? await this.questionModel
          .find({ _id: { $in: workbookIds } })
          .select({ _id: 1, title: 1 })
          .lean()
          .exec()
      : [];

    const titleMap = new Map<string, string>();
    for (const question of questions) {
      titleMap.set(String(question._id), question.title);
    }

    return rows.map((row) => {
      const correct = Number(row.correctSum);
      const total = Number(row.totalSum);
      const accuracy = total > 0 ? Number(((correct / total) * 100).toFixed(1)) : 0;
      return {
        workbookId: row.workbookId,
        title: titleMap.get(row.workbookId) ?? row.workbookId,
        accuracy,
        attemptCount: Number(row.attemptCount),
      };
    });
  }

  async getAdminOverview() {
    const totalUsers = await this.usersRepository.count();
    const today = this.dateString();
    const todayVisitors = await this.visitLogRepository.count({
      where: { viewedOn: today },
    });
    const workbookAccuracy = await this.getWorkbookAccuracy(10);

    return {
      totalUsers,
      todayVisitors,
      dailySignups: await this.buildDailyUserSignups(30),
      monthlySignups: await this.buildMonthlyUserSignups(12),
      dailyVisitors: await this.buildDailyVisitors(30),
      monthlyVisitors: await this.buildMonthlyVisitors(12),
      workbookAccuracy,
    };
  }
}
