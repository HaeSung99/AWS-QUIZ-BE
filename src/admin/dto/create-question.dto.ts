import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CreateQuestionDto {
  @IsString()
  @IsNotEmpty()
  certificationType: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  summary: string;

  @IsInt()
  @Min(1)
  questionCount: number;
}
