import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateQuestionItemDto {
  @IsInt()
  @Min(1)
  questionNumber: number;

  @IsString()
  @IsNotEmpty()
  questionDescription: string;

  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  choices: string[];

  @IsString()
  @IsNotEmpty()
  answer: string;

  @IsOptional()
  @IsString()
  hint?: string;

  @IsString()
  @IsNotEmpty()
  difficulty: string;

  @IsString()
  @IsNotEmpty()
  questionCategory: string;
}
