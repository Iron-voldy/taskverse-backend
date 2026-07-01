import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'
import { ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from './auth/auth.module'
import { TasksModule } from './tasks/tasks.module'
import { UsersModule } from './users/users.module'
import { GenUIModule } from './genui/genui.module'
import { ListsModule } from './lists/lists.module'
import { MailModule } from './mail/mail.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 20 },
      { name: 'medium', ttl: 60000, limit: 100 },
    ]),
    AuthModule,
    TasksModule,
    UsersModule,
    GenUIModule,
    ListsModule,
    MailModule,
  ],
})
export class AppModule {}
