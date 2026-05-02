import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('question_attempts')
@Index(['userId', 'questionCategory'])
@Index(['questionCategory', 'isCorrect'])
export class QuestionAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  workbookId: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  certificationType: string | null;

  @Column({ type: 'varchar', length: 64 })
  questionId: string;

  @Column({ type: 'varchar', length: 100 })
  questionCategory: string;

  @Column({ type: 'varchar', length: 50 })
  difficulty: string;

  @Column({ type: 'text', nullable: true })
  selectedAnswer: string | null;

  @Column({ type: 'text' })
  correctAnswer: string;

  @Column()
  isCorrect: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
