import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty } from 'class-validator'

export class GoogleAuthDto {
  @ApiProperty({ description: 'Google OAuth id_token from client' })
  @IsString()
  @IsNotEmpty()
  token: string
}
