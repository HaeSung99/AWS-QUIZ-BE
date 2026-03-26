import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('workbook_attempts')
@Index(['workbookId'])
@Index(['userId'])
export class WorkbookAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column({ length: 64 })
  workbookId: string;

  @Column({ type: 'int' })
  correctCount: number;

  @Column({ type: 'int' })
  totalCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
