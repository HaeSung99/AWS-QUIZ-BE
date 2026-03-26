import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class RecordWorkbookAttemptDto {
  @IsString()
  @IsNotEmpty()
  workbookId: string;

  @IsInt()
  @Min(0)
  correctCount: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  totalCount: number;
}
