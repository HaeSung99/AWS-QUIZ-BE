import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  certificationType?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  questionCount?: number;
}
