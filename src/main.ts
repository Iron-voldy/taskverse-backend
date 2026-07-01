import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] })
  const logger = new Logger('Bootstrap')
  const isProd = process.env.NODE_ENV === 'production'

  app.use(helmet())

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('TaskVerse API')
      .setDescription('Generative-UI Todo Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build()
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document)
    logger.log('Swagger docs available at /api/docs')
  }

  const port = process.env.PORT ?? 3001
  await app.listen(port)
  logger.log(`TaskVerse API running on port ${port} [${isProd ? 'production' : 'development'}]`)
}

bootstrap()
