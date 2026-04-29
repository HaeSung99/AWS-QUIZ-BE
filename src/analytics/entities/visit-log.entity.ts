import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('visit_logs')
@Index(['clientKey', 'viewedOn'], { unique: true })
export class VisitLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 128 })
  clientKey: string;

  @Column({ type: 'date' })
  viewedOn: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ default: false })
  hasDwell: boolean;

  @Column({ default: false })
  hasScroll: boolean;

  @Column({ default: false })
  hasClick: boolean;

  @Column({ default: false })
  hasSearchInput: boolean;

  @Column({ default: false })
  hasQuizEnter: boolean;

  @Column({ default: false })
  hasAnswerSelect: boolean;

  @Column({ default: false })
  hasQuizSubmit: boolean;

  @Column({ default: false })
  isLoggedIn: boolean;

  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  visitorType: 'human' | 'bot' | 'unknown';

  @CreateDateColumn()
  createdAt: Date;
}
