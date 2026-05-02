import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('question_embeddings')
@Index(['questionId'], { unique: true })
@Index(['questionCategory'])
@Index(['certificationType'])
export class QuestionEmbedding {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64 })
  questionId: string;

  @Column({ type: 'varchar', length: 64 })
  workbookId: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  certificationType: string | null;

  @Column({ type: 'varchar', length: 100 })
  questionCategory: string;

  @Column({ type: 'varchar', length: 50 })
  difficulty: string;

  @Column({ type: 'varchar', length: 64 })
  contentHash: string;

  @Column({ type: 'json' })
  embedding: number[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
