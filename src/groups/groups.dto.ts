import { ArrayMinSize, ArrayUnique, IsBoolean, IsMongoId } from 'class-validator';

export class AddMembersDto {
  @ArrayMinSize(1, { message: 'Add at least one person' })
  @ArrayUnique({ message: 'Remove duplicate people' })
  @IsMongoId({ each: true, message: 'Pick valid people' })
  userIds!: string[];
}

export class SetAdminDto {
  @IsBoolean()
  isAdmin!: boolean;
}
